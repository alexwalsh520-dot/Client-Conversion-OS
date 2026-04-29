/**
 * Coach UI v2 (B6c) — shared types.
 * Simplified post-rip-out: no more coach_review affordances.
 */

export interface PlanRow {
  id: number;
  client_id: number;
  version: number | null;
  version_number: number | null;
  pdf_path: string | null;
  uploaded_pdf_path: string | null;
  uploaded_by: string | null;
  created_at: string;
  created_by: string | null;
  template_id: string | null;
}

export interface PlanResponse {
  plan: PlanRow;
  pdf_signed_url: string | null;
  is_uploaded: boolean;
}

export interface ClientPlansListItem {
  plan_id: number;
  version: number | null;
  version_number: number | null;
  created_at: string;
  created_by: string | null;
  uploaded_by: string | null;
  is_uploaded: boolean;
  template_id: string | null;
  pdf_signed_url: string | null;
}

export interface CoachClientLite {
  id: number;
  name: string | null;
  email: string | null;
}

export type PanelMode = "pending" | "done";
