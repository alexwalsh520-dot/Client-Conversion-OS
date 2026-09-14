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
import { DateDropdown } from "@/app/ads-v2/controls";
import { rangeForPreset, todayEt, shiftDay, type DayRange, type PresetId } from "@/lib/ads-v2/time";
// Every rule in ads-v2.css is scoped under .adsv2, so importing it here
// styles only the date-dropdown wrapper below.
import "@/app/ads-v2/ads-v2.css";

/* ── Types (mirror lib/sales-hub/setter-view.ts) ──────────────────── */

interface RowStats {
  key: string;
  label: string;
  newLeads: number;
  leadsEngaged: number;
  callLinksSent: number;
  sets: number;
  bookingRate: number | null;
  subsSold: number;
  rt: {
    averageSeconds: number | null;
    medianSeconds: number | null;
    sampleCount: number;
    slowestSeconds: number | null;
    missedCount: number;
    missRate: number | null;
  };
  cal: {
    onCalendar: number;
    taken: number;
    noShows: number;
    showRate: number | null;
    cashCollected: number;
  };
  fu: {
    due: number;
    inWindow: number;
    missed: number;
    sent: number;
    adherenceRate: number | null;
    replyRate: number | null;
  };
}

interface NeedsRow {
  setterLabel: string;
  leadName: string | null;
  subscriberId: string;
  manychatUrl: string | null;
  stage: number;
  dueAt: string;
  overdueMinutes: number;
}

interface SetRow {
  madeAt: string;
  leadName: string;
  setterLabel: string;
  callEtDay: string | null;
  status: string | null;
}

