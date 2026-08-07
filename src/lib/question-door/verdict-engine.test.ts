// ─────────────────────────────────────────────────────────────────────────
// THE VERDICT FIXTURES: the 2026-07-31 kill review, pinned forever.
//
// These numbers were verified twice in a live session and survived an
// adversarial recheck. They are fed to the engine as FIXED INPUTS, which is the
// whole point: this file tests the LOGIC, and is immune to data drift. The
// tables can move all they like; if the engine ever stops calling a $1,204 ad
// with one booking a kill, this file says so.
//
// The ruleset here is CONSTRUCTED rather than loaded, because a pure function
// deserves a pure test. That the real thresholds come from the signed registry
// and are never hardcoded is a different law, pinned separately by the
// registry-threshold test in kill-scale.test.ts.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { verdictForAd, verdictForAdSet, ZAKK_VERDICTS, type AdVerdictInput, type Ruleset } from "./verdict-engine";

/** zakk_v1 with the values the signed registry actually carries today. */
const ZAKK: Ruleset = {
  key: "zakk_v1",
  definition: { name: "ruleset_zakk", version: 1 },
  components: ["verdict_floors_kill_tree", "scaling_ladder"],
  componentVersions: {
    verdict_floors_kill_tree: 1,
    scaling_ladder: 1,
    learning_phase_awareness: 1,
    touch_floor_72h: 1,
  },
  evidenceFloorUsdCents: 10_000,
  killRequiresExpectedBookings: 3,
  expectedBookingsRounding: "nearest",
  protectMinRoi: 3,
  kpiLineMinRoi: 2,
  minDaysBeforeVerdict: 7,
  minSignalAgeHours: 72,
  ladder: {
    launchDailyUsdCents: 5_000,
    bottomLadderUsdCents: [5_000, 10_000, 20_000],
    aboveThresholdUsdCents: 20_000,
    aboveThresholdStepPct: [20, 33],
    budgetIsFloorAtCashRoi: 2,
    stepCadence: "weekly",
  },
};

/** A mature ad with nothing unusual about it, so each fixture only has to state
 *  what makes IT different. */
