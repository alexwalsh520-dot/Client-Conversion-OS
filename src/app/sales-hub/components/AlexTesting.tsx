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
  byCloser: Record<string, { cash: number; wins: number; calls: number }>;
}

interface ClientMetrics {
  cashCollected: number;
  revenue: number;
  wins: number;
  losses: number;
  callsBooked: number;
  callsTaken: number;
  closeRate: number;
  showRate: number;
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
  const prevTo = new Date(from.getTime() - 86400000); // day before current start
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

  const winRows = rows.filter((r) => r.outcome === "WIN");
  const revenue = winRows.reduce((s, r) => s + r.revenue, 0);
  const cashCollected = winRows.reduce((s, r) => s + r.cashCollected, 0);
  const aov = wins > 0 ? revenue / wins : 0;

  // Daily cash aggregation
  const dailyMap: Record<string, number> = {};
  for (const r of winRows) {
    if (r.date) {
      dailyMap[r.date] = (dailyMap[r.date] || 0) + r.cashCollected;
    }
  }
  const dailyCash = Object.entries(dailyMap)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // By client (offer)
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
    const cWin = clientRows.filter((r) => r.outcome === "WIN");
    byClient[label] = {
      cashCollected: cWin.reduce((s, r) => s + r.cashCollected, 0),
      revenue: cWin.reduce((s, r) => s + r.revenue, 0),
      wins: w,
      losses: l,
      callsBooked: cb,
      callsTaken: ct,
      closeRate: d > 0 ? (w / d) * 100 : 0,
      showRate: cb > 0 ? (ct / cb) * 100 : 0,
    };
  }

  // By closer
  const byCloser: Record<string, { cash: number; wins: number; calls: number }> = {};
  for (const r of rows) {
    const name = r.closer?.trim();
    if (!name) continue;
    if (!byCloser[name]) byCloser[name] = { cash: 0, wins: 0, calls: 0 };
    byCloser[name].calls++;
    if (r.outcome === "WIN") {
      byCloser[name].wins++;
      byCloser[name].cash += r.cashCollected;
    }
  }

  return {
    cashCollected, revenue, wins, losses, pcfus, callsBooked,
    callsTaken, noShows, closeRate, showRate, aov, dailyCash,
    byClient, byCloser,
  };
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
  height = 160,
}: {
  current: { date: string; amount: number }[];
  previous: { date: string; amount: number }[];
  height?: number;
}) {
  const allValues = [...current.map((d) => d.amount), ...previous.map((d) => d.amount)];
  const maxVal = Math.max(...allValues, 1);
  const width = 400;
  const pad = 8;

  const toPath = (data: { date: string; amount: number }[], close: boolean) => {
    if (data.length === 0) return "";
    const stepX = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
    const points = data.map((d, i) => {
      const x = pad + i * stepX;
      const y = height - pad - ((d.amount / maxVal) * (height - pad * 2));
      return `${x},${y}`;
    });

    let path = `M${points[0]}`;
    // Smooth curve
    for (let i = 1; i < points.length; i++) {
      const [prevX, prevY] = points[i - 1].split(",").map(Number);
      const [currX, currY] = points[i].split(",").map(Number);
      const cpX = (prevX + currX) / 2;
      path += ` C${cpX},${prevY} ${cpX},${currY} ${currX},${currY}`;
    }

    if (close) {
      const lastX = pad + (data.length - 1) * stepX;
      path += ` L${lastX},${height - pad} L${pad},${height - pad} Z`;
    }

    return path;
  };

  // Y-axis labels
  const yLabels = [0, Math.round(maxVal * 0.5), Math.round(maxVal)];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "100%" }}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="currentGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="prevGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--text-muted)" stopOpacity="0.1" />
          <stop offset="100%" stopColor="var(--text-muted)" stopOpacity="0.01" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yLabels.map((_, i) => {
        const y = height - pad - ((i / 2) * (height - pad * 2));
        return (
          <line
            key={i}
            x1={pad}
            y1={y}
            x2={width - pad}
            y2={y}
            stroke="rgba(255,255,255,0.04)"
            strokeDasharray="4,4"
          />
        );
      })}

      {/* Previous month area */}
      {previous.length > 0 && (
        <>
          <path d={toPath(previous, true)} fill="url(#prevGrad)" />
          <path
            d={toPath(previous, false)}
            fill="none"
            stroke="var(--text-muted)"
            strokeWidth="1.5"
            strokeOpacity="0.25"
            strokeDasharray="4,3"
          />
        </>
      )}

      {/* Current month area */}
      {current.length > 0 && (
        <>
          <path d={toPath(current, true)} fill="url(#currentGrad)" />
          <path
            d={toPath(current, false)}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
          />
          {/* Dot on last point */}
          {(() => {
            const stepX = current.length > 1 ? (width - pad * 2) / (current.length - 1) : 0;
            const last = current[current.length - 1];
            const x = pad + (current.length - 1) * stepX;
            const y = height - pad - ((last.amount / maxVal) * (height - pad * 2));
            return (
              <>
                <circle cx={x} cy={y} r="4" fill="var(--accent)" />
                <circle cx={x} cy={y} r="7" fill="var(--accent)" opacity="0.2" />
              </>
            );
          })()}
        </>
      )}

      {/* Y-axis labels */}
      {yLabels.map((val, i) => {
        const y = height - pad - ((i / 2) * (height - pad * 2));
        return (
          <text
            key={i}
            x={pad + 2}
            y={y - 4}
            fontSize="9"
            fill="rgba(255,255,255,0.25)"
            fontFamily="var(--font-sans)"
          >
            ${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}
          </text>
        );
      })}
    </svg>
  );
}

