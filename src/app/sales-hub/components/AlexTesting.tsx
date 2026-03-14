"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Banknote,
  Target,
  PhoneCall,
  Users,
  Trophy,
  ArrowUpRight,
  ArrowDownRight,
  ChevronDown,
  Sparkles,
  MessageCircle,
  Send,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Activity,
  Brain,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, SheetRow } from "../types";

/* ── Types ────────────────────────────────────────────────────────── */

interface AlexTestingProps {
  filters: Filters;
}

interface PeriodMetrics {
  cashCollected: number;
  revenue: number;
  wins: number;
  losses: number;
  pcfus: number;
  callsBooked: number;
  callsTaken: number;
  noShows: number;
  closeRate: number;
  showRate: number;
  aov: number;
  dailyCash: { date: string; amount: number }[];
  byClient: Record<string, ClientMetrics>;
  byCloser: Record<string, { cash: number; wins: number; losses: number; pcfus: number; calls: number }>;
}

interface ClientMetrics {
  cashCollected: number;
  revenue: number;
  wins: number;
  losses: number;
  pcfus: number;
  callsBooked: number;
  callsTaken: number;
  noShows: number;
  closeRate: number;
  showRate: number;
  aov: number;
}

/* ── Helpers ──────────────────────────────────────────────────────── */

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
  return res.json();
}

