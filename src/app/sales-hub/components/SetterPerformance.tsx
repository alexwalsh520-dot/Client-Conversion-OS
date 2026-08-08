"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Loader2,
  PhoneCall,
  TrendingUp,
  Users,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import HourlyStripTable, { type StripRow } from "./HourlyStripTable";
import type { Filters, ManychatMetrics } from "../types";
import { clientsFromRows, rowMatchesClientKey } from "./clientsFromRows";

/* ── Types ────────────────────────────────────────────────────────── */

interface SetterPerformanceProps {
  filters: Filters;
}

interface PerfCounts {
  newLeads: number;
  callsBooked: number;
  callsTaken: number;
  wins: number;
  noShows: number;
  cashCollected: number;
  subsSold: number;
}

// One offer a setter is active on (e.g. Tyson or Antwan).
interface SetterOfferRow extends PerfCounts {
  client: string;
  label: string;
}

// One setter, aggregated across their offers, with the per-offer breakdown.
interface SetterGroup extends PerfCounts {
  name: string;
  offers: SetterOfferRow[];
}

interface OfferRow {
  client: string;
  /** Display name straight from the tracker's Offer column. */
  label?: string;
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

interface LeadHourGroup {
  id: string;
  label: string;
  counts: number[];
}

interface LeadHours {
  hours: number[];
  team: LeadHourGroup;
  offers: LeadHourGroup[];
  setters: LeadHourGroup[];
}

function fmtHour(hour: number) {
  const period = hour < 12 ? "a" : "p";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${period}`;
}

const HOUR_LABELS_24 = Array.from({ length: 24 }, (_, i) => fmtHour(i));

// Primary view = % of that row's leads landing in each hour; secondary = raw counts.
function leadPctRow(group: LeadHourGroup): StripRow {
  const total = group.counts.reduce((a, b) => a + b, 0);
  return {
    id: group.id,
    label: group.label,
    cells: group.counts.map((count, hour) => ({
      value: count > 0 && total > 0 ? `${Math.round((count / total) * 100)}%` : null,
      tooltip: `${fmtHour(hour)} — ${count} of ${total} leads (${total > 0 ? ((count / total) * 100).toFixed(1) : "0"}%)`,
    })),
  };
}

function leadCountRow(group: LeadHourGroup): StripRow {
  const total = group.counts.reduce((a, b) => a + b, 0);
  return {
    id: group.id,
    label: group.label,
    cells: group.counts.map((count, hour) => ({
      value: count > 0 ? String(count) : null,
      tooltip: `${fmtHour(hour)} — ${count} of ${total} leads`,
    })),
  };
}

/* ── Client-to-setter mapping ─────────────────────────────────────── */

// Clients are DERIVED from the tracker rows in the selected timeline (see
// clientsFromRows) — no hardcoded roster. The maps below only enrich clients
// we know well; unknown clients still work from the sheet alone.

// Roster seed per derived client key; actual setters are also derived from
// the ManyChat metrics AND the sheet's Setter column, so new setters appear
// automatically.
const CLIENT_SETTERS: Record<string, string[]> = {
  tyson: ["Amara", "Kelechi", "Debbie", "Gideon", "Erin"],
};

const SETTER_SHEET_KEYS: Record<string, string[]> = {
  Amara: ["AMARA"],
  Kelechi: ["KELCHI", "KELECHI"],
  Gideon: ["GIDEON"],
  Debbie: ["DEBBIE", "DEBBY", "CHIDIEBERE"],
  Erin: ["ERIN"],
};

function clientColor(client: string): string {
  return client === "tyson" ? "var(--tyson)" : "var(--accent)";
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

function buildPerformanceRow(client: string, newLeads: number, rows: SheetRow[]) {
  const callsBooked = rows.length;
  // Cash collected means the call happened and closed — count it as taken even
  // if the Call Taken column still says No.
  const isTaken = (r: SheetRow) => r.callTakenStatus === "yes" || r.callTaken || r.cashCollected > 0;
  const callsTaken = rows.filter(isTaken).length;
  const wins = rows.filter((r) => r.outcome === "WIN").length;
  const noShows = rows.filter((r) => {
    const outcome = (r.outcome || "").toUpperCase();
    return (r.callTakenStatus === "no" || outcome === "NS" || outcome === "NS/RS") && !isTaken(r);
  }).length;
  const cashCollected = rows.reduce((s, r) => s + (r.cashCollected || 0), 0);
  const subsSold = rows.filter((r) =>
    r.outcome === "WIN" && r.programLength === "3"
  ).length;

  return {
    client,
    newLeads,
    callsBooked,
    callsTaken,
    wins,
    noShows,
    cashCollected,
    subsSold,
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
  const [leadHours, setLeadHours] = useState<LeadHours | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const leadHoursPromise = fetchJSON<LeadHours>(
        `/api/sales-hub/leads-by-hour?client=${filters.client}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ).catch(() => null);

