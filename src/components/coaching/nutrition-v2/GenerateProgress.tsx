/**
 * Coach UI v2 — generation-in-progress display.
 * Shows current pipeline stage, slow-warning at 180s, hard-fail at 300s.
 */

"use client";

import React from "react";
import { Loader2, Clock, AlertCircle } from "lucide-react";
import type { JobPollState } from "./useNutritionJobPoll";

interface GenerateProgressProps {
  state: JobPollState;
  onCancel: () => Promise<void>;
}

export function GenerateProgress({ state, onCancel }: GenerateProgressProps) {
  if (state.timed_out) {
    return (
      <div
        style={{
          background: "rgba(239, 68, 68, 0.08)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: 8,
          padding: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "rgb(239, 68, 68)",
            fontWeight: 600,
            fontSize: 13,
            marginBottom: 6,
          }}
        >
          <AlertCircle size={14} />
          Generation timed out (5+ minutes)
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          The job ran longer than the 5-minute hard ceiling. The worker may
          still finish in the background — you can check back in a few
          minutes, or cancel and try again. If this keeps happening, contact
          an admin.
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              background: "rgba(239, 68, 68, 0.15)",
              color: "rgb(239, 68, 68)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Cancel job
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "rgba(99, 102, 241, 0.05)",
        border: "1px solid rgba(99, 102, 241, 0.25)",
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "var(--text-primary)",
          fontWeight: 600,
          fontSize: 13,
          marginBottom: 4,
        }}
      >
        <Loader2 size={14} className="spinner" style={{ animation: "spin 1.5s linear infinite" }} />
        {state.progress_label || "Starting…"}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        Best-of-3 architecture — runs ~30–50s. We poll every 2.5s.
      </div>

      {state.slow && (
        <div
          style={{
            marginTop: 10,
            padding: "6px 10px",
            background: "rgba(255, 179, 71, 0.1)",
            border: "1px solid rgba(255, 179, 71, 0.3)",
            borderRadius: 4,
            fontSize: 11,
            color: "rgb(255, 179, 71)",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Clock size={11} />
          Taking longer than usual — still running. Will hard-fail after 5 minutes.
        </div>
      )}

      {state.fetch_error && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--text-muted)",
            fontStyle: "italic",
          }}
        >
          (poll error: {state.fetch_error} — will retry)
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