/* ── SVG Donut Ring ───────────────────────────────────────────────── */

function DonutRing({
  value,
  label,
  size = 140,
  color = "var(--accent)",
}: {
  value: number;
  label: string;
  size?: number;
  color?: string;
}) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(value, 100) / 100) * circumference;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {/* Background ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth="10"
        />
        {/* Value ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)" }}
        />
      </svg>
      {/* Center text */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 28,
            fontWeight: 700,
            color,
            letterSpacing: "-1px",
            lineHeight: 1,
          }}
        >
          {fmtPercent(value, 0)}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            marginTop: 4,
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

/* ── Delta Badge ──────────────────────────────────────────────────── */

function DeltaBadge({ current, previous, invert }: { current: number; previous: number; invert?: boolean }) {
  const d = delta(current, previous);
  const isGood = invert ? !d.up : d.up;
  const color = d.flat ? "var(--text-muted)" : isGood ? "var(--success)" : "var(--danger)";
  const bg = d.flat
    ? "rgba(255,255,255,0.04)"
    : isGood
      ? "rgba(126,201,160,0.1)"
      : "rgba(217,142,142,0.1)";
  const Icon = d.flat ? Minus : d.up ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "3px 8px",
        borderRadius: 6,
        fontSize: 11,
        fontWeight: 600,
        color,
        background: bg,
      }}
    >
      <Icon size={12} />
      {d.pct}
    </span>
  );
}

/* ── Horizontal Bar ───────────────────────────────────────────────── */

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

/* ── Component ────────────────────────────────────────────────────── */

