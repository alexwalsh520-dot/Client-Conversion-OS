// ─────────────────────────────────────────────────────────────────────────
// THE VERDICT ENGINE (Brick 3). A PURE function, and deliberately nothing else.
//
// THE ARCHITECTURAL LAW THIS FILE EXISTS TO SERVE (Alex, 2026-08-05):
//   "I want to give this to Jeremy AI and let it make decisions differently
//    than I have... I want the decision rules to evolve."
//
// So the facts are certified and judgment is a PLUGGABLE LENS. kill_scale_read's
// facts mode returns the decision inputs with no verdicts at all; decide mode
// runs those same inputs through a NAMED, VERSIONED ruleset, and every verdict
// it returns is stamped with the ruleset that produced it. A verdict is advice
// under a lens. The facts are the truth.
//
// Two rules govern everything below:
//
//   1. NO THRESHOLD IS WRITTEN IN THIS FILE. Every number applied here arrives
//      in the `Ruleset` argument, which rulesets.ts reads from the signed
//      registry_definitions rows. Hardcoding a threshold that exists in the
//      registry is a build failure, because a rule the owner can change by
//      signing a new definition must not also live in a deploy.
//
//   2. EVERY VERDICT CARRIES ITS BASIS: the definition names and the actual
//      numbers that earned it. A verdict a reader cannot audit back to a signed
//      sentence is an opinion wearing a verdict's clothes.
//
// This file has no database access, no clock, and no I/O. That is what lets the
// unit fixtures pin the LOGIC with fixed inputs, immune to data drift: the
// 2026-07-31 kill review reproduces here forever, whatever the tables do next.
// ─────────────────────────────────────────────────────────────────────────

/** The verdicts ruleset zakk_v1 can reach. Named in one place so the facts-mode
 *  purity test can scan for every one of them and prove none leaked. */
export const ZAKK_VERDICTS = [
  "protect",
  "kpi_line",
  "kill",
  "fixable_relaunch",
  "lead_quality_kill",
  "starved_untested",
  "too_early",
  "tree_unresolved",
] as const;

export type Verdict = (typeof ZAKK_VERDICTS)[number];

/**
 * One ruleset, assembled from signed definitions. Every field is a number the
 * owner signed, not one this code chose.
 */
export interface Ruleset {
  /** The name a verdict is stamped with, e.g. "zakk_v1". */
  key: string;
  /** The registry definition (name + version) this ruleset itself came from. */
  definition: { name: string; version: number };
  /** The signed definitions this ruleset composes, for definitions_cited. */
  components: readonly string[];
  /** The real version of each component definition, so a basis string cites the
   *  version actually applied rather than assuming v1 forever. */
  componentVersions: Readonly<Record<string, number>>;
  /** verdict_floors_kill_tree: no verdict at all below this total ad spend. */
  evidenceFloorUsdCents: number;
  /** verdict_floors_kill_tree: a KILL additionally needs this many EXPECTED
   *  bookings' worth of spend at the target cost per call. */
  killRequiresExpectedBookings: number;
  /** ruleset_zakk: how "about 3 expected bookings" is read. */
  expectedBookingsRounding: "nearest" | "down";
  /** ruleset_zakk: collected ROI at or above this is protect. */
  protectMinRoi: number;
  /** ruleset_zakk: collected ROI at or above this (and below protect) is the
   *  KPI line. Below it, the signed kill tree applies. */
  kpiLineMinRoi: number;
  /** learning_phase_awareness: no verdict lands before this many days live. */
  minDaysBeforeVerdict: number;
  /** touch_floor_72h: a signal younger than this cannot be acted on. */
  minSignalAgeHours: number;
  /** scaling_ladder, for the headroom read. */
  ladder: {
    launchDailyUsdCents: number;
    bottomLadderUsdCents: readonly number[];
    aboveThresholdUsdCents: number;
    aboveThresholdStepPct: readonly [number, number];
    budgetIsFloorAtCashRoi: number;
    stepCadence: string;
  };
}

/** What the engine needs to judge ONE ad. Every field is either a stored fact
 *  or an explicitly-declared unknown; nothing here is inferred by the engine. */
