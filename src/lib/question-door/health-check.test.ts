// ─────────────────────────────────────────────────────────────────────────
// health_check, with Meta MOCKED.
//
// THE LAWS THIS FILE PINS:
//   1. When Meta is down, the answer falls back to the stored picture, the
//      receipt FLAGS the live source as stale, and the answer SAYS it is the
//      stored picture. A stale answer that looks live is the one outcome this
//      question must never produce.
//   2. An unchecked creator is reported as UNCHECKED, never as "go". A machine
//      reads the field, not the caveat.
//   3. A campaign stuck in review is a no_go with the reason attached.
//   4. A rate limit (code 17) STOPS. No retry, no poll.
//   5. A dead token is itself a finding, and no part of a token ever appears in
//      the output.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion } from "./service";
import { resetReceiptCaches } from "./receipts";
import { resetHealthCache, setGraphFetch } from "./health-check";
import { isRefusal, type DoorAnswer, type Db } from "./types";

const TOKEN = "EAA_this_must_never_appear_in_any_output";

/** Env the creator plumbing reads. Tyson's is the one under test. */
function withTysonCredentials(): void {
  process.env.META_ACCESS_TOKEN_TYSON = TOKEN;
  process.env.META_AD_ACCOUNT_TYSON = "act_176726311";
}

const SIGNED = [
  { name: "touch_floor_72h", version: 1, status: "signed", statement: "72 hours sustained; the sole exception is technical health failure.", details: { min_signal_age_hours: 72 } },
  { name: "structure_rules", version: 1, status: "signed", statement: "Group by adset_id and ad_id.", details: {} },
];

interface FakeOpts {
  /** The stored statuses the fallback reads. */
  stored?: Array<Record<string, unknown>>;
}

function fakeDb(opts: FakeOpts = {}): Db {
  const tables: Record<string, unknown[]> = {
    registry_entities: [{ canonical_key: "tyson" }],
    registry_definitions_current: SIGNED,
    door_freshness_thresholds: [
      { source: "meta_graph_live", threshold_hours: 1, note: "the live Meta Graph read" },
      { source: "adsv2_budget_snapshots", threshold_hours: 26, note: "the daily budget photos" },
    ],
    ads_meta_insights_daily: opts.stored ?? [
      {
        campaign_id: "camp-1",
        campaign_name: "Tyson - SCALING - Winners",
        campaign_effective_status: "ACTIVE",
        ad_id: "ad-1",
        ad_effective_status: "ACTIVE",
        adset_id: "adset-1",
        date: "2026-08-06",
        spend_cents: 8_000,
      },
    ],
  };
  const rpcs: Record<string, unknown[]> = {
    adsv2_budget_asof: [
      { entity_level: "adset", entity_id: "adset-1", campaign_id: "camp-1", daily_usd_cents: 10_000, lifetime_usd_cents: null, holds: true, effective_status: "ACTIVE" },
    ],
    question_door_definitions: [],
    question_door_freshness: [],
  };
  return {
    rpc(fn: string, args: unknown) {
      if (fn === "registry_resolve_entity") {
        const a = String((args as { p_alias?: string })?.p_alias ?? "").toLowerCase();
        return Promise.resolve({ data: a === "tyson" ? "tyson" : null, error: null });
      }
      return Promise.resolve({ data: rpcs[fn] ?? [], error: null });
    },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit"]) chain[m] = self;
      chain.insert = () => Promise.resolve({ data: null, error: null });
      chain.maybeSingle = () =>
        Promise.resolve({ data: table === "registry_entities" ? { kind: "creator" } : null, error: null });
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [], error: null });
      return chain;
    },
  } as unknown as Db;
}

/** A Graph response builder: one page, no paging. */
function page(data: unknown[]): Response {
  return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
}