function ad(over: Partial<AdVerdictInput>): AdVerdictInput {
  return {
    ad_id: "ad-x",
    keyword: "kw",
    adset_id: "adset-x",
    spend_usd_cents: 0,
    booked: 0,
    taken: 0,
    closes: 0,
    collected_usd_cents: 0,
    // The 2026-07-31 session's target cost per booked call.
    cost_per_call_target_usd_cents: 27_000,
    days_live: 30,
    reached_2x_history: false,
    fatigue: null,
    fresh_creative_tested: false,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// (a) THE HAND-VERIFIED 2026-07-31 REVIEW.
// ─────────────────────────────────────────────────────────────────────────

test("GOLDEN 2026-07-31: the Direct CTA roster is a KILL: the one that freed $50/day", () => {
  const v = verdictForAd(
    ad({ keyword: "direct_cta_roster", spend_usd_cents: 120_400, booked: 1, closes: 0, collected_usd_cents: 0 }),
    ZAKK,
  );
  assert.equal(v.verdict, "kill");
  assert.equal(v.under_ruleset, "zakk_v1");
  // $1,204 at a $270 target expected about 4.5 bookings and got 1.
  assert.equal(v.computed.expected_bookings_at_target, 4.46);
  assert.equal(v.computed.kill_eligible, true);
  assert.match(v.basis, /never-reached-2x branch/);
  assert.match(v.basis, /\$1,204\.00/);
});

test("GOLDEN 2026-07-31: FIT at 4.13x is PROTECT", () => {
  const v = verdictForAd(
    ad({ keyword: "fit", spend_usd_cents: 152_500, collected_usd_cents: 629_900, closes: 5, booked: 6, taken: 6 }),
    ZAKK,
  );
  assert.equal(v.verdict, "protect");
  assert.equal(v.computed.collected_roi, 4.13);
  assert.match(v.basis, /3x protect line/);
});

test("GOLDEN 2026-07-31: STRENGTH at 5.05x is PROTECT", () => {
  const v = verdictForAd(
    ad({ keyword: "strength", spend_usd_cents: 85_200, collected_usd_cents: 430_000, closes: 3, booked: 4, taken: 4 }),
    ZAKK,
  );
  assert.equal(v.verdict, "protect");
  assert.equal(v.computed.collected_roi, 5.05);
});

test("GOLDEN 2026-07-31: PRO at 2.93x sits on the KPI LINE, not in protect", () => {
  const v = verdictForAd(
    ad({ keyword: "pro", spend_usd_cents: 68_300, collected_usd_cents: 199_900, closes: 1, booked: 2, taken: 2 }),
    ZAKK,
  );
  assert.equal(v.verdict, "kpi_line");
  assert.equal(v.computed.collected_roi, 2.93);
  assert.match(v.basis, /between the 2x KPI line and the 3x protect line/);
});

test("GOLDEN 2026-07-31: a $40 ad is TOO EARLY: below the evidence floor, no verdict lands", () => {
  const v = verdictForAd(ad({ keyword: "summit", spend_usd_cents: 4_000 }), ZAKK);
  assert.equal(v.verdict, "too_early");
  assert.match(v.basis, /below the \$100\.00 evidence floor/);
  // The signed statement is explicit that below the floor the verdict is
  // "too-early" or "starved-untested", NEVER "failed". So the check is that no
  // failure verdict was reached, and that the answer says so in the signed
  // vocabulary rather than leaving the reader to infer it.
  assert.ok(!["kill", "lead_quality_kill", "fixable_relaunch"].includes(v.verdict));
  assert.match(v.basis, /never "failed"/);
});

test("GOLDEN 2026-07-31: a $685 ad with 0 bookings had a FAIR TEST, so it is kill-eligible, not starved", () => {
  const v = verdictForAd(ad({ keyword: "star", spend_usd_cents: 68_500, booked: 0 }), ZAKK);
  // $685 / $270 = 2.54 expected bookings, which "about 3" rounds to. This is
  // the fixture that pins the rounding: read the other way it would call a
  // fairly-tested ad "starved" and leave the money burning.
  assert.equal(v.computed.expected_bookings_at_target, 2.54);
  assert.equal(v.computed.kill_eligible, true);
  assert.notEqual(v.verdict, "starved_untested");
  assert.equal(v.verdict, "kill");
});

test("GOLDEN: Jake's 4-day-old test set is never a KILL: no data, no verdict", () => {
  const young = [
    ad({ keyword: "mission", spend_usd_cents: 5_000, days_live: 4 }),
    ad({ keyword: "captain", spend_usd_cents: 22_000, days_live: 4 }),
    ad({ keyword: "tempo", spend_usd_cents: 71_500, days_live: 4, booked: 0 }),
  ];
  for (const a of young) {
    const v = verdictForAd(a, ZAKK);
    assert.ok(
      v.verdict === "too_early" || v.verdict === "starved_untested",
      `${a.keyword} got ${v.verdict}, but a 4-day-old ad may only be too_early or starved_untested`,
    );
  }
  // Even the one with enough spend to be kill-eligible on paper is held back by
  // the learning-phase gate rather than judged at 4 days old.
  assert.match(verdictForAd(young[2], ZAKK).basis, /no verdict lands before 7 days/);
});

// ─────────────────────────────────────────────────────────────────────────
// THE KILL TREE'S OTHER BRANCHES.
// ─────────────────────────────────────────────────────────────────────────

test("a tired PROVEN winner is FIXABLE by relaunch, never a kill", () => {
  const v = verdictForAd(
    ad({
      keyword: "tired_winner",
      spend_usd_cents: 120_000,
      booked: 1,
      collected_usd_cents: 100_000,
      reached_2x_history: true,
      fatigue: { cost_per_result_rising: true, ctr_falling: true, sustained_hours: 72 },
    }),
    ZAKK,
  );
  assert.equal(v.verdict, "fixable_relaunch");
  assert.match(v.basis, /FIXABLE by relaunch or refresh, not a kill/);
});

test("fatigue younger than the 72 hour touch floor does NOT buy the fixable branch", () => {
  const v = verdictForAd(
    ad({
      keyword: "one_bad_day",
      spend_usd_cents: 120_000,
      booked: 1,
      collected_usd_cents: 100_000,
      reached_2x_history: true,
      fatigue: { cost_per_result_rising: true, ctr_falling: true, sustained_hours: 24 },
    }),
    ZAKK,
  );
  // touch_floor_72h v1: "one bad day is not fatigue".
  assert.notEqual(v.verdict, "fixable_relaunch");
});

test("cheap calls that never close is a LEAD QUALITY kill, named as such", () => {
  const v = verdictForAd(
    ad({ keyword: "cheap_but_dead", spend_usd_cents: 100_000, booked: 8, taken: 6, closes: 0 }),
    ZAKK,
  );
  assert.equal(v.verdict, "lead_quality_kill");
  assert.match(v.basis, /LEAD-QUALITY kill/);
});

test("a proven ad that is NOT fatiguing matches no signed branch, and is NOT defaulted to a kill", () => {
  // This is the case that caught a real defect during the build: an ad below
  // the line, with 2x history, not fatiguing, and no record of whether fresh
  // creative was tried, satisfies NO branch of the signed tree. Falling through
  // to KILL would be the "naked unfixable judgment call" the definition forbids.
  const v = verdictForAd(
    ad({
      keyword: "proven_but_quiet",
      spend_usd_cents: 86_120,
      booked: 0,
      closes: 0,
      reached_2x_history: true,
      fatigue: { cost_per_result_rising: true, ctr_falling: false, sustained_hours: 72 },
    }),
    ZAKK,
  );
  assert.equal(v.verdict, "tree_unresolved");
  assert.match(v.basis, /NOT being defaulted to a kill/);
  // It must say what would resolve it, or it is just a shrug.
  assert.match(v.basis, /has fresh creative already been tested/i);
});

test("fresh creative already tested, and still broken, IS a kill", () => {
  const v = verdictForAd(
    ad({ keyword: "tested_and_broken", spend_usd_cents: 120_000, booked: 1, reached_2x_history: true, fresh_creative_tested: true }),
    ZAKK,
  );
  assert.equal(v.verdict, "kill");
  assert.match(v.basis, /tested-creative branch/);
});

test("an ad whose age cannot be read is treated as young, never as mature", () => {
  // An unknown must never buy a kill.
  const v = verdictForAd(ad({ keyword: "unknown_age", spend_usd_cents: 120_000, days_live: null }), ZAKK);
  assert.equal(v.verdict, "starved_untested");
  assert.match(v.basis, /days live could not be read/);
});

// ─────────────────────────────────────────────────────────────────────────
// (a1) EVERY VERDICT IS STAMPED WITH ITS LENS.
// ─────────────────────────────────────────────────────────────────────────

test("every verdict the engine can reach carries under_ruleset and a basis", () => {
  const cases: AdVerdictInput[] = [
    ad({ spend_usd_cents: 4_000 }),
    ad({ spend_usd_cents: 120_000, days_live: 3 }),
    ad({ spend_usd_cents: 152_500, collected_usd_cents: 629_900, closes: 5 }),
    ad({ spend_usd_cents: 68_300, collected_usd_cents: 199_900, closes: 1 }),
    ad({ spend_usd_cents: 20_000 }),
    ad({ spend_usd_cents: 120_400, booked: 1 }),
    ad({ spend_usd_cents: 100_000, booked: 8, taken: 6, closes: 0 }),
    ad({
      spend_usd_cents: 120_000,
      booked: 1,
      reached_2x_history: true,
      fatigue: { cost_per_result_rising: true, ctr_falling: true, sustained_hours: 72 },
    }),
    ad({ spend_usd_cents: 120_000, booked: 1, reached_2x_history: true }),
  ];
  const seen = new Set<string>();
  for (const c of cases) {
    const v = verdictForAd(c, ZAKK);
    assert.equal(v.under_ruleset, "zakk_v1", "a verdict without its lens is a verdict pretending to be a fact");
    assert.ok(v.basis.length > 40, "a verdict with no basis is an opinion");
    assert.ok(v.definitions_applied.length > 0, "a verdict must name the definitions it applied");
    assert.ok((ZAKK_VERDICTS as readonly string[]).includes(v.verdict));
    seen.add(v.verdict);
  }
  // The cases above are chosen to reach every branch. If a future edit makes one
  // unreachable, this catches it rather than letting it rot.
  assert.equal(seen.size, ZAKK_VERDICTS.length, `only reached ${[...seen].join(", ")}`);
});

test("an unknown ruleset is never approximated with the rules of a known one", () => {
  assert.throws(
    () => verdictForAd(ad({ spend_usd_cents: 120_000 }), { ...ZAKK, key: "jeremy_v1" }),
    /no verdict branch exists/,
  );
});

// ─────────────────────────────────────────────────────────────────────────
// THE AD-SET ROLLUP.
// ─────────────────────────────────────────────────────────────────────────

const adset = (over: Parameters<typeof verdictForAdSet>[0] extends infer T ? Partial<T> : never) =>
  ({
    adset_id: "adset-1",
    adset_name_verbatim: "TEST · Direct CTA · 50",
    campaign_id: "camp-1",
    spend_usd_cents: 0,
    collected_usd_cents: 0,
    closes: 0,
    booked: 0,
    daily_budget_usd_cents: 5_000,
    budget_level: "adset" as const,
    ad_verdicts: [],
    sibling_active_adsets: 1,
    ...over,
  }) as Parameters<typeof verdictForAdSet>[0];

test("freed budget is claimed ONLY when every ad in the set is a kill", () => {
  const killed = verdictForAd(ad({ spend_usd_cents: 120_400, booked: 1 }), ZAKK);
  const kept = verdictForAd(ad({ spend_usd_cents: 152_500, collected_usd_cents: 629_900, closes: 5 }), ZAKK);

  const all = verdictForAdSet(adset({ ad_verdicts: [killed], daily_budget_usd_cents: 5_000 }), ZAKK);
  assert.equal(all.freed_usd_cents_per_day, 5_000);

  // The dial sits on the AD SET, so killing one ad of two frees nothing at all.
  // Reporting "$50/day freed" here would be a saving that never arrives.
  const some = verdictForAdSet(adset({ ad_verdicts: [killed, kept], daily_budget_usd_cents: 5_000 }), ZAKK);
  assert.equal(some.freed_usd_cents_per_day, null);
  assert.equal(some.verdict, "mixed");
});

test("killing the last live ad set warns that it takes the campaign with it", () => {
  const killed = verdictForAd(ad({ spend_usd_cents: 120_400, booked: 1 }), ZAKK);
  const last = verdictForAdSet(adset({ ad_verdicts: [killed], sibling_active_adsets: 0 }), ZAKK);
  assert.match(last.kill_kills_campaign_warning || "", /Killing it stops the campaign/);

  const notLast = verdictForAdSet(adset({ ad_verdicts: [killed], sibling_active_adsets: 2 }), ZAKK);
  assert.equal(notLast.kill_kills_campaign_warning, null);
});

test("the scaling ladder doubles at the bottom and steps 20-33% above $200/day", () => {
  const bottom = verdictForAdSet(
    adset({ spend_usd_cents: 100_000, collected_usd_cents: 400_000, daily_budget_usd_cents: 5_000 }),
    ZAKK,
  );
  assert.equal(bottom.scaling_headroom.eligible, true);
  assert.equal(bottom.scaling_headroom.next_step_usd_cents, 10_000);
  assert.match(bottom.scaling_headroom.basis, /DOUBLES by necessity/);
  assert.match(bottom.scaling_headroom.basis, /Never reactive mid-week/);

  const top = verdictForAdSet(
    adset({ spend_usd_cents: 100_000, collected_usd_cents: 400_000, daily_budget_usd_cents: 30_000 }),
    ZAKK,
  );
  assert.equal(top.scaling_headroom.next_step_usd_cents, 36_000); // +20%
  assert.match(top.scaling_headroom.basis, /saturation ceilings/);
});

test("no step is earned below the cash ROI at which budget becomes a floor", () => {
  const weak = verdictForAdSet(
    adset({ spend_usd_cents: 100_000, collected_usd_cents: 150_000, daily_budget_usd_cents: 5_000 }),
    ZAKK,
  );
  assert.equal(weak.scaling_headroom.eligible, false);
  assert.equal(weak.scaling_headroom.next_step_usd_cents, null);
});
