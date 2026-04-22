"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";

interface TrackerRow {
  client: string;
  spend: number;
  impressions: number;
  linkClicks: number;
  messages: number;
  ctr: number;
  cpc: number;
  cpi: number;
  costPerMessage: number;
  calls60Booked: number;
  calls60Taken: number;
  showUpPct: number;
  newClients: number;
  closeRate: number;
  collectedRevenue: number;
  costPerClient: number;
  collectedRoi: number;
  hasData: boolean;
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const pct = (n: number) => `${n.toFixed(1)}%`;
const ratio = (n: number) => `${n.toFixed(2)}x`;

export default function AdTrackerMetrics() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<TrackerRow[]>([]);
  const [month, setMonth] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/ads/tracker-metrics");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load tracker metrics");
      setRows(data.rows || []);
      setMonth(data.month || "");
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMetrics();
  }, [fetchMetrics]);

  return (
    <div className="section">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          <BarChart3 size={16} />
          Ad Tracker Metrics
        </h2>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {month ? `Month: ${month}` : "Current month"}
        </div>
      </div>

      {loading ? (
        <div className="glass-static" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading tracker data...</span>
        </div>
      ) : error ? (
        <div className="glass-static" style={{ padding: 18, fontSize: 13, color: "var(--warning)" }}>
          {error}
        </div>
      ) : (
        <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <Th>Client</Th>
                  <Th align="right">Spend</Th>
                  <Th align="right">Impressions</Th>
                  <Th align="right">Clicks</Th>
                  <Th align="right">CTR</Th>
                  <Th align="right">CPC</Th>
                  <Th align="right">Messages</Th>
                  <Th align="right">Cost/Msg</Th>
                  <Th align="right">Calls Booked</Th>
                  <Th align="right">Calls Taken</Th>
                  <Th align="right">Show %</Th>
                  <Th align="right">New Clients</Th>
                  <Th align="right">Close %</Th>
                  <Th align="right">Collected</Th>
                  <Th align="right">$/Client</Th>
                  <Th align="right">ROI</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.client} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <Td><strong>{r.client}</strong></Td>
                    {r.hasData ? (
                      <>
                        <Td align="right">{usd(r.spend)}</Td>
                        <Td align="right">{num(r.impressions)}</Td>
                        <Td align="right">{num(r.linkClicks)}</Td>
                        <Td align="right">{pct(r.ctr)}</Td>
                        <Td align="right">{usd(r.cpc)}</Td>
                        <Td align="right">{num(r.messages)}</Td>
                        <Td align="right">{usd(r.costPerMessage)}</Td>
                        <Td align="right">{num(r.calls60Booked)}</Td>
                        <Td align="right">{num(r.calls60Taken)}</Td>
                        <Td align="right">{pct(r.showUpPct)}</Td>
                        <Td align="right">{num(r.newClients)}</Td>
                        <Td align="right">{pct(r.closeRate)}</Td>
                        <Td align="right">{usd(r.collectedRevenue)}</Td>
                        <Td align="right">{usd(r.costPerClient)}</Td>
                        <Td align="right">{ratio(r.collectedRoi)}</Td>
                      </>
                    ) : (
                      <Td align="center" colSpan={15} muted>
                        no data yet
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding: "10px 12px",
        textAlign: align,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: "var(--text-muted)",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  colSpan,
  muted,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
  colSpan?: number;
  muted?: boolean;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 12px",
        textAlign: align,
        color: muted ? "var(--text-muted)" : "var(--text-primary)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
