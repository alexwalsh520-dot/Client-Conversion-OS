/**
 * Phase B5 — pdf-adapter public types.
 *
 * The adapter is a pure data-transformation layer that turns a v2
 * WeekPlanSuccess (from the B3 orchestrator) plus an intake snapshot
 * into the existing renderer's PdfInput shape.
 *
 * Design constraints (locked):
 *   1. Adapter signature is (plan, intake) → PdfInput. NO audit input —
 *      audit is coach-facing diagnostics, not client-facing PDF content.
 *   2. Pure data transformation. Sync where possible, async only for
 *      ingredient cache reads. No request-scoped state, no DB calls.
 *   3. Sodium stays OFF the rendered PDF (defense against accidental
 *      reintroduction; smoke test verifies).
 *   4. Legacy renderer (pdf-renderer.ts) is untouched. Bridges in this
 *      module translate v2 enums → legacy types so we can reuse
 *      tips-generator and medical.ts unchanged.
 */

import type {
  PdfInput,
  PdfClient,
  PdfDay,
  PdfMeal,
  PdfIngredient,
  PdfGroceryItem,
  PdfTip,
} from "../../pdf-renderer";
import type { WeekPlanSuccess } from "../picker";
import type {
  AllergyFlag,
  BuildType,
  DietaryStyle,
  MedicalFlag,
} from "../types";

// ============================================================================
// Adapter inputs
// ============================================================================

/**
 * Snapshot of intake-form fields the adapter needs. The adapter does NOT
 * pull these from the database — caller (B6 route handler) reads the
 * intake row and packages the relevant fields here.
 */
export interface IntakeSnapshot {
  // Identity
  first_name: string;
  last_name: string;
  age: number;
  weight_kg: number;
  height_cm: number;
  /** Goal weight in kilograms, if specified. Used for timeline note. */
  goal_weight_kg?: number;

  // Free-text fields fed to legacy tips-generator + medical detector
  fitness_goal: string;     // free-text, e.g. "lose 20 lbs"
  can_cook: string;
  meal_count: string;
  medications: string;
  supplements: string;
  sleep_hours: string;
  water_intake: string;
  allergies: string;        // free-text "Allergies / Medical" combined field

  // v2 structured flags (from the new UI in B6)
  build_type: BuildType;
  allergy_flags: AllergyFlag[];
  medical_flags: MedicalFlag[];
  dietary_style: DietaryStyle | null;
  /** True if client is on a stimulant medication. Bridge passes through
   *  to tips-generator via the legacy onAppetiteSuppressant field. */
  on_stimulant: boolean;
}

export interface AdapterOptions {
  /**
   * Override the date displayed in the PDF footer ("Prepared <date>").
   * Default: today (UTC). Used by deterministic tests to keep byte
   * outputs stable.
   */
  preparedDate?: Date;
}

// ============================================================================
// Adapter errors
// ============================================================================

export class AdapterError extends Error {
  readonly kind: "missing_ingredient" | "invalid_plan" | "missing_intake_field";
  constructor(kind: AdapterError["kind"], message: string) {
    super(message);
    this.name = "AdapterError";
    this.kind = kind;
  }
}

// ============================================================================
// Re-exports (so adapter consumers don't need separate imports)
// ============================================================================

export type {
  PdfInput,
  PdfClient,
  PdfDay,
  PdfMeal,
  PdfIngredient,
  PdfGroceryItem,
  PdfTip,
  WeekPlanSuccess,
};
