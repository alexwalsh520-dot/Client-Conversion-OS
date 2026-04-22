"use client";

import { useEffect, useState, useMemo, useCallback, type ReactNode } from "react";
import {
  Loader2,
  Users,
  MessageCircle,
  Link2,
  CreditCard,
  PhoneCall,
} from "lucide-react";
import { fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, ManychatMetrics, ManychatDashboard } from "../types";
import DMFunnels from "./DMFunnels";

/* ── Types ────────────────────────────────────────────────────────── */

interface SetterPerformanceProps {
  filters: Filters;
}

interface SetterRow {
  name: string;
  client: string;
  // Manychat metrics
  newLeads: number;
  leadsEngaged: number;
  callLinksSent: number;
  subLinksSent: number;
  // Sales tracker metrics
  callsBooked: number;
  callsTaken: number;
  wins: number;
  noShows: number;
  cashCollected: number;
  revenue: number;
  subsSold: number;
}

interface SheetRow {
  setter: string;
  callTaken: boolean;
  outcome: string;
  cashCollected: number;
  revenue: number;
  offer: string;
  method: string;
  programLength: string;
}

/* ── Client-to-setter mapping ─────────────────────────────────────── */

const CLIENT_SETTERS: Record<string, string[]> = {
  tyson: ["Amara"],
  keith: ["Gideon"],
  zoeEmily: ["Kelechi", "Debbie"],
};

const SETTER_SHEET_KEYS: Record<string, string[]> = {
  Amara: ["AMARA"],
  Kelechi: ["KELCHI", "KELECHI"],
  Gideon: ["GIDEON"],
  Debbie: ["DEBBIE"],
};

function getRelevantSetters(client: string): { name: string; client: string }[] {
  if (client === "all") {
    return [
      ...CLIENT_SETTERS.tyson.map((n) => ({ name: n, client: "tyson" })),
      ...CLIENT_SETTERS.keith.map((n) => ({ name: n, client: "keith" })),
      ...CLIENT_SETTERS.zoeEmily.map((n) => ({ name: n, client: "zoeEmily" })),
    ];
  }
  return (CLIENT_SETTERS[client] || []).map((n) => ({ name: n, client }));
}

/* ── Fetch helper ─────────────────────────────────────────────────── */

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
  return res.json();
}

/* ── Component ────────────────────────────────────────────────────── */