export interface AdVerdictInput {
  ad_id: string;
  keyword: string | null;
  adset_id: string | null;
  spend_usd_cents: number;
  booked: number;
  taken: number;
  closes: number;
  collected_usd_cents: number;
  /** The target cost per BOOKED call, in USD cents. Derived per creator from
   *  the registry (CAC target x close rate) on the live path; supplied directly
   *  by the unit fixtures so they pin logic rather than data. */
  cost_per_call_target_usd_cents: number;
  /** Days this ad has actually been live. Null when unknown, which is treated
   *  as "cannot clear the learning-phase gate" rather than as "mature". */
  days_live: number | null;
  /** Has this ad ever reached the KPI line in a prior window at adequate spend?
   *  The kill tree's FIXABLE branch turns on this. */
  reached_2x_history: boolean;
  /** Sustained fatigue: cost per result rising AND link CTR falling, for at
   *  least the touch floor. Null means the signal was not measurable. */
  fatigue: { cost_per_result_rising: boolean; ctr_falling: boolean; sustained_hours: number } | null;
  /**
   * Has fresh creative already been tested on this ad? NOT machine-derivable
   * from anything we store: no creative-refresh history exists. It defaults to
   * false, which is the conservative reading, and the answer says so rather
   * than letting a default masquerade as a finding.
   */
  fresh_creative_tested: boolean;
}

