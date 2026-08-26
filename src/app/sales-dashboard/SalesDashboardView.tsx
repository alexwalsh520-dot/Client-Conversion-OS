"use client";

// Sales Dashboard — powered ENTIRELY by the metrics engine.
//
// One fetch (GET /api/metrics-engine/sales-board) answers the whole page from
// warehouse.metrics_leads / metrics_lead_events (built from ghl_appointments +
// sales_tracker_rows + manychat_tag_events + dm_conversation_messages). No
// Sales Hub sheet API, no Sales Hub components — numbers may differ from the
// Sales Hub tab while engine attribution is tuned.
//
// Sections:
//   1. Client Dashboard   — per-client comparison; click a client to expand
//      the four call-type rows plus its lead/booking source distributions.
//   2. Closer Performance — team totals, collapsible call-type and lead-type
//      breakdowns, and the cash-ordered closer table (click to expand).
//   3. Setter Performance — new leads / booked / booking rate; the count
//      cells expand into source distributions. Includes the "Ai" setter.
//   4. Rep Adherence      — AI-graded pre-call confirmation SOP compliance
//      per closer (click to expand the six checks), plus the closing-script
//      placeholder slot (script arrives later).
//   5. Response Times     — per-setter + team medians from the engine's
//      response-time library (same warehouse data).

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Clock,
  Loader2,
  Trophy,
  Users,
  Banknote,
  TrendingUp,
  Phone,
  PhoneCall,
  XCircle,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { rangeForPreset, todayEt, type DayRange, type PresetId } from "@/lib/ads-v2/time";
import type { CallType } from "@/lib/metrics-engine/types";
import type {
  SalesBoardAdherenceRep,
  SalesBoardResponse,
  SalesBoardRtGroup,
  SalesStatSet,
} from "@/lib/metrics-engine/sales-board";
import { DateDropdown, MultiSelect } from "../master-dashboard/filter-controls";
import filterStyles from "../master-dashboard/metrics-dashboard.module.css";

/* ── Config ───────────────────────────────────────────────────────── */

const CLIENT_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "tyson", label: "Tyson" },
  { key: "jake", label: "Jake" },
];

const CALL_TYPE_ORDER: readonly CallType[] = ["dm", "onboarding", "lm_outbound", "outbound"];
const CALL_TYPE_LABELS: Record<CallType, string> = {
  dm: "DM Call",
  onboarding: "Onboarding Call",
  lm_outbound: "Lead Magnet Outbound",
  outbound: "Outbound",
};

const LEAD_TYPE_ORDER = ["ad", "organic", "follower", "misc"] as const;
const LEAD_TYPE_LABELS: Record<string, string> = {
  ad: "Ad",
  organic: "Organic",
  follower: "Follower",
  misc: "Misc",
  unknown: "Unknown",
};

const REFRESH_MS = 5 * 60_000;

/* ── Formatting ───────────────────────────────────────────────────── */

const fmtCents = (v: number) => fmtDollars(v / 100);
const fmtCentsOrDash = (v: number | null) => (v === null ? "—" : fmtDollars(v / 100));
const fmtRate = (v: number | null) => (v === null ? "—" : fmtPercent(v * 100));

function rateColor(v: number | null): string | undefined {
  if (v === null) return undefined;
  const pct = v * 100;
  return pct >= 70 ? "var(--success)" : pct >= 50 ? "var(--warning)" : "var(--danger)";
}

