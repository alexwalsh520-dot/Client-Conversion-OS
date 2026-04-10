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
  Banknote,
  BarChart3,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, SheetRow, ManychatMetrics, ManychatDashboard } from "../types";

/* ── Types ────────────────────────────────────────────────────────── */

interface SheetApiResponse {
  rows: SheetRow[];
  subscriptionsSold: number;
  unattributedRows: number;
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
  pending: number;
  showRate: number;
  wins: number;
  losses: number;
  closeRate: number;
  cashCollected: number;
  aov: number;
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
  const takenRows = rows.filter((r) => r.callTakenStatus === "yes");
  const callsTaken = takenRows.length;
  const noShows = rows.filter((r) => r.callTakenStatus === "no").length;
  const pending = rows.filter((r) => r.callTakenStatus === "pending").length;
  const showDenominator = callsTaken + noShows;
  const showRate = showDenominator > 0 ? (callsTaken / showDenominator) * 100 : 0;

  const winRows = takenRows.filter((r) => r.outcome === "WIN");
  const wins = winRows.length;
  const losses = takenRows.filter((r) => r.outcome !== "WIN").length;
  const closeRate = callsTaken > 0 ? (wins / callsTaken) * 100 : 0;

  const cashCollected = winRows.reduce((sum, r) => sum + r.cashCollected, 0);
  const aov = wins > 0 ? cashCollected / wins : 0;

  return {
    label, callsBooked, callsTaken, showRate, wins, losses,
    closeRate, cashCollected, aov, pending,
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

  const [sheet, setSheet] = useState<DataState<SheetApiResponse>>({
    data: null,
    loading: true,
    error: "",
  });

  /* ── Fetch Manychat ─────────────────────────────────────────────── */
  const fetchManychat = useCallback(async () => {
    setManychat({ data: null, loading: true, error: "" });
    try {
      if (filters.client === "all") {
        const [tyson, keith, zoeEmily] = await Promise.all([
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=tyson&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=keith&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=zoeEmily&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
        ]);
        setManychat({
          data: sumDashboards(sumDashboards(tyson.dashboard, keith.dashboard), zoeEmily.dashboard),
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
      const clientNames: Record<string, string> = { tyson: "Tyson Sonnek", keith: "Keith Holland", zoeEmily: "Zoe and Emily" };
      const clientParam =
        filters.client !== "all" && clientNames[filters.client]
          ? `&client=${encodeURIComponent(clientNames[filters.client])}`
          : "";
      const res = await fetchJSON<SheetApiResponse>(
        `/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}${clientParam}`,
      );
      setSheet({ data: res, loading: false, error: "" });
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
    const takenRows = rows.filter((r) => r.callTakenStatus === "yes");
    const callsTaken = takenRows.length;
    const noShows = rows.filter((r) => r.callTakenStatus === "no").length;
    const pending = rows.filter((r) => r.callTakenStatus === "pending").length;
    const showDenominator = callsTaken + noShows;
    const showRate = showDenominator > 0 ? (callsTaken / showDenominator) * 100 : 0;

    const winRows = takenRows.filter((r) => r.outcome === "WIN");
    const wins = winRows.length;
    const losses = takenRows.filter((r) => r.outcome !== "WIN").length;
    const closeRate = callsTaken > 0 ? (wins / callsTaken) * 100 : 0;

    const cashCollected = winRows.reduce((sum, r) => sum + r.cashCollected, 0);
    const aov = wins > 0 ? cashCollected / wins : 0;

    return {
      callsBooked,
      callsTaken,
      showRate,
      wins,
      losses,
      closeRate,
      cashCollected,
      aov,
      noShows,
      pending,
    };
  }, [sheet.data]);

  /* ── Per-client metrics (when "All Clients") ────────────────────── */
  const clientBreakdown = useMemo(() => {
    if (!sheet.data || filters.client !== "all") return null;
    const rows = sheet.data.rows;

    const tysonRows = rows.filter((r) => {
      const offer = r.offer?.toLowerCase() || "";
      return offer.includes("tyson") || offer.includes("sonic");
    });
    const keithRows = rows.filter((r) => r.offer?.toLowerCase().includes("keith"));
    const zoeEmilyRows = rows.filter((r) => {
      const offer = r.offer?.toLowerCase() || "";
      return offer.includes("zoe") || offer.includes("emily");
    });

    return {
      tyson: computeMetrics(tysonRows, "Tyson Sonnek"),
      keith: computeMetrics(keithRows, "Keith Holland"),
      zoeEmily: computeMetrics(zoeEmilyRows, "Zoe and Emily"),
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
                  <th>Cash on Calls</th>
                  <th>AOV</th>
                  <th>Close Rate</th>
                  <th>Show Rate</th>
                  <th>Booked</th>
                  <th>Taken</th>
                  <th>Wins</th>
                  <th>Losses</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {[clientBreakdown.tyson, clientBreakdown.keith, clientBreakdown.zoeEmily].map((c) => (
                  <tr key={c.label}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {c.label}
                    </td>
                    <td style={{ color: "var(--success)", fontWeight: 600 }}>
                      {fmtDollars(c.cashCollected)}
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
                    <td style={{ color: c.pending > 0 ? "var(--warning)" : "var(--text-secondary)" }}>
                      {fmtNumber(c.pending)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sheet.data?.unattributedRows ? (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                color: "var(--warning)",
              }}
            >
              {fmtNumber(sheet.data.unattributedRows)} calls in this range do not have a client offer on the source sheet and are excluded from the per-client comparison.
            </div>
          ) : null}
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
        <div className="metric-grid metric-grid-3" style={{ marginTop: 12 }}>
          {renderKPICard(
            <MessageCircle size={12} style={{ color: "var(--accent)" }} />,
            "Engagement Rate",
            manychat.data && manychat.data.newLeads > 0
              ? `${((manychat.data.leadsEngaged / manychat.data.newLeads) * 100).toFixed(1)}%`
              : "—",
            manychat.loading,
            manychat.error,
          )}
          {renderKPICard(
            <PhoneCall size={12} style={{ color: "var(--accent)" }} />,
            "Booking Rate",
            manychat.data && manychat.data.newLeads > 0
              ? `${((manychat.data.callLinksSent / manychat.data.newLeads) * 100).toFixed(1)}%`
              : "—",
            manychat.loading,
            manychat.error,
          )}
          {renderKPICard(
            <CreditCard size={12} style={{ color: "var(--accent)" }} />,
            "Subscription Rate",
            manychat.data && manychat.data.leadsEngaged > 0
              ? `${((manychat.data.subLinksSent / manychat.data.leadsEngaged) * 100).toFixed(1)}%`
              : "—",
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
        {sheet.data?.unattributedRows ? (
          <div
            className="glass-static"
            style={{
              marginBottom: 12,
              padding: "10px 12px",
              fontSize: 12,
              color: "var(--warning)",
            }}
          >
            {fmtNumber(sheet.data.unattributedRows)} calls in this date range are missing a client offer on the source sheet. Overall totals include them, but client-level splits only include attributed rows.
          </div>
        ) : null}
        <div className="metric-grid metric-grid-4">
          {renderKPICard(
            <Banknote size={12} style={{ color: "var(--success)" }} />,
            "Cash on Calls",
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
      </div>
    </div>
  );
}

/* ── Re-export sheet state for sibling components ─────────────────── */
export type { DataState };
