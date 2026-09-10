"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarCheck, Loader2 } from "lucide-react";
import { getEffectiveDates } from "./FilterBar";
import type { Filters } from "../types";

/* ── Types (mirror lib/sales-hub/sets-booked.ts) ──────────────────── */

interface SetRow {
  madeAt: string;
  madeEtDay: string;
  leadName: string;
  callType: string | null;
  callEtDay: string | null;
  setterKey: string;
  setterLabel: string;
  status: string | null;
}

interface SetsBookedResult {
  team: number;
  bySetter: { key: string; label: string; count: number }[];
  byDay: { etDay: string; count: number }[];
  rows: SetRow[];
  asOf: string;
}

const ROW_LIMIT = 25;

function fmtMadeAt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const CALL_TYPE_LABELS: Record<string, string> = {
  dm: "Strategy Session",
  onboarding: "Onboarding",
  outbound: "Outbound",
};

/* ── Component ────────────────────────────────────────────────────── */

export default function SetsBooked({ filters }: { filters: Filters }) {
  const [data, setData] = useState<SetsBookedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    const { dateFrom, dateTo } = getEffectiveDates(filters);
    try {
      const res = await fetch(`/api/sales-hub/sets-booked?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  return (
    <div className="section" style={{ marginBottom: 20 }}>
      <h2 className="section-title">
        <CalendarCheck size={16} />
        Sets Booked
        <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12 }}>
          — counted at the moment the lead scheduled
        </span>
      </h2>

      {loading ? (
        <div className="glass-static" style={{ padding: 28, display: "flex", justifyContent: "center" }}>
          <Loader2 size={18} className="spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : error || !data ? (
        <div className="glass-static" style={{ padding: 20, textAlign: "center", color: "var(--danger)", fontSize: 13 }}>
          Sets booked failed to load{error ? ` — ${error}` : ""}.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            <div className="glass-static metric-card" style={{ minWidth: 130 }}>
              <div className="metric-card-label">Sets in range</div>
              <div className="metric-card-value">{data.team}</div>
            </div>
            {data.bySetter.map((s) => (
              <div
                key={s.key}
                className="glass-static"
                style={{ padding: "8px 14px", fontSize: 13, display: "flex", gap: 8, alignItems: "baseline" }}
              >
                <span style={{ fontWeight: 600 }}>{s.label}</span>
                <span style={{ color: "var(--text-muted)" }}>{s.count}</span>
              </div>
            ))}
          </div>

          <div className="glass-static" style={{ overflow: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Booked At (ET)</th>
                  <th>Lead</th>
                  <th>Setter</th>
                  <th>Call Type</th>
                  <th>Call Day</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? data.rows : data.rows.slice(0, ROW_LIMIT)).map((r) => (
                  <tr key={`${r.madeAt}:${r.leadName}`}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtMadeAt(r.madeAt)}</td>
                    <td>{r.leadName}</td>
                    <td>{r.setterLabel}</td>
                    <td>{r.callType ? CALL_TYPE_LABELS[r.callType] || r.callType : "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{r.callEtDay || "—"}</td>
                    <td style={{ color: r.status === "cancelled" ? "var(--danger)" : undefined }}>
                      {r.status || "—"}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                      No sets booked in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {data.rows.length > ROW_LIMIT && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 0",
                  background: "none",
                  border: "none",
                  borderTop: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {showAll ? "Show fewer" : `Show all ${data.rows.length} sets`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
