/**
 * Plan-selector — public types.
 *
 * After the meal generator emits N parallel plans, the selector scores each
 * against the hard / soft error taxonomy and picks the best one to ship.
 *
 * Hard errors absolutely block a plan from shipping:
 *   - allergen_leak       : slug from an allergy rule's hard_exclude appears
 *   - dietary_violation   : slug from the dietary rule's hard_exclude appears
 *                           (vegan/vegetarian violations, kosher, halal, etc.)
 *   - invalid_slug        : slug not in approved DB list
 *   - schema_violation    : generation threw or produced unparseable JSON
 *
 * Soft errors land in audit_warnings + the coach handoff prompt but do NOT
 * block shipping:
 *   - macro_drift, sodium_breach, variety_cap_exceeded, tier_1_below_min,
 *     daily_kcal_drift, etc.
 *
 * Selection: among plans with zero hard errors, pick the one with fewest
 * soft errors. Ties broken by lowest plan_index (deterministic, stable).
 * If no plan is hard-error-free, BLOCK with structured failure.
 */

import type { WeekPlanSuccess } from "../picker";
import type { GeneratePlanResult } from "../llm-meal-generator";
import type { AuditResult } from "../audit/types";
import type { VerifyMacrosResult } from "../macro-verifier";

export type HardErrorKind =
  | "allergen_leak"
  | "dietary_violation"
  | "invalid_slug"
  | "schema_violation";

export type SoftErrorKind =
  | "macro_drift"
  | "sodium_ceiling_exceeded"
  | "frequency_cap_exceeded"
  | "tier_1_protein_below_min"
  | "tier_1_carb_below_min"
  | "daily_kcal_drift"
  | "daily_macro_drift"
  | "per_meal_drift"
  | "build_medical_warn"
  | "audit_warning_other";

export interface HardError {
  kind: HardErrorKind;
  /** Human-readable summary used in the BLOCK error_details. */
  reason: string;
  /** For per-slug errors. */
  slug?: string;
  /** For per-day-meal errors. */
  day?: number;
  meal?: number;
}

export interface SoftError {
  kind: SoftErrorKind;
  reason: string;
  day?: number;
  meal?: number;
}

export interface ScoredPlan {
  /** 0-indexed position in the parallel batch. */
  plan_index: number;
  /** True iff `hard_errors` is empty. */
  valid: boolean;
  hard_errors: HardError[];
  soft_errors: SoftError[];
  /** The plan itself, for downstream use when selected. May be null when
   *  generation threw outright (schema_violation hard error). */
  plan: WeekPlanSuccess | null;
  /** Generator diagnostics passed through for observability. */
  generator_diagnostics?: GeneratePlanResult["diagnostics"];
  /** Audit run on the plan (skipped when plan is null). */
  audit?: AuditResult;
  /** Verifier run on the plan (skipped when plan is null). */
  verify_result?: VerifyMacrosResult;
}

export interface SelectionResult {
  /** Index of the selected plan, or null when no plan passed hard errors. */
  selected_index: number | null;
  /** Human-readable explanation of why the selection went the way it did. */
  reason: string;
  /** All scored plans (callers want these for diagnostics). */
  scored: ScoredPlan[];
}