function getPrevPeriod(dateFrom: string, dateTo: string): { from: string; to: string } {
  const from = new Date(dateFrom + "T00:00:00");
  const to = new Date(dateTo + "T00:00:00");
  const diff = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(prevTo.getTime() - diff);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

function computePeriod(rows: SheetRow[]): PeriodMetrics {
  const callsBooked = rows.length;
  const callsTaken = rows.filter((r) => r.callTaken).length;
  const noShows = rows.filter((r) => !r.callTaken).length;
  const showRate = callsBooked > 0 ? (callsTaken / callsBooked) * 100 : 0;

  const wins = rows.filter((r) => r.outcome === "WIN").length;
  const losses = rows.filter((r) => r.outcome === "LOST").length;
  const pcfus = rows.filter((r) => r.outcome === "PCFU").length;
  const denom = wins + losses + pcfus;
  const closeRate = denom > 0 ? (wins / denom) * 100 : 0;

  const revenue = rows.reduce((s, r) => s + r.revenue, 0);
  const cashCollected = rows.reduce((s, r) => s + r.cashCollected, 0);
  const aov = wins > 0 ? revenue / wins : 0;

  const dailyMap: Record<string, number> = {};
  for (const r of rows) {
    if (r.date && r.cashCollected > 0) {
      dailyMap[r.date] = (dailyMap[r.date] || 0) + r.cashCollected;
    }
  }
  const dailyCash = Object.entries(dailyMap)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byClient: Record<string, ClientMetrics> = {};
  for (const label of ["Tyson", "Keith"]) {
    const clientRows = rows.filter((r) =>
      r.offer?.toLowerCase().includes(label.toLowerCase()),
    );
    const cb = clientRows.length;
    const ct = clientRows.filter((r) => r.callTaken).length;
    const w = clientRows.filter((r) => r.outcome === "WIN").length;
    const l = clientRows.filter((r) => r.outcome === "LOST").length;
    const p = clientRows.filter((r) => r.outcome === "PCFU").length;
    const d = w + l + p;
    const cRev = clientRows.reduce((s, r) => s + r.revenue, 0);
    const cCash = clientRows.reduce((s, r) => s + r.cashCollected, 0);
    const cNoShows = clientRows.filter((r) => !r.callTaken).length;
    byClient[label] = {
      cashCollected: cCash,
      revenue: cRev,
      wins: w,
      losses: l,
      pcfus: p,
      callsBooked: cb,
      callsTaken: ct,
      noShows: cNoShows,
      closeRate: d > 0 ? (w / d) * 100 : 0,
      showRate: cb > 0 ? (ct / cb) * 100 : 0,
      aov: w > 0 ? cRev / w : 0,
    };
  }

  const byCloser: Record<string, { cash: number; wins: number; losses: number; pcfus: number; calls: number }> = {};
  for (const r of rows) {
    const name = r.closer?.trim();
    if (!name) continue;
    if (!byCloser[name]) byCloser[name] = { cash: 0, wins: 0, losses: 0, pcfus: 0, calls: 0 };
    byCloser[name].calls++;
    if (r.outcome === "WIN") {
      byCloser[name].wins++;
      byCloser[name].cash += r.cashCollected;
    } else if (r.outcome === "LOST") {
      byCloser[name].losses++;
    } else if (r.outcome === "PCFU") {
      byCloser[name].pcfus++;
    }
  }

  return {
    cashCollected, revenue, wins, losses, pcfus, callsBooked,
    callsTaken, noShows, closeRate, showRate, aov, dailyCash,
    byClient, byCloser,
  };
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function delta(current: number, previous: number): { pct: string; up: boolean; flat: boolean } {
  if (previous === 0) return { pct: "N/A", up: true, flat: true };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { pct: "0%", up: true, flat: true };
  return {
    pct: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
    up: change > 0,
    flat: false,
  };
}

/* ── SVG Sparkline Area Chart ─────────────────────────────────────── */

function SparkArea({
  current,
  previous,
  height = 180,
}: {
  current: { date: string; amount: number }[];
  previous: { date: string; amount: number }[];
  height?: number;
}) {
  const allValues = [...current.map((d) => d.amount), ...previous.map((d) => d.amount)];
  const maxVal = Math.max(...allValues, 1);
  const width = 400;
  const leftPad = 45;
  const rightPad = 10;
  const topPad = 10;
  const bottomPad = 25;
  const chartW = width - leftPad - rightPad;
  const chartH = height - topPad - bottomPad;

  function makePoints(data: { date: string; amount: number }[]): string {
    if (data.length === 0) return "";
    return data
      .map((d, i) => {
        const x = leftPad + (i / Math.max(data.length - 1, 1)) * chartW;
        const y = topPad + chartH - (d.amount / maxVal) * chartH;
        return `${x},${y}`;
      })
      .join(" ");
  }

  function makeArea(data: { date: string; amount: number }[]): string {
    if (data.length === 0) return "";
    const pts = data.map((d, i) => {
      const x = leftPad + (i / Math.max(data.length - 1, 1)) * chartW;
      const y = topPad + chartH - (d.amount / maxVal) * chartH;
      return { x, y };
    });
    const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    return `${path} L${pts[pts.length - 1].x},${topPad + chartH} L${pts[0].x},${topPad + chartH} Z`;
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    value: maxVal * frac,
    y: topPad + chartH - frac * chartH,
  }));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height }}>
      {yTicks.map((t) => (
        <g key={t.value}>
          <line x1={leftPad} y1={t.y} x2={width - rightPad} y2={t.y} stroke="rgba(255,255,255,0.05)" />
          <text x={leftPad - 6} y={t.y + 3} fill="var(--text-muted)" fontSize={9} textAnchor="end">
            {t.value >= 1000 ? `$${(t.value / 1000).toFixed(1)}k` : `$${t.value.toFixed(0)}`}
          </text>
        </g>
      ))}
      {previous.length > 0 && (
        <>
          <path d={makeArea(previous)} fill="rgba(255,255,255,0.03)" />
          <polyline points={makePoints(previous)} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} strokeDasharray="4 4" />
        </>
      )}
      {current.length > 0 && (
        <>
          <defs>
            <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={makeArea(current)} fill="url(#sparkGrad)" />
          <polyline points={makePoints(current)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          {current.map((d, i) => {
            const x = leftPad + (i / Math.max(current.length - 1, 1)) * chartW;
            const y = topPad + chartH - (d.amount / maxVal) * chartH;
            return (
              <g key={d.date}>
                <circle cx={x} cy={y} r={3} fill="var(--accent)" stroke="#0f0f12" strokeWidth={1.5} />
                {(i === 0 || i === current.length - 1) && (
                  <text x={x} y={topPad + chartH + 14} fill="var(--text-muted)" fontSize={9} textAnchor="middle">
                    {shortDate(d.date)}
                  </text>
                )}
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
}

/* ── SVG Donut Ring ────────────────────────────────────────────────── */

function DonutRing({
  wins,
  losses,
  pcfus,
  noShows,
  size = 160,
}: {
  wins: number;
  losses: number;
  pcfus: number;
  noShows: number;
  size?: number;
}) {
  const total = wins + losses + pcfus + noShows;
  if (total === 0) {
    return (
      <svg viewBox="0 0 100 100" style={{ width: size, height: size }}>
        <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="12" />
        <text x="50" y="54" textAnchor="middle" fill="var(--text-muted)" fontSize="10">
          No data
        </text>
      </svg>
    );
  }
  const segments = [
    { value: wins, color: "var(--success)", label: "Wins" },
    { value: losses, color: "var(--danger)", label: "Losses" },
    { value: pcfus, color: "var(--warning)", label: "PCFU" },
    { value: noShows, color: "rgba(255,255,255,0.1)", label: "No-Show" },
  ];
  const r = 40;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg viewBox="0 0 100 100" style={{ width: size, height: size }}>
      {segments.map((seg) => {
        const pct = seg.value / total;
        const dashLen = pct * circumference;
        const dashGap = circumference - dashLen;
        const el = (
          <circle
            key={seg.label}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="12"
            strokeDasharray={`${dashLen} ${dashGap}`}
            strokeDashoffset={-offset}
            strokeLinecap="butt"
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dasharray 0.8s ease, stroke-dashoffset 0.8s ease" }}
          />
        );
        offset += dashLen;
        return el;
      })}
      <text x="50" y="46" textAnchor="middle" fill="var(--text-primary)" fontSize="16" fontWeight="700">
        {wins}
      </text>
      <text x="50" y="58" textAnchor="middle" fill="var(--text-muted)" fontSize="8">
        WINS
      </text>
    </svg>
  );
}

/* ── Delta Badge ──────────────────────────────────────────────────── */

function DeltaBadge({ current: cur, previous: prev }: { current: number; previous: number }) {
  const d = delta(cur, prev);
  const color = d.flat ? "var(--text-muted)" : d.up ? "var(--success)" : "var(--danger)";
  const Icon = d.flat ? Minus : d.up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `${color}15`,
        padding: "2px 8px",
        borderRadius: 6,
      }}
    >
      <Icon size={11} />
      {d.pct}
    </span>
  );
}

/* ── HBar ─────────────────────────────────────────────────────────── */

function HBar({
  value,
  max,
  color,
  label,
  sublabel,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  sublabel: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 12,
          marginBottom: 5,
        }}
      >
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{sublabel}</span>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 4,
          background: "rgba(255,255,255,0.04)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(pct, 100)}%`,
            borderRadius: 4,
            background: color,
            transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </div>
    </div>
  );
}

/* ── Funnel & AI Bottleneck Analysis ──────────────────────────────── */

const BENCHMARKS = {
  showRate: { weak: 50, normal: 65, strong: 80 },
  closeRate: { weak: 20, normal: 40, strong: 60 },
  aov: { weak: 2000, normal: 4000, strong: 6000 },
} as const;

