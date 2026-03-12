"use client";

import { useMemo } from "react";
import { Loader2, Trophy } from "lucide-react";
import { fmtDollars, fmtPercent, fmtNumber } from "@/lib/formatters";
import type { Filters, SheetRow } from "../types";

/* ── Types ────────────────────────────────────────────────────────── */

interface CloserPerformanceProps {
  filters: Filters;
  sheetData: SheetRow[] | null;
  loading: boolean;
  error: string;
}

interface CloserStats {
  name: string;
  callsBooked: number;
  callsTaken: number;
  showRate: number;
  wins: number;
  losses: number;
  closeRate: number;
  revenue: number;
  cash: number;
  aov: number;
  avgCallLength: string;
  pcfus: number;
  topObjection: string;
}

interface SetterQualityRow {
  setter: string;
  booked: number;
  taken: number;
  showRate: number;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

const CLOSERS = ["Broz", "Will", "Austin"];

function parseCallLength(len: string): number {
  if (!len || len.trim() === "") return 0;
  const parts = len.split(":");
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  }
  const n = parseFloat(len);
  return isNaN(n) ? 0 : n * 60;
}

function formatSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0:00";
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function computeCloserStats(rows: SheetRow[], closerName: string): CloserStats {
  const closerRows = rows.filter(
    (r) => r.closer?.trim().toLowerCase() === closerName.toLowerCase(),
  );

  const callsBooked = closerRows.length;
  const takenRows = closerRows.filter((r) => r.callTaken);
  const callsTaken = takenRows.length;
  const showRate = callsBooked > 0 ? (callsTaken / callsBooked) * 100 : 0;

  const wins = closerRows.filter((r) => r.outcome === "WIN").length;
  const losses = closerRows.filter((r) => r.outcome === "LOST").length;
  const pcfus = closerRows.filter((r) => r.outcome === "PCFU").length;
  const denominator = wins + losses + pcfus;
  const closeRate = denominator > 0 ? (wins / denominator) * 100 : 0;

  const winRows = closerRows.filter((r) => r.outcome === "WIN");
  const revenue = winRows.reduce((sum, r) => sum + r.revenue, 0);
  const cash = winRows.reduce((sum, r) => sum + r.cashCollected, 0);
  const aov = wins > 0 ? revenue / wins : 0;

  const callLengths = takenRows
    .map((r) => parseCallLength(r.callLength))
    .filter((s) => s > 0);
  const avgCallSeconds =
    callLengths.length > 0
      ? callLengths.reduce((a, b) => a + b, 0) / callLengths.length
      : 0;

  const objCounts: Record<string, number> = {};
  for (const r of closerRows) {
    const obj = r.objection?.trim();
    if (obj) objCounts[obj] = (objCounts[obj] || 0) + 1;
  }
  const topObjection =
    Object.keys(objCounts).length > 0
      ? Object.entries(objCounts).sort((a, b) => b[1] - a[1])[0][0]
      : "—";

  return {
    name: closerName,
    callsBooked,
    callsTaken,
    showRate,
    wins,
    losses,
    closeRate,
    revenue,
    cash,
    aov,
    avgCallLength: formatSeconds(avgCallSeconds),
    pcfus,
    topObjection,
  };
}

function getSetterQuality(
  rows: SheetRow[],
  closerName: string,
): SetterQualityRow[] {
  const closerRows = rows.filter(
    (r) => r.closer?.trim().toLowerCase() === closerName.toLowerCase(),
  );

  const setterMap: Record<string, { booked: number; taken: number }> = {};
  for (const r of closerRows) {
    const setter = r.setter?.trim() || "Unknown";
    if (!setterMap[setter]) setterMap[setter] = { booked: 0, taken: 0 };
    setterMap[setter].booked++;
    if (r.callTaken) setterMap[setter].taken++;
  }

  return Object.entries(setterMap)
    .map(([setter, stats]) => ({
      setter,
      booked: stats.booked,
      taken: stats.taken,
      showRate: stats.booked > 0 ? (stats.taken / stats.booked) * 100 : 0,
    }))
    .sort((a, b) => b.booked - a.booked);
}

/* ── Top performer detection ──────────────────────────────────────── */

function findTopPerformer(
  stats: CloserStats[],
  key: keyof CloserStats,
): string | null {
  if (stats.length === 0) return null;
  const validStats = stats.filter((s) => s.callsBooked > 0);
  if (validStats.length === 0) return null;
  const top = validStats.reduce((best, s) => {
    const bestVal = best[key] as number;
    const sVal = s[key] as number;
    return sVal > bestVal ? s : best;
  });
  const topVal = top[key] as number;
  return topVal > 0 ? top.name : null;
}

/* ── Rate color helper ────────────────────────────────────────────── */

function rateColor(rate: number): string {
  return rate >= 70 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)";
}

/* ── Component ────────────────────────────────────────────────────── */

