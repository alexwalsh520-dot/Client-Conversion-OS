"use client";

import { useEffect, useState, useMemo, useCallback, Fragment, type ReactNode } from "react";
import {
  Loader2,
  Users,
  MessageCircle,
  Link2,
  CreditCard,
  Phone,
  PhoneCall,
  TrendingUp,
  Trophy,
  XCircle,
  DollarSign,
  Banknote,
  Clock,
  AlertTriangle,
  ArrowRight,
  BarChart3,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, SheetRow, ManychatMetrics, ManychatDashboard } from "../types";

/* ── Types ────────────────────────────────────────────────────────── */

interface SheetApiResponse {
  rows: SheetRow[];
  subscriptionsSold: number;
}

interface DataState<T> {
  data: T | null;
  loading: boolean;
  error: string;
}

interface UnifiedDashboardProps {
  filters: Filters;
}

/* ── Fetch helper ─────────────────────────────────────────────────── */

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
  return res.json();
}

/* ── Manychat aggregation ─────────────────────────────────────────── */

function sumDashboards(a: ManychatDashboard, b: ManychatDashboard): ManychatDashboard {
  return {
    newLeads: a.newLeads + b.newLeads,
    leadsEngaged: a.leadsEngaged + b.leadsEngaged,
    callLinksSent: a.callLinksSent + b.callLinksSent,
    subLinksSent: a.subLinksSent + b.subLinksSent,
  };
}

/* ── Sub-components ──────────────────────────────────────────────── */