export interface AdVerdict {
  ad_id: string;
  keyword: string | null;
  verdict: Verdict;
  /** ALWAYS present. Which lens produced this, so a verdict is never mistaken
   *  for a fact. */
  under_ruleset: string;
  /** The definition names and the actual numbers that earned this verdict. */
  basis: string;
  /** The signed definitions this particular verdict leaned on. */
  definitions_applied: string[];
  /** The arithmetic, exposed so a reader can redo it. */
  computed: {
    collected_roi: number | null;
    cost_per_booked_call_usd_cents: number | null;
    expected_bookings_at_target: number;
    kill_eligible: boolean;
  };
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Cite a component definition at the version actually loaded from the
 *  registry. A basis line that hardcodes "v1" would quietly go on claiming v1
 *  the day the owner signs v2, which is the sort of small lie a receipt exists
 *  to make impossible. */
function at(rs: Ruleset, name: string): string {
  return `${name} v${rs.componentVersions[name] ?? 1}`;
}

/**
 * "About 3 expected bookings", read the way the ruleset says to read it.
 *
 * This is the one place a signed phrase needed an interpretation, so the
 * interpretation is itself registry data (`expected_bookings_rounding`) rather
 * than a decision buried in code. Under "nearest", a $685 ad against a $270
 * target has 2.54 expected bookings, which rounds to 3 and makes it kill
 * ELIGIBLE: it had a fair test. That is the STAR-class case from the
 * 2026-07-31 review, and it is pinned as a fixture precisely because a
 * different reading (round down) would have called a fairly-tested ad
 * "starved" and left money burning.
 */
function killEligible(expected: number, rs: Ruleset): boolean {
  const threshold = rs.killRequiresExpectedBookings;
  const seen = rs.expectedBookingsRounding === "nearest" ? Math.round(expected) : Math.floor(expected);
  return seen >= threshold;
}

/**
 * THE VERDICT FOR ONE AD, under one named ruleset.
 *
 * Dispatch is keyed by ruleset from day one, so adding jeremy_v1 later is a new
 * signed registry row plus one more branch here, never a restructure.
 */
export function verdictForAd(input: AdVerdictInput, rs: Ruleset): AdVerdict {
  if (rs.key === "zakk_v1") return zakkV1(input, rs);
  // A ruleset the engine has no branch for is never quietly approximated by
  // the nearest one it does know. rulesets.ts refuses unknown names before we
  // get here; this is the belt to that braces.
  throw new Error(
    `no verdict branch exists for ruleset "${rs.key}". A verdict was NOT guessed at using another ruleset's rules.`,
  );
}

function zakkV1(input: AdVerdictInput, rs: Ruleset): AdVerdict {
  const roi = input.spend_usd_cents > 0 ? input.collected_usd_cents / input.spend_usd_cents : null;
  const costPerCall = input.booked > 0 ? Math.round(input.spend_usd_cents / input.booked) : null;
  const target = input.cost_per_call_target_usd_cents;
  const expected = target > 0 ? input.spend_usd_cents / target : 0;
  const eligible = killEligible(expected, rs);

  const computed = {
    collected_roi: roi === null ? null : Math.round(roi * 100) / 100,
    cost_per_booked_call_usd_cents: costPerCall,
    expected_bookings_at_target: Math.round(expected * 100) / 100,
    kill_eligible: eligible,
  };

  const out = (verdict: Verdict, basis: string, defs: string[]): AdVerdict => ({
    ad_id: input.ad_id,
    keyword: input.keyword,
    verdict,
    under_ruleset: rs.key,
    basis,
    definitions_applied: defs,
    computed,
  });

  // ── GATE 1: the evidence floor. No verdict of any kind below it. ────────
  // verdict_floors_kill_tree v1 binds per ad on TOTAL spend, and explicitly
  // rejects the per-day-per-campaign framing, because our test sets run many
  // ads sharing one budget.
  if (input.spend_usd_cents < rs.evidenceFloorUsdCents) {
    return out(
      "too_early",
      `${at(rs, "verdict_floors_kill_tree")}: ${usd(input.spend_usd_cents)} total spend on this ad is below the ${usd(rs.evidenceFloorUsdCents)} evidence floor, so no verdict of any kind lands. This is "too early", never "failed".`,
      ["verdict_floors_kill_tree", "ruleset_zakk"],
    );
  }

  // ── GATE 2: the learning-phase gate. ────────────────────────────────────
  // learning_phase_awareness v1: no verdict lands before 7 days at meaningful
  // spend, whatever Meta's UI indicator shows (for messaging campaigns it may
  // never show learning-exit at all). An ad whose age we cannot read is treated
  // as young rather than as mature: an unknown must never buy a kill.
  const days = input.days_live;
  if (days === null || days < rs.minDaysBeforeVerdict) {
    const age = days === null ? "its days live could not be read" : `it has been live ${days} day${days === 1 ? "" : "s"}`;
    return out(
      "starved_untested",
      `${at(rs, "learning_phase_awareness")}: no verdict lands before ${rs.minDaysBeforeVerdict} days at meaningful spend, and ${age}. It has cleared the ${usd(rs.evidenceFloorUsdCents)} evidence floor at ${usd(input.spend_usd_cents)} but has not yet had a fair test. This is "starved-untested", never "failed".`,
      ["learning_phase_awareness", "verdict_floors_kill_tree", "ruleset_zakk"],
    );
  }

  // ── GATE 3: the winners. A protect or KPI-line read needs no kill-tree
  // spend test, because the extra spend requirement in the signed statement
  // attaches to a KILL verdict only. ─────────────────────────────────────
  if (roi !== null && roi >= rs.protectMinRoi) {
    return out(
      "protect",
      `ruleset_zakk v${rs.definition.version}: ${usd(input.collected_usd_cents)} collected on ${usd(input.spend_usd_cents)} spend is ${computed.collected_roi}x, at or above the ${rs.protectMinRoi}x protect line, from ${input.closes} close${input.closes === 1 ? "" : "s"}.`,
      ["ruleset_zakk", "collected_vs_contracted", "roi_window"],
    );
  }
  if (roi !== null && roi >= rs.kpiLineMinRoi) {
    return out(
      "kpi_line",
      `ruleset_zakk v${rs.definition.version}: ${usd(input.collected_usd_cents)} collected on ${usd(input.spend_usd_cents)} spend is ${computed.collected_roi}x, between the ${rs.kpiLineMinRoi}x KPI line and the ${rs.protectMinRoi}x protect line, from ${input.closes} close${input.closes === 1 ? "" : "s"}.`,
      ["ruleset_zakk", "collected_vs_contracted", "roi_window"],
    );
  }

  // ── GATE 4: below the KPI line, but not yet fairly tested. ──────────────
  // Funded past the floor, yet not given the spend that ~3 bookings were
  // expected to cost. The signed vocabulary for this is "starved-untested",
  // and the statement is explicit that it is NEVER "failed".
  if (!eligible) {
    return out(
      "starved_untested",
      `${at(rs, "verdict_floors_kill_tree")}: a KILL requires spend sufficient that about ${rs.killRequiresExpectedBookings} bookings were EXPECTED. ${usd(input.spend_usd_cents)} at the ${usd(target)} target cost per call expects only ${computed.expected_bookings_at_target} booking${computed.expected_bookings_at_target === 1 ? "" : "s"}, so this ad has been funded past the floor but never fairly tested. This is "starved-untested", never "failed".`,
      ["verdict_floors_kill_tree", "ruleset_zakk"],
    );
  }

  // ── GATE 5: the signed kill tree, branch by branch, in its own order. ───

  // FIXABLE: sub-2x WITH fatigue signals and a 2x+ history. The signed
  // statement calls this fixable via relaunch or refresh, NOT a kill.
  const fatigued =
    input.fatigue !== null &&
    input.fatigue.cost_per_result_rising &&
    input.fatigue.ctr_falling &&
    input.fatigue.sustained_hours >= rs.minSignalAgeHours;
  if (input.reached_2x_history && fatigued) {
    return out(
      "fixable_relaunch",
      `${at(rs, "verdict_floors_kill_tree")} (fixable branch): ${computed.collected_roi}x is below the ${rs.kpiLineMinRoi}x line, but this ad reached ${rs.kpiLineMinRoi}x historically and shows sustained fatigue (cost per result rising and link CTR falling for ${input.fatigue!.sustained_hours}h, past the ${at(rs, "touch_floor_72h")} ${rs.minSignalAgeHours}h touch floor). The signed tree calls this FIXABLE by relaunch or refresh, not a kill.`,
      ["verdict_floors_kill_tree", "touch_floor_72h", "ruleset_zakk"],
    );
  }

  // LEAD QUALITY: KPIs fine but the leads do not show or close. Checked BEFORE
  // the generic kills, because it names a different remedy: kill and relaunch
  // proven winners, rather than treat the creative as the problem.
  const kpisFine = costPerCall !== null && costPerCall <= target;
  if (kpisFine && input.closes === 0 && input.booked > 0) {
    return out(
      "lead_quality_kill",
      `${at(rs, "verdict_floors_kill_tree")} (lead-quality branch): cost per booked call is ${usd(costPerCall)}, at or under the ${usd(target)} target, so the KPIs are fine, but ${input.booked} booking${input.booked === 1 ? "" : "s"} produced ${input.taken} taken call${input.taken === 1 ? "" : "s"} and 0 closes. The signed tree calls this a LEAD-QUALITY kill: kill and relaunch proven winners.`,
      ["verdict_floors_kill_tree", "ruleset_zakk"],
    );
  }

  // KILL: fresh creative already tested and the KPIs are still broken.
  if (input.fresh_creative_tested) {
    return out(
      "kill",
      `${at(rs, "verdict_floors_kill_tree")} (tested-creative branch): ${usd(input.spend_usd_cents)} at the ${usd(target)} target expected ${computed.expected_bookings_at_target} bookings and returned ${input.booked}, with ${input.closes} close${input.closes === 1 ? "" : "s"} and ${computed.collected_roi === null ? "no" : `${computed.collected_roi}x`} collected ROI. Fresh creative has already been tested and the KPIs are still below the ${rs.kpiLineMinRoi}x line. This is a KILL.`,
      ["verdict_floors_kill_tree", "ruleset_zakk"],
    );
  }

  // KILL: never reached 2x at adequate spend. This is the branch the
  // 2026-07-31 Direct CTA roster kill came down, and it is the reason that
  // kill freed $50/day.
  if (!input.reached_2x_history) {
    return out(
      "kill",
      `${at(rs, "verdict_floors_kill_tree")} (never-reached-${rs.kpiLineMinRoi}x branch): ${usd(input.spend_usd_cents)} spend, ${input.booked} booking${input.booked === 1 ? "" : "s"} against ${computed.expected_bookings_at_target} expected at the ${usd(target)} target cost per call, ${input.closes} close${input.closes === 1 ? "" : "s"}, ${computed.collected_roi === null ? "no" : `${computed.collected_roi}x`} collected ROI, and no prior window at ${rs.kpiLineMinRoi}x or better. Adequate spend, never reached ${rs.kpiLineMinRoi}x. This is a KILL.`,
      ["verdict_floors_kill_tree", "ruleset_zakk"],
    );
  }

  // ── NOTHING IN THE SIGNED TREE MATCHES. ────────────────────────────────
  //
  // An ad that IS below the line, DID clear it historically, is NOT fatiguing,
  // and whose creative-refresh history we do not know, satisfies no branch of
  // verdict_floors_kill_tree v1:
  //   - not FIXABLE, which requires fatigue signals it does not have;
  //   - not the never-reached-2x KILL, because it did reach 2x;
  //   - not the tested-creative KILL, because nothing records whether fresh
  //     creative was tried;
  //   - not a lead-quality KILL, because its KPIs are not fine.
  //
  // The tempting move is to let this fall through to KILL. That would be
  // exactly the "naked unfixable judgment call" the signed statement forbids,
  // and it would be a KILL the owner never signed, delivered in the voice of
  // one he did. So the answer is that the tree does not resolve, plus the one
  // fact that WOULD resolve it. A proven ad is not killed by a default.
  return out(
    "tree_unresolved",
    `${at(rs, "verdict_floors_kill_tree")}: this ad is below the ${rs.kpiLineMinRoi}x line at ${computed.collected_roi === null ? "no" : `${computed.collected_roi}x`} on ${usd(input.spend_usd_cents)}, but it DID reach ${rs.kpiLineMinRoi}x in an earlier window and it is not showing the sustained fatigue the FIXABLE branch requires (${input.fatigue ? `cost per result ${input.fatigue.cost_per_result_rising ? "rising" : "not rising"}, link CTR ${input.fatigue.ctr_falling ? "falling" : "not falling"}` : "fatigue was not measurable"}). No branch of the signed kill tree covers that case, and it is NOT being defaulted to a kill: the tree forbids naked judgment calls. What resolves it is one fact nothing here records: has fresh creative already been tested on this ad? If yes, the signed tree makes it a KILL. If no, refreshing the creative is the untried move.`,
    ["verdict_floors_kill_tree", "touch_floor_72h", "ruleset_zakk"],
  );
}

// ─────────────────────────────────────────────────────────────────────────
// THE AD-SET ROLLUP.
// ─────────────────────────────────────────────────────────────────────────

export interface AdSetVerdictInput {
  adset_id: string;
  /** Meta's own name, verbatim. Suffixed because it is a proper noun the
   *  platform assigned, not a word this answer chose. */
  adset_name_verbatim: string | null;
  campaign_id: string | null;
  spend_usd_cents: number;
  collected_usd_cents: number;
  closes: number;
  booked: number;
  /** The ad set's own live daily dial, when it holds one. */
  daily_budget_usd_cents: number | null;
  /** Whether this ad set holds the budget, or its campaign does (CBO). */
  budget_level: "adset" | "campaign" | null;
  /** Verdicts of the ads inside it, already computed. */
  ad_verdicts: readonly AdVerdict[];
  /** How many OTHER ad sets in the same campaign are still active. Drives the
   *  kill-kills-campaign warning. */
  sibling_active_adsets: number;
}

export interface AdSetVerdict {
  adset_id: string;
  adset_name_verbatim: string | null;
  verdict: Verdict | "mixed";
  under_ruleset: string;
  basis: string;
  /** What killing every kill-verdict ad inside would hand back per day. */
  freed_usd_cents_per_day: number | null;
  /** Present only when killing this ad set would take its campaign down too. */
  kill_kills_campaign_warning: string | null;
  /** Where the ladder says the next weekly step sits, if the numbers earn one. */
  scaling_headroom: {
    eligible: boolean;
    current_daily_usd_cents: number | null;
    next_step_usd_cents: number | null;
    basis: string;
  };
  computed: { collected_roi: number | null };
}

export function verdictForAdSet(input: AdSetVerdictInput, rs: Ruleset): AdSetVerdict {
  if (rs.key !== "zakk_v1") {
    throw new Error(`no ad-set rollup branch exists for ruleset "${rs.key}".`);
  }
  const roi = input.spend_usd_cents > 0 ? input.collected_usd_cents / input.spend_usd_cents : null;
  const roiRounded = roi === null ? null : Math.round(roi * 100) / 100;

  const kinds = new Set(input.ad_verdicts.map((v) => v.verdict));
  const verdict: Verdict | "mixed" =
    kinds.size === 1 ? ([...kinds][0] as Verdict) : kinds.size === 0 ? "too_early" : "mixed";

  // ── Freed budget. Only meaningful when the KILLED ads are the whole ad set:
  // an ABO dial sits on the ad set, so killing two of five ads inside it frees
  // nothing at all. Saying "$115/day freed" when the dial does not move would
  // be a fabricated saving, so this returns null unless every ad is a kill.
  const killVerdicts = new Set<Verdict>(["kill", "lead_quality_kill"]);
  const allKill = input.ad_verdicts.length > 0 && input.ad_verdicts.every((v) => killVerdicts.has(v.verdict));
  const freed = allKill ? input.daily_budget_usd_cents : null;

  const warning =
    allKill && input.sibling_active_adsets === 0
      ? `This is the last active ad set in campaign ${input.campaign_id ?? "(unknown)"}. Killing it stops the campaign, not just the ad set.`
      : null;

  // ── Scaling headroom, straight off the signed ladder. ───────────────────
  // scaling_ladder v1: weekly steps only, never reactive mid-week; the bottom
  // of the ladder doubles because meaningful data needs meaningful steps;
  // above the threshold, steps are +20-33%. At or above the floor cash ROI,
  // budget is a floor and not a cap.
  const current = input.daily_budget_usd_cents;
  const earns = roi !== null && roi >= rs.ladder.budgetIsFloorAtCashRoi;
  let next: number | null = null;
  let ladderBasis: string;
  if (!earns || current === null) {
    ladderBasis =
      current === null
        ? `${at(rs, "scaling_ladder")}: this ad set holds no daily dial of its own${input.budget_level === "campaign" ? " (its campaign holds the budget)" : ""}, so there is no step to read here.`
        : `${at(rs, "scaling_ladder")}: ${roiRounded ?? "no"}x cash ROI is below the ${rs.ladder.budgetIsFloorAtCashRoi}x at which budget becomes a floor rather than a cap, so no step is earned.`;
  } else if (current < rs.ladder.aboveThresholdUsdCents) {
    const rung = rs.ladder.bottomLadderUsdCents.find((c) => c > current);
    next = rung ?? rs.ladder.aboveThresholdUsdCents;
    ladderBasis = `${at(rs, "scaling_ladder")}: at ${roiRounded}x cash ROI, budget is a floor not a cap. ${usd(current)}/day sits on the bottom of the ladder, which DOUBLES by necessity (${rs.ladder.bottomLadderUsdCents.map(usd).join(" to ")}), so the next ${rs.ladder.stepCadence} step is ${usd(next)}/day. Never reactive mid-week.`;
  } else {
    const [lo, hi] = rs.ladder.aboveThresholdStepPct;
    next = Math.round(current * (1 + lo / 100));
    ladderBasis = `${at(rs, "scaling_ladder")}: at ${roiRounded}x cash ROI, budget is a floor not a cap. Above ${usd(rs.ladder.aboveThresholdUsdCents)}/day the step is +${lo}-${hi}% ${rs.ladder.stepCadence}, so the next step from ${usd(current)}/day is ${usd(next)} to ${usd(Math.round(current * (1 + hi / 100)))}/day. Never reactive mid-week, and respect proven per-ad-set saturation ceilings.`;
  }

  return {
    adset_id: input.adset_id,
    adset_name_verbatim: input.adset_name_verbatim,
    verdict,
    under_ruleset: rs.key,
    basis: `ruleset_zakk v${rs.definition.version}: ${usd(input.collected_usd_cents)} collected on ${usd(input.spend_usd_cents)} spend (${roiRounded === null ? "no ROI" : `${roiRounded}x`}) across ${input.ad_verdicts.length} ad${input.ad_verdicts.length === 1 ? "" : "s"}, ${input.closes} close${input.closes === 1 ? "" : "s"}, ${input.booked} booking${input.booked === 1 ? "" : "s"}. Ad verdicts: ${[...kinds].join(", ") || "none"}.`,
    freed_usd_cents_per_day: freed,
    kill_kills_campaign_warning: warning,
    scaling_headroom: {
      eligible: earns && next !== null,
      current_daily_usd_cents: current,
      next_step_usd_cents: next,
      basis: ladderBasis,
    },
    computed: { collected_roi: roiRounded },
  };
}
