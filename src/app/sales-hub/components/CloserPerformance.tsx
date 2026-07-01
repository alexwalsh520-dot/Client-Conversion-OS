"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Loader2,
  Trophy,
  Users,
  Banknote,
  BarChart3,
  TrendingUp,
  Phone,
  PhoneCall,
  XCircle,
} from "lucide-react";
import { fmtDollars, fmtPercent, fmtNumber } from "@/lib/formatters";
import type { Filters, SheetRow } from "../types";
import { CALL_CATEGORIES, rowsForCategory } from "./callType";

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
  upcoming: number;
  showRate: number;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

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

// Cash collected on a row means the call happened and closed — count it as
// "taken" even if the Call Taken column still says No (just never updated).
function isTaken(r: SheetRow): boolean {
  return r.callTakenStatus === "yes" || r.cashCollected > 0;
}

function statsFromRows(rows: SheetRow[]): Omit<CloserStats, "name"> {
  const closerRows = rows;

  const callsBooked = closerRows.length;
  const takenRows = closerRows.filter(isTaken);
  const noShowRows = closerRows.filter((r) => r.callTakenStatus === "no" && !isTaken(r));
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

function computeCloserStats(rows: SheetRow[], closerName: string): CloserStats {
  const closerRows = rows.filter(
    (r) => r.closer?.trim().toLowerCase() === closerName.toLowerCase(),
  );
  return { name: closerName, ...statsFromRows(closerRows) };
}

function getSetterQuality(
  rows: SheetRow[],
  closerName: string,
): SetterQualityRow[] {
  const closerRows = rows.filter(
    (r) => r.closer?.trim().toLowerCase() === closerName.toLowerCase(),
  );

  const setterMap: Record<string, { booked: number; taken: number; upcoming: number; noShows: number }> = {};
  for (const r of closerRows) {
    const setter = r.setter?.trim() || "Unknown";
    if (!setterMap[setter]) setterMap[setter] = { booked: 0, taken: 0, upcoming: 0, noShows: 0 };
    setterMap[setter].booked++;
    if (r.callTakenStatus === "yes") setterMap[setter].taken++;
    if (r.callTakenStatus === "pending") setterMap[setter].upcoming++;
    if (r.callTakenStatus === "no") setterMap[setter].noShows++;
  }

  return Object.entries(setterMap)
    .map(([setter, stats]) => ({
      setter,
      booked: stats.booked,
      taken: stats.taken,
      upcoming: stats.upcoming,
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
    // Derive the closer list straight from the sheet's Closer column so new
    // closers appear automatically — no hardcoded roster to keep in sync.
    const byKey = new Map<string, string>(); // lowercased -> display name
    for (const r of sheetData) {
      const raw = (r.closer || "").trim();
      if (!raw) continue;
      const key = raw.toLowerCase();
      if (!byKey.has(key)) {
        byKey.set(key, raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase());
      }
    }
    return Array.from(byKey.values())
      .map((name) => computeCloserStats(sheetData, name))
      .filter((s) => s.callsBooked > 0)
      .sort((a, b) => b.cash - a.cash);
  }, [sheetData]);

  const aggregated = useMemo(() => {
    if (!sheetData) return null;
    const callsBooked = sheetData.length;
    const takenRows = sheetData.filter(isTaken);
    const callsTaken = takenRows.length;
    const noShows = sheetData.filter((r) => r.callTakenStatus === "no" && !isTaken(r)).length;
    const showDenominator = callsTaken + noShows;
    const showRate = showDenominator > 0 ? (callsTaken / showDenominator) * 100 : 0;
    const winRows = takenRows.filter((r) => r.outcome === "WIN");
    const wins = winRows.length;
    const losses = takenRows.filter((r) => r.outcome !== "WIN").length;
    const closeRate = callsTaken > 0 ? (wins / callsTaken) * 100 : 0;
    const cashCollected = winRows.reduce((sum, r) => sum + r.cashCollected, 0);
    const aov = wins > 0 ? cashCollected / wins : 0;
    return { callsBooked, callsTaken, showRate, wins, losses, closeRate, cashCollected, aov };
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

  const [openCloser, setOpenCloser] = useState<string | null>(null);
  const [showAggBreakdown, setShowAggBreakdown] = useState(false);

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

      {aggregated && (
        <>
          <div className="metric-grid metric-grid-4" style={{ marginBottom: 12 }}>
            <SummaryStat icon={<Banknote size={12} style={{ color: "var(--success)" }} />} label="Cash on Calls" value={fmtDollars(aggregated.cashCollected)} color="var(--success)" />
            <SummaryStat icon={<BarChart3 size={12} style={{ color: "var(--success)" }} />} label="AOV" value={fmtDollars(aggregated.aov)} color="var(--success)" />
            <SummaryStat icon={<TrendingUp size={12} style={{ color: "var(--accent)" }} />} label="Close Rate" value={fmtPercent(aggregated.closeRate)} />
            <SummaryStat icon={<TrendingUp size={12} style={{ color: "var(--accent)" }} />} label="Show Rate" value={fmtPercent(aggregated.showRate)} />
          </div>
          <div className="metric-grid metric-grid-4" style={{ marginBottom: 20 }}>
            <SummaryStat icon={<Phone size={12} style={{ color: "var(--accent)" }} />} label="Calls Booked" value={fmtNumber(aggregated.callsBooked)} />
            <SummaryStat icon={<PhoneCall size={12} style={{ color: "var(--accent)" }} />} label="Calls Taken" value={fmtNumber(aggregated.callsTaken)} />
            <SummaryStat icon={<Trophy size={12} style={{ color: "var(--success)" }} />} label="Wins" value={fmtNumber(aggregated.wins)} color="var(--success)" />
            <SummaryStat icon={<XCircle size={12} style={{ color: "var(--danger)" }} />} label="Losses" value={fmtNumber(aggregated.losses)} color="var(--danger)" />
          </div>

          <button
            onClick={() => setShowAggBreakdown((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: showAggBreakdown ? 12 : 20,
            }}
          >
            <span style={{ fontSize: 9 }}>{showAggBreakdown ? "\u25be" : "\u25b8"}</span>
            Breakdown by call type
          </button>
          {showAggBreakdown && (
            <div className="glass-static" style={{ overflow: "auto", marginBottom: 20 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Call Type</th>
                    <th>Cash</th>
                    <th>AOV</th>
                    <th>Close Rate</th>
                    <th>Show Rate</th>
                    <th>Booked</th>
                    <th>Taken</th>
                    <th>Wins</th>
                    <th>Losses</th>
                  </tr>
                </thead>
                <tbody>
                  {CALL_CATEGORIES.map((cat) => {
                    const m = statsFromRows(rowsForCategory(sheetData || [], cat.key));
                    return (
                      <tr key={cat.key}>
                        <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{cat.label}</td>
                        <td style={{ color: "var(--success)" }}>{fmtDollars(m.cash)}</td>
                        <td>{fmtDollars(m.aov)}</td>
                        <td>{fmtPercent(m.closeRate)}</td>
                        <td>{fmtPercent(m.showRate)}</td>
                        <td>{fmtNumber(m.callsBooked)}</td>
                        <td>{fmtNumber(m.callsTaken)}</td>
                        <td style={{ color: "var(--success)" }}>{fmtNumber(m.wins)}</td>
                        <td style={{ color: "var(--danger)" }}>{fmtNumber(m.losses)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

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
            {closerStats.map((s) => {
              const isOpen = openCloser === s.name;
              const closerRows = (sheetData || []).filter(
                (r) => r.closer?.trim().toLowerCase() === s.name.toLowerCase(),
              );
              return (
                <Fragment key={s.name}>
                  <tr onClick={() => setOpenCloser(isOpen ? null : s.name)} style={{ cursor: "pointer" }}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      <span style={{ display: "inline-block", width: 12, color: "var(--text-muted)" }}>{isOpen ? "\u25be" : "\u25b8"}</span>
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
                      style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      title={s.topObjection}
                    >
                      {s.topObjection}
                    </td>
                  </tr>
                  {isOpen &&
                    CALL_CATEGORIES.map((cat) => {
                      const m = statsFromRows(rowsForCategory(closerRows, cat.key));
                      return (
                        <tr key={s.name + cat.key} style={{ background: "rgba(127,127,127,0.06)" }}>
                          <td style={{ paddingLeft: 28, color: "var(--text-secondary)", fontSize: 12 }}>{cat.label}</td>
                          <td style={{ color: "var(--success)" }}>{fmtDollars(m.cash)}</td>
                          <td>{fmtDollars(m.aov)}</td>
                          <td>{fmtPercent(m.closeRate)}</td>
                          <td>{fmtPercent(m.showRate)}</td>
                          <td>{fmtNumber(m.callsBooked)}</td>
                          <td>{fmtNumber(m.callsTaken)}</td>
                          <td style={{ color: "var(--success)" }}>{fmtNumber(m.wins)}</td>
                          <td style={{ color: "var(--danger)" }}>{fmtNumber(m.losses)}</td>
                          <td>{m.avgCallLength}</td>
                          <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.topObjection}>{m.topObjection}</td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
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
          className="setter-quality-grid"
          style={{
            display: "grid",
            gap: 16,
          }}
        >
          {closerStats.map((closer) => {
            const rows = setterQualityData[closer.name] || [];
            return (
              <div
                key={closer.name}
                className="glass-static setter-quality-card"
              >
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
                <div className="setter-quality-scroll">
                  <table className="setter-quality-table">
                    <thead>
                      <tr>
                        <th>Setter</th>
                        <th>Booked</th>
                        <th>Taken</th>
                        <th>Upcoming</th>
                        <th>Show Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="setter-quality-empty">
                            No data
                          </td>
                        </tr>
                      ) : (
                        rows.map((sq) => (
                          <tr key={sq.setter}>
                            <td>{sq.setter}</td>
                            <td>{fmtNumber(sq.booked)}</td>
                            <td>{fmtNumber(sq.taken)}</td>
                            <td>{fmtNumber(sq.upcoming)}</td>
                            <td>{fmtPercent(sq.showRate)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SummaryStat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="glass-static metric-card">
      <div
        className="metric-card-label"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {icon}
        {label}
      </div>
      <div className="metric-card-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}