function fmtSeconds(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const s = Math.round(v);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/* ── Small building blocks ────────────────────────────────────────── */

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
  const isDash = value === "—";
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
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

/** The shared stat columns every comparison table uses. */
function StatHeaderCells() {
  return (
    <>
      <th>Cash</th>
      <th>AOV</th>
      <th>Close Rate</th>
      <th>Show Rate</th>
      <th>Booked</th>
      <th>Taken</th>
      <th>Wins</th>
      <th>Losses</th>
      <th>Upcoming</th>
    </>
  );
}

function StatCells({ s, strongRates }: { s: SalesStatSet; strongRates?: boolean }) {
  return (
    <>
      <td style={{ color: "var(--success)", fontWeight: strongRates ? 600 : undefined }}>
        {fmtCents(s.cash_cents)}
      </td>
      <td>{fmtCentsOrDash(s.aov_cents)}</td>
      <td>
        <span style={{ color: rateColor(s.close_rate), fontWeight: strongRates ? 600 : undefined }}>
          {fmtRate(s.close_rate)}
        </span>
      </td>
      <td>
        <span style={{ color: rateColor(s.show_rate), fontWeight: strongRates ? 600 : undefined }}>
          {fmtRate(s.show_rate)}
        </span>
      </td>
      <td>{fmtNumber(s.booked)}</td>
      <td>{fmtNumber(s.taken)}</td>
      <td style={{ color: "var(--success)" }}>{fmtNumber(s.wins)}</td>
      <td style={{ color: "var(--danger)" }}>{fmtNumber(s.losses)}</td>
      <td style={{ color: s.upcoming > 0 ? "var(--warning)" : "var(--text-secondary)" }}>
        {fmtNumber(s.upcoming)}
      </td>
    </>
  );
}

/** Slim horizontal CSS bar chart: label + bar + count. No chart libraries. */
function SourceBars({
  title,
  data,
  labelMap,
  order,
}: {
  title: string;
  data: Record<string, number>;
  labelMap: Record<string, string>;
  order?: readonly string[];
}) {
  const entries = Object.entries(data).filter(([, v]) => v > 0);
  const keys = order
    ? [
        ...order.filter((k) => entries.some(([ek]) => ek === k)),
        ...entries.map(([k]) => k).filter((k) => !order.includes(k)),
      ]
    : entries.sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div style={{ minWidth: 220, flex: 1 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          fontWeight: 600,
          color: "var(--text-muted)",
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {keys.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No data in this range.</div>
      ) : (
        keys.map((k) => {
          const v = data[k] ?? 0;
          return (
            <div
              key={k}
              style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}
            >
              <span
                style={{
                  width: 140,
                  flexShrink: 0,
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {labelMap[k] ?? k}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  background: "rgba(127,127,127,0.12)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(3, (v / max) * 100)}%`,
                    height: "100%",
                    borderRadius: 4,
                    background: "var(--accent)",
                    opacity: 0.85,
                  }}
                />
              </div>
              <span
                style={{
                  width: 36,
                  flexShrink: 0,
                  textAlign: "right",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {fmtNumber(v)}
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}

/** Collapsible breakdown table trigger + table (call-type / lead-type). */
function CollapsibleBreakdown({
  label,
  open,
  onToggle,
  rows,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  rows: Array<{ key: string; label: string; stats: SalesStatSet }>;
}) {
  return (
    <div style={{ marginBottom: open ? 12 : 8 }}>
      <button
        onClick={onToggle}
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
          marginBottom: open ? 12 : 0,
        }}
      >
        <span style={{ fontSize: 9 }}>{open ? "▾" : "▸"}</span>
        {label}
      </button>
      {open && (
        <div className="glass-static" style={{ overflow: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>{label.replace("Breakdown by ", "").replace(/^\w/, (c) => c.toUpperCase())}</th>
                <StatHeaderCells />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{r.label}</td>
                  <StatCells s={r.stats} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const callTypeRows = (by: Record<CallType, SalesStatSet>) =>
  CALL_TYPE_ORDER.map((ct) => ({ key: ct, label: CALL_TYPE_LABELS[ct], stats: by[ct] }));

/* ── Main view ────────────────────────────────────────────────────── */

export default function SalesDashboardView() {
  const [preset, setPreset] = useState<PresetId>("mtd");
  const [range, setRange] = useState<DayRange>(() => rangeForPreset("mtd", todayEt()));
  // null = all clients (no filter sent).
  const [clientSel, setClientSel] = useState<string[] | null>(null);

  const [data, setData] = useState<SalesBoardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);

  const [openClient, setOpenClient] = useState<string | null>(null);
  const [openCloser, setOpenCloser] = useState<string | null>(null);
  const [teamCallTypeOpen, setTeamCallTypeOpen] = useState(false);
  const [teamLeadTypeOpen, setTeamLeadTypeOpen] = useState(false);
  const [openSetterCell, setOpenSetterCell] = useState<{ key: string; kind: "leads" | "booked" } | null>(null);
  const [openAdherenceRep, setOpenAdherenceRep] = useState<string | null>(null);

  const clientPartial = clientSel !== null && clientSel.length < CLIENT_OPTIONS.length;
  const nothingSelected = clientSel !== null && clientSel.length === 0;

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!range.from || !range.to || range.from > range.to) return;
      if (nothingSelected) return;
      const params = new URLSearchParams({ from: range.from, to: range.to });
      if (clientPartial && clientSel) params.set("client", clientSel.join(","));
      const url = `/api/metrics-engine/sales-board?${params.toString()}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded
        if (!res.ok) throw new Error(body?.error || "Failed to load the sales board");
        setData(body as SalesBoardResponse);
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
    [range.from, range.to, clientPartial, clientSel, nothingSelected],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Background refresh while the window includes today.
  useEffect(() => {
    if (range.to < todayEt()) return;
    const id = window.setInterval(() => void load({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, range.to]);

  const team = data?.team ?? null;

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="fade-up">
      {/* Page Header */}
      <div className="page-header">
        <h1 className="page-title">Sales Dashboard</h1>
        <p className="page-subtitle">
          Clients, closers, setters and response times — computed by the metrics engine.
        </p>
      </div>

      {/* Filter bar: client multi-select + the Ads-v2-style date picker */}
      <div className={`glass-static ${filterStyles.filterBar}`}>
        <MultiSelect
          label="Client"
          icon={<Users size={13} style={{ color: "var(--text-muted)" }} />}
          options={CLIENT_OPTIONS}
          value={clientSel}
          onChange={setClientSel}
          allLabel="All clients"
        />
        <div className={filterStyles.filterDivider} />
        <DateDropdown
          preset={preset}
          range={range}
          onApply={(p, r) => {
            setPreset(p);
            setRange(r);
          }}
        />
        <button
          className={filterStyles.filterBtn}
          onClick={() => void load()}
          disabled={loading}
          style={{ marginLeft: "auto", opacity: loading ? 0.5 : 1 }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {data?.migration_pending ? (
        <div className={filterStyles.banner}>
          <AlertTriangle size={14} />
          Data engine awaiting database migration — numbers will appear once it runs.
        </div>
      ) : null}

      {nothingSelected ? (
        <div className={`glass-static ${filterStyles.emptyPanel}`}>
          No clients selected — pick at least one client to see the board.
        </div>
      ) : loading && !data ? (
        <div
          className="glass-static"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, marginTop: 16 }}
        >
          <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>
            Loading the sales board…
          </span>
        </div>
      ) : error && !data ? (
        <div
          className="glass-static"
          style={{ padding: 18, fontSize: 13, color: "var(--danger)", marginTop: 16 }}
        >
          {error}
        </div>
      ) : data ? (
        <>
          {error ? (
            <p style={{ fontSize: 12, color: "var(--warning)", margin: "10px 0 0" }}>
              Last refresh failed: {error}
            </p>
          ) : null}

          {/* ── Section 1: Client Dashboard ─────────────────────────── */}
          <div className="section" style={{ marginTop: 20 }}>
            <h2 className="section-title">
              <BarChart3 size={16} />
              Client Dashboard
            </h2>
            <div className="glass-static" style={{ overflow: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <StatHeaderCells />
                  </tr>
                </thead>
                <tbody>
                  {data.clients.map((c) => {
                    const isOpen = openClient === c.client_key;
                    const src = data.sources[c.client_key];
                    return (
                      <Fragment key={c.client_key}>
                        <tr
                          onClick={() => setOpenClient(isOpen ? null : c.client_key)}
                          style={{ cursor: "pointer" }}
                        >
                          <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                            <span style={{ display: "inline-block", width: 12, color: "var(--text-muted)" }}>
                              {isOpen ? "▾" : "▸"}
                            </span>
                            {c.label}
                          </td>
                          <StatCells s={c.stats} strongRates />
                        </tr>
                        {isOpen && (
                          <>
                            <tr style={{ background: "rgba(127,127,127,0.06)" }}>
                              <td
                                colSpan={10}
                                style={{
                                  paddingLeft: 28,
                                  fontSize: 11,
                                  textTransform: "uppercase",
                                  letterSpacing: "0.5px",
                                  fontWeight: 600,
                                  color: "var(--text-muted)",
                                }}
                              >
                                Breakdown by call type
                              </td>
                            </tr>
                            {CALL_TYPE_ORDER.map((ct) => (
                              <tr key={c.client_key + ct} style={{ background: "rgba(127,127,127,0.06)" }}>
                                <td style={{ paddingLeft: 28, color: "var(--text-secondary)", fontSize: 12 }}>
                                  {CALL_TYPE_LABELS[ct]}
                                </td>
                                <StatCells s={c.by_call_type[ct]} />
                              </tr>
                            ))}
                            <tr style={{ background: "rgba(127,127,127,0.06)" }}>
                              <td colSpan={10} style={{ padding: "14px 16px 16px 28px" }}>
                                <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                                  <SourceBars
                                    title="Lead sources (origin)"
                                    data={src?.lead_origins ?? {}}
                                    labelMap={LEAD_TYPE_LABELS}
                                    order={LEAD_TYPE_ORDER}
                                  />
                                  <SourceBars
                                    title="Booking funnels (call type)"
                                    data={src?.booking_call_types ?? {}}
                                    labelMap={CALL_TYPE_LABELS}
                                    order={CALL_TYPE_ORDER}
                                  />
                                </div>
                              </td>
                            </tr>
                          </>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 2: Closer Performance ───────────────────────── */}
          <div className="section" style={{ marginTop: 24 }}>
            <h2 className="section-title">
              <Trophy size={16} />
              Closer Performance
            </h2>

            {team && (
              <>
                <div className="metric-grid metric-grid-4" style={{ marginBottom: 12 }}>
                  <SummaryStat
                    icon={<Banknote size={12} style={{ color: "var(--success)" }} />}
                    label="Cash Collected"
                    value={fmtCents(team.stats.cash_cents)}
                    color="var(--success)"
                  />
                  <SummaryStat
                    icon={<BarChart3 size={12} style={{ color: "var(--success)" }} />}
                    label="AOV"
                    value={fmtCentsOrDash(team.stats.aov_cents)}
                    color="var(--success)"
                  />
                  <SummaryStat
                    icon={<TrendingUp size={12} style={{ color: "var(--accent)" }} />}
                    label="Close Rate"
                    value={fmtRate(team.stats.close_rate)}
                  />
                  <SummaryStat
                    icon={<TrendingUp size={12} style={{ color: "var(--accent)" }} />}
                    label="Show Rate"
                    value={fmtRate(team.stats.show_rate)}
                  />
                </div>
                <div className="metric-grid metric-grid-4" style={{ marginBottom: 16 }}>
                  <SummaryStat
                    icon={<Phone size={12} style={{ color: "var(--accent)" }} />}
                    label="Calls Booked"
                    value={fmtNumber(team.stats.booked)}
                  />
                  <SummaryStat
                    icon={<PhoneCall size={12} style={{ color: "var(--accent)" }} />}
                    label="Calls Taken"
                    value={fmtNumber(team.stats.taken)}
                  />
                  <SummaryStat
                    icon={<Trophy size={12} style={{ color: "var(--success)" }} />}
                    label="Wins"
                    value={fmtNumber(team.stats.wins)}
                    color="var(--success)"
                  />
                  <SummaryStat
                    icon={<XCircle size={12} style={{ color: "var(--danger)" }} />}
                    label="Losses"
                    value={fmtNumber(team.stats.losses)}
                    color="var(--danger)"
                  />
                </div>

                <CollapsibleBreakdown
                  label="Breakdown by call type"
                  open={teamCallTypeOpen}
                  onToggle={() => setTeamCallTypeOpen((v) => !v)}
                  rows={callTypeRows(team.by_call_type)}
                />
                <CollapsibleBreakdown
                  label="Breakdown by lead type"
                  open={teamLeadTypeOpen}
                  onToggle={() => setTeamLeadTypeOpen((v) => !v)}
                  rows={LEAD_TYPE_ORDER.map((t) => ({
                    key: t,
                    label: LEAD_TYPE_LABELS[t],
                    stats: data.lead_types[t],
                  }))}
                />
              </>
            )}

            {/* Closer table, cash-ordered */}
            <div className="glass-static" style={{ overflow: "auto", marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Closer</th>
                    <StatHeaderCells />
                  </tr>
                </thead>
                <tbody>
                  {data.closers.length === 0 ? (
                    <tr>
                      <td colSpan={10} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                        No closer activity in this range.
                      </td>
                    </tr>
                  ) : (
                    data.closers.map((cl) => {
                      const isOpen = openCloser === cl.rep_key;
                      return (
                        <Fragment key={cl.rep_key}>
                          <tr
                            onClick={() => setOpenCloser(isOpen ? null : cl.rep_key)}
                            style={{ cursor: "pointer" }}
                          >
                            <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                              <span style={{ display: "inline-block", width: 12, color: "var(--text-muted)" }}>
                                {isOpen ? "▾" : "▸"}
                              </span>
                              {cl.name}
                            </td>
                            <StatCells s={cl.stats} />
                          </tr>
                          {isOpen &&
                            CALL_TYPE_ORDER.map((ct) => (
                              <tr key={cl.rep_key + ct} style={{ background: "rgba(127,127,127,0.06)" }}>
                                <td style={{ paddingLeft: 28, color: "var(--text-secondary)", fontSize: 12 }}>
                                  {CALL_TYPE_LABELS[ct]}
                                </td>
                                <StatCells s={cl.by_call_type[ct]} />
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 3: Setter Performance ───────────────────────── */}
          <div className="section" style={{ marginTop: 24 }}>
            <h2 className="section-title">
              <Users size={16} />
              Setter Performance
            </h2>
            <div className="glass-static" style={{ overflow: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Setter</th>
                    <th>New Leads</th>
                    <th>Calls Booked</th>
                    <th>Booking Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {data.setters.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                        No setter activity in this range.
                      </td>
                    </tr>
                  ) : (
                    data.setters.map((s) => {
                      const openCell =
                        openSetterCell?.key === s.setter_key ? openSetterCell.kind : null;
                      const toggle = (kind: "leads" | "booked") =>
                        setOpenSetterCell(
                          openCell === kind ? null : { key: s.setter_key, kind },
                        );
                      const clickableStyle = (active: boolean): React.CSSProperties => ({
                        cursor: "pointer",
                        textDecoration: "underline",
                        textDecorationStyle: "dotted",
                        textUnderlineOffset: 3,
                        color: active ? "var(--accent)" : undefined,
                        fontWeight: active ? 600 : undefined,
                      });
                      return (
                        <Fragment key={s.setter_key}>
                          <tr>
                            <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{s.label}</td>
                            <td onClick={() => toggle("leads")} style={clickableStyle(openCell === "leads")}>
                              {fmtNumber(s.new_leads)}
                            </td>
                            <td onClick={() => toggle("booked")} style={clickableStyle(openCell === "booked")}>
                              {fmtNumber(s.booked)}
                            </td>
                            <td>
                              <span style={{ color: rateColor(s.booking_rate), fontWeight: 600 }}>
                                {fmtRate(s.booking_rate)}
                              </span>
                            </td>
                          </tr>
                          {openCell && (
                            <tr style={{ background: "rgba(127,127,127,0.06)" }}>
                              <td colSpan={4} style={{ padding: "14px 16px 16px 28px" }}>
                                {openCell === "leads" ? (
                                  <SourceBars
                                    title={`${s.label} — new leads by origin source`}
                                    data={s.lead_sources}
                                    labelMap={LEAD_TYPE_LABELS}
                                    order={LEAD_TYPE_ORDER}
                                  />
                                ) : (
                                  <SourceBars
                                    title={`${s.label} — booked calls by funnel`}
                                    data={s.booking_sources}
                                    labelMap={CALL_TYPE_LABELS}
                                    order={CALL_TYPE_ORDER}
                                  />
                                )}
                                {s.basis ? (
                                  <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                                    {s.basis}
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 4: Rep Adherence ────────────────────────────── */}
          <div className="section" style={{ marginTop: 24 }}>
            <h2 className="section-title">
              <ClipboardCheck size={16} />
              Rep Adherence
            </h2>
            {(() => {
              const adherence = data.adherence ?? null;
              const closers: SalesBoardAdherenceRep[] = adherence?.closers ?? [];
              const nothingGraded =
                !adherence || adherence.migration_pending || closers.length === 0;
              if (nothingGraded) {
                return (
                  <div
                    className="glass-static"
                    style={{ padding: 18, fontSize: 13, color: "var(--text-muted)" }}
                  >
                    No graded calls yet — grading runs every 2 hours.
                  </div>
                );
              }
              const awaitingPill = (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    marginLeft: 8,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: "1px solid var(--border-subtle)",
                    background: "rgba(127,127,127,0.08)",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.4px",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  Awaiting closing script
                </span>
              );
              return (
                <>
                  <div className="glass-static" style={{ overflow: "auto" }}>
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Closer</th>
                          <th>Pre-Call Adherence</th>
                          <th>Calls Graded</th>
                          <th>Closing Script</th>
                        </tr>
                      </thead>
                      <tbody>
                        {closers.map((rep) => {
                          const isOpen = openAdherenceRep === rep.rep_key;
                          return (
                            <Fragment key={rep.rep_key}>
                              <tr
                                onClick={() =>
                                  setOpenAdherenceRep(isOpen ? null : rep.rep_key)
                                }
                                style={{ cursor: "pointer" }}
                              >
                                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                                  <span
                                    style={{
                                      display: "inline-block",
                                      width: 12,
                                      color: "var(--text-muted)",
                                    }}
                                  >
                                    {isOpen ? "▾" : "▸"}
                                  </span>
                                  {rep.name}
                                </td>
                                <td>
                                  <span
                                    style={{
                                      color: rateColor(rep.pre_call.avg_score),
                                      fontWeight: 600,
                                    }}
                                  >
                                    {fmtRate(rep.pre_call.avg_score)}
                                  </span>
                                </td>
                                <td>
                                  {fmtNumber(rep.pre_call.graded)}
                                  {rep.pre_call.thread_missing > 0 ? (
                                    <span
                                      style={{
                                        marginLeft: 6,
                                        fontSize: 11,
                                        color: "var(--text-muted)",
                                      }}
                                      title="Calls with no SendBlue thread found — not counted in the average"
                                    >
                                      (+{rep.pre_call.thread_missing} no thread)
                                    </span>
                                  ) : null}
                                </td>
                                <td>
                                  <span style={{ color: "var(--text-muted)" }}>—</span>
                                  {awaitingPill}
                                </td>
                              </tr>
                              {isOpen && (
                                <tr style={{ background: "rgba(127,127,127,0.06)" }}>
                                  <td colSpan={4} style={{ padding: "14px 16px 16px 28px" }}>
                                    <div
                                      style={{
                                        fontSize: 11,
                                        textTransform: "uppercase",
                                        letterSpacing: "0.5px",
                                        fontWeight: 600,
                                        color: "var(--text-muted)",
                                        marginBottom: 8,
                                      }}
                                    >
                                      {rep.name} — pre-call SOP checks
                                    </div>
                                    <table className="data-table" style={{ fontSize: 12 }}>
                                      <thead>
                                        <tr>
                                          <th>Check</th>
                                          <th>Pass Rate</th>
                                          <th>Passed / Applicable</th>
                                          <th>Latest Example</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {rep.pre_call.checks.map((c) => (
                                          <tr key={c.id}>
                                            <td
                                              style={{
                                                fontWeight: 600,
                                                color: "var(--text-secondary)",
                                              }}
                                            >
                                              {c.label}
                                            </td>
                                            <td>
                                              <span
                                                style={{
                                                  color: rateColor(c.rate),
                                                  fontWeight: 600,
                                                }}
                                              >
                                                {fmtRate(c.rate)}
                                              </span>
                                            </td>
                                            <td style={{ color: "var(--text-secondary)" }}>
                                              {c.applicable > 0
                                                ? `${fmtNumber(c.passed)} / ${fmtNumber(c.applicable)}`
                                                : "—"}
                                            </td>
                                            <td
                                              style={{
                                                color: "var(--text-muted)",
                                                fontStyle: c.latest_evidence
                                                  ? "italic"
                                                  : undefined,
                                                maxWidth: 420,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                whiteSpace: "nowrap",
                                              }}
                                              title={c.latest_evidence ?? undefined}
                                            >
                                              {c.latest_evidence
                                                ? `“${c.latest_evidence}”`
                                                : "—"}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "8px 2px 0" }}>
                    Pre-call adherence is AI-graded from each call&apos;s SendBlue thread on
                    two lines only: the discovery line (&quot;make it worth your while&quot;) and
                    the commitment line (&quot;any reason you wouldn&apos;t make it&quot;). Scope:
                    strategy sessions + onboarding calls taken by our reps (grading runs every
                    2 hours). Calls with no thread found are excluded from averages.
                  </p>
                </>
              );
            })()}
          </div>

          {/* ── Section 5: Response Times ───────────────────────────── */}
          <div className="section" style={{ marginTop: 24 }}>
            <h2 className="section-title">
              <Clock size={16} />
              Response Times
            </h2>
            {data.response_times.error ? (
              <div
                className="glass-static"
                style={{ padding: 18, fontSize: 13, color: "var(--warning)" }}
              >
                Response times unavailable: {data.response_times.error}
              </div>
            ) : (
              <>
                {data.response_times.team ? (
                  <div className="metric-grid metric-grid-4" style={{ marginBottom: 12 }}>
                    <SummaryStat
                      icon={<Clock size={12} style={{ color: "var(--accent)" }} />}
                      label="Team Median"
                      value={fmtSeconds(data.response_times.team.median_seconds)}
                    />
                    <SummaryStat
                      icon={<Clock size={12} style={{ color: "var(--accent)" }} />}
                      label="Team Average"
                      value={fmtSeconds(data.response_times.team.average_seconds)}
                    />
                    <SummaryStat
                      icon={<PhoneCall size={12} style={{ color: "var(--accent)" }} />}
                      label="Replies Measured"
                      value={fmtNumber(data.response_times.team.sample_count)}
                    />
                    <SummaryStat
                      icon={<XCircle size={12} style={{ color: "var(--danger)" }} />}
                      label={`Missed (>${Math.round(data.response_times.miss_threshold_seconds / 60)}m)`}
                      value={fmtNumber(data.response_times.team.missed_count)}
                      color={
                        data.response_times.team.missed_count > 0 ? "var(--danger)" : undefined
                      }
                    />
                  </div>
                ) : null}
                <div className="glass-static" style={{ overflow: "auto" }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Setter</th>
                        <th>Median</th>
                        <th>Average</th>
                        <th>Fastest</th>
                        <th>Slowest</th>
                        <th>Replies</th>
                        <th>Missed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.response_times.setters.length === 0 ? (
                        <tr>
                          <td
                            colSpan={7}
                            style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}
                          >
                            No matched response-time samples in this range.
                          </td>
                        </tr>
                      ) : (
                        [...data.response_times.setters]
                          .sort((a, b) => b.sample_count - a.sample_count)
                          .map((g: SalesBoardRtGroup) => (
                            <tr key={g.id}>
                              <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>{g.label}</td>
                              <td>{fmtSeconds(g.median_seconds)}</td>
                              <td>{fmtSeconds(g.average_seconds)}</td>
                              <td>{fmtSeconds(g.fastest_seconds)}</td>
                              <td>{fmtSeconds(g.slowest_seconds)}</td>
                              <td>{fmtNumber(g.sample_count)}</td>
                              <td style={{ color: g.missed_count > 0 ? "var(--danger)" : undefined }}>
                                {fmtNumber(g.missed_count)}
                              </td>
                            </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
