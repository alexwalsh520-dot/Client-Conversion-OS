// ─────────────────────────────────────────────────────────────────────────
// RULESETS: where a lens is assembled out of SIGNED definitions.
//
// BRICK 3'S THRESHOLD LAW lives here: every threshold, window and rule the
// kill/scale read applies is READ from registry_definitions at answer time.
// Nothing downstream of this file is allowed to know a number the owner signed.
//
// The failure this kills is quiet and expensive: a threshold copied into code
// keeps applying the old rule after the owner signs a new one, and the answer
// still looks certified. So a missing definition is not survivable. This module
// refuses, by name, rather than falling back to a built-in default, because a
// default is exactly how an uncertified number learns to impersonate a signed
// one.
//
// Adding a future ruleset (jeremy_v1) is: one new signed registry row naming its
// components, plus one branch in the verdict engine keyed by ruleset name. It is
// never a restructure, and it never edits zakk_v1, because the Impact scorecard
// grades rulesets against outcomes later. That is how rules evolve with evidence
// instead of with edits.
// ─────────────────────────────────────────────────────────────────────────

import type { Ruleset } from "./verdict-engine";
import { BadParams, type Db } from "./types";

/**
 * Thrown when a definition the answer needs is not signed in the registry. The
 * door turns this into an answer whose receipt says `cannot_answer` and NAMES
 * what was missing, rather than into a number computed against a guess.
 */
export class CannotAnswer extends Error {
  readonly missing: string[];
  constructor(missing: string[], message: string) {
    super(message);
    this.name = "CannotAnswer";
    this.missing = missing;
  }
}

export interface SignedDefinition {
  name: string;
  version: number;
  statement: string;
  details: Record<string, unknown>;
}

/** Every ruleset this build knows how to APPLY. A name outside this list is
 *  refused with the list attached, so a caller corrects itself in one step. */
export const KNOWN_RULESETS = ["zakk_v1"] as const;
export const DEFAULT_RULESET = "zakk_v1";

/** Which registry definition backs each known ruleset key. */
const RULESET_DEFINITION: Record<string, string> = { zakk_v1: "ruleset_zakk" };

/**
 * Read the signed definitions by name. Only `signed` rows count: an `open`
 * definition is one the owner has not agreed to yet, and computing a verdict
 * against an unsigned rule would be exactly the uncertified answer this whole
 * layer exists to replace.
 */
export async function loadSignedDefinitions(
  db: Db,
  names: readonly string[],
): Promise<Map<string, SignedDefinition>> {
  const { data, error } = await db
    .from("registry_definitions_current")
    .select("name, version, statement, details, status");
  if (error) throw new Error(`could not read the definitions registry: ${error.message}`);
  const wanted = new Set(names);
  const map = new Map<string, SignedDefinition>();
  for (const r of (data || []) as Array<SignedDefinition & { status: string }>) {
    if (r.status !== "signed" || !wanted.has(r.name)) continue;
    map.set(r.name, {
      name: r.name,
      version: Number(r.version),
      statement: r.statement,
      details: (r.details || {}) as Record<string, unknown>,
    });
  }
  return map;
}

function num(d: SignedDefinition | undefined, path: string, missing: string[], defName: string): number {
  if (!d) {
    if (!missing.includes(defName)) missing.push(defName);
    return NaN;
  }
  const v = d.details[path];
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) {
    // A definition that exists but does not carry the number this rule needs is
    // reported the same way a missing definition is. "Signed but silent on the
    // point" is not permission to invent the number.
    missing.push(`${defName}.details.${path}`);
    return NaN;
  }
  return n;
}

/**
 * Assemble one named ruleset from the registry.
 *
 * Throws CannotAnswer naming every definition (or definition field) that was
 * missing. It collects them ALL rather than failing on the first, so one
 * refusal tells the owner everything that needs signing instead of trickling
 * out one round trip at a time.
 */