function DashLabel({ icon, children, first }: { icon: ReactNode; children: ReactNode; first?: boolean }) {
  return (
    <div
      style={{
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "1px",
        color: "var(--text-muted)",
        fontWeight: 600,
        margin: first ? "0 0 12px" : "28px 0 12px",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      {icon}
      {children}
    </div>
  );
}

function LoadingPulse() {
  return (
    <div style={{ padding: 12 }}>
      <Loader2 size={18} className="spin" style={{ color: "var(--text-muted)" }} />
    </div>
  );
}

function ErrorMsg() {
  return <div style={{ fontSize: 12, color: "var(--danger)" }}>Failed to load</div>;
}

/* ── Component ────────────────────────────────────────────────────── */

export default function UnifiedDashboard({ filters }: UnifiedDashboardProps) {
  const { dateFrom, dateTo } = getEffectiveDates(filters);

  /* -- Manychat state -- */
  const [manychat, setManychat] = useState<DataState<ManychatDashboard>>({
    data: null,
    loading: true,
    error: "",
  });

  /* -- Sheet state (includes subscriptionsSold from Q3) -- */
  const [sheet, setSheet] = useState<DataState<{ rows: SheetRow[]; subscriptionsSold: number }>>({
    data: null,
    loading: true,
    error: "",
  });

  /* ── Fetch Manychat ─────────────────────────────────────────────── */
  const fetchManychat = useCallback(async () => {
    setManychat({ data: null, loading: true, error: "" });
    try {
      if (filters.client === "all") {
        const [tyson, keith] = await Promise.all([
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=tyson&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=keith&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
        ]);
        setManychat({
          data: sumDashboards(tyson.dashboard, keith.dashboard),
          loading: false,
          error: "",
        });
      } else {
        const res = await fetchJSON<ManychatMetrics>(
          `/api/sales-hub/manychat-metrics?client=${filters.client}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        );
        setManychat({ data: res.dashboard, loading: false, error: "" });
      }
    } catch (err) {
      setManychat({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [filters.client, dateFrom, dateTo]);

  /* ── Fetch Sheet ────────────────────────────────────────────────── */
  const fetchSheet = useCallback(async () => {
    setSheet({ data: null, loading: true, error: "" });
    try {
      const clientParam =
        filters.client !== "all"
          ? `&client=${filters.client === "tyson" ? "Tyson Sonnek" : "Keith Holland"}`
          : "";
      const res = await fetchJSON<SheetApiResponse>(
        `/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}${clientParam}`,
      );
      setSheet({ data: { rows: res.rows, subscriptionsSold: res.subscriptionsSold }, loading: false, error: "" });
    } catch (err) {
      setSheet({
        data: null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [filters.client, dateFrom, dateTo]);

  /* ── Trigger fetches on filter change ───────────────────────────── */
  useEffect(() => { fetchManychat(); }, [fetchManychat]);
  useEffect(() => { fetchSheet(); }, [fetchSheet]);

  /* ── Computed closer metrics ────────────────────────────────────── */
  const closerMetrics = useMemo(() => {
    if (!sheet.data) return null;
    const rows = sheet.data.rows;

    const callsBooked = rows.length;
    const callsTaken = rows.filter((r) => r.callTaken).length;
    const noShows = rows.filter((r) => !r.callTaken).length;
    const showRate = callsBooked > 0 ? (callsTaken / callsBooked) * 100 : 0;

    const wins = rows.filter((r) => r.outcome === "WIN").length;
    const losses = rows.filter((r) => r.outcome === "LOST").length;
    const pcfus = rows.filter((r) => r.outcome === "PCFU").length;
    const denominator = wins + losses + pcfus;
    const closeRate = denominator > 0 ? (wins / denominator) * 100 : 0;

    const winRows = rows.filter((r) => r.outcome === "WIN");
    const revenue = winRows.reduce((sum, r) => sum + r.revenue, 0);
    const cashCollected = winRows.reduce((sum, r) => sum + r.cashCollected, 0);
    const aov = wins > 0 ? revenue / wins : 0;

    const subscriptionsSold = sheet.data.subscriptionsSold;

    return {
      callsBooked, callsTaken, showRate, wins, losses, closeRate,
      cashCollected, aov, pcfus, noShows, revenue, subscriptionsSold,
    };
  }, [sheet.data]);

  /* ── Helpers ────────────────────────────────────────────────────── */

  const rateColor = (rate: number) =>
    rate >= 70 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)";

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Revenue Overview ──────────────────────────────────────── */}
      <DashLabel icon={<DollarSign size={12} />} first>Revenue</DashLabel>
      <div className="metric-grid metric-grid-2">
        {/* Cash Collected */}
        <div className="glass-static" style={{ padding: "24px 28px" }}>
          {sheet.loading ? <LoadingPulse /> : sheet.error ? <ErrorMsg /> : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <Banknote size={14} style={{ color: "var(--success)" }} />
                <span style={{
                  fontSize: 12, color: "var(--text-muted)", fontWeight: 500,
                  textTransform: "uppercase", letterSpacing: "0.3px",
                }}>
                  Cash Collected
                </span>
              </div>
              <div style={{
                fontSize: 36, fontWeight: 700, color: "var(--success)",
                letterSpacing: "-1.5px", lineHeight: 1,
              }}>
                {closerMetrics ? fmtDollars(closerMetrics.cashCollected) : "—"}
              </div>
              <div style={{
                marginTop: 14, display: "flex", gap: 20,
                fontSize: 13, color: "var(--text-secondary)",
              }}>
                <span>
                  from <strong style={{ color: "var(--text-primary)" }}>{closerMetrics?.wins ?? 0}</strong> wins
                </span>
                <span>
                  AOV <strong style={{ color: "var(--text-primary)" }}>{closerMetrics ? fmtDollars(closerMetrics.aov) : "—"}</strong>
                </span>
              </div>
            </>
          )}
        </div>

        {/* Total Revenue */}
        <div className="glass-static" style={{ padding: "24px 28px" }}>
          {sheet.loading ? <LoadingPulse /> : sheet.error ? <ErrorMsg /> : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <DollarSign size={14} style={{ color: "var(--success)" }} />
                <span style={{
                  fontSize: 12, color: "var(--text-muted)", fontWeight: 500,
                  textTransform: "uppercase", letterSpacing: "0.3px",
                }}>
                  Total Revenue
                </span>
              </div>
              <div style={{
                fontSize: 36, fontWeight: 700, color: "var(--success)",
                letterSpacing: "-1.5px", lineHeight: 1,
              }}>
                {closerMetrics ? fmtDollars(closerMetrics.revenue) : "—"}
              </div>
              <div style={{
                marginTop: 14, display: "flex", gap: 20,
                fontSize: 13, color: "var(--text-secondary)",
              }}>
                <span>
                  Subs sold <strong style={{ color: "var(--text-primary)" }}>{closerMetrics?.subscriptionsSold ?? 0}</strong>
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Conversion Rates ─────────────────────────────────────── */}
      <DashLabel icon={<TrendingUp size={12} />}>Conversion</DashLabel>
      <div className="metric-grid metric-grid-2">
        {/* Close Rate */}
        <div className="glass-static" style={{ padding: "20px 24px" }}>
          {sheet.loading ? <LoadingPulse /> : sheet.error ? <ErrorMsg /> : closerMetrics && (
            <>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 14,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 12, color: "var(--text-muted)", fontWeight: 500,
                  textTransform: "uppercase", letterSpacing: "0.3px",
                }}>
                  <TrendingUp size={14} style={{ color: rateColor(closerMetrics.closeRate) }} />
                  Close Rate
                </div>
                <div style={{
                  fontSize: 28, fontWeight: 700,
                  color: rateColor(closerMetrics.closeRate), letterSpacing: "-1px",
                }}>
                  {fmtPercent(closerMetrics.closeRate)}
                </div>
              </div>
              {/* Progress bar */}
              <div style={{
                height: 6, background: "rgba(255,255,255,0.06)",
                borderRadius: 3, overflow: "hidden", marginBottom: 14,
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(closerMetrics.closeRate, 100)}%`,
                  background: rateColor(closerMetrics.closeRate),
                  borderRadius: 3,
                  transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                }} />
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                <span><strong style={{ color: "var(--success)" }}>{closerMetrics.wins}</strong> wins</span>
                <span><strong style={{ color: "var(--danger)" }}>{closerMetrics.losses}</strong> losses</span>
                <span><strong style={{ color: "var(--warning)" }}>{closerMetrics.pcfus}</strong> pending</span>
              </div>
            </>
          )}
        </div>

        {/* Show Rate */}
        <div className="glass-static" style={{ padding: "20px 24px" }}>
          {sheet.loading ? <LoadingPulse /> : sheet.error ? <ErrorMsg /> : closerMetrics && (
            <>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 14,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontSize: 12, color: "var(--text-muted)", fontWeight: 500,
                  textTransform: "uppercase", letterSpacing: "0.3px",
                }}>
                  <PhoneCall size={14} style={{ color: rateColor(closerMetrics.showRate) }} />
                  Show Rate
                </div>
                <div style={{
                  fontSize: 28, fontWeight: 700,
                  color: rateColor(closerMetrics.showRate), letterSpacing: "-1px",
                }}>
                  {fmtPercent(closerMetrics.showRate)}
                </div>
              </div>
              <div style={{
                height: 6, background: "rgba(255,255,255,0.06)",
                borderRadius: 3, overflow: "hidden", marginBottom: 14,
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(closerMetrics.showRate, 100)}%`,
                  background: rateColor(closerMetrics.showRate),
                  borderRadius: 3,
                  transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                }} />
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--text-secondary)" }}>
                <span>
                  <strong style={{ color: "var(--text-primary)" }}>{closerMetrics.callsTaken}</strong> / {closerMetrics.callsBooked} showed
                </span>
                <span>
                  <strong style={{ color: "var(--danger)" }}>{closerMetrics.noShows}</strong> no-shows
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Pipeline ─────────────────────────────────────────────── */}
      <DashLabel icon={<BarChart3 size={12} />}>Pipeline</DashLabel>
      {sheet.loading ? (
        <div className="glass-static" style={{ padding: 24, textAlign: "center" }}>
          <LoadingPulse />
        </div>
      ) : sheet.error ? (
        <div className="glass-static" style={{ padding: 24 }}><ErrorMsg /></div>
      ) : closerMetrics && (
        <div className="glass-static" style={{ padding: "20px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Funnel stages */}
            {[
              { label: "Booked", value: closerMetrics.callsBooked, color: "var(--accent)", icon: <Phone size={13} /> },
              { label: "Taken", value: closerMetrics.callsTaken, color: "var(--accent)", icon: <PhoneCall size={13} /> },
              { label: "Wins", value: closerMetrics.wins, color: "var(--success)", icon: <Trophy size={13} /> },
            ].map((stage, i) => (
              <Fragment key={stage.label}>
                {i > 0 && (
                  <ArrowRight
                    size={16}
                    style={{ color: "var(--text-muted)", flexShrink: 0, opacity: 0.3 }}
                  />
                )}
                <div style={{
                  flex: 1, textAlign: "center", padding: "16px 8px",
                  borderRadius: 10, background: "rgba(255,255,255,0.025)",
                  border: "1px solid var(--border-subtle)",
                }}>
                  <div style={{ marginBottom: 6, color: stage.color, opacity: 0.7 }}>
                    {stage.icon}
                  </div>
                  <div style={{
                    fontSize: 24, fontWeight: 700, color: stage.color,
                    letterSpacing: "-0.5px",
                  }}>
                    {fmtNumber(stage.value)}
                  </div>
                  <div style={{
                    fontSize: 10, color: "var(--text-muted)", fontWeight: 500,
                    marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px",
                  }}>
                    {stage.label}
                  </div>
                </div>
              </Fragment>
            ))}

            {/* Separator */}
            <div style={{
              width: 1, height: 52, background: "var(--border-subtle)",
              flexShrink: 0, margin: "0 6px",
            }} />

            {/* Outcome stages */}
            {[
              { label: "Losses", value: closerMetrics.losses, color: "var(--danger)", icon: <XCircle size={13} /> },
              { label: "No Shows", value: closerMetrics.noShows, color: "var(--danger)", icon: <AlertTriangle size={13} /> },
              { label: "Pending", value: closerMetrics.pcfus, color: "var(--warning)", icon: <Clock size={13} /> },
            ].map((stage) => (
              <div key={stage.label} style={{
                flex: 1, textAlign: "center", padding: "16px 8px",
                borderRadius: 10, background: "rgba(255,255,255,0.015)",
              }}>
                <div style={{ marginBottom: 6, color: stage.color, opacity: 0.5 }}>
                  {stage.icon}
                </div>
                <div style={{
                  fontSize: 22, fontWeight: 700, color: stage.color,
                  letterSpacing: "-0.5px",
                }}>
                  {fmtNumber(stage.value)}
                </div>
                <div style={{
                  fontSize: 10, color: "var(--text-muted)", fontWeight: 500,
                  marginTop: 4, textTransform: "uppercase", letterSpacing: "0.5px",
                }}>
                  {stage.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DM Metrics ───────────────────────────────────────────── */}
      <DashLabel icon={<MessageCircle size={12} />}>DM Performance</DashLabel>
      <div className="metric-grid metric-grid-4">
        {[
          { icon: <Users size={12} style={{ color: "var(--accent)" }} />, label: "New Leads", value: manychat.data?.newLeads },
          { icon: <MessageCircle size={12} style={{ color: "var(--accent)" }} />, label: "Engaged", value: manychat.data?.leadsEngaged },
          { icon: <Link2 size={12} style={{ color: "var(--accent)" }} />, label: "Call Links", value: manychat.data?.callLinksSent },
          { icon: <CreditCard size={12} style={{ color: "var(--accent)" }} />, label: "Sub Links", value: manychat.data?.subLinksSent },
        ].map((m) => (
          <div key={m.label} className="glass-static metric-card">
            <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {m.icon}
              {m.label}
            </div>
            {manychat.loading ? (
              <div style={{ paddingTop: 4 }}>
                <Loader2 size={16} className="spin" style={{ color: "var(--text-muted)" }} />
              </div>
            ) : manychat.error ? (
              <div style={{ fontSize: 12, color: "var(--danger)" }}>Error</div>
            ) : (
              <div className="metric-card-value">
                {m.value != null ? fmtNumber(m.value) : "—"}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Re-export sheet state for sibling components ─────────────────── */
export type { DataState };
