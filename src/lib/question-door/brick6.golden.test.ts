// ─────────────────────────────────────────────────────────────────────────
// BRICK 6 (the funnel pack): behaviour against constructed data, NUMBERS
// against the real database.
//
// The split is the same one Bricks 2, 3 and 4 use, for the same reason: a fake
// database is right for pinning BEHAVIOUR (does booked_vs_taken always print
// both? does a three-day-old dial get a step?) and useless for pinning NUMBERS,
// because a fake that returns what the code expects proves only that the code
// agrees with itself.
//
// THE GOLDEN NUMBERS were computed in SQL against the live database BY HAND,
// before this file existed, and are recorded in docs/truthlayer-brick6-report.md
// with the query that produced them. If one disagrees, either the data moved
// (recompute by hand, update the fixture, and SAY SO in the report) or a rule
// changed underneath us, which is exactly what a fixture exists to tell us.
//
// The live half SKIPS LOUDLY without credentials, so it can never pass by not
// running.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { askQuestion, describeDoor, describeMisses } from "./service";
import { resetReceiptCaches } from "./receipts";
import { __testables as headroomInternals } from "./scale-headroom";
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
const skip = LIVE ? false : "no database credentials in the environment, so the Brick 6 goldens were NOT checked";

function liveDb(): Db {
  return createClient(URL!, KEY!, { auth: { persistSession: false } }) as unknown as Db;
}

const CLIENTS = ["tyson", "jake"] as const;

function answerOf(r: unknown): DoorAnswer {
  assert.ok(!isRefusal(r as never), `expected an answer, got a refusal: ${JSON.stringify(r).slice(0, 500)}`);
  return r as DoorAnswer;
}

// ─────────────────────────────────────────────────────────────────────────
// THE CONSTRUCTED DATABASE, for the behaviour tests.
// ─────────────────────────────────────────────────────────────────────────

const DATA_VERSION = 400;

const SIGNED = [
  {
    name: "ruleset_zakk",
    version: 1,
    status: "signed",
    statement: "Ruleset zakk_v1 is the standing kill/scale lens.",
    details: {
      ruleset_key: "zakk_v1",
      components: ["verdict_floors_kill_tree", "scaling_ladder"],
      protect_min_collected_roi: 3,
      kpi_line_min_collected_roi: 2,
      cac_pct_of_ticket: 20,
      standard_ticket_price_book_key: "6mo_standard",
      expected_bookings_rounding: "nearest",
      close_rate_trailing_days: 90,
      close_rate_min_taken_calls: 20,
      cost_per_dm_baseline_days: 28,
      cost_per_dm_flag_multiple: 2,
      spend_pace_flag_pct: 25,
    },
  },
  {
    name: "verdict_floors_kill_tree",
    version: 1,
    status: "signed",
    statement: "Evidence floor, per ad: no verdict of any kind under $100 total spend on that ad.",
    details: { evidence_floor_cents: 10000, kill_requires_expected_bookings: 3 },
  },
  {
    name: "scaling_ladder",
    version: 1,
    status: "signed",
    statement: "Launch at $50/day. Steps are WEEKLY. Respect proven per-ad-set saturation ceilings.",
    details: {
      launch_daily_cents: 5000,
      bottom_ladder_cents: [5000, 10000, 20000],
      above_threshold_cents: 20000,
      above_threshold_step_pct: [20, 33],
      budget_is_floor_at_cash_roi: 2,
      step_cadence: "weekly",
      respect_saturation_ceilings: true,
      evidence: { fit_ceiling_daily_cents: 14000, june_over_scale: "12 sets / $1200 crushed book rate" },
    },
  },
  {
    name: "decision_cadence",
    version: 1,
    status: "signed",
    statement: "Watch daily, decide weekly on a trailing 14 days.",
    details: {
      decide_window_days: 14,
      watch_allowed_closers: ["monitor", "queued for weekly decide"],
      watch_forbidden_verbs: ["reduce", "pause", "kill", "scale", "increase"],
    },
  },
  { name: "daily_run_rate", version: 1, status: "signed", statement: "Last-7-day pace.", details: {} },
  { name: "touch_floor_72h", version: 1, status: "signed", statement: "72 hours sustained.", details: { min_signal_age_hours: 72 } },
  { name: "learning_phase_awareness", version: 1, status: "signed", statement: "No verdict before 7 days.", details: { min_days_before_verdict: 7 } },
  { name: "structure_rules", version: 1, status: "signed", statement: "Group by adset_id and ad_id.", details: {} },
  { name: "roi_window", version: 1, status: "signed", statement: "Same window both sides.", details: {} },
  {
    name: "sales_lag",
    version: 1,
    status: "signed",
    statement: "Sales lag is a median of 2 days and a p90 of 13 days.",
    details: { median_days: 2, p90_days: 13, lag_behind_spend_days: [5, 14] },
  },
  { name: "unit_economics", version: 1, status: "signed", statement: "Breakeven collected ROAS about 1.35.", details: {} },
  { name: "pricing_currency", version: 1, status: "signed", statement: "Revenue reports in USD.", details: {} },
  {
    name: "level_vs_trend",
    version: 1,
    status: "signed",
    statement:
      "Any pace or per-month claim must include the actual calendar month (month-to-date plus prior month) AND the weekly trend shape. A trailing window alone is never a level claim.",
    details: { level_requires: ["calendar_mtd", "prior_month"], trailing_window_alone_is_level_claim: false },
  },
  { name: "collected_vs_contracted", version: 1, status: "signed", statement: "Collected is money received.", details: {} },
  { name: "win_definition", version: 1, status: "signed", statement: "A win is a tracker row with outcome WIN.", details: {} },
];

