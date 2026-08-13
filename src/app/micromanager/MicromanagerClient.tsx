"use client";

// Alex Micromanager: private daily sales-manager visibility.
// Reviews are produced by Utari's cron through the MCP tools; this page only displays.

import React, { useState, useEffect, useCallback, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, Info, Loader2, Check } from "lucide-react";
import { ReviewMarkdown } from "../sales-hub/components/ReviewMarkdown";

/* ---------------------------------- types ---------------------------------- */

interface CallRow {
  fathomId: string;
  time: string;
  title: string;
  prospect: string;
  closer: string | null;
  outcome: string | null;
  durationMin: number | null;
  grade: number | null;
  adherence: number | null;
  reviewed: boolean;
}

interface SetterRow {
  name: string;
  client: string;
  leads: number;
  booked: number;
  bookingRate: number | null;
  avgResponseMin: number | null;
  responseSamples: number;
}

interface Overview {
  date: string;
  calls: CallRow[];
  admin: {
    pct: number;
    tracker: { pct: number | null; filled: number; total: number; rows: number };
    eod: { pct: number | null; submitted: number; expected: number };
  };
  setters: SetterRow[];
  day: {
    calls: number;
    leads: number;
    booked: number;
    bookingRate: number | null;
    avgResponseMin: number | null;
    responseSamples: number;
  };
  adherence: {
    closers: { name: string; adherence: number | null; grade: number | null; calls: number }[];
    setters: { name: string; adherence: number | null; convos: number }[];
  };
  scripts: { closer: boolean; setter: boolean };
}

interface ReviewDetail {
  review_md: string;
  grade: number | null;
  adherence_score: number | null;
  adherence_notes: string | null;
  model: string | null;
}

/* -------------------------------- helpers --------------------------------- */

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

