"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  RefreshCw,
  ChevronRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Loader2,
  BarChart3,
} from "lucide-react";

/* ──────────────────────── TYPES ──────────────────────── */

type Level = "campaign" | "adset" | "ad";
type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_14d"
  | "last_30d"
  | "this_month";

interface MetaRow {
  id: string;
  name: string;
  date: string;
  spend: number;
  impressions: number;
  cpm: number;
  clicks: number;
  ctr: number;
  cpc: number;
  messages: number;
  cost_per_message: number;
  calls_booked_60: number;
  cost_per_60_booked: number;
  calls_taken_60: number;
  sup_rate_60: number;
  cost_per_60_taken: number;
  new_clients: number;
  call_closing_rate: number;
  msg_conversion_rate: number;
  contracted_revenue: number;
  collected_revenue: number;
  cost_per_client: number;
  contracted_roi: number;
  collected_roi: number;
}

interface Totals {
  spend: number;
  impressions: number;
  cpm: number;
  clicks: number;
  ctr: number;
  cpc: number;
  messages: number;
  cost_per_message: number;
  calls_booked_60: number;
  cost_per_60_booked: number;
  calls_taken_60: number;
  sup_rate_60: number;
  cost_per_60_taken: number;
  new_clients: number;
  call_closing_rate: number;
  msg_conversion_rate: number;
  contracted_revenue: number;
  collected_revenue: number;
  cost_per_client: number;
  contracted_roi: number;
  collected_roi: number;
}

interface Targets {
  ctr_min: number;
  cost_per_message_max: number;
  cost_per_60_booked_max: number;
  sup_rate_60_min: number;
  cost_per_60_taken_max: number;
  call_closing_rate_min: number;
  cost_per_client_max: number;
  contracted_roi_min: number;
}

interface SalesCall {
  call_number: string;
  date: string;
  name: string;
  call_taken: boolean;
  call_length: number;
  outcome: string;
  closer: string;
  revenue: number;
  cash_collected: number;
  setter: string;
  notes: string;
  recording_link: string;
  offer: string;
}

interface ApiResponse {
  level: Level;
  date_preset: DatePreset;
  date_range: { since: string; until: string };
  rows: MetaRow[];
  totals: Totals;
  targets: Targets;
  salesCalls: SalesCall[];
}

interface BreadcrumbItem {
  level: Level;
  id: string | null;
  name: string;
}

interface AggregatedRow {
  id: string;
  name: string;
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  messages: number;
  calls_booked_60: number;
  calls_taken_60: number;
  new_clients: number;
  contracted_revenue: number;
  collected_revenue: number;
  // Computed
  cpm: number;
  ctr: number;
  cpc: number;
  cost_per_message: number;
  cost_per_60_booked: number;
  cost_per_client: number;
  roas: number;
  collected_roas: number;
}

/* ──────────────────────── CONSTANTS ──────────────────────── */

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "last_7d", label: "Last 7 Days" },
  { value: "last_14d", label: "Last 14 Days" },
  { value: "last_30d", label: "Last 30 Days" },
  { value: "this_month", label: "This Month" },
];

const OUTCOME_COLORS: Record<string, string> = {
  WIN: "#7ec9a0",
  WON: "#7ec9a0",
  LOST: "#d98e8e",
  PCFU: "#e2c87a",
  "NS/RS": "#71717a",
  "NO SHOW": "#71717a",
  RESCHEDULED: "#71717a",
};

/* ──────────────────────── FORMAT HELPERS ──────────────────────── */

