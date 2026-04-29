/**
 * Coach UI v2 — shared types.
 */

export interface PlanRow {
  id: number;
  client_id: number;
  version: number | null;
  version_number: number | null;
  pdf_path: string | null;
  audit_results: unknown;
  build_type: string;
  dietary_style: string | null;
  allergy_flags: string[] | null;
  medical_flags: string[] | null;
  plan_complexity: string | null;
  distribution_template: string | null;
  created_at: string;
  created_by: string | null;
  template_id: string | null;
  coach_review_recommended: boolean;
  complexity_reasons: string[] | null;
  parent_plan_id: number | null;
  manual_completion: boolean;
}

export interface PlanResponse {
  plan: PlanRow;
  pdf_signed_url: string | null;
  audit_summary: {
    pass: boolean;
    action: string | null;
    blocking_count: number;
    warning_count: number;
  } | null;
}

export interface ClientPlansListItem {
  plan_id: number;
  version: number | null;
  version_number: number | null;
  created_at: string;
  created_by: string | null;
  template_id: string | null;
  parent_plan_id: number | null;
  coach_review_recommended: boolean;
  manual_completion: boolean;
  status: "clean" | "coach_review" | "blocked" | "manual";
  pdf_signed_url: string | null;
}

export interface CoachClientLite {
  id: number;
  name: string | null;
  email: string | null;
}

export type PanelMode = "pending" | "done";
