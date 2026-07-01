"use client";

import { Fragment, useEffect, useState, useMemo, useCallback } from "react";
import { Users } from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, SheetRow } from "../types";
import { CALL_CATEGORIES, rowsForCategory } from "./callType";

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

const AUTO_REFRESH_MS = 30_000;

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

/* ── Compute metrics from rows ────────────────────────────────────── */

// Cash collected on a row means the call happened and closed — so treat it as
// "taken" even if the Call Taken column still says No (it was just never updated).
function isTaken(r: SheetRow): boolean {
  return r.callTakenStatus === "yes" || r.cashCollected > 0;
}

function computeMetrics(rows: SheetRow[], label: string): ClientMetrics {
  const callsBooked = rows.length;
  const takenRows = rows.filter(isTaken);
  const callsTaken = takenRows.length;
  const noShows = rows.filter((r) => r.callTakenStatus === "no" && !isTaken(r)).length;
  const pending = rows.filter((r) => r.callTakenStatus === "pending" && !isTaken(r)).length;
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

/* ── Rate color helper ────────────────────────────────────────────── */

function rateColor(rate: number): string {
  return rate >= 70 ? "var(--success)" : rate >= 50 ? "var(--warning)" : "var(--danger)";
}

/* ── Component ────────────────────────────────────────────────────── */

export default function UnifiedDashboard({ filters }: UnifiedDashboardProps) {
  const { dateFrom, dateTo } = getEffectiveDates(filters);

  const [sheet, setSheet] = useState<DataState<SheetApiResponse>>({
    data: null,
    loading: true,
    error: "",
  });

  const fetchSheet = useCallback(async (background = false) => {
    if (!background) {
      setSheet({ data: null, loading: true, error: "" });
    } else {
      setSheet((prev) => ({ ...prev, error: "" }));
    }
    try {
      const clientNames: Record<string, string> = { tyson: "Tyson Sonnek", antwan: "Antwan Rarcus" };
      const clientParam =
        filters.client !== "all" && clientNames[filters.client]
          ? `&client=${encodeURIComponent(clientNames[filters.client])}`
          : "";
      const res = await fetchJSON<SheetApiResponse>(
        `/api/sales-hub/sheet-data?dateFrom=${dateFrom}&dateTo=${dateTo}${clientParam}`,
      );
      setSheet({ data: res, loading: false, error: "" });
    } catch (err) {
      setSheet((prev) => ({
        data: background ? prev.data : null,
        loading: false,
        error: err instanceof Error ? err.message : "Unknown error",
      }));
    }
  }, [filters.client, dateFrom, dateTo]);

  useEffect(() => {
    fetchSheet();
  }, [fetchSheet]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void fetchSheet(true);
    }, AUTO_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [fetchSheet]);

  /* ── Per-client metrics (when "All Clients") ────────────────────── */
  const clientBreakdown = useMemo(() => {
    if (!sheet.data || filters.client !== "all") return null;
    const rows = sheet.data.rows;

    const tysonRows = rows.filter((r) => {
      const offer = r.offer?.toLowerCase() || "";
      return offer.includes("tyson") || offer.includes("sonic");
    });
    const antwanRows = rows.filter((r) => {
      const offer = r.offer?.toLowerCase() || "";
      return offer.includes("antwan") || offer.includes("rarcus");
    });

    return {
      tyson: { metrics: computeMetrics(tysonRows, "Tyson Sonnek"), rows: tysonRows },
      antwan: { metrics: computeMetrics(antwanRows, "Antwan Rarcus"), rows: antwanRows },
    };
  }, [sheet.data, filters.client]);

  const [expanded, setExpanded] = useState<string | null>(null);

  /* ── Render ─────────────────────────────────────────────────────── */
  if (filters.client !== "all") {
    return (
      <div
        className="glass-static"
        style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}
      >
        Client Comparison is only shown when the filter is set to All Clients.
      </div>
    );
  }

  if (sheet.loading && !clientBreakdown) {
    return (
      <div
        className="glass-static"
        style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}
      >
        Loading client comparison...
      </div>
    );
  }

  if (sheet.error) {
    return (
      <div
        className="glass-static"
        style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}
      >
        Failed to load client comparison: {sheet.error}
      </div>
    );
  }

  if (!clientBreakdown) return null;

  return (
    <div>
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
        <span style={{ textTransform: "none", letterSpacing: 0, color: "var(--text-muted)", fontWeight: 400, marginLeft: 4 }}>
          — click a client to break down by call type
        </span>
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
            {[clientBreakdown.tyson, clientBreakdown.antwan].map((cb) => {
              const c = cb.metrics;
              const isOpen = expanded === c.label;
              return (
                <Fragment key={c.label}>
                  <tr onClick={() => setExpanded(isOpen ? null : c.label)} style={{ cursor: "pointer" }}>
                    <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      <span style={{ display: "inline-block", width: 12, color: "var(--text-muted)" }}>{isOpen ? "\u25be" : "\u25b8"}</span>
                      {c.label}
                    </td>
                    <td style={{ color: "var(--success)", fontWeight: 600 }}>{fmtDollars(c.cashCollected)}</td>
                    <td>{fmtDollars(c.aov)}</td>
                    <td><span style={{ color: rateColor(c.closeRate), fontWeight: 600 }}>{fmtPercent(c.closeRate)}</span></td>
                    <td><span style={{ color: rateColor(c.showRate), fontWeight: 600 }}>{fmtPercent(c.showRate)}</span></td>
                    <td>{fmtNumber(c.callsBooked)}</td>
                    <td>{fmtNumber(c.callsTaken)}</td>
                    <td style={{ color: "var(--success)" }}>{fmtNumber(c.wins)}</td>
                    <td style={{ color: "var(--danger)" }}>{fmtNumber(c.losses)}</td>
                    <td style={{ color: c.pending > 0 ? "var(--warning)" : "var(--text-secondary)" }}>{fmtNumber(c.pending)}</td>
                  </tr>
                  {isOpen &&
                    CALL_CATEGORIES.map((cat) => {
                      const m = computeMetrics(rowsForCategory(cb.rows, cat.key), cat.label);
                      return (
                        <tr key={c.label + cat.key} style={{ background: "rgba(127,127,127,0.06)" }}>
                          <td style={{ paddingLeft: 28, color: "var(--text-secondary)", fontSize: 12 }}>{cat.label}</td>
                          <td style={{ color: "var(--success)" }}>{fmtDollars(m.cashCollected)}</td>
                          <td>{fmtDollars(m.aov)}</td>
                          <td>{fmtPercent(m.closeRate)}</td>
                          <td>{fmtPercent(m.showRate)}</td>
                          <td>{fmtNumber(m.callsBooked)}</td>
                          <td>{fmtNumber(m.callsTaken)}</td>
                          <td style={{ color: "var(--success)" }}>{fmtNumber(m.wins)}</td>
                          <td style={{ color: "var(--danger)" }}>{fmtNumber(m.losses)}</td>
                          <td>{fmtNumber(m.pending)}</td>
                        </tr>
                      );
                    })}
                </Fragment>
              );
            })}
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
  );
}

/* ── Re-export sheet state for sibling components ─────────────────── */
export type { DataState };
