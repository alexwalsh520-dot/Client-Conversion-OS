"use client";

// Lead Magnet Funnel — a normal CCOS tab (sidebar stays, no redirect).
//
// The whole funnel on one screen: leads that hit #fresh-leads, how fast the
// phone setters dialed them (speed to lead vs the 1-minute target), whether
// anyone picked up, and the sales-tracker truth downstream — booking rate,
// show rate, close rate, AOV, revenue per lead. Date range: Today / Week to
// Date / Month to Date / Custom — same preset pattern as Setter Response Time.
//
// Data comes from /api/lead-magnet (live Slack + GHL + sales tracker reads).
// While the selected range includes today, the view re-pulls every 2 minutes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronRight,
  Loader2,
  PhoneCall,
} from "lucide-react";

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
  booking: LeadBooking | null;
}

interface SetterStats {
  name: string;
  leadsDialed: number;
  dialedWithinTarget: number;
  avgSpeedToLeadSec: number | null;
  medianSpeedToLeadSec: number | null;
  pickups: number;
  bookings: number;
}

interface FunnelMetrics {
  leads: number;
  dialed: number;
  connected: number;
  booked: number;
  decided: number;
  shows: number;
  wins: number;
  paidWins: number;
  totalCash: number;
  totalRevenue: number;
  avgSpeedToLeadSec: number | null;
  medianSpeedToLeadSec: number | null;
  withinTargetRate: number | null;
  pickupRate: number | null;
  bookingRate: number | null;
  showRate: number | null;
  closeRate: number | null;
  aov: number | null;
  revenuePerLead: number | null;
}

interface Report {
  from: string;
  to: string;
  generatedAt: string;
  slackError: string | null;
  metrics: FunnelMetrics;
  setters: SetterStats[];
  leadList: LeadJourney[];
  unmatchedBookings: LeadBooking[];
  connectMinSeconds: number;
  speedTargetSeconds: number;
}

const REFRESH_MS = 120_000;

// ── ET date helpers (mirror SetterResponseTimesView) ────────────────────────

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

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