function fmtMoney(n: number): string {
  if (n === 0) return "$0.00";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtMoneyShort(n: number): string {
  if (n >= 1_000_000) return "$" + (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return "$" + (n / 1_000).toFixed(1) + "k";
  return fmtMoney(n);
}

function fmtPct(n: number): string {
  return n.toFixed(2) + "%";
}

function fmtNum(n: number): string {
  return n.toLocaleString("en-US");
}

function fmtRoas(n: number): string {
  if (!isFinite(n) || isNaN(n)) return "—";
  return n.toFixed(1) + "x";
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || !isFinite(denominator)) return 0;
  return numerator / denominator;
}

/* ──────────────────────── AGGREGATION ──────────────────────── */

function aggregateRows(rows: MetaRow[]): AggregatedRow[] {
  const grouped = new Map<string, MetaRow[]>();
  for (const row of rows) {
    const key = row.id;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(row);
  }

  const result: AggregatedRow[] = [];
  for (const [id, group] of grouped) {
    const spend = group.reduce((s, r) => s + r.spend, 0);
    const impressions = group.reduce((s, r) => s + r.impressions, 0);
    const clicks = group.reduce((s, r) => s + r.clicks, 0);
    const messages = group.reduce((s, r) => s + r.messages, 0);
    const calls_booked_60 = group.reduce((s, r) => s + r.calls_booked_60, 0);
    const calls_taken_60 = group.reduce((s, r) => s + r.calls_taken_60, 0);
    const new_clients = group.reduce((s, r) => s + r.new_clients, 0);
    const contracted_revenue = group.reduce((s, r) => s + r.contracted_revenue, 0);
    const collected_revenue = group.reduce((s, r) => s + r.collected_revenue, 0);

    result.push({
      id,
      name: group[0].name,
      date: "",
      spend,
      impressions,
      clicks,
      messages,
      calls_booked_60,
      calls_taken_60,
      new_clients,
      contracted_revenue,
      collected_revenue,
      cpm: safeDivide(spend, impressions) * 1000,
      ctr: safeDivide(clicks, impressions) * 100,
      cpc: safeDivide(spend, clicks),
      cost_per_message: safeDivide(spend, messages),
      cost_per_60_booked: safeDivide(spend, calls_booked_60),
      cost_per_client: safeDivide(spend, new_clients),
      roas: safeDivide(contracted_revenue, spend),
      collected_roas: safeDivide(collected_revenue, spend),
    });
  }

  return result.sort((a, b) => b.spend - a.spend);
}

function toDailyRows(rows: MetaRow[]): AggregatedRow[] {
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      date: r.date,
      spend: r.spend,
      impressions: r.impressions,
      clicks: r.clicks,
      messages: r.messages,
      calls_booked_60: r.calls_booked_60,
      calls_taken_60: r.calls_taken_60,
      new_clients: r.new_clients,
      contracted_revenue: r.contracted_revenue,
      collected_revenue: r.collected_revenue,
      cpm: safeDivide(r.spend, r.impressions) * 1000,
      ctr: safeDivide(r.clicks, r.impressions) * 100,
      cpc: safeDivide(r.spend, r.clicks),
      cost_per_message: safeDivide(r.spend, r.messages),
      cost_per_60_booked: safeDivide(r.spend, r.calls_booked_60),
      cost_per_client: safeDivide(r.spend, r.new_clients),
      roas: safeDivide(r.contracted_revenue, r.spend),
      collected_roas: safeDivide(r.collected_revenue, r.spend),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeTotalsRow(totals: Totals): AggregatedRow {
  return {
    id: "__totals__",
    name: "Total",
    date: "",
    spend: totals.spend,
    impressions: totals.impressions,
    clicks: totals.clicks,
    messages: totals.messages,
    calls_booked_60: totals.calls_booked_60,
    calls_taken_60: totals.calls_taken_60,
    new_clients: totals.new_clients,
    contracted_revenue: totals.contracted_revenue,
    collected_revenue: totals.collected_revenue,
    cpm: safeDivide(totals.spend, totals.impressions) * 1000,
    ctr: safeDivide(totals.clicks, totals.impressions) * 100,
    cpc: safeDivide(totals.spend, totals.clicks),
    cost_per_message: safeDivide(totals.spend, totals.messages),
    cost_per_60_booked: safeDivide(totals.spend, totals.calls_booked_60),
    cost_per_client: safeDivide(totals.spend, totals.new_clients),
    roas: safeDivide(totals.contracted_revenue, totals.spend),
    collected_roas: safeDivide(totals.collected_revenue, totals.spend),
  };
}

/* ──────────────────────── COLOR LOGIC ──────────────────────── */

function getMetricColor(
  field: string,
  value: number,
  targets: Targets | null
): string | undefined {
  if (!targets || value === 0) return undefined;
  switch (field) {
    case "ctr":
      return value >= targets.ctr_min ? "#7ec9a0" : "#d98e8e";
    case "cost_per_message":
      return value <= targets.cost_per_message_max ? "#7ec9a0" : "#d98e8e";
    case "cost_per_60_booked":
      return value <= targets.cost_per_60_booked_max ? "#7ec9a0" : "#d98e8e";
    case "cost_per_client":
      return value <= targets.cost_per_client_max ? "#7ec9a0" : "#d98e8e";
    case "roas":
    case "collected_roas":
      return value * 100 >= targets.contracted_roi_min ? "#7ec9a0" : "#d98e8e";
    default:
      return undefined;
  }
}

/* ──────────────────────── COLUMN DEFS ──────────────────────── */

interface ColumnDef {
  key: string;
  label: string;
  format: (v: number) => string;
  align: "left" | "right";
  colorField?: string;
  minWidth: number;
}

const COLUMNS: ColumnDef[] = [
  { key: "spend", label: "Spend", format: fmtMoney, align: "right", minWidth: 100 },
  { key: "impressions", label: "Impr.", format: fmtNum, align: "right", minWidth: 90 },
  { key: "cpm", label: "CPM", format: fmtMoney, align: "right", minWidth: 80 },
  { key: "clicks", label: "Clicks", format: fmtNum, align: "right", minWidth: 80 },
  { key: "ctr", label: "CTR", format: fmtPct, align: "right", colorField: "ctr", minWidth: 70 },
  { key: "cpc", label: "CPC", format: fmtMoney, align: "right", minWidth: 80 },
  { key: "messages", label: "Msgs", format: fmtNum, align: "right", minWidth: 70 },
  {
    key: "cost_per_message",
    label: "Cost/Msg",
    format: fmtMoney,
    align: "right",
    colorField: "cost_per_message",
    minWidth: 100,
  },
  { key: "calls_booked_60", label: "60m Booked", format: fmtNum, align: "right", minWidth: 100 },
  {
    key: "cost_per_60_booked",
    label: "Cost/60 Bkd",
    format: fmtMoney,
    align: "right",
    colorField: "cost_per_60_booked",
    minWidth: 110,
  },
  { key: "new_clients", label: "Clients", format: fmtNum, align: "right", minWidth: 80 },
  {
    key: "cost_per_client",
    label: "Cost/Client",
    format: fmtMoney,
    align: "right",
    colorField: "cost_per_client",
    minWidth: 110,
  },
  {
    key: "contracted_revenue",
    label: "Contracted Rev",
    format: fmtMoney,
    align: "right",
    minWidth: 130,
  },
  {
    key: "roas",
    label: "ROAS",
    format: fmtRoas,
    align: "right",
    colorField: "roas",
    minWidth: 80,
  },
  {
    key: "collected_revenue",
    label: "Collected Rev",
    format: fmtMoney,
    align: "right",
    minWidth: 130,
  },
  {
    key: "collected_roas",
    label: "Coll. ROAS",
    format: fmtRoas,
    align: "right",
    colorField: "collected_roas",
    minWidth: 100,
  },
];

/* ──────────────────────── KPI CARDS ──────────────────────── */

interface KpiCardProps {
  label: string;
  value: string;
  subValue?: string;
}

function KpiCard({ label, value, subValue }: KpiCardProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-white/5 bg-[#0f0f12]/80 backdrop-blur px-5 py-4 min-w-[140px]">
      <span className="text-xs font-medium tracking-wide uppercase" style={{ color: "#a1a1aa" }}>
        {label}
      </span>
      <span className="text-xl font-semibold text-white">{value}</span>
      {subValue && (
        <span className="text-xs" style={{ color: "#a1a1aa" }}>
          {subValue}
        </span>
      )}
    </div>
  );
}

/* ──────────────────────── SALES CALL ROW ──────────────────────── */

function SalesCallRow({ call }: { call: SalesCall }) {
  const outcomeColor = OUTCOME_COLORS[call.outcome?.toUpperCase()] ?? "#a1a1aa";

  return (
    <tr className="border-t border-white/5">
      <td
        className="sticky left-0 z-10 bg-[#131318] px-4 py-2.5 text-sm text-white pl-10"
        colSpan={1}
      >
        {call.name || "—"}
      </td>
      <td className="px-4 py-2.5 text-sm" colSpan={2}>
        <span
          className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: outcomeColor + "22", color: outcomeColor }}
        >
          {call.outcome || "—"}
        </span>
      </td>
      <td className="px-4 py-2.5 text-sm text-white" colSpan={2}>
        {call.closer || "—"}
      </td>
      <td className="px-4 py-2.5 text-sm text-white" colSpan={2}>
        {call.revenue ? fmtMoney(call.revenue) : "—"}
      </td>
      <td className="px-4 py-2.5 text-sm" colSpan={COLUMNS.length - 5}>
        {call.recording_link ? (
          <a
            href={call.recording_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[#c9a96e] hover:underline"
          >
            Recording <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span style={{ color: "#71717a" }}>No recording</span>
        )}
      </td>
    </tr>
  );
}

/* ──────────────────────── LOADING SKELETON ──────────────────────── */

function TableSkeleton() {
  return (
    <div className="space-y-2 p-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex gap-3">
          <div
            className="h-10 rounded-lg animate-pulse"
            style={{
              backgroundColor: "#1a1a20",
              width: i === 0 ? "100%" : `${100 - i * 8}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────── MAIN PAGE ──────────────────────── */

export default function MediaBuyerPage() {
  // Drill-down state
  const [level, setLevel] = useState<Level>("campaign");
  const [datePreset, setDatePreset] = useState<DatePreset>("this_month");
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [adsetId, setAdsetId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    { level: "campaign", id: null, name: "All Campaigns" },
  ]);

  // Data state
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Sort state
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    setExpandedRows(new Set());

    const params = new URLSearchParams();
    params.set("level", level);
    params.set("date_preset", datePreset);
    if (campaignId) params.set("campaign_id", campaignId);
    if (adsetId) params.set("adset_id", adsetId);

    try {
      const res = await fetch(`/api/media-buyer/data?${params.toString()}`);
      if (!res.ok) throw new Error(`API error: ${res.status}`);
      const json: ApiResponse = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [level, datePreset, campaignId, adsetId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Drill into a row
  const handleRowClick = useCallback(
    (row: AggregatedRow) => {
      if (level === "campaign") {
        setCampaignId(row.id);
        setLevel("adset");
        setBreadcrumbs((prev) => [...prev, { level: "adset", id: row.id, name: row.name }]);
      } else if (level === "adset") {
        setAdsetId(row.id);
        setLevel("ad");
        setBreadcrumbs((prev) => [...prev, { level: "ad", id: row.id, name: row.name }]);
      }
      // At ad level, clicking toggles daily expansion (handled separately)
    },
    [level]
  );

  // Breadcrumb navigation
  const handleBreadcrumbClick = useCallback((index: number) => {
    setBreadcrumbs((prev) => {
      const newCrumbs = prev.slice(0, index + 1);
      const target = newCrumbs[newCrumbs.length - 1];

      if (target.level === "campaign") {
        setCampaignId(null);
        setAdsetId(null);
        setLevel("campaign");
      } else if (target.level === "adset") {
        setAdsetId(null);
        setLevel("adset");
      }

      return newCrumbs;
    });
  }, []);

  // Toggle daily row expansion
  const toggleExpand = useCallback((rowKey: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);

  // Sort handler
  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "desc" ? "asc" : "desc"));
        return key;
      }
      setSortDir("desc");
      return key;
    });
  }, []);

  // Process rows
  const displayRows = useMemo((): AggregatedRow[] => {
    let rows: AggregatedRow[];
    if (!data?.rows?.length) return [];
    if (level === "ad") rows = toDailyRows(data.rows);
    else rows = aggregateRows(data.rows);

    // Apply sort
    if (sortKey) {
      rows = [...rows].sort((a, b) => {
        if (sortKey === "name") {
          const aName = a.name || a.date || "";
          const bName = b.name || b.date || "";
          return sortDir === "desc" ? bName.localeCompare(aName) : aName.localeCompare(bName);
        }
        const aVal = (a as unknown as Record<string, number>)[sortKey] ?? 0;
        const bVal = (b as unknown as Record<string, number>)[sortKey] ?? 0;
        return sortDir === "desc" ? bVal - aVal : aVal - bVal;
      });
    }
    return rows;
  }, [data, level, sortKey, sortDir]);

  const totalsRow = useMemo((): AggregatedRow | null => {
    if (!data?.totals) return null;
    return computeTotalsRow(data.totals);
  }, [data]);

  // Filter sales calls by date
  const getCallsForDate = useCallback(
    (date: string): SalesCall[] => {
      if (!data?.salesCalls?.length) return [];
      // Normalize dates for comparison: API date could be "2026-03-01" or "3/1/2026"
      return data.salesCalls.filter((c) => {
        const callDate = new Date(c.date);
        const rowDate = new Date(date);
        return (
          callDate.getFullYear() === rowDate.getFullYear() &&
          callDate.getMonth() === rowDate.getMonth() &&
          callDate.getDate() === rowDate.getDate()
        );
      });
    },
    [data]
  );

  // KPI summary values
  const kpis = useMemo(() => {
    if (!data?.totals) return null;
    const t = data.totals;
    return {
      spend: fmtMoneyShort(t.spend),
      messages: fmtNum(t.messages),
      costPerMsg: fmtMoney(t.cost_per_message),
      calls60: fmtNum(t.calls_booked_60),
      clients: fmtNum(t.new_clients),
      revenue: fmtMoneyShort(t.contracted_revenue),
      roi: fmtPct(t.contracted_roi),
    };
  }, [data]);

  return (
    <div className="flex flex-col h-full min-h-screen" style={{ backgroundColor: "#09090b" }}>
      {/* ── Sticky Header Section ── */}
      <div className="sticky top-0 z-30" style={{ backgroundColor: "#09090b" }}>

      {/* ── Header Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-6 h-6" style={{ color: "#c9a96e" }} />
          <h1 className="text-2xl font-bold text-white tracking-tight">Media Buyer</h1>
        </div>

        <div className="flex items-center gap-3">
          {/* Date preset selector */}
          <div className="flex rounded-lg border border-white/10 overflow-hidden">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setDatePreset(p.value)}
                className="px-3 py-1.5 text-xs font-medium transition-colors"
                style={{
                  backgroundColor: datePreset === p.value ? "#c9a96e" : "transparent",
                  color: datePreset === p.value ? "#09090b" : "#a1a1aa",
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium transition-colors hover:border-white/20 disabled:opacity-50"
            style={{ color: "#a1a1aa" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Date Range Subtitle ── */}
      {data?.date_range && (
        <div className="px-6 pt-3">
          <span className="text-xs" style={{ color: "#71717a" }}>
            {data.date_range.since} — {data.date_range.until}
          </span>
        </div>
      )}

      {/* ── KPI Strip ── */}
      {kpis && (
        <div className="flex gap-3 px-6 py-4 overflow-x-auto scrollbar-hide">
          <KpiCard label="Spend" value={kpis.spend} />
          <KpiCard label="Messages" value={kpis.messages} />
          <KpiCard label="Cost / Msg" value={kpis.costPerMsg} />
          <KpiCard label="60-Min Calls" value={kpis.calls60} />
          <KpiCard label="New Clients" value={kpis.clients} />
          <KpiCard label="Revenue" value={kpis.revenue} />
          <KpiCard label="ROI" value={kpis.roi} />
        </div>
      )}

      {/* ── Ads Manager Tab Bar (Facebook-style) ── */}
      <div className="border-b border-white/5">
        <div className="flex items-center">
          {/* Campaigns tab */}
          <button
            onClick={() => handleBreadcrumbClick(0)}
            className="relative flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all"
            style={{
              color: level === "campaign" ? "#fff" : "#71717a",
              backgroundColor: level === "campaign" ? "#1a1a2e" : "transparent",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h4v4H2V2zm0 6h4v4H2V8zm6-6h4v4H8V2zm6 0h2v4h-2V2zM8 8h4v4H8V8zm6 0h2v4h-2V8z" opacity="0.8"/></svg>
            Campaigns
            {level !== "campaign" && breadcrumbs.length > 1 && (
              <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ backgroundColor: "#c9a96e", color: "#09090b" }}>
                1 selected
              </span>
            )}
            {level === "campaign" && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: "#c9a96e" }} />
            )}
          </button>

          {/* Divider */}
          <div className="w-px h-6" style={{ backgroundColor: "#27272a" }} />

          {/* Ad Sets tab */}
          <button
            onClick={() => breadcrumbs.length > 1 ? handleBreadcrumbClick(1) : undefined}
            className="relative flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all"
            style={{
              color: level === "adset" ? "#fff" : breadcrumbs.length > 1 ? "#a1a1aa" : "#3f3f46",
              backgroundColor: level === "adset" ? "#1a1a2e" : "transparent",
              cursor: breadcrumbs.length > 1 ? "pointer" : "default",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14v2H1V3zm2 4h10v2H3V7zm2 4h6v2H5v-2z" opacity="0.8"/></svg>
            Ad Sets
            {level === "ad" && breadcrumbs.length > 2 && (
              <span className="text-[10px] font-bold rounded px-1.5 py-0.5" style={{ backgroundColor: "#c9a96e", color: "#09090b" }}>
                1 selected
              </span>
            )}
            {level === "adset" && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: "#c9a96e" }} />
            )}
          </button>

          {/* Divider */}
          <div className="w-px h-6" style={{ backgroundColor: "#27272a" }} />

          {/* Ads tab */}
          <button
            onClick={() => breadcrumbs.length > 2 ? undefined : undefined}
            className="relative flex items-center gap-2 px-5 py-3 text-sm font-semibold transition-all"
            style={{
              color: level === "ad" ? "#fff" : breadcrumbs.length > 2 ? "#a1a1aa" : "#3f3f46",
              backgroundColor: level === "ad" ? "#1a1a2e" : "transparent",
              cursor: breadcrumbs.length > 2 ? "pointer" : "default",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1h12a1 1 0 011 1v12a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1zm1 2v10h10V3H3z" opacity="0.8"/></svg>
            Ads
            {level === "ad" && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px]" style={{ backgroundColor: "#c9a96e" }} />
            )}
          </button>

          {/* Spacer + selected context */}
          <div className="flex-1" />
          {breadcrumbs.length > 1 && (
            <div className="flex items-center gap-2 pr-6">
              {breadcrumbs.slice(1).map((crumb, i) => (
                <button
                  key={i}
                  onClick={() => handleBreadcrumbClick(i + 1)}
                  className="text-xs px-2 py-1 rounded border transition-colors hover:border-[#c9a96e]/40"
                  style={{ borderColor: "#27272a", color: "#a1a1aa" }}
                >
                  {crumb.name?.substring(0, 25)}{crumb.name && crumb.name.length > 25 ? "..." : ""} ✕
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      </div>{/* ── End Sticky Header ── */}

      {/* ── Error State ── */}
      {error && (
        <div className="mx-6 my-4 rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4">
          <p className="text-sm" style={{ color: "#d98e8e" }}>
            {error}
          </p>
          <button
            onClick={fetchData}
            className="mt-2 text-xs font-medium underline"
            style={{ color: "#c9a96e" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && <TableSkeleton />}

      {/* ── Empty State ── */}
      {!loading && !error && displayRows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20">
          <BarChart3 className="w-12 h-12 mb-4" style={{ color: "#27272a" }} />
          <p className="text-sm font-medium" style={{ color: "#52525b" }}>
            No data for this time period
          </p>
          <p className="text-xs mt-1" style={{ color: "#3f3f46" }}>
            Try selecting a different date range
          </p>
        </div>
      )}

      {/* ── Data Table ── */}
      {!loading && !error && displayRows.length > 0 && (
        <div className="flex-1 px-6 pb-6">
          <div className="rounded-xl border border-white/5 bg-[#0f0f12]/80 backdrop-blur overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse min-w-[1400px]">
                {/* Header */}
                <thead>
                  <tr className="border-b border-white/5">
                    {/* Delivery status column */}
                    {level !== "ad" && (
                      <th
                        className="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wider min-w-[90px]"
                        style={{ color: "#a1a1aa" }}
                      >
                        Delivery
                      </th>
                    )}
                    {/* Name column */}
                    <th
                      className="sticky left-0 z-20 bg-[#0f0f12] px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider min-w-[280px] cursor-pointer select-none hover:bg-white/[0.03] transition-colors"
                      style={{ color: sortKey === "name" ? "#c9a96e" : "#a1a1aa" }}
                      onClick={() => handleSort("name")}
                    >
                      <div className="flex items-center gap-1">
                        {level === "ad" ? "Date" : level === "campaign" ? "Campaign" : level === "adset" ? "Ad Set" : "Name"}
                        <span className="inline-flex flex-col leading-none" style={{ fontSize: "8px", lineHeight: "8px" }}>
                          <span style={{ color: sortKey === "name" && sortDir === "asc" ? "#c9a96e" : "#3f3f46" }}>▲</span>
                          <span style={{ color: sortKey === "name" && sortDir === "desc" ? "#c9a96e" : "#3f3f46" }}>▼</span>
                        </span>
                      </div>
                    </th>
                    {COLUMNS.map((col) => {
                      const isSorted = sortKey === col.key;
                      return (
                        <th
                          key={col.key}
                          className="px-4 py-3 text-xs font-semibold uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:bg-white/[0.03] transition-colors"
                          style={{
                            color: isSorted ? "#c9a96e" : "#a1a1aa",
                            textAlign: col.align,
                            minWidth: col.minWidth,
                          }}
                          onClick={() => handleSort(col.key)}
                        >
                          <div className="flex items-center gap-1" style={{ justifyContent: col.align === "right" ? "flex-end" : "flex-start" }}>
                            {col.label}
                            <span className="inline-flex flex-col leading-none" style={{ fontSize: "8px", lineHeight: "8px" }}>
                              <span style={{ color: isSorted && sortDir === "asc" ? "#c9a96e" : "#3f3f46" }}>▲</span>
                              <span style={{ color: isSorted && sortDir === "desc" ? "#c9a96e" : "#3f3f46" }}>▼</span>
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {displayRows.map((row, ri) => {
                    const rowKey = level === "ad" ? `${row.id}-${row.date}` : row.id;
                    const isExpanded = expandedRows.has(rowKey);
                    const isClickable = level !== "ad";
                    const isAdDaily = level === "ad";
                    const callsForDate = isAdDaily ? getCallsForDate(row.date) : [];
                    const hasCallsToShow = callsForDate.length > 0;

                    return (
                      <RowGroup key={rowKey}>
                        {/* Main Row */}
                        <tr
                          className={`border-t border-white/5 transition-colors ${
                            isClickable
                              ? "cursor-pointer hover:bg-white/[0.03]"
                              : hasCallsToShow
                              ? "cursor-pointer hover:bg-white/[0.03]"
                              : ""
                          }`}
                          onClick={() => {
                            if (isClickable) handleRowClick(row);
                            else if (hasCallsToShow) toggleExpand(rowKey);
                          }}
                        >
                          {/* Delivery status column */}
                          {!isAdDaily && (
                            <td className="px-3 py-3 text-xs min-w-[90px]">
                              <div className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
                                  backgroundColor: row.spend > 0 ? "#22c55e" : "#71717a",
                                }} />
                                <span style={{ color: row.spend > 0 ? "#7ec9a0" : "#71717a" }}>
                                  {row.spend > 0 ? "Active" : "Off"}
                                </span>
                              </div>
                            </td>
                          )}
                          {/* Name / Date column */}
                          <td className="sticky left-0 z-10 bg-[#0f0f12] px-4 py-3 text-sm min-w-[280px]">
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2">
                                {isAdDaily && hasCallsToShow && (
                                  <span className="text-[#52525b]">
                                    {isExpanded ? (
                                      <ChevronUp className="w-4 h-4" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4" />
                                    )}
                                  </span>
                                )}
                                <span className={`font-medium truncate max-w-[250px] ${isClickable ? "hover:underline" : ""}`} style={{ color: isClickable ? "#c9a96e" : "#e4e4e7" }}>
                                  {isAdDaily ? row.date : row.name}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Data columns */}
                          {COLUMNS.map((col) => {
                            const value = (row as unknown as Record<string, number>)[col.key];
                            const color = col.colorField
                              ? getMetricColor(col.colorField, value, data?.targets ?? null)
                              : undefined;

                            return (
                              <td
                                key={col.key}
                                className="px-4 py-3 text-sm whitespace-nowrap"
                                style={{
                                  textAlign: col.align,
                                  color: color ?? "#ffffff",
                                  minWidth: col.minWidth,
                                }}
                              >
                                {col.format(value)}
                              </td>
                            );
                          })}
                        </tr>

                        {/* Expanded Sales Calls */}
                        {isAdDaily && isExpanded && callsForDate.length > 0 && (
                          <>
                            <tr className="border-t border-white/5 bg-[#131318]">
                              <td
                                className="sticky left-0 z-10 bg-[#131318] px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                style={{ color: "#c9a96e" }}
                              >
                                Sales Calls
                              </td>
                              <td
                                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                style={{ color: "#52525b" }}
                                colSpan={2}
                              >
                                Outcome
                              </td>
                              <td
                                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                style={{ color: "#52525b" }}
                                colSpan={2}
                              >
                                Closer
                              </td>
                              <td
                                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                style={{ color: "#52525b" }}
                                colSpan={2}
                              >
                                Revenue
                              </td>
                              <td
                                className="px-4 py-2 text-xs font-semibold uppercase tracking-wider"
                                style={{ color: "#52525b" }}
                                colSpan={COLUMNS.length - 5}
                              >
                                Recording
                              </td>
                            </tr>
                            {callsForDate.map((call, ci) => (
                              <SalesCallRow key={ci} call={call} />
                            ))}
                          </>
                        )}
                      </RowGroup>
                    );
                  })}
                </tbody>

                {/* Totals Row */}
                {totalsRow && (
                  <tfoot>
                    <tr className="border-t-2 border-white/10 bg-[#0f0f12]">
                      {level !== "ad" && <td className="px-3 py-3" />}
                      <td className="sticky left-0 z-10 bg-[#0f0f12] px-4 py-3 text-sm font-bold text-white">
                        Total
                      </td>
                      {COLUMNS.map((col) => {
                        const value = (totalsRow as unknown as Record<string, number>)[col.key];
                        return (
                          <td
                            key={col.key}
                            className="px-4 py-3 text-sm font-semibold whitespace-nowrap"
                            style={{
                              textAlign: col.align,
                              color: "#c9a96e",
                              minWidth: col.minWidth,
                            }}
                          >
                            {col.format(value)}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Fragment wrapper for table row groups ── */
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