type HealthLevel = "weak" | "normal" | "strong" | "elite";

function getHealth(metric: "showRate" | "closeRate" | "aov", value: number): HealthLevel {
  const b = BENCHMARKS[metric];
  if (value >= b.strong) return "elite";
  if (value >= b.normal) return "strong";
  if (value >= b.weak) return "normal";
  return "weak";
}

function healthColor(h: HealthLevel): string {
  switch (h) {
    case "elite": return "#7ec9a0";
    case "strong": return "#7ec9a0";
    case "normal": return "#e8c36a";
    case "weak": return "#d98e8e";
  }
}

function healthGlow(h: HealthLevel): string {
  switch (h) {
    case "elite": return "0 0 20px rgba(126,201,160,0.4)";
    case "strong": return "0 0 15px rgba(126,201,160,0.25)";
    case "normal": return "0 0 15px rgba(232,195,106,0.25)";
    case "weak": return "0 0 20px rgba(217,142,142,0.4)";
  }
}

function healthLabel(h: HealthLevel): string {
  switch (h) {
    case "elite": return "ELITE";
    case "strong": return "STRONG";
    case "normal": return "NORMAL";
    case "weak": return "WEAK";
  }
}

function HealthIcon({ health }: { health: HealthLevel }) {
  const color = healthColor(health);
  if (health === "elite") return <Zap size={14} style={{ color }} />;
  if (health === "strong") return <CheckCircle2 size={14} style={{ color }} />;
  if (health === "normal") return <Activity size={14} style={{ color }} />;
  return <AlertTriangle size={14} style={{ color }} />;
}

/* ── CSS Keyframes (injected once) ──────────────────────────────── */

const FUNNEL_KEYFRAMES = `
@keyframes funnelFillIn {
  from { width: 0%; opacity: 0; }
  to { opacity: 1; }
}
@keyframes funnelPulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
@keyframes funnelFlowDot {
  0% { top: 0%; opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { top: 100%; opacity: 0; }
}
@keyframes inboxGlow {
  0%, 100% { box-shadow: 0 0 15px rgba(201,169,110,0.15); }
  50% { box-shadow: 0 0 30px rgba(201,169,110,0.35); }
}
@keyframes aiPulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.1); opacity: 1; }
}
@keyframes inboxParticle1 {
  0% { transform: translate(0,0) scale(1); opacity: 0.7; }
  50% { transform: translate(12px,-18px) scale(1.3); opacity: 1; }
  100% { transform: translate(24px,-6px) scale(0.5); opacity: 0; }
}
@keyframes inboxParticle2 {
  0% { transform: translate(0,0) scale(1); opacity: 0.5; }
  50% { transform: translate(-15px,-22px) scale(1.5); opacity: 0.9; }
  100% { transform: translate(-8px,-40px) scale(0.3); opacity: 0; }
}
@keyframes inboxParticle3 {
  0% { transform: translate(0,0) scale(0.8); opacity: 0.6; }
  50% { transform: translate(20px,-12px) scale(1.2); opacity: 1; }
  100% { transform: translate(10px,-30px) scale(0.4); opacity: 0; }
}
@keyframes thinkingDot {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1.2); }
}
@keyframes messageSlideIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
`;

let keyframesInjected = false;
function injectKeyframes() {
  if (typeof window === "undefined" || keyframesInjected) return;
  const style = document.createElement("style");
  style.textContent = FUNNEL_KEYFRAMES;
  document.head.appendChild(style);
  keyframesInjected = true;
}

/* ── FunnelStep ──────────────────────────────────────────────────── */

