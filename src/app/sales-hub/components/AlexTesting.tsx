"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
  Calendar,
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
  byCloser: Record<
    string,
    { cash: number; wins: number; losses: number; pcfus: number; calls: number }
  >;
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

type AlexDatePreset =
  | "page"
  | "mtd"
  | "last-month"
  | "last-3"
  | "all-time"
  | "custom";

/* ── Helpers ──────────────────────────────────────────────────────── */

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
  return res.json();
}

function fmtLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getPrevPeriod(
  dateFrom: string,
  dateTo: string,
): { from: string; to: string } {
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

  const byCloser: Record<
    string,
    { cash: number; wins: number; losses: number; pcfus: number; calls: number }
  > = {};
  for (const r of rows) {
    const name = r.closer?.trim();
    if (!name) continue;
    if (!byCloser[name])
      byCloser[name] = { cash: 0, wins: 0, losses: 0, pcfus: 0, calls: 0 };
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
    cashCollected,
    revenue,
    wins,
    losses,
    pcfus,
    callsBooked,
    callsTaken,
    noShows,
    closeRate,
    showRate,
    aov,
    dailyCash,
    byClient,
    byCloser,
  };
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function delta(
  current: number,
  previous: number,
): { pct: string; up: boolean; flat: boolean } {
  if (previous === 0) return { pct: "N/A", up: true, flat: true };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { pct: "0%", up: true, flat: true };
  return {
    pct: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`,
    up: change > 0,
    flat: false,
  };
}

/* ── Interactive Cash Chart ───────────────────────────────────────── */

function CashChart({
  current,
  previous,
}: {
  current: { date: string; amount: number }[];
  previous: { date: string; amount: number }[];
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [mouseXPct, setMouseXPct] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const height = 300;
  const width = 620;
  const leftPad = 40;
  const rightPad = 8;
  const topPad = 20;
  const bottomPad = 32;
  const chartW = width - leftPad - rightPad;
  const chartH = height - topPad - bottomPad;

  const allValues = [
    ...current.map((d) => d.amount),
    ...previous.map((d) => d.amount),
  ];
  const maxVal = Math.max(...allValues, 1);

  // Compute point positions for current data
  const currentPts = useMemo(() => {
    return current.map((d, i) => ({
      x: leftPad + (i / Math.max(current.length - 1, 1)) * chartW,
      y: topPad + chartH - (d.amount / maxVal) * chartH,
      date: d.date,
      amount: d.amount,
    }));
  }, [current, chartW, chartH, maxVal]);

  const prevPts = useMemo(() => {
    return previous.map((d, i) => ({
      x: leftPad + (i / Math.max(previous.length - 1, 1)) * chartW,
      y: topPad + chartH - (d.amount / maxVal) * chartH,
    }));
  }, [previous, chartW, chartH, maxVal]);

  // Smooth cubic bezier spline path
  function smoothPath(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;
    let d = `M${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const tension = 0.3;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;
      d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }

  function smoothArea(pts: { x: number; y: number }[]): string {
    if (pts.length === 0) return "";
    const line = smoothPath(pts);
    return `${line} L${pts[pts.length - 1].x},${topPad + chartH} L${pts[0].x},${topPad + chartH} Z`;
  }

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((frac) => ({
    value: maxVal * frac,
    y: topPad + chartH - frac * chartH,
  }));

  // Grid squares
  const gridCols = 12;
  const gridRows = 6;
  const cellW = chartW / gridCols;
  const cellH = chartH / gridRows;

  // Handle mouse move to find nearest point and track actual mouse X
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (currentPts.length === 0) return;
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const mouseX = (e.clientX - rect.left) * scaleX;
      // Track mouse X as SVG coordinate for the vertical line
      setMouseXPct(mouseX);
      // Find nearest point for tooltip data
      let nearest = 0;
      let nearestDist = Infinity;
      for (let i = 0; i < currentPts.length; i++) {
        const dist = Math.abs(currentPts[i].x - mouseX);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = i;
        }
      }
      setHoverIdx(nearest);
    },
    [currentPts],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverIdx(null);
    setMouseXPct(null);
  }, []);

  // Gold particles at grid intersections (randomized subset)
  const particles = useMemo(() => {
    const pts: { x: number; y: number; delay: number; dur: number }[] = [];
    for (let r = 0; r <= gridRows; r++) {
      for (let c = 0; c <= gridCols; c++) {
        // ~15% of intersections get a particle
        if (Math.sin(r * 7.3 + c * 13.1) > 0.6) {
          pts.push({
            x: leftPad + c * cellW,
            y: topPad + r * cellH,
            delay: ((r * gridCols + c) * 0.4) % 6,
            dur: 3 + ((r + c) % 3),
          });
        }
      }
    }
    return pts;
  }, [cellW, cellH]);

  // X axis labels — show ~5 evenly spaced
  const xLabels = useMemo(() => {
    if (currentPts.length <= 1) return currentPts;
    const step = Math.max(1, Math.floor((currentPts.length - 1) / 5));
    const labels: typeof currentPts = [];
    for (let i = 0; i < currentPts.length; i += step) labels.push(currentPts[i]);
    if (labels[labels.length - 1] !== currentPts[currentPts.length - 1]) {
      labels.push(currentPts[currentPts.length - 1]);
    }
    return labels;
  }, [currentPts]);

  const hoverPt = hoverIdx !== null ? currentPts[hoverIdx] : null;

  return (
    <div style={{ position: "relative" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: "100%", height: 300, display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <defs>
          <linearGradient id="cashGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c9a96e" stopOpacity="0.3" />
            <stop offset="60%" stopColor="#c9a96e" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#c9a96e" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="particleGlow">
            <stop offset="0%" stopColor="#c9a96e" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#c9a96e" stopOpacity="0" />
          </radialGradient>
          <filter id="gridGlow">
            <feGaussianBlur stdDeviation="1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="lineGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Glowing square grid */}
        {Array.from({ length: gridRows + 1 }).map((_, r) => (
          <line
            key={`gh${r}`}
            x1={leftPad}
            y1={topPad + r * cellH}
            x2={leftPad + chartW}
            y2={topPad + r * cellH}
            stroke="rgba(201,169,110,0.06)"
            strokeWidth={0.5}
          />
        ))}
        {Array.from({ length: gridCols + 1 }).map((_, c) => (
          <line
            key={`gv${c}`}
            x1={leftPad + c * cellW}
            y1={topPad}
            x2={leftPad + c * cellW}
            y2={topPad + chartH}
            stroke="rgba(201,169,110,0.06)"
            strokeWidth={0.5}
          />
        ))}

        {/* Grid intersection glow dots */}
        {particles.map((p, i) => (
          <circle
            key={`gp${i}`}
            cx={p.x}
            cy={p.y}
            r={1.5}
            fill="url(#particleGlow)"
            style={{
              animation: `gridParticlePulse ${p.dur}s ease-in-out ${p.delay}s infinite`,
            }}
          />
        ))}

        {/* Y axis labels */}
        {yTicks.map((t) => (
          <text
            key={t.value}
            x={leftPad - 8}
            y={t.y + 3}
            fill="rgba(255,255,255,0.3)"
            fontSize={10}
            textAnchor="end"
            fontFamily="monospace"
          >
            {t.value >= 1000
              ? `$${(t.value / 1000).toFixed(1)}k`
              : `$${t.value.toFixed(0)}`}
          </text>
        ))}

        {/* Previous period — dashed smooth line */}
        {prevPts.length > 1 && (
          <>
            <path
              d={smoothArea(prevPts)}
              fill="rgba(255,255,255,0.02)"
            />
            <path
              d={smoothPath(prevPts)}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
          </>
        )}

        {/* Current period — smooth glowing gold line */}
        {currentPts.length > 1 && (
          <>
            <path d={smoothArea(currentPts)} fill="url(#cashGrad)" />
            {/* Glow layer */}
            <path
              d={smoothPath(currentPts)}
              fill="none"
              stroke="#c9a96e"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.3}
              filter="url(#lineGlow)"
            />
            {/* Main line */}
            <path
              d={smoothPath(currentPts)}
              fill="none"
              stroke="#c9a96e"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          </>
        )}

        {/* Data point dots */}
        {currentPts.map((p, i) => (
          <circle
            key={`dp${i}`}
            cx={p.x}
            cy={p.y}
            r={hoverIdx === i ? 6 : 3}
            fill={hoverIdx === i ? "#c9a96e" : "#0f0f12"}
            stroke="#c9a96e"
            strokeWidth={hoverIdx === i ? 2.5 : 1.5}
            style={{ transition: "r 0.15s ease, fill 0.15s ease, stroke-width 0.15s ease" }}
          />
        ))}

        {/* Hover vertical line — follows actual mouse X position */}
        {mouseXPct !== null && (
          <line
            x1={mouseXPct}
            y1={topPad}
            x2={mouseXPct}
            y2={topPad + chartH}
            stroke="rgba(201,169,110,0.25)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        )}
        {/* Glow ring at nearest data point */}
        {hoverPt && (
          <circle
            cx={hoverPt.x}
            cy={hoverPt.y}
            r={10}
            fill="none"
            stroke="rgba(201,169,110,0.2)"
            strokeWidth={1}
          />
        )}

        {/* X axis labels */}
        {xLabels.map((p) => (
          <text
            key={`xl${p.date}`}
            x={p.x}
            y={topPad + chartH + 18}
            fill="rgba(255,255,255,0.3)"
            fontSize={10}
            textAnchor="middle"
            fontFamily="monospace"
          >
            {shortDate(p.date)}
          </text>
        ))}
      </svg>

      {/* Floating tooltip — positioned at actual mouse X, above nearest data point */}
      {hoverPt && mouseXPct !== null && (
        <div
          style={{
            position: "absolute",
            left: `${(mouseXPct / width) * 100}%`,
            top: `${(hoverPt.y / height) * 100 - 16}%`,
            transform: "translate(-50%, -100%)",
            background: "rgba(15,15,18,0.95)",
            border: "1px solid rgba(201,169,110,0.4)",
            borderRadius: 8,
            padding: "8px 12px",
            pointerEvents: "none",
            zIndex: 20,
            boxShadow: "0 4px 20px rgba(0,0,0,0.6), 0 0 15px rgba(201,169,110,0.15)",
            whiteSpace: "nowrap",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "rgba(255,255,255,0.5)",
              marginBottom: 2,
            }}
          >
            {new Date(hoverPt.date + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#c9a96e",
              letterSpacing: "-0.5px",
            }}
          >
            {fmtDollars(hoverPt.amount)}
          </div>
        </div>
      )}
    </div>
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
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="12"
        />
        <text
          x="50"
          y="54"
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="10"
        >
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
            style={{
              transition:
                "stroke-dasharray 0.8s ease, stroke-dashoffset 0.8s ease",
            }}
          />
        );
        offset += dashLen;
        return el;
      })}
      <text
        x="50"
        y="46"
        textAnchor="middle"
        fill="var(--text-primary)"
        fontSize="16"
        fontWeight="700"
      >
        {wins}
      </text>
      <text
        x="50"
        y="58"
        textAnchor="middle"
        fill="var(--text-muted)"
        fontSize="8"
      >
        WINS
      </text>
    </svg>
  );
}

