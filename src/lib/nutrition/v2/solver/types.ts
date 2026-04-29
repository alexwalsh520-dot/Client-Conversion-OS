/**
 * Phase B2 — solver public types.
 *
 * The solver is the layer that turns "LLM-picked slugs per slot" into
 * "per-meal grams that hit macro targets within tolerance." It does NOT
 * pick ingredients — that's B3. For B2, smoke tests fabricate slot inputs
 * and call solveDay directly.
 */

import type { MacroTargets } from "../../macro-calculator";
import type {
  BuildSpec,
  MealDistribution,
  PlanComplexity,
  SolverBias,
} from "../types";

// ============================================================================
// Inputs
// ============================================================================

/**
 * One ingredient slot in a meal as picked by the LLM (or fabricated for tests).
 * The solver decides each ingredient's grams; isAnchor controls whether
 * zeroing it out triggers a degradation diagnostic.
 */
export interface SlotIngredientInput {
  slug: string;
  /**
   * If true, the solver flags zeroing this slug as anchor degradation.
   * Anchor = the slot's primary protein source. The LLM (B3) sets this.
   * For B2 fixtures, set explicitly per smoke-test design.
   */
  isAnchor?: boolean;
}

export interface SlotInput {
  /** 1-based slot index, matches MealDistribution.slots[i].index. */
  index: number;
  ingredients: SlotIngredientInput[];
}

export interface SolveDayInput {
  /** Daily MacroTargets — typically training or rest from B1. */
  targets: MacroTargets;
  buildSpec: BuildSpec;
  distribution: MealDistribution;
  /** Pre-populated slot list (LLM output in production; fabricated in B2 tests). */
  slots: SlotInput[];
  /**
   * Slugs the solver must NOT use (forced to 0). Built upstream by merging
   * hard_exclude lists from active allergy / medical / dietary rules.
   */
  hardExclude: ReadonlySet<string>;
  bias: SolverBias;
  planComplexity: PlanComplexity;
}

// ============================================================================
// Outputs
// ============================================================================

export interface SlotResult {
  index: number;
  ingredients: Array<{ slug: string; grams: number }>;
}

export interface PerSlotActuals {
  slot_index: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calories: number;
  /** Sodium contributed by this slot's ingredients. */
  sodium_mg: number;
}

export interface DailyActuals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  sodium_mg: number;
}

export type FallbackLevel = 10 | 15 | 20;

export interface ZeroedSlug {
  slot_index: number;
  slug: string;
  /** True if this slug was the slot's anchor (primary protein). */
  anchor: boolean;
}

export interface SolveDaySuccess {
  /**
   * SUCCESS: clean solve, no LLM-picked slugs were zeroed.
   * SUCCESS_WITH_DEGRADATION: solver zeroed at least one slug. If any
   *   anchor was zeroed, B3 may want to re-prompt the LLM with the
   *   degradation hint. If only non-anchors were zeroed, the result is
   *   typically still good to ship.
   */
  status: "SUCCESS" | "SUCCESS_WITH_DEGRADATION";
  slots: SlotResult[];
  diagnostics: {
    fallback_level: FallbackLevel;
    zeroed_slugs: ZeroedSlug[];
    daily: DailyActuals;
    per_slot: PerSlotActuals[];
    /** Solver objective value (interpretation depends on bias). */
    objective_value: number;
    bias: SolverBias;
    /** Wall-clock ms inside glpk.solve, summed across fallback iterations. */
    solve_time_ms: number;
  };
}

export interface InfeasibilityError {
  type: "INFEASIBLE";
  /** Human-readable description of what made the problem infeasible. */
  binding_constraint: string;
  /** 2–3 actionable suggestions for the coach. */
  recommendations: string[];
  solver_diagnostics: {
    /** Highest fallback level we tried before giving up. */
    fallback_level_reached: FallbackLevel;
    /** Specific GLPK constraint label that failed, when identifiable. */
    failed_constraint: string;
    /** Slot index where the binding constraint was located, when applicable. */
    slot_index: number | null;
  };
}

export type SolveDayOutput = SolveDaySuccess | InfeasibilityError;

// ============================================================================
// Internal types (exported for tests)
// ============================================================================

export interface IngredientNutrition {
  slug: string;
  category: string;
  calories_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  sodium_mg_per_100g: number;
  /** Display name from the ingredients table — populated by the live
   *  Supabase fetcher (B6a addition). Optional so prior smoke fixtures
   *  that omitted it still pass. The PDF adapter uses this when available
   *  to skip a separate displayMeta query. */
  name?: string;
}

export interface PerSlotTargets {
  index: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  calories: number;
}

export interface GramBounds {
  min: number;
  max: number;
}

/** Helper type used in user-facing test output. */
export type FormattedSolveResult = {
  ok: true;
  status: SolveDaySuccess["status"];
  slots: SlotResult[];
  daily: DailyActuals;
  per_slot: PerSlotActuals[];
  zeroed_slugs: ZeroedSlug[];
  fallback_level: FallbackLevel;
} | {
  ok: false;
  binding_constraint: string;
  recommendations: string[];
  fallback_level_reached: FallbackLevel;
};

// ============================================================================
// Type guards
// ============================================================================

export function isSolveDaySuccess(out: SolveDayOutput): out is SolveDaySuccess {
  return (out as SolveDaySuccess).status !== undefined;
}

export function isInfeasibilityError(
  out: SolveDayOutput,
): out is InfeasibilityError {
  return (out as InfeasibilityError).type === "INFEASIBLE";
}

// Re-export types this module's consumers commonly need.
export type {
  BuildSpec,
  MacroTargets,
  MealDistribution,
  PlanComplexity,
  SolverBias,
};