function FunnelStep({
  label,
  value,
  formattedValue,
  health,
  widthPct,
  delay,
  color,
}: {
  label: string;
  value: number;
  formattedValue: string;
  health: HealthLevel | null;
  widthPct: number;
  delay: number;
  color?: string;
}) {
  const hc = health ? healthColor(health) : (color || "var(--accent)");
  const glow = health ? healthGlow(health) : "0 0 15px rgba(201,169,110,0.2)";
  return (
    <div style={{ width: `${widthPct}%`, margin: "0 auto", transition: "width 0.6s ease" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, padding: "0 4px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {health && <HealthIcon health={health} />}
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: hc, letterSpacing: "-0.5px" }}>{formattedValue}</span>
          {health && (
            <span style={{ fontSize: 9, fontWeight: 700, color: hc, background: `${hc}18`, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.5px" }}>
              {healthLabel(health)}
            </span>
          )}
        </div>
      </div>
      <div style={{ height: 36, borderRadius: 8, background: "rgba(255,255,255,0.03)", overflow: "hidden", border: `1px solid ${hc}30`, boxShadow: glow, position: "relative" }}>
        <div style={{ height: "100%", width: `${Math.min(value, 100)}%`, maxWidth: "100%", borderRadius: 7, background: `linear-gradient(90deg, ${hc}60, ${hc})`, animation: `funnelFillIn 1s ${delay}s ease both`, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)", animation: `funnelPulse 2.5s ${delay + 0.5}s ease-in-out infinite`, borderRadius: 7 }} />
        </div>
      </div>
    </div>
  );
}

/* ── FunnelConnector ─────────────────────────────────────────────── */

function FunnelConnector({ delay }: { delay: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", height: 28, position: "relative" }}>
      <div style={{ width: 2, height: "100%", background: "linear-gradient(to bottom, rgba(201,169,110,0.3), rgba(201,169,110,0.08))", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", width: 4, height: 4, borderRadius: "50%", background: "var(--accent)", left: -1, animation: `funnelFlowDot 1.5s ${delay}s ease-in-out infinite` }} />
      </div>
    </div>
  );
}

/* ── VerticalFunnel ──────────────────────────────────────────────── */

function VerticalFunnel({ metrics, label }: { metrics: ClientMetrics | PeriodMetrics; label?: string }) {
  const steps = [
    { label: "DM Booking Rate", value: 0, formattedValue: "—", health: null as HealthLevel | null, widthPct: 100, barValue: 0 },
    { label: "Show-Up Rate", value: metrics.showRate, formattedValue: fmtPercent(metrics.showRate, 1), health: getHealth("showRate", metrics.showRate), widthPct: 85, barValue: metrics.showRate },
    { label: "Close Rate", value: metrics.closeRate, formattedValue: fmtPercent(metrics.closeRate, 1), health: getHealth("closeRate", metrics.closeRate), widthPct: 70, barValue: metrics.closeRate },
    { label: "AOV", value: metrics.aov, formattedValue: fmtDollars(metrics.aov), health: getHealth("aov", metrics.aov), widthPct: 55, barValue: Math.min((metrics.aov / 8000) * 100, 100) },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && (
        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12, letterSpacing: "0.5px", textTransform: "uppercase" }}>
          {label}
        </div>
      )}
      {steps.map((step, i) => (
        <div key={step.label}>
          <FunnelStep label={step.label} value={step.barValue} formattedValue={step.formattedValue} health={step.health} widthPct={step.widthPct} delay={i * 0.2} color={step.health === null ? "rgba(255,255,255,0.15)" : undefined} />
          {i < steps.length - 1 && <FunnelConnector delay={i * 0.2 + 0.3} />}
        </div>
      ))}
      <div style={{ marginTop: 16, textAlign: "center", padding: "10px 16px", background: "rgba(201,169,110,0.06)", border: "1px solid rgba(201,169,110,0.15)", borderRadius: 8 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.5px" }}>REVENUE PER SHOW (RPS)</span>
        <div style={{ fontSize: 22, fontWeight: 800, color: "var(--accent)", marginTop: 4 }}>
          {fmtDollars((metrics.closeRate / 100) * metrics.aov)}
        </div>
      </div>
    </div>
  );
}

/* ── FunnelSection ───────────────────────────────────────────────── */

type FunnelView = "both" | "keith" | "tyson" | "side-by-side";

function FunnelSection({ metrics }: { metrics: PeriodMetrics }) {
  const [view, setView] = useState<FunnelView>("both");

  const viewButtons: { key: FunnelView; label: string }[] = [
    { key: "both", label: "Both" },
    { key: "keith", label: "Keith" },
    { key: "tyson", label: "Tyson" },
    { key: "side-by-side", label: "Side by Side" },
  ];

  const emptyClient: ClientMetrics = { cashCollected: 0, revenue: 0, wins: 0, losses: 0, pcfus: 0, callsBooked: 0, callsTaken: 0, noShows: 0, closeRate: 0, showRate: 0, aov: 0 };
  const keithM = metrics.byClient["Keith"] || emptyClient;
  const tysonM = metrics.byClient["Tyson"] || emptyClient;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 20, justifyContent: "center", flexWrap: "wrap" }}>
        {viewButtons.map((btn) => (
          <button
            key={btn.key}
            onClick={() => setView(btn.key)}
            style={{
              padding: "6px 16px", fontSize: 12, fontWeight: 600, borderRadius: 6,
              border: view === btn.key ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.1)",
              background: view === btn.key ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.03)",
              color: view === btn.key ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer", transition: "all 0.2s ease",
              boxShadow: view === btn.key ? "0 0 12px rgba(201,169,110,0.2)" : "none",
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
      {view === "both" && <VerticalFunnel metrics={metrics} />}
      {view === "keith" && <VerticalFunnel metrics={keithM} label="Keith Holland" />}
      {view === "tyson" && <VerticalFunnel metrics={tysonM} label="Tyson Sonnek" />}
      {view === "side-by-side" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div style={{ borderRight: "1px solid rgba(255,255,255,0.06)", paddingRight: 16 }}>
            <VerticalFunnel metrics={keithM} label="Keith Holland" />
          </div>
          <div style={{ paddingLeft: 8 }}>
            <VerticalFunnel metrics={tysonM} label="Tyson Sonnek" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── AI Bottleneck Analysis Engine ───────────────────────────────── */

interface AIMessage {
  id: string;
  role: "ai" | "user";
  text: string;
  timestamp: Date;
}

function generateBottleneckAnalysis(m: PeriodMetrics): string {
  const showH = getHealth("showRate", m.showRate);
  const closeH = getHealth("closeRate", m.closeRate);
  const aovH = getHealth("aov", m.aov);
  const rps = (m.closeRate / 100) * m.aov;

  const parts: string[] = [];
  parts.push(`📊 Analysis based on ${m.callsBooked} booked calls — ${m.callsTaken} shows, ${m.wins} wins, ${m.losses} losses, ${m.pcfus} pending follow-ups.`);

  if (showH === "weak") {
    parts.push(`\n🚨 PRIMARY BOTTLENECK: Show-Up Rate at ${m.showRate.toFixed(1)}% is critically low. ${m.noShows} no-shows detected. This is the highest-leverage fix — every additional show creates an opportunity. Focus on: confirmation sequences, same-day reminders, reducing time-to-call, and pre-call engagement. Target: 65%+.`);
  } else if (closeH === "weak") {
    parts.push(`\n🚨 PRIMARY BOTTLENECK: Close Rate at ${m.closeRate.toFixed(1)}% needs attention. Shows are coming in but conversions are lacking. Review: objection handling, offer-market fit, closer skill gaps, and call quality. Target: 40%+.`);
  } else if (aovH === "weak") {
    parts.push(`\n🚨 PRIMARY BOTTLENECK: AOV at ${fmtDollars(m.aov)} is below benchmark. You're closing deals but leaving revenue on the table. Consider: premium tier positioning, payment plan restructuring, and value-stack improvements. Target: $4,000+.`);
  } else {
    parts.push(`\n✅ All core metrics are at or above benchmark thresholds. Focus on maintaining consistency and incremental optimization.`);
  }

  if (showH !== "weak" && showH !== "elite") {
    parts.push(`\n📌 Show Rate (${m.showRate.toFixed(1)}%) is ${healthLabel(showH).toLowerCase()}. Room to improve with tighter confirmation cadences.`);
  }
  if (closeH === "strong" || closeH === "elite") {
    parts.push(`\n🏆 Close Rate at ${m.closeRate.toFixed(1)}% is ${healthLabel(closeH).toLowerCase()} — your closers are performing well.`);
  }

  parts.push(`\n💰 Revenue Per Show: ${fmtDollars(rps)}. This composite metric reflects the cash yield of every person who shows up.`);

  const keith = m.byClient["Keith"];
  const tyson = m.byClient["Tyson"];
  if (keith && tyson && keith.callsBooked > 2 && tyson.callsBooked > 2) {
    const kCR = keith.closeRate;
    const tCR = tyson.closeRate;
    if (Math.abs(kCR - tCR) > 10) {
      const higher = kCR > tCR ? "Keith" : "Tyson";
      const lower = kCR > tCR ? "Tyson" : "Keith";
      parts.push(`\n📊 Offer gap: ${higher} close rate (${Math.max(kCR, tCR).toFixed(1)}%) outperforms ${lower} (${Math.min(kCR, tCR).toFixed(1)}%) by ${Math.abs(kCR - tCR).toFixed(1)}pp. Use Side-by-Side view to compare funnels.`);
    }
  }

  return parts.join("");
}

function getAiResponse(userMsg: string, m: PeriodMetrics): string {
  const msg = userMsg.toLowerCase();

  if (msg.includes("show") && (msg.includes("rate") || msg.includes("up"))) {
    const h = getHealth("showRate", m.showRate);
    return `Show-Up Rate is at ${m.showRate.toFixed(1)}% (${healthLabel(h)}). ${m.noShows} no-shows out of ${m.callsBooked} booked. ${h === "weak" ? "This is your biggest opportunity — improving show rate has the highest leverage on revenue." : "Solid performance here. Keep monitoring for consistency."}`;
  }
  if (msg.includes("close") && (msg.includes("rate") || msg.includes("deal"))) {
    const h = getHealth("closeRate", m.closeRate);
    return `Close Rate stands at ${m.closeRate.toFixed(1)}% (${healthLabel(h)}). ${m.wins}W / ${m.losses}L / ${m.pcfus} PCFU. ${h === "weak" ? "Focus on objection handling and call quality review." : h === "elite" ? "Elite-level closing. Maintain this pace." : "Good performance. Dial in your follow-up system to convert those PCFUs."}`;
  }
  if (msg.includes("aov") || msg.includes("average") || msg.includes("order value")) {
    const h = getHealth("aov", m.aov);
    return `AOV is ${fmtDollars(m.aov)} (${healthLabel(h)}). ${h === "weak" ? "Consider premium positioning and value-stack enhancements." : "AOV is healthy. Look at upsell opportunities for further gains."}`;
  }
  if (msg.includes("rps") || msg.includes("revenue per show")) {
    const rps = (m.closeRate / 100) * m.aov;
    return `RPS (Revenue Per Show) is ${fmtDollars(rps)}. This means every person who shows up on a call generates ${fmtDollars(rps)} in expected revenue. To increase RPS, improve either close rate or AOV.`;
  }
  if (msg.includes("keith") || msg.includes("tyson") || msg.includes("offer")) {
    const k = m.byClient["Keith"];
    const t = m.byClient["Tyson"];
    if (k && t) {
      return `Keith: ${k.wins}W, ${fmtPercent(k.closeRate, 1)} close, ${fmtDollars(k.aov)} AOV. Tyson: ${t.wins}W, ${fmtPercent(t.closeRate, 1)} close, ${fmtDollars(t.aov)} AOV. Use the Side-by-Side toggle above to compare their full funnels.`;
    }
    return "Per-offer data is available in the funnel above. Toggle to Side-by-Side view for a detailed comparison.";
  }
  if (msg.includes("bottleneck") || msg.includes("problem") || msg.includes("issue") || msg.includes("fix")) {
    return generateBottleneckAnalysis(m);
  }

  return `I can help analyze show rate, close rate, AOV, RPS, per-offer performance, or identify your main bottleneck. What would you like to dive into?`;
}

/* ── BottleneckInbox ─────────────────────────────────────────────── */

function BottleneckInbox({ metrics }: { metrics: PeriodMetrics }) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && metrics.callsBooked > 0) {
      setThinking(true);
      const timer = setTimeout(() => {
        const analysis = generateBottleneckAnalysis(metrics);
        setMessages([{ id: "init-" + Date.now(), role: "ai", text: analysis, timestamp: new Date() }]);
        setThinking(false);
        setInitialized(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [metrics, initialized]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: AIMessage = { id: "u-" + Date.now(), role: "user", text: input.trim(), timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const reply = getAiResponse(userMsg.text, metrics);
      setMessages((prev) => [...prev, { id: "ai-" + Date.now(), role: "ai", text: reply, timestamp: new Date() }]);
      setThinking(false);
    }, 800 + Math.random() * 600);
  };

  return (
    <div style={{ position: "relative", borderRadius: 12, border: "1px solid rgba(201,169,110,0.2)", background: "rgba(201,169,110,0.03)", overflow: "hidden", animation: "inboxGlow 4s ease-in-out infinite" }}>
      {/* Gold particles */}
      {[1, 2, 3].map((i) => (
        <div key={i} style={{ position: "absolute", width: 4, height: 4, borderRadius: "50%", background: "var(--accent)", top: `${20 + i * 25}%`, right: `${5 + i * 8}%`, animation: `inboxParticle${i} ${2.5 + i * 0.5}s ease-in-out infinite`, pointerEvents: "none", zIndex: 1 }} />
      ))}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px", borderBottom: "1px solid rgba(201,169,110,0.12)", background: "rgba(201,169,110,0.04)" }}>
        <div style={{ position: "relative" }}>
          <Brain size={20} style={{ color: "var(--accent)", animation: "aiPulse 2s ease-in-out infinite" }} />
          <div style={{ position: "absolute", width: 7, height: 7, borderRadius: "50%", background: "#7ec9a0", bottom: -1, right: -1, border: "1.5px solid #0f0f12" }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.3px" }}>Bottleneck AI</div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Powered by GAS Protocol</div>
        </div>
        <Sparkles size={14} style={{ marginLeft: "auto", color: "var(--accent)", opacity: 0.5 }} />
      </div>

      {/* Messages */}
      <div style={{ padding: "16px 18px", maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start", animation: "messageSlideIn 0.3s ease" }}>
            <div style={{
              maxWidth: "85%", padding: "10px 14px",
              borderRadius: msg.role === "ai" ? "12px 12px 12px 4px" : "12px 12px 4px 12px",
              background: msg.role === "ai" ? "rgba(201,169,110,0.08)" : "rgba(126,201,160,0.1)",
              border: `1px solid ${msg.role === "ai" ? "rgba(201,169,110,0.15)" : "rgba(126,201,160,0.15)"}`,
              fontSize: 12.5, lineHeight: 1.55, color: "var(--text-secondary)", whiteSpace: "pre-wrap",
            }}>
              {msg.role === "ai" && (
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 6 }}>
                  <Sparkles size={11} style={{ color: "var(--accent)" }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.5px" }}>AI ANALYSIS</span>
                </div>
              )}
              {msg.text}
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 6, textAlign: "right" }}>
                {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0" }}>
            <Brain size={14} style={{ color: "var(--accent)", animation: "aiPulse 1.5s ease-in-out infinite" }} />
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: `thinkingDot 1.4s ${i * 0.2}s ease-in-out infinite` }} />
              ))}
            </div>
            <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>analyzing...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 8, padding: "12px 18px", borderTop: "1px solid rgba(201,169,110,0.12)", background: "rgba(0,0,0,0.15)" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about show rate, close rate, bottlenecks..."
          style={{ flex: 1, padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(201,169,110,0.15)", background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", fontSize: 12, outline: "none" }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || thinking}
          style={{
            padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(201,169,110,0.3)",
            background: input.trim() && !thinking ? "rgba(201,169,110,0.15)" : "rgba(255,255,255,0.03)",
            color: input.trim() && !thinking ? "var(--accent)" : "var(--text-muted)",
            cursor: input.trim() && !thinking ? "pointer" : "default",
            transition: "all 0.2s ease", display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600,
          }}
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────────── */

export default function AlexTesting({ filters }: AlexTestingProps) {
  const { dateFrom, dateTo } = getEffectiveDates(filters);
  const prev = useMemo(() => getPrevPeriod(dateFrom, dateTo), [dateFrom, dateTo]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<PeriodMetrics | null>(null);
  const [previous, setPrevious] = useState<PeriodMetrics | null>(null);
  const [alexTestOpen, setAlexTestOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const clientParam =
        filters.client !== "all"
          ? `&client=${filters.client === "tyson" ? "Tyson Sonnek" : "Keith Holland"}`
          : "";

      const [curRes, prevRes] = await Promise.all([
        fetchJSON<{ rows: SheetRow[] }>(
          `/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}${clientParam}`,
        ),
        fetchJSON<{ rows: SheetRow[] }>(
          `/api/sales-hub/sheet-data?dateFrom=${prev.from}&dateTo=${prev.to}${clientParam}`,
        ),
      ]);

      setCurrent(computePeriod(curRes.rows));
      setPrevious(computePeriod(prevRes.rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filters.client, dateFrom, dateTo, prev]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Loading ────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 60,
        }}
      >
        <Loader2
          size={28}
          style={{
            color: "var(--accent)",
            animation: "spin 1s linear infinite",
          }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: 40,
          color: "var(--danger)",
          fontSize: 14,
        }}
      >
        {error}
      </div>
    );
  }

  if (!current || !previous) return null;

  const prev2 = previous;

  /* Color helper for rates */
  const rc = (v: number) =>
    v >= 50 ? "var(--success)" : v >= 30 ? "var(--warning)" : "var(--danger)";

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ═══════════════════════════════════════════════════════════════
          ROW 1: Hero KPIs + Sparkline
          ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 14,
        }}
      >
        {/* Cash Collected */}
        <div
          className="glass-static"
          style={{
            padding: "20px 18px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background:
                "linear-gradient(90deg, var(--accent), rgba(201,169,110,0.2))",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Banknote size={16} style={{ color: "var(--accent)" }} />
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Cash Collected
            </span>
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "var(--text-primary)",
              letterSpacing: "-1px",
              marginBottom: 6,
            }}
          >
            {fmtDollars(current.cashCollected)}
          </div>
          <DeltaBadge current={current.cashCollected} previous={prev2.cashCollected} />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 6,
            }}
          >
            prev: {fmtDollars(prev2.cashCollected)}
          </div>
        </div>

        {/* Close Rate */}
        <div
          className="glass-static"
          style={{
            padding: "20px 18px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: `linear-gradient(90deg, ${rc(current.closeRate)}, ${rc(current.closeRate)}33)`,
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <Target size={16} style={{ color: rc(current.closeRate) }} />
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Close Rate
            </span>
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: rc(current.closeRate),
              letterSpacing: "-1px",
              marginBottom: 6,
            }}
          >
            {fmtPercent(current.closeRate, 1)}
          </div>
          <DeltaBadge current={current.closeRate} previous={prev2.closeRate} />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 6,
            }}
          >
            {current.wins}W / {current.losses}L / {current.pcfus} PCFU
          </div>
        </div>

        {/* Revenue */}
        <div
          className="glass-static"
          style={{
            padding: "20px 18px",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background:
                "linear-gradient(90deg, var(--success), rgba(126,201,160,0.2))",
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <DollarSign size={16} style={{ color: "var(--success)" }} />
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Revenue
            </span>
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "var(--text-primary)",
              letterSpacing: "-1px",
              marginBottom: 6,
            }}
          >
            {fmtDollars(current.revenue)}
          </div>
          <DeltaBadge current={current.revenue} previous={prev2.revenue} />
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              marginTop: 6,
            }}
          >
            prev: {fmtDollars(prev2.revenue)}
          </div>
        </div>
      </div>

      {/* Daily Cash Sparkline */}
      <div
        className="glass-static"
        style={{ padding: "16px 14px" }}
      >
        <div
          style={{
            fontSize: 11,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: 10,
          }}
        >
          Daily Cash Collected
        </div>
        <SparkArea current={current.dailyCash} previous={prev2.dailyCash} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: 10,
            color: "var(--text-muted)",
          }}
        >
          <span>
            <span style={{ display: "inline-block", width: 8, height: 2, background: "var(--accent)", marginRight: 4, verticalAlign: "middle" }} />
            Current
          </span>
          <span>
            <span style={{ display: "inline-block", width: 8, height: 2, background: "rgba(255,255,255,0.15)", marginRight: 4, verticalAlign: "middle" }} />
            Previous
          </span>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROW 2: Donut + Client Breakdown + Closers
          ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 14,
        }}
      >
        {/* Donut */}
        <div
          className="glass-static"
          style={{
            padding: "18px 14px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 10,
              alignSelf: "flex-start",
            }}
          >
            Outcome Breakdown
          </div>
          <DonutRing
            wins={current.wins}
            losses={current.losses}
            pcfus={current.pcfus}
            noShows={current.noShows}
          />
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 12,
              fontSize: 10,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {[
              { label: "Win", color: "var(--success)", v: current.wins },
              { label: "Lost", color: "var(--danger)", v: current.losses },
              { label: "PCFU", color: "var(--warning)", v: current.pcfus },
              { label: "No-Show", color: "rgba(255,255,255,0.2)", v: current.noShows },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: s.color }} />
                <span style={{ color: "var(--text-muted)" }}>
                  {s.label}: <strong style={{ color: "var(--text-secondary)" }}>{s.v}</strong>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Client Breakdown */}
        <div className="glass-static" style={{ padding: "18px 14px" }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 14,
            }}
          >
            By Offer
          </div>
          {Object.entries(current.byClient).map(([name, stats]) => {
            const prevClient = prev2.byClient[name];
            return (
              <div key={name} style={{ marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color:
                        name === "Keith"
                          ? "var(--keith, #b8a4d9)"
                          : "var(--tyson, #82c5c5)",
                    }}
                  >
                    {name}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--success)",
                    }}
                  >
                    {fmtDollars(stats.cashCollected)}
                  </span>
                </div>
                <HBar
                  value={stats.wins}
                  max={Math.max(stats.wins + stats.losses, 1)}
                  color={rc(stats.closeRate)}
                  label={`${stats.wins}W / ${stats.losses}L`}
                  sublabel={fmtPercent(stats.closeRate, 0) + " close"}
                />
                {prevClient && (
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      marginTop: 2,
                    }}
                  >
                    prev: {fmtDollars(prevClient.cashCollected)} ·{" "}
                    {fmtPercent(prevClient.closeRate, 0)} close
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Top Closers */}
        <div className="glass-static" style={{ padding: "18px 14px" }}>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 14,
            }}
          >
            Top Closers
          </div>
          {Object.keys(current.byCloser).length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              No closer data
            </div>
          ) : (
            Object.entries(current.byCloser)
              .sort((a, b) => b[1].cash - a[1].cash)
              .map(([name, stats], i) => {
                const maxCloserCash = Math.max(
                  ...Object.values(current.byCloser).map((c) => c.cash),
                  1,
                );
                const prevCloser = prev2.byCloser[name];
                return (
                  <div key={name} style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 6,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--text-primary)",
                          }}
                        >
                          {name}
                        </span>
                        {i === 0 && (
                          <Trophy
                            size={12}
                            style={{ color: "var(--accent)", marginLeft: 2 }}
                          />
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--success)",
                          }}
                        >
                          {fmtDollars(stats.cash)}
                          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400, marginLeft: 4 }}>
                            cash
                          </span>
                        </span>
                        {prevCloser && (
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            prev: {fmtDollars(prevCloser.cash)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: "rgba(255,255,255,0.04)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min((stats.cash / maxCloserCash) * 100, 100)}%`,
                          borderRadius: 4,
                          background:
                            i === 0
                              ? "var(--accent)"
                              : i === 1
                                ? "rgba(192,192,192,0.5)"
                                : "rgba(205,127,50,0.4)",
                          transition: "width 0.8s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 4,
                      }}
                    >
                      <span>
                        <strong style={{ color: "var(--success)" }}>{stats.wins}</strong> W ·{" "}
                        <strong style={{ color: "var(--danger)" }}>{stats.losses}</strong> L ·{" "}
                        {stats.pcfus > 0 && <><strong>{stats.pcfus}</strong> PCFU · </>}
                        {(() => {
                          const decided = stats.wins + stats.losses + stats.pcfus;
                          const rate = decided > 0 ? (stats.wins / decided) * 100 : 0;
                          return (
                            <span style={{ color: rc(rate) }}>
                              {fmtPercent(rate, 0)} close
                            </span>
                          );
                        })()}
                      </span>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROW 3: Quick Stats Bar
          ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginTop: 16,
        }}
      >
        {[
          { icon: <Target size={14} />, label: "AOV", value: fmtDollars(current.aov), prevLabel: fmtDollars(prev2.aov), prev: prev2.aov, cur: current.aov },
          { icon: <PhoneCall size={14} />, label: "Show Rate", value: fmtPercent(current.showRate, 0), prevLabel: fmtPercent(prev2.showRate, 0), prev: prev2.showRate, cur: current.showRate },
          { icon: <Trophy size={14} />, label: "Wins", value: fmtNumber(current.wins), prevLabel: fmtNumber(prev2.wins), prev: prev2.wins, cur: current.wins },
          { icon: <Users size={14} />, label: "Calls Booked", value: fmtNumber(current.callsBooked), prevLabel: fmtNumber(prev2.callsBooked), prev: prev2.callsBooked, cur: current.callsBooked },
          { icon: <TrendingUp size={14} />, label: "Pending (PCFU)", value: fmtNumber(current.pcfus), prevLabel: fmtNumber(prev2.pcfus), prev: prev2.pcfus, cur: current.pcfus },
        ].map((stat) => (
          <div
            key={stat.label}
            className="glass-static"
            style={{
              padding: "16px 14px",
              textAlign: "center",
            }}
          >
            <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>{stat.icon}</div>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--text-primary)",
                letterSpacing: "-0.5px",
                lineHeight: 1,
                marginBottom: 6,
              }}
            >
              {stat.value}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                marginBottom: 6,
              }}
            >
              {stat.label}
            </div>
            <DeltaBadge current={stat.cur} previous={stat.prev} />
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
              was {stat.prevLabel}
            </div>
          </div>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ALEX TEST: Funnel + AI Bottleneck Inbox
          ═══════════════════════════════════════════════════════════════ */}
      <div style={{ marginTop: 20 }}>
        <button
          onClick={() => {
            setAlexTestOpen(!alexTestOpen);
            if (!alexTestOpen) injectKeyframes();
          }}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderRadius: alexTestOpen ? "10px 10px 0 0" : 10,
            border: "1px solid rgba(201,169,110,0.2)",
            borderBottom: alexTestOpen ? "1px solid rgba(201,169,110,0.1)" : undefined,
            background: "rgba(201,169,110,0.04)",
            cursor: "pointer",
            transition: "all 0.3s ease",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ position: "relative" }}>
              <Sparkles size={18} style={{ color: "var(--accent)", animation: alexTestOpen ? "aiPulse 2s ease-in-out infinite" : "none" }} />
              {alexTestOpen && [1, 2, 3].map((i) => (
                <div key={i} style={{ position: "absolute", width: 3, height: 3, borderRadius: "50%", background: "var(--accent)", top: `${-2 + i * 4}px`, left: `${18 + i * 3}px`, animation: `inboxParticle${i} ${2 + i * 0.4}s ease-in-out infinite`, pointerEvents: "none" }} />
              ))}
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.3px" }}>Alex Test</span>
            <span style={{ fontSize: 10, color: "var(--text-muted)", background: "rgba(201,169,110,0.08)", padding: "2px 8px", borderRadius: 4 }}>Funnel + AI</span>
          </div>
          <ChevronDown size={16} style={{ color: "var(--accent)", transform: alexTestOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.3s ease" }} />
        </button>

        <div
          style={{
            maxHeight: alexTestOpen ? 2000 : 0,
            overflow: "hidden",
            transition: "max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
            borderRadius: "0 0 10px 10px",
            border: alexTestOpen ? "1px solid rgba(201,169,110,0.15)" : "none",
            borderTop: "none",
            background: "rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 28 }}>
            {/* Vertical Funnel */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <Activity size={16} style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.3px" }}>Sales Funnel</span>
              </div>
              <FunnelSection metrics={current} />
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "linear-gradient(to right, transparent, rgba(201,169,110,0.2), transparent)" }} />

            {/* AI Bottleneck Inbox */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <MessageCircle size={16} style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.3px" }}>Bottleneck Analysis</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent)", background: "rgba(201,169,110,0.1)", padding: "2px 6px", borderRadius: 4, letterSpacing: "0.5px", animation: "aiPulse 3s ease-in-out infinite" }}>AI</span>
              </div>
              <BottleneckInbox metrics={current} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