/**
 * TWO AD SETS, BUILT SO BOOKED AND TAKEN DISAGREE IN BOTH DIRECTIONS.
 *
 * "divergent" reproduces the real Tyson shape: taken far exceeds booked,
 * because calls were booked off-calendar. "shortfall" is the opposite: more
 * bookings than taken calls, the ordinary no-show direction. One synthetic
 * dataset, both readings, so the answer is proven to tell the truth either way
 * rather than only in the direction the live data happens to run.
 */
function divergentLeaves() {
  const base = {
    client_key: "tyson",
    campaign_id: "camp-1",
    campaign_status: "ACTIVE",
    ad_status: "ACTIVE",
    impressions: 10_000,
    clicks: 100,
    upcoming: 0,
    taken_rows: 0,
    contracted_usd_cents: 0,
  };
  return [
    {
      ...base,
      keyword: "divergent",
      ad_id: "ad-divergent",
      ad_name: "DIVERGENT",
      adset_id: "adset-divergent",
      adset_name: "PROVEN - Warm Stack",
      spend_cents: 100_000,
      messages: 100,
      booked: 6,
      showed_people: 2,
      taken_people: 13,
      new_clients: 8,
      collected_usd_cents: 400_000,
    },
    {
      ...base,
      keyword: "shortfall",
      ad_id: "ad-shortfall",
      ad_name: "SHORTFALL",
      adset_id: "adset-shortfall",
      adset_name: "TEST - Direct CTA",
      spend_cents: 50_000,
      messages: 40,
      booked: 10,
      showed_people: 3,
      taken_people: 4,
      new_clients: 1,
      collected_usd_cents: 120_000,
    },
  ];
}

/**
 * Budget photos built to exercise the cadence gate at three ages, measured
 * against a fixed "today" of 2026-08-08.
 *
 *   adset-divergent : dial moved 2026-08-05, THREE days ago  -> blocked
 *   adset-shortfall : dial has never moved in the record     -> eligible
 *   adset-ceiling   : at the signed FIT ceiling of $140/day  -> blocked
 */
function budgetPhotos() {
  const rows: Array<Record<string, unknown>> = [];
  const push = (entity_id: string, entity_name: string, day: string, dial: number) =>
    rows.push({
      client_key: "tyson",
      entity_level: "adset",
      entity_id,
      entity_name,
      campaign_id: "camp-1",
      et_day: day,
      currency: "USD",
      daily_budget_cents: dial,
      daily_budget_usd_cents: dial,
      lifetime_budget_usd_cents: null,
      holds_budget: true,
      effective_status: "ACTIVE",
      synced_at: "2026-08-08T09:25:00Z",
    });

  // Raised from $100 to $200 on 2026-08-05: three days before "today".
  for (const d of ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04"]) {
    push("adset-divergent", "PROVEN - Warm Stack", d, 10_000);
  }
  for (const d of ["2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08"]) {
    push("adset-divergent", "PROVEN - Warm Stack", d, 20_000);
  }
  // Flat all record.
  for (const d of ["2026-08-01", "2026-08-04", "2026-08-08"]) {
    push("adset-shortfall", "TEST - Direct CTA", d, 5_000);
  }
  // Already at the ceiling, and flat, so ONLY the ceiling can block it.
  for (const d of ["2026-07-01", "2026-08-08"]) {
    push("adset-ceiling", "FIT - Warm Audience Stack (relaunch 7/21)", d, 14_000);
  }
  return rows;
}

function ceilingLeaf() {
  return {
    client_key: "tyson",
    keyword: "fit",
    ad_id: "ad-ceiling",
    ad_name: "FIT",
    campaign_id: "camp-1",
    campaign_name: "Camp",
    adset_id: "adset-ceiling",
    adset_name: "FIT - Warm Audience Stack (relaunch 7/21)",
    ad_status: "ACTIVE",
    campaign_status: "ACTIVE",
    spend_cents: 150_000,
    impressions: 10_000,
    clicks: 100,
    messages: 100,
    booked: 6,
    upcoming: 0,
    showed_people: 4,
    taken_rows: 6,
    taken_people: 6,
    new_clients: 6,
    collected_usd_cents: 900_000,
    contracted_usd_cents: 0,
  };
}