function ask(opts: FakeOpts = {}) {
  resetReceiptCaches();
  resetHealthCache();
  return askQuestion(
    { question_key: "health_check", params: { client: "tyson" } },
    { db: fakeDb(opts), clients: ["tyson"], caller: "test", now: new Date("2026-08-07T12:00:00Z") },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// (d) THE FALLBACK.
// ─────────────────────────────────────────────────────────────────────────

test("META DOWN: the answer falls back to stored, the receipt flags it stale, and it SAYS so", async (t) => {
  withTysonCredentials();
  setGraphFetch(async () => {
    throw new Error("connect ECONNREFUSED");
  });
  t.after(() => setGraphFetch(null));

  const r = await ask();
  assert.ok(!isRefusal(r), "Meta being down must not cost the caller their answer");
  const answer = r as DoorAnswer;
  const body = answer.answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];

  assert.equal(creator.source, "stored_fallback");
  assert.equal(creator.stored_as_of_day, "2026-08-06");

  // THE RECEIPT FLAGS IT. This is what stops a stored answer from reading live.
  const stale = answer.receipt.stale.map((s) => s.source);
  assert.ok(stale.includes("meta_graph_live"), "a fallback answer must flag the live source as stale");
  assert.match(
    answer.receipt.stale.find((s) => s.source === "meta_graph_live")!.note,
    /freshness is unknown/,
  );

  // AND IT SAYS SO IN WORDS, on the answer and in the exclusions.
  assert.match(String(answer.note), /STORED one, not a live read/);
  assert.match(answer.receipt.exclusions.map((e) => e.why).join(" "), /Treat those creators as unchecked/);

  // Delivery health touches no sale row, so coverage is legitimately null.
  assert.equal(answer.receipt.coverage, null);
});

test("AN UNCHECKED CREATOR IS NEVER REPORTED AS 'go'", async (t) => {
  withTysonCredentials();
  setGraphFetch(async () => {
    throw new Error("network down");
  });
  t.after(() => setGraphFetch(null));

  const body = ((await ask()) as DoorAnswer).answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];
  // Every stored campaign status reads ACTIVE, so the naive answer here is
  // "go". It is not a go: nothing was verified.
  assert.equal(creator.overall, "unchecked");
  assert.equal(body.overall, "unchecked");
  assert.match(String((body.outcome_key as Record<string, string>).unchecked), /NOT a clean bill of health/);
});

test("A CAMPAIGN STUCK IN REVIEW is a no_go, with the reason attached", async (t) => {
  withTysonCredentials();
  setGraphFetch(async (url) => {
    if (url.includes("/campaigns")) {
      return page([
        { id: "camp-stuck", name: "Tyson - TESTING", effective_status: "PENDING_REVIEW", configured_status: "ACTIVE" },
        { id: "camp-ok", name: "Tyson - SCALING", effective_status: "ACTIVE", configured_status: "ACTIVE" },
      ]);
    }
    if (url.includes("/adsets")) return page([]);
    return page([
      { id: "ad-1", campaign_id: "camp-stuck", effective_status: "PENDING_REVIEW" },
      { id: "ad-2", campaign_id: "camp-ok", effective_status: "ACTIVE" },
    ]);
  });
  t.after(() => setGraphFetch(null));

  const answer = (await ask()) as DoorAnswer;
  const body = answer.answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];
  assert.equal(creator.source, "live_meta");
  assert.equal(creator.overall, "no_go");
  assert.equal((creator.counts as Record<string, number>).in_review, 1);

  const campaigns = creator.campaigns as Array<Record<string, unknown>>;
  const stuck = campaigns.find((c) => c.campaign_id === "camp-stuck")!;
  assert.equal(stuck.go_no_go, "no_go");
  assert.match((stuck.reasons as string[]).join(" "), /sitting in review and cannot deliver/);

  const ok = campaigns.find((c) => c.campaign_id === "camp-ok")!;
  assert.equal(ok.go_no_go, "go");

  // The one exception to the 72-hour touch floor is stated, not assumed.
  assert.match(String(body.standing_note), /one exception to touch_floor_72h/);
  assert.match(String(body.standing_note), /acted on immediately/);
});

test("AN ACTIVE CAMPAIGN WITH NO DELIVERABLE AD is caught: it spends nothing while looking healthy", async (t) => {
  withTysonCredentials();
  setGraphFetch(async (url) => {
    if (url.includes("/campaigns")) {
      return page([{ id: "camp-1", name: "Tyson - TESTING", effective_status: "ACTIVE" }]);
    }
    if (url.includes("/adsets")) return page([]);
    return page([
      { id: "ad-1", campaign_id: "camp-1", effective_status: "DISAPPROVED" },
      { id: "ad-2", campaign_id: "camp-1", effective_status: "PAUSED" },
    ]);
  });
  t.after(() => setGraphFetch(null));

  const body = ((await ask()) as DoorAnswer).answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];
  const c = (creator.campaigns as Array<Record<string, unknown>>)[0];
  assert.equal(c.go_no_go, "no_go");
  const reasons = (c.reasons as string[]).join(" ");
  assert.match(reasons, /ACTIVE but not one of its 2 ads is/);
  assert.match(reasons, /rejected inside an otherwise active campaign/);
});

test("A RATE LIMIT STOPS. It does not retry and it does not poll", async (t) => {
  withTysonCredentials();
  let calls = 0;
  setGraphFetch(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { code: 17, message: "User request limit reached" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  });
  t.after(() => setGraphFetch(null));

  const body = ((await ask()) as DoorAnswer).answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];
  assert.equal(creator.rate_limited, true);
  assert.equal(creator.source, "stored_fallback");
  assert.match(String(creator.live_error), /stopped immediately rather than retrying/);
  // Three parallel fetches go out on the first attempt; the point is that the
  // SECOND attempt never happens.
  assert.ok(calls <= 3, `a rate limit must not be retried, but the fetcher was called ${calls} times`);
});