      // Sheet first: the tracker rows decide WHICH clients exist in this
      // timeline. Then pull ManyChat metrics for exactly those clients —
      // clients without a DM pipeline just resolve to nothing.
      const sheetData = await fetchJSON<{ rows: SheetRow[] }>(
        `/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}`
      ).catch(() => ({ rows: [] as SheetRow[] }));
      const rows = sheetData.rows || [];

      const derivedKeys = clientsFromRows(rows)
        .map((c) => c.key)
        .filter((key) => filters.client === "all" || key === filters.client);

      const entries = await Promise.all(
        derivedKeys.map((client) =>
          fetchJSON<ManychatMetrics>(
            `/api/sales-hub/manychat-metrics?client=${encodeURIComponent(client)}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
          )
            .then((data) => [client, data] as const)
            .catch(() => null),
        ),
      );
      const manychatData: Record<string, ManychatMetrics> = {};
      for (const entry of entries) if (entry) manychatData[entry[0]] = entry[1];

      setMetricsMap(manychatData);
      setSheetRows(rows);
      setLeadHours(await leadHoursPromise);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filters.client, dateFrom, dateTo]);

  useEffect(() => {
    void Promise.resolve().then(fetchData);
  }, [fetchData]);

  // Clients present in the tracker for this timeline — the sheet is the
  // source of truth, so the offer/setter breakdowns follow the date range.
  const visibleClients = useMemo(() => {
    const derived = clientsFromRows(sheetRows);
    return filters.client === "all"
      ? derived
      : derived.filter((c) => c.key === filters.client);
  }, [filters.client, sheetRows]);

  const summary = useMemo((): SetterSummary => {
    const newLeads = visibleClients.reduce(
      (sum, client) => sum + (metricsMap[client.key]?.dashboard?.newLeads || 0),
      0,
    );
    // Rows attributed to a visible client (blank-offer rows are excluded).
    const visibleRows = sheetRows.filter((row) =>
      visibleClients.some((client) => rowMatchesClientKey(row, client.key)),
    );

    return {
      newLeads,
      callsBooked: visibleRows.length,
    };
  }, [visibleClients, metricsMap, sheetRows]);

  const offerRows = useMemo((): OfferRow[] => {
    return visibleClients.map((client) => {
      const rows = sheetRows.filter((row) => rowMatchesClientKey(row, client.key));
      const newLeads = metricsMap[client.key]?.dashboard?.newLeads || 0;
      return { ...buildPerformanceRow(client.key, newLeads, rows), label: client.name };
    });
  }, [visibleClients, metricsMap, sheetRows]);

  // One group per setter, each with a per-offer breakdown underneath. The setter
  // universe is the roster seed PLUS whoever appears in the ManyChat metrics
  // PLUS whoever appears in the sheet's Setter column — so new setters (and new
  // clients' setters) show up on their own.
  const setterGroups = useMemo((): SetterGroup[] => {
    const clients = visibleClients;

    const names = new Map<string, string>(); // lowercased -> display name
    const addName = (raw: string) => {
      const trimmed = raw.trim();
      const lc = trimmed.toLowerCase();
      if (!lc || names.has(lc)) return;
      names.set(lc, trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase());
    };
    for (const client of clients) {
      for (const n of CLIENT_SETTERS[client.key] || []) names.set(n.toLowerCase(), n);
      for (const key of Object.keys(metricsMap[client.key]?.setters || {})) addName(key);
    }
    // Setters straight from the tracker rows (source of truth) — covers
    // clients that have no ManyChat pipeline wired up yet.
    for (const row of sheetRows) {
      const setter = (row.setter || "").trim();
      if (!setter) continue;
      if (clients.some((client) => rowMatchesClientKey(row, client.key))) addName(setter);
    }

    const setterNewLeads = (client: string, name: string): number => {
      const setters = metricsMap[client]?.setters;
      if (!setters) return 0;
      const entry =
        setters[name] ||
        setters[name.toLowerCase()] ||
        Object.entries(setters).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
      return entry?.newLeads || 0;
    };

    const groups: SetterGroup[] = [];
    for (const name of names.values()) {
      const keys = SETTER_SHEET_KEYS[name] || [name.toUpperCase()];
      const offers: SetterOfferRow[] = [];
      for (const client of clients) {
        const setterSheetRows = sheetRows.filter(
          (r) =>
            rowMatchesClientKey(r, client.key) &&
            keys.some((k) => (r.setter || "").toUpperCase().includes(k)),
        );
        const perf = buildPerformanceRow(client.key, setterNewLeads(client.key, name), setterSheetRows);
        // Only list an offer the setter is actually active on.
        if (perf.newLeads > 0 || perf.callsBooked > 0) {
          offers.push({ ...perf, label: client.name });
        }
      }
      if (offers.length === 0) continue;
      const agg = offers.reduce<PerfCounts>(
        (a, o) => ({
          newLeads: a.newLeads + o.newLeads,
          callsBooked: a.callsBooked + o.callsBooked,
          callsTaken: a.callsTaken + o.callsTaken,
          wins: a.wins + o.wins,
          noShows: a.noShows + o.noShows,
          cashCollected: a.cashCollected + o.cashCollected,
          subsSold: a.subsSold + o.subsSold,
        }),
        { newLeads: 0, callsBooked: 0, callsTaken: 0, wins: 0, noShows: 0, cashCollected: 0, subsSold: 0 },
      );
      groups.push({ name, offers, ...agg });
    }
    return groups.sort((a, b) => b.newLeads - a.newLeads);
  }, [visibleClients, metricsMap, sheetRows]);

  return (
    <div>
      <SetterPerformanceSummary
        summary={summary}
        loading={loading}
        error={error}
        extra={
          leadHours ? (
            <HourlyStripTable
              title="New leads by hour (ET)"
              hourLabels={HOUR_LABELS_24}
              rows={[leadCountRow(leadHours.team)]}
              secondaryRows={[leadPctRow(leadHours.team)]}
              toggleLabels={["#", "%"]}
              collapsible
            />
          ) : null
        }
      />

      {loading ? (
        <LoadingCard />
      ) : error ? (
        <ErrorCard message={`Failed to load setter data: ${error}`} />
      ) : setterGroups.length === 0 ? (
        <EmptyCard message="No setter data available for this period." />
      ) : (
        <>
          <OfferTable rows={offerRows} />
          {leadHours && leadHours.offers.length > 0 && (
            <div style={{ marginTop: -12, marginBottom: 20 }}>
              <HourlyStripTable
                title="New leads by hour (ET)"
                hourLabels={HOUR_LABELS_24}
                rows={leadHours.offers.map(leadCountRow)}
                secondaryRows={leadHours.offers.map(leadPctRow)}
                toggleLabels={["#", "%"]}
                collapsible
              />
            </div>
          )}
          <SetterTable groups={setterGroups} />
          {leadHours && leadHours.setters.length > 0 && (
            <div style={{ marginTop: -12, marginBottom: 20 }}>
              <HourlyStripTable
                title="New leads by hour (ET)"
                hourLabels={HOUR_LABELS_24}
                rows={leadHours.setters.map(leadCountRow)}
                secondaryRows={leadHours.setters.map(leadPctRow)}
                toggleLabels={["#", "%"]}
                collapsible
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SetterPerformanceSummary({
  summary,
  loading,
  error,
  extra,
}: {
  summary: SetterSummary;
  loading: boolean;
  error: string;
  extra?: ReactNode;
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

      {extra}
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

function SetterTable({ groups }: { groups: SetterGroup[] }) {
  return (
    <PerformanceTable
      title="Setter Breakdown"
      firstColumnLabel="Setter"
      rows={groups.map((g) => ({
        label: g.name,
        key: g.name,
        newLeads: g.newLeads,
        callsBooked: g.callsBooked,
        callsTaken: g.callsTaken,
        wins: g.wins,
        noShows: g.noShows,
        cashCollected: g.cashCollected,
        subsSold: g.subsSold,
        // Drill-down only when the setter works more than one offer.
        subRows:
          g.offers.length > 1
            ? g.offers.map((o) => ({
                label: o.label,
                key: `${g.name}-${o.client}`,
                client: o.client,
                newLeads: o.newLeads,
                callsBooked: o.callsBooked,
                callsTaken: o.callsTaken,
                wins: o.wins,
                noShows: o.noShows,
                cashCollected: o.cashCollected,
                subsSold: o.subsSold,
              }))
            : undefined,
      }))}
    />
  );
}

function OfferTable({ rows }: { rows: OfferRow[] }) {
  return (
    <PerformanceTable
      title="Offer Breakdown"
      firstColumnLabel="Offer"
      rows={rows.map((row) => ({
        label: row.label ?? row.client,
        key: row.client,
        newLeads: row.newLeads,
        callsBooked: row.callsBooked,
        callsTaken: row.callsTaken,
        wins: row.wins,
        noShows: row.noShows,
        cashCollected: row.cashCollected,
        subsSold: row.subsSold,
      }))}
    />
  );
}

interface TableRow extends PerfCounts {
  label: string;
  key: string;
  subRows?: Array<PerfCounts & { label: string; client: string; key: string }>;
}

// The 10 metric <td>s, shared by a setter row and its per-offer sub-rows.
function MetricCells({ s }: { s: PerfCounts }) {
  const showDenominator = s.callsTaken + s.noShows;
  const bookingRate = s.newLeads > 0 ? (s.callsBooked / s.newLeads) * 100 : 0;
  const showRate = showDenominator > 0 ? (s.callsTaken / showDenominator) * 100 : 0;
  const closeRate = s.callsTaken > 0 ? (s.wins / s.callsTaken) * 100 : 0;
  return (
    <>
      <td>{fmtNumber(s.newLeads)}</td>
      <td>{fmtNumber(s.callsBooked)}</td>
      <td>
        <span style={{ color: s.newLeads > 0 ? rateColor(bookingRate, 15, 8) : "var(--text-secondary)", fontWeight: 600 }}>
          {formatRate(s.callsBooked, s.newLeads)}
        </span>
      </td>
      <td>{fmtNumber(s.callsTaken)}</td>
      <td style={{ color: s.wins > 0 ? "var(--success)" : "var(--text-secondary)" }}>{fmtNumber(s.wins)}</td>
      <td style={{ color: s.noShows > 0 ? "var(--danger)" : "var(--text-secondary)" }}>{fmtNumber(s.noShows)}</td>
      <td style={{ color: "var(--success)", fontWeight: 600 }}>{fmtDollars(s.cashCollected)}</td>
      <td style={{ color: s.subsSold > 0 ? "var(--accent)" : "var(--text-secondary)" }}>{fmtNumber(s.subsSold)}</td>
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
    </>
  );
}

function PerformanceTable({
  title,
  firstColumnLabel,
  rows,
}: {
  title: string;
  firstColumnLabel: string;
  rows: TableRow[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "1px",
          color: "var(--text-muted)",
          fontWeight: 600,
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div className="glass-static" style={{ overflow: "auto" }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>{firstColumnLabel}</th>
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
          {rows.map((row) => {
            const canExpand = !!row.subRows && row.subRows.length > 1;
            const isOpen = expanded.has(row.key);
            return (
              <Fragment key={row.key}>
                <tr
                  onClick={canExpand ? () => toggle(row.key) : undefined}
                  style={canExpand ? { cursor: "pointer" } : undefined}
                >
                  <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                    {canExpand && (
                      <span style={{ display: "inline-block", width: 12, color: "var(--text-muted)" }}>
                        {isOpen ? "▾" : "▸"}
                      </span>
                    )}
                    {row.label}
                  </td>
                  <MetricCells s={row} />
                </tr>
                {canExpand && isOpen &&
                  row.subRows!.map((sub) => (
                    <tr key={sub.key} style={{ background: "rgba(127,127,127,0.06)" }}>
                      <td style={{ paddingLeft: 28, fontSize: 12 }}>
                        <span style={{ color: clientColor(sub.client), fontWeight: 600 }}>{sub.label}</span>
                      </td>
                      <MetricCells s={sub} />
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
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
