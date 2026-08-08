// ─────────────────────────────────────────────────────────────────────────
// BRICK 4 GOLDEN FIXTURES: against the REAL database, not a fake.
//
// Same discipline as Brick 2's coverage.golden.test.ts and Brick 3's
// brick3.golden.test.ts: a constructed database is right for pinning BEHAVIOUR
// and useless for pinning NUMBERS, because a fake that returns what the code
// expects proves only that the code agrees with itself.
//
// Every number below was computed in SQL against the live database, by hand,
// BEFORE this file existed. If one ever disagrees, either the data moved
// (recompute by hand and update the fixture, saying so in the report) or a rule
// changed underneath us, which is exactly what we want to be told.
//
// SKIPS LOUDLY without credentials, so it can never pass by not running.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { askQuestion, describeDoor } from "./service";
import { coverageFor } from "./receipts";
import { priorWindows } from "./coverage-report";
import { worst } from "./capture-health";
import { isRefusal, type Db, type DoorAnswer } from "./types";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && KEY);
const skip = LIVE ? false : "no database credentials in the environment, so the Brick 4 goldens were NOT checked";

function liveDb(): Db {
  return createClient(URL!, KEY!, { auth: { persistSession: false } }) as unknown as Db;
}

const CLIENTS = ["tyson", "jake"] as const;

function answerOf(r: unknown): DoorAnswer {
  assert.ok(!isRefusal(r as never), `expected an answer, got a refusal: ${JSON.stringify(r).slice(0, 400)}`);
  return r as DoorAnswer;
}

// ─────────────────────────────────────────────────────────────────────────
// (a) THE FOUR LOCKED WINS CARRY is_organic AT THE SOURCE.
//
// Before migration 078, all four had is_organic = false and were classified
// organic ONLY by door_coverage_block's belt-and-suspenders registry rule.
// Anything reading the facts directly, and not everything goes through the
// door, saw them as ad sales.
// ─────────────────────────────────────────────────────────────────────────

const LOCKED_WINS = [
  { sale_key: "2026-07-25:call-171:dany-jimenez", name: "Dany Jimenez", day: "2026-07-25" },
  { sale_key: "2026-07-13:call-113:andrew-sober", name: "Andrew Sober", day: "2026-07-13" },
  { sale_key: "2026-06-25:call-168:evan-carlson", name: "Evan Carlson", day: "2026-06-25" },
  { sale_key: "2026-07-10:call-84:will-lindsey", name: "Will Lindsey", day: "2026-07-10" },
];

test("GOLDEN a1: the 4 LOCKED wins carry is_organic at the SOURCE, not only at the door", { skip }, async () => {
  const db = liveDb();
  const { data, error } = await db
    .from("adsv2_sale_facts")
    .select("sale_key, prospect_name, sale_et_day, is_organic, method, keyword_normalized, client_key")
    .in("sale_key", LOCKED_WINS.map((w) => w.sale_key));
  assert.equal(error, null);
  const rows = (data || []) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 4, "all four LOCKED wins must still exist");
  for (const r of rows) {
    assert.equal(r.is_organic, true, `${r.prospect_name} must be flagged organic at the source`);
    assert.equal(r.method, "organic", `${r.prospect_name} must carry method organic`);
    assert.equal(r.keyword_normalized, "locked");
    assert.equal(r.client_key, "tyson");
  }
});

test("GOLDEN a2: door coverage for 2026-06-24 to 2026-07-31 tyson still sums exactly", { skip }, async () => {
  const c = await coverageFor(liveDb(), ["tyson"], "2026-06-24", "2026-07-31");
  assert.ok(c);
  assert.ok(c.buckets.organic.wins >= 4, `expected at least 4 organic wins, got ${c.buckets.organic.wins}`);
  const b = c.buckets;
  assert.equal(
    b.ad.wins + b.organic.wins + b.misc_chat.wins + b.awaiting_review.wins,
    c.window_wins_total,
    "the four buckets must still sum exactly after the backfill",
  );
  assert.equal(
    b.ad.cash_usd_cents + b.organic.cash_usd_cents + b.misc_chat.cash_usd_cents + b.awaiting_review.cash_usd_cents,
    c.window_cash_usd_cents_total,
  );
});

