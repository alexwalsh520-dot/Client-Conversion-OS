"use client";

// Metrics-engine dashboards — the shared client view behind /master-dashboard,
// /marketing-dashboard and /sales-dashboard (thin server pages pass `scope`).
//
// Everything renders inline on one page: summary tiles → by lead type →
// by rep → rep × lead type matrix → by channel → by client. No drilldowns.
// Every metric shows BOTH views — Activity (events in the window) and Cohort
// (leads acquired in the window, counting their downstream events whenever
// they happen). A null cell is an em-dash, never 0. Metrics with
// defined:false carry a subtle "no data source yet" tag.
//
// Data: GET /api/metrics-engine/summary (session-authed; the tab itself is
// admin-only via sidebar/AccessGate). Ranges are ET calendar days; presets
// are Today / WTD / MTD / Custom per the CCOS tab conventions.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BarChart3, CalendarDays, Gauge, Loader2, Megaphone } from "lucide-react";
import type {
  Channel,
  LeadType,
  MetricBlock,
  MetricCell,
  MetricsSummary,
  MetricUnit,
} from "@/lib/metrics-engine/types";
import styles from "./metrics-dashboard.module.css";

export type DashboardScope = "master" | "marketing" | "sales";

// ── Scope config ────────────────────────────────────────────────────────────

const MARKETING_KEYS = [
  "leads",
  "cash_collected",
  "ad_spend",
  "roas",
  "roas_blended",
  "roi",
  "cpm",
  "lctr",
] as const;

const SALES_KEYS = [
  "calls_booked",
  "booking_rate_new_leads",
  "show_rate",
  "close_rate",
  "aov",
  "reschedules",
  // Not yet live — the API marks these defined:false; they render as dashes
  // with a "no data source yet" tag.
  "pickup_rate_lm_lt60",
  "pickup_rate_lm_gt60",
  "pickup_rate_outbound",
  "script_adherence_set",
  "script_adherence_close",
  "pre_call_message_adherence",
] as const;

const SCOPE_META: Record<
  DashboardScope,
  { title: string; blurb: string; icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }> }
> = {
  master: {
    title: "Master Dashboard",
    blurb: "Marketing and sales, one page. Activity and cohort views side by side.",
    icon: Gauge,
  },
  marketing: {
    title: "Marketing Dashboard",
    blurb: "Leads, cash, spend and returns — by lead type and by client.",
    icon: Megaphone,
  },
  sales: {
    title: "Sales Dashboard",
    blurb: "Bookings, shows, closes and AOV — by rep, lead type and channel.",
    icon: BarChart3,
  },
};

const CLIENT_OPTIONS = [
  { key: "all", label: "All" },
  { key: "tyson", label: "Tyson" },
  { key: "jake", label: "Jake" },
] as const;

const LEAD_TYPE_LABELS: Record<LeadType, string> = {
  ad: "Ad",
  organic: "Organic",
  follower: "Follower",
  misc: "Misc",
};
const LEAD_TYPE_ORDER: readonly LeadType[] = ["ad", "organic", "follower", "misc"];

const CHANNEL_LABELS: Record<Channel, string> = {
  dm: "DM",
  lm_outbound_lt60: "LM Outbound <60s",
  lm_outbound_gt60: "LM Outbound >60s",
  outbound: "Outbound",
};
const CHANNEL_ORDER: readonly Channel[] = ["dm", "lm_outbound_lt60", "lm_outbound_gt60", "outbound"];

// ── ET date presets: Today / WTD / MTD / Custom ─────────────────────────────

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(dateStr, -((dow + 6) % 7)); // Monday
}

