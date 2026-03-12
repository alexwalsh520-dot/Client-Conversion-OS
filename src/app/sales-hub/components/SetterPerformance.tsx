"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { fmtNumber, fmtPercent } from "@/lib/formatters";
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

/* ── Rate color helper ────────────────────────────────────────────── */

function rateColor(rate: number): string {
  return rate >= 50 ? "var(--success)" : rate >= 30 ? "var(--warning)" : "var(--danger)";
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
        return { name, client, newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
      }

      const setterData: ManychatDashboard | undefined =
        metrics.setters[name] ||
        metrics.setters[name.toLowerCase()] ||
        Object.entries(metrics.setters).find(
          ([k]) => k.toLowerCase() === name.toLowerCase(),
        )?.[1];

      if (!setterData) {
        return { name, client, newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
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
      <div className="glass-static" style={{
        padding: 40, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Loader2 size={20} className="spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  /* ── Error state ────────────────────────────────────────────────── */
  if (error) {
    return (
      <div className="glass-static" style={{
        padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13,
      }}>
        Failed to load setter data: {error}
      </div>
    );
  }

  /* ── Empty state ────────────────────────────────────────────────── */
  if (setterRows.length === 0) {
    return (
      <div className="glass-static" style={{
        padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13,
      }}>
        No setter data available for this period.
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: 16,
    }}>
      {setterRows.map((s) => {
        const engagement = s.newLeads > 0 ? (s.leadsEngaged / s.newLeads) * 100 : 0;
        const engColor = rateColor(engagement);
        const cc = clientColor(s.client);

        return (
          <div key={`${s.client}-${s.name}`} className="glass-static" style={{ padding: "22px 24px" }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 18,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%", background: cc,
                }} />
                <span style={{
                  fontSize: 16, fontWeight: 700, color: "var(--text-primary)",
                }}>
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

            {/* Metrics 2x2 grid */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr",
              gap: "12px 20px", marginBottom: 16,
            }}>
              {[
                { label: "New Leads", value: s.newLeads },
                { label: "Engaged", value: s.leadsEngaged },
                { label: "Call Links", value: s.callLinksSent },
                { label: "Sub Links", value: s.subLinksSent },
              ].map((m) => (
                <div key={m.label}>
                  <div style={{
                    fontSize: 22, fontWeight: 700, color: "var(--text-primary)",
                    letterSpacing: "-0.5px",
                  }}>
                    {fmtNumber(m.value)}
                  </div>
                  <div style={{
                    fontSize: 11, color: "var(--text-muted)", fontWeight: 500, marginTop: 2,
                  }}>
                    {m.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Engagement rate bar */}
            <div style={{ padding: "12px 0 0", borderTop: "1px solid var(--border-subtle)" }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 6,
              }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>
                  Engagement
                </span>
                <span style={{ fontSize: 14, fontWeight: 700, color: engColor }}>
                  {fmtPercent(engagement)}
                </span>
              </div>
              <div style={{
                height: 5, background: "rgba(255,255,255,0.06)",
                borderRadius: 3, overflow: "hidden",
              }}>
                <div style={{
                  height: "100%",
                  width: `${Math.min(engagement, 100)}%`,
                  background: engColor,
                  borderRadius: 3,
                  transition: "width 0.8s ease",
                }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
