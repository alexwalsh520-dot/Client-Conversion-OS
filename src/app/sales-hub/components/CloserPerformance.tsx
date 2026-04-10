"use client";

import { useMemo } from "react";
import { Loader2, Trophy, Users } from "lucide-react";
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
  cash: number;
  aov: number;
  avgCallLength: string;
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
  // Expects formats like "12:34" (mm:ss) or a raw number (minutes)
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
  const takenRows = closerRows.filter((r) => r.callTakenStatus === "yes");
  const noShowRows = closerRows.filter((r) => r.callTakenStatus === "no");
  const callsTaken = takenRows.length;
  const showDenominator = callsTaken + noShowRows.length;
  const showRate = showDenominator > 0 ? (callsTaken / showDenominator) * 100 : 0;

  const winRows = takenRows.filter((r) => r.outcome === "WIN");
  const wins = winRows.length;
  const losses = takenRows.filter((r) => r.outcome !== "WIN").length;
  const closeRate = callsTaken > 0 ? (wins / callsTaken) * 100 : 0;

  const cash = winRows.reduce((sum, r) => sum + r.cashCollected, 0);
  const aov = wins > 0 ? cash / wins : 0;

  // Average call length from taken calls
  const callLengths = takenRows
    .map((r) => parseCallLength(r.callLength))
    .filter((s) => s > 0);
  const avgCallSeconds =
    callLengths.length > 0
      ? callLengths.reduce((a, b) => a + b, 0) / callLengths.length
      : 0;

  // Top objection
  const objCounts: Record<string, number> = {};
  for (const r of takenRows) {
    const obj = r.objection?.trim();
    if (!obj) continue;
    const normalized = obj.toLowerCase();
    if (normalized === "none" || normalized === "n/a" || normalized === "na") continue;
    const label = obj.charAt(0).toUpperCase() + obj.slice(1);
    objCounts[label] = (objCounts[label] || 0) + 1;
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
    cash,
    aov,
    avgCallLength: formatSeconds(avgCallSeconds),
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

  const setterMap: Record<string, { booked: number; taken: number; noShows: number }> = {};
  for (const r of closerRows) {
    const setter = r.setter?.trim() || "Unknown";
    if (!setterMap[setter]) setterMap[setter] = { booked: 0, taken: 0, noShows: 0 };
    setterMap[setter].booked++;
    if (r.callTakenStatus === "yes") setterMap[setter].taken++;
    if (r.callTakenStatus === "no") setterMap[setter].noShows++;
  }

  return Object.entries(setterMap)
    .map(([setter, stats]) => ({
      setter,
      booked: stats.booked,
      taken: stats.taken,
      showRate:
        stats.taken + stats.noShows > 0
          ? (stats.taken / (stats.taken + stats.noShows)) * 100
          : 0,
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
        <h2 className="section-title">
          <Trophy size={16} />
          Closer Performance
        </h2>
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
        <h2 className="section-title">
          <Trophy size={16} />
          Closer Performance
        </h2>
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
        <h2 className="section-title">
          <Trophy size={16} />
          Closer Performance
        </h2>
        <div
          className="glass-static"
          style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}
        >
          No closer data available for this period.
        </div>
      </div>
    );
  }

  /* ── Render helper for top performer badge ──────────────────────── */
  function TopBadge({ show }: { show: boolean }) {
    if (!show) return null;
    return (
      <span
        className="status-badge status-active"
        style={{ marginLeft: 6, fontSize: 9, padding: "2px 8px" }}
      >
        TOP
      </span>
    );
  }

  return (
    <div className="section">
      <h2 className="section-title">
        <Trophy size={16} />
        Closer Performance
      </h2>

      {/* Main performance table */}
      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Closer</th>
              <th>Cash</th>
              <th>AOV</th>
              <th>Close Rate</th>
              <th>Show Rate</th>
              <th>Booked</th>
              <th>Taken</th>
              <th>Wins</th>
              <th>Losses</th>
              <th>Avg Call</th>
              <th>Top Objection</th>
            </tr>
          </thead>
          <tbody>
            {closerStats.map((s) => (
              <tr key={s.name}>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  {s.name}
                </td>
                <td style={{ color: "var(--success)" }}>
                  {fmtDollars(s.cash)}
                  <TopBadge show={topPerformers.cash === s.name} />
                </td>
                <td>
                  {fmtDollars(s.aov)}
                  <TopBadge show={topPerformers.aov === s.name} />
                </td>
                <td>
                  {fmtPercent(s.closeRate)}
                  <TopBadge show={topPerformers.closeRate === s.name} />
                </td>
                <td>
                  {fmtPercent(s.showRate)}
                  <TopBadge show={topPerformers.showRate === s.name} />
                </td>
                <td>{fmtNumber(s.callsBooked)}</td>
                <td>{fmtNumber(s.callsTaken)}</td>
                <td style={{ color: "var(--success)" }}>{fmtNumber(s.wins)}</td>
                <td style={{ color: "var(--danger)" }}>{fmtNumber(s.losses)}</td>
                <td>{s.avgCallLength}</td>
                <td
                  style={{
                    maxWidth: 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={s.topObjection}
                >
                  {s.topObjection}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Setter Quality sub-section */}
      <div style={{ marginTop: 24 }}>
        <h3
          className="section-title"
          style={{ fontSize: 12, marginBottom: 12 }}
        >
          <Users size={14} />
          Setter Quality by Closer
        </h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${Math.min(closerStats.length, 3)}, 1fr)`,
            gap: 16,
          }}
        >
          {closerStats.map((closer) => {
            const rows = setterQualityData[closer.name] || [];
            return (
              <div key={closer.name} className="glass-static" style={{ overflow: "hidden" }}>
                <div
                  style={{
                    padding: "12px 16px 8px",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-primary)",
                  }}
                >
                  {closer.name}
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Setter</th>
                      <th>Booked</th>
                      <th>Taken</th>
                      <th>Show Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          style={{ textAlign: "center", color: "var(--text-muted)" }}
                        >
                          No data
                        </td>
                      </tr>
                    ) : (
                      rows.map((sq) => (
                        <tr key={sq.setter}>
                          <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                            {sq.setter}
                          </td>
                          <td>{fmtNumber(sq.booked)}</td>
                          <td>{fmtNumber(sq.taken)}</td>
                          <td>{fmtPercent(sq.showRate)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
