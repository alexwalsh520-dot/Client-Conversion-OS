/**
 * Coach UI v2 — Previous Plan Versions list. Collapsed by default.
 * Each row: version, timestamp, status badge, View PDF link.
 */

"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, AlertTriangle, CheckCircle, XCircle } from "lucide-react";
import type { ClientPlansListItem } from "./types";

interface PlanHistoryProps {
  clientId: number;
  /** Latest plan_id — excluded from history (it's the one already shown). */
  excludePlanId: number | null;
  /** Bumped externally to force re-fetch (e.g., after applying a correction). */
  refreshKey?: number;
}

export function PlanHistory({ clientId, excludePlanId, refreshKey }: PlanHistoryProps) {
  const [expanded, setExpanded] = useState(false);
  const [plans, setPlans] = useState<ClientPlansListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!expanded) return;
    setLoading(true);
    fetch(`/api/nutrition/v2/client/${clientId}/plans`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setPlans((data.plans as ClientPlansListItem[]) ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, expanded, refreshKey]);

  const filtered = plans.filter((p) => p.plan_id !== excludePlanId);

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          padding: 0,
          fontSize: 12,
        }}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Previous Plan Versions{filtered.length > 0 ? ` (${filtered.length})` : ""}
      </button>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          {loading ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Loading…
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              No prior versions for this client.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {filtered.map((p) => (
                <div
                  key={p.plan_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "6px 10px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 4,
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-primary)",
                      fontWeight: 600,
                      minWidth: 30,
                    }}
                  >
                    v{p.version_number ?? p.version}
                  </span>
                  <StatusBadge status={p.status} />
                  <span style={{ color: "var(--text-muted)", flex: 1 }}>
                    {p.created_at
                      ? new Date(p.created_at).toLocaleString()
                      : "—"}
                  </span>
                  {p.template_id === "coach_corrected" && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "rgb(255, 179, 71)",
                        background: "rgba(255, 179, 71, 0.1)",
                        padding: "1px 6px",
                        borderRadius: 4,
                      }}
                      title={
                        p.parent_plan_id
                          ? `Coach correction of plan ${p.parent_plan_id}`
                          : "Coach correction"
                      }
                    >
                      corrected
                    </span>
                  )}
                  {p.pdf_signed_url ? (
                    <a
                      href={p.pdf_signed_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        color: "var(--accent, #6366f1)",
                        textDecoration: "none",
                        fontSize: 11,
                      }}
                    >
                      <FileText size={11} /> View
                    </a>
                  ) : p.manual_completion ? (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      no PDF (manual)
                    </span>
                  ) : (
                    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      no PDF
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ClientPlansListItem["status"] }) {
  const map = {
    clean: { color: "var(--success, #22c55e)", label: "clean", Icon: CheckCircle },
    coach_review: { color: "rgb(255, 179, 71)", label: "review", Icon: AlertTriangle },
    blocked: { color: "var(--danger, #ef4444)", label: "blocked", Icon: XCircle },
    manual: { color: "var(--text-muted)", label: "manual", Icon: FileText },
  } as const;
  const { color, label, Icon } = map[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        fontWeight: 600,
      }}
    >
      <Icon size={11} />
      {label}
    </span>
  );
}