function fmtMoney(amount: number | null) {
  if (amount === null || !Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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

// Speed to lead against the 1-minute target: green inside, amber to 5 min,
// red beyond (or never dialed).
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

// ─────────────────────────────────────────────────────────────────────────────

export default function LeadMagnetView() {
  const [preset, setPreset] = useState<PresetKey>("today");
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

  const m = data?.metrics;
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

  const funnelStages = m
    ? [
        { label: "Leads", count: m.leads },
        { label: "Dialed", count: m.dialed },
        { label: "Connected", count: m.connected },
        { label: "Booked", count: m.booked },
        { label: "Showed", count: m.shows },
        { label: "Won", count: m.wins },
      ]
    : [];

  return (
    <div className="fade-up" style={{ maxWidth: 1150 }}>
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
          <span style={{ marginLeft: 10, color: "var(--text-muted)", fontSize: 14 }}>Loading funnel...</span>
        </div>
      ) : error && !data ? (
        <div className="glass-static" style={{ padding: 24, color: "var(--danger)", fontSize: 14 }}>
          {error}
        </div>
      ) : m ? (
        <>
          {/* ── Speed tiles — Leads · Dialed · Dialed ≤60s · Pickup · Booking · Avg STL ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <StatTile label="Leads" value={String(m.leads)} />
            <StatTile
              label="Leads Dialed"
              value={String(m.dialed)}
              sub={`${fmtPct(ratio(m.dialed, m.leads))} of leads · GHL dialer only`}
            />
            <StatTile
              label={`Dialed ≤ ${target}s`}
              value={String(Math.round((m.withinTargetRate ?? 0) * m.leads))}
              sub={`${fmtPct(m.withinTargetRate)} of all leads`}
              color={
                m.withinTargetRate === null
                  ? undefined
                  : m.withinTargetRate >= 0.8
                    ? "var(--success)"
                    : m.withinTargetRate >= 0.5
                      ? "var(--warning)"
                      : "var(--danger)"
              }
            />
            <StatTile
              label="Pickup Rate"
              value={fmtPct(m.pickupRate)}
              sub={`${m.connected} pickups ÷ ${m.dialed} leads dialed`}
            />
            <StatTile
              label="Booking Rate"
              value={fmtPct(m.bookingRate)}
              sub={`${m.booked} of ${m.leads} leads`}
            />
            <StatTile
              label="Avg Speed to Lead"
              value={fmtDuration(m.avgSpeedToLeadSec)}
              sub={`median ${fmtDuration(m.medianSpeedToLeadSec)}`}
              color={speedColor(m.avgSpeedToLeadSec, target)}
            />
          </div>

          {/* ── Sales tiles ── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 20,
            }}
          >
            <StatTile
              label="Show Rate"
              value={fmtPct(m.showRate)}
              sub={`${m.shows} of ${m.decided} decided · ${m.booked - m.decided} upcoming`}
            />
            <StatTile
              label="Close Rate"
              value={fmtPct(m.closeRate)}
              sub={`${m.wins} won of ${m.shows} shows`}
            />
            <StatTile label="Cash Collected" value={fmtMoney(m.totalCash)} sub={`revenue ${fmtMoney(m.totalRevenue)}`} />
            <StatTile label="AOV" value={fmtMoney(m.aov)} sub={`${m.paidWins} paid wins`} />
            <StatTile
              label="Revenue / Lead"
              value={fmtMoney(m.revenuePerLead)}
              sub="cash ÷ leads"
              color={m.revenuePerLead ? "var(--success)" : undefined}
            />
          </div>

          {/* ── Funnel strip ── */}
          <div
            className="glass-static"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "16px 18px",
              marginBottom: 20,
              overflowX: "auto",
            }}
          >
            {funnelStages.map((stage, i) => {
              const prev = i > 0 ? funnelStages[i - 1].count : null;
              const conv = prev ? stage.count / prev : null;
              return (
                <span key={stage.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {i > 0 && (
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "0 6px" }}>
                      <ChevronRight size={14} style={{ color: "var(--text-muted)" }} />
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {prev === 0 ? "—" : fmtPct(conv)}
                      </span>
                    </span>
                  )}
                  <span style={{ textAlign: "center", minWidth: 72 }}>
                    <span style={{ display: "block", fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>
                      {stage.count}
                    </span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {stage.label}
                    </span>
                  </span>
                </span>
              );
            })}
          </div>

          {/* ── By setter ── */}
          {data!.setters.length > 0 && (
            <div className="glass-static" style={{ padding: 0, overflowX: "auto", marginBottom: 20 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    {["Setter", "Leads Dialed", `≤ ${target}s`, "Avg Speed to Lead", "Median", "Pickups", "Bookings"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "10px 14px",
                          color: "var(--text-muted)",
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data!.setters.map((s) => (
                    <tr key={s.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "10px 14px", color: "var(--text-primary)", fontWeight: 600, whiteSpace: "nowrap" }}>
                        {s.name}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>{s.leadsDialed}</td>
                      <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>
                        {s.dialedWithinTarget}
                        {s.leadsDialed > 0 ? (
                          <span style={{ color: "var(--text-muted)" }}>
                            {" "}({fmtPct(ratio(s.dialedWithinTarget, s.leadsDialed))})
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          padding: "10px 14px",
                          fontWeight: 600,
                          whiteSpace: "nowrap",
                          color: speedColor(s.avgSpeedToLeadSec, target),
                        }}
                      >
                        {fmtDuration(s.avgSpeedToLeadSec)}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {fmtDuration(s.medianSpeedToLeadSec)}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>{s.pickups}</td>
                      <td style={{ padding: "10px 14px", color: s.bookings > 0 ? "var(--success)" : "var(--text-secondary)", fontWeight: s.bookings > 0 ? 600 : 400 }}>
                        {s.bookings}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Lead-by-lead table ── */}
          <div className="glass-static" style={{ padding: 0, overflowX: "auto", marginBottom: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  {["Lead In (ET)", "Name", "Setter", "Speed to Lead", "Dials", "Pickup", "Booked", "Call Taken", "Outcome", "Cash"].map(
                    (h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "10px 14px",
                          color: "var(--text-muted)",
                          fontSize: 11,
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data!.leadList.length === 0 ? (
                  <tr>
                    <td colSpan={10} style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                      No lead-magnet leads in this range.
                    </td>
                  </tr>
                ) : (
                  data!.leadList.map((lead) => (
                    <tr key={lead.slackTs} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "var(--text-secondary)" }}>
                        {fmtEtTime(lead.pingAt)}
                      </td>
                      <td style={{ padding: "10px 14px", color: "var(--text-primary)", fontWeight: 500, whiteSpace: "nowrap" }}>
                        {titleCase(lead.name)}
                        {!lead.ghlContactId && (
                          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}> · no GHL match</span>
                        )}
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
                        {lead.connected ? (
                          <span style={{ color: "var(--success)", display: "inline-flex", alignItems: "center", gap: 5 }}>
                            <PhoneCall size={13} /> {fmtDuration(lead.longestCallSec)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>
                            {lead.dials > 0 ? "no pickup" : "—"}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        {lead.booking ? (
                          <span style={{ color: "var(--text-primary)" }}>
                            {lead.booking.date.slice(5)} · {titleCase(lead.booking.closer || "?")}
                          </span>
                        ) : lead.ghlAppointmentAt ? (
                          <span style={{ color: "var(--warning)" }} title="Appointment exists in GHL but no phone-set row in the sales tracker yet">
                            GHL appt only
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        {!lead.booking ? (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        ) : lead.booking.callTakenStatus === "yes" ? (
                          <span style={{ color: "var(--success)" }}>Showed</span>
                        ) : lead.booking.callTakenStatus === "no" ? (
                          <span style={{ color: "var(--danger)" }}>No show</span>
                        ) : (
                          <span style={{ color: "var(--warning)" }}>Upcoming</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap" }}>
                        {lead.booking?.outcome ? (
                          <span
                            style={{
                              color:
                                lead.booking.outcome === "WIN"
                                  ? "var(--success)"
                                  : "var(--text-secondary)",
                              fontWeight: lead.booking.outcome === "WIN" ? 600 : 400,
                            }}
                          >
                            {lead.booking.outcome}
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px", whiteSpace: "nowrap", color: "var(--text-primary)" }}>
                        {lead.booking && lead.booking.cashCollected > 0
                          ? fmtMoney(lead.booking.cashCollected)
                          : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* ── Phone-set bookings that didn't match a Slack lead ── */}
          {data!.unmatchedBookings.length > 0 && (
            <div className="glass-static" style={{ padding: "14px 18px", marginBottom: 20 }}>
              <p style={{ color: "var(--text-secondary)", fontSize: 13, margin: "0 0 8px", fontWeight: 600 }}>
                Phone-set bookings in the tracker with no matching #fresh-leads ping (
                {data!.unmatchedBookings.length})
              </p>
              <p style={{ color: "var(--text-muted)", fontSize: 12, margin: "0 0 10px" }}>
                Usually a name typed differently in the sales tracker than in Slack — these are
                not counted in the funnel above.
              </p>
              {data!.unmatchedBookings.map((b, i) => (
                <div key={i} style={{ fontSize: 13, color: "var(--text-secondary)", padding: "3px 0" }}>
                  {b.date} · {titleCase(b.closer || "?")} · {b.callType.trim()} ·{" "}
                  {b.callTakenStatus === "pending" ? "upcoming" : b.callTakenStatus === "yes" ? "showed" : "no show"}
                  {b.outcome ? ` · ${b.outcome}` : ""}
                  {b.cashCollected > 0 ? ` · ${fmtMoney(b.cashCollected)}` : ""}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function StatTile({
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
    <div className="metric-card">
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value" style={color ? { color } : undefined}>
        {value}
      </div>
      {sub ? (
        <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  );
}
