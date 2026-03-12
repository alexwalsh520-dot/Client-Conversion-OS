"use client";

import { useMemo } from "react";
import { Loader2, Trophy, Crown, Flame, Zap, Target } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from "recharts";
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

  /* ── Leaderboard helpers ──────────────────────────────────────── */
  const ranked = useMemo(() => {
    return [...closerStats].sort((a, b) => b.cash - a.cash);
  }, [closerStats]);

  const podiumColors = ["#c9a96e", "#a0a0a0", "#cd7f32"]; // gold, silver, bronze
  const podiumLabels = (rank: number, s: CloserStats) => {
    if (rank === 0) return { icon: <Crown size={16} />, tag: "Top Earner", tagColor: "#c9a96e" };
    if (s.closeRate >= 60) return { icon: <Flame size={14} />, tag: "On Fire", tagColor: "#f97316" };
    if (s.showRate >= 80) return { icon: <Zap size={14} />, tag: "Reliable", tagColor: "#38bdf8" };
    return { icon: <Target size={14} />, tag: "Building", tagColor: "#6b7280" };
  };

  /* ── Chart data ────────────────────────────────────────────────── */
  const cashChartData = ranked.map((s) => ({
    name: s.name, cash: s.cash, closeRate: s.closeRate,
  }));

  const radarData = ranked.length > 0 ? [
    { metric: "Close %", ...Object.fromEntries(ranked.map((s) => [s.name, s.closeRate])) },
    { metric: "Show %", ...Object.fromEntries(ranked.map((s) => [s.name, s.showRate])) },
    { metric: "Calls", ...Object.fromEntries(ranked.map((s) => [s.name, Math.min(s.callsBooked * 5, 100)])) },
    { metric: "AOV", ...Object.fromEntries(ranked.map((s) => [s.name, Math.min(s.aov / 50, 100)])) },
    { metric: "Revenue", ...Object.fromEntries(ranked.map((s) => {
      const maxRev = Math.max(...ranked.map((r) => r.revenue));
      return [s.name, maxRev > 0 ? (s.revenue / maxRev) * 100 : 0];
    })) },
  ] : [];

  const radarColors = ["#c9a96e", "#82c5c5", "#b8a4d9"];

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div>
      {/* ── LEADERBOARD ────────────────────────────────────────────── */}
      <div className="glass-static" style={{ padding: "24px", marginBottom: 16 }}>
        <div style={{
          fontSize: 11, color: "var(--text-muted)", fontWeight: 600,
          textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 16,
        }}>
          Leaderboard
        </div>

        {/* Podium cards */}
        <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
          {ranked.map((s, i) => {
            const { icon, tag, tagColor } = podiumLabels(i, s);
            return (
              <div key={s.name} style={{
                flex: 1, padding: "18px 16px",
                background: i === 0 ? "rgba(201,169,110,0.08)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${i === 0 ? "rgba(201,169,110,0.3)" : "var(--border-subtle)"}`,
                borderRadius: 10, position: "relative", overflow: "hidden",
              }}>
                {/* Rank badge */}
                <div style={{
                  position: "absolute", top: 12, right: 12,
                  width: 26, height: 26, borderRadius: "50%",
                  background: podiumColors[i] || "#555",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 800, color: "#000",
                }}>
                  {i + 1}
                </div>

                {/* Trophy for #1 */}
                {i === 0 && (
                  <div style={{ marginBottom: 8 }}>
                    <Trophy size={22} style={{ color: "#c9a96e" }} />
                  </div>
                )}

                <div style={{
                  fontSize: 20, fontWeight: 700, color: "var(--text-primary)",
                  letterSpacing: "-0.3px", marginBottom: 4,
                }}>
                  {s.name}
                </div>

                {/* Fun tag */}
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  padding: "3px 10px", borderRadius: 20,
                  background: `${tagColor}18`, color: tagColor,
                  fontSize: 10, fontWeight: 600, marginBottom: 14,
                }}>
                  {icon} {tag}
                </div>

                {/* Hero cash */}
                <div style={{ fontSize: 28, fontWeight: 700, color: "var(--success)", letterSpacing: "-1px", lineHeight: 1 }}>
                  {fmtDollars(s.cash)}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                  Cash Collected
                </div>

                {/* Quick stats row */}
                <div style={{ display: "flex", gap: 10, marginTop: 12, fontSize: 12, color: "var(--text-secondary)" }}>
                  <span><strong style={{ color: rateColor(s.closeRate) }}>{fmtPercent(s.closeRate)}</strong> close</span>
                  <span><strong style={{ color: rateColor(s.showRate) }}>{fmtPercent(s.showRate)}</strong> show</span>
                  <span><strong style={{ color: "var(--text-primary)" }}>{s.wins}W</strong>/{s.losses}L</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CHARTS ROW ─────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        {/* Cash Comparison Bar */}
        <div className="glass-static" style={{ padding: "20px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
            Cash Collected
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={cashChartData} barCategoryGap="30%">
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} />
              <YAxis hide />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "rgba(255,255,255,0.7)" }}
                formatter={(v: number | undefined) => [`$${(v ?? 0).toLocaleString()}`, "Cash"]}
              />
              <Bar dataKey="cash" radius={[6, 6, 0, 0]}>
                {cashChartData.map((_, i) => (
                  <Cell key={i} fill={podiumColors[i] || "#555"} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Radar Comparison */}
        <div className="glass-static" style={{ padding: "20px 16px" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 12 }}>
            Performance Profile
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(255,255,255,0.08)" />
              <PolarAngleAxis dataKey="metric" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} />
              <PolarRadiusAxis hide />
              {ranked.map((s, i) => (
                <Radar
                  key={s.name} name={s.name} dataKey={s.name}
                  stroke={radarColors[i]} fill={radarColors[i]}
                  fillOpacity={0.12} strokeWidth={1.5}
                />
              ))}
              <Tooltip
                contentStyle={{ background: "#1a1a1f", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, fontSize: 12 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── DETAIL CARDS ───────────────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(closerStats.length, 3)}, 1fr)`,
        gap: 16,
      }}>
        {ranked.map((s, i) => {
          const sqRows = setterQualityData[s.name] || [];

          return (
            <div key={s.name} className="glass-static" style={{ padding: "20px 22px" }}>
              {/* Header */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%",
                  background: podiumColors[i] || "#555",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 800, color: "#000",
                }}>
                  {i + 1}
                </div>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.2px" }}>
                  {s.name}
                </span>
              </div>

              {/* Close Rate */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Close Rate</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: rateColor(s.closeRate) }}>{fmtPercent(s.closeRate)}</span>
                </div>
                <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", marginBottom: 5 }}>
                  <div style={{ height: "100%", width: `${Math.min(s.closeRate, 100)}%`, background: rateColor(s.closeRate), borderRadius: 3, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                  <span style={{ color: "var(--success)" }}>{s.wins}W</span>{" · "}
                  <span style={{ color: "var(--danger)" }}>{s.losses}L</span>{" · "}
                  <span style={{ color: "var(--warning)" }}>{s.pcfus} PCFU</span>
                </div>
              </div>

              {/* Show Rate */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>Show Rate</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: rateColor(s.showRate) }}>{fmtPercent(s.showRate)}</span>
                </div>
                <div style={{ height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden", marginBottom: 5 }}>
                  <div style={{ height: "100%", width: `${Math.min(s.showRate, 100)}%`, background: rateColor(s.showRate), borderRadius: 3, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>{s.callsTaken}/{s.callsBooked} showed</div>
              </div>

              {/* Stats row */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "10px 0 0", borderTop: "1px solid var(--border-subtle)", fontSize: 11, color: "var(--text-secondary)" }}>
                <span>AOV <strong style={{ color: "var(--text-primary)" }}>{fmtDollars(s.aov)}</strong></span>
                <span>Avg <strong style={{ color: "var(--text-primary)" }}>{s.avgCallLength}</strong></span>
                <span style={{ padding: "1px 7px", borderRadius: 4, background: "rgba(255,255,255,0.04)", fontSize: 10 }}>{s.topObjection}</span>
              </div>

              {/* Setter Quality */}
              {sqRows.length > 0 && (
                <div style={{ marginTop: 12, padding: "10px 0 0", borderTop: "1px solid var(--border-subtle)" }}>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 6 }}>
                    Setter Quality
                  </div>
                  {sqRows.map((sq) => (
                    <div key={sq.setter} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3, color: "var(--text-secondary)" }}>
                      <span style={{ fontWeight: 500 }}>{sq.setter}</span>
                      <span>{sq.taken}/{sq.booked} <strong style={{ color: rateColor(sq.showRate) }}>{fmtPercent(sq.showRate)}</strong></span>
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