function fmtMinutes(min: number | null): string {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)}m`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
}

function scoreColor(v: number | null): string {
  if (v == null) return "var(--text-muted)";
  if (v >= 80) return "var(--success, #4ade80)";
  if (v >= 60) return "var(--accent)";
  return "var(--danger, #f87171)";
}

/* ----------------------------- tiny components ----------------------------- */

function InfoTip({ text }: { text: string }) {
  return (
    <span className="mm-tip" tabIndex={0}>
      <Info size={12} />
      <span className="mm-tip-body">{text}</span>
    </span>
  );
}

function StatTile({ label, value, sub, tip }: { label: string; value: ReactNode; sub?: string; tip?: string }) {
  return (
    <div
      style={{
        flex: 1, minWidth: 150, padding: "14px 16px", borderRadius: 12,
        border: "1px solid var(--border-subtle)", background: "var(--bg-card)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, color: "var(--text-muted)" }}>
        {label}
        {tip && <InfoTip text={tip} />}
      </div>
      <div style={{ fontSize: 24, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.5px", marginTop: 4 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SectionTitle({ children, tip }: { children: ReactNode; tip?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "26px 0 10px" }}>
      <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)" }}>
        {children}
      </span>
      {tip && <InfoTip text={tip} />}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 600,
  color: "var(--text-muted)", letterSpacing: "0.4px", textTransform: "uppercase",
  borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap",
};
const td: React.CSSProperties = {
  padding: "10px 12px", fontSize: 13, color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap",
};

function ScoreChip({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "var(--text-muted)" }}>{"—"}</span>;
  return <span style={{ fontWeight: 600, color: scoreColor(value) }}>{value}</span>;
}

/* ------------------------------ script editor ------------------------------ */

function ScriptCard({ role, label }: { role: "closer" | "setter"; label: string }) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/micromanager/scripts")
      .then((r) => r.json())
      .then((d) => {
        const s = d?.[role];
        if (s?.content) { setContent(s.content); setSavedAt(s.updatedAt); }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [role]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/micromanager/scripts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, content }),
      });
      if (res.ok) { setSavedAt(new Date().toISOString()); setEditing(false); }
    } finally {
      setSaving(false);
    }
  };

  const hasScript = !!content.trim();

  return (
    <div style={{ flex: 1, minWidth: 280, borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          {label}
          <InfoTip text="Wrap must-say lines in **double asterisks**. Grading is strict on those, lenient everywhere else." />
        </div>
        <span style={{ fontSize: 11, color: hasScript ? "var(--success, #4ade80)" : "var(--text-muted)" }}>
          {hasScript ? "Grading active" : "No script yet"}
        </span>
      </div>

      {!loaded ? (
        <Loader2 size={14} className="spin" style={{ color: "var(--text-muted)" }} />
      ) : editing ? (
        <>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            placeholder="Paste the script here."
            style={{
              width: "100%", resize: "vertical", padding: 10, borderRadius: 8, fontSize: 12.5, lineHeight: 1.5,
              border: "1px solid var(--border-primary)", background: "var(--bg-primary, transparent)",
              color: "var(--text-primary)", fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={save} disabled={saving} style={{
              display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", borderRadius: 7,
              border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              {saving ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Save
            </button>
            <button onClick={() => setEditing(false)} style={{
              padding: "6px 14px", borderRadius: 7, border: "1px solid var(--border-primary)",
              background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer",
            }}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {hasScript
              ? `${content.trim().split(/\s+/).length} words${savedAt ? ` · updated ${new Date(savedAt).toLocaleDateString()}` : ""}`
              : "Adherence grading starts once a script is saved."}
          </span>
          <button onClick={() => setEditing(true)} style={{
            padding: "5px 12px", borderRadius: 7, border: "1px solid var(--border-primary)",
            background: "var(--hover-bg-subtle)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}>
            {hasScript ? "Edit" : "Add script"}
          </button>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- page ----------------------------------- */

export default function MicromanagerClient() {
  const [date, setDate] = useState(todayEt());
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openCall, setOpenCall] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, ReviewDetail | "loading" | "missing">>({});

  const load = useCallback(async (d: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/micromanager/overview?date=${d}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(date); }, [date, load]);

  const toggleCall = async (id: string) => {
    if (openCall === id) { setOpenCall(null); return; }
    setOpenCall(id);
    if (!reviews[id]) {
      setReviews((r) => ({ ...r, [id]: "loading" }));
      try {
        const res = await fetch(`/api/micromanager/review?fathomId=${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        setReviews((r) => ({ ...r, [id]: json.review }));
      } catch {
        setReviews((r) => ({ ...r, [id]: "missing" }));
      }
    }
  };

  const isToday = date === todayEt();

  return (
    <div className="fade-up">
      <style>{`
        .mm-tip { position: relative; display: inline-flex; align-items: center; color: var(--text-muted); cursor: default; }
        .mm-tip .mm-tip-body {
          display: none; position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%);
          width: 230px; padding: 8px 10px; border-radius: 8px; z-index: 40;
          background: var(--bg-card); border: 1px solid var(--border-primary);
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
          font-size: 11.5px; line-height: 1.45; font-weight: 400; color: var(--text-secondary);
          white-space: normal; text-transform: none; letter-spacing: 0;
        }
        .mm-tip:hover .mm-tip-body, .mm-tip:focus .mm-tip-body { display: block; }
        .mm-row { cursor: pointer; transition: background 0.12s ease; }
        .mm-row:hover { background: var(--hover-bg-subtle); }
      `}</style>

      {/* Header */}
      <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="page-title">Micromanager</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button onClick={() => setDate(shiftDate(date, -1))} style={navBtn}><ChevronLeft size={15} /></button>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", minWidth: 106, textAlign: "center" }}>
            {fmtDay(date)}
          </span>
          <button onClick={() => setDate(shiftDate(date, 1))} disabled={isToday} style={{ ...navBtn, opacity: isToday ? 0.35 : 1 }}>
            <ChevronRight size={15} />
          </button>
          {!isToday && (
            <button onClick={() => setDate(todayEt())} style={{ ...navBtn, width: "auto", padding: "0 10px", fontSize: 12, fontWeight: 500 }}>
              Today
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", marginBottom: 16, borderRadius: 8, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: "40px 0" }}>
          <Loader2 size={15} className="spin" /> Loading
        </div>
      ) : data && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s ease" }}>
          {/* Stat tiles */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <StatTile
              label="Calls"
              value={data.day.calls}
              sub={`${data.calls.filter((c) => c.reviewed).length} reviewed`}
              tip="Sales calls recorded in Fathom this day. Reviews arrive from the daily Utari analysis run."
            />
            <StatTile
              label="Admin"
              value={`${data.admin.pct}%`}
              sub={
                data.admin.tracker.total > 0
                  ? `tracker ${data.admin.tracker.filled}/${data.admin.tracker.total} fields · ${data.admin.tracker.rows} calls`
                  : "no taken calls to log"
              }
              tip="Admin work done. Blend of sales tracker completeness (closer, setter, outcome, length, notes on each taken call) and EOD reports submitted vs the trailing 14-day roster. Nothing to grade reads 100%."
            />
            <StatTile
              label="Setter response"
              value={fmtMinutes(data.day.avgResponseMin)}
              sub={data.day.responseSamples > 0 ? `${data.day.responseSamples} lead responses` : "no responses measured"}
              tip="Average time for a setter's first reply to a new lead this day, weighted across setters."
            />
            <StatTile
              label="Booked"
              value={`${data.day.booked} / ${data.day.leads}`}
              sub={data.day.bookingRate != null ? `${data.day.bookingRate}% of leads` : "no leads this day"}
              tip="Calls booked out of new leads this day, all setters combined."
            />
          </div>

          {/* Calls */}
          <SectionTitle tip="Every sales call taken this day. Click a row for the full Sales Manager review: Stop / Start / Keep, objection handling, red flags, drills.">
            Calls
          </SectionTitle>
          <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", overflowX: "auto" }}>
            {data.calls.length === 0 ? (
              <div style={{ padding: "22px 16px", fontSize: 13, color: "var(--text-muted)" }}>No sales calls recorded this day.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Time</th>
                    <th style={th}>Prospect</th>
                    <th style={th}>Closer</th>
                    <th style={th}>Outcome</th>
                    <th style={th}>Length</th>
                    <th style={th}>Grade</th>
                    <th style={th}>Script</th>
                    <th style={{ ...th, width: 30 }} />
                  </tr>
                </thead>
                <tbody>
                  {data.calls.map((c) => {
                    const open = openCall === c.fathomId;
                    const detail = reviews[c.fathomId];
                    return (
                      <React.Fragment key={c.fathomId}>
                        <tr className="mm-row" onClick={() => toggleCall(c.fathomId)}>
                          <td style={td}>{fmtTime(c.time)}</td>
                          <td style={{ ...td, color: "var(--text-primary)", fontWeight: 500, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {c.prospect}
                          </td>
                          <td style={td}>{c.closer || "—"}</td>
                          <td style={td}>{c.outcome || (c.reviewed ? "—" : <span style={{ color: "var(--text-muted)" }}>pending review</span>)}</td>
                          <td style={td}>{c.durationMin != null ? `${c.durationMin}m` : "—"}</td>
                          <td style={td}><ScoreChip value={c.grade} /></td>
                          <td style={td}><ScoreChip value={c.adherence} /></td>
                          <td style={{ ...td, color: "var(--text-muted)" }}>
                            <ChevronDown size={14} style={{ transition: "transform 0.2s ease", transform: open ? "rotate(180deg)" : "none" }} />
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={8} style={{ ...td, whiteSpace: "normal", background: "var(--hover-bg-subtle)", padding: "18px 20px" }}>
                              {detail === "loading" ? (
                                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-muted)" }}>
                                  <Loader2 size={13} className="spin" /> Loading review
                                </span>
                              ) : detail === "missing" || !detail ? (
                                <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                                  Not reviewed yet. The Utari run picks this call up on its next pass.
                                </span>
                              ) : (
                                <div style={{ maxWidth: 780 }}>
                                  {detail.adherence_notes && (
                                    <div style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--border-subtle)", fontSize: 12.5, color: "var(--text-secondary)" }}>
                                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Script adherence: </span>
                                      {detail.adherence_notes}
                                    </div>
                                  )}
                                  <ReviewMarkdown content={detail.review_md} />
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Setters */}
          <SectionTitle tip="Per-setter numbers for this day, from the same data as the Sales Hub setter report.">
            Setters
          </SectionTitle>
          <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", overflowX: "auto" }}>
            {data.setters.length === 0 ? (
              <div style={{ padding: "22px 16px", fontSize: 13, color: "var(--text-muted)" }}>No setter data for this day.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Setter</th>
                    <th style={th}>Leads</th>
                    <th style={th}>Booked</th>
                    <th style={th}>Booking rate</th>
                    <th style={th}>Avg response</th>
                    <th style={th}>Script</th>
                  </tr>
                </thead>
                <tbody>
                  {data.setters.map((s) => {
                    const adh = data.adherence.setters.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
                    return (
                      <tr key={`${s.name}-${s.client}`}>
                        <td style={{ ...td, color: "var(--text-primary)", fontWeight: 500 }}>{s.name}</td>
                        <td style={td}>{s.leads}</td>
                        <td style={td}>{s.booked}</td>
                        <td style={td}>{s.bookingRate != null ? `${s.bookingRate}%` : "—"}</td>
                        <td style={td}>{fmtMinutes(s.avgResponseMin)}</td>
                        <td style={td}><ScoreChip value={adh?.adherence ?? null} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Script adherence */}
          <SectionTitle tip="Paste the scripts here. Utari grades every call and DM conversation against them on its daily run; scores land in the tables above. The Script columns stay empty until then.">
            Script adherence
          </SectionTitle>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <ScriptCard role="closer" label="Closer call script" />
            <ScriptCard role="setter" label="Setter DM script" />
          </div>

          {/* Closer rollup, only once reviews exist */}
          {data.adherence.closers.length > 0 && (
            <>
              <SectionTitle tip="Trailing 30 days of reviewed calls per closer: average call grade and script adherence.">
                Closers, last 30 days
              </SectionTitle>
              <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Closer</th>
                      <th style={th}>Calls reviewed</th>
                      <th style={th}>Avg grade</th>
                      <th style={th}>Script</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.adherence.closers.map((c) => (
                      <tr key={c.name}>
                        <td style={{ ...td, color: "var(--text-primary)", fontWeight: 500 }}>{c.name}</td>
                        <td style={td}>{c.calls}</td>
                        <td style={td}><ScoreChip value={c.grade} /></td>
                        <td style={td}><ScoreChip value={c.adherence} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center",
  width: 28, height: 28, borderRadius: 7,
  border: "1px solid var(--border-primary)", background: "var(--hover-bg-subtle)",
  color: "var(--text-secondary)", cursor: "pointer",
};