export default function CloserPerformance({
  sheetData,
  loading,
  error,
}: CloserPerformanceProps) {
  const closerStats = useMemo(() => {
    if (!sheetData) return [];
    return CLOSERS.map((name) => computeCloserStats(sheetData, name)).filter(
      (s) => s.callsBooked > 0,
    );
  }, [sheetData]);

  const topPerformers = useMemo(() => {
    if (closerStats.length === 0) return {} as Record<string, string | null>;
    return {
      showRate: findTopPerformer(closerStats, "showRate"),
      closeRate: findTopPerformer(closerStats, "closeRate"),
      cash: findTopPerformer(closerStats, "cash"),
      aov: findTopPerformer(closerStats, "aov"),
    };
  }, [closerStats]);

  const setterQualityData = useMemo(() => {
    if (!sheetData) return {} as Record<string, SetterQualityRow[]>;
    const result: Record<string, SetterQualityRow[]> = {};
    for (const s of closerStats) {
      result[s.name] = getSetterQuality(sheetData, s.name);
    }
    return result;
  }, [sheetData, closerStats]);

  /* ── Loading state ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="section">
        <div
          className="glass-static"
          style={{
            padding: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
        </div>
      </div>
    );
  }

  /* ── Error state ────────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="section">
        <div
          className="glass-static"
          style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}
        >
          Failed to load closer data: {error}
        </div>
      </div>
    );
  }

  /* ── Empty state ────────────────────────────────────────────────── */
  if (closerStats.length === 0) {
    return (
      <div className="section">
        <div
          className="glass-static"
          style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}
        >
          No closer data available for this period.
        </div>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div>
      {/* Closer Cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(closerStats.length, 3)}, 1fr)`,
        gap: 16,
      }}>
        {closerStats.map((s) => {
          const isTopCash = topPerformers.cash === s.name;
          const sqRows = setterQualityData[s.name] || [];

          return (
            <div key={s.name} className="glass-static" style={{ padding: "22px 24px" }}>
              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 18,
              }}>
                <span style={{
                  fontSize: 18, fontWeight: 700, color: "var(--text-primary)",
                  letterSpacing: "-0.3px",
                }}>
                  {s.name}
                </span>
                {isTopCash && (
                  <span
                    className="status-badge status-active"
                    style={{ fontSize: 9, padding: "2px 8px" }}
                  >
                    TOP
                  </span>
                )}
              </div>

              {/* Cash Collected — hero stat */}
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontSize: 30, fontWeight: 700, color: "var(--success)",
                  letterSpacing: "-1px", lineHeight: 1,
                }}>
                  {fmtDollars(s.cash)}
                </div>
                <div style={{
                  fontSize: 11, color: "var(--text-muted)", fontWeight: 500,
                  marginTop: 6, textTransform: "uppercase", letterSpacing: "0.3px",
                }}>
                  Cash Collected
                </div>
              </div>

              {/* Close Rate */}
              <div style={{ marginBottom: 14 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                    Close Rate
                  </span>
                  <span style={{
                    fontSize: 16, fontWeight: 700, color: rateColor(s.closeRate),
                  }}>
                    {fmtPercent(s.closeRate)}
                  </span>
                </div>
                <div style={{
                  height: 5, background: "rgba(255,255,255,0.06)",
                  borderRadius: 3, overflow: "hidden", marginBottom: 6,
                }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(s.closeRate, 100)}%`,
                    background: rateColor(s.closeRate),
                    borderRadius: 3,
                    transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--success)" }}>{s.wins}W</span>
                  {" · "}
                  <span style={{ color: "var(--danger)" }}>{s.losses}L</span>
                  {" · "}
                  <span style={{ color: "var(--warning)" }}>{s.pcfus} PCFU</span>
                </div>
              </div>

              {/* Show Rate */}
              <div style={{ marginBottom: 16 }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginBottom: 6,
                }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                    Show Rate
                  </span>
                  <span style={{
                    fontSize: 16, fontWeight: 700, color: rateColor(s.showRate),
                  }}>
                    {fmtPercent(s.showRate)}
                  </span>
                </div>
                <div style={{
                  height: 5, background: "rgba(255,255,255,0.06)",
                  borderRadius: 3, overflow: "hidden", marginBottom: 6,
                }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(s.showRate, 100)}%`,
                    background: rateColor(s.showRate),
                    borderRadius: 3,
                    transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {s.callsTaken}/{s.callsBooked} showed
                </div>
              </div>

              {/* Supporting stats */}
              <div style={{
                display: "flex", gap: 12, flexWrap: "wrap",
                padding: "12px 0 0", borderTop: "1px solid var(--border-subtle)",
                fontSize: 12, color: "var(--text-secondary)",
              }}>
                <span>
                  AOV{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{fmtDollars(s.aov)}</strong>
                </span>
                <span>
                  Avg{" "}
                  <strong style={{ color: "var(--text-primary)" }}>{s.avgCallLength}</strong>
                </span>
                <span style={{
                  padding: "2px 8px", borderRadius: 4,
                  background: "rgba(255,255,255,0.04)", fontSize: 11,
                }}>
                  {s.topObjection}
                </span>
              </div>

              {/* Setter Quality (inline compact) */}
              {sqRows.length > 0 && (
                <div style={{
                  marginTop: 14, padding: "12px 0 0",
                  borderTop: "1px solid var(--border-subtle)",
                }}>
                  <div style={{
                    fontSize: 10, color: "var(--text-muted)", fontWeight: 600,
                    textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8,
                  }}>
                    Setter Quality
                  </div>
                  {sqRows.map((sq) => (
                    <div key={sq.setter} style={{
                      display: "flex", justifyContent: "space-between",
                      fontSize: 12, marginBottom: 4, color: "var(--text-secondary)",
                    }}>
                      <span style={{ fontWeight: 500 }}>{sq.setter}</span>
                      <span>
                        {sq.taken}/{sq.booked}{" "}
                        <strong style={{ color: rateColor(sq.showRate) }}>
                          {fmtPercent(sq.showRate)}
                        </strong>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