export default function AlexTesting({ filters }: AlexTestingProps) {
  const { dateFrom, dateTo } = getEffectiveDates(filters);
  const prev = useMemo(() => getPrevPeriod(dateFrom, dateTo), [dateFrom, dateTo]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState<PeriodMetrics | null>(null);
  const [previous, setPrevious] = useState<PeriodMetrics | null>(null);

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
        <Loader2 size={24} className="spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  if (error || !current) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}>
        {error || "No data available"}
      </div>
    );
  }

  const prev2 = previous || current; // fallback

  // Closers sorted by cash
  const closerEntries = Object.entries(current.byCloser)
    .sort((a, b) => b[1].cash - a[1].cash);
  const maxCloserCash = closerEntries.length > 0 ? closerEntries[0][1].cash : 1;

  // Rate color
  const rc = (rate: number) =>
    rate >= 70 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)";

  return (
    <div>
      {/* ═══════════════════════════════════════════════════════════════
          ROW 1: Hero KPIs (left) + Sparkline Chart (right)
          ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.6fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        {/* LEFT — Stacked KPI cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Cash Collected */}
          <div
            className="glass-static"
            style={{ padding: "22px 24px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(126,201,160,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Banknote size={16} style={{ color: "var(--success)" }} />
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Cash Collected
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: "var(--success)",
                  letterSpacing: "-1.5px",
                  lineHeight: 1,
                }}
              >
                {fmtDollars(current.cashCollected)}
              </span>
              <DeltaBadge current={current.cashCollected} previous={prev2.cashCollected} />
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 8,
              }}
            >
              vs {fmtDollars(prev2.cashCollected)} last period
            </div>
          </div>

          {/* Total Revenue */}
          <div
            className="glass-static"
            style={{ padding: "22px 24px", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 10,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(201,169,110,0.1)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <DollarSign size={16} style={{ color: "var(--accent)" }} />
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Total Revenue
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
              <span
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: "var(--accent)",
                  letterSpacing: "-1.5px",
                  lineHeight: 1,
                }}
              >
                {fmtDollars(current.revenue)}
              </span>
              <DeltaBadge current={current.revenue} previous={prev2.revenue} />
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 8,
              }}
            >
              vs {fmtDollars(prev2.revenue)} last period
            </div>
          </div>
        </div>

        {/* RIGHT — Sparkline area chart */}
        <div
          className="glass-static"
          style={{
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 16,
            }}
          >
            <span
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              Cash Trend
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 11 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 16,
                    height: 2,
                    background: "var(--accent)",
                    borderRadius: 1,
                    display: "inline-block",
                  }}
                />
                <span style={{ color: "var(--text-muted)" }}>Current</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 16,
                    height: 2,
                    background: "var(--text-muted)",
                    borderRadius: 1,
                    display: "inline-block",
                    opacity: 0.4,
                  }}
                />
                <span style={{ color: "var(--text-muted)" }}>Last Period</span>
              </span>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 160 }}>
            <SparkArea
              current={current.dailyCash}
              previous={prev2.dailyCash}
              height={160}
            />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROW 2: Donut (left) + Client Breakdown (center) + Closers (right)
          ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1.2fr 1fr",
          gap: 16,
        }}
      >
        {/* LEFT — Close Rate Donut */}
        <div
          className="glass-static"
          style={{
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 20,
              alignSelf: "flex-start",
            }}
          >
            Close Rate
          </div>

          <DonutRing
            value={current.closeRate}
            label="Close Rate"
            color={rc(current.closeRate)}
            size={140}
          />

          <div style={{ marginTop: 20, width: "100%" }}>
            {/* Current cash */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderTop: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>This period</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--success)" }}>
                {fmtDollars(current.cashCollected)}
              </span>
            </div>
            {/* Previous cash */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 0",
                borderTop: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Last period</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>
                {fmtDollars(prev2.cashCollected)}
              </span>
            </div>
          </div>
        </div>

        {/* CENTER — Client Breakdown */}
        <div className="glass-static" style={{ padding: "24px" }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 20,
            }}
          >
            Per-Client Performance
          </div>

          {Object.entries(current.byClient).map(([name, c]) => {
            const prevClient = prev2.byClient[name];
            const clientColor = name === "Tyson" ? "var(--tyson)" : "var(--keith)";
            const clientBg = name === "Tyson" ? "rgba(130,197,197,0.08)" : "rgba(184,164,217,0.08)";

            return (
              <div
                key={name}
                style={{
                  padding: "14px 16px",
                  borderRadius: 10,
                  background: clientBg,
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: clientColor,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 700,
                        color: "var(--text-primary)",
                      }}
                    >
                      {name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--success)",
                    }}
                  >
                    {fmtDollars(c.cashCollected)}
                  </span>
                </div>

                {/* Close Rate bar */}
                <div style={{ marginBottom: 8 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>Close Rate</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: rc(c.closeRate), fontWeight: 600 }}>
                        {fmtPercent(c.closeRate, 0)}
                      </span>
                      {prevClient && (
                        <DeltaBadge current={c.closeRate} previous={prevClient.closeRate} />
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: "rgba(255,255,255,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(c.closeRate, 100)}%`,
                        borderRadius: 3,
                        background: clientColor,
                        transition: "width 0.8s ease",
                      }}
                    />
                  </div>
                </div>

                {/* Show Rate bar */}
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ color: "var(--text-muted)" }}>Show Rate</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ color: rc(c.showRate), fontWeight: 600 }}>
                        {fmtPercent(c.showRate, 0)}
                      </span>
                      {prevClient && (
                        <DeltaBadge current={c.showRate} previous={prevClient.showRate} />
                      )}
                    </div>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 3,
                      background: "rgba(255,255,255,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${Math.min(c.showRate, 100)}%`,
                        borderRadius: 3,
                        background: clientColor,
                        opacity: 0.6,
                        transition: "width 0.8s ease",
                      }}
                    />
                  </div>
                </div>

                {/* Mini stat row */}
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginTop: 10,
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  <span>
                    <strong style={{ color: "var(--success)" }}>{c.wins}</strong> W
                  </span>
                  <span>
                    <strong style={{ color: "var(--danger)" }}>{c.losses}</strong> L
                  </span>
                  <span>
                    {c.callsTaken}/{c.callsBooked} calls
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* RIGHT — Closer Leaderboard */}
        <div className="glass-static" style={{ padding: "24px" }}>
          <div
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              marginBottom: 20,
            }}
          >
            Closer Leaderboard
          </div>

          {closerEntries.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>
              No closer data
            </div>
          ) : (
            closerEntries.map(([name, stats], i) => {
              const prevCloser = prev2.byCloser[name];
              return (
                <div key={name} style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {/* Rank badge */}
                      <span
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          background:
                            i === 0
                              ? "rgba(201,169,110,0.2)"
                              : i === 1
                                ? "rgba(192,192,192,0.15)"
                                : "rgba(205,127,50,0.12)",
                          color:
                            i === 0
                              ? "var(--accent)"
                              : i === 1
                                ? "#c0c0c0"
                                : "#cd7f32",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
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
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--success)",
                        }}
                      >
                        {fmtDollars(stats.cash)}
                      </span>
                      {prevCloser && (
                        <DeltaBadge current={stats.cash} previous={prevCloser.cash} />
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
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                  >
                    {stats.wins} wins · {stats.calls} calls
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
          { icon: <Target size={14} />, label: "AOV", value: fmtDollars(current.aov), prev: prev2.aov, cur: current.aov },
          { icon: <PhoneCall size={14} />, label: "Show Rate", value: fmtPercent(current.showRate, 0), prev: prev2.showRate, cur: current.showRate },
          { icon: <Trophy size={14} />, label: "Wins", value: fmtNumber(current.wins), prev: prev2.wins, cur: current.wins },
          { icon: <Users size={14} />, label: "Calls Booked", value: fmtNumber(current.callsBooked), prev: prev2.callsBooked, cur: current.callsBooked },
          { icon: <TrendingUp size={14} />, label: "Pending", value: fmtNumber(current.pcfus), prev: prev2.pcfus, cur: current.pcfus },
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
          </div>
        ))}
      </div>
    </div>
  );
}