function fakeDb(opts: { leaves?: unknown[]; photos?: unknown[] } = {}): Db {
  const leaves = opts.leaves ?? divergentLeaves();
  const photos = opts.photos ?? budgetPhotos();

  const tables: Record<string, unknown[]> = {
    registry_entities: [{ canonical_key: "tyson" }, { canonical_key: "jake" }],
    registry_definitions_current: SIGNED,
    door_freshness_thresholds: [{ source: "adsv2_budget_snapshots", threshold_hours: 26, note: "the budget photos" }],
    adsv2_budget_snapshots: photos,
    ad_creative_copy: [],
    adsv2_sale_facts: [],
    ads_meta_insights_daily: [],
  };

  const rpcs: Record<string, unknown[]> = {
    adsv2_window_leaves: leaves,
    adsv2_budget_asof: [],
    question_door_ad_run_dates: [],
    question_door_definitions: [],
    question_door_freshness: [
      { source: "adsv2_sale_facts", last_written_at: "2026-08-08T05:00:00Z", note: "the stamped sale facts" },
    ],
    door_coverage_block: [
      {
        window_wins_total: 9,
        window_cash_usd_cents: 520_000,
        ad_wins: 9,
        ad_cash_usd_cents: 520_000,
        organic_wins: 0,
        organic_cash_usd_cents: 0,
        misc_chat_wins: 0,
        misc_chat_cash_usd_cents: 0,
        awaiting_wins: 0,
        awaiting_cash_usd_cents: 0,
        unassigned_awaiting_wins: 0,
        misc_chat_awaiting_overlap: 0,
      },
    ],
  };

  return {
    rpc(fn: string, args: unknown) {
      if (fn === "registry_resolve_entity") {
        const a = String((args as { p_alias?: string })?.p_alias ?? "").toLowerCase();
        return Promise.resolve({ data: ["tyson", "jake"].includes(a) ? a : null, error: null });
      }
      return Promise.resolve({ data: rpcs[fn] ?? [], error: null });
    },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit", "not"]) chain[m] = self;
      chain.insert = () => Promise.resolve({ data: null, error: null });
      chain.maybeSingle = () => {
        if (table === "adsv2_meta") return Promise.resolve({ data: { value: DATA_VERSION }, error: null });
        if (table === "registry_entities") return Promise.resolve({ data: { kind: "creator" }, error: null });
        if (table === "door_freshness_thresholds") {
          return Promise.resolve({ data: { source: "adsv2_budget_snapshots", threshold_hours: 26 }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      };
      chain.then = (resolve: (v: unknown) => void) => {
        if (table === "registry_entities") {
          resolve({
            data: [
              { canonical_key: "tyson", price_book: { "3mo": 120_000, "6mo_standard": 240_000 } },
              { canonical_key: "jake", price_book: { "3mo": 120_000, "6mo_standard": 240_000 } },
            ],
            error: null,
          });
          return;
        }
        resolve({ data: tables[table] ?? [], error: null });
      };
      return chain;
    },
  } as unknown as Db;
}

/** "Today" for every constructed test: 2026-08-08, so yesterday is 2026-08-07
 *  and the trailing fortnight is 2026-07-25 to 2026-08-07. */
const NOW = new Date("2026-08-08T12:00:00Z");

function ask(question_key: string, params: Record<string, unknown> = {}, opts: { leaves?: unknown[]; photos?: unknown[] } = {}) {
  resetReceiptCaches();
  return askQuestion(
    { question_key, params },
    { db: fakeDb(opts), clients: ["tyson"], caller: "test", now: NOW },
  );
}

// ─────────────────────────────────────────────────────────────────────────
// (b) creator_funnel PRINTS BOOKED AND TAKEN WITH THE GAP, BOTH DIRECTIONS.
// ─────────────────────────────────────────────────────────────────────────

test("(b) creator_funnel prints booked AND taken with the gap stated, when they diverge upward", async () => {
  const r = answerOf(await ask("creator_funnel", { client: "tyson" }));
  const body = r.answers as Record<string, unknown>;
  const total = (body.total as Record<string, unknown>).window as Record<string, unknown>;
  const bvt = total.booked_vs_taken as Record<string, unknown>;

  // Both counts present, neither standing in for the other.
  assert.equal(bvt.booked, 16, "booked = 6 + 10 across the two ad sets");
  assert.equal(bvt.taken, 17, "taken = 13 + 4 across the two ad sets");
  assert.equal(bvt.gap, 1);

  // The stages carry them separately too, so a reader never has to infer one.
  const stages = total.stages as Record<string, number>;
  assert.equal(stages.booked, 16);
  assert.equal(stages.taken, 17);
  assert.ok(stages.shown === 5, "shown is its own count, not derived from taken");

  // And the divergence is EXPLAINED in words, not left as two numbers.
  assert.match(String(bvt.reading), /EXCEEDS/);
  assert.match(String(bvt.reading), /pinned sales-calendar|off-calendar/);
  assert.match(String(bvt.reading), /FLOOR/);
});

test("(b) the per-ad-set shapes diverge in BOTH directions and each is read truthfully", async () => {
  // One creator whose leaves are only the upward-divergent ad set.
  const up = answerOf(await ask("creator_funnel", { client: "tyson" }, { leaves: [divergentLeaves()[0]] }));
  const upBvt = ((up.answers as Record<string, unknown>).total as Record<string, unknown>);
  const upWin = (upBvt.window as Record<string, unknown>).booked_vs_taken as Record<string, unknown>;
  assert.equal(upWin.booked, 6);
  assert.equal(upWin.taken, 13);
  assert.match(String(upWin.reading), /EXCEEDS/, "taken over booked must read as the off-calendar case");

  // And only the shortfall ad set, which runs the ordinary way.
  const down = answerOf(await ask("creator_funnel", { client: "tyson" }, { leaves: [divergentLeaves()[1]] }));
  const downWin = (((down.answers as Record<string, unknown>).total as Record<string, unknown>).window as Record<string, unknown>)
    .booked_vs_taken as Record<string, unknown>;
  assert.equal(downWin.booked, 10);
  assert.equal(downWin.taken, 4);
  assert.match(String(downWin.reading), /expected direction/, "booked over taken is the no-show case, not an anomaly");
});

test("(b) creator_funnel never derives a show rate by dividing taken by booked", async () => {
  const r = answerOf(await ask("creator_funnel", { client: "tyson" }));
  const total = ((r.answers as Record<string, unknown>).total as Record<string, unknown>).window as Record<string, unknown>;
  const rates = total.stage_rates as Record<string, number | null>;
  const stages = total.stages as Record<string, number>;

  // taken/booked would be 17/16 = 1.06, a show rate above 100%: meaningless.
  const naive = stages.taken / stages.booked;
  assert.ok(naive > 1, "the fixture is built so the naive ratio exceeds 1");
  assert.notEqual(rates.booked_to_shown, naive);
  // The real rate is the cohort-true one: shown / (booked - upcoming) = 5/16.
  assert.equal(rates.booked_to_shown, Math.round((5 / 16) * 10000) / 10000);
  assert.ok((rates.booked_to_shown ?? 0) <= 1, "a show rate can never exceed 1");
});

// ─────────────────────────────────────────────────────────────────────────
// (c) portfolio_pace REFUSES TO PRESENT A TRAILING EXTRAPOLATION AS THE LEVEL.
// ─────────────────────────────────────────────────────────────────────────

test("(c) portfolio_pace keeps the extrapolation OUT of the level and labels it", async () => {
  const r = answerOf(await ask("portfolio_pace", { client: "tyson" }));
  const body = r.answers as Record<string, unknown>;
  const total = body.total as Record<string, unknown>;
  const level = total.level as Record<string, unknown>;
  const trend = total.trend as Record<string, unknown>;

  // The LEVEL is calendar only. Both entries are real calendar periods, and
  // there is no projection field anywhere inside the level block.
  const levelJson = JSON.stringify(level);
  assert.ok(!/if_this_pace_held/.test(levelJson), "an extrapolation must never appear inside the level");
  assert.ok(!/trend_line/.test(levelJson), "the trend line must never appear inside the level");
  const mtd = level.month_to_date as Record<string, unknown>;
  const priorMonth = level.prior_full_month as Record<string, unknown>;
  assert.equal(mtd.from, "2026-08-01", "month to date starts on the 1st, not 30 days ago");
  assert.equal(mtd.to, "2026-08-07");
  assert.equal(priorMonth.from, "2026-07-01");
  assert.equal(priorMonth.to, "2026-07-31");
  assert.equal(priorMonth.complete, true);
  assert.equal(mtd.complete, false);

  // The extrapolation EXISTS, lives in the trend, and says what it is not.
  const line = trend.trend_line as Record<string, unknown>;
  assert.equal(line.is_level_claim, false, "the trend line must declare it is not a level");
  assert.match(String(line.label), /NOT A LEVEL/);
  assert.match(String(line.what_this_is_not), /never be reported as the level/);
  assert.ok(line.if_this_pace_held_for_a_full_month, "the projection is offered, just never as the level");

  // The weekly shape ships with it, always: a blend without its shape is the
  // 8/8 failure this question exists to prevent.
  const weekly = trend.weekly as unknown[];
  assert.equal(weekly.length, 8, "eight trailing weeks by default");
  for (const w of weekly as Array<Record<string, unknown>>) {
    assert.ok("blended_collected_roi" in w, "every bucket carries its own blend");
    assert.ok("cash_still_landing" in w, "every bucket says whether its cash is still arriving");
  }
  assert.match(String(total.blend_warning), /blend can hide its own tail/);

  // And the sales-lag rule is quoted on the current week, from the registry.
  assert.match(String(body.current_week_caveat), /sales_lag v1/);
  assert.match(String(body.current_week_caveat), /never a reason to kill/);
});

test("(c) portfolio_pace month figures tie to a direct sum of the same leaves", async () => {
  // The tie-out check: rebuild the month figure from the leaves by hand and
  // require the answer to match it exactly. The fake returns the same leaf set
  // for every window, so the expected month total is simply that set's sum.
  const leaves = divergentLeaves();
  const expectedSpend = leaves.reduce((s, l) => s + l.spend_cents, 0);
  const expectedCash = leaves.reduce((s, l) => s + l.collected_usd_cents, 0);

  const r = answerOf(await ask("portfolio_pace", { client: "tyson" }));
  const level = ((r.answers as Record<string, unknown>).total as Record<string, unknown>).level as Record<string, unknown>;
  const mtd = level.month_to_date as Record<string, unknown>;

  assert.equal(mtd.spend_usd_cents, expectedSpend, "month-to-date spend must equal the summed leaves");
  assert.equal(mtd.collected_usd_cents, expectedCash, "month-to-date cash must equal the summed leaves");
  // And the blend is the quotient of those two sums, not an average of ratios.
  assert.equal(mtd.blended_collected_roi, Math.round((expectedCash / expectedSpend) * 100) / 100);
});

// ─────────────────────────────────────────────────────────────────────────
// (d) scale_headroom: THE CADENCE GATE, THE CEILING, AND THE STAMP.
// ─────────────────────────────────────────────────────────────────────────

test("(d) an ad set whose dial moved THREE days ago gets NO step", async () => {
  const r = answerOf(await ask("scale_headroom", { client: "tyson" }));
  const body = r.answers as Record<string, unknown>;
  const sets = body.ad_sets as Array<Record<string, unknown>>;

  const divergent = sets.find((s) => s.adset_id === "adset-divergent");
  assert.ok(divergent, "the 4x-ROI ad set must be in the read at all");
  assert.equal(divergent!.days_since_dial_change, 3, "the fixture pins the dial change at three days old");
  assert.equal(divergent!.step_emitted, false, "a dial three days old must not earn a step today");
  assert.equal(divergent!.recommended_daily_usd_cents, null, "no step means no number to act on");
  assert.deepEqual(divergent!.blocked_by, ["weekly_cadence"]);
  assert.equal(divergent!.earliest_step_day, "2026-08-12", "seven days after the 5th");

  // The ENGINE still says it earned one: the gate is this question's, and the
  // engine's opinion is reported rather than hidden, so the reader sees both
  // "it deserves more" and "not yet".
  // $200/day is AT the ladder's above-threshold mark, so the rung is +20%,
  // which is $240/day. Not a doubling: the bottom of the ladder ends at $200.
  assert.equal(divergent!.engine_next_step_usd_cents, 24_000, "the engine's own step is $240/day");
  assert.match(String(divergent!.basis), /never reactive mid-week/);
});

test("(d) a flat dial with adequate ROI DOES earn its step, so the gate is not just always-off", async () => {
  const r = answerOf(await ask("scale_headroom", { client: "tyson" }));
  const sets = (r.answers as Record<string, unknown>).ad_sets as Array<Record<string, unknown>>;
  const shortfall = sets.find((s) => s.adset_id === "adset-shortfall");
  assert.ok(shortfall, "the flat-dial ad set must be present");
  assert.equal(shortfall!.step_emitted, true, "a dial that has not moved in the record is eligible");
  assert.equal(shortfall!.current_daily_usd_cents, 5_000);
  assert.equal(shortfall!.recommended_daily_usd_cents, 10_000, "the bottom of the ladder DOUBLES: $50 to $100");
  assert.deepEqual(shortfall!.blocked_by, []);
  // And it admits how far back "no change observed" actually reaches.
  assert.equal(shortfall!.last_dial_change_day, null);
  assert.match(String(shortfall!.basis), /stored budget photos, which start/);
});

test("(d) FIT respects its registry saturation ceiling and earns nothing above it", async () => {
  const r = answerOf(
    await ask("scale_headroom", { client: "tyson" }, { leaves: [ceilingLeaf()] }),
  );
  const body = r.answers as Record<string, unknown>;
  const sets = body.ad_sets as Array<Record<string, unknown>>;
  const fit = sets.find((s) => s.adset_id === "adset-ceiling");

  assert.ok(fit, "FIT is at 6x ROI, so the engine must consider it");
  assert.equal(fit!.current_daily_usd_cents, 14_000, "$140/day");
  assert.equal(fit!.saturation_ceiling_usd_cents, 14_000, "the ceiling comes from the signed ladder");
  assert.equal(fit!.step_emitted, false, "at the ceiling, a good ROI does not earn more budget");
  assert.equal(fit!.recommended_daily_usd_cents, null);
  assert.deepEqual(fit!.blocked_by, ["saturation_ceiling"]);
  assert.match(String(fit!.basis), /saturation ceiling of \$140\.00\/day/);
  assert.match(String(fit!.basis), /stop converting/);

  // The ceiling is reported as read from the registry, not asserted.
  const known = body.saturation_ceilings_known as Array<Record<string, unknown>>;
  assert.ok(known.some((c) => c.token === "fit" && c.daily_usd_cents === 14_000));
});

test("(d) every scale_headroom recommendation carries under_ruleset and a basis", async () => {
  const r = answerOf(await ask("scale_headroom", { client: "tyson" }));
  const body = r.answers as Record<string, unknown>;
  assert.equal(body.under_ruleset, "zakk_v1");
  const sets = body.ad_sets as Array<Record<string, unknown>>;
  assert.ok(sets.length > 0);
  for (const s of sets) {
    assert.equal(s.under_ruleset, "zakk_v1", "a step without its lens reads as a fact");
    assert.ok(String(s.basis).length > 60, `basis too thin to audit: ${s.basis}`);
    assert.ok(String(s.ladder_position).includes("scaling_ladder"), "the ladder position must cite the ladder");
  }
  // The portfolio arithmetic counts ONLY the steps available today.
  const totals = body.if_every_earned_step_is_taken as Record<string, number | string>;
  assert.equal(totals.steps_available_today, 1, "only the flat-dial set may step today");
  assert.equal(totals.added_daily_usd_cents, 5_000, "$50 to $100 adds $50/day");
});

test("(d) scale_headroom refuses rather than guessing when the ladder is unsigned", async () => {
  resetReceiptCaches();
  const db = fakeDb();
  // Withhold the ladder by swapping the definitions the fake returns.
  const withheld = SIGNED.filter((d) => d.name !== "scaling_ladder");
  const patched = {
    ...db,
    from(table: string) {
      if (table === "registry_definitions_current") {
        const chain: Record<string, unknown> = {};
        const self = () => chain;
        for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit", "not"]) chain[m] = self;
        chain.then = (resolve: (v: unknown) => void) => resolve({ data: withheld, error: null });
        return chain;
      }
      return (db as unknown as { from(t: string): unknown }).from(table);
    },
  } as unknown as Db;

  const r = await askQuestion(
    { question_key: "scale_headroom", params: { client: "tyson" } },
    { db: patched, clients: ["tyson"], caller: "test", now: NOW },
  );
  const body = answerOf(r).answers as Record<string, unknown>;
  assert.equal(body.answered, false, "an unsigned ladder must not produce a confident recommendation");
  const cannot = body.cannot_answer as Record<string, unknown>;
  assert.ok((cannot.missing as string[]).includes("scaling_ladder"));
  assert.equal(answerOf(r).receipt.certainty, "cannot_answer");
});

// ─────────────────────────────────────────────────────────────────────────
// The ceiling parser, pinned directly.
// ─────────────────────────────────────────────────────────────────────────

test("(d) the ceiling parser reads the registry shape and matches only leading words", () => {
  const ceilings = headroomInternals.ceilingsFromLadder({
    evidence: { fit_ceiling_daily_cents: 14000, june_over_scale: "not a ceiling" },
  });
  assert.equal(ceilings.size, 1);
  assert.equal(ceilings.get("fit")!.daily_usd_cents, 14000);

  // Matches the real ad set name.
  assert.ok(headroomInternals.ceilingFor("FIT - Warm Audience Stack (relaunch 7/21)", ceilings));
  // And does NOT match a name that merely contains the token elsewhere, which
  // is the whole risk of matching on names at all.
  assert.equal(headroomInternals.ceilingFor("TEST - Fitness - Direct CTA", ceilings), null);
  assert.equal(headroomInternals.ceilingFor("Warm Stack FIT", ceilings), null);
  assert.equal(headroomInternals.ceilingFor(null, ceilings), null);
});

// ─────────────────────────────────────────────────────────────────────────
// budget_map behaviour: the flex band and the totals.
// ─────────────────────────────────────────────────────────────────────────

test("budget_map reconciles each dial to yesterday's spend inside Meta's 25% flex", async () => {
  const r = answerOf(await ask("budget_map", { client: "tyson" }));
  const body = r.answers as Record<string, unknown>;
  const entities = body.entities as Array<Record<string, unknown>>;

  // Three live dials in the photo fixture: $200, $50, $140 = $390/day.
  assert.equal(body.total_daily_usd_cents, 39_000);
  assert.equal(entities.length, 3);

  // adset-divergent holds $200/day and spent $100,000 cents yesterday in the
  // leaf fixture, which is 50% of its dial: outside the flex band, so flagged.
  const divergent = entities.find((e) => e.entity_id === "adset-divergent")!;
  assert.equal(divergent.daily_usd_cents, 20_000);
  assert.equal(divergent.pace_pct_of_dial, 500);
  assert.equal(divergent.reconciliation, "over_daily_flex");
  assert.equal(divergent.flagged, true);

  // The ceiling ad set has a dial but no spend in this leaf set at all.
  const ceiling = entities.find((e) => e.entity_id === "adset-ceiling")!;
  assert.equal(ceiling.yesterday_spend_usd_cents, 0);
  assert.equal(ceiling.reconciliation, "zero_delivery");
  assert.equal(ceiling.flagged, true);

  // Verbatim names are carried for eyeball reconciliation to Ads Manager.
  assert.equal(ceiling.entity_name_verbatim, "FIT - Warm Audience Stack (relaunch 7/21)");
  // And the rule states plainly that the 25% is Meta's, not the owner's.
  assert.match(String(body.reconciliation_rule), /Meta's documented platform behaviour, NOT an owner-signed threshold/);
  // It says out loud that it is not the live read.
  assert.match(String(body.what_this_is_not), /health_check/);
});

// ─────────────────────────────────────────────────────────────────────────
// (f) THE CALLER TAG. A chat-tagged ask must reach the receipt as `chat`.
// ─────────────────────────────────────────────────────────────────────────

test("(f) the caller travels from the ask onto the receipt", async () => {
  resetReceiptCaches();
  const r = answerOf(
    await askQuestion(
      { question_key: "budget_map", params: { client: "tyson" } },
      { db: fakeDb(), clients: ["tyson"], caller: "chat", now: NOW },
    ),
  );
  assert.equal(r.receipt.caller, "chat", "a chat ask must be distinguishable from a utari ask");
});

test("(f) the MCP route sanitises X-Door-Caller and defaults to utari", async () => {
  const { callerFrom } = await import("@/app/api/mcp/utari/route");
  const withHeader = (v: string | null) =>
    callerFrom({ headers: { get: (k: string) => (k === "x-door-caller" && v !== null ? v : null) } } as never);

  assert.equal(withHeader("chat"), "chat");
  assert.equal(withHeader("worker"), "worker");
  assert.equal(withHeader("UTARI"), "utari", "case is normalised");
  assert.equal(withHeader(null), "utari", "no header keeps every existing client's behaviour");
  assert.equal(withHeader(""), "utari");
  // A value that cannot be a clean log row falls back rather than being written
  // through: this names a caller, and it is going into the database.
  assert.equal(withHeader("'; drop table door_ask_log; --"), "droptabledoor_ask_log--");
  assert.equal(withHeader("!!!"), "utari");
  assert.equal(withHeader("x".repeat(200)).length, 32, "capped, never unbounded");
});

// ─────────────────────────────────────────────────────────────────────────
// THE LOCKED LIST grew by exactly four, and every new entry is well formed.
// ─────────────────────────────────────────────────────────────────────────

test("the four new questions are on the locked list with real params and sources", () => {
  const entries = describeDoor();
  const keys = entries.map((q) => q.question_key);
  for (const k of ["creator_funnel", "portfolio_pace", "budget_map", "scale_headroom"]) {
    assert.ok(keys.includes(k), `${k} must be on the locked list`);
    const e = entries.find((q) => q.question_key === k)!;
    assert.ok(e.description.length > 60, `${k} needs a description a non-technical reader can use`);
    assert.ok(e.params.length > 10, `${k} must document its parameters`);
    assert.ok(e.sources.length > 0, `${k} must name the stored places it reads`);
    assert.equal(e.question_version, 1);
  }
});

test("each new question refuses a parameter it does not take", async () => {
  for (const key of ["creator_funnel", "portfolio_pace", "budget_map", "scale_headroom"]) {
    const r = await ask(key, { nonsense: 1 });
    assert.ok(isRefusal(r), `${key} must refuse an unknown parameter`);
    assert.match((r as { reason: string }).reason, /does not take nonsense/);
  }
});

test("every new answer carries a contract-2 receipt", async () => {
  for (const key of ["creator_funnel", "portfolio_pace", "budget_map", "scale_headroom"]) {
    const r = answerOf(await ask(key, { client: "tyson" }));
    assert.equal(r.receipt.contract_version, 2, `${key} must carry a contract-2 receipt`);
    assert.equal(r.receipt.question_key, key);
    assert.equal(r.receipt.caller, "test");
    assert.ok(r.receipt.caveats.length > 0, `${key} must carry at least one derived caveat`);
    assert.ok(r.sources.length > 0);
    assert.ok(r.receipt.window, `${key} must state the window it landed on`);
  }
});

test("the three money answers carry a coverage block, and budget_map correctly does not", async () => {
  for (const key of ["creator_funnel", "portfolio_pace", "scale_headroom"]) {
    const r = answerOf(await ask(key, { client: "tyson" }));
    assert.ok(r.receipt.coverage, `${key} reports cash, so it MUST state what it covered`);
  }
  const bm = answerOf(await ask("budget_map", { client: "tyson" }));
  assert.equal(bm.receipt.coverage, null, "budget_map reports dials and spend, never sale cash, so it has no wins to bucket");
});

// ─────────────────────────────────────────────────────────────────────────
// (a) THE GOLDEN NUMBERS, against the REAL database.
// ─────────────────────────────────────────────────────────────────────────

/** Hand-verified in SQL on 2026-08-08 against adsv2_window_leaves for tyson
 *  over 2026-07-25..2026-08-07 (the trailing fortnight ending yesterday). */
const GOLDEN_LEAVES = {
  fit: { spend_cents: 166_169, messages: 115, booked: 6, taken_people: 13, new_clients: 8, collected_usd_cents: 989_900 },
  pro: { spend_cents: 136_782, messages: 68, booked: 2, taken_people: 5, new_clients: 3, collected_usd_cents: 559_900 },
} as const;

test("GOLDEN a1: the fit and pro leaves still match the hand-verified 8/8 numbers", { skip }, async () => {
  const db = liveDb();
  const { data, error } = await db.rpc("adsv2_window_leaves", {
    p_clients: ["tyson"],
    p_from: "2026-07-25",
    p_to: "2026-08-07",
    p_currency: { tyson: "USD" },
  });
  assert.equal(error, null);
  const rows = (data || []) as Array<Record<string, unknown>>;
  for (const [keyword, expected] of Object.entries(GOLDEN_LEAVES)) {
    const row = rows.find((r) => String(r.keyword) === keyword);
    assert.ok(row, `${keyword} must still be in the trailing fortnight`);
    for (const [field, want] of Object.entries(expected)) {
      assert.equal(
        Number(row![field]),
        want,
        `${keyword}.${field} drifted: the fixture says ${want}, the database says ${row![field]}. Recompute BY HAND and update the fixture in this file AND in docs/truthlayer-brick6-report.md.`,
      );
    }
  }
});

/** Hand-verified in SQL on 2026-08-08: the live dials for tyson. */
// Re-pinned 2026-08-11 from $440.00. Both halves of the change are real
// decisions, and the arithmetic is written out because the number asked for and
// the number pinned are not the same, which needs explaining rather than hiding.
//
//   $440  the map as pinned on 8 August
//   -$100 "TEST · Direct CTA · 10 (vet ICP 8/7)" killed, confirmed by Alex
//   =$340 the total Alex asked for, and it was correct when he asked
//   +$50  "TEST · Link Click · 1 (warm stack 8/11)" launched on 11 August
//   =$390 the total the live map actually reports now
//
// Verified by hand against the 2026-08-11 budget photo, four dials, rather than
// copied from whatever the test happened to print.
//
// One thing to know about this test: it asserts a LIVE budget total, so it fails
// every time a dial moves. It has now moved three times in four days
// ($600, $440, $390). Re-pinning does not fix that; only changing what this test
// asserts would.
//
// Separately, the old number had been propped up by a stale photo. There were no
// budget rows at all for 9 or 10 August, because a ghost Vercel project was
// running the sync without Meta tokens. That project is paused and photos refresh
// again, which is why the map moved as soon as it did.
const GOLDEN_BUDGET_MAP = [
  { name: "FIT - Warm Audience Stack (relaunch 7/21)", daily_usd_cents: 14_000 },
  { name: "7/1 - SCALE - Revived Winners", daily_usd_cents: 10_000 },
  { name: "TEST · Lead Magnet · 50 (6/24)", daily_usd_cents: 10_000 },
  { name: "TEST · Link Click · 1 (warm stack 8/11)", daily_usd_cents: 5_000 },
];
const GOLDEN_BUDGET_TOTAL = 39_000;

test("GOLDEN a2: budget_map reproduces the hand-verified map of $390/day", { skip }, async () => {
  const db = liveDb();
  const r = answerOf(
    await askQuestion(
      { question_key: "budget_map", params: { client: "tyson" } },
      { db, clients: [...CLIENTS], caller: "test" },
    ),
  );
  const body = r.answers as Record<string, unknown>;
  const entities = (body.entities as Array<Record<string, unknown>>).filter((e) => e.client === "tyson");

  assert.equal(
    body.total_daily_usd_cents,
    GOLDEN_BUDGET_TOTAL,
    `the total daily dial drifted from the hand-verified $390.00/day. Recompute BY HAND and update the fixture, saying so in the report.`,
  );
  assert.equal(entities.length, GOLDEN_BUDGET_MAP.length);
  for (const want of GOLDEN_BUDGET_MAP) {
    const got = entities.find((e) => e.entity_name_verbatim === want.name);
    assert.ok(got, `${want.name} is missing from the budget map`);
    assert.equal(got!.daily_usd_cents, want.daily_usd_cents, `${want.name} dial drifted`);
  }
});

test("GOLDEN a3: creator_funnel over the same window reproduces the leaf totals", { skip }, async () => {
  const db = liveDb();
  const r = answerOf(
    await askQuestion(
      { question_key: "creator_funnel", params: { client: "tyson", date_from: "2026-07-25", date_to: "2026-08-07" } },
      { db, clients: [...CLIENTS], caller: "test" },
    ),
  );
  const body = r.answers as Record<string, unknown>;
  const total = (body.total as Record<string, unknown>).window as Record<string, unknown>;
  const stages = total.stages as Record<string, number>;

  // The funnel is over ALL of Tyson's keywords, so it must be at least the sum
  // of the two golden ones: an assertion that stays true as other keywords move
  // but fails loudly if the certified read stops seeing fit or pro at all.
  const floorSpend = GOLDEN_LEAVES.fit.spend_cents + GOLDEN_LEAVES.pro.spend_cents;
  const floorCash = GOLDEN_LEAVES.fit.collected_usd_cents + GOLDEN_LEAVES.pro.collected_usd_cents;
  assert.ok(stages.spend_usd_cents >= floorSpend, `funnel spend ${stages.spend_usd_cents} is below fit+pro ${floorSpend}`);
  assert.ok(stages.collected_usd_cents >= floorCash, `funnel cash ${stages.collected_usd_cents} is below fit+pro ${floorCash}`);

  // The 8/5 law holds on the real data: Tyson's taken exceeds his booked.
  const bvt = total.booked_vs_taken as Record<string, number | string>;
  assert.equal(bvt.gap, Number(bvt.taken) - Number(bvt.booked));
  assert.ok(String(bvt.reading).length > 80, "the gap must always be explained in words");
});

// ─────────────────────────────────────────────────────────────────────────
// (e) describe_misses RETURNS THE MANUAL ROWS LOGGED ON 8/8, GROUPED.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN e1: describe_misses groups and counts the manual 8/8 rows", { skip }, async () => {
  const db = liveDb();
  const out = await describeMisses(50, { db });

  assert.ok(out.misses.length > 0, "the miss log is not empty, so the backlog must not be either");
  assert.match(out.note, /certification backlog/);

  // The three questions answered by hand in chat on 2026-08-08, logged
  // deliberately so freestyle work leaves a trace.
  const manual = out.misses.filter((m) => m.callers.includes("fable_chat_manual"));
  assert.equal(manual.length, 3, `expected the 3 manual 8/8 rows, got ${manual.length}`);
  for (const m of manual) {
    assert.ok(m.times_asked >= 1);
    assert.ok(m.last_asked_at.startsWith("2026-08-08"), `manual row is not from 8/8: ${m.last_asked_at}`);
    assert.ok(m.last_reason.length > 20, "a logged miss must say why it could not be answered");
  }
  // Grouped by NORMALISED asked-text with counts, which is what makes the
  // backlog orderable rather than a raw event log.
  const repeated = out.misses.find((m) => m.times_asked > 1);
  assert.ok(repeated, "the backlog must be grouped: repeated asks collapse into one row with a count");
});