export async function loadRuleset(db: Db, key: string): Promise<{ ruleset: Ruleset; definitions: SignedDefinition[] }> {
  // An unknown ruleset is a BAD PARAMETER, not a missing definition: the caller
  // named a lens that does not exist, and the honest answer is a refusal that
  // hands back the list so it can correct itself in one step. It is never
  // approximated with the nearest ruleset the engine does know.
  if (!(KNOWN_RULESETS as readonly string[]).includes(key)) {
    throw new BadParams(
      `"${key}" is not a decision ruleset this door knows how to apply, and no other ruleset's rules were substituted for it. The rulesets it knows are: ${KNOWN_RULESETS.join(", ")}. Adding one is a signed registry_definitions row naming its component definitions, plus a branch in the verdict engine keyed by its name; it is never a guess.`,
    );
  }
  const selfName = RULESET_DEFINITION[key];

  const NEEDED = [
    selfName,
    "verdict_floors_kill_tree",
    "scaling_ladder",
    "decision_cadence",
    "daily_run_rate",
    "touch_floor_72h",
    "learning_phase_awareness",
    "structure_rules",
    "roi_window",
    "sales_lag",
    "unit_economics",
    "pricing_currency",
  ];

  const defs = await loadSignedDefinitions(db, NEEDED);
  const missing: string[] = NEEDED.filter((n) => !defs.has(n));

  const self = defs.get(selfName);
  const floors = defs.get("verdict_floors_kill_tree");
  const ladderDef = defs.get("scaling_ladder");
  const learning = defs.get("learning_phase_awareness");
  const touch = defs.get("touch_floor_72h");

  const evidenceFloorUsdCents = num(floors, "evidence_floor_cents", missing, "verdict_floors_kill_tree");
  const killRequiresExpectedBookings = num(floors, "kill_requires_expected_bookings", missing, "verdict_floors_kill_tree");
  const protectMinRoi = num(self, "protect_min_collected_roi", missing, selfName);
  const kpiLineMinRoi = num(self, "kpi_line_min_collected_roi", missing, selfName);
  const minDaysBeforeVerdict = num(learning, "min_days_before_verdict", missing, "learning_phase_awareness");
  const minSignalAgeHours = num(touch, "min_signal_age_hours", missing, "touch_floor_72h");
  const launchDailyUsdCents = num(ladderDef, "launch_daily_cents", missing, "scaling_ladder");
  const aboveThresholdUsdCents = num(ladderDef, "above_threshold_cents", missing, "scaling_ladder");
  const budgetIsFloorAtCashRoi = num(ladderDef, "budget_is_floor_at_cash_roi", missing, "scaling_ladder");

  const bottom = (ladderDef?.details.bottom_ladder_cents as number[] | undefined) || [];
  if (ladderDef && !bottom.length) missing.push("scaling_ladder.details.bottom_ladder_cents");
  const stepPct = (ladderDef?.details.above_threshold_step_pct as number[] | undefined) || [];
  if (ladderDef && stepPct.length < 2) missing.push("scaling_ladder.details.above_threshold_step_pct");

  if (missing.length) {
    throw new CannotAnswer(
      missing,
      `this answer applies decision rules, and every threshold it would apply has to come from a SIGNED definition in the registry rather than from code. These are missing or unsigned: ${missing.join(", ")}. No verdict and no threshold was substituted from a built-in default, so no numbers are being returned.`,
    );
  }

  const componentVersions: Record<string, number> = {};
  for (const [name, d] of defs) componentVersions[name] = d.version;

  const rounding = String(self!.details.expected_bookings_rounding ?? "nearest") === "down" ? "down" : "nearest";

  const ruleset: Ruleset = {
    key,
    definition: { name: selfName, version: self!.version },
    components: (self!.details.components as string[] | undefined) ?? NEEDED.filter((n) => n !== selfName),
    componentVersions,
    evidenceFloorUsdCents,
    killRequiresExpectedBookings,
    expectedBookingsRounding: rounding,
    protectMinRoi,
    kpiLineMinRoi,
    minDaysBeforeVerdict,
    minSignalAgeHours,
    ladder: {
      launchDailyUsdCents,
      bottomLadderUsdCents: bottom,
      aboveThresholdUsdCents,
      aboveThresholdStepPct: [stepPct[0], stepPct[1]],
      budgetIsFloorAtCashRoi,
      stepCadence: String(ladderDef!.details.step_cadence ?? "weekly"),
    },
  };

  return { ruleset, definitions: [...defs.values()] };
}

// ─────────────────────────────────────────────────────────────────────────
// WATCH MODE'S SPEAKING RULES, also from the registry.
// ─────────────────────────────────────────────────────────────────────────

export interface WatchRules {
  forbiddenVerbs: string[];
  allowedClosers: string[];
  decideWindowDays: number;
  version: number;
}

/**
 * decision_cadence v1 is explicit that daily watch output is FLAGS ONLY, with
 * no imperative verbs: "The flag is data; the prescription belongs to decide
 * mode only." The forbidden verbs are stored in the definition, so the unit
 * test that scans a serialized watch answer is checking against the OWNER's
 * list rather than against a list this build invented.
 */
export async function loadWatchRules(db: Db): Promise<WatchRules> {
  const defs = await loadSignedDefinitions(db, ["decision_cadence"]);
  const d = defs.get("decision_cadence");
  if (!d) {
    throw new CannotAnswer(
      ["decision_cadence"],
      "watch mode's speaking rules (which verbs it may never use, and what it may say instead) come from the signed decision_cadence definition, which is missing or unsigned. No flags are being returned rather than flags formatted against a guess.",
    );
  }
  const verbs = (d.details.watch_forbidden_verbs as string[] | undefined) || [];
  const closers = (d.details.watch_allowed_closers as string[] | undefined) || [];
  const days = Number(d.details.decide_window_days);
  if (!verbs.length || !closers.length || !Number.isFinite(days)) {
    throw new CannotAnswer(
      ["decision_cadence.details.watch_forbidden_verbs/watch_allowed_closers/decide_window_days"],
      "the signed decision_cadence definition does not carry the watch-mode speaking rules this answer needs. Nothing was substituted.",
    );
  }
  return { forbiddenVerbs: verbs, allowedClosers: closers, decideWindowDays: days, version: d.version };
}
