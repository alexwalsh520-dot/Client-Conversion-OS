// ─────────────────────────────────────────────────────────────────────────
// ACCURACY (Build 3) — shared shapes.
//
// Every check MEASURES. Nothing in this folder writes a money number, edits a
// fact, or influences attribution. The only rows it writes are its own
// measurements (warehouse.accuracy_checks) and an alert when one comes back
// red, on the alert path that already exists.
// ─────────────────────────────────────────────────────────────────────────

import type { getServiceSupabase } from "@/lib/supabase";

export type Db = ReturnType<typeof getServiceSupabase>;

/** green: the numbers agree. amber: they differ for a written, understood
 *  reason. red: a real disagreement. error: the check itself could not run. */
export type CheckStatus = "green" | "amber" | "red" | "error";

export interface CheckOutcome {
  status: CheckStatus;
  leftLabel?: string;
  leftValue?: string;
  rightLabel?: string;
  rightValue?: string;
  diffValue?: string;
  /** Plain-English action, shown on the page whenever the row is not green. */
  whatToDo?: string;
  detail?: Record<string, unknown>;
}

export interface CheckContext {
  db: Db;
  now: Date;
  /** Today, Eastern time. Every window in this system is an ET day. */
  etDay: string;
  /** The creators v2 serves, read from the engine's roster, never hardcoded. */
  clients: string[];
}

export interface AccuracyCheck {
  key: string;
  /** What the row is called on the page, in plain words. */
  name: string;
  /** The judgement call in writing: what counts as amber, what counts as red.
   *  Stored on every row so no threshold is ever hidden from the owner. */
  toleranceNote: string;
  /** Wall-clock budget. A check that hangs is abandoned and recorded as an
   *  error; it can never delay or take down the other checks. */
  budgetMs: number;
  run(ctx: CheckContext): Promise<CheckOutcome>;
}

export interface StoredCheckRow {
  run_id: string;
  et_day: string;
  check_key: string;
  plain_english_name: string;
  status: CheckStatus;
  left_label: string | null;
  left_value: string | null;
  right_label: string | null;
  right_value: string | null;
  diff_value: string | null;
  tolerance_note: string;
  what_to_do: string | null;
  detail: Record<string, unknown>;
  ran_at: string;
}
