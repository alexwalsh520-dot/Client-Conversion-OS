/**
 * Phase B4 — post-solver safety audit public types.
 *
 * The audit is the final gate before PDF render. It runs 8 deterministic
 * checks against a finished week plan and the client's profile, returning
 * a structured pass/fail with blocking errors and warnings. No DB calls,
 * no LLM calls, no solver re-runs — pure data validation.
 */

import type {
  AllergyFlag,
  BuildSpec,
  BuildType,
  DietaryStyle,
  DistributionTemplateId,
  MealDistribution,
  MedicalFlag,
} from "../types";
import type { WeekPlanSuccess } from "../picker";

// ============================================================================
// Inputs
// ============================================================================

/**
 * The audit's view of the client. Caller (B6 wiring) pulls these from the
 * intake form / database and packages them here.
 */
export interface ClientProfile {
  buildType: BuildType;
  buildSpec: BuildSpec;
  /** Active allergy flags (raw rule slugs from v2/allergies). */
  allergyFlags: AllergyFlag[];
  /** Active medical flags (raw rule slugs from v2/medical). */
  medicalFlags: MedicalFlag[];
  /** Single dietary style or null. */
  dietaryStyle: DietaryStyle | null;
  /**
   * Sodium cap in mg/day. Caller computes from medical flags + stimulant
   * boolean + default 2300 (same precedence as B1 resolveMedicalCaps).
   * Audit treats this as authoritative.
   */
  sodiumCapMg: number;
  /** Stock distribution template ID. Used for metadata; Check 8 only fires
   *  when customDistribution is provided. */
  distributionTemplate: DistributionTemplateId;
  /**
   * Optional coach-edited per-slot percentages. Shape mirrors
   * MealDistribution but with editable `protein_pct`, `carb_pct`, `fat_pct`.
   * If present, Check 8 verifies each macro column sums to 100% (within
   * 0.5% tolerance).
   */
  customDistribution?: MealDistribution;
}

// ============================================================================
// Outputs
// ============================================================================

export type AuditCheckKind =
  | "hard_exclude_violation"
  | "sodium_ceiling_exceeded"
  | "tier_1_protein_below_min"
  | "tier_1_carb_below_min"
  | "frequency_cap_exceeded"
  | "daily_kcal_drift"
  | "daily_macro_drift"
  | "per_meal_drift"
  | "build_medical_block"
  | "build_medical_warn"
  | "custom_distribution_invalid_sum"
  | "ingredient_data_missing";

export interface AuditError {
  severity: "BLOCK" | "WARN";
  /** Which check fired — see AuditCheckKind for the canonical set. */
  check: AuditCheckKind;
  /** Day number (1-7) if day-scoped. */
  day?: number;
  /** Slot index if meal-scoped. */
  meal?: number;
  /** Slug if ingredient-scoped. */
  ingredient?: string;
  /** Structured details for programmatic handling (UI / log analytics). */
  details: Record<string, unknown>;
  /** Human-readable explanation. Surfaced in coach UI. */
  reason: string;
}

export type AuditAction =
  | "PROCEED_TO_PDF_RENDER"
  | "BLOCK_GENERATION_RETURN_TO_COACH";

export interface AuditResult {
  pass: boolean;
  blocking_errors: AuditError[];
  warnings: AuditError[];
  action: AuditAction;
  /** Wall-clock from audit entry to return, in ms. <100ms target. */
  performance_ms: number;
}

// Re-exports
export type {
  BuildSpec,
  BuildType,
  AllergyFlag,
  MedicalFlag,
  DietaryStyle,
  DistributionTemplateId,
  MealDistribution,
  WeekPlanSuccess,
};