type PresetKey = "today" | "wtd" | "mtd" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "wtd", label: "Week to Date" },
  { key: "mtd", label: "Month to Date" },
  { key: "custom", label: "Custom" },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const today = etToday();
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "wtd":
      return { from: startOfWeek(today), to: today };
    case "mtd":
      return { from: today.slice(0, 8) + "01", to: today };
    default:
      return { from: today, to: today };
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** Format one value for its unit. null = em-dash, never 0. */
function fmtValue(v: number | null, unit: MetricUnit): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "count":
      return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
    case "usd_cents": {
      const dollars = v / 100;
      // $X,XXX — no cents unless the amount is under $100.
      const cents = Math.abs(dollars) < 100 && dollars !== 0;
      return dollars.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: cents ? 2 : 0,
        maximumFractionDigits: cents ? 2 : 0,
      });
    }
    case "ratio":
      return `${(v * 100).toFixed(1)}%`;
    case "multiple":
      return `${v.toFixed(2)}x`;
    default:
      return String(v);
  }
}

// ── Small render pieces ─────────────────────────────────────────────────────

function Val({ v, unit }: { v: number | null; unit: MetricUnit }) {
  const s = fmtValue(v, unit);
  return s === "—" ? <span className={styles.dash}>—</span> : <>{s}</>;
}

/** A pair of Act·Coh table cells for one metric cell. */
function PairTds({ cell, unit }: { cell: MetricCell | null | undefined; unit: MetricUnit }) {
  return (
    <>
      <td className={styles.pairStart}>
        <Val v={cell?.activity ?? null} unit={unit} />
      </td>
      <td>
        <Val v={cell?.cohort ?? null} unit={unit} />
      </td>
    </>
  );
}

/** Compact two-value cell ("act · coh") for the rep × lead-type matrix. */
function PairCompact({ cell, unit }: { cell: MetricCell | null | undefined; unit: MetricUnit }) {
  return (
    <span className={styles.pairCell}>
      <span>
        <Val v={cell?.activity ?? null} unit={unit} />
      </span>
      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
        <Val v={cell?.cohort ?? null} unit={unit} />
      </span>
    </span>
  );
}

function PendingTag() {
  return <span className={styles.pendingTag}>no data source yet</span>;
}

// ── Sections ────────────────────────────────────────────────────────────────

function SummaryTiles({ blocks }: { blocks: MetricBlock[] }) {
  return (
    <div className={styles.tileGrid}>
      {blocks.map((b) => (
        <div key={b.key} className={`glass-static ${styles.tile}`}>
          <p className={styles.tileLabel}>
            {b.label}
            {!b.defined ? <PendingTag /> : null}
          </p>
          <p className={styles.tileValue}>
            <span>Act</span>
            <Val v={b.total?.activity ?? null} unit={b.unit} />
          </p>
          <p className={styles.tileCohort}>
            <span>Coh</span>
            <Val v={b.total?.cohort ?? null} unit={b.unit} />
          </p>
        </div>
      ))}
    </div>
  );
}

/** Rows = metrics, column groups = an arbitrary keyed dimension (lead types,
    channels, clients), each group an Act·Coh pair. */
