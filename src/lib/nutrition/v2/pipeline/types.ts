/**
 * Phase B6a — pipeline runner public types.
 *
 * Inputs the worker assembles from the job row + intake, plus the
 * structured error classes the runner throws.
 */

import type {
  AllergyFlag,
  BuildType,
  DietaryStyle,
  DistributionTemplateId,
  MedicalFlag,
  PlanComplexity,
} from "../types";
import type { AuditResult } from "../audit";

// ============================================================================
// Inputs
// ============================================================================

/**
 * The structured request body the POST endpoint accepts. Stored verbatim
 * in nutrition_plan_jobs.inputs so the run is reproducible.
 */
export interface JobRequestInputs {
  client_id: number;
  /** Intake form has no sex field (legacy v1 also defaults to "male" with
   *  a comment-directive override). For B6a, debug UI exposes this as an
   *  explicit radio input. B6b will move it onto the client/intake schema. */
  sex: "male" | "female";
  /** Activity level. Intake form's free-text "fitness_goal" / "daily_meals"
   *  fields don't reliably encode activity. Coach picks. */
  activity_level: "sedentary" | "light" | "moderate" | "high" | "very_high";
  build_type: BuildType;
  allergy_flags: AllergyFlag[];
  medical_flags: MedicalFlag[];
  dietary_style: DietaryStyle | null;
  plan_complexity: PlanComplexity;
  distribution_template: DistributionTemplateId;
  /** When omitted: all 7 days are training. Endurance UI lets coach toggle. */
  day_kinds?: Array<"training" | "rest">;
  /** Override stimulant boolean if the medication parser misses it. */
  on_stimulant?: boolean;
  /** Optional reason field surfaced in coach diagnostics; ignored by runner. */
  reason_for_generation?: string;
}

// ============================================================================
// Pipeline outputs (returned by run-pipeline; written to job row by worker)
// ============================================================================

export interface PipelineSuccess {
  kind: "success";
  plan_id: number;
  pdf_path: string;
  pdf_signed_url: string;
  audit: AuditResult;
  /** Generation diagnostics blob from B3 orchestrator. */
  diagnostics: unknown;
  /** Per-stage timings (ms) for telemetry. */
  stage_timings: Record<string, number>;
}

export interface PipelineFailure {
  kind: "failure";
  error_kind: PipelineErrorKind;
  error_details: Record<string, unknown>;
  /** When set, we DID persist a partial plan_row (audit_blocked case). */
  plan_id?: number;
  audit?: AuditResult;
  diagnostics?: unknown;
  stage_timings: Record<string, number>;
}

export type PipelineResult = PipelineSuccess | PipelineFailure;

export type PipelineErrorKind =
  | "intake_invalid"
  | "pick_error"
  | "solver_infeasible"
  | "audit_blocked"
  | "storage_error"
  | "db_error"
  | "cancelled"
  | "unexpected";

// ============================================================================
// Error classes (caught + repackaged by run-pipeline)
// ============================================================================

export class PipelineCancelledError extends Error {
  constructor() {
    super("Pipeline cancelled by user");
    this.name = "PipelineCancelledError";
  }
}
