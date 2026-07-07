"use client";

// Manager Ads View — the sales manager's cut of the ads data. One scrollable
// per-influencer overview table on top, big metric cards for the selected
// influencer below. Intentionally minimal: spend → messages → calls → clients
// → cash, with cost-per-X at every step and potential ROAS at the end.

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Loader2, Megaphone } from "lucide-react";

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
  cashCollected: number | null;
  potentialRoas: number | null;
}

interface Report {
  from: string;
  to: string;
  rows: Row[];
  total: Row;
  warnings: string[];
}

// ── ET date helpers (mirror src/lib/daily-report/time.ts, client-side) ──────

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return dt.toISOString().slice(0, 10);
}

function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(dateStr, -((dow + 6) % 7)); // Monday
}

type PresetKey = "today" | "wtd" | "last7" | "mtd" | "lastMonth" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "wtd", label: "This Week" },
  { key: "last7", label: "Last 7 Days" },
  { key: "mtd", label: "Month to Date" },
  { key: "lastMonth", label: "Last Month" },
  { key: "custom", label: "Custom" },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const today = etToday();
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "wtd":
      return { from: startOfWeek(today), to: today };
    case "last7":
      return { from: addDays(today, -6), to: today };
    case "mtd":
      return { from: today.slice(0, 8) + "01", to: today };
    case "lastMonth": {
      const lastMonthEnd = addDays(today.slice(0, 8) + "01", -1);
      return { from: lastMonthEnd.slice(0, 8) + "01", to: lastMonthEnd };
    }
    default:
      return { from: today.slice(0, 8) + "01", to: today };
  }
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
  const [preset, setPreset] = useState<PresetKey>("mtd");
  const [customFrom, setCustomFrom] = useState(() => presetRange("mtd").from);
  const [customTo, setCustomTo] = useState(() => etToday());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("total");

  const range = useMemo(
    () => (preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset)),
    [preset, customFrom, customTo],
  );

  const load = useCallback(async () => {
    if (!range.from || !range.to || range.from > range.to) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/manager-ads?from=${range.from}&to=${range.to}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load ads data");
      setReport(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
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
          Ad spend → messages → calls → clients, per influencer. {report ? `${report.from} → ${report.to}` : ""}
        </p>
      </div>

      {/* ── Date range ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        <CalendarDays size={15} style={{ color: "var(--text-muted)" }} />
        {PRESETS.map((p) => (
          <button key={p.key} style={chip(preset === p.key)} onClick={() => setPreset(p.key)}>
            {p.label}
          </button>
        ))}
        {preset === "custom" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="date"
              className="input-field"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              style={{ width: 150, padding: "6px 10px", fontSize: 13 }}
            />
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>to</span>
            <input
              type="date"
              className="input-field"
              value={customTo}
              min={customFrom}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ width: 150, padding: "6px 10px", fontSize: 13 }}
            />
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
                      <Th align="right">Cash</Th>
                      <Th align="right">Pot. ROAS</Th>
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
                        <Td align="right">{usd(r.cashCollected)}</Td>
                        <Td align="right">{roasFmt(r.potentialRoas)}</Td>
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
                <Metric label="Cash Collected" value={usd(selectedRow.cashCollected)} />
                <Metric label="Potential ROAS" value={roasFmt(selectedRow.potentialRoas)} accent />
              </div>
            )}

            <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 14 }}>
              Potential ROAS = cash collected ÷ ad spend. All tracked cash counts toward ads — anything unattributed
              is treated as ad-driven.
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