function MetricsByDimensionTable({
  blocks,
  cols,
  cellFor,
}: {
  blocks: MetricBlock[];
  cols: { key: string; label: string }[];
  cellFor: (b: MetricBlock, colKey: string) => MetricCell | null | undefined;
}) {
  return (
    <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.groupHead}>
              <th />
              {cols.map((c) => (
                <th key={c.key} colSpan={2} className={styles.pairStart}>
                  {c.label}
                </th>
              ))}
            </tr>
            <tr className={styles.subHead}>
              <th>Metric</th>
              {cols.map((c) => (
                <React.Fragment key={c.key}>
                  <th className={styles.pairStart}>Act</th>
                  <th>Coh</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.key}>
                <td className={styles.rowLabel}>
                  {b.label}
                  {!b.defined ? (
                    <>
                      {" "}
                      <PendingTag />
                    </>
                  ) : null}
                </td>
                {cols.map((c) => (
                  <PairTds key={c.key} cell={cellFor(b, c.key)} unit={b.unit} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Rows = reps, column groups = metrics (Act·Coh pairs). */
function RepTable({
  blocks,
  reps,
}: {
  blocks: MetricBlock[];
  reps: Array<{ key: string; name: string }>;
}) {
  const cols = blocks.filter((b) => b.by_rep !== null);
  if (cols.length === 0) {
    return (
      <div className="glass-static" style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
        No rep-attributable metrics in this window.
      </div>
    );
  }
  return (
    <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.groupHead}>
              <th />
              {cols.map((b) => (
                <th key={b.key} colSpan={2} className={styles.pairStart}>
                  {b.label}
                </th>
              ))}
            </tr>
            <tr className={styles.subHead}>
              <th>Rep</th>
              {cols.map((b) => (
                <React.Fragment key={b.key}>
                  <th className={styles.pairStart}>Act</th>
                  <th>Coh</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {reps.map((rep) => (
              <tr key={rep.key}>
                <td className={styles.rowLabel}>{rep.name}</td>
                {cols.map((b) => (
                  <PairTds key={b.key} cell={b.by_rep?.[rep.key]} unit={b.unit} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Compact rep × lead-type matrix: one sub-table per metric, rows = reps,
    cols = lead types, two-value cells (act · coh). All inline, no clicks. */
function RepLeadTypeMatrix({
  blocks,
  reps,
}: {
  blocks: MetricBlock[];
  reps: Array<{ key: string; name: string }>;
}) {
  const withMatrix = blocks.filter((b) => b.by_rep_x_lead_type !== null);
  if (withMatrix.length === 0) {
    return (
      <div className="glass-static" style={{ padding: 16, fontSize: 13, color: "var(--text-muted)" }}>
        No rep × lead-type data in this window.
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
      {withMatrix.map((b) => (
        <div key={b.key} className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
          <p
            style={{
              margin: 0,
              padding: "10px 14px 4px",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-muted)",
            }}
          >
            {b.label}
          </p>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Rep</th>
                  {LEAD_TYPE_ORDER.map((t) => (
                    <th key={t}>{LEAD_TYPE_LABELS[t]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reps.map((rep) => (
                  <tr key={rep.key}>
                    <td className={styles.rowLabel}>{rep.name}</td>
                    {LEAD_TYPE_ORDER.map((t) => (
                      <td key={t}>
                        <PairCompact cell={b.by_rep_x_lead_type?.[rep.key]?.[t]} unit={b.unit} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main view ───────────────────────────────────────────────────────────────

const REFRESH_MS = 5 * 60_000;

export default function MetricsDashboardView({ scope }: { scope: DashboardScope }) {
  const meta = SCOPE_META[scope];
  const showRepFilter = scope !== "marketing";

  const [preset, setPreset] = useState<PresetKey>("mtd");
  const [customFrom, setCustomFrom] = useState(() => etToday());
  const [customTo, setCustomTo] = useState(() => etToday());
  const [client, setClient] = useState<string>("all");
  const [rep, setRep] = useState<string>("all");
  const [lens, setLens] = useState<"origin" | "conversion">("origin");
  const [data, setData] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);

  const range = useMemo(
    () => (preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset)),
    [preset, customFrom, customTo],
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!range.from || !range.to || range.from > range.to) return;
      const params = new URLSearchParams({ from: range.from, to: range.to, lens });
      if (client !== "all") params.set("client", client);
      if (showRepFilter && rep !== "all") params.set("rep", rep);
      const url = `/api/metrics-engine/summary?${params.toString()}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded
        if (!res.ok) throw new Error(body?.error || "Failed to load metrics");
        setData(body as MetricsSummary);
        setError(null);
      } catch (err) {
        if (inFlight.current !== url) return;
        setError((err as Error).message);
      } finally {
        if (inFlight.current === url) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [range.from, range.to, client, rep, lens, showRepFilter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Background refresh while the window includes today.
  useEffect(() => {
    if (range.to < etToday()) return;
    const id = window.setInterval(() => void load({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, range.to]);

  const blocksByKey = useMemo(() => {
    const map = new Map<string, MetricBlock>();
    for (const b of data?.metrics ?? []) map.set(b.key, b);
    return map;
  }, [data]);

  const pick = useCallback(
    (keys: readonly string[]) =>
      keys.map((k) => blocksByKey.get(k)).filter((b): b is MetricBlock => Boolean(b)),
    [blocksByKey],
  );

  const marketingBlocks = pick(MARKETING_KEYS);
  const salesBlocks = pick(SALES_KEYS);

  const reps = data?.reps ?? [];
  const clientCols = (data?.clients ?? []).map((k) => ({
    key: k,
    label: CLIENT_OPTIONS.find((c) => c.key === k)?.label ?? k,
  }));
  const leadTypeCols = LEAD_TYPE_ORDER.map((t) => ({ key: t, label: LEAD_TYPE_LABELS[t] }));
  const channelCols = CHANNEL_ORDER.map((c) => ({ key: c, label: CHANNEL_LABELS[c] }));

  const showByClient = client === "all";

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "6px 12px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    border: `1px solid ${active ? "var(--accent)" : "rgba(128,128,128,0.25)"}`,
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-secondary)",
    whiteSpace: "nowrap",
  });

  const Icon = meta.icon;

  const marketingSections = (keyPrefix: string) => (
    <React.Fragment key={keyPrefix}>
      <div className="section">
        <h2 className="section-title">
          <Megaphone size={16} />
          Marketing — Summary
        </h2>
        <SummaryTiles blocks={marketingBlocks} />
      </div>
      <div className="section">
        <h2 className="section-title">Marketing — By Lead Type</h2>
        <MetricsByDimensionTable
          blocks={marketingBlocks.filter((b) => b.by_lead_type !== null)}
          cols={leadTypeCols}
          cellFor={(b, k) => b.by_lead_type?.[k as LeadType]}
        />
      </div>
      {showByClient ? (
        <div className="section">
          <h2 className="section-title">Marketing — By Client</h2>
          <MetricsByDimensionTable
            blocks={marketingBlocks.filter((b) => b.by_client !== null)}
            cols={clientCols}
            cellFor={(b, k) => b.by_client?.[k]}
          />
        </div>
      ) : null}
    </React.Fragment>
  );

  const salesSections = (keyPrefix: string) => (
    <React.Fragment key={keyPrefix}>
      <div className="section">
        <h2 className="section-title">
          <BarChart3 size={16} />
          Sales — Summary
        </h2>
        <SummaryTiles blocks={salesBlocks} />
      </div>
      <div className="section">
        <h2 className="section-title">Sales — By Lead Type</h2>
        <MetricsByDimensionTable
          blocks={salesBlocks.filter((b) => b.by_lead_type !== null)}
          cols={leadTypeCols}
          cellFor={(b, k) => b.by_lead_type?.[k as LeadType]}
        />
      </div>
      <div className="section">
        <h2 className="section-title">Sales — By Rep</h2>
        <RepTable blocks={salesBlocks} reps={reps} />
      </div>
      <div className="section">
        <h2 className="section-title">Sales — Rep × Lead Type</h2>
        <RepLeadTypeMatrix blocks={salesBlocks} reps={reps} />
      </div>
      <div className="section">
        <h2 className="section-title">Sales — By Channel</h2>
        <MetricsByDimensionTable
          blocks={salesBlocks.filter((b) => b.by_channel !== null)}
          cols={channelCols}
          cellFor={(b, k) => b.by_channel?.[k as Channel]}
        />
      </div>
      {showByClient ? (
        <div className="section">
          <h2 className="section-title">Sales — By Client</h2>
          <MetricsByDimensionTable
            blocks={salesBlocks.filter((b) => b.by_client !== null)}
            cols={clientCols}
            cellFor={(b, k) => b.by_client?.[k]}
          />
        </div>
      ) : null}
    </React.Fragment>
  );

  return (
    <div className="fade-up" style={{ maxWidth: 1240 }}>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon size={22} style={{ color: "var(--accent)" }} />
          {meta.title}
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
          {meta.blurb}
          {data ? ` · ${data.range.from} → ${data.range.to} (ET)` : ""}
        </p>
      </div>

      {/* ── Date range ── */}
      <div className={styles.filters}>
        <CalendarDays size={15} style={{ color: "var(--text-muted)" }} />
        {PRESETS.map((p) => (
          <button key={p.key} style={chip(preset === p.key)} onClick={() => setPreset(p.key)}>
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="date"
              className="input-field"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{ width: 150, padding: "6px 10px", fontSize: 13 }}
            />
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>to</span>
            <input
              type="date"
              className="input-field"
              value={customTo}
              min={customFrom}
              max={etToday()}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ width: 150, padding: "6px 10px", fontSize: 13 }}
            />
          </span>
        )}
        <button onClick={() => void load()} disabled={loading} style={{ ...chip(false), opacity: loading ? 0.5 : 1 }}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ── Filters ── */}
      <div className={styles.filters} style={{ marginBottom: 6 }}>
        <span className={styles.filterLabel}>Client</span>
        {CLIENT_OPTIONS.map((c) => (
          <button key={c.key} style={chip(client === c.key)} onClick={() => setClient(c.key)}>
            {c.label}
          </button>
        ))}
        <span className={styles.filterLabel} style={{ marginLeft: 10 }}>
          Lens
        </span>
        <button style={chip(lens === "origin")} onClick={() => setLens("origin")}>
          Origin source
        </button>
        <button style={chip(lens === "conversion")} onClick={() => setLens("conversion")}>
          Conversion source
        </button>
      </div>
      {showRepFilter ? (
        <div className={styles.filters}>
          <span className={styles.filterLabel}>Rep</span>
          <button style={chip(rep === "all")} onClick={() => setRep("all")}>
            All
          </button>
          {reps.map((r) => (
            <button key={r.key} style={chip(rep === r.key)} onClick={() => setRep(r.key)}>
              {r.name.split(" ")[0]}
            </button>
          ))}
          {rep !== "all" ? (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Marketing metrics blank under a rep filter — they are not attributable to one rep.
            </span>
          ) : null}
        </div>
      ) : null}

      <p className={styles.legend}>
        Every metric shows two views — <strong>Act</strong> = activity in the window ·{" "}
        <strong>Coh</strong> = from leads acquired in the window (their downstream events, whenever
        they happen). A dash means no data / not applicable, never zero.
      </p>

      {data?.migration_pending ? (
        <div className={styles.banner}>
          <AlertTriangle size={14} />
          Data engine awaiting database migration — numbers will appear once it runs.
        </div>
      ) : null}

      {loading && !data ? (
        <div
          className="glass-static"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}
        >
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading metrics…</span>
        </div>
      ) : error && !data ? (
        <div className="glass-static" style={{ padding: 18, fontSize: 13, color: "var(--warning)" }}>
          {error}
        </div>
      ) : data ? (
        <>
          {scope !== "sales" ? marketingSections("mkt") : null}
          {scope !== "marketing" ? salesSections("sales") : null}

          <p className={styles.freshness}>
            Ledger built {data.freshness.ledger_built_at ? fmtStamp(data.freshness.ledger_built_at) : "—"} · sheet
            synced {data.freshness.sheet_synced_at ? fmtStamp(data.freshness.sheet_synced_at) : "—"} · spend synced{" "}
            {data.freshness.spend_synced_at ? fmtStamp(data.freshness.spend_synced_at) : "—"}
          </p>
          {error ? (
            <p style={{ fontSize: 12, color: "var(--warning)", marginTop: 8 }}>Last refresh failed: {error}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function fmtStamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
