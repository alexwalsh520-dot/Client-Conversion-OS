"use client";

// Deal Analysis (formerly Micromanager): every sales call reviewed by the AI
// sales manager, browsable like a deal pipeline. Alex + Matt only.
// Layout: period-wide deal table -> full-page deal detail with parsed review
// tabs and a grade rail. Day ops (admin %, setters, scripts) live below.

import React, { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import {
  ChevronLeft, ChevronRight, ChevronDown, Info, Loader2, Check, Search, ArrowLeft,
} from "lucide-react";
import { ReviewMarkdown } from "../sales-hub/components/ReviewMarkdown";

/* ---------------------------------- types ---------------------------------- */

interface Deal {
  fathomId: string;
  date: string | null;
  time: string | null;
  prospect: string;
  title: string | null;
  closer: string | null;
  outcome: string | null;
  grade: number | null;
  adherence: number | null;
  durationMin: number | null;
  reviewed: boolean;
}

interface CloserRollup {
  name: string; calls: number; avgGrade: number | null; avgAdherence: number | null;
  won: number; closeRate: number | null;
}

interface DealsPayload {
  days: number;
  deals: Deal[];
  stats: { reviewed: number; queued: number; inFlight: number; avgGrade: number | null; won: number; closeRate: number | null };
  closers: CloserRollup[];
  digest: { date: string; md: string; reviewCount: number | null } | null;
}

interface ReviewDetail {
  review_md: string;
  grade: number | null;
  adherence_score: number | null;
  adherence_notes: string | null;
  model: string | null;
  created_at?: string | null;
}

interface OverviewDay {
  date: string;
  admin: {
    pct: number;
    tracker: { pct: number | null; filled: number; total: number; rows: number };
    eod: { pct: number | null; submitted: number; expected: number };
  };
  setters: { name: string; client: string; leads: number; booked: number; bookingRate: number | null; avgResponseMin: number | null; responseSamples: number }[];
  day: { calls: number; leads: number; booked: number; bookingRate: number | null; avgResponseMin: number | null; responseSamples: number };
  adherence: { setters: { name: string; adherence: number | null; convos: number }[] };
}

/* -------------------------------- helpers --------------------------------- */

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function fmtDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: iso.length <= 10 ? "UTC" : "America/New_York",
  });
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
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

function gradeLabel(v: number | null): string {
  if (v == null) return "";
  if (v >= 85) return "Exceptional";
  if (v >= 70) return "Strong";
  if (v >= 55) return "Mixed";
  return "Needs work";
}

const STAGE: Record<string, { label: string; fg: string; bg: string }> = {
  "won": { label: "Closed", fg: "var(--success, #4ade80)", bg: "rgba(74,222,128,0.12)" },
  "follow-up": { label: "Follow Up", fg: "var(--accent)", bg: "var(--accent-soft, rgba(201,169,110,0.12))" },
  "lost": { label: "No Close", fg: "var(--danger, #f87171)", bg: "rgba(248,113,113,0.12)" },
  "no-show": { label: "No Show", fg: "var(--text-muted)", bg: "var(--hover-bg-subtle)" },
  "unclear": { label: "Unclear", fg: "var(--text-muted)", bg: "var(--hover-bg-subtle)" },
};

function stageOf(outcome: string | null, reviewed: boolean) {
  if (!reviewed) return { label: "In queue", fg: "var(--text-muted)", bg: "transparent", outline: true };
  const key = String(outcome || "unclear").toLowerCase().replace(/\s+/g, "-");
  return { ...(STAGE[key] || STAGE["unclear"]), outline: false };
}

/** Split a review into its numbered OUTPUT FORMAT sections. Defensive: if the
 *  markdown doesn't match, callers fall back to the full text. */
