"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CalendarCheck,
  Clock3,
  ExternalLink,
  Loader2,
  PhoneCall,
  Repeat,
  Users,
} from "lucide-react";
import { fmtDollars, fmtNumber, fmtPercent } from "@/lib/formatters";

/* ── Types (mirror lib/sales-hub/setter-view.ts) ──────────────────── */

interface SetRow {
  madeAt: string;
  leadName: string;
  callEtDay: string | null;
  status: string | null;
}

interface FollowupStage {
  stage: number;
  due: number;
  inWindow: number;
  offWindow: number;
  missed: number;
  sent: number;
  replies: number;
  adherenceRate: number | null;
  replyRate: number | null;
}

interface NeedsRow {
  setterLabel: string;
  leadName: string | null;
  subscriberId: string;
  manychatUrl: string | null;
  stage: number;
  dueAt: string;
  closeAt: string;
  overdueMinutes: number;
}

interface SetterViewResult {
  setterKey: string;
  setterLabel: string;
  range: "today" | "yesterday";
  etDay: string;
  leads: { newLeads: number; leadsEngaged: number; callLinksSent: number };
  sets: { count: number; bookingRate: number | null; rows: SetRow[] };
  responseTimes: {
    averageSeconds: number | null;
    medianSeconds: number | null;
    sampleCount: number;
    slowestSeconds: number | null;
    missedCount: number;
    missRate: number | null;
  };
  followups: {
    due: number;
    inWindow: number;
    missed: number;
    sent: number;
    adherenceRate: number | null;
    replyRate: number | null;
    stages: FollowupStage[];
    needsFollowup: NeedsRow[];
  };
  calendar: {
    onCalendar: number;
    taken: number;
    noShows: number;
    showRate: number | null;
    cashCollected: number;
    subsSold: number;
  };
  asOf: string;
}

const REFRESH_MS = 60_000;

const pct = (v: number | null) => (v === null ? "—" : fmtPercent(v));

