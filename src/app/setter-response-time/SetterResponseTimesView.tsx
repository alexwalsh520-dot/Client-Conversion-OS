"use client";

// Setter Response Time — a normal CCOS tab (sidebar stays, no redirect).
//
// Every setter's numbers are on screen at once: a team strip up top, one row
// per setter in the overview table (avg, median, fastest/slowest single reply,
// misses, miss rate), and an hour-by-hour strip (avg per hour, toggle to
// median) with a row per setter. Date range: Today / Week to Date / Month to
// Date / Custom — same preset pattern as Manager Ads View.
//
// Data comes from the session-authed Sales Hub endpoint
// /api/sales-hub/response-times (client=all). While the selected range
// includes today, the view re-pulls every 60s and shows exactly when it last
// updated.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Clock3, Loader2, Timer, Users } from "lucide-react";
import HourlyStripTable, { type StripRow } from "../sales-hub/components/HourlyStripTable";

interface HourlyBucket {
  hour: number;
  count: number;
  avgSeconds: number | null;
  medianSeconds: number | null;
  missedCount: number;
}

interface Group {
  id: string;
  label: string;
  averageSeconds: number | null;
  medianSeconds: number | null;
  sampleCount: number;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  missedCount: number;
  hourly: HourlyBucket[];
}

interface Metrics {
  summary: Group & { latestMessageAt: string | null; staleMessageFeed: boolean };
  setters: Group[];
  missThresholdSeconds: number;
}

// ── ET date helpers (mirror ManagerAdsView) ─────────────────────────────────

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

type PresetKey = "today" | "wtd" | "mtd" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "wtd", label: "Week to Date" },
  { key: "mtd", label: "Month to Date" },
  { key: "custom", label: "Custom" },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const today = etToday();
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "wtd":
      return { from: startOfWeek(today), to: today };
    case "mtd":
      return { from: today.slice(0, 8) + "01", to: today };
    default:
      return { from: today, to: today };
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function fmtDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m ${secs}s`;
}

// Compact m:ss for hour-strip cells (e.g. 0:52, 2:56).
function fmtMmSs(seconds: number) {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtHour(hour: number) {
  const period = hour < 12 ? "a" : "p";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}${period}`;
}

