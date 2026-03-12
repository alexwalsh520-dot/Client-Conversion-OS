"use client";

import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
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
  BarChart3,
  Clock,
  AlertTriangle,
  ShoppingCart,
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

interface ClientMetrics {
  label: string;
  callsBooked: number;
  callsTaken: number;
  showRate: number;
  wins: number;
  losses: number;
  closeRate: number;
  cashCollected: number;
  revenue: number;
  aov: number;
  pcfus: number;
  noShows: number;
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

/* ── Compute metrics from rows ────────────────────────────────────── */

function computeMetrics(rows: SheetRow[], label: string): ClientMetrics {
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

  return {
    label, callsBooked, callsTaken, showRate, wins, losses,
    closeRate, cashCollected, revenue, aov, pcfus, noShows,
  };
}

/* ── KPI card renderer ────────────────────────────────────────────── */

function renderKPICard(
  icon: ReactNode,
  label: string,
  value: string | number,
  loading: boolean,
  error: string,
  color?: string,
) {
  return (
    <div className="glass-static metric-card">
      <div
        className="metric-card-label"
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {icon}
        {label}
      </div>
      {loading ? (
        <div style={{ paddingTop: 4 }}>
          <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : error ? (
        <div style={{ fontSize: 12, color: "var(--danger)" }}>Error</div>
      ) : (
        <div className="metric-card-value" style={color ? { color } : undefined}>
          {value}
        </div>
      )}
    </div>
  );
}

/* ── Rate color helper ────────────────────────────────────────────── */

function rateColor(rate: number): string {
  return rate >= 70 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)";
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
  useEffect(() => {
    fetchManychat();
  }, [fetchManychat]);

  useEffect(() => {
    fetchSheet();
  }, [fetchSheet]);

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
      callsBooked,
      callsTaken,
      showRate,
      wins,
      losses,
      closeRate,
      cashCollected,
      aov,
      pcfus,
      noShows,
      revenue,
      subscriptionsSold,
    };
  }, [sheet.data]);

  /* ── Per-client metrics (when "All Clients") ────────────────────── */
  const clientBreakdown = useMemo(() => {
    if (!sheet.data || filters.client !== "all") return null;
    const rows = sheet.data.rows;

    const tysonRows = rows.filter((r) => r.offer?.toLowerCase().includes("tyson"));
    const keithRows = rows.filter((r) => r.offer?.toLowerCase().includes("keith"));

    return {
      tyson: computeMetrics(tysonRows, "Tyson"),
      keith: computeMetrics(keithRows, "Keith"),
    };
  }, [sheet.data, filters.client]);

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Per-Client Comparison (only when "All Clients") ─────────── */}
      {filters.client === "all" && clientBreakdown && !sheet.loading && !sheet.error && (
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "1px",
              color: "var(--text-muted)",
              fontWeight: 600,
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Users size={12} />
            Client Comparison
          </div>

          <div className="glass-static" style={{ overflow: "auto" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Cash</th>
                  <th>Revenue</th>
                  <th>AOV</th>
                  <th>Close Rate</th>
                  <th>Show Rate</th>
                  <th>Booked</th>
                  <th>Taken</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>No Shows</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {[clientBreakdown.tyson, clientBreakdown.keith].map((c) => (
                  <tr key={c.label}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {c.label}
                    </td>
                    <td style={{ color: "var(--success)", fontWeight: 600 }}>
                      {fmtDollars(c.cashCollected)}
                    </td>
                    <td style={{ color: "var(--success)" }}>
                      {fmtDollars(c.revenue)}
                    </td>
                    <td>{fmtDollars(c.aov)}</td>
                    <td>
                      <span style={{ color: rateColor(c.closeRate), fontWeight: 600 }}>
                        {fmtPercent(c.closeRate)}
                      </span>
                    </td>
                    <td>
                      <span style={{ color: rateColor(c.showRate), fontWeight: 600 }}>
                        {fmtPercent(c.showRate)}
                      </span>
                    </td>
                    <td>{fmtNumber(c.callsBooked)}</td>
                    <td>{fmtNumber(c.callsTaken)}</td>
                    <td style={{ color: "var(--success)" }}>{fmtNumber(c.wins)}</td>
                    <td style={{ color: "var(--danger)" }}>{fmtNumber(c.losses)}</td>
                    <td style={{ color: c.noShows > 0 ? "var(--danger)" : "var(--text-secondary)" }}>
                      {fmtNumber(c.noShows)}
                    </td>
                    <td style={{ color: "var(--warning)" }}>{fmtNumber(c.pcfus)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── DM Metrics ────────────────────────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <MessageCircle size={16} />
          DM Metrics
        </h2>
        <div className="metric-grid metric-grid-4">
          {renderKPICard(
            <Users size={12} style={{ color: "var(--accent)" }} />,
            "New Leads",
            manychat.data ? fmtNumber(manychat.data.newLeads) : "—",
            manychat.loading,
            manychat.error,
          )}
          {renderKPICard(
            <MessageCircle size={12} style={{ color: "var(--accent)" }} />,
            "Leads Engaged",
            manychat.data ? fmtNumber(manychat.data.leadsEngaged) : "—",
            manychat.loading,
            manychat.error,
          )}
          {renderKPICard(
            <Link2 size={12} style={{ color: "var(--accent)" }} />,
            "Call Links Sent",
            manychat.data ? fmtNumber(manychat.data.callLinksSent) : "—",
            manychat.loading,
            manychat.error,
          )}
          {renderKPICard(
            <CreditCard size={12} style={{ color: "var(--accent)" }} />,
            "Sub Links Sent",
            manychat.data ? fmtNumber(manychat.data.subLinksSent) : "—",
            manychat.loading,
            manychat.error,
          )}
        </div>
      </div>

      {/* ── Closer Metrics ────────────────────────────────────────────── */}
      <div className="section">
        <h2 className="section-title">
          <PhoneCall size={16} />
          Closer Metrics
        </h2>
        <div className="metric-grid metric-grid-4">
          {renderKPICard(
            <Banknote size={12} style={{ color: "var(--success)" }} />,
            "Cash Collected",
            closerMetrics ? fmtDollars(closerMetrics.cashCollected) : "—",
            sheet.loading,
            sheet.error,
            "var(--success)",
          )}
          {renderKPICard(
            <BarChart3 size={12} style={{ color: "var(--success)" }} />,
            "AOV",
            closerMetrics ? fmtDollars(closerMetrics.aov) : "—",
            sheet.loading,
            sheet.error,
            "var(--success)",
          )}
          {renderKPICard(
            <TrendingUp size={12} style={{ color: "var(--accent)" }} />,
            "Close Rate",
            closerMetrics ? fmtPercent(closerMetrics.closeRate) : "—",
            sheet.loading,
            sheet.error,
          )}
          {renderKPICard(
            <TrendingUp size={12} style={{ color: "var(--accent)" }} />,
            "Show Rate",
            closerMetrics ? fmtPercent(closerMetrics.showRate) : "—",
            sheet.loading,
            sheet.error,
          )}
        </div>

        <div className="metric-grid metric-grid-4" style={{ marginTop: 16 }}>
          {renderKPICard(
            <Phone size={12} style={{ color: "var(--accent)" }} />,
            "Calls Booked",
            closerMetrics ? fmtNumber(closerMetrics.callsBooked) : "—",
            sheet.loading,
            sheet.error,
          )}
          {renderKPICard(
            <PhoneCall size={12} style={{ color: "var(--accent)" }} />,
            "Calls Taken",
            closerMetrics ? fmtNumber(closerMetrics.callsTaken) : "—",
            sheet.loading,
            sheet.error,
          )}
          {renderKPICard(
            <Trophy size={12} style={{ color: "var(--success)" }} />,
            "Wins",
            closerMetrics ? fmtNumber(closerMetrics.wins) : "—",
            sheet.loading,
            sheet.error,
            "var(--success)",
          )}
          {renderKPICard(
            <XCircle size={12} style={{ color: "var(--danger)" }} />,
            "Losses",
            closerMetrics ? fmtNumber(closerMetrics.losses) : "—",
            sheet.loading,
            sheet.error,
            "var(--danger)",
          )}
        </div>

        <div className="metric-grid metric-grid-4" style={{ marginTop: 16 }}>
          {renderKPICard(
            <AlertTriangle size={12} style={{ color: "var(--danger)" }} />,
            "No Shows",
            closerMetrics ? fmtNumber(closerMetrics.noShows) : "—",
            sheet.loading,
            sheet.error,
            "var(--danger)",
          )}
          {renderKPICard(
            <Clock size={12} style={{ color: "var(--warning)" }} />,
            "Pending Follow-Ups",
            closerMetrics ? fmtNumber(closerMetrics.pcfus) : "—",
            sheet.loading,
            sheet.error,
            "var(--warning)",
          )}
          {renderKPICard(
            <ShoppingCart size={12} style={{ color: "var(--accent)" }} />,
            "Subscriptions Sold",
            closerMetrics ? fmtNumber(closerMetrics.subscriptionsSold) : "—",
            sheet.loading,
            sheet.error,
          )}
          {renderKPICard(
            <DollarSign size={12} style={{ color: "var(--success)" }} />,
            "Money",
            closerMetrics ? fmtDollars(closerMetrics.revenue) : "—",
            sheet.loading,
            sheet.error,
            "var(--success)",
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Re-export sheet state for sibling components ─────────────────── */
export type { DataState };
