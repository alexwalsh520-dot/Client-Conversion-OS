"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { fmtNumber } from "@/lib/formatters";
import { getEffectiveDates } from "./FilterBar";
import type { Filters, ManychatMetrics, ManychatDashboard } from "../types";

/* ── Types ────────────────────────────────────────────────────────── */

interface SetterPerformanceProps {
  filters: Filters;
}

interface SetterRow {
  name: string;
  client: string;
  newLeads: number;
  leadsEngaged: number;
  callLinksSent: number;
  subLinksSent: number;
}

/* ── Client-to-setter mapping ─────────────────────────────────────── */

const CLIENT_SETTERS: Record<string, string[]> = {
  tyson: ["Amara", "Kelechi"],
  keith: ["Gideon", "Debbie"],
};

function getRelevantSetters(client: string): { name: string; client: string }[] {
  if (client === "all") {
    return [
      ...CLIENT_SETTERS.tyson.map((n) => ({ name: n, client: "tyson" })),
      ...CLIENT_SETTERS.keith.map((n) => ({ name: n, client: "keith" })),
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

  /* ── Fetch data ─────────────────────────────────────────────────── */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError("");
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
        setMetricsMap({ tyson, keith });
      } else {
        const data = await fetchJSON<ManychatMetrics>(
          `/api/sales-hub/manychat-metrics?client=${filters.client}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
        );
        setMetricsMap({ [filters.client]: data });
      }
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }, [filters.client, dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* ── Build setter rows from metrics ─────────────────────────────── */
  const setterRows = useMemo((): SetterRow[] => {
    const relevant = getRelevantSetters(filters.client);

    return relevant.map(({ name, client }) => {
      const metrics = metricsMap[client];
      if (!metrics || !metrics.setters) {
        return {
          name,
          client,
          newLeads: 0,
          leadsEngaged: 0,
          callLinksSent: 0,
          subLinksSent: 0,
        };
      }

      // Try case-insensitive lookup for the setter name
      const setterData: ManychatDashboard | undefined =
        metrics.setters[name] ||
        metrics.setters[name.toLowerCase()] ||
        Object.entries(metrics.setters).find(
          ([k]) => k.toLowerCase() === name.toLowerCase(),
        )?.[1];

      if (!setterData) {
        return {
          name,
          client,
          newLeads: 0,
          leadsEngaged: 0,
          callLinksSent: 0,
          subLinksSent: 0,
        };
      }

      return {
        name,
        client,
        newLeads: setterData.newLeads,
        leadsEngaged: setterData.leadsEngaged,
        callLinksSent: setterData.callLinksSent,
        subLinksSent: setterData.subLinksSent,
      };
    });
  }, [filters.client, metricsMap]);

  /* ── Client color helper ────────────────────────────────────────── */
  function clientColor(client: string): string {
    return client === "keith" ? "var(--keith)" : "var(--tyson)";
  }

  /* ── Loading state ──────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="section">
        <h2 className="section-title">
          <MessageSquare size={16} />
          Setter Performance
        </h2>
        <div
          className="glass-static"
          style={{
            padding: 40,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
        </div>
      </div>
    );
  }

  /* ── Error state ────────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="section">
        <h2 className="section-title">
          <MessageSquare size={16} />
          Setter Performance
        </h2>
        <div
          className="glass-static"
          style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}
        >
          Failed to load setter data: {error}
        </div>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="section">
      <h2 className="section-title">
        <MessageSquare size={16} />
        Setter Performance
      </h2>
      <div className="glass-static" style={{ overflow: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Setter</th>
              <th>New Leads</th>
              <th>Leads Engaged</th>
              <th>Call Links Sent</th>
              <th>Sub Links Sent</th>
              <th>Calls Booked</th>
              <th>Subs Sold</th>
              <th>Avg Response Time</th>
            </tr>
          </thead>
          <tbody>
            {setterRows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  style={{ textAlign: "center", color: "var(--text-muted)" }}
                >
                  No setter data available for this period.
                </td>
              </tr>
            ) : (
              setterRows.map((s) => (
                <tr key={`${s.client}-${s.name}`}>
                  <td>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                      {s.name}
                    </span>
                    {filters.client === "all" && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          color: clientColor(s.client),
                          fontWeight: 500,
                        }}
                      >
                        {s.client.charAt(0).toUpperCase() + s.client.slice(1)}
                      </span>
                    )}
                  </td>
                  <td>{fmtNumber(s.newLeads)}</td>
                  <td>{fmtNumber(s.leadsEngaged)}</td>
                  <td>{fmtNumber(s.callLinksSent)}</td>
                  <td>{fmtNumber(s.subLinksSent)}</td>
                  <td style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    N/A
                  </td>
                  <td style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    N/A
                  </td>
                  <td style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                    N/A
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
