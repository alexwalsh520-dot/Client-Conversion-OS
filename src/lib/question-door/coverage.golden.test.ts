// ─────────────────────────────────────────────────────────────────────────
// THE GOLDEN COVERAGE FIXTURE — hand-verified against the real database.
//
// Every other test in this folder runs against a constructed database, which
// is right for pinning behaviour but useless for pinning NUMBERS: a fake that
// returns what the code expects proves only that the code agrees with itself.
//
// This file is the opposite. It runs door_coverage_block against the real
// stamped facts and compares it with values a human worked out by hand, in
// SQL, before this test existed. If the two ever disagree, either the data
// moved (recompute by hand and update the fixture, saying so) or the coverage
// rule changed underneath us (which is exactly what we want to be told).
//
// It SKIPS, loudly, when database credentials are absent, so it never turns
// into a test that silently passes by not running.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Db } from "./types";
import { coverageFor } from "./receipts";

/** Load .env.local the way Next.js would, since the test runner does not. */
function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && KEY);

function liveDb(): Db {
  return createClient(URL!, KEY!, { auth: { persistSession: false } }) as unknown as Db;
}

// ─────────────────────────────────────────────────────────────────────────
// HAND-VERIFIED, 2026-08-05, by running this SQL against the live database
// and reading the rows off by eye:
//
//   SELECT CASE
//            WHEN awaiting_review THEN 'awaiting_review'
//            WHEN is_organic OR EXISTS (organic keyword in registry_keywords
//                                       for this client) THEN 'organic'
//            WHEN keyword_normalized IS NOT NULL THEN 'ad'
//            WHEN call_type = 'Miscellaneous Chat' THEN 'misc_chat'
//          END AS bucket, COUNT(*), SUM(collected_usd_cents)
//     FROM adsv2_sale_facts
//    WHERE is_win AND sale_et_day BETWEEN '2026-07-18' AND '2026-07-31'
//      AND (client_key = 'tyson' OR (awaiting_review AND client_key IS NULL))
//    GROUP BY 1;
//
//   ad              17 wins  2,509,500 cents
//   organic          1 win     220,000 cents
//   awaiting_review  1 win     199,900 cents   (client_key NULL)
//   misc_chat        0 wins            0
//
// Two of these were checked individually rather than taken on trust:
//   - the 1 organic win is a LOCKED sale. Its is_organic flag is FALSE, so it
//     is classified organic ONLY by the registry keyword list. Without that
//     belt-and-suspenders rule it would count as an ad sale and enter ad ROAS,
//     which organic_keywords v1 forbids.
//   - the 1 awaiting-review win carries NO creator. A coverage read filtered
//     to tyson would not see it and would report 100%.
// ─────────────────────────────────────────────────────────────────────────

const GOLDEN = {
  from: "2026-07-18",
  to: "2026-07-31",
  clients: ["tyson"],
  window_wins_total: 19,
  window_cash_usd_cents_total: 2929400,
  ad: { wins: 17, cash_usd_cents: 2509500 },
  organic: { wins: 1, cash_usd_cents: 220000 },
  misc_chat: { wins: 0, cash_usd_cents: 0 },
  awaiting_review: { wins: 1, cash_usd_cents: 199900 },
  classified_pct_wins: 94.7,
  classified_pct_cash: 93.2,
};

test(
  "GOLDEN: the coverage block reproduces the hand-verified 2026-07-18 to 2026-07-31 tyson window",
  { skip: LIVE ? false : "no database credentials in the environment, so the golden fixture was NOT checked" },
  async () => {
    const c = await coverageFor(liveDb(), GOLDEN.clients, GOLDEN.from, GOLDEN.to);
    assert.ok(c, "the coverage block must come back");
    assert.equal(c.window_wins_total, GOLDEN.window_wins_total);
    assert.equal(c.window_cash_usd_cents_total, GOLDEN.window_cash_usd_cents_total);
    assert.deepEqual(c.buckets.ad, GOLDEN.ad);
    assert.deepEqual(c.buckets.organic, GOLDEN.organic);
    assert.deepEqual(c.buckets.misc_chat, GOLDEN.misc_chat);
    assert.deepEqual(c.buckets.awaiting_review, GOLDEN.awaiting_review);
    assert.equal(c.classified_pct_wins, GOLDEN.classified_pct_wins);
    assert.equal(c.classified_pct_cash, GOLDEN.classified_pct_cash);
  },
);