/* ── Delta Badge ──────────────────────────────────────────────────── */

function DeltaBadge({
  current: cur,
  previous: prev,
}: {
  current: number;
  previous: number;
}) {
  const d = delta(cur, prev);
  const color = d.flat
    ? "var(--text-muted)"
    : d.up
      ? "var(--success)"
      : "var(--danger)";
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
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          {label}
        </span>
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

function getHealth(
  metric: "showRate" | "closeRate" | "aov",
  value: number,
): HealthLevel {
  const b = BENCHMARKS[metric];
  if (value >= b.strong) return "elite";
  if (value >= b.normal) return "strong";
  if (value >= b.weak) return "normal";
  return "weak";
}

function healthColor(h: HealthLevel): string {
  switch (h) {
    case "elite":
      return "#7ec9a0";
    case "strong":
      return "#7ec9a0";
    case "normal":
      return "#e8c36a";
    case "weak":
      return "#d98e8e";
  }
}

function healthGlow(h: HealthLevel): string {
  switch (h) {
    case "elite":
      return "0 0 20px rgba(126,201,160,0.4)";
    case "strong":
      return "0 0 15px rgba(126,201,160,0.25)";
    case "normal":
      return "0 0 15px rgba(232,195,106,0.25)";
    case "weak":
      return "0 0 20px rgba(217,142,142,0.4)";
  }
}

function healthLabel(h: HealthLevel): string {
  switch (h) {
    case "elite":
      return "ELITE";
    case "strong":
      return "STRONG";
    case "normal":
      return "NORMAL";
    case "weak":
      return "WEAK";
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

const ALL_KEYFRAMES = `
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
@keyframes cursorGlowPulse {
  0%, 100% { opacity: 0.5; transform: translate(-50%,-50%) scale(1); }
  50% { opacity: 0.8; transform: translate(-50%,-50%) scale(1.1); }
}
@keyframes gridParticlePulse {
  0%, 100% { opacity: 0; r: 1; }
  15% { opacity: 0.8; r: 2.5; }
  30% { opacity: 0.3; r: 1.5; }
  50% { opacity: 0.9; r: 3; }
  70% { opacity: 0.2; r: 1; }
  85% { opacity: 0.6; r: 2; }
}
`;

let keyframesInjected = false;
function injectKeyframes() {
  if (typeof window === "undefined" || keyframesInjected) return;
  const style = document.createElement("style");
  style.textContent = ALL_KEYFRAMES;
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
  const hc = health ? healthColor(health) : color || "var(--accent)";
  const glow = health
    ? healthGlow(health)
    : "0 0 15px rgba(201,169,110,0.2)";
  return (
    <div
      style={{
        width: `${widthPct}%`,
        margin: "0 auto",
        transition: "width 0.6s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          padding: "0 4px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {health && <HealthIcon health={health} />}
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--text-secondary)",
            }}
          >
            {label}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: hc,
              letterSpacing: "-0.5px",
            }}
          >
            {formattedValue}
          </span>
          {health && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: hc,
                background: `${hc}18`,
                padding: "2px 6px",
                borderRadius: 4,
                letterSpacing: "0.5px",
              }}
            >
              {healthLabel(health)}
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          height: 36,
          borderRadius: 8,
          background: "rgba(255,255,255,0.03)",
          overflow: "hidden",
          border: `1px solid ${hc}30`,
          boxShadow: glow,
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.min(value, 100)}%`,
            maxWidth: "100%",
            borderRadius: 7,
            background: `linear-gradient(90deg, ${hc}60, ${hc})`,
            animation: `funnelFillIn 1s ${delay}s ease both`,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
              animation: `funnelPulse 2.5s ${delay + 0.5}s ease-in-out infinite`,
              borderRadius: 7,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── FunnelConnector ─────────────────────────────────────────────── */

function FunnelConnector({ delay }: { delay: number }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        height: 28,
        position: "relative",
      }}
    >
      <div
        style={{
          width: 2,
          height: "100%",
          background:
            "linear-gradient(to bottom, rgba(201,169,110,0.3), rgba(201,169,110,0.08))",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--accent)",
            left: -1,
            animation: `funnelFlowDot 1.5s ${delay}s ease-in-out infinite`,
          }}
        />
      </div>
    </div>
  );
}

/* ── VerticalFunnel ──────────────────────────────────────────────── */

function VerticalFunnel({
  metrics,
  label,
}: {
  metrics: ClientMetrics | PeriodMetrics;
  label?: string;
}) {
  const steps = [
    {
      label: "DM Booking Rate",
      value: 0,
      formattedValue: "\u2014",
      health: null as HealthLevel | null,
      widthPct: 100,
      barValue: 0,
    },
    {
      label: "Show-Up Rate",
      value: metrics.showRate,
      formattedValue: fmtPercent(metrics.showRate, 1),
      health: getHealth("showRate", metrics.showRate),
      widthPct: 85,
      barValue: metrics.showRate,
    },
    {
      label: "Close Rate",
      value: metrics.closeRate,
      formattedValue: fmtPercent(metrics.closeRate, 1),
      health: getHealth("closeRate", metrics.closeRate),
      widthPct: 70,
      barValue: metrics.closeRate,
    },
    {
      label: "AOV",
      value: metrics.aov,
      formattedValue: fmtDollars(metrics.aov),
      health: getHealth("aov", metrics.aov),
      widthPct: 55,
      barValue: Math.min((metrics.aov / 8000) * 100, 100),
    },
  ];

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      {label && (
        <div
          style={{
            textAlign: "center",
            fontSize: 13,
            fontWeight: 700,
            color: "var(--text-secondary)",
            marginBottom: 12,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      )}
      {steps.map((step, i) => (
        <div key={step.label}>
          <FunnelStep
            label={step.label}
            value={step.barValue}
            formattedValue={step.formattedValue}
            health={step.health}
            widthPct={step.widthPct}
            delay={i * 0.2}
            color={
              step.health === null ? "rgba(255,255,255,0.15)" : undefined
            }
          />
          {i < steps.length - 1 && (
            <FunnelConnector delay={i * 0.2 + 0.3} />
          )}
        </div>
      ))}
      <div
        data-reactive="0.6"
        style={{
          marginTop: 16,
          textAlign: "center",
          padding: "10px 16px",
          background: "rgba(201,169,110,0.06)",
          border: "1px solid rgba(201,169,110,0.15)",
          borderRadius: 8,
          transition:
            "transform 0.15s ease-out, box-shadow 0.15s ease-out, border-color 0.15s ease-out",
        }}
      >
        <span
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            letterSpacing: "0.5px",
          }}
        >
          REVENUE PER SHOW (RPS)
        </span>
        <div
          data-reactive-text
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "var(--accent)",
            marginTop: 4,
            transition: "text-shadow 0.15s ease-out, transform 0.15s ease-out",
          }}
        >
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

  const emptyClient: ClientMetrics = {
    cashCollected: 0,
    revenue: 0,
    wins: 0,
    losses: 0,
    pcfus: 0,
    callsBooked: 0,
    callsTaken: 0,
    noShows: 0,
    closeRate: 0,
    showRate: 0,
    aov: 0,
  };
  const keithM = metrics.byClient["Keith"] || emptyClient;
  const tysonM = metrics.byClient["Tyson"] || emptyClient;

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 6,
          marginBottom: 20,
          justifyContent: "center",
          flexWrap: "wrap",
        }}
      >
        {viewButtons.map((btn) => (
          <button
            key={btn.key}
            data-reactive="0.8"
            onClick={() => setView(btn.key)}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 6,
              border:
                view === btn.key
                  ? "1px solid var(--accent)"
                  : "1px solid rgba(255,255,255,0.1)",
              background:
                view === btn.key
                  ? "rgba(201,169,110,0.15)"
                  : "rgba(255,255,255,0.03)",
              color:
                view === btn.key ? "var(--accent)" : "var(--text-muted)",
              cursor: "pointer",
              transition:
                "all 0.15s ease-out, transform 0.15s ease-out, box-shadow 0.15s ease-out, border-color 0.15s ease-out",
              boxShadow:
                view === btn.key
                  ? "0 0 12px rgba(201,169,110,0.2)"
                  : "none",
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
      {view === "both" && <VerticalFunnel metrics={metrics} />}
      {view === "keith" && (
        <VerticalFunnel metrics={keithM} label="Keith Holland" />
      )}
      {view === "tyson" && (
        <VerticalFunnel metrics={tysonM} label="Tyson Sonnek" />
      )}
      {view === "side-by-side" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
          }}
        >
          <div
            style={{
              borderRight: "1px solid rgba(255,255,255,0.06)",
              paddingRight: 16,
            }}
          >
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
  parts.push(
    `\u{1F4CA} Analysis based on ${m.callsBooked} booked calls \u2014 ${m.callsTaken} shows, ${m.wins} wins, ${m.losses} losses, ${m.pcfus} pending follow-ups.`,
  );

  if (showH === "weak") {
    parts.push(
      `\n\u{1F6A8} PRIMARY BOTTLENECK: Show-Up Rate at ${m.showRate.toFixed(1)}% is critically low. ${m.noShows} no-shows detected. This is the highest-leverage fix \u2014 every additional show creates an opportunity. Focus on: confirmation sequences, same-day reminders, reducing time-to-call, and pre-call engagement. Target: 65%+.`,
    );
  } else if (closeH === "weak") {
    parts.push(
      `\n\u{1F6A8} PRIMARY BOTTLENECK: Close Rate at ${m.closeRate.toFixed(1)}% needs attention. Shows are coming in but conversions are lacking. Review: objection handling, offer-market fit, closer skill gaps, and call quality. Target: 40%+.`,
    );
  } else if (aovH === "weak") {
    parts.push(
      `\n\u{1F6A8} PRIMARY BOTTLENECK: AOV at ${fmtDollars(m.aov)} is below benchmark. You're closing deals but leaving revenue on the table. Consider: premium tier positioning, payment plan restructuring, and value-stack improvements. Target: $4,000+.`,
    );
  } else {
    parts.push(
      `\n\u2705 All core metrics are at or above benchmark thresholds. Focus on maintaining consistency and incremental optimization.`,
    );
  }

  if (showH !== "weak" && showH !== "elite") {
    parts.push(
      `\n\u{1F4CC} Show Rate (${m.showRate.toFixed(1)}%) is ${healthLabel(showH).toLowerCase()}. Room to improve with tighter confirmation cadences.`,
    );
  }
  if (closeH === "strong" || closeH === "elite") {
    parts.push(
      `\n\u{1F3C6} Close Rate at ${m.closeRate.toFixed(1)}% is ${healthLabel(closeH).toLowerCase()} \u2014 your closers are performing well.`,
    );
  }

  parts.push(
    `\n\u{1F4B0} Revenue Per Show: ${fmtDollars(rps)}. This composite metric reflects the cash yield of every person who shows up.`,
  );

  const keith = m.byClient["Keith"];
  const tyson = m.byClient["Tyson"];
  if (
    keith &&
    tyson &&
    keith.callsBooked > 2 &&
    tyson.callsBooked > 2
  ) {
    const kCR = keith.closeRate;
    const tCR = tyson.closeRate;
    if (Math.abs(kCR - tCR) > 10) {
      const higher = kCR > tCR ? "Keith" : "Tyson";
      const lower = kCR > tCR ? "Tyson" : "Keith";
      parts.push(
        `\n\u{1F4CA} Offer gap: ${higher} close rate (${Math.max(kCR, tCR).toFixed(1)}%) outperforms ${lower} (${Math.min(kCR, tCR).toFixed(1)}%) by ${Math.abs(kCR - tCR).toFixed(1)}pp. Use Side-by-Side view to compare funnels.`,
      );
    }
  }

  return parts.join("");
}

