import { test } from "node:test";
import assert from "node:assert/strict";
import { mapActivity, type MetaActivity } from "./activity-sync";

const CTX = {
  clientKey: "tyson",
  accountId: "act_176726311",
  currency: "USD",
  source: "meta_activity_backfill" as const,
};

// Every fixture below is a REAL record pulled from Tyson's account on
// 2026-07-25, trimmed only for length. The legacy-naming assertions are the
// point of this file: if Meta ever renames these, this test fails loudly
// rather than the change log silently mis-joining every row.

// ── Meta's legacy object names ────────────────────────────────────────────

test("ADGROUP is an AD, and its extra_data.campaign_id is the AD SET", () => {
  const a: MetaActivity = {
    event_type: "update_ad_run_status",
    event_time: "2026-07-24T16:47:06+0000",
    object_id: "52581821002664",
    object_name: "LOADED",
    object_type: "ADGROUP",
    extra_data:
      '{"old_value":"Pending Process","new_value":"Inactive","campaign_id":52581820968064,"type":"run_status"}',
    actor_name: "Tyson Sonnek",
  };
  const row = mapActivity(a, CTX)!;
  assert.equal(row.level, "ad");
  assert.equal(row.ad_id, "52581821002664");
  // The trap: Meta calls this "campaign_id" but it is the ad set.
  assert.equal(row.adset_id, "52581820968064");
  // The true campaign is filled in later from our own spend history.
  assert.equal(row.campaign_id, null);
});

test("CAMPAIGN is an AD SET", () => {
  const row = mapActivity(
    {
      event_type: "update_ad_set_run_status",
      event_time: "2026-07-22T10:00:00+0000",
      object_id: "52589686156264",
      object_name: "BASE - Lead Magnet Test",
      object_type: "CAMPAIGN",
      extra_data: '{"old_value":"Active","new_value":"Inactive","type":"run_status"}',
    },
    CTX,
  )!;
  assert.equal(row.level, "adset");
  assert.equal(row.adset_id, "52589686156264");
  assert.equal(row.ad_id, null);
});

test("CAMPAIGN_GROUP is a CAMPAIGN", () => {
  const row = mapActivity(
    {
      event_type: "create_campaign_group",
      event_time: "2026-06-18T12:00:00+0000",
      object_id: "52570597860064",
      object_name: "Tyson - SCALING - Winners (FIT FOCUS HEALTHY)",
      object_type: "CAMPAIGN_GROUP",
      extra_data: '{"type":"composite_data"}',
    },
    CTX,
  )!;
  assert.equal(row.level, "campaign");
  assert.equal(row.campaign_id, "52570597860064");
  assert.equal(row.change_type, "created");
});

// ── What kind of change it was ────────────────────────────────────────────

test("a budget move is read out of Meta's nested composite shape", () => {
  const row = mapActivity(
    {
      event_type: "update_ad_set_budget",
      event_time: "2026-07-15T09:31:01+0000",
      object_id: "52575879187864",
      object_name: "TEST - Lead Magnet - 50 (6/24)",
      object_type: "CAMPAIGN",
      extra_data:
        '{"old_value":{"type":"payment_amount","currency":"USD","old_value":9250},"new_value":{"type":"payment_amount","currency":"USD","new_value":5000},"type":"composite_data"}',
    },
    CTX,
  )!;
  assert.equal(row.change_type, "budget_change");
  assert.equal(row.old_budget_cents, 9250); // 92.50 per day
  assert.equal(row.new_budget_cents, 5000); // 50.00 per day
  assert.equal(row.currency, "USD");
});

test("the budget an ad set was born with is captured", () => {
  const row = mapActivity(
    {
      event_type: "create_ad_set",
      event_time: "2026-07-21T14:00:00+0000",
      object_id: "52589686189864",
      object_name: "FIT - Warm Audience Stack (relaunch 7/21)",
      object_type: "CAMPAIGN",
      extra_data:
        '{"new_value":{"type":"payment_amount","currency":"USD","new_value":11500,"additional_value":"Per day"},"type":"composite_data"}',
    },
    CTX,
  )!;
  assert.equal(row.change_type, "created");
  assert.equal(row.new_budget_cents, 11500); // 115.00 per day, the known SCALE level
});

test("Active counts as on, and every other word counts as off", () => {
  const on = mapActivity(
    {
      event_type: "update_ad_run_status",
      event_time: "2026-07-01T00:00:00+0000",
      object_id: "1",
      object_type: "ADGROUP",
      extra_data: '{"old_value":"Inactive","new_value":"Active"}',
    },
    CTX,
  )!;
  assert.equal(on.change_type, "status_on");

  for (const word of ["Inactive", "Paused", "Deleted", "Archived", "Pending Process"]) {
    const off = mapActivity(
      {
        event_type: "update_ad_run_status",
        event_time: "2026-07-01T00:00:00+0000",
        object_id: "1",
        object_type: "ADGROUP",
        extra_data: JSON.stringify({ old_value: "Active", new_value: word }),
      },
      CTX,
    )!;
    assert.equal(off.change_type, "status_off", `${word} must not count as running`);
  }
});