interface TeamViewResult {
  dateFrom: string;
  dateTo: string;
  minDay: string;
  setters: RowStats[];
  team: RowStats;
  needsFollowup: NeedsRow[];
  sets: SetRow[];
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
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ── Component ────────────────────────────────────────────────────── */

export default function SetterViewView({ token }: { token: string }) {
  // Same picker as the Sales Hub, floored at yesterday (ET).
  const minDay = shiftDay(todayEt(), -1);
  const [preset, setPreset] = useState<PresetId>("today");
  const [range, setRange] = useState<DayRange>(() => rangeForPreset("today", todayEt()));
  const [data, setData] = useState<TeamViewResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/public/setter-view/${token}?dateFrom=${range.from}&dateTo=${range.to}`,
      );
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

  const rows = data ? [...data.setters, data.team] : [];

  return (
    <main className="pub-setter-view-page">
      <div className="pub-sv-shell">
        <div className="pub-sv-head">
          <div>
            <h1 className="pub-sv-title">Setter Stats</h1>
            <p className="pub-sv-sub">
              {data ? `${data.dateFrom === data.dateTo ? data.dateFrom : `${data.dateFrom} → ${data.dateTo}`} (ET)` : ""}
              {data ? ` · updated ${fmtEt(data.asOf)}` : ""} · refreshes every minute
            </p>
          </div>
          <div
            className="adsv2"
            style={{ padding: 0, background: "transparent", minHeight: 0, flexShrink: 0 }}
          >
            <DateDropdown
              preset={preset}
              range={range}
              minDay={minDay}
              onApply={(p, r) => {
                setPreset(p);
                setRange(r);
              }}
            />
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
            {/* Leads + sets */}
            <SectionTitle icon={<Users size={15} />} text="Leads & Sets" hint="sets counted at the moment the lead scheduled" />
            <div className="glass-static" style={{ overflow: "auto", marginBottom: 4 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Setter</th>
                    <th>New Leads</th>
                    <th>Engaged</th>
                    <th>Call Links</th>
                    <th>Sets Booked</th>
                    <th>Booking Rate</th>
                    <th>Subs Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={r.key === "team" ? { fontWeight: 700 } : undefined}>
                      <td style={{ fontWeight: 600 }}>{r.label}</td>
                      <td>{fmtNumber(r.newLeads)}</td>
                      <td>{fmtNumber(r.leadsEngaged)}</td>
                      <td>{fmtNumber(r.callLinksSent)}</td>
                      <td>{fmtNumber(r.sets)}</td>
                      <td>{pct(r.bookingRate)}</td>
                      <td>{fmtNumber(r.subsSold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Response times */}
            <SectionTitle
              icon={<Clock3 size={15} />}
              text="Response Times"
              hint="11am–11pm ET · median = average minus the single slowest"
            />
            <div className="glass-static" style={{ overflow: "auto", marginBottom: 4 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Setter</th>
                    <th>Average</th>
                    <th>Median</th>
                    <th>Replies</th>
                    <th>Missed</th>
                    <th>Miss Rate</th>
                    <th>Slowest</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={r.key === "team" ? { fontWeight: 700 } : undefined}>
                      <td style={{ fontWeight: 600 }}>{r.label}</td>
                      <td>{fmtDuration(r.rt.averageSeconds)}</td>
                      <td>{fmtDuration(r.rt.medianSeconds)}</td>
                      <td>{fmtNumber(r.rt.sampleCount)}</td>
                      <td style={{ color: r.rt.missedCount > 0 ? "var(--danger)" : undefined }}>
                        {fmtNumber(r.rt.missedCount)}
                      </td>
                      <td>{pct(r.rt.missRate)}</td>
                      <td>{fmtDuration(r.rt.slowestSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Calendar */}
            <SectionTitle icon={<PhoneCall size={15} />} text="Calls On The Calendar" hint="calls scheduled to happen in the range · cash counts as taken" />
            <div className="glass-static" style={{ overflow: "auto", marginBottom: 4 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Setter</th>
                    <th>On Calendar</th>
                    <th>Taken</th>
                    <th>No Shows</th>
                    <th>Show Rate</th>
                    <th>Cash</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={r.key === "team" ? { fontWeight: 700 } : undefined}>
                      <td style={{ fontWeight: 600 }}>{r.label}</td>
                      <td>{fmtNumber(r.cal.onCalendar)}</td>
                      <td>{fmtNumber(r.cal.taken)}</td>
                      <td style={{ color: r.cal.noShows > 0 ? "var(--danger)" : undefined }}>
                        {fmtNumber(r.cal.noShows)}
                      </td>
                      <td>{pct(r.cal.showRate)}</td>
                      <td style={{ color: "var(--success)", fontWeight: 600 }}>{fmtDollars(r.cal.cashCollected)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Follow-ups */}
            <SectionTitle
              icon={<Repeat size={15} />}
              text="Follow-ups"
              hint="FU1: 15–60 working min · FU2+: every 24h (22–26h) · only inside the 7-day IG window"
            />
            <div className="glass-static" style={{ overflow: "auto", marginBottom: 4 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Setter</th>
                    <th>Due</th>
                    <th>Sent</th>
                    <th>On Cadence</th>
                    <th>Missed</th>
                    <th>Reply Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={r.key === "team" ? { fontWeight: 700 } : undefined}>
                      <td style={{ fontWeight: 600 }}>{r.label}</td>
                      <td>{fmtNumber(r.fu.due)}</td>
                      <td>{fmtNumber(r.fu.sent)}</td>
                      <td>{pct(r.fu.adherenceRate)}</td>
                      <td style={{ color: r.fu.missed > 0 ? "var(--danger)" : undefined }}>
                        {fmtNumber(r.fu.missed)}
                      </td>
                      <td>{pct(r.fu.replyRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Needs follow-up queue */}
            <SectionTitle icon={<Repeat size={15} />} text="Leads Needing Follow-Up" hint="whole team · most overdue first · Chat opens ManyChat" />
            <div className="glass-static" style={{ overflow: "auto", marginBottom: 4 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Setter</th>
                    <th>Follow-up #</th>
                    <th>Due Since (ET)</th>
                    <th>Overdue</th>
                    <th>Chat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.needsFollowup.map((r) => (
                    <tr key={r.subscriberId}>
                      <td>{r.leadName || "Unknown"}</td>
                      <td>{r.setterLabel}</td>
                      <td>FU{r.stage}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtEt(r.dueAt)}</td>
                      <td style={{ color: r.overdueMinutes > 0 ? "var(--danger)" : "var(--success)", fontWeight: 600 }}>
                        {r.overdueMinutes > 0
                          ? `${Math.floor(r.overdueMinutes / 60)}h ${r.overdueMinutes % 60}m`
                          : "open now"}
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
                  {data.needsFollowup.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                        Nothing waiting. 🎯
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Sets log */}
            <SectionTitle icon={<CalendarCheck size={15} />} text="Sets Log" />
            <div className="glass-static" style={{ overflow: "auto" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Booked At (ET)</th>
                    <th>Lead</th>
                    <th>Setter</th>
                    <th>Call Day</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.sets.map((r) => (
                    <tr key={`${r.madeAt}:${r.leadName}`}>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtEt(r.madeAt)}</td>
                      <td>{r.leadName}</td>
                      <td>{r.setterLabel}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.callEtDay || "—"}</td>
                      <td style={{ color: r.status === "cancelled" ? "var(--danger)" : undefined }}>{r.status || "—"}</td>
                    </tr>
                  ))}
                  {data.sets.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                        No sets booked in this range.
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