function getAiResponse(userMsg: string, m: PeriodMetrics): string {
  const msg = userMsg.toLowerCase();

  if (msg.includes("show") && (msg.includes("rate") || msg.includes("up"))) {
    const h = getHealth("showRate", m.showRate);
    return `Show-Up Rate is at ${m.showRate.toFixed(1)}% (${healthLabel(h)}). ${m.noShows} no-shows out of ${m.callsBooked} booked. ${h === "weak" ? "This is your biggest opportunity \u2014 improving show rate has the highest leverage on revenue." : "Solid performance here. Keep monitoring for consistency."}`;
  }
  if (
    msg.includes("close") &&
    (msg.includes("rate") || msg.includes("deal"))
  ) {
    const h = getHealth("closeRate", m.closeRate);
    return `Close Rate stands at ${m.closeRate.toFixed(1)}% (${healthLabel(h)}). ${m.wins}W / ${m.losses}L / ${m.pcfus} PCFU. ${h === "weak" ? "Focus on objection handling and call quality review." : h === "elite" ? "Elite-level closing. Maintain this pace." : "Good performance. Dial in your follow-up system to convert those PCFUs."}`;
  }
  if (
    msg.includes("aov") ||
    msg.includes("average") ||
    msg.includes("order value")
  ) {
    const h = getHealth("aov", m.aov);
    return `AOV is ${fmtDollars(m.aov)} (${healthLabel(h)}). ${h === "weak" ? "Consider premium positioning and value-stack enhancements." : "AOV is healthy. Look at upsell opportunities for further gains."}`;
  }
  if (msg.includes("rps") || msg.includes("revenue per show")) {
    const rps = (m.closeRate / 100) * m.aov;
    return `RPS (Revenue Per Show) is ${fmtDollars(rps)}. This means every person who shows up on a call generates ${fmtDollars(rps)} in expected revenue. To increase RPS, improve either close rate or AOV.`;
  }
  if (
    msg.includes("keith") ||
    msg.includes("tyson") ||
    msg.includes("offer")
  ) {
    const k = m.byClient["Keith"];
    const t = m.byClient["Tyson"];
    if (k && t) {
      return `Keith: ${k.wins}W, ${fmtPercent(k.closeRate, 1)} close, ${fmtDollars(k.aov)} AOV. Tyson: ${t.wins}W, ${fmtPercent(t.closeRate, 1)} close, ${fmtDollars(t.aov)} AOV. Use the Side-by-Side toggle above to compare their full funnels.`;
    }
    return "Per-offer data is available in the funnel above. Toggle to Side-by-Side view for a detailed comparison.";
  }
  if (
    msg.includes("bottleneck") ||
    msg.includes("problem") ||
    msg.includes("issue") ||
    msg.includes("fix")
  ) {
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
        setMessages([
          {
            id: "init-" + Date.now(),
            role: "ai",
            text: analysis,
            timestamp: new Date(),
          },
        ]);
        setThinking(false);
        setInitialized(true);
      }, 1200);
      return () => clearTimeout(timer);
    }
  }, [metrics, initialized]);

  const handleSend = () => {
    if (!input.trim()) return;
    const userMsg: AIMessage = {
      id: "u-" + Date.now(),
      role: "user",
      text: input.trim(),
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setThinking(true);
    setTimeout(() => {
      const reply = getAiResponse(userMsg.text, metrics);
      setMessages((prev) => [
        ...prev,
        {
          id: "ai-" + Date.now(),
          role: "ai",
          text: reply,
          timestamp: new Date(),
        },
      ]);
      setThinking(false);
    }, 800 + Math.random() * 600);
  };

  return (
    <div
      data-reactive="0.6"
      style={{
        position: "relative",
        borderRadius: 12,
        border: "1px solid rgba(201,169,110,0.2)",
        background: "rgba(201,169,110,0.03)",
        overflow: "hidden",
        animation: "inboxGlow 4s ease-in-out infinite",
        transition:
          "transform 0.15s ease-out, box-shadow 0.15s ease-out, border-color 0.15s ease-out",
      }}
    >
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--accent)",
            top: `${20 + i * 25}%`,
            right: `${5 + i * 8}%`,
            animation: `inboxParticle${i} ${2.5 + i * 0.5}s ease-in-out infinite`,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      ))}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 18px",
          borderBottom: "1px solid rgba(201,169,110,0.12)",
          background: "rgba(201,169,110,0.04)",
        }}
      >
        <div style={{ position: "relative" }}>
          <Brain
            size={20}
            style={{
              color: "var(--accent)",
              animation: "aiPulse 2s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "#7ec9a0",
              bottom: -1,
              right: -1,
              border: "1.5px solid #0f0f12",
            }}
          />
        </div>
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: "var(--accent)",
              letterSpacing: "0.3px",
            }}
          >
            Bottleneck AI
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            Powered by GAS Protocol
          </div>
        </div>
        <Sparkles
          size={14}
          style={{ marginLeft: "auto", color: "var(--accent)", opacity: 0.5 }}
        />
      </div>
      <div
        style={{
          padding: "16px 18px",
          maxHeight: 320,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              justifyContent:
                msg.role === "user" ? "flex-end" : "flex-start",
              animation: "messageSlideIn 0.3s ease",
            }}
          >
            <div
              style={{
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius:
                  msg.role === "ai"
                    ? "12px 12px 12px 4px"
                    : "12px 12px 4px 12px",
                background:
                  msg.role === "ai"
                    ? "rgba(201,169,110,0.08)"
                    : "rgba(126,201,160,0.1)",
                border: `1px solid ${msg.role === "ai" ? "rgba(201,169,110,0.15)" : "rgba(126,201,160,0.15)"}`,
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "var(--text-secondary)",
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.role === "ai" && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    marginBottom: 6,
                  }}
                >
                  <Sparkles size={11} style={{ color: "var(--accent)" }} />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: "var(--accent)",
                      letterSpacing: "0.5px",
                    }}
                  >
                    AI ANALYSIS
                  </span>
                </div>
              )}
              {msg.text}
              <div
                style={{
                  fontSize: 9,
                  color: "var(--text-muted)",
                  marginTop: 6,
                  textAlign: "right",
                }}
              >
                {msg.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ))}
        {thinking && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 0",
            }}
          >
            <Brain
              size={14}
              style={{
                color: "var(--accent)",
                animation: "aiPulse 1.5s ease-in-out infinite",
              }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--accent)",
                    animation: `thinkingDot 1.4s ${i * 0.2}s ease-in-out infinite`,
                  }}
                />
              ))}
            </div>
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                fontStyle: "italic",
              }}
            >
              analyzing...
            </span>
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "12px 18px",
          borderTop: "1px solid rgba(201,169,110,0.12)",
          background: "rgba(0,0,0,0.15)",
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Ask about show rate, close rate, bottlenecks..."
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(201,169,110,0.15)",
            background: "rgba(255,255,255,0.03)",
            color: "var(--text-primary)",
            fontSize: 12,
            outline: "none",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || thinking}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid rgba(201,169,110,0.3)",
            background:
              input.trim() && !thinking
                ? "rgba(201,169,110,0.15)"
                : "rgba(255,255,255,0.03)",
            color:
              input.trim() && !thinking
                ? "var(--accent)"
                : "var(--text-muted)",
            cursor: input.trim() && !thinking ? "pointer" : "default",
            transition: "all 0.2s ease",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}