test("A DEAD TOKEN is itself a finding, and no part of the token appears anywhere", async (t) => {
  withTysonCredentials();
  setGraphFetch(async () => {
    return new Response(
      // A real Graph error body echoes the request URL, which carries the
      // token. This proves we never pass that through.
      JSON.stringify({ error: { code: 190, message: `Invalid OAuth access token for ${TOKEN}` } }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  });
  t.after(() => setGraphFetch(null));

  const answer = (await ask()) as DoorAnswer;
  const body = answer.answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];
  assert.equal(creator.token_state, "rejected");
  assert.equal(creator.source, "stored_fallback");

  const campaigns = creator.campaigns as Array<Record<string, unknown>>;
  assert.ok(campaigns.length > 0);
  assert.equal(campaigns[0].go_no_go, "no_go");
  assert.match((campaigns[0].reasons as string[]).join(" "), /did not accept this creator's access token/);
  assert.equal(creator.overall, "no_go", "a creator we cannot authenticate for is not a go");

  // THE CREDENTIAL NEVER LEAKS, not into the answer and not into the receipt.
  const whole = JSON.stringify(answer);
  assert.ok(!whole.includes(TOKEN), "the access token leaked into the answer");
  assert.ok(!whole.includes("EAA_"), "something token-shaped leaked into the answer");
});

test("a live read reconciles the dials to yesterday's real spend", async (t) => {
  withTysonCredentials();
  setGraphFetch(async (url) => {
    if (url.includes("/campaigns")) return page([{ id: "camp-1", name: "Tyson - TESTING", effective_status: "ACTIVE" }]);
    if (url.includes("/adsets")) return page([]);
    return page([{ id: "ad-1", campaign_id: "camp-1", effective_status: "ACTIVE" }]);
  });
  t.after(() => setGraphFetch(null));

  const body = ((await ask()) as DoorAnswer).answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];
  const dials = creator.budget_dials as Array<Record<string, unknown>>;
  assert.equal(dials.length, 1);
  // $80 spent against a $100 dial is 80%, inside Meta's daily flex.
  assert.equal(dials[0].daily_usd_cents, 10_000);
  assert.equal(dials[0].yesterday_spend_usd_cents, 8_000);
  assert.equal(dials[0].pct_of_dial, 80);
  assert.equal(dials[0].shortfall_flagged, false);
  assert.equal(creator.overall, "go");
});

test("a shortfall past Meta's daily flex IS flagged", async (t) => {
  withTysonCredentials();
  setGraphFetch(async (url) => {
    if (url.includes("/campaigns")) return page([{ id: "camp-1", name: "Tyson - TESTING", effective_status: "ACTIVE" }]);
    if (url.includes("/adsets")) return page([]);
    return page([{ id: "ad-1", campaign_id: "camp-1", effective_status: "ACTIVE" }]);
  });
  t.after(() => setGraphFetch(null));

  const body = ((await ask({
    stored: [
      {
        campaign_id: "camp-1",
        campaign_name: "Tyson - TESTING",
        campaign_effective_status: "ACTIVE",
        ad_id: "ad-1",
        ad_effective_status: "ACTIVE",
        adset_id: "adset-1",
        date: "2026-08-06",
        spend_cents: 2_000,
      },
    ],
  })) as DoorAnswer).answers as Record<string, unknown>;
  const creator = (body.creators as Array<Record<string, unknown>>)[0];
  const dials = creator.budget_dials as Array<Record<string, unknown>>;
  assert.equal(dials[0].pct_of_dial, 20);
  assert.equal(dials[0].shortfall_flagged, true);
  assert.equal(creator.shortfalls, 1);
});

test("health_check never claims to have fixed anything", async (t) => {
  withTysonCredentials();
  setGraphFetch(async (url) => {
    if (url.includes("/campaigns")) return page([{ id: "c", name: "T", effective_status: "PENDING_REVIEW" }]);
    if (url.includes("/adsets")) return page([]);
    return page([]);
  });
  t.after(() => setGraphFetch(null));

  const answer = (await ask()) as DoorAnswer;
  const json = JSON.stringify(answer.answers).toLowerCase();
  for (const claim of ["we resumed", "we unpaused", "has been fixed", "we resubmitted", "we appealed"]) {
    assert.ok(!json.includes(claim), `health_check implied it acted: ${claim}`);
  }
  assert.match(String(answer.answers && (answer.answers as Record<string, unknown>).what_this_is_not), /never whether they SHOULD/);
});