test("GOLDEN a3: Brick 2's own hand-verified window is UNCHANGED by this brick", { skip }, async () => {
  // The 2026-07-18 to 2026-07-31 tyson window was hand-verified on 2026-08-05
  // and pinned in coverage.golden.test.ts. Brick 4 moved rows in OTHER windows;
  // if it had moved anything here, that would be a regression rather than a fix.
  const c = await coverageFor(liveDb(), ["tyson"], "2026-07-18", "2026-07-31");
  assert.ok(c);
  assert.equal(c.window_wins_total, 19);
  assert.equal(c.window_cash_usd_cents_total, 2929400);
  assert.deepEqual(c.buckets.ad, { wins: 17, cash_usd_cents: 2509500 });
  assert.deepEqual(c.buckets.organic, { wins: 1, cash_usd_cents: 220000 });
  assert.deepEqual(c.buckets.misc_chat, { wins: 0, cash_usd_cents: 0 });
  assert.deepEqual(c.buckets.awaiting_review, { wins: 1, cash_usd_cents: 199900 });
});

// ─────────────────────────────────────────────────────────────────────────
// (b) THE EIGHT ROWS ALEX REVIEWED ON 2026-07-31 HAVE LEFT THE QUEUE.
//
// Hand-verified total: 15,098.00 USD.
// ─────────────────────────────────────────────────────────────────────────

const REVIEWED_2026_07_31 = [
  { sale_key: "2026-07-15:call-122:oliver-forton", name: "Oliver Forton", cash: 240000, misc: true },
  { sale_key: "2026-06-30:call-200:jaxon-griswold", name: "Jaxon Griswold", cash: 239900, misc: true },
  { sale_key: "2026-07-12:call-93:dylan-sheets", name: "Dylan Sheets", cash: 239900, misc: true },
  { sale_key: "2026-06-27:call-184:izsak-becker", name: "Izsak Becker", cash: 200000, misc: true },
  { sale_key: "2026-07-14:call-106:steve-crider", name: "Steve Crider", cash: 200000, misc: true },
  { sale_key: "2026-07-06:call-23:joseph-cox", name: "Joseph Cox", cash: 150000, misc: true },
  { sale_key: "2026-07-15:call-127:drake-mcginley", name: "Drake McGinley", cash: 120000, misc: false },
  { sale_key: "2026-07-16:call-125:hunter-fleek", name: "Hunter Fleek", cash: 120000, misc: false },
];
const REVIEWED_TOTAL_CENTS = 1509800;

test("GOLDEN b1: the 8 rows reviewed on 2026-07-31 are stamped human_confirmed_non_ad", { skip }, async () => {
  const db = liveDb();
  const { data, error } = await db
    .from("adsv2_sale_facts")
    .select("sale_key, prospect_name, blank_reason, awaiting_review, evidence_key, client_key, keyword_normalized, collected_usd_cents, call_type")
    .in("sale_key", REVIEWED_2026_07_31.map((r) => r.sale_key));
  assert.equal(error, null);
  const rows = (data || []) as Array<Record<string, unknown>>;
  assert.equal(rows.length, 8, "all eight reviewed rows must still exist");

  let total = 0;
  for (const r of rows) {
    assert.equal(r.blank_reason, "human_confirmed_non_ad", `${r.prospect_name} must carry the human-confirmed reason`);
    assert.equal(r.awaiting_review, false, `${r.prospect_name} must have LEFT the awaiting-review queue`);
    assert.equal(r.evidence_key, "human_resolution");
    assert.equal(r.keyword_normalized, null, "a human-confirmed non-ad keeps a null keyword: that IS the finding");
    assert.equal(r.client_key, "tyson", "the client comes from the resolution row, never a guess");
    total += Number(r.collected_usd_cents) || 0;
  }
  assert.equal(total, REVIEWED_TOTAL_CENTS, "the hand-counted 15,098.00 USD must reconcile exactly");
});

