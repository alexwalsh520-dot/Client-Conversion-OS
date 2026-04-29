/**
 * Coach UI — job polling hook for the v2 generate flow.
 *
 * Polls GET /api/nutrition/v2/jobs/:job_id every 2.5s until terminal.
 * Two timeouts:
 *   - WARN at 180s : surface "taking longer than usual" but keep polling
 *   - HARD at 300s : stop polling, expose hard-error state with cancel CTA
 *
 * Stage strings from the worker map to coach-friendly progress copy.
 */

"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type JobStatus =
  | "pending"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

export interface JobPollState {
  status: JobStatus | null;
  current_step: string | null;
  /** Human-friendly stage label for UI display. */
  progress_label: string;
  plan_id: number | null;
  pdf_signed_url: string | null;
  error_kind: string | null;
  error_details: unknown;
  /** True once elapsed > WARN threshold but < HARD. */
  slow: boolean;
  /** True once elapsed > HARD threshold. Polling has stopped. */
  timed_out: boolean;
  /** Generic JS errors (network etc.) */
  fetch_error: string | null;
}

const POLL_INTERVAL_MS = 2_500;
const WARN_AFTER_MS = 180_000;
const HARD_AFTER_MS = 300_000;

const STAGE_LABELS: Record<string, string> = {
  loading_intake: "Reading intake form…",
  calculating_macros: "Calculating macro targets…",
  generating_plan: "Generating 3 plan options in parallel…",
  scoring_plans: "Scoring and selecting best plan…",
  retrying_plan: "Refining plan…",
  verifying_macros: "Verifying daily macros…",
  auditing: "Auditing for safety constraints…",
  adapting_for_pdf: "Building PDF input…",
  rendering_pdf: "Rendering PDF…",
  uploading: "Uploading PDF…",
  persisting: "Saving plan…",
};

function labelFor(step: string | null, status: JobStatus | null): string {
  if (status === "complete") return "Done.";
  if (status === "failed") return "Failed.";
  if (status === "cancelled") return "Cancelled.";
  if (!step) return status === "running" ? "Starting…" : "Queued — waiting for worker…";
  return STAGE_LABELS[step] ?? step;
}

export function useNutritionJobPoll(jobId: number | null): {
  state: JobPollState;
  cancel: () => Promise<void>;
} {
  const [state, setState] = useState<JobPollState>({
    status: null,
    current_step: null,
    progress_label: "",
    plan_id: null,
    pdf_signed_url: null,
    error_kind: null,
    error_details: null,
    slow: false,
    timed_out: false,
    fetch_error: null,
  });

  const startedAtRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const cancel = useCallback(async () => {
    if (jobId == null) return;
    try {
      await fetch(`/api/nutrition/v2/jobs/${jobId}`, { method: "DELETE" });
    } catch {
      // ignore — UI will reflect via next poll
    }
  }, [jobId]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (jobId == null) {
      stopPolling();
      return;
    }
    startedAtRef.current = Date.now();
    abortRef.current = new AbortController();

    const tick = async () => {
      const elapsed = Date.now() - (startedAtRef.current ?? Date.now());
      // Hard timeout — stop polling, surface terminal state.
      if (elapsed > HARD_AFTER_MS) {
        stopPolling();
        if (isMountedRef.current) {
          setState((prev) => ({ ...prev, timed_out: true }));
        }
        return;
      }
      try {
        const res = await fetch(`/api/nutrition/v2/jobs/${jobId}`, {
          signal: abortRef.current?.signal,
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        if (!isMountedRef.current) return;
        const status: JobStatus = data.status;
        const slow = elapsed > WARN_AFTER_MS && status !== "complete";
        setState({
          status,
          current_step: data.current_step ?? null,
          progress_label: labelFor(data.current_step ?? null, status),
          plan_id: data.plan_id ?? null,
          pdf_signed_url: data.pdf_signed_url ?? null,
          error_kind: data.error_kind ?? null,
          error_details: data.error_details ?? null,
          slow,
          timed_out: false,
          fetch_error: null,
        });
        if (
          status === "complete" ||
          status === "failed" ||
          status === "cancelled"
        ) {
          stopPolling();
        }
      } catch (e) {
        if (!isMountedRef.current) return;
        // Preserve last known status; surface the error in fetch_error.
        setState((prev) => ({
          ...prev,
          fetch_error: e instanceof Error ? e.message : String(e),
        }));
      }
    };

    // Kick off immediately, then on interval.
    tick();
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      stopPolling();
      abortRef.current?.abort();
    };
  }, [jobId, stopPolling]);

  return { state, cancel };
}