test(
  "GOLDEN: the unassigned win is counted even though the question named one creator",
  { skip: LIVE ? false : "no database credentials in the environment" },
  async () => {
    const c = await coverageFor(liveDb(), ["tyson"], GOLDEN.from, GOLDEN.to);
    // THE WHOLE POINT OF THIS BRICK. Every awaiting-review win in this
    // database carries client_key NULL. A coverage read scoped to one creator
    // would find none of them and report 100% coverage, which is the exact
    // false claim this brick exists to kill.
    assert.equal(c!.buckets.awaiting_review.wins, 1);
    assert.ok(c!.classified_pct_wins < 100, "coverage must NOT read 100% while a win sits unclassified");
    assert.match(c!.note, /carry no creator at all/);
  },
);

test(
  "GOLDEN: the 4 LOCKED organic sales show up across 2026-06-24 to 2026-07-31",
  { skip: LIVE ? false : "no database credentials in the environment" },
  async () => {
    const c = await coverageFor(liveDb(), ["tyson"], "2026-06-24", "2026-07-31");
    assert.ok(c);
    // The four locked organic sales. Brick 2 classified these by the registry
    // keyword list alone, because is_organic was false on all four. Brick 4's
    // labeler part C now sets the flag at the source too, so both routes agree.
    assert.ok(c.buckets.organic.wins >= 4, `expected at least 4 organic wins, got ${c.buckets.organic.wins}`);
    // Real, unclassified money is still visible rather than hidden by the filter.
    assert.ok(c.buckets.awaiting_review.wins > 0);

    // ── CHANGED BY BRICK 4, DELIBERATELY ────────────────────────────────
    // This assertion used to be `assert.match(c.note, /Miscellaneous Chat/)`.
    //
    // Brick 2 could only REPORT the overlap: 6 wins in this window carried the
    // team's own "Miscellaneous Chat" label AND were awaiting review, so they
    // counted as the gap and the note said so. Brick 2's own report called that
    // out and said "when labeler part D lands, those rows move to misc_chat and
    // coverage will rise".
    //
    // Part D has landed. Those 6 are resolved, the overlap for this window is
    // now 0, and the sentence the old assertion matched is correctly gone. The
    // test now pins the OUTCOME that replaced it, which is a stronger claim
    // than the one it replaces: the rows did not just get described, they got
    // classified.
    assert.equal(c.buckets.misc_chat.wins, 6, "the 6 resolved misc-chat wins now count as misc chat");
    assert.equal(c.buckets.misc_chat.cash_usd_cents, 1269800);
  },
);

test(
  "GOLDEN: the four buckets sum exactly to the totals, across several real windows",
  { skip: LIVE ? false : "no database credentials in the environment" },
  async () => {
    const db = liveDb();
    const windows: Array<[string[], string, string]> = [
      [["tyson"], "2026-07-18", "2026-07-31"],
      [["tyson"], "2026-06-24", "2026-07-31"],
      [["tyson", "jake"], "2026-07-01", "2026-07-31"],
      [["tyson", "jake"], "2026-05-22", "2026-08-05"],
      [["jake"], "2026-07-01", "2026-07-31"],
    ];
    for (const [clients, from, to] of windows) {
      const c = await coverageFor(db, clients, from, to);
      assert.ok(c, `${clients.join("+")} ${from}..${to} must return a block`);
      const b = c.buckets;
      assert.equal(
        b.ad.wins + b.organic.wins + b.misc_chat.wins + b.awaiting_review.wins,
        c.window_wins_total,
        `wins must sum for ${clients.join("+")} ${from}..${to}`,
      );
      assert.equal(
        b.ad.cash_usd_cents + b.organic.cash_usd_cents + b.misc_chat.cash_usd_cents + b.awaiting_review.cash_usd_cents,
        c.window_cash_usd_cents_total,
        `cash must sum for ${clients.join("+")} ${from}..${to}`,
      );
    }
  },
);

test(
  "GOLDEN: every declared alias resolves to one canonical creator, against the real registry",
  { skip: LIVE ? false : "no database credentials in the environment" },
  async () => {
    const db = liveDb();
    for (const [given, expected] of [
      ["jake_divljak", "jake"],
      ["Jake Divijak", "jake"],
      ["JAKE", "jake"],
      ["rrf", "jake"],
      ["tyson_sonnek", "tyson"],
    ] as const) {
      const { data, error } = await db.rpc("registry_resolve_entity", { p_alias: given });
      assert.equal(error, null, `resolving ${given} must not error`);
      assert.equal(data, expected, `${given} must resolve to ${expected}`);
    }
    // A name the registry has never heard of resolves to nothing, rather than
    // to the nearest creator. No fuzzy matching, ever.
    const { data } = await db.rpc("registry_resolve_entity", { p_alias: "tysonn" });
    assert.equal(data, null);
  },
);