test("GOLDEN b2: the 6 misc-chat ones count as misc_chat; the 2 others are NAMED, not hidden", { skip }, async () => {
  const c = await coverageFor(liveDb(), ["tyson"], "2026-06-24", "2026-07-31");
  assert.ok(c);
  // Six of the eight carry the team's own "Miscellaneous Chat" callType, so the
  // existing signed priority moves them without any rule change.
  assert.equal(c.buckets.misc_chat.wins, 6);
  assert.equal(c.buckets.misc_chat.cash_usd_cents, 1269800);

  // The other two (Drake McGinley "Strategy Session", Hunter Fleek "Onboarding
  // Call") fit NO signed bucket. They stay counted in the gap, and the note
  // says so out loud rather than letting them look unreviewed.
  assert.match(c.note, /a person HAS classified them/);
  assert.match(c.note, /certainty_buckets v1/);
  assert.match(c.note, /2400\.00 USD/);
});

test("GOLDEN b3: the labeler is idempotent, so a re-run stamps nothing twice", { skip }, async () => {
  const db = liveDb();
  const { data, error } = await db.rpc("adsv2_label_sale_origins", {
    p_from: "2026-05-22",
    p_to: new Date().toISOString().slice(0, 10),
    p_active_clients: [...CLIENTS],
  });
  assert.equal(error, null);
  assert.equal(Number(data), 0, "a second labeler run must change nothing at all");
});

// ─────────────────────────────────────────────────────────────────────────
// (c) coverage_report: the trend computes, and this window ties EXACTLY to
//     door_coverage_block for the same window.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN c0: the prior windows are equal length and butt up against each other", () => {
  // Pure arithmetic, so this one runs without credentials. Equal lengths are the
  // point: comparing a 14 day window against a 30 day one shows a "trend" that
  // is only arithmetic.
  const priors = priorWindows("2026-07-18", "2026-07-31", 3);
  assert.deepEqual(priors, [
    { from: "2026-07-04", to: "2026-07-17" },
    { from: "2026-06-20", to: "2026-07-03" },
    { from: "2026-06-06", to: "2026-06-19" },
  ]);
});

test("GOLDEN c1: coverage_report's current window matches door_coverage_block exactly", { skip }, async () => {
  const db = liveDb();
  const r = answerOf(
    await askQuestion(
      { question_key: "coverage_report", params: { client: "tyson", date_from: "2026-06-24", date_to: "2026-07-31" } },
      { db, clients: [...CLIENTS], caller: "test" },
    ),
  );
  const a = r.answers as Record<string, Record<string, unknown>>;
  const direct = await coverageFor(db, ["tyson"], "2026-06-24", "2026-07-31");
  assert.ok(direct);
  assert.equal(a.this_window.wins, direct.window_wins_total);
  assert.equal(a.this_window.cash_usd_cents, direct.window_cash_usd_cents_total);
  assert.deepEqual(a.this_window.buckets, direct.buckets);
  // And the receipt's own coverage block agrees with the body of the answer.
  assert.equal(r.receipt.coverage?.window_wins_total, direct.window_wins_total);
});

test("GOLDEN c2: three prior windows compute, and business-wide is ALWAYS present", { skip }, async () => {
  const r = answerOf(
    await askQuestion(
      { question_key: "coverage_report", params: { client: "tyson", date_from: "2026-07-18", date_to: "2026-07-31" } },
      { db: liveDb(), clients: [...CLIENTS], caller: "test" },
    ),
  );
  const a = r.answers as Record<string, unknown>;
  const trend = a.trend_prior_windows as Array<Record<string, unknown> | null>;
  assert.equal(trend.length, 3);
  for (const w of trend) assert.ok(w, "every prior window must compute, even an empty one");
  assert.deepEqual(
    trend.map((w) => [w!.date_from, w!.date_to]),
    [
      ["2026-07-04", "2026-07-17"],
      ["2026-06-20", "2026-07-03"],
      ["2026-06-06", "2026-06-19"],
    ],
  );
  // The business-wide block is on EVERY answer, including a per-creator one,
  // because every unclassified win carries no creator at all.
  const bw = a.business_wide as Record<string, unknown>;
  assert.ok(bw, "business-wide coverage must always be present");
  assert.deepEqual(bw.roster, [...CLIENTS]);
  assert.equal(typeof a.movement, "string");
});

