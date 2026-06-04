"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Loader2,
  PhoneCall,
  TrendingUp,
  Users,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, ManychatDashboard, ManychatMetrics } from "../types";

/* ── Types ────────────────────────────────────────────────────────── */

interface SetterPerformanceProps {
  filters: Filters;
}

interface SetterRow {
  name: string;
  client: string;
  newLeads: number;
  callsBooked: number;
  callsTaken: number;
  wins: number;
  noShows: number;
  cashCollected: number;
  subsSold: number;
}

interface SheetRow {
  setter: string;
  callTaken: boolean;
  callTakenStatus?: "yes" | "no" | "pending";
  outcome: string;
  cashCollected: number;
  offer: string;
  programLength: string;
}

interface SetterSummary {
  newLeads: number;
  callsBooked: number;
}

/* ── Client-to-setter mapping ─────────────────────────────────────── */

const CLIENT_SETTERS: Record<string, string[]> = {
  tyson: ["Amara", "Kelechi"],
  keith: ["Gideon"],
  lucy: ["Debbie"],
};

const SETTER_SHEET_KEYS: Record<string, string[]> = {
  Amara: ["AMARA"],
  Kelechi: ["KELCHI", "KELECHI"],
  Gideon: ["GIDEON"],
  Debbie: ["DEBBIE", "DEBBY", "CHIDIEBERE"],
};

const CLIENT_BADGE_LABELS: Record<string, string> = {
  tyson: "Tyson",
  keith: "Keith",
  lucy: "Lucy Hubbard",
};

function getRelevantSetters(client: string): { name: string; client: string }[] {
  if (client === "all") {
    return [
      ...CLIENT_SETTERS.tyson.map((n) => ({ name: n, client: "tyson" })),
      ...CLIENT_SETTERS.keith.map((n) => ({ name: n, client: "keith" })),
      ...CLIENT_SETTERS.lucy.map((n) => ({ name: n, client: "lucy" })),
    ];
  }
  return (CLIENT_SETTERS[client] || []).map((n) => ({ name: n, client }));
}

function rowMatchesClient(row: SheetRow, client: string): boolean {
  const offer = (row.offer || "").toLowerCase();
  if (client === "tyson") return offer.includes("tyson");
  if (client === "keith") return offer.includes("keith");
  if (client === "lucy") return offer.includes("lucy") || offer.includes("hubbard");
  return true;
}

function clientColor(client: string): string {
  if (client === "keith") return "var(--keith)";
  if (client === "lucy") return "var(--accent)";
  return "var(--tyson)";
}

function formatRate(numerator: number, denominator: number): string {
  if (denominator <= 0) return "—";
  return fmtPercent((numerator / denominator) * 100);
}

function rateColor(value: number, good: number, okay: number): string {
  if (value >= good) return "var(--success)";
  if (value >= okay) return "var(--warning)";
  return "var(--danger)";
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

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
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
            `/api/sales-hub/manychat-metrics?client=lucy&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          ),
        ]).then(([tyson, keith, lucy]) => ({ tyson, keith, lucy }));
      } else {
        manychatPromise = fetchJSON<ManychatMetrics>(
          `/api/sales-hub/manychat-metrics?client=${filters.client}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        ).then((data) => ({ [filters.client]: data }));
      }

      const [manychatData, sheetData] = await Promise.all([manychatPromise, sheetPromise]);
      setMetricsMap(manychatData);
      setSheetRows(sheetData.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.client, dateFrom, dateTo]);

  useEffect(() => {
    void Promise.resolve().then(fetchData);
  }, [fetchData]);

  const summary = useMemo((): SetterSummary => {
    const visibleClients = filters.client === "all" ? ["tyson", "keith", "lucy"] : [filters.client];
    const newLeads = visibleClients.reduce(
      (sum, client) => sum + (metricsMap[client]?.dashboard?.newLeads || 0),
      0,
    );
    const visibleRows = filters.client === "all"
      ? sheetRows
      : sheetRows.filter((row) => rowMatchesClient(row, filters.client));

    return {
      newLeads,
      callsBooked: visibleRows.length,
    };
  }, [filters.client, metricsMap, sheetRows]);

  const setterRows = useMemo((): SetterRow[] => {
    const relevant = getRelevantSetters(filters.client);

    return relevant.map(({ name, client }) => {
      const metrics = metricsMap[client];
      let mc: ManychatDashboard = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };

      if (metrics?.setters) {
        mc = metrics.setters[name] ||
          metrics.setters[name.toLowerCase()] ||
          Object.entries(metrics.setters).find(
            ([k]) => k.toLowerCase() === name.toLowerCase(),
          )?.[1] || mc;
      }

      const keys = SETTER_SHEET_KEYS[name] || [name.toUpperCase()];
      const setterSheetRows = sheetRows.filter((r) =>
        rowMatchesClient(r, client) &&
        keys.some((k) => (r.setter || "").toUpperCase().includes(k))
      );
      const callsBooked = setterSheetRows.length;
      const callsTaken = setterSheetRows.filter((r) => r.callTakenStatus === "yes" || r.callTaken).length;
      const wins = setterSheetRows.filter((r) => r.outcome === "WIN").length;
      const noShows = setterSheetRows.filter((r) => {
        const outcome = (r.outcome || "").toUpperCase();
        return r.callTakenStatus === "no" || outcome === "NS" || outcome === "NS/RS";
      }).length;
      const cashCollected = setterSheetRows.reduce((s, r) => s + (r.cashCollected || 0), 0);
      const subsSold = setterSheetRows.filter((r) =>
        r.outcome === "WIN" && r.programLength === "3"
      ).length;

      return {
        name,
        client,
        newLeads: mc.newLeads,
        callsBooked,
        callsTaken,
        wins,
        noShows,
        cashCollected,
        subsSold,
      };
    });
  }, [filters.client, metricsMap, sheetRows]);

  return (
    <div>
      <SetterPerformanceSummary summary={summary} loading={loading} error={error} />

      {loading ? (
        <LoadingCard />
      ) : error ? (
        <ErrorCard message={`Failed to load setter data: ${error}`} />
      ) : setterRows.length === 0 ? (
        <EmptyCard message="No setter data available for this period." />
      ) : (
        <SetterTable rows={setterRows} />
      )}
    </div>
  );
}

