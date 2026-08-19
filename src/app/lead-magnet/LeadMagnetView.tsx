"use client";

// Lead Magnet Funnel — a normal CCOS tab (sidebar stays, no redirect).
//
// Minimal by request: a date picker, then one row per client (Tyson / Jake /
// All) with Leads (= Skool joins — one #fresh-leads ping fires per join),
// how many of those got dialed, average speed to lead, and booking rate.
// Bookings come from GHL appointments created after the ping (the team books
// through GHL calendar links). Dials only exist when placed through the GHL
// dialer. A per-lead receipts table sits below.
//
// Data comes from /api/lead-magnet (live Slack + GHL reads — slow for long
// ranges). While the selected range includes today, the view re-pulls every
// 5 minutes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarDays, Loader2 } from "lucide-react";

interface LeadBooking {
  date: string;
  closer: string;
  setter: string;
  callType: string;
  callTakenStatus: "yes" | "no" | "pending";
  outcome: string;
  revenue: number;
  cashCollected: number;
}

interface LeadJourney {
  slackTs: string;
  pingAt: string;
  dateEt: string;
  name: string;
  phone: string | null;
  offer: string | null;
  ghlContactId: string | null;
  dials: number;
  firstDialAt: string | null;
  speedToLeadSec: number | null;
  connected: boolean;
  longestCallSec: number | null;
  setter: string | null;
  ghlAppointmentAt: string | null;
  booked: boolean;
  booking: LeadBooking | null;
}

interface ClientStats {
  key: string;
  label: string;
  leads: number;
  dialed: number;
  avgSpeedToLeadSec: number | null;
  medianSpeedToLeadSec: number | null;
  booked: number;
  bookingRate: number | null;
}

interface Report {
  from: string;
  to: string;
  generatedAt: string;
  slackError: string | null;
  clients: ClientStats[];
  leadList: LeadJourney[];
  speedTargetSeconds: number;
}

const REFRESH_MS = 300_000;

// ── ET date helpers ─────────────────────────────────────────────────────────

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
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
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

function fmtPct(rate: number | null) {
  if (rate === null || !Number.isFinite(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

function fmtEtTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function speedColor(seconds: number | null, target: number) {
  if (seconds === null) return "var(--danger)";
  if (seconds <= target) return "var(--success)";
  if (seconds <= 300) return "var(--warning)";
  return "var(--danger)";
}

function titleCase(raw: string) {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function clientShort(offer: string | null) {
  const lower = (offer || "").toLowerCase();
  if (lower.includes("tyson")) return "Tyson";
  if (lower.includes("jake")) return "Jake";
  return offer || "—";
}

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  color: "var(--text-muted)",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  whiteSpace: "nowrap",
};

// ─────────────────────────────────────────────────────────────────────────────

export default function LeadMagnetView() {
  const [preset, setPreset] = useState<PresetKey>("mtd");
  const [customFrom, setCustomFrom] = useState(etToday());
  const [customTo, setCustomTo] = useState(etToday());
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<string | null>(null);

  const range = useMemo(
    () => (preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset)),
    [preset, customFrom, customTo],
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!range.from || !range.to || range.from > range.to) return;
      const url = `/api/lead-magnet?from=${range.from}&to=${range.to}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded by a newer request
        if (!res.ok) throw new Error(body?.error || "Failed to load funnel data");
        setData(body as Report);
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

  const target = data?.speedTargetSeconds ?? 60;

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
      {/* ── Date range ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "4px 0 20px" }}>
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

      {/* ── Setup banner when #fresh-leads is unreadable ── */}
      {data?.slackError ? (
        <div
          className="glass-static"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            marginBottom: 16,
            border: "1px solid rgba(245,158,11,0.35)",
          }}
        >
          <AlertTriangle size={16} style={{ color: "var(--warning)", flexShrink: 0 }} />
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Can&apos;t read #fresh-leads ({data.slackError}). Run{" "}
            <code>/invite @sales_manager</code> in the #fresh-leads Slack channel so the
            dashboard can see the lead pings.
          </span>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="glass-static" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60 }}>
          <Loader2 size={20} style={{ animation: "spin 1s linear infinite", color: "var(--text-muted)" }} />
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>
            Loading funnel (live Slack + GHL pull — long ranges take a minute)...
          </span>
        </div>
      ) : error && !data ? (
        <div className="glass-static" style={{ padding: 24, color: "var(--danger)", fontSize: 14 }}>
          {error}
        </div>
      ) : data ? (
        <>
          {/* ── Per-client metrics ── */}
          <div className="glass-static" style={{ padding: 0, overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <th style={th}>Client</th>
                  <th style={th}>Leads (Skool Joins)</th>
                  <th style={th}>Dialed</th>
                  <th style={th}>Avg Speed to Lead</th>
                  <th style={th}>Booking Rate</th>
                </tr>
              </thead>
              <tbody>
                {data.clients.map((c) => {
                  const isTotal = c.key === "all";
                  return (
                    <tr
                      key={c.key}
                      style={{
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                        borderTop: isTotal ? "1px solid rgba(255,255,255,0.12)" : undefined,
                      }}
                    >
                      <td style={{ padding: "12px 14px", color: "var(--text-primary)", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {c.label}
                      </td>
                      <td style={{ padding: "12px 14px", color: "var(--text-primary)", fontWeight: 600, fontSize: 16 }}>
                        {c.leads}
                      </td>
                      <td style={{ padding: "12px 14px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                        {c.dialed}
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                          {" "}({fmtPct(c.leads ? c.dialed / c.leads : null)})
                        </span>
                      </td>
                      <td
                        style={{
                          padding: "12px 14px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: speedColor(c.avgSpeedToLeadSec, target),
                        }}
                      >
                        {fmtDuration(c.avgSpeedToLeadSec)}
                        <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 12 }}>
                          {" "}· median {fmtDuration(c.medianSpeedToLeadSec)}
                        </span>
                      </td>
                      <td style={{ padding: "12px 14px", color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                        <span style={{ fontWeight: 600, fontSize: 16 }}>{fmtPct(c.bookingRate)}</span>
                        <span style={{ color: "var(--text-muted)", fontSize: 12 }}> ({c.booked} booked)</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Lead-by-lead receipts ── */}
          <div className="glass-static" style={{ padding: 0, overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Lead In (ET)", "Name", "Client", "Setter", "Speed to Lead", "Dials", "Booked"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.leadList.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                      No lead-magnet leads in this range.
                    </td>
                  </tr>
                ) : (
                  data.leadList.map((lead) => (
                    <tr key={lead.slackTs} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                        {fmtEtTime(lead.pingAt)}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-primary)", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {titleCase(lead.name)}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {clientShort(lead.offer)}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {lead.setter || "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: speedColor(lead.speedToLeadSec, target),
                        }}
                      >
                        {lead.speedToLeadSec !== null ? fmtDuration(lead.speedToLeadSec) : "no GHL dial logged"}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>{lead.dials}</td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        {lead.booked && lead.ghlAppointmentAt ? (
                          <span style={{ color: "var(--success)", fontWeight: 600 }}>
                            {fmtEtTime(lead.ghlAppointmentAt)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