test("GOLDEN c3: deposits pending close reports the one cash-bearing PCFU row", { skip }, async () => {
  // win_definition v1 records exactly one cash-bearing PCFU row. It is NOT a
  // win and is never counted as one; it is surfaced so the cash is visible.
  const r = answerOf(
    await askQuestion(
      { question_key: "coverage_report", params: { date_from: "2026-05-22", date_to: "2026-08-07" } },
      { db: liveDb(), clients: [...CLIENTS], caller: "test" },
    ),
  );
  const d = (r.answers as Record<string, Record<string, unknown>>).deposits_pending_close;
  assert.equal(d.rows, 1);
  assert.equal(d.cash_usd_cents, 30000);
});

// ─────────────────────────────────────────────────────────────────────────
// (d) resolution_queue reproduces the CURRENT awaiting list, spot-verified
//     against adsv2_sale_facts directly.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN d1: the queue is exactly the awaiting-review wins, verified against the facts", { skip }, async () => {
  const db = liveDb();
  const r = answerOf(
    await askQuestion({ question_key: "resolution_queue", params: { limit: 500 } }, { db, clients: [...CLIENTS], caller: "test" }),
  );
  const a = r.answers as Record<string, unknown>;

  // The independent check: count the awaiting-review wins straight off the
  // facts table, without going near the queue's own function.
  const { count, error } = await db
    .from("adsv2_sale_facts")
    .select("sale_key", { count: "exact", head: true })
    .eq("is_win", true)
    .eq("awaiting_review", true);
  assert.equal(error, null);
  assert.equal(a.returned, count, "the queue must be exactly as long as the real gap");
  assert.equal(a.truncated, false);

  // The eight rows Alex resolved on 7/31 must NOT be here any more.
  const queue = [...(a.queue as Array<Record<string, unknown>>), ...((a.zero_cash_oddities as Record<string, unknown>).rows as Array<Record<string, unknown>>)];
  const keys = new Set(queue.map((q) => String(q.sale_key)));
  for (const row of REVIEWED_2026_07_31) {
    assert.ok(!keys.has(row.sale_key), `${row.name} was resolved on 2026-07-31 and must have left the queue`);
  }
});

test("GOLDEN d2: every queued row that has a tracker match carries its ManyChat link", { skip }, async () => {
  const db = liveDb();
  const r = answerOf(
    await askQuestion({ question_key: "resolution_queue", params: { limit: 500 } }, { db, clients: [...CLIENTS], caller: "test" }),
  );
  const a = r.answers as Record<string, unknown>;
  const queue = [...(a.queue as Array<Record<string, unknown>>), ...((a.zero_cash_oddities as Record<string, unknown>).rows as Array<Record<string, unknown>>)];

  // Verify the link independently: for every queued row, whatever the tracker
  // row holds is what the queue reports. A row whose tracker carries no link
  // reports null and stays IN the queue.
  const { data, error } = await db
    .from("sales_tracker_rows")
    .select("sheet_row_key, manychat_link")
    .in("sheet_row_key", queue.map((q) => String(q.sale_key)));
  assert.equal(error, null);
  const byKey = new Map(
    ((data || []) as Array<{ sheet_row_key: string; manychat_link: string | null }>).map((t) => [t.sheet_row_key, t.manychat_link]),
  );
  for (const q of queue) {
    const expected = byKey.get(String(q.sale_key)) ?? null;
    assert.equal(q.manychat_link ?? null, expected, `${q.prospect}'s ManyChat link must match the tracker row exactly`);
  }
  assert.ok(Number(a.with_manychat_link) > 0, "at least some rows must carry a link, or the join has broken");
});

test("GOLDEN d3: the zero-cash oddities are split out but still counted", { skip }, async () => {
  const r = answerOf(
    await askQuestion({ question_key: "resolution_queue", params: { limit: 500 } }, { db: liveDb(), clients: [...CLIENTS], caller: "test" }),
  );
  const a = r.answers as Record<string, unknown>;
  const odd = a.zero_cash_oddities as Record<string, unknown>;
  const rows = odd.rows as Array<Record<string, unknown>>;
  assert.equal(rows.length, Number(odd.count));
  for (const row of rows) assert.equal(Number(row.cash_usd_cents), 0);
  // Split out for readability, never removed from the totals.
  assert.equal(Number(a.returned), (a.queue as unknown[]).length + rows.length);
});

