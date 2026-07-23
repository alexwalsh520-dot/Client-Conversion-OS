"use client";

// Manager Ads View — the sales manager's cut of the ads data. One scrollable
// per-influencer overview table on top, big metric cards for the selected
// influencer below. Intentionally minimal: spend → messages → calls → clients
// → collected revenue, cost-per-X at each step, Collected ROI at the end.
//
// Source of truth: the Ads V2 tab. Every number here reads the same v2 window
// snapshot the /ads-v2 tab reads, so the two always agree. Revenue and ROI are
// keyword-attributed (matching v2), not an "all cash" figure.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Loader2, Megaphone } from "lucide-react";
import AdsDateDropdown, { rangeForPreset, type DateRange } from "./AdsDateDropdown";

interface Row {
  client: string;
  label: string;
  spend: number | null;
  messages: number | null;
  costPerMessage: number | null;
  callsBooked: number | null;
  costPerBooked: number | null;
  callsTaken: number | null;
  costPerTaken: number | null;
  newClients: number | null;
  costPerClient: number | null;
  collectedRevenue: number | null;
  collectedRoi: number | null;
}

interface Report {
  from: string;
  to: string;
  rows: Row[];
  total: Row;
  preparing?: boolean;
  notices?: string[];
  warnings: string[];
}

// ── Formatting ───────────────────────────────────────────────────────────────

const usd = (n: number | null, cents = false) =>
  n == null
    ? "—"
    : n.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: cents ? 2 : 0,
        minimumFractionDigits: cents ? 2 : 0,
      });
