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
import type { Filters, LeadSourceMetric, ManychatDashboard, ManychatMetrics } from "../types";

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

interface SourceTotals {
  newLeads: number;
  callsBooked: number;
  callsTaken: number;
  wins: number;
  noShows: number;
  cashCollected: number;
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

const LEAD_SOURCE_LABELS: Record<LeadSourceMetric["id"], string> = {
  direct_cta_ad: "Direct CTA ad",
  lead_magnet_ad: "Lead magnet ad",
  direct_coaching_organic_cta: "Direct coaching organic CTA",
  organic_lead_magnet: "Organic lead magnet",
  unmapped: "Unmapped",
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

function sourceShowDenominator(row: SourceTotals | LeadSourceMetric): number {
  return row.callsTaken + row.noShows;
}

function emptyTotals(): SourceTotals {
  return {
    newLeads: 0,
    callsBooked: 0,
    callsTaken: 0,
    wins: 0,
    noShows: 0,
    cashCollected: 0,
  };
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

  const sourceRows = useMemo((): LeadSourceMetric[] => {
    const visibleClients = filters.client === "all" ? ["tyson", "keith", "lucy"] : [filters.client];
    const bySource = new Map<LeadSourceMetric["id"], LeadSourceMetric>();

    for (const client of visibleClients) {
      for (const row of metricsMap[client]?.leadSources || []) {
        const existing = bySource.get(row.id) || {
          id: row.id,
          label: LEAD_SOURCE_LABELS[row.id] || row.label,
          newLeads: 0,
          callsBooked: 0,
          callsTaken: 0,
          wins: 0,
          noShows: 0,
          cashCollected: 0,
        };

        existing.newLeads += row.newLeads;
        existing.callsBooked += row.callsBooked;
        existing.callsTaken += row.callsTaken;
        existing.wins += row.wins;
        existing.noShows += row.noShows;
        existing.cashCollected += row.cashCollected;
        bySource.set(row.id, existing);
      }
    }

    return (Object.keys(LEAD_SOURCE_LABELS) as LeadSourceMetric["id"][])
      .map((id) => bySource.get(id) || {
        id,
        label: LEAD_SOURCE_LABELS[id],
        newLeads: 0,
        callsBooked: 0,
        callsTaken: 0,
        wins: 0,
        noShows: 0,
        cashCollected: 0,
      })
      .filter((row) => row.id !== "unmapped" || row.newLeads > 0 || row.callsBooked > 0);
  }, [filters.client, metricsMap]);

  const sourceTotals = useMemo(() => {
    return sourceRows.reduce((sum, row) => {
      sum.newLeads += row.newLeads;
      sum.callsBooked += row.callsBooked;
      sum.callsTaken += row.callsTaken;
      sum.wins += row.wins;
      sum.noShows += row.noShows;
      sum.cashCollected += row.cashCollected;
      return sum;
    }, emptyTotals());
  }, [sourceRows]);

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
      <LeadSourcePerformance
        rows={sourceRows}
        totals={sourceTotals}
        loading={loading}
        error={error}
      />

      {loading ? (
        <LoadingCard />
      ) : error ? (
        <ErrorCard message={`Failed to load setter data: ${error}`} />
      ) : setterRows.length === 0 ? (
        <EmptyCard message="No setter data available for this period." />
      ) : (
        <SetterGrid rows={setterRows} />
      )}
    </div>
  );
}

function LeadSourcePerformance({
  rows,
  totals,
  loading,
  error,
}: {
  rows: LeadSourceMetric[];
  totals: SourceTotals;
  loading: boolean;
  error: string;
}) {
  if (loading) {
    return (
      <div className="section" style={{ marginBottom: 20 }}>
        <h2 className="section-title">
          <TrendingUp size={16} />
          Lead Source Performance
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
          Lead Source Performance
        </h2>
        <ErrorCard message={`Failed to load lead source data: ${error}`} />
      </div>
    );
  }

  return (
    <div className="section" style={{ marginBottom: 20 }}>
      <h2 className="section-title">
        <TrendingUp size={16} />
        Lead Source Performance
      </h2>

      <div className="metric-grid metric-grid-3" style={{ marginBottom: 12 }}>
        <SummaryCard
          icon={<Users size={12} style={{ color: "var(--accent)" }} />}
          label="New Leads"
          value={fmtNumber(totals.newLeads)}
        />
        <SummaryCard
          icon={<PhoneCall size={12} style={{ color: "var(--accent)" }} />}
          label="Calls Booked"
          value={fmtNumber(totals.callsBooked)}
        />
        <SummaryCard
          icon={<TrendingUp size={12} style={{ color: "var(--success)" }} />}
          label="Booking Rate"
          value={formatRate(totals.callsBooked, totals.newLeads)}
          color="var(--success)"
        />
      </div>

      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>New Leads</th>
              <th>Booked</th>
              <th>Booking Rate</th>
              <th>Taken</th>
              <th>Wins</th>
              <th>Show Rate</th>
              <th>Close Rate</th>
              <th>AOV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td style={{ fontWeight: 600, color: row.id === "unmapped" ? "var(--warning)" : "var(--text-primary)" }}>
                  {row.label}
                </td>
                <td>{fmtNumber(row.newLeads)}</td>
                <td>{fmtNumber(row.callsBooked)}</td>
                <td>{formatRate(row.callsBooked, row.newLeads)}</td>
                <td>{fmtNumber(row.callsTaken)}</td>
                <td style={{ color: row.wins > 0 ? "var(--success)" : "var(--text-primary)" }}>
                  {fmtNumber(row.wins)}
                </td>
                <td>{formatRate(row.callsTaken, sourceShowDenominator(row))}</td>
                <td>{formatRate(row.wins, row.callsTaken)}</td>
                <td>{row.wins > 0 ? fmtDollars(row.cashCollected / row.wins) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

function SetterGrid({ rows }: { rows: SetterRow[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
      {rows.map((s) => {
        const showDenominator = s.callsTaken + s.noShows;
        const cc = clientColor(s.client);

        return (
          <div key={`${s.client}-${s.name}`} className="glass-static" style={{ padding: "20px 22px" }}>
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
                {CLIENT_BADGE_LABELS[s.client] ?? s.client}
              </span>
            </div>

            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(86px, 1fr))",
              gap: "12px 10px",
            }}>
              <SetterMetric label="New Leads" value={fmtNumber(s.newLeads)} />
              <SetterMetric label="Calls Booked" value={fmtNumber(s.callsBooked)} />
              <SetterMetric label="Calls Taken" value={fmtNumber(s.callsTaken)} />
              <SetterMetric label="Wins" value={fmtNumber(s.wins)} color={s.wins > 0 ? "var(--success)" : undefined} />
              <SetterMetric label="No Shows" value={fmtNumber(s.noShows)} color={s.noShows > 0 ? "var(--danger)" : undefined} />
              <SetterMetric label="Cash Collected" value={fmtDollars(s.cashCollected)} color="var(--success)" />
              <SetterMetric label="Subs Sold" value={fmtNumber(s.subsSold)} color="var(--accent)" />
              <SetterMetric label="Booking Rate" value={formatRate(s.callsBooked, s.newLeads)} />
              <SetterMetric label="Show Rate" value={formatRate(s.callsTaken, showDenominator)} />
              <SetterMetric label="Close Rate" value={formatRate(s.wins, s.callsTaken)} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SetterMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "var(--text-primary)" }}>
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500, marginTop: 1 }}>
        {label}
      </div>
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
