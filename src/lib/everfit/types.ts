export type Priority = "Urgent" | "Follow up" | "Steady";
export type MatchStatus =
  "Email verified" | "Name candidate" | "Email conflict" | "Unmatched";
export interface ClientSnapshot {
  id: number;
  name: string;
  email: string | null;
  coach_name: string | null;
  program: string | null;
  start_date: string | null;
  end_date: string | null;
  status: string | null;
}
export interface EverfitBrief {
  everfit_id: string;
  name: string;
  everfit_owner: string;
  ccos_candidate_id: number | null;
  linked_client_id: number | null;
  match_status: MatchStatus;
  email: string | null;
  summary: string;
  next_step: string;
  issue: string;
  priority: Priority;
  action_owner: string;
  suggested_due: string;
  end_date: string | null;
  training_7d_pct: number | null;
  training_30d_pct: number | null;
  tasks_7d_pct: number | null;
  last_app_access_display: string | null;
  activity_observed_minimum: Record<
    | "workout_log_events"
    | "added_meal_events"
    | "task_completion_events"
    | "community_posts",
    number
  >;
  ccos_snapshot: ClientSnapshot | null;
}
export interface EverfitReport {
  schema_version: 1;
  coach_name: string;
  review_date: string;
  window_start: string | null;
  window_end: string | null;
  timezone: "Asia/Karachi";
  precision: string;
  preliminary: boolean;
  coverage_notes: string[];
  clients: EverfitBrief[];
}
export interface StoredReport {
  id: string;
  coach_name: string;
  review_date: string;
  imported_at: string;
  preliminary: boolean;
  client_count: number;
  document?: EverfitReport;
}
export interface AccessContext {
  email: string;
  admin: boolean;
  coaches: string[];
}
export interface ReportDetail {
  report: StoredReport & { document: EverfitReport };
  currentClients: ClientSnapshot[];
}