function fmtEtClock(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

const BUSINESS_HOUR_LABELS = Array.from({ length: 12 }, (_, i) => fmtHour(11 + i));

// Color a reply time against the 5-minute target: green inside the window,
// amber up to double it, red beyond.
function paceColor(seconds: number | null, threshold: number) {
  if (seconds === null) return "var(--text-muted)";
  if (seconds <= threshold) return "var(--success)";
  if (seconds <= threshold * 2) return "var(--warning)";
  return "var(--danger)";
}

function missRateColor(rate: number | null) {
  if (rate === null) return "var(--text-muted)";
  if (rate === 0) return "var(--success)";
  if (rate <= 0.2) return "var(--warning)";
  return "var(--danger)";
}

const REFRESH_MS = 60_000;

export default function SetterResponseTimesView() {
  const [preset, setPreset] = useState<PresetKey>("today");
  const [customFrom, setCustomFrom] = useState(() => etToday());
  const [customTo, setCustomTo] = useState(() => etToday());
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [, setTick] = useState(0); // keeps "Xs ago" honest
  const inFlight = useRef<string | null>(null);

  const range = useMemo(
    () => (preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset)),
    [preset, customFrom, customTo],
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!range.from || !range.to || range.from > range.to) return;
      const url = `/api/sales-hub/response-times?client=all&dateFrom=${range.from}&dateTo=${range.to}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded by a newer request
        if (!res.ok) throw new Error(body?.error || "Failed to load response times");
        setData(body as Metrics);
        setLastUpdated(new Date().toISOString());
        setError(null);
      } catch (err) {
        if (inFlight.current !== url) return;
        setError((err as Error).message);
      } finally {
        if (inFlight.current === url) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [range.from, range.to],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live re-pull while the range includes today.
  useEffect(() => {
    if (range.to < etToday()) return;
    const id = window.setInterval(() => void load({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load, range.to]);

  // Tick the "updated Xs ago" readout once a second.
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const threshold = data?.missThresholdSeconds ?? 300;
  const thresholdMin = Math.round(threshold / 60);

  // Named setters first (A→Z), attribution-gap bucket last.
  const setterRows = useMemo(() => {
    if (!data) return [];
    const named = data.setters.filter((s) => s.id !== "unassigned");
    const unassigned = data.setters.filter((s) => s.id === "unassigned" && s.sampleCount > 0);
    return [...named, ...unassigned];
  }, [data]);

  const hourlyAvgRows: StripRow[] = useMemo(() => {
    if (!data) return [];
    const toRow = (g: Group): StripRow => ({
      id: g.id,
      label: g.label,
      cells: g.hourly.map((h) => ({
        value: h.avgSeconds != null ? fmtMmSs(h.avgSeconds) : null,
        danger: h.missedCount > 0,
        tooltip: `${fmtHour(h.hour)} — avg ${h.avgSeconds != null ? fmtDuration(h.avgSeconds) : "—"} · median ${h.medianSeconds != null ? fmtDuration(h.medianSeconds) : "—"} · ${h.count} replies · ${h.missedCount} missed`,
      })),
    });
    return [{ ...toRow(data.summary), label: "Team" }, ...setterRows.map(toRow)];
  }, [data, setterRows]);

  const hourlyMedianRows: StripRow[] = useMemo(() => {
    if (!data) return [];
    const toRow = (g: Group): StripRow => ({
      id: g.id,
      label: g.label,
      cells: g.hourly.map((h) => ({
        value: h.medianSeconds != null ? fmtMmSs(h.medianSeconds) : null,
        danger: h.missedCount > 0,
        tooltip: `${fmtHour(h.hour)} — median ${h.medianSeconds != null ? fmtDuration(h.medianSeconds) : "—"} · avg ${h.avgSeconds != null ? fmtDuration(h.avgSeconds) : "—"} · ${h.count} replies · ${h.missedCount} missed`,
      })),
    });
    return [{ ...toRow(data.summary), label: "Team" }, ...setterRows.map(toRow)];
  }, [data, setterRows]);

  const updatedAgoSec = lastUpdated
    ? Math.max(0, Math.round((Date.now() - new Date(lastUpdated).getTime()) / 1000))
    : null;
  const liveRange = range.to >= etToday();

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
    <div className="fade-up" style={{ maxWidth: 1100 }}>
      <div className="page-header" style={{ marginBottom: 16 }}>
        <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Timer size={22} style={{ color: "var(--accent)" }} />
          Setter Response Time
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 4 }}>
          Reply speed on assigned leads, business hours 11am–11pm ET. Replies over{" "}
          {thresholdMin} min count as missed.
          {lastUpdated ? (
            <>
              {" "}Updated {fmtEtClock(lastUpdated)}
              {updatedAgoSec !== null ? ` (${updatedAgoSec}s ago)` : ""}
              {liveRange ? " · auto-refreshes every minute" : ""}
            </>
          ) : null}
        </p>
      </div>

      {/* ── Date range ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
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
              max={etToday()}
              onChange={(e) => setCustomTo(e.target.value)}
              style={{ width: 150, padding: "6px 10px", fontSize: 13 }}
            />
          </span>
        )}
        <button
          onClick={() => void load()}
          disabled={loading}
          style={{ ...chip(false), opacity: loading ? 0.5 : 1 }}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loading && !data ? (
        <div className="glass-static" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading response times...</span>
        </div>
      ) : error && !data ? (
        <div className="glass-static" style={{ padding: 18, fontSize: 13, color: "var(--warning)" }}>{error}</div>
      ) : data ? (
        <>
          {/* ── Team strip ── */}
          <div className="section" style={{ marginBottom: 20 }}>
            <h2 className="section-title">
              <Clock3 size={16} />
              Team — {range.from === range.to ? range.from : `${range.from} → ${range.to}`}
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 10,
              }}
            >
              <MetricCard label="Average" value={fmtDuration(data.summary.averageSeconds)} color={paceColor(data.summary.averageSeconds, threshold)} sub={`target: under ${thresholdMin} min`} />
              <MetricCard label="Median" value={fmtDuration(data.summary.medianSeconds)} color={paceColor(data.summary.medianSeconds, threshold)} sub="typical reply, outliers ignored" />
              <MetricCard
                label="Miss Rate"
                value={data.summary.sampleCount ? `${Math.round((data.summary.missedCount / data.summary.sampleCount) * 100)}%` : "—"}
                color={missRateColor(data.summary.sampleCount ? data.summary.missedCount / data.summary.sampleCount : null)}
                sub={data.summary.sampleCount ? `${data.summary.missedCount} of ${data.summary.sampleCount} over ${thresholdMin} min` : "no replies tracked"}
              />
              <MetricCard label="Fastest" value={fmtDuration(data.summary.fastestSeconds)} color={paceColor(data.summary.fastestSeconds, threshold)} sub="best single reply" />
              <MetricCard label="Slowest" value={fmtDuration(data.summary.slowestSeconds)} color={paceColor(data.summary.slowestSeconds, threshold)} sub="worst single reply" />
              <MetricCard label="Replies" value={String(data.summary.sampleCount)} sub="tracked in range" />
            </div>
          </div>

          {/* ── Every setter, one row each ── */}
          <div className="section" style={{ marginBottom: 20 }}>
            <h2 className="section-title">
              <Users size={16} />
              All Setters
            </h2>
            <div className="glass-static" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                      <Th>Setter</Th>
                      <Th align="right">Replies</Th>
                      <Th align="right">Average</Th>
                      <Th align="right">Median</Th>
                      <Th align="right">Fastest</Th>
                      <Th align="right">Slowest</Th>
                      <Th align="right">Missed</Th>
                      <Th align="right">Miss Rate</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {setterRows.length === 0 ? (
                      <tr>
                        <Td colSpan={8} muted>
                          No tracked replies in this range yet.
                        </Td>
                      </tr>
                    ) : (
                      setterRows.map((s) => {
                        const rate = s.sampleCount ? s.missedCount / s.sampleCount : null;
                        return (
                          <tr key={s.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                            <Td strong>{s.label}</Td>
                            <Td align="right">{s.sampleCount}</Td>
                            <Td align="right" color={paceColor(s.averageSeconds, threshold)}>
                              {fmtDuration(s.averageSeconds)}
                            </Td>
                            <Td align="right" color={paceColor(s.medianSeconds, threshold)}>
                              {fmtDuration(s.medianSeconds)}
                            </Td>
                            <Td align="right">{fmtDuration(s.fastestSeconds)}</Td>
                            <Td align="right">{fmtDuration(s.slowestSeconds)}</Td>
                            <Td align="right" color={s.missedCount > 0 ? "var(--danger)" : undefined}>
                              {s.missedCount}
                            </Td>
                            <Td align="right" color={missRateColor(rate)}>
                              {rate === null ? "—" : `${Math.round(rate * 100)}%`}
                            </Td>
                          </tr>
                        );
                      })
                    )}
                    {setterRows.length > 0 && (
                      <tr style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                        <Td strong>Team</Td>
                        <Td align="right" strong>{data.summary.sampleCount}</Td>
                        <Td align="right" strong color={paceColor(data.summary.averageSeconds, threshold)}>
                          {fmtDuration(data.summary.averageSeconds)}
                        </Td>
                        <Td align="right" strong color={paceColor(data.summary.medianSeconds, threshold)}>
                          {fmtDuration(data.summary.medianSeconds)}
                        </Td>
                        <Td align="right" strong>{fmtDuration(data.summary.fastestSeconds)}</Td>
                        <Td align="right" strong>{fmtDuration(data.summary.slowestSeconds)}</Td>
                        <Td align="right" strong color={data.summary.missedCount > 0 ? "var(--danger)" : undefined}>
                          {data.summary.missedCount}
                        </Td>
                        <Td align="right" strong color={missRateColor(data.summary.sampleCount ? data.summary.missedCount / data.summary.sampleCount : null)}>
                          {data.summary.sampleCount ? `${Math.round((data.summary.missedCount / data.summary.sampleCount) * 100)}%` : "—"}
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── Hour by hour, every setter ── */}
          <div className="section">
            <h2 className="section-title">
              <Clock3 size={16} />
              Hour by Hour (ET)
            </h2>
            <HourlyStripTable
              title="Avg reply per hour — red = hour had misses"
              hourLabels={BUSINESS_HOUR_LABELS}
              rows={hourlyAvgRows}
              secondaryRows={hourlyMedianRows}
              toggleLabels={["Avg", "Median"]}
            />
          </div>

          {error ? (
            <div className="glass-static" style={{ padding: 12, marginTop: 12, fontSize: 12, color: "var(--warning)" }}>
              <AlertTriangle size={12} style={{ marginRight: 6, verticalAlign: -2 }} />
              Last refresh failed ({error}) — showing previous data.
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="glass-static" style={{ padding: "12px 14px" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "1px", color: "var(--text-muted)", fontWeight: 600, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub ? <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</div> : null}
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: align,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
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
  strong = false,
  muted = false,
  color,
  colSpan,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  strong?: boolean;
  muted?: boolean;
  color?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      style={{
        padding: "10px 14px",
        textAlign: align,
        fontWeight: strong ? 650 : 450,
        color: color || (muted ? "var(--text-muted)" : "var(--text-primary)"),
        whiteSpace: "nowrap",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {children}
    </td>
  );
}
