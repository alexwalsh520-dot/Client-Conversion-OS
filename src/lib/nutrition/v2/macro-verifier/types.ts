/**
 * Macro verifier — public types.
 *
 * Hard gate that runs after the LLM meal generator produces a plan.
 * Recomputes daily macros from the WeekPlanSuccess.solve.slots[].grams
 * × ingredient nutrition data and compares against the day's targets.
 *
 * On any-day-out-of-tolerance: caller (run-pipeline) issues ONE retry
 * with corrective feedback. If retry also fails the verifier:
 *   - ≤ 3/7 days off → ship with WARN audit chip
 *   - ≥ 4/7 days off → BLOCK (return-to-coach)
 */

import type { WeekPlanSuccess } from "../picker";
import type { MacroTargets } from "../../macro-calculator";

export interface VerifyMacrosInput {
  plan: WeekPlanSuccess;
  /** Daily targets — training + rest. Verifier uses the day's
   *  day_kind to pick which targets to compare against. */
  targets: { training: MacroTargets; rest: MacroTargets };
  /** Fractional tolerance for daily macros. Default 0.15 (±15%). */
  tolerance_pct?: number;
}

export interface DayDiagnostic {
  day_number: number;
  day_kind: "training" | "rest";
  /** Actuals computed from the plan's ingredient grams. */
  kcal_actual: number;
  kcal_target: number;
  kcal_drift_pct: number;
  protein_actual_g: number;
  protein_target_g: number;
  protein_drift_pct: number;
  carbs_actual_g: number;
  carbs_target_g: number;
  carbs_drift_pct: number;
  fat_actual_g: number;
  fat_target_g: number;
  fat_drift_pct: number;
  /** Did this day pass tolerance check on all 4 macros? */
  pass: boolean;
  /** Human-readable per-macro fail reasons (only populated when !pass). */
  fail_reasons: string[];
}

export interface VerifyMacrosResult {
  /** True iff every day passes the tolerance check. */
  pass: boolean;
  /** Per-day breakdown including drift percentages. */
  day_diagnostics: DayDiagnostic[];
  /** Number of days that failed tolerance. 0 means all pass. */
  failed_days: number;
  /**
   * Suggested corrective feedback for the LLM retry. Concatenated
   * string of per-day fail summaries with directional hints.
   * Empty when pass=true.
   */
  retry_hint: string;
}