function parseReviewSections(md: string): Record<number, { title: string; body: string }> {
  const lines = md.split("\n");
  const out: Record<number, { title: string; body: string }> = {};
  let current: number | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current != null) out[current] = { ...out[current], body: buf.join("\n").trim() };
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(/^\s{0,3}(?:#{1,4}\s*)?\**\s*(\d{1,2})[.)]\s+([^*#].*?)\**\s*$/);
    const num = m ? Number(m[1]) : NaN;
    if (m && num >= 1 && num <= 12 && m[2].trim().length > 2 && m[2].trim().length < 60) {
      flush();
      current = num;
      out[num] = { title: m[2].trim(), body: "" };
    } else if (current != null) {
      buf.push(line);
    }
  }
  flush();
  return out;
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
    <div style={{
      flex: 1, minWidth: 150, padding: "14px 16px", borderRadius: 12,
      border: "1px solid var(--border-subtle)", background: "var(--bg-card)",
    }}>
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
  padding: "11px 12px", fontSize: 13, color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border-subtle)", whiteSpace: "nowrap",
};

function ScoreChip({ value }: { value: number | null }) {
  if (value == null) return <span style={{ color: "var(--text-muted)" }}>{"—"}</span>;
  return <span style={{ fontWeight: 600, color: scoreColor(value), fontVariantNumeric: "tabular-nums" }}>{value}</span>;
}

function StagePill({ outcome, reviewed }: { outcome: string | null; reviewed: boolean }) {
  const s = stageOf(outcome, reviewed);
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
      color: s.fg, background: s.bg, whiteSpace: "nowrap",
      border: s.outline ? "1px dashed var(--border-primary)" : "1px solid transparent",
    }}>
      {s.label}
    </span>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ height: 5, borderRadius: 999, background: "var(--hover-bg-subtle)", overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: "100%", borderRadius: 999, background: color }} />
    </div>
  );
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

/* ------------------------------- deal detail -------------------------------- */

const DETAIL_TABS: { key: string; label: string; sections: number[] }[] = [
  { key: "overview", label: "Overview", sections: [1] },
  { key: "coaching", label: "Stop / Start / Keep", sections: [2, 3, 4] },
  { key: "deep", label: "Deep Dive", sections: [5, 6, 7, 8, 9] },
  { key: "flags", label: "Red Flags & Drills", sections: [10, 11] },
  { key: "rewrite", label: "Rewrite", sections: [12] },
];