test("the object-shaped id Meta uses on creation events is read", () => {
  const row = mapActivity(
    {
      event_type: "create_ad",
      event_time: "2026-07-21T14:05:00+0000",
      object_id: "52589686209064",
      object_name: "FIT",
      object_type: "ADGROUP",
      extra_data: '{"campaign_id":{"mutation_input":52589686189864,"new":52589686189864}}',
    },
    CTX,
  )!;
  assert.equal(row.adset_id, "52589686189864");
});

// ── Safety ────────────────────────────────────────────────────────────────

test("the same event fingerprints the same, a different one differently", () => {
  const base: MetaActivity = {
    event_type: "update_ad_run_status",
    event_time: "2026-07-24T16:43:19+0000",
    object_id: "52575889454464",
    object_type: "ADGROUP",
    extra_data: '{"new_value":"Active"}',
  };
  assert.equal(mapActivity(base, CTX)!.change_uid, mapActivity(base, CTX)!.change_uid);

  // Two real events landed on this ad in the SAME second with different
  // payloads. They must stay two rows, not collapse into one.
  const sibling: MetaActivity = { ...base, extra_data: '{"new_value":"Pending Process"}' };
  assert.notEqual(mapActivity(sibling, CTX)!.change_uid, mapActivity(base, CTX)!.change_uid);
});

// REGRESSION (2026-07-25). The first version of this file hashed Meta's raw
// extra_data. Re-fetching windows we already held then added 712 rows that
// were all changes we already had, because Meta re-signs its CDN URLs and
// recomputes last_learning_exit between calls. The fingerprint now hashes only
// the stable part of the payload. These two tests are the proof.

test("the same event re-fetched with a re-signed URL keeps its fingerprint", () => {
  const first = mapActivity(
    {
      event_type: "update_ad_creative",
      event_time: "2026-07-10T11:00:00+0000",
      object_id: "52581887118264",
      object_name: "GOOD",
      object_type: "ADGROUP",
      extra_data: JSON.stringify({
        new_value: ["https://scontent.xx.fbcdn.net/v/t45.1600-4/716974499_279.png?oh=00_AQAAAA&oe=6A6A58F4&_nc_gid=aaa"],
      }),
    },
    CTX,
  )!;
  const refetched = mapActivity(
    {
      event_type: "update_ad_creative",
      event_time: "2026-07-10T11:00:00+0000",
      object_id: "52581887118264",
      object_name: "GOOD",
      object_type: "ADGROUP",
      // Same asset, freshly signed by Meta on the next call.
      extra_data: JSON.stringify({
        new_value: ["https://scontent.xx.fbcdn.net/v/t45.1600-4/716974499_279.png?oh=00_ZZZZZZ&oe=7B7B99A1&_nc_gid=bbb"],
      }),
    },
    CTX,
  )!;
  assert.equal(refetched.change_uid, first.change_uid);
});

test("the same event re-fetched with a recomputed last_learning_exit keeps its fingerprint", () => {
  const make = (exit: number) =>
    mapActivity(
      {
        event_type: "update_ad_run_status",
        event_time: "2026-07-24T16:47:06+0000",
        object_id: "52581821002664",
        object_type: "ADGROUP",
        extra_data: JSON.stringify({
          old_value: "Pending Process",
          new_value: "Inactive",
          campaign_id: 52581820968064,
          last_learning_exit: exit,
        }),
      },
      CTX,
    )!;
  assert.equal(make(1784012400).change_uid, make(1784098800).change_uid);
});

test("account-level billing and image events are not ad changes and are skipped", () => {
  assert.equal(
    mapActivity(
      {
        event_type: "ad_account_billing_charge",
        event_time: "2026-07-01T00:00:00+0000",
        object_id: "202269756469193",
        object_type: "ACCOUNT",
        extra_data: '{"currency":"USD","new_value":95200}',
      },
      CTX,
    ),
    null,
  );
});

test("an object type we have never seen is skipped, not guessed", () => {
  assert.equal(
    mapActivity(
      {
        event_type: "something_new",
        event_time: "2026-07-01T00:00:00+0000",
        object_id: "1",
        object_type: "SOMETHING_META_ADDED_LATER",
      },
      CTX,
    ),
    null,
  );
});

test("a record with no time or no id is skipped", () => {
  assert.equal(mapActivity({ event_type: "x", object_id: "1", object_type: "ADGROUP" }, CTX), null);
  assert.equal(
    mapActivity({ event_type: "x", event_time: "2026-07-01T00:00:00+0000", object_type: "ADGROUP" }, CTX),
    null,
  );
});
