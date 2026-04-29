/**
 * Coach UI v2 — amber "Coach review recommended" banner with expandable
 * "Why was this flagged?" section.
 */

"use client";

import React, { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";

const COMPLEXITY_REASON_COPY: Record<string, string> = {
  macro_retry_required:
    "Plan needed a retry to land within macro tolerances",
  high_cal_build:
    "High-calorie build (≥2900 kcal) — system has lower confidence on these",
  audit_warnings_present:
    "Audit flagged some warnings on this plan",
  sodium_near_ceiling:
    "One or more days are near the daily sodium ceiling",
  anchor_at_frequency_cap:
    "A protein anchor is used at the maximum allowed frequency this week",
};

interface AuditWarning {
  severity: "BLOCK" | "WARN";
  check: string;
  day?: number;
  meal?: number;
  ingredient?: string;
  details?: Record<string, unknown>;
  reason: string;
}

interface CoachReviewBannerProps {
  complexityReasons: string[];
  auditWarnings: AuditWarning[];
  /** Top N audit warnings to surface. Default 5. */
  topN?: number;
}

export function CoachReviewBanner({
  complexityReasons,
  auditWarnings,
  topN = 5,
}: CoachReviewBannerProps) {
  const [expanded, setExpanded] = useState(false);

  const sorted = [...auditWarnings].sort((a, b) => {
    // Prefer day-scoped warnings first, then severity, then drift_pct magnitude.
    const aHasDay = a.day != null ? 0 : 1;
    const bHasDay = b.day != null ? 0 : 1;
    if (aHasDay !== bHasDay) return aHasDay - bHasDay;
    const aPct = Math.abs(Number((a.details as { drift_pct?: number })?.drift_pct ?? 0));
    const bPct = Math.abs(Number((b.details as { drift_pct?: number })?.drift_pct ?? 0));
    return bPct - aPct;
  });
  const topWarnings = sorted.slice(0, topN);
  const remaining = Math.max(0, auditWarnings.length - topN);

  return (
    <div
      style={{
        background: "rgba(255, 179, 71, 0.12)",
        border: "1px solid rgba(255, 179, 71, 0.35)",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 12,
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "none",
          border: "none",
          color: "rgb(255, 179, 71)",
          cursor: "pointer",
          padding: 0,
          fontSize: 13,
          fontWeight: 600,
          width: "100%",
          textAlign: "left",
        }}
      >
        <AlertTriangle size={14} />
        <span style={{ flex: 1 }}>Coach review recommended for this plan</span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <div style={{ marginTop: 10, paddingLeft: 22, fontSize: 12 }}>
          <div
            style={{
              color: "var(--text-primary)",
              fontWeight: 600,
              marginBottom: 6,
              fontSize: 12,
            }}
          >
            Trigger reasons:
          </div>
          <ul style={{ margin: 0, paddingLeft: 14, color: "var(--text-muted)" }}>
            {complexityReasons.length === 0 && (
              <li>No specific trigger captured.</li>
            )}
            {complexityReasons.map((r) => (
              <li key={r} style={{ marginBottom: 2 }}>
                {COMPLEXITY_REASON_COPY[r] ?? r}
              </li>
            ))}
          </ul>

          {topWarnings.length > 0 && (
            <>
              <div
                style={{
                  color: "var(--text-primary)",
                  fontWeight: 600,
                  marginTop: 12,
                  marginBottom: 6,
                  fontSize: 12,
                }}
              >
                Top issues from the audit{remaining > 0 ? ` (showing ${topN} of ${auditWarnings.length})` : ""}:
              </div>
              <ul
                style={{
                  margin: 0,
                  paddingLeft: 14,
                  color: "var(--text-muted)",
                }}
              >
                {topWarnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {humanize(w)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function humanize(w: AuditWarning): string {
  // Audit's own `reason` strings are already coach-readable; just surface them
  // with the day prefix kept compact.
  return w.reason;
}