function DealDetail({ deal, onBack }: { deal: Deal; onBack: () => void }) {
  const [detail, setDetail] = useState<ReviewDetail | "loading" | "missing">("loading");
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let alive = true;
    setDetail("loading");
    fetch(`/api/micromanager/review?fathomId=${encodeURIComponent(deal.fathomId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (alive) setDetail(j.review); })
      .catch(() => { if (alive) setDetail("missing"); });
    return () => { alive = false; };
  }, [deal.fathomId]);

  const sections = useMemo(
    () => (typeof detail === "object" && detail ? parseReviewSections(detail.review_md) : {}),
    [detail]
  );
  const parsedTabs = DETAIL_TABS.filter((t) => t.sections.some((n) => sections[n]?.body));
  const showTabs = parsedTabs.length >= 3;
  const tabs = showTabs ? [...parsedTabs, { key: "full", label: "Full Review", sections: [] }] : [];
  const activeTab = tabs.find((t) => t.key === tab) || tabs[0];

  const grade = typeof detail === "object" && detail ? detail.grade : deal.grade;
  const adherence = typeof detail === "object" && detail ? detail.adherence_score : deal.adherence;

  return (
    <div className="fade-up">
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 7, marginBottom: 18,
        border: "1px solid var(--border-primary)", background: "var(--hover-bg-subtle)",
        color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 500, cursor: "pointer",
      }}>
        <ArrowLeft size={14} /> Back to Deal Analysis
      </button>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 6 }}>
            {deal.prospect}
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)", flexWrap: "wrap" }}>
            <StagePill outcome={deal.outcome} reviewed={deal.reviewed} />
            {deal.closer && <span>Closer: <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>{deal.closer}</span></span>}
            <span>{fmtDate(deal.time || deal.date)}{deal.time ? ` · ${fmtTime(deal.time)}` : ""}</span>
            {deal.durationMin != null && <span>{deal.durationMin}m</span>}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Review body */}
        <div style={{ flex: "1 1 560px", minWidth: 0 }}>
          {detail === "loading" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: "40px 0" }}>
              <Loader2 size={15} className="spin" /> Loading review
            </div>
          ) : detail === "missing" ? (
            <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", padding: "22px 20px", fontSize: 13, color: "var(--text-muted)" }}>
              Not reviewed yet. The analyzer works newest-first around the clock; this call is in line.
            </div>
          ) : (
            <>
              {showTabs && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 14 }}>
                  {tabs.map((t) => {
                    const active = activeTab?.key === t.key;
                    return (
                      <button key={t.key} onClick={() => setTab(t.key)} style={{
                        padding: "6px 13px", borderRadius: 8, fontSize: 12.5, fontWeight: active ? 600 : 500, cursor: "pointer",
                        border: `1px solid ${active ? "var(--accent)" : "var(--border-primary)"}`,
                        background: active ? "var(--accent-soft)" : "transparent",
                        color: active ? "var(--accent)" : "var(--text-muted)",
                      }}>
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", padding: "20px 22px" }}>
                {!showTabs || activeTab?.key === "full" ? (
                  <ReviewMarkdown content={detail.review_md} />
                ) : (
                  activeTab.sections
                    .filter((n) => sections[n]?.body)
                    .map((n) => (
                      <div key={n} style={{ marginBottom: 22 }}>
                        <div style={{ fontSize: 14, fontWeight: 650, color: "var(--text-primary)", marginBottom: 8 }}>
                          {sections[n].title}
                        </div>
                        <ReviewMarkdown content={sections[n].body} />
                      </div>
                    ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Grade rail */}
        <div style={{ flex: "0 1 280px", minWidth: 240, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", padding: "18px 20px" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 6 }}>Call grade</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-1px", color: scoreColor(grade), fontVariantNumeric: "tabular-nums" }}>
                {grade ?? "—"}
              </span>
              {grade != null && <span style={{ fontSize: 15, color: "var(--text-muted)" }}>/100</span>}
              {grade != null && (
                <span style={{
                  marginLeft: "auto", padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
                  color: scoreColor(grade), background: "var(--hover-bg-subtle)",
                }}>
                  {gradeLabel(grade)}
                </span>
              )}
            </div>
            {grade != null && <div style={{ marginTop: 10 }}><Bar value={grade} color={scoreColor(grade)} /></div>}
          </div>

          <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 500, color: "var(--text-muted)", marginBottom: 6 }}>
              Script adherence
              <InfoTip text="How closely the rep followed the saved closer script. Strict on word-for-word lines, lenient elsewhere. Empty until a script is saved on this page." />
            </div>
            {adherence != null ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 26, fontWeight: 650, color: scoreColor(adherence), fontVariantNumeric: "tabular-nums" }}>{adherence}</span>
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>/100</span>
                </div>
                <div style={{ marginTop: 8 }}><Bar value={adherence} color={scoreColor(adherence)} /></div>
                {typeof detail === "object" && detail?.adherence_notes && (
                  <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>
                    {detail.adherence_notes}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>No script saved yet, so this call was not graded for adherence.</div>
            )}
          </div>

          {typeof detail === "object" && detail && (
            <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", padding: "14px 20px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
              Reviewed by the AI sales manager{detail.model ? ` (${detail.model})` : ""}.
              {deal.title && <><br />Fathom title: {deal.title}</>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- day ops --------------------------------- */

function DayOps() {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(todayEt());
  const [data, setData] = useState<OverviewDay | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/micromanager/overview?date=${d}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) load(date); }, [open, date, load]);

  const isToday = date === todayEt();

  return (
    <div style={{ marginTop: 30 }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer",
        fontSize: 12, fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)",
      }}>
        <ChevronDown size={14} style={{ transition: "transform 0.2s ease", transform: open ? "none" : "rotate(-90deg)" }} />
        Day ops: admin, setters
      </button>

      {open && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
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
            {loading && <Loader2 size={14} className="spin" style={{ color: "var(--text-muted)" }} />}
          </div>

          {data && (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <StatTile
                  label="Admin"
                  value={`${data.admin.pct}%`}
                  sub={data.admin.tracker.total > 0
                    ? `tracker ${data.admin.tracker.filled}/${data.admin.tracker.total} fields · ${data.admin.tracker.rows} calls`
                    : "no taken calls to log"}
                  tip="Admin work done. Blend of sales tracker completeness and EOD reports vs the trailing 14-day roster. Nothing to grade reads 100%."
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- page ----------------------------------- */

export default function MicromanagerClient() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<DealsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [closerFilter, setCloserFilter] = useState("");
  const [digestOpen, setDigestOpen] = useState(false);
  const [selected, setSelected] = useState<Deal | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/micromanager/deals?days=${d}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [days, load]);

  const closerNames = useMemo(
    () => Array.from(new Set((data?.deals || []).map((d) => d.closer).filter(Boolean))) as string[],
    [data]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.deals || []).filter((d) => {
      if (closerFilter && (d.closer || "") !== closerFilter) return false;
      if (!q) return true;
      return [d.prospect, d.title, d.closer, d.outcome].some((f) => String(f || "").toLowerCase().includes(q));
    });
  }, [data, query, closerFilter]);

  if (selected) {
    return <DealDetail deal={selected} onBack={() => setSelected(null)} />;
  }

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
        .mm-search input::placeholder { color: var(--text-muted); }
      `}</style>

      {/* Header */}
      <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Deal Analysis</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
            Every sales call, reviewed by the AI sales manager.
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{
              padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: days === d ? 600 : 500, cursor: "pointer",
              border: `1px solid ${days === d ? "var(--accent)" : "var(--border-primary)"}`,
              background: days === d ? "var(--accent-soft)" : "transparent",
              color: days === d ? "var(--accent)" : "var(--text-muted)",
            }}>
              {d}d
            </button>
          ))}
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
              label="Calls reviewed"
              value={data.stats.reviewed}
              sub={`last ${data.days} days`}
              tip="Sales calls with a finished AI review in this window."
            />
            <StatTile
              label="Avg grade"
              value={data.stats.avgGrade != null ? <span style={{ color: scoreColor(data.stats.avgGrade) }}>{data.stats.avgGrade}</span> : "—"}
              sub={data.stats.avgGrade != null ? gradeLabel(data.stats.avgGrade) : "no graded calls yet"}
              tip="Average 0-100 call grade across reviewed calls in this window."
            />
            <StatTile
              label="Close rate"
              value={data.stats.closeRate != null ? `${data.stats.closeRate}%` : "—"}
              sub={`${data.stats.won} closed`}
              tip="Closed outcomes out of reviewed calls with a clear outcome (unclear calls excluded)."
            />
            <StatTile
              label="In queue"
              value={data.stats.queued}
              sub={data.stats.inFlight > 0 ? `${data.stats.inFlight} being reviewed now` : "all quiet"}
              tip="Sales calls waiting for review. The analyzer works newest-first, around the clock."
            />
          </div>

          {/* Daily digest */}
          {data.digest && (
            <>
              <SectionTitle tip="Written once a day by the AI sales manager after the day's calls are reviewed: each closer's strengths and weaknesses, plus the team's top low-hanging fruit ranked by impact.">
                Daily digest · {fmtDate(data.digest.date)}
              </SectionTitle>
              <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", padding: "16px 18px" }}>
                <div
                  style={{ maxHeight: digestOpen ? "none" : 180, overflow: "hidden", position: "relative" }}
                >
                  {data.digest.reviewCount != null && (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                      Built from {data.digest.reviewCount} reviewed call{data.digest.reviewCount === 1 ? "" : "s"}.
                    </div>
                  )}
                  <ReviewMarkdown content={data.digest.md} />
                  {!digestOpen && (
                    <div style={{
                      position: "absolute", left: 0, right: 0, bottom: 0, height: 70, pointerEvents: "none",
                      background: "linear-gradient(to bottom, transparent, var(--bg-card))",
                    }} />
                  )}
                </div>
                <button onClick={() => setDigestOpen(!digestOpen)} style={{
                  marginTop: 10, padding: "5px 12px", borderRadius: 7, border: "1px solid var(--border-primary)",
                  background: "var(--hover-bg-subtle)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}>
                  {digestOpen ? "Collapse" : "Read full digest"}
                </button>
              </div>
            </>
          )}

          {/* Deal list controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "26px 0 10px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)" }}>
              Deals
            </span>
            <div className="mm-search" style={{
              display: "flex", alignItems: "center", gap: 6, padding: "0 10px", borderRadius: 8, height: 30,
              border: "1px solid var(--border-primary)", background: "var(--bg-card)", marginLeft: "auto",
            }}>
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search prospect or rep"
                style={{ border: "none", outline: "none", background: "transparent", fontSize: 12.5, color: "var(--text-primary)", width: 170 }}
              />
            </div>
            <select
              value={closerFilter}
              onChange={(e) => setCloserFilter(e.target.value)}
              style={{
                height: 30, padding: "0 8px", borderRadius: 8, fontSize: 12.5,
                border: "1px solid var(--border-primary)", background: "var(--bg-card)", color: "var(--text-secondary)",
              }}
            >
              <option value="">All reps</option>
              {closerNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Deal table */}
          <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", overflowX: "auto" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: "22px 16px", fontSize: 13, color: "var(--text-muted)" }}>
                {data.deals.length === 0 ? "No sales calls in this window yet." : "Nothing matches that filter."}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={th}>Prospect</th>
                    <th style={th}>Rep</th>
                    <th style={th}>Stage</th>
                    <th style={th}>Grade</th>
                    <th style={th}>Script</th>
                    <th style={th}>Length</th>
                    <th style={th}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((d) => (
                    <tr key={d.fathomId} className="mm-row" onClick={() => d.reviewed && setSelected(d)}
                      style={{ opacity: d.reviewed ? 1 : 0.65 }}>
                      <td style={{ ...td, color: "var(--text-primary)", fontWeight: 500, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {d.prospect}
                      </td>
                      <td style={td}>{d.closer || "—"}</td>
                      <td style={td}><StagePill outcome={d.outcome} reviewed={d.reviewed} /></td>
                      <td style={td}><ScoreChip value={d.grade} /></td>
                      <td style={td}><ScoreChip value={d.adherence} /></td>
                      <td style={td}>{d.durationMin != null ? `${d.durationMin}m` : "—"}</td>
                      <td style={td}>
                        {fmtDate(d.time || d.date)}{d.time ? ` · ${fmtTime(d.time)}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Rep performance */}
          {data.closers.length > 0 && (
            <>
              <SectionTitle tip="Per-rep rollup across reviewed calls in this window: average grade, script adherence, and closed outcomes.">
                Rep performance
              </SectionTitle>
              <div style={{ borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-card)", overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Rep</th>
                      <th style={th}>Calls reviewed</th>
                      <th style={th}>Avg grade</th>
                      <th style={th}>Script</th>
                      <th style={th}>Closed</th>
                      <th style={th}>Close rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.closers.map((c) => (
                      <tr key={c.name}>
                        <td style={{ ...td, color: "var(--text-primary)", fontWeight: 500 }}>{c.name}</td>
                        <td style={td}>{c.calls}</td>
                        <td style={td}><ScoreChip value={c.avgGrade} /></td>
                        <td style={td}><ScoreChip value={c.avgAdherence} /></td>
                        <td style={td}>{c.won}</td>
                        <td style={td}>{c.closeRate != null ? `${c.closeRate}%` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Scripts */}
          <SectionTitle tip="Paste the scripts here. Every call and DM conversation is graded against them; the Script columns stay empty until a script is saved.">
            Script adherence
          </SectionTitle>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <ScriptCard role="closer" label="Closer call script" />
            <ScriptCard role="setter" label="Setter DM script" />
          </div>

          {/* Day ops (admin %, setters) */}
          <DayOps />
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