/* ── Mouse Reactive System ──────────────────────────────────────── */

function setupMouseTracking(
  container: HTMLDivElement,
  cursorGlow: HTMLDivElement | null,
  clientX: number,
  clientY: number,
) {
  const rect = container.getBoundingClientRect();
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;

  if (cursorGlow) {
    cursorGlow.style.left = `${relX}px`;
    cursorGlow.style.top = `${relY}px`;
    cursorGlow.style.opacity = "1";
  }

  const reactives = container.querySelectorAll("[data-reactive]");

  // Find the closest card to apply full effect; others get subtle treatment
  let closestEl: Element | null = null;
  let closestDist = Infinity;
  reactives.forEach((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.sqrt((clientX - cx) ** 2 + (clientY - cy) ** 2);
    if (dist < closestDist) {
      closestDist = dist;
      closestEl = el;
    }
  });

  reactives.forEach((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = 300;
    const p = Math.max(0, 1 - dist / maxDist);
    const intensity = parseFloat(
      (el as HTMLElement).dataset.reactive || "1",
    );
    const pi = p * intensity;

    const isMain = el === closestEl;
    // Main card: full effect. Others: 25% tilt/scale/translate, 40% glow
    const tiltMul = isMain ? 1 : 0.25;
    const glowMul = isMain ? 1 : 0.4;

    const scale = 1 + pi * 0.04 * tiltMul;
    const rotX = ((dy / maxDist) * 4 * intensity * tiltMul).toFixed(2);
    const rotY = ((-dx / maxDist) * 4 * intensity * tiltMul).toFixed(2);
    const tx = ((dx / maxDist) * 3 * intensity * tiltMul).toFixed(1);
    const ty = ((dy / maxDist) * 3 * intensity * tiltMul).toFixed(1);
    const glowA = (pi * 0.45 * glowMul).toFixed(2);
    const borderA = (0.06 + pi * 0.45 * glowMul).toFixed(2);

    const htmlEl = el as HTMLElement;
    htmlEl.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale.toFixed(4)}) translate(${tx}px, ${ty}px)`;
    htmlEl.style.boxShadow = `0 0 ${Math.round(pi * 30 * glowMul)}px rgba(201,169,110,${glowA}), inset 0 0 ${Math.round(pi * 10 * glowMul)}px rgba(201,169,110,${(pi * 0.06 * glowMul).toFixed(2)})`;
    htmlEl.style.borderColor = `rgba(201,169,110,${borderA})`;
  });

  const texts = container.querySelectorAll("[data-reactive-text]");
  texts.forEach((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.sqrt(
      (clientX - cx) ** 2 + (clientY - cy) ** 2,
    );
    const p = Math.max(0, 1 - dist / 200);
    const htmlEl = el as HTMLElement;
    htmlEl.style.textShadow = `0 0 ${Math.round(p * 14)}px rgba(201,169,110,${(p * 0.7).toFixed(2)})`;
    htmlEl.style.transform = `scale(${(1 + p * 0.025).toFixed(4)})`;
  });

  const icons = container.querySelectorAll("[data-reactive-icon]");
  icons.forEach((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dist = Math.sqrt(
      (clientX - cx) ** 2 + (clientY - cy) ** 2,
    );
    const p = Math.max(0, 1 - dist / 180);
    const htmlEl = el as HTMLElement;
    htmlEl.style.filter = `drop-shadow(0 0 ${Math.round(p * 10)}px rgba(201,169,110,${(p * 0.8).toFixed(2)}))`;
    htmlEl.style.transform = `scale(${(1 + p * 0.2).toFixed(3)}) rotate(${(p * 10).toFixed(1)}deg)`;
  });

  const bars = container.querySelectorAll("[data-reactive-bar]");
  bars.forEach((el) => {
    const r = el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const dist = Math.abs(clientY - cy);
    const p = Math.max(0, 1 - dist / 150);
    const htmlEl = el as HTMLElement;
    htmlEl.style.filter = `brightness(${(1 + p * 0.3).toFixed(2)})`;
    htmlEl.style.boxShadow = `0 0 ${Math.round(p * 12)}px rgba(201,169,110,${(p * 0.3).toFixed(2)})`;
  });

  const seps = container.querySelectorAll("[data-reactive-sep]");
  seps.forEach((el) => {
    const r = el.getBoundingClientRect();
    const cy = r.top + r.height / 2;
    const dist = Math.abs(clientY - cy);
    const p = Math.max(0, 1 - dist / 200);
    const htmlEl = el as HTMLElement;
    htmlEl.style.opacity = `${0.3 + p * 0.7}`;
    htmlEl.style.height = `${1 + p * 2}px`;
  });
}

function resetMouseTracking(container: HTMLDivElement) {
  container
    .querySelectorAll("[data-reactive]")
    .forEach((el) => {
      const h = el as HTMLElement;
      h.style.transform = "";
      h.style.boxShadow = "";
      h.style.borderColor = "rgba(255,255,255,0.06)";
    });
  container
    .querySelectorAll("[data-reactive-text]")
    .forEach((el) => {
      const h = el as HTMLElement;
      h.style.textShadow = "";
      h.style.transform = "";
    });
  container
    .querySelectorAll("[data-reactive-icon]")
    .forEach((el) => {
      const h = el as HTMLElement;
      h.style.filter = "";
      h.style.transform = "";
    });
  container
    .querySelectorAll("[data-reactive-bar]")
    .forEach((el) => {
      const h = el as HTMLElement;
      h.style.filter = "";
      h.style.boxShadow = "";
    });
  container
    .querySelectorAll("[data-reactive-sep]")
    .forEach((el) => {
      const h = el as HTMLElement;
      h.style.opacity = "";
      h.style.height = "";
    });
}

/* ── Reactive card style helper ─────────────────────────────────── */

const RC: React.CSSProperties = {
  transition:
    "transform 0.15s ease-out, box-shadow 0.15s ease-out, border-color 0.15s ease-out",
};

const RT: React.CSSProperties = {
  transition:
    "text-shadow 0.15s ease-out, transform 0.15s ease-out",
};

const RI: React.CSSProperties = {
  transition: "filter 0.15s ease-out, transform 0.15s ease-out",
  display: "inline-flex",
};

/* ── Component ────────────────────────────────────────────────────── */

export default function AlexTesting({ filters }: AlexTestingProps) {
  /* ── Date override state ─────────────────────────────────── */
  const [alexDatePreset, setAlexDatePreset] =
    useState<AlexDatePreset>("page");
  const [alexCustomFrom, setAlexCustomFrom] = useState("");
  const [alexCustomTo, setAlexCustomTo] = useState("");

  const alexDates = useMemo(() => {
    const today = new Date();
    switch (alexDatePreset) {
      case "page":
        return getEffectiveDates(filters);
      case "mtd": {
        const from = new Date(today.getFullYear(), today.getMonth(), 1);
        return { dateFrom: fmtLocalDate(from), dateTo: fmtLocalDate(today) };
      }
      case "last-month": {
        const from = new Date(
          today.getFullYear(),
          today.getMonth() - 1,
          1,
        );
        const to = new Date(today.getFullYear(), today.getMonth(), 0);
        return { dateFrom: fmtLocalDate(from), dateTo: fmtLocalDate(to) };
      }
      case "last-3": {
        const from = new Date(
          today.getFullYear(),
          today.getMonth() - 3,
          1,
        );
        return { dateFrom: fmtLocalDate(from), dateTo: fmtLocalDate(today) };
      }
      case "all-time":
        return { dateFrom: "2024-01-01", dateTo: fmtLocalDate(today) };
      case "custom":
        return {
          dateFrom: alexCustomFrom || fmtLocalDate(today),
          dateTo: alexCustomTo || fmtLocalDate(today),
        };
    }
  }, [alexDatePreset, alexCustomFrom, alexCustomTo, filters]);

  const dateFrom = alexDates.dateFrom;
  const dateTo = alexDates.dateTo;
  const prev = useMemo(
    () => getPrevPeriod(dateFrom, dateTo),
    [dateFrom, dateTo],
  );

  /* ── Data fetching ─────────────────────────────────────── */
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

  /* ── Mouse reactive refs ──────────────────────────────── */
  const mouseContainerRef = useRef<HTMLDivElement>(null);
  const cursorGlowRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const container = mouseContainerRef.current;
        if (!container) return;
        setupMouseTracking(
          container,
          cursorGlowRef.current,
          e.clientX,
          e.clientY,
        );
      });
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const glow = cursorGlowRef.current;
    if (glow) glow.style.opacity = "0";
    const container = mouseContainerRef.current;
    if (container) resetMouseTracking(container);
  }, []);

  /* ── Inject keyframes on mount ────────────────────────── */
  useEffect(() => {
    injectKeyframes();
  }, []);

  /* ── Loading ────────────────────────────────────────────── */
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
  const rc = (v: number) =>
    v >= 50 ? "var(--success)" : v >= 30 ? "var(--warning)" : "var(--danger)";

  const DATE_TABS: { key: AlexDatePreset; label: string }[] = [
    { key: "page", label: "Page Filters" },
    { key: "mtd", label: "This Month" },
    { key: "last-month", label: "Last Month" },
    { key: "last-3", label: "Last 3 Months" },
    { key: "all-time", label: "All Time" },
    { key: "custom", label: "Custom" },
  ];

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div
      ref={mouseContainerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative" }}
    >
      {/* Cursor glow */}
      <div
        ref={cursorGlowRef}
        style={{
          position: "absolute",
          width: 300,
          height: 300,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(201,169,110,0.1) 0%, rgba(201,169,110,0.03) 40%, transparent 70%)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
          opacity: 0,
          transition: "opacity 0.3s ease",
          zIndex: 0,
        }}
      />

      {/* ═══ Date Selection Bar ═══ */}
      <div
        data-reactive="0.5"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 16px",
          borderRadius: 10,
          border: "1px solid rgba(201,169,110,0.12)",
          background: "rgba(201,169,110,0.03)",
          flexWrap: "wrap",
          ...RC,
        }}
      >
        <span data-reactive-icon style={RI}>
          <Calendar size={14} style={{ color: "var(--accent)" }} />
        </span>
        {DATE_TABS.map((tab) => (
          <button
            key={tab.key}
            data-reactive="0.7"
            onClick={() => setAlexDatePreset(tab.key)}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 6,
              border:
                alexDatePreset === tab.key
                  ? "1px solid var(--accent)"
                  : "1px solid rgba(255,255,255,0.06)",
              background:
                alexDatePreset === tab.key
                  ? "rgba(201,169,110,0.18)"
                  : "rgba(255,255,255,0.02)",
              color:
                alexDatePreset === tab.key
                  ? "var(--accent)"
                  : "var(--text-muted)",
              cursor: "pointer",
              ...RC,
            }}
          >
            {tab.label}
          </button>
        ))}
        {alexDatePreset === "custom" && (
          <>
            <div
              style={{
                width: 1,
                height: 20,
                background: "rgba(201,169,110,0.15)",
                flexShrink: 0,
              }}
            />
            <input
              type="date"
              value={alexCustomFrom}
              onChange={(e) => setAlexCustomFrom(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid rgba(201,169,110,0.2)",
                background: "rgba(255,255,255,0.03)",
                color: "var(--text-primary)",
                fontSize: 11,
                outline: "none",
              }}
            />
            <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
              to
            </span>
            <input
              type="date"
              value={alexCustomTo}
              onChange={(e) => setAlexCustomTo(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: "1px solid rgba(201,169,110,0.2)",
                background: "rgba(255,255,255,0.03)",
                color: "var(--text-primary)",
                fontSize: 11,
                outline: "none",
              }}
            />
          </>
        )}
        <span
          style={{
            marginLeft: "auto",
            fontSize: 10,
            color: "var(--text-muted)",
            whiteSpace: "nowrap",
          }}
        >
          {shortDate(dateFrom)} \u2013 {shortDate(dateTo)}
        </span>
      </div>

      {/* ═══ ROW 1: Hero KPIs ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {/* Cash Collected */}
        <div
          data-reactive="1"
          style={{
            padding: "20px 18px",
            position: "relative",
            overflow: "hidden",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            ...RC,
          }}
        >
          <div
            data-reactive-bar
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background:
                "linear-gradient(90deg, var(--accent), rgba(201,169,110,0.2))",
              transition: "filter 0.15s ease-out",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span data-reactive-icon style={RI}>
              <Banknote size={16} style={{ color: "var(--accent)" }} />
            </span>
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
            data-reactive-text
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "var(--text-primary)",
              letterSpacing: "-1px",
              marginBottom: 6,
              ...RT,
            }}
          >
            {fmtDollars(current.cashCollected)}
          </div>
          <DeltaBadge current={current.cashCollected} previous={prev2.cashCollected} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            prev: {fmtDollars(prev2.cashCollected)}
          </div>
        </div>

        {/* Close Rate */}
        <div
          data-reactive="1"
          style={{
            padding: "20px 18px",
            position: "relative",
            overflow: "hidden",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            ...RC,
          }}
        >
          <div
            data-reactive-bar
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background: `linear-gradient(90deg, ${rc(current.closeRate)}, ${rc(current.closeRate)}33)`,
              transition: "filter 0.15s ease-out",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span data-reactive-icon style={RI}>
              <Target size={16} style={{ color: rc(current.closeRate) }} />
            </span>
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
            data-reactive-text
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: rc(current.closeRate),
              letterSpacing: "-1px",
              marginBottom: 6,
              ...RT,
            }}
          >
            {fmtPercent(current.closeRate, 1)}
          </div>
          <DeltaBadge current={current.closeRate} previous={prev2.closeRate} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            {current.wins}W / {current.losses}L / {current.pcfus} PCFU
          </div>
        </div>

        {/* Revenue */}
        <div
          data-reactive="1"
          style={{
            padding: "20px 18px",
            position: "relative",
            overflow: "hidden",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            ...RC,
          }}
        >
          <div
            data-reactive-bar
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 3,
              background:
                "linear-gradient(90deg, var(--success), rgba(126,201,160,0.2))",
              transition: "filter 0.15s ease-out",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span data-reactive-icon style={RI}>
              <DollarSign size={16} style={{ color: "var(--success)" }} />
            </span>
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
            data-reactive-text
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "var(--text-primary)",
              letterSpacing: "-1px",
              marginBottom: 6,
              ...RT,
            }}
          >
            {fmtDollars(current.revenue)}
          </div>
          <DeltaBadge current={current.revenue} previous={prev2.revenue} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
            prev: {fmtDollars(prev2.revenue)}
          </div>
        </div>
      </div>

      {/* Daily Cash Chart */}
      <div
        data-reactive="0.8"
        style={{
          padding: "16px 0 12px 0",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10,10,14,0.6)",
          overflow: "hidden",
          ...RC,
        }}
      >
        <div
          data-reactive-text
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginBottom: 8,
            fontWeight: 600,
            padding: "0 18px",
            ...RT,
          }}
        >
          Daily Cash Collected
        </div>
        <CashChart current={current.dailyCash} previous={prev2.dailyCash} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 6,
            fontSize: 10,
            color: "var(--text-muted)",
            padding: "0 18px",
          }}
        >
          <span>
            <span
              data-reactive-bar
              style={{
                display: "inline-block",
                width: 8,
                height: 2,
                background: "var(--accent)",
                marginRight: 4,
                verticalAlign: "middle",
                transition: "filter 0.15s ease-out",
              }}
            />
            Current
          </span>
          <span>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 2,
                background: "rgba(255,255,255,0.15)",
                marginRight: 4,
                verticalAlign: "middle",
              }}
            />
            Previous
          </span>
        </div>
      </div>

      {/* ═══ ROW 2: Donut + Client + Closers ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {/* Donut */}
        <div
          data-reactive="1"
          style={{
            padding: "18px 14px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            ...RC,
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
              {
                label: "No-Show",
                color: "rgba(255,255,255,0.2)",
                v: current.noShows,
              },
            ].map((s) => (
              <div
                key={s.label}
                data-reactive-text
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  ...RT,
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: s.color,
                  }}
                />
                <span style={{ color: "var(--text-muted)" }}>
                  {s.label}:{" "}
                  <strong style={{ color: "var(--text-secondary)" }}>
                    {s.v}
                  </strong>
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Client Breakdown */}
        <div
          data-reactive="1"
          style={{
            padding: "18px 14px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            ...RC,
          }}
        >
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
                    data-reactive-text
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color:
                        name === "Keith"
                          ? "var(--keith, #b8a4d9)"
                          : "var(--tyson, #82c5c5)",
                      ...RT,
                    }}
                  >
                    {name}
                  </span>
                  <span
                    data-reactive-text
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--success)",
                      ...RT,
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
        <div
          data-reactive="1"
          style={{
            padding: "18px 14px",
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.02)",
            ...RC,
          }}
        >
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
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
                padding: 20,
              }}
            >
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
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          data-reactive-text
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--text-primary)",
                            ...RT,
                          }}
                        >
                          {name}
                        </span>
                        {i === 0 && (
                          <span data-reactive-icon style={RI}>
                            <Trophy
                              size={12}
                              style={{
                                color: "var(--accent)",
                                marginLeft: 2,
                              }}
                            />
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 2,
                        }}
                      >
                        <span
                          data-reactive-text
                          style={{
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--success)",
                            ...RT,
                          }}
                        >
                          {fmtDollars(stats.cash)}
                          <span
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              fontWeight: 400,
                              marginLeft: 4,
                            }}
                          >
                            cash
                          </span>
                        </span>
                        {prevCloser && (
                          <span
                            style={{
                              fontSize: 10,
                              color: "var(--text-muted)",
                            }}
                          >
                            prev: {fmtDollars(prevCloser.cash)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div
                      data-reactive-bar
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: "rgba(255,255,255,0.04)",
                        overflow: "hidden",
                        transition:
                          "filter 0.15s ease-out, box-shadow 0.15s ease-out",
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
                        <strong style={{ color: "var(--success)" }}>
                          {stats.wins}
                        </strong>{" "}
                        W ·{" "}
                        <strong style={{ color: "var(--danger)" }}>
                          {stats.losses}
                        </strong>{" "}
                        L ·{" "}
                        {stats.pcfus > 0 && (
                          <>
                            <strong>{stats.pcfus}</strong> PCFU ·{" "}
                          </>
                        )}
                        {(() => {
                          const decided =
                            stats.wins + stats.losses + stats.pcfus;
                          const rate =
                            decided > 0
                              ? (stats.wins / decided) * 100
                              : 0;
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

      {/* ═══ ROW 3: Quick Stats ═══ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 12,
          marginTop: 16,
        }}
      >
        {[
          {
            icon: <Target size={14} />,
            label: "AOV",
            value: fmtDollars(current.aov),
            prevLabel: fmtDollars(prev2.aov),
            prev: prev2.aov,
            cur: current.aov,
          },
          {
            icon: <PhoneCall size={14} />,
            label: "Show Rate",
            value: fmtPercent(current.showRate, 0),
            prevLabel: fmtPercent(prev2.showRate, 0),
            prev: prev2.showRate,
            cur: current.showRate,
          },
          {
            icon: <Trophy size={14} />,
            label: "Wins",
            value: fmtNumber(current.wins),
            prevLabel: fmtNumber(prev2.wins),
            prev: prev2.wins,
            cur: current.wins,
          },
          {
            icon: <Users size={14} />,
            label: "Calls Booked",
            value: fmtNumber(current.callsBooked),
            prevLabel: fmtNumber(prev2.callsBooked),
            prev: prev2.callsBooked,
            cur: current.callsBooked,
          },
          {
            icon: <TrendingUp size={14} />,
            label: "Pending (PCFU)",
            value: fmtNumber(current.pcfus),
            prevLabel: fmtNumber(prev2.pcfus),
            prev: prev2.pcfus,
            cur: current.pcfus,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            data-reactive="1"
            style={{
              padding: "16px 14px",
              textAlign: "center",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.06)",
              background: "rgba(255,255,255,0.02)",
              ...RC,
            }}
          >
            <div
              data-reactive-icon
              style={{ color: "var(--text-muted)", marginBottom: 8, ...RI, justifyContent: "center" }}
            >
              {stat.icon}
            </div>
            <div
              data-reactive-text
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "var(--text-primary)",
                letterSpacing: "-0.5px",
                lineHeight: 1,
                marginBottom: 6,
                ...RT,
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
            <div
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                marginTop: 4,
              }}
            >
              was {stat.prevLabel}
            </div>
          </div>
        ))}
      </div>

      {/* ═══ Separator ═══ */}
      <div
        data-reactive-sep
        style={{
          height: 1,
          background:
            "linear-gradient(to right, transparent, rgba(201,169,110,0.25), transparent)",
          marginTop: 8,
          transition: "opacity 0.15s ease-out, height 0.15s ease-out",
        }}
      />

      {/* ═══ ALEX TEST: Funnel + AI ═══ */}
      <div style={{ marginTop: 4 }}>
        <button
          data-reactive="0.8"
          onClick={() => setAlexTestOpen(!alexTestOpen)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderRadius: alexTestOpen ? "10px 10px 0 0" : 10,
            border: "1px solid rgba(201,169,110,0.2)",
            borderBottom: alexTestOpen
              ? "1px solid rgba(201,169,110,0.1)"
              : undefined,
            background: "rgba(201,169,110,0.04)",
            cursor: "pointer",
            ...RC,
          }}
        >
          <div
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
            <div style={{ position: "relative" }}>
              <Sparkles
                size={18}
                style={{
                  color: "var(--accent)",
                  animation: alexTestOpen
                    ? "aiPulse 2s ease-in-out infinite"
                    : "none",
                }}
              />
              {alexTestOpen &&
                [1, 2, 3].map((i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      width: 3,
                      height: 3,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      top: `${-2 + i * 4}px`,
                      left: `${18 + i * 3}px`,
                      animation: `inboxParticle${i} ${2 + i * 0.4}s ease-in-out infinite`,
                      pointerEvents: "none",
                    }}
                  />
                ))}
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--accent)",
                letterSpacing: "0.3px",
              }}
            >
              Alex Test
            </span>
            <span
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                background: "rgba(201,169,110,0.08)",
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              Funnel + AI
            </span>
          </div>
          <ChevronDown
            size={16}
            style={{
              color: "var(--accent)",
              transform: alexTestOpen
                ? "rotate(180deg)"
                : "rotate(0deg)",
              transition: "transform 0.3s ease",
            }}
          />
        </button>

        <div
          style={{
            maxHeight: alexTestOpen ? 2000 : 0,
            overflow: "hidden",
            transition:
              "max-height 0.5s cubic-bezier(0.4, 0, 0.2, 1)",
            borderRadius: "0 0 10px 10px",
            border: alexTestOpen
              ? "1px solid rgba(201,169,110,0.15)"
              : "none",
            borderTop: "none",
            background: "rgba(0,0,0,0.1)",
          }}
        >
          <div
            style={{
              padding: "24px 20px",
              display: "flex",
              flexDirection: "column",
              gap: 28,
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <span data-reactive-icon style={RI}>
                  <Activity
                    size={16}
                    style={{ color: "var(--accent)" }}
                  />
                </span>
                <span
                  data-reactive-text
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    letterSpacing: "0.3px",
                    ...RT,
                  }}
                >
                  Sales Funnel
                </span>
              </div>
              <FunnelSection metrics={current} />
            </div>

            <div
              data-reactive-sep
              style={{
                height: 1,
                background:
                  "linear-gradient(to right, transparent, rgba(201,169,110,0.2), transparent)",
                transition:
                  "opacity 0.15s ease-out, height 0.15s ease-out",
              }}
            />

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <span data-reactive-icon style={RI}>
                  <MessageCircle
                    size={16}
                    style={{ color: "var(--accent)" }}
                  />
                </span>
                <span
                  data-reactive-text
                  style={{
                    fontSize: 14,
                    fontWeight: 700,
                    color: "var(--text-primary)",
                    letterSpacing: "0.3px",
                    ...RT,
                  }}
                >
                  Bottleneck Analysis
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "var(--accent)",
                    background: "rgba(201,169,110,0.1)",
                    padding: "2px 6px",
                    borderRadius: 4,
                    letterSpacing: "0.5px",
                    animation: "aiPulse 3s ease-in-out infinite",
                  }}
                >
                  AI
                </span>
              </div>
              <BottleneckInbox metrics={current} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