function SetterPerformanceSummary({
  summary,
  loading,
  error,
}: {
  summary: SetterSummary;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <div className="section" style={{ marginBottom: 20 }}>
        <h2 className="section-title">
          <TrendingUp size={16} />
          Setter Performance
        </h2>
        <LoadingCard />
      </div>
    );
  }

  if (error) {
    return (
      <div className="section" style={{ marginBottom: 20 }}>
        <h2 className="section-title">
          <TrendingUp size={16} />
          Setter Performance
        </h2>
        <ErrorCard message={`Failed to load setter performance: ${error}`} />
      </div>
    );
  }

  return (
    <div className="section" style={{ marginBottom: 20 }}>
      <h2 className="section-title">
        <TrendingUp size={16} />
        Setter Performance
      </h2>

      <div className="metric-grid metric-grid-3" style={{ marginBottom: 12 }}>
        <SummaryCard
          icon={<Users size={12} style={{ color: "var(--accent)" }} />}
          label="New Leads"
          value={fmtNumber(summary.newLeads)}
        />
        <SummaryCard
          icon={<PhoneCall size={12} style={{ color: "var(--accent)" }} />}
          label="Calls Booked"
          value={fmtNumber(summary.callsBooked)}
        />
        <SummaryCard
          icon={<TrendingUp size={12} style={{ color: "var(--success)" }} />}
          label="Booking Rate"
          value={formatRate(summary.callsBooked, summary.newLeads)}
          color="var(--success)"
        />
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label" style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icon}
        {label}
      </div>
      <div className="metric-card-value" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function SetterTable({ rows }: { rows: SetterRow[] }) {
  return (
    <div className="glass-static" style={{ overflow: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Setter</th>
            <th>Offer</th>
            <th>New Leads</th>
            <th>Booked</th>
            <th>Booking Rate</th>
            <th>Taken</th>
            <th>Wins</th>
            <th>No Shows</th>
            <th>Cash</th>
            <th>Subs</th>
            <th>Show Rate</th>
            <th>Close Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const showDenominator = s.callsTaken + s.noShows;
            const bookingRate = s.newLeads > 0 ? (s.callsBooked / s.newLeads) * 100 : 0;
            const showRate = showDenominator > 0 ? (s.callsTaken / showDenominator) * 100 : 0;
            const closeRate = s.callsTaken > 0 ? (s.wins / s.callsTaken) * 100 : 0;
            const cc = clientColor(s.client);

            return (
              <tr key={`${s.client}-${s.name}`}>
                <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  {s.name}
                </td>
                <td>
                  <span style={{ color: cc, fontWeight: 600 }}>
                    {CLIENT_BADGE_LABELS[s.client] ?? s.client}
                  </span>
                </td>
                <td>{fmtNumber(s.newLeads)}</td>
                <td>{fmtNumber(s.callsBooked)}</td>
                <td>
                  <span style={{ color: s.newLeads > 0 ? rateColor(bookingRate, 15, 8) : "var(--text-secondary)", fontWeight: 600 }}>
                    {formatRate(s.callsBooked, s.newLeads)}
                  </span>
                </td>
                <td>{fmtNumber(s.callsTaken)}</td>
                <td style={{ color: s.wins > 0 ? "var(--success)" : "var(--text-secondary)" }}>
                  {fmtNumber(s.wins)}
                </td>
                <td style={{ color: s.noShows > 0 ? "var(--danger)" : "var(--text-secondary)" }}>
                  {fmtNumber(s.noShows)}
                </td>
                <td style={{ color: "var(--success)", fontWeight: 600 }}>
                  {fmtDollars(s.cashCollected)}
                </td>
                <td style={{ color: s.subsSold > 0 ? "var(--accent)" : "var(--text-secondary)" }}>
                  {fmtNumber(s.subsSold)}
                </td>
                <td>
                  <span style={{ color: showDenominator > 0 ? rateColor(showRate, 65, 45) : "var(--text-secondary)", fontWeight: 600 }}>
                    {formatRate(s.callsTaken, showDenominator)}
                  </span>
                </td>
                <td>
                  <span style={{ color: s.callsTaken > 0 ? rateColor(closeRate, 40, 25) : "var(--text-secondary)", fontWeight: 600 }}>
                    {formatRate(s.wins, s.callsTaken)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="glass-static" style={{
      padding: 40, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div className="glass-static" style={{
      padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13,
    }}>
      {message}
    </div>
  );
}

function EmptyCard({ message }: { message: string }) {
  return (
    <div className="glass-static" style={{
      padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13,
    }}>
      {message}
    </div>
  );
}
