"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Users } from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, SheetRow } from "../types";

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
  );
}

/* ── Re-export sheet state for sibling components ─────────────────── */
export type { DataState };