const num = (n: number | null) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
const roasFmt = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}x`);

export default function ManagerAdsView() {
  const [range, setRange] = useState<DateRange>(() => rangeForPreset("mtd"));
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("total");

  const prepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!range.dateFrom || !range.dateTo || range.dateFrom > range.dateTo) return;
    try {
      setError(null);
      const res = await fetch(`/api/manager-ads?from=${range.dateFrom}&to=${range.dateTo}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load ads data");
      setReport(data);
      // v2 is still building this window's snapshot — poll until it lands.
      if (data.preparing) {
        if (prepTimer.current) clearTimeout(prepTimer.current);
        prepTimer.current = setTimeout(() => load(), 2000);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.dateFrom, range.dateTo]);

  useEffect(() => {
    setLoading(true);
    load();
    return () => {
      if (prepTimer.current) clearTimeout(prepTimer.current);
    };
  }, [load]);

  const selectedRow: Row | null = useMemo(() => {
    if (!report) return null;
    if (selected === "total") return report.total;
    return report.rows.find((r) => r.client === selected) || report.total;
  }, [report, selected]);

  const chip = (active: boolean): React.CSSProperties => ({
    padding: "7px 14px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    border: `1px solid ${active ? "var(--accent)" : "rgba(255,255,255,0.1)"}`,
    background: active ? "var(--accent-soft)" : "transparent",
    color: active ? "var(--accent)" : "var(--text-secondary)",
    whiteSpace: "nowrap",
  });

  return (
    <div className="fade-up" style={{ maxWidth: 1200 }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Megaphone size={22} style={{ color: "var(--accent)" }} />
          Manager Ads View
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
          Ad spend → messages → calls → clients, per influencer · sourced from the Ads V2 tab.
          {report ? ` ${report.from} → ${report.to}` : ""}
        </p>
      </div>

      {/* ── Date range — same Meta-style dropdown as the /ads tab ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        <AdsDateDropdown value={range} onChange={setRange} />
        {report?.preparing && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
            <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
            Preparing this window…
          </span>
        )}
      </div>

      {loading ? (
        <div className="glass-static" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading ads data...</span>
        </div>
      ) : error ? (
        <div className="glass-static" style={{ padding: 18, fontSize: 13, color: "var(--warning)" }}>{error}</div>
      ) : report ? (
        <>
          {/* ── Influencer overview (scrollable, like the ads tracker) ── */}
          <div className="section">
            <h2 className="section-title">
              <BarChart3 size={16} />
              Influencer Overview
            </h2>
            <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <Th>Influencer</Th>
                      <Th align="right">Spend</Th>
                      <Th align="right">Messages</Th>
                      <Th align="right">Cost/Msg</Th>
                      <Th align="right">Calls Booked</Th>
                      <Th align="right">Cost/Booked</Th>
                      <Th align="right">Calls Taken</Th>
                      <Th align="right">Cost/Taken</Th>
                      <Th align="right">New Clients</Th>
                      <Th align="right">Cost/Client</Th>
                      <Th align="right">Collected Rev</Th>
                      <Th align="right">Collected ROI</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.rows, report.total].map((r) => (
                      <tr
                        key={r.client}
                        onClick={() => setSelected(r.client)}
                        style={{
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          cursor: "pointer",
                          background: selected === r.client ? "var(--accent-glow)" : "transparent",
                          fontWeight: r.client === "total" ? 600 : 400,
                        }}
                      >
                        <Td><strong>{r.label}</strong></Td>
                        <Td align="right">{usd(r.spend)}</Td>
                        <Td align="right">{num(r.messages)}</Td>
                        <Td align="right">{usd(r.costPerMessage, true)}</Td>
                        <Td align="right">{num(r.callsBooked)}</Td>
                        <Td align="right">{usd(r.costPerBooked)}</Td>
                        <Td align="right">{num(r.callsTaken)}</Td>
                        <Td align="right">{usd(r.costPerTaken)}</Td>
                        <Td align="right">{num(r.newClients)}</Td>
                        <Td align="right">{usd(r.costPerClient)}</Td>
                        <Td align="right">{usd(r.collectedRevenue)}</Td>
                        <Td align="right">{roasFmt(r.collectedRoi)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Specific metrics for the selected influencer ── */}
          <div className="section">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <h2 className="section-title" style={{ marginBottom: 0 }}>Metrics</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button style={chip(selected === "total")} onClick={() => setSelected("total")}>All</button>
                {report.rows.map((r) => (
                  <button key={r.client} style={chip(selected === r.client)} onClick={() => setSelected(r.client)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedRow && (
              <div className="metric-grid metric-grid-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                <Metric label="Ad Spend" value={usd(selectedRow.spend)} />
                <Metric label="Messages" value={num(selectedRow.messages)} />
                <Metric label="Cost / Message" value={usd(selectedRow.costPerMessage, true)} />
                <Metric label="Calls Booked" value={num(selectedRow.callsBooked)} />
                <Metric label="Cost / Call Booked" value={usd(selectedRow.costPerBooked)} />
                <Metric label="Calls Taken" value={num(selectedRow.callsTaken)} />
                <Metric label="Cost / Call Taken" value={usd(selectedRow.costPerTaken)} />
                <Metric label="New Clients" value={num(selectedRow.newClients)} />
                <Metric label="Cost / Client" value={usd(selectedRow.costPerClient)} />
                <Metric label="Collected Revenue" value={usd(selectedRow.collectedRevenue)} />
                <Metric label="Collected ROI" value={roasFmt(selectedRow.collectedRoi)} accent />
              </div>
            )}

            <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 14 }}>
              Collected ROI = collected revenue ÷ ad spend. Every figure is sourced from the Ads V2 tab: revenue and
              ROI are keyword-attributed to paid ads, so cash that can&apos;t be tied to an ad keyword is not counted.
            </p>
          </div>

          {report.warnings.length > 0 && (
            <div className="glass-static" style={{ padding: 14, fontSize: 12, color: "var(--warning)" }}>
              Some sources failed to load: {report.warnings.join(" · ")}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value" style={accent ? { color: "var(--accent)" } : undefined}>{value}</div>
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

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <td
      style={{
        padding: "10px 12px",
        textAlign: align,
        color: "var(--text-primary)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