export default function SetterPerformance({ filters }: SetterPerformanceProps) {
  const { dateFrom, dateTo } = getEffectiveDates(filters);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [metricsMap, setMetricsMap] = useState<Record<string, ManychatMetrics>>({});
  const [sheetRows, setSheetRows] = useState<SheetRow[]>([]);

  /* ── Fetch data ─────────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Fetch Manychat metrics and sheet data in parallel
      const sheetPromise = fetchJSON<{ rows: SheetRow[] }>(
        `/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}`
      ).catch(() => ({ rows: [] }));

      let manychatPromise: Promise<Record<string, ManychatMetrics>>;
      if (filters.client === "all") {
        manychatPromise = Promise.all([
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=tyson&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=keith&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=zoeEmily&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
        ]).then(([tyson, keith, zoeEmily]) => ({ tyson, keith, zoeEmily }));
      } else {
        manychatPromise = fetchJSON<ManychatMetrics>(
          `/api/sales-hub/manychat-metrics?client=${filters.client}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        ).then((data) => ({ [filters.client]: data }));
      }

      const [manychatData, sheetData] = await Promise.all([manychatPromise, sheetPromise]);
      setMetricsMap(manychatData);
      setSheetRows(sheetData.rows || []);
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }, [filters.client, dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Aggregated DM dashboard across all visible clients ─────────── */
  const aggregatedDashboard = useMemo((): ManychatDashboard | null => {
    const keys = filters.client === "all" ? ["tyson", "keith", "zoeEmily"] : [filters.client];
    const dashboards = keys
      .map((k) => metricsMap[k]?.dashboard)
      .filter((d): d is ManychatDashboard => Boolean(d));
    if (dashboards.length === 0) return null;
    return dashboards.reduce(
      (sum, d) => ({
        newLeads: sum.newLeads + d.newLeads,
        leadsEngaged: sum.leadsEngaged + d.leadsEngaged,
        callLinksSent: sum.callLinksSent + d.callLinksSent,
        subLinksSent: sum.subLinksSent + d.subLinksSent,
      }),
      { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 },
    );
  }, [filters.client, metricsMap]);

  /* ── Build setter rows from metrics ─────────────────────────────── */
  const setterRows = useMemo((): SetterRow[] => {
    const relevant = getRelevantSetters(filters.client);

    return relevant.map(({ name, client }) => {
      // Manychat metrics
      const metrics = metricsMap[client];
      let mc: ManychatDashboard = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
      if (metrics?.setters) {
        mc = metrics.setters[name] ||
          metrics.setters[name.toLowerCase()] ||
          Object.entries(metrics.setters).find(
            ([k]) => k.toLowerCase() === name.toLowerCase(),
          )?.[1] || mc;
      }

      // Sales tracker metrics
      const keys = SETTER_SHEET_KEYS[name] || [name.toUpperCase()];
      const setterSheetRows = sheetRows.filter((r) =>
        keys.some((k) => (r.setter || "").toUpperCase().includes(k))
      );
      const callsBooked = setterSheetRows.length;
      const callsTaken = setterSheetRows.filter((r) => r.callTaken).length;
      const wins = setterSheetRows.filter((r) => r.outcome === "WIN").length;
      const noShows = setterSheetRows.filter((r) => ["NS/RS", "NS"].includes(r.outcome)).length;
      const cashCollected = setterSheetRows.reduce((s, r) => s + (r.cashCollected || 0), 0);
      const revenue = setterSheetRows.reduce((s, r) => s + (r.revenue || 0), 0);
      // Subscriptions: wins from this setter that are subscription-length programs (3 months)
      // or any win that isn't a one-time PIF — this is the best proxy from the data
      const subsSold = setterSheetRows.filter((r) =>
        r.outcome === "WIN" && r.programLength === "3"
      ).length;

      return {
        name, client,
        newLeads: mc.newLeads,
        leadsEngaged: mc.leadsEngaged,
        callLinksSent: mc.callLinksSent,
        subLinksSent: mc.subLinksSent,
        callsBooked, callsTaken, wins, noShows, cashCollected, revenue, subsSold,
      };
    });
  }, [filters.client, metricsMap, sheetRows]);

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div>
      {/* ── DM Metrics (aggregated) ─────────────────────────────── */}
      <div className="section" style={{ marginBottom: 20 }}>
        <h2 className="section-title">
          <MessageCircle size={16} />
          DM Metrics
        </h2>
        <div className="metric-grid metric-grid-4">
          {renderDmKpi(
            <Users size={12} style={{ color: "var(--accent)" }} />,
            "New Leads",
            aggregatedDashboard ? fmtNumber(aggregatedDashboard.newLeads) : "—",
            loading,
            error,
          )}
          {renderDmKpi(
            <MessageCircle size={12} style={{ color: "var(--accent)" }} />,
            "Leads Engaged",
            aggregatedDashboard ? fmtNumber(aggregatedDashboard.leadsEngaged) : "—",
            loading,
            error,
          )}
          {renderDmKpi(
            <Link2 size={12} style={{ color: "var(--accent)" }} />,
            "Call Links Sent",
            aggregatedDashboard ? fmtNumber(aggregatedDashboard.callLinksSent) : "—",
            loading,
            error,
          )}
          {renderDmKpi(
            <CreditCard size={12} style={{ color: "var(--accent)" }} />,
            "Sub Links Sent",
            aggregatedDashboard ? fmtNumber(aggregatedDashboard.subLinksSent) : "—",
            loading,
            error,
          )}
        </div>
        <div className="metric-grid metric-grid-3" style={{ marginTop: 12 }}>
          {renderDmKpi(
            <MessageCircle size={12} style={{ color: "var(--accent)" }} />,
            "Engagement Rate",
            aggregatedDashboard && aggregatedDashboard.newLeads > 0
              ? `${((aggregatedDashboard.leadsEngaged / aggregatedDashboard.newLeads) * 100).toFixed(1)}%`
              : "—",
            loading,
            error,
          )}
          {renderDmKpi(
            <PhoneCall size={12} style={{ color: "var(--accent)" }} />,
            "Booking Rate",
            aggregatedDashboard && aggregatedDashboard.newLeads > 0
              ? `${((aggregatedDashboard.callLinksSent / aggregatedDashboard.newLeads) * 100).toFixed(1)}%`
              : "—",
            loading,
            error,
          )}
          {renderDmKpi(
            <CreditCard size={12} style={{ color: "var(--accent)" }} />,
            "Subscription Rate",
            aggregatedDashboard && aggregatedDashboard.leadsEngaged > 0
              ? `${((aggregatedDashboard.subLinksSent / aggregatedDashboard.leadsEngaged) * 100).toFixed(1)}%`
              : "—",
            loading,
            error,
          )}
        </div>
        <DMFunnels
          selectedClient={filters.client}
          metricsMap={metricsMap}
          loading={loading}
          error={error}
        />
      </div>

      {/* ── Per-setter breakdown ─────────────────────────────────── */}
      {loading ? (
        <div className="glass-static" style={{
          padding: 40, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : error ? (
        <div className="glass-static" style={{
          padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13,
        }}>
          Failed to load setter data: {error}
        </div>
      ) : setterRows.length === 0 ? (
        <div className="glass-static" style={{
          padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13,
        }}>
          No setter data available for this period.
        </div>
      ) : (
        <SetterGrid rows={setterRows} />
      )}
    </div>
  );
}

function renderDmKpi(
  icon: ReactNode,
  label: string,
  value: string | number,
  loading: boolean,
  error: string,
) {
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
        <div className="metric-card-value">{value}</div>
      )}
    </div>
  );
}

