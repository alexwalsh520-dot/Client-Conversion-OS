"use client";

// "By lead type (attributed)" — the one section only the metrics engine can
// power: sheet rows carry no lead type, so these numbers come from
// GET /api/metrics-engine/summary (by_lead_type / total cells, activity view).
// Rendered in the Sales-Hub card language (glass-static / metric-card) so it
// sits naturally under the sheet-based Client Dashboard, but labeled as
// engine-attributed because its attribution differs from the sheet's.
//
// Calls taken / wins / losses / upcoming come from the engine's sheet-vocabulary
// count metrics (calls_taken, wins, losses, upcoming_calls) — server-computed,
// never derived client-side.

import { useCallback, useEffect, useState } from "react";
import {
  Banknote,
  BarChart3,
  CalendarClock,
  Loader2,
  Phone,
  PhoneCall,
  SlidersHorizontal,
  Trophy,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import type {
  LeadType,
  MetricBlock,
  MetricCell,
  MetricsSummary,
} from "@/lib/metrics-engine/types";

/* ── Types ────────────────────────────────────────────────────────── */

interface LeadTypeBreakdownProps {
  /** ET calendar-day window, YYYY-MM-DD (same effective dates as the sheet filter). */
  dateFrom: string;
  dateTo: string;
  /** "all" or a client key ("tyson", "jake"). */
  client: string;
}

type LeadTypeChoice = "all" | LeadType;

const LEAD_TYPE_OPTIONS: Array<{ key: LeadTypeChoice; label: string }> = [
  { key: "all", label: "All" },
  { key: "ad", label: "Ad" },
  { key: "organic", label: "Organic" },
  { key: "follower", label: "Follower" },
  { key: "misc", label: "Misc" },
];

/* ── Cell helpers ─────────────────────────────────────────────────── */

function blockByKey(data: MetricsSummary | null, key: string): MetricBlock | null {
  return data?.metrics.find((m) => m.key === key) ?? null;
}

/** The activity-view value for the chosen lead type (total when "all"). */
function activityFor(block: MetricBlock | null, type: LeadTypeChoice): number | null {
  if (!block || !block.defined) return null;
  const cell: MetricCell | null | undefined =
    type === "all" ? block.total : block.by_lead_type?.[type];
  const v = cell?.activity;
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
}

const fmtCents = (v: number | null) => (v === null ? "—" : fmtDollars(v / 100));
const fmtRatio = (v: number | null) => (v === null ? "—" : fmtPercent(v * 100));
const fmtCount = (v: number | null) => (v === null ? "—" : fmtNumber(v));

/* ── Card (same markup as Sales Hub's SummaryStat) ────────────────── */

function StatCard({
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
  const isDash = value === "—";
  return (
    <div className="glass-static metric-card">
      <div
        className="metric-card-label"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {icon}
        {label}
      </div>
      <div
        className="metric-card-value"
        style={isDash ? { color: "var(--text-muted)" } : color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────────── */

export default function LeadTypeBreakdown({ dateFrom, dateTo, client }: LeadTypeBreakdownProps) {
  const [leadType, setLeadType] = useState<LeadTypeChoice>("all");
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from: dateFrom, to: dateTo });
      if (client !== "all") params.set("client", client);
      const res = await fetch(`/api/metrics-engine/summary?${params.toString()}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Failed to load lead-type metrics");
      setData(body as MetricsSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, client]);

  useEffect(() => {
    void load();
  }, [load]);

  const cash = activityFor(blockByKey(data, "cash_collected"), leadType);
  const aov = activityFor(blockByKey(data, "aov"), leadType);
  const closeRate = activityFor(blockByKey(data, "close_rate"), leadType);
  const showRate = activityFor(blockByKey(data, "show_rate"), leadType);
  const callsBooked = activityFor(blockByKey(data, "calls_booked"), leadType);
  const callsTaken = activityFor(blockByKey(data, "calls_taken"), leadType);
  const wins = activityFor(blockByKey(data, "wins"), leadType);
  const losses = activityFor(blockByKey(data, "losses"), leadType);
  const upcomingCalls = activityFor(blockByKey(data, "upcoming_calls"), leadType);

  return (
    <div className="section">
      <h2 className="section-title">
        <SlidersHorizontal size={16} />
        By Lead Type (attributed)
      </h2>

      {/* Dropdown — same form-input styling as the Sales Hub filter bar */}
      <div
        className="glass-static"
        style={{
          padding: "12px 16px",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>
          Break down by lead type
        </span>
        <select
          className="form-input"
          value={leadType}
          onChange={(e) => setLeadType(e.target.value as LeadTypeChoice)}
          style={{ width: "auto", minWidth: 140, padding: "8px 12px" }}
        >
          {LEAD_TYPE_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Metrics-engine attribution &middot; may differ from the sheet-based sections
        </span>
      </div>

      {loading && !data ? (
        <div
          className="glass-static"
          style={{ padding: 32, display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <Loader2 size={18} className="spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : error && !data ? (
        <div
          className="glass-static"
          style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}
        >
          Failed to load lead-type metrics: {error}
        </div>
      ) : (
        <>
          <div className="metric-grid metric-grid-4" style={{ marginBottom: 12 }}>
            <StatCard
              icon={<Banknote size={12} style={{ color: "var(--success)" }} />}
              label="Cash Collected"
              value={fmtCents(cash)}
              color="var(--success)"
            />
            <StatCard
              icon={<BarChart3 size={12} style={{ color: "var(--success)" }} />}
              label="AOV"
              value={fmtCents(aov)}
              color="var(--success)"
            />
            <StatCard
              icon={<TrendingUp size={12} style={{ color: "var(--accent)" }} />}
              label="Close Rate"
              value={fmtRatio(closeRate)}
            />
            <StatCard
              icon={<TrendingUp size={12} style={{ color: "var(--accent)" }} />}
              label="Show Rate"
              value={fmtRatio(showRate)}
            />
          </div>
          <div className="metric-grid metric-grid-4" style={{ marginBottom: 12 }}>
            <StatCard
              icon={<Phone size={12} style={{ color: "var(--accent)" }} />}
              label="Calls Booked"
              value={fmtCount(callsBooked)}
            />
            <StatCard
              icon={<PhoneCall size={12} style={{ color: "var(--accent)" }} />}
              label="Calls Taken"
              value={fmtCount(callsTaken)}
            />
            <StatCard
              icon={<Trophy size={12} style={{ color: "var(--success)" }} />}
              label="Wins"
              value={fmtCount(wins)}
              color="var(--success)"
            />
            <StatCard
              icon={<XCircle size={12} style={{ color: "var(--danger)" }} />}
              label="Losses"
              value={fmtCount(losses)}
            />
          </div>
          <div className="metric-grid metric-grid-4" style={{ marginBottom: 10 }}>
            <StatCard
              icon={<CalendarClock size={12} style={{ color: "var(--accent)" }} />}
              label="Upcoming Calls"
              value={fmtCount(upcomingCalls)}
            />
          </div>
        </>
      )}
    </div>
  );
}