function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtEt(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ── Component ────────────────────────────────────────────────────── */

export default function SetterViewView({
  token,
  initialLabel,
}: {
  token: string;
  initialLabel: string;
}) {
  const [range, setRange] = useState<"today" | "yesterday">("today");
  const [data, setData] = useState<SetterViewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/setter-view/${token}?range=${range}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [token, range]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  const label = data?.setterLabel || initialLabel;

  return (
    <main className="pub-setter-view-page">
      <div className="pub-sv-shell">
        <div className="pub-sv-head">
          <div>
            <h1 className="pub-sv-title">{label} — My Stats</h1>
            <p className="pub-sv-sub">
              {data ? `${data.etDay} (ET)` : ""}
              {data ? ` · updated ${fmtEt(data.asOf)}` : ""} · refreshes every minute
            </p>
          </div>
          <div className="pub-sv-toggle">
            <button className={range === "today" ? "active" : ""} onClick={() => setRange("today")}>
              Today
            </button>
            <button
              className={range === "yesterday" ? "active" : ""}
              onClick={() => setRange("yesterday")}
            >
              Yesterday
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div className="glass-static" style={{ padding: 48, display: "flex", justifyContent: "center" }}>
            <Loader2 size={22} className="spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : error && !data ? (
          <div className="glass-static" style={{ padding: 24, textAlign: "center", color: "var(--danger)", fontSize: 13 }}>
            Failed to load — {error}
          </div>
        ) : data ? (
          <>
            {/* My day */}
            <SectionTitle icon={<Users size={15} />} text="My Day" />
            <div className="metric-grid metric-grid-4" style={{ marginBottom: 4 }}>
              <Card label="New Leads" value={fmtNumber(data.leads.newLeads)} sub={`${fmtNumber(data.leads.leadsEngaged)} engaged · ${fmtNumber(data.leads.callLinksSent)} call links sent`} />
              <Card label="Sets Booked" value={fmtNumber(data.sets.count)} sub="counted at the moment the lead scheduled" />
              <Card label="Booking Rate" value={pct(data.sets.bookingRate)} sub="sets ÷ new leads" />
              <Card label="Subs Sold" value={fmtNumber(data.calendar.subsSold)} />
            </div>

            {/* Response times */}
            <SectionTitle
              icon={<Clock3 size={15} />}
              text="My Response Times"
              hint="11am–11pm ET · median = average minus the single slowest"
            />
            <div className="metric-grid metric-grid-4" style={{ marginBottom: 4 }}>
              <Card label="Average" value={fmtDuration(data.responseTimes.averageSeconds)} sub={`${fmtNumber(data.responseTimes.sampleCount)} replies`} />
              <Card label="Median" value={fmtDuration(data.responseTimes.medianSeconds)} />
              <Card label="Missed" value={fmtNumber(data.responseTimes.missedCount)} color={data.responseTimes.missedCount > 0 ? "var(--danger)" : undefined} />
              <Card label="Miss Rate" value={pct(data.responseTimes.missRate)} sub={`slowest ${fmtDuration(data.responseTimes.slowestSeconds)}`} />
            </div>

            {/* Calendar day */}
            <SectionTitle icon={<PhoneCall size={15} />} text="My Calls On The Calendar" hint="calls scheduled to happen this day" />
            <div className="metric-grid metric-grid-4" style={{ marginBottom: 4 }}>
              <Card label="On Calendar" value={fmtNumber(data.calendar.onCalendar)} />
              <Card label="Taken" value={fmtNumber(data.calendar.taken)} sub={`${fmtNumber(data.calendar.noShows)} no-shows`} />
              <Card label="Show Rate" value={pct(data.calendar.showRate)} />
              <Card label="Cash Collected" value={fmtDollars(data.calendar.cashCollected)} color="var(--success)" />
            </div>

            {/* Follow-ups */}
            <SectionTitle
              icon={<Repeat size={15} />}
              text="My Follow-ups"
              hint="FU1: 15–60 working min · FU2+: every 24h (22–26h) · only inside the 7-day IG window"
            />
            <div className="metric-grid metric-grid-4" style={{ marginBottom: 12 }}>
              <Card label="Due" value={fmtNumber(data.followups.due)} sub={`${fmtNumber(data.followups.sent)} sent`} />
              <Card label="On Cadence" value={pct(data.followups.adherenceRate)} sub={`${fmtNumber(data.followups.inWindow)} in-window`} />
              <Card label="Missed" value={fmtNumber(data.followups.missed)} color={data.followups.missed > 0 ? "var(--danger)" : undefined} />
              <Card label="Reply Rate" value={pct(data.followups.replyRate)} />
            </div>

            {/* Needs follow-up queue */}
            <SectionTitle icon={<Repeat size={15} />} text="Leads Needing My Follow-Up" hint="most overdue first · Chat opens ManyChat" />
            <div className="glass-static" style={{ overflow: "auto", marginBottom: 4 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Follow-up #</th>
                    <th>Due Since (ET)</th>
                    <th>Overdue</th>
                    <th>Chat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.followups.needsFollowup.map((r) => (
                    <tr key={r.subscriberId}>
                      <td>{r.leadName || "Unknown"}</td>
                      <td>FU{r.stage}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtEt(r.dueAt)}</td>
                      <td style={{ color: r.overdueMinutes > 0 ? "var(--danger)" : "var(--success)", fontWeight: 600 }}>
                        {r.overdueMinutes > 0 ? `${Math.floor(r.overdueMinutes / 60)}h ${r.overdueMinutes % 60}m` : "open now"}
                      </td>
                      <td>
                        {r.manychatUrl ? (
                          <a href={r.manychatUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                            Open <ExternalLink size={12} />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                  {data.followups.needsFollowup.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                        Nothing waiting on you. 🎯
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* My sets list */}
            <SectionTitle icon={<CalendarCheck size={15} />} text="My Sets" />
            <div className="glass-static" style={{ overflow: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Booked At (ET)</th>
                    <th>Lead</th>
                    <th>Call Day</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sets.rows.map((r) => (
                    <tr key={`${r.madeAt}:${r.leadName}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtEt(r.madeAt)}</td>
                      <td>{r.leadName}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.callEtDay || "—"}</td>
                      <td style={{ color: r.status === "cancelled" ? "var(--danger)" : undefined }}>{r.status || "—"}</td>
                    </tr>
                  ))}
                  {data.sets.rows.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                        No sets booked {data.range === "today" ? "yet today" : "yesterday"}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}

/* ── Bits ─────────────────────────────────────────────────────────── */

function SectionTitle({ icon, text, hint }: { icon: ReactNode; text: string; hint?: string }) {
  return (
    <div className="pub-sv-section-title">
      {icon}
      {text}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Card({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  color?: string;
}) {
  return (
    <div className="glass-static metric-card">
      <div className="metric-card-label">{label}</div>
      <div className="metric-card-value" style={color ? { color } : undefined}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.4 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