function SetterGrid({ rows }: { rows: SetterRow[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
      {rows.map((s) => {
        const engagementRate = s.newLeads > 0 ? (s.leadsEngaged / s.newLeads) * 100 : 0;
        const bookingRate = s.newLeads > 0 ? (s.callsBooked / s.newLeads) * 100 : 0;
        const showRate = s.callsBooked > 0 ? (s.callsTaken / s.callsBooked) * 100 : 0;
        const closeRate = s.callsTaken > 0 ? (s.wins / s.callsTaken) * 100 : 0;
        const cc =
          s.client === "keith"
            ? "var(--keith)"
            : s.client === "zoeEmily"
              ? "var(--accent)"
              : "var(--tyson)";

        return (
          <div key={`${s.client}-${s.name}`} className="glass-static" style={{ padding: "20px 22px" }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 14,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: cc }} />
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                  {s.name}
                </span>
              </div>
              <span style={{
                fontSize: 11, color: cc, textTransform: "uppercase",
                fontWeight: 500, letterSpacing: "0.5px",
              }}>
                {s.client.charAt(0).toUpperCase() + s.client.slice(1)}
              </span>
            </div>

            {/* DM Metrics Row */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: "8px", marginBottom: 12,
            }}>
              {[
                { label: "New Leads", value: fmtNumber(s.newLeads) },
                { label: "Engaged", value: fmtNumber(s.leadsEngaged) },
                { label: "Call Links", value: fmtNumber(s.callLinksSent) },
                { label: "Sub Links", value: fmtNumber(s.subLinksSent) },
              ].map((m) => (
                <div key={m.label}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                    {m.value}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginTop: 1 }}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Sales Metrics Row */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: "8px", marginBottom: 12,
              padding: "10px 0", borderTop: "1px solid var(--border-subtle)",
            }}>
              {[
                { label: "Calls Booked", value: fmtNumber(s.callsBooked) },
                { label: "Calls Taken", value: fmtNumber(s.callsTaken) },
                { label: "Wins", value: fmtNumber(s.wins) },
                { label: "No Shows", value: fmtNumber(s.noShows), danger: s.noShows > 3 },
              ].map((m) => (
                <div key={m.label}>
                  <div style={{
                    fontSize: 18, fontWeight: 700,
                    color: m.danger ? "var(--danger)" : "var(--text-primary)",
                  }}>
                    {m.value}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginTop: 1 }}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Revenue Row */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
              gap: "8px", marginBottom: 12,
            }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--success)" }}>
                  ${s.cashCollected.toLocaleString()}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginTop: 1 }}>
                  Cash Collected
                </div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                  ${s.revenue.toLocaleString()}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginTop: 1 }}>
                  Revenue
                </div>
              </div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "var(--accent)" }}>
                  {fmtNumber(s.subsSold)}
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginTop: 1 }}>
                  Subs Sold
                </div>
              </div>
            </div>

            {/* Rates Row */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: "8px", padding: "10px 0 0",
              borderTop: "1px solid var(--border-subtle)",
            }}>
              {[
                { label: "Engagement", value: engagementRate, target: 50 },
                { label: "Booking Rate", value: bookingRate, target: 15 },
                { label: "Show Rate", value: showRate, target: 65 },
                { label: "Close Rate", value: closeRate, target: 40 },
              ].map((m) => (
                <div key={m.label}>
                  <div style={{
                    fontSize: 16, fontWeight: 700,
                    color: m.value >= m.target ? "var(--success)" : m.value >= m.target * 0.7 ? "var(--warning)" : "var(--danger)",
                  }}>
                    {m.value > 0 ? fmtPercent(m.value) : "—"}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginTop: 1 }}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
