"use client";

/**
 * Daily Coacher: Recent Check-Ins section.
 *
 * Lives in the per-client view between the Daily Coacher Usage Score
 * row and the Topic Selector. Shows the most recent N (default 5)
 * weekly check-in submissions: date, overall score, and the optional
 * paragraph if the client wrote one.
 *
 * Data comes in as a prop (fetched server-side in
 * src/app/coaching/daily-coacher/[clientId]/page.tsx) so no client
 * fetch happens here. Keeps initial paint snappy.
 *
 * Empty state: helpful note so coaches understand why this is blank.
 */

import { ClipboardCheck } from "lucide-react";
import type { CheckInRow } from "@/lib/daily-coacher/summary-inputs";

interface Props {
  checkIns: CheckInRow[]; // newest first
  /** How many to show inline. Older are summarized as "+N more". */
  limit?: number;
}

function scoreColor(score: number): string {
  if (score >= 75) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--danger)";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function RecentCheckIns({ checkIns, limit = 5 }: Props) {
  const visible = checkIns.slice(0, limit);
  const hiddenCount = Math.max(0, checkIns.length - limit);

  return (
    <div
      className="glass-static"
      style={{ padding: 16 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <ClipboardCheck size={14} style={{ color: "var(--accent)" }} />
        <h3
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            margin: 0,
          }}
        >
          Recent Check-Ins
        </h3>
        <span
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            marginLeft: "auto",
          }}
        >
          {checkIns.length} total
        </span>
      </div>

      {visible.length === 0 ? (
        <div
          style={{
            padding: 12,
            color: "var(--text-muted)",
            fontSize: 13,
            fontStyle: "italic",
            textAlign: "center",
          }}
        >
          No check-in forms submitted yet. Send the client the /check-in
          link weekly via Everfit.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visible.map((ci, idx) => (
            <div
              key={`${ci.submitted_at}-${idx}`}
              style={{
                padding: 10,
                borderRadius: 6,
                background: "var(--bg-card)",
                border: "1px solid var(--border-primary)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: ci.q5_open_response ? 8 : 0,
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {formatDate(ci.submitted_at)}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: scoreColor(ci.score_0_100),
                  }}
                >
                  {ci.score_0_100}/100
                </span>
              </div>
              {ci.q5_open_response && (
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    borderLeft: "2px solid var(--accent)",
                    paddingLeft: 10,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {ci.q5_open_response}
                </div>
              )}
            </div>
          ))}
          {hiddenCount > 0 && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                textAlign: "center",
                padding: 6,
              }}
            >
              +{hiddenCount} older submission{hiddenCount === 1 ? "" : "s"} (open Client Progress tab to see all)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