// ─────────────────────────────────────────────────────────────────────────
// (e) capture_health.
//
// HONEST LIMIT, stated in the report as well as here: the spec asked the
// organic detector to find "the known historical LOCKED cases". It cannot, and
// no detector in this brick could, because those four sales carry ManyChat
// subscriber ids (9 to 10 digits) while the DM message store carries
// Instagram-scoped ids (16 digits). Measured: 1 id in common out of 7,585. The
// four LOCKED people have ZERO rows in dm_conversation_messages under their
// sale's subscriber id.
//
// What IS verifiable, and what these tests pin, is the break itself: the
// cohort detector reproduces the 2026-07-24 to 2026-08-03 organic outage that
// Alex found by hand on 8/02, and reports degraded rather than no_go once
// events resumed on 8/04 with misses still present.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN e0: worst() never lets an unhealthy pipe round up to go", () => {
  assert.equal(worst(["go", "go"]), "go");
  assert.equal(worst(["go", "degraded"]), "degraded");
  assert.equal(worst(["degraded", "no_go"]), "no_go");
  assert.equal(worst([]), "go");
});

test("GOLDEN e1: the organic detector reproduces the 7/24 to 8/03 outage", { skip }, async () => {
  const db = liveDb();
  const { data, error } = await db.rpc("door_capture_organic_breaks", {
    p_clients: [...CLIENTS],
    p_from: "2026-07-24",
    p_to: "2026-08-03",
  });
  assert.equal(error, null);
  const rows = (data || []) as Array<Record<string, unknown>>;
  const arrivals = rows.filter((r) => Number(r.dm_senders) > 0);
  assert.ok(arrivals.length > 0, "people did send organic keywords in this window");
  // EVERY one of those days recorded zero keyword events. That is the outage.
  for (const r of arrivals) {
    assert.equal(
      Number(r.keyword_events),
      0,
      `${r.client_key} ${r.keyword} on ${r.et_day} should show zero keyword events during the outage`,
    );
  }
});

test("GOLDEN e2: after the 8/04 recovery the pipe reads DEGRADED, not no_go", { skip }, async () => {
  // From 2026-08-04 the organic automation started recording events again, but
  // 2026-08-05 still shows a Tyson sender with no event. Events flowing plus
  // misses present is exactly the state that must NOT collapse into either
  // "healthy" or "down".
  const r = answerOf(
    await askQuestion(
      { question_key: "capture_health", params: { days: 4 } },
      { db: liveDb(), clients: [...CLIENTS], caller: "test", now: new Date("2026-08-06T12:00:00Z") },
    ),
  );
  const pipes = (r.answers as Record<string, unknown>).pipes as Array<Record<string, unknown>>;
  const organic = pipes.find((p) => p.pipe === "organic_automation");
  assert.ok(organic);
  assert.equal(organic.verdict, "degraded", `expected degraded, got ${organic.verdict}: ${organic.evidence}`);
  assert.match(String(organic.evidence), /running and dropping people rather than being down/);
});

test("GOLDEN e3: capture_health is a TRUST answer: no coverage block, and it says why", { skip }, async () => {
  const r = answerOf(
    await askQuestion({ question_key: "capture_health", params: {} }, { db: liveDb(), clients: [...CLIENTS], caller: "test" }),
  );
  assert.equal(r.receipt.coverage, null, "a question that reports no cash must not carry a coverage block");
  const a = r.answers as Record<string, unknown>;
  assert.ok(["go", "degraded", "no_go"].includes(String(a.overall)));
  const pipes = a.pipes as Array<Record<string, unknown>>;
  assert.equal(pipes.length, 5, "all five pipes must report, even the ones that are fine");
  for (const p of pipes) {
    assert.ok(String(p.evidence).length > 20, `${p.pipe} must state its evidence, not just a verdict`);
  }
  // The honest limit is declared on the receipt, not buried in prose.
  const exclusions = r.receipt.exclusions.map((e) => e.what).join(" | ");
  assert.match(exclusions, /naming the individual people/);
});

test("GOLDEN e4: the webhook-miss pipe finds the real lead_engaged gap", { skip }, async () => {
  const db = liveDb();
  const { data, error } = await db.rpc("door_capture_webhook_misses", {
    p_clients: [...CLIENTS],
    p_from: "2026-05-22",
    p_to: "2026-08-07",
    p_limit: 3,
  });
  assert.equal(error, null);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  assert.ok(Number(r.rows_with_subscriber) > 0);
  assert.ok(Number(r.rows_with_zero_events) > 0, "the lead_engaged gap is real and must be found");
  // The sample carries first names only. A health answer proves a miss is real;
  // it does not publish a contact list.
  for (const s of r.sample as Array<Record<string, unknown>>) {
    assert.ok(!String(s.first_name).includes(" "), "the sample must carry first names only");
  }
});

test("GOLDEN e5: the DM and keyword id spaces really are disjoint, which is why e1 is a cohort test", { skip }, async () => {
  // This test exists to pin the FINDING, so that if the identity bridge ever
  // lands and the spaces converge, this fails loudly and the cohort detector
  // can be upgraded to a per-person one.
  const db = liveDb();
  const { data, error } = await db
    .from("adsv2_sale_facts")
    .select("subscriber_id, prospect_name")
    .in("sale_key", LOCKED_WINS.map((w) => w.sale_key));
  assert.equal(error, null);
  const subs = ((data || []) as Array<{ subscriber_id: string | null }>).map((r) => r.subscriber_id).filter(Boolean);
  assert.equal(subs.length, 4);
  const { count } = await db
    .from("dm_conversation_messages")
    .select("id", { count: "exact", head: true })
    .in("subscriber_id", subs as string[]);
  assert.equal(
    count,
    0,
    "the four LOCKED sales have NO DM rows under their own subscriber id: the id spaces are disjoint, so a per-person organic detector is impossible before the identity bridge",
  );
});

// ─────────────────────────────────────────────────────────────────────────
// (g) NO BREAKAGE: the locked list grew by exactly three, and every new
//     question carries a receipt like every old one.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN g1: the locked list is exactly 25, and Brick 4's three are all still on it", () => {
  const keys = describeDoor().map((q) => q.question_key);
  // 17 when Brick 4 wrote this; 21 after Brick 6's funnel pack; 23 since Brick 5
  // added person_timeline and lead_quality_read; 25 since Brick 7 added ad_copy
  // and creative_bench. The count moves only when the list grows on purpose (a
  // reviewed registry.ts change admitted here out loud); what this test really
  // guards is that no earlier question vanishes.
  assert.equal(keys.length, 25);
  for (const k of ["coverage_report", "resolution_queue", "capture_health"]) {
    assert.ok(keys.includes(k), `${k} must be on the locked list`);
  }
  // Every question from Bricks 1 to 3 is still here, by name.
  for (const k of [
    "metric_value", "yesterday_summary", "change_history", "why_unattributed", "ad_setup",
    "person_lookup", "sales_cycle", "attribution_share", "leak_map", "kill_scale_inputs",
    "kill_scale_read", "health_check", "data_health", "define",
  ]) {
    assert.ok(keys.includes(k), `${k} must NOT have been dropped`);
  }
  // And Brick 6's four, so this test fails if the funnel pack is ever removed
  // as quietly as it was added.
  for (const k of ["creator_funnel", "portfolio_pace", "budget_map", "scale_headroom"]) {
    assert.ok(keys.includes(k), `${k} must be on the locked list`);
  }
});

test("GOLDEN g2: each new question is reachable ONLY through the door, and refuses junk params", { skip }, async () => {
  const db = liveDb();
  for (const key of ["coverage_report", "resolution_queue", "capture_health"]) {
    const r = await askQuestion(
      { question_key: key, params: { nonsense: 1 } },
      { db, clients: [...CLIENTS], caller: "test" },
    );
    assert.ok(isRefusal(r), `${key} must refuse a parameter it does not take`);
    assert.match(r.reason, /does not take nonsense/);
  }
});

test("GOLDEN g3: every new answer carries a receipt with a real window and a caller", { skip }, async () => {
  const db = liveDb();
  for (const key of ["coverage_report", "resolution_queue", "capture_health"]) {
    const r = answerOf(await askQuestion({ question_key: key, params: {} }, { db, clients: [...CLIENTS], caller: "test" }));
    assert.equal(r.receipt.contract_version, 2);
    assert.equal(r.receipt.question_key, key);
    assert.equal(r.receipt.caller, "test");
    assert.ok(r.receipt.caveats.length > 0, `${key} must carry at least one derived caveat`);
    assert.ok(r.sources.length > 0);
  }
});
