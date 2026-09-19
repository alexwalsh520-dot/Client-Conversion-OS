"use client";

// Deal Analysis: every closer call, broken down phase by phase against the
// script by Jeremy (the AI head of sales). Alex + Matt only.
//
// One card per call, newest first. A card shows the grade, the outcome, the
// verdict and the six phase scores at a glance; clicking it expands the full
// breakdown inline (no page change, no click-through). Queued calls sit in
// the same list, dimmed, until Jeremy reaches them.

import React, { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Loader2, Check, Search, Flag, Clock } from "lucide-react";
import { ReviewMarkdown } from "../sales-hub/components/ReviewMarkdown";
import { CALL_PHASES, phaseResults, hasPhases, type PhaseResult } from "@/lib/call-phases";

/* ---------------------------------- types ---------------------------------- */

interface PhaseGlance { key: string; short: string; score: number | null; ran: boolean }

interface Deal {
  fathomId: string;
  date: string | null;
  time: string | null;
  prospect: string;
  title: string | null;
  closer: string | null;
  callType: string | null;
  setter: string | null;
  outcome: string | null;
  cash: number | null;
  grade: number | null;
  adherence: number | null;
  verdict: string | null;
  phases: PhaseGlance[];
  flag: string | null;
  fathomUrl: string | null;
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
}

interface ReviewDetail {
  review_md: string;
  grade: number | null;
  adherence_score: number | null;
  adherence_notes: string | null;
  model: string | null;
  created_at?: string | null;
  fields: Record<string, unknown> | null;
}

/* -------------------------------- helpers --------------------------------- */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso.length <= 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: iso.length <= 10 ? "UTC" : "America/New_York",
  });
}

function fmtTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  });
}

function scoreColor(v: number | null): string {
  if (v == null) return "var(--text-muted)";
  if (v >= 75) return "var(--success)";
  if (v >= 55) return "var(--warning)";
  return "var(--danger)";
}

function gradeWord(v: number | null): string {
  if (v == null) return "";
  if (v >= 85) return "Exceptional";
  if (v >= 75) return "Strong";
  if (v >= 55) return "Mixed";
  return "Needs work";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x) : [];
}

const OUTCOME: Record<string, { label: string; fg: string; bg: string }> = {
  "won": { label: "Closed", fg: "var(--success)", bg: "var(--success-soft)" },
  "follow-up": { label: "Follow up", fg: "var(--accent)", bg: "var(--accent-soft)" },
  "lost": { label: "Lost", fg: "var(--danger)", bg: "var(--danger-soft)" },
  "no-show": { label: "No show", fg: "var(--text-muted)", bg: "var(--hover-bg-subtle)" },
  "unclear": { label: "Unclear", fg: "var(--text-muted)", bg: "var(--hover-bg-subtle)" },
};

function outcomeStyle(outcome: string | null) {
  const key = String(outcome || "unclear").toLowerCase().replace(/\s+/g, "-");
  return OUTCOME[key] || OUTCOME.unclear;
}

/* ----------------------------- tiny components ----------------------------- */

function GradeRing({ value, size = 58, stroke = 5 }: { value: number | null; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const color = scoreColor(value);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hover-bg-subtle)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size >= 56 ? 18 : 14, fontWeight: 700, color: value == null ? "var(--text-muted)" : "var(--text-primary)",
        fontVariantNumeric: "tabular-nums", letterSpacing: "-0.5px",
      }}>
        {value ?? "—"}
      </div>
    </div>
  );
}

function OutcomePill({ outcome, reviewed }: { outcome: string | null; reviewed: boolean }) {
  if (!reviewed) {
    return (
      <span className="da-pill" style={{ color: "var(--text-muted)", border: "1px dashed var(--border-primary)", background: "transparent" }}>
        <Clock size={11} /> In queue
      </span>
    );
  }
  const s = outcomeStyle(outcome);
  return <span className="da-pill" style={{ color: s.fg, background: s.bg }}>{s.label}</span>;
}

function PhaseStrip({ phases }: { phases: PhaseGlance[] }) {
  const ordered = CALL_PHASES.map((p) => phases.find((x) => x.key === p.key) || { key: p.key, short: p.short, score: null, ran: false });
  return (
    <div className="da-phases">
      {ordered.map((p) => (
        <div key={p.key} className="da-phase" title={`${p.short}: ${p.score ?? "not scored"}`}>
          <div className="da-phase-head">
            <span>{p.short}</span>
            <span style={{ color: scoreColor(p.score), fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{p.score ?? "–"}</span>
          </div>
          <div className="da-bar">
            <div className="da-bar-fill" style={{ width: `${p.score ?? 0}%`, background: scoreColor(p.score) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 650, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="da-stat">
      <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--text-muted)" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", letterSpacing: "-0.6px", marginTop: 2, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ------------------------------ call breakdown ----------------------------- */

interface Objection {
  category?: string; verbatim_quote?: string; timestamp?: string;
  how_handled?: string; handling_quality?: string; say_instead?: string;
}

function PhaseRow({ p, index }: { p: PhaseResult; index: number }) {
  const skipped = p.score != null && !p.ran;
  return (
    <div className="da-phase-row">
      <div className="da-phase-score">
        <GradeRing value={p.score} size={44} stroke={4} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 650, color: "var(--text-primary)" }}>{index + 1}. {p.name}</span>
          {(p.startedAt || p.minutes != null) && (
            <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {p.startedAt ? `at ${p.startedAt}` : ""}{p.startedAt && p.minutes != null ? " · " : ""}{p.minutes != null ? `${p.minutes} min` : ""}
            </span>
          )}
          {skipped && <span className="da-pill" style={{ color: "var(--danger)", background: "var(--danger-soft)", fontSize: 10.5 }}>Skipped</span>}
        </div>
        {p.whatHappened && (
          <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)", marginTop: 5 }}>{p.whatHappened}</div>
        )}
        {p.fix && (
          <div className="da-fix">
            <span style={{ fontWeight: 650, color: scoreColor(p.score) }}>Fix</span>
            <span>{p.fix}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function CallBreakdown({ deal }: { deal: Deal }) {
  const [detail, setDetail] = useState<ReviewDetail | "loading" | "missing">("loading");
  const [showFull, setShowFull] = useState(false);

  // The card mounts this fresh on every open, so the initial "loading" state
  // is the reset; no setState in the effect body.
  useEffect(() => {
    let alive = true;
    fetch(`/api/micromanager/review?fathomId=${encodeURIComponent(deal.fathomId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (alive) setDetail(j.review); })
      .catch(() => { if (alive) setDetail("missing"); });
    return () => { alive = false; };
  }, [deal.fathomId]);

  if (detail === "loading") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: "18px 0 6px" }}>
        <Loader2 size={14} className="spin" /> Loading breakdown
      </div>
    );
  }
  if (detail === "missing") {
    return <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "18px 0 6px" }}>No review saved for this call.</div>;
  }

  const f = detail.fields || {};
  const phases = phaseResults(f);
  const structured = hasPhases(f);
  const verdict = str(f.verdict) || str(f.call_summary);
  const pattern = str(f.pattern);
  const applied = typeof f.applied_last_fix === "boolean" ? f.applied_last_fix : null;
  const objections = Array.isArray(f.objections_raised) ? (f.objections_raised as Objection[]) : [];
  const ssk = [
    { k: "Stop", v: str(f.stop), color: "var(--danger)" },
    { k: "Start", v: str(f.start), color: "var(--success)" },
    { k: "Keep", v: str(f.keep), color: "var(--accent)" },
  ].filter((x) => x.v);
  const drill = str(f.drill);
  const rewrite = str(f.if_i_ran_the_call);
  const flag = (f.review_flag && typeof f.review_flag === "object" ? f.review_flag : {}) as { flag?: boolean; reason?: string };
  const handoff = (f.setter_handoff && typeof f.setter_handoff === "object" ? f.setter_handoff : {}) as Record<string, unknown>;
  const mismatch = (f.ad_to_call_mismatch && typeof f.ad_to_call_mismatch === "object" ? f.ad_to_call_mismatch : {}) as { flag?: boolean; note?: string };
  const managerLines = [
    flag.flag && flag.reason ? `Listen to this one: ${flag.reason}` : null,
    str(f.manager_note),
    ...list(f.systemic_flags),
    mismatch.flag && mismatch.note ? `Ad-to-call mismatch: ${mismatch.note}` : null,
    handoff.expectation_gap && str(handoff.note) ? `Setter handoff gap: ${str(handoff.note)}` : null,
    str(handoff.dm_stated_motivation)
      ? `DMs said they wanted: "${str(handoff.dm_stated_motivation)}"${handoff.closer_used_motivation === false ? " (the closer never used it)" : ""}`
      : null,
    ...list(f.red_flags).map((r) => `Red flag: ${r}`),
  ].filter((x): x is string => !!x);

  return (
    <div className="da-detail">
      {/* Verdict */}
      {verdict && (
        <div style={{ fontSize: 14, lineHeight: 1.6, color: "var(--text-primary)" }}>{verdict}</div>
      )}
      {(pattern || applied != null) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {pattern && (
            <span className="da-pill" style={{ color: "var(--warning)", background: "var(--warning-soft)" }}>Pattern: {pattern}</span>
          )}
          {applied != null && (
            <span className="da-pill" style={{ color: applied ? "var(--success)" : "var(--danger)", background: applied ? "var(--success-soft)" : "var(--danger-soft)" }}>
              {applied ? "Applied last fix" : "Ignored last fix"}
            </span>
          )}
        </div>
      )}

      {/* Phases */}
      {structured ? (
        <div style={{ marginTop: 22 }}>
          <Label>Phase by phase</Label>
          <div className="da-phase-list">
            {phases.map((p, i) => <PhaseRow key={p.key} p={p} index={i} />)}
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 18, fontSize: 12.5, color: "var(--text-muted)" }}>
          Reviewed before the phase breakdown existed. The full review is below.
        </div>
      )}

      {/* Objections */}
      {objections.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <Label>Objections</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {objections.map((o, i) => (
              <div key={i} className="da-objection">
                <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontStyle: "italic", lineHeight: 1.5 }}>
                  “{str(o.verbatim_quote) || "…"}”
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, fontSize: 11.5, color: "var(--text-muted)" }}>
                  {str(o.category) && <span className="da-tag">{o.category}</span>}
                  {str(o.timestamp) && <span className="da-tag">{o.timestamp}</span>}
                  {str(o.how_handled) && <span className="da-tag">{o.how_handled}</span>}
                  {str(o.handling_quality) && (
                    <span className="da-tag" style={{
                      color: o.handling_quality === "effective" ? "var(--success)" : o.handling_quality === "partial" ? "var(--warning)" : "var(--danger)",
                    }}>{o.handling_quality}</span>
                  )}
                </div>
                {str(o.say_instead) && (
                  <div className="da-fix" style={{ marginTop: 8 }}>
                    <span style={{ fontWeight: 650, color: "var(--accent)" }}>Say instead</span>
                    <span>“{o.say_instead}”</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stop / Start / Keep */}
      {ssk.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <Label>Stop / Start / Keep</Label>
          <div className="da-ssk">
            {ssk.map((x) => (
              <div key={x.k} className="da-ssk-card" style={{ borderTopColor: x.color }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: x.color, marginBottom: 6 }}>{x.k}</div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>{x.v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drill + rewrite */}
      {(drill || rewrite) && (
        <div className="da-two" style={{ marginTop: 22 }}>
          {drill && (
            <div>
              <Label>Drill before the next call</Label>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>{drill}</div>
            </div>
          )}
          {rewrite && (
            <div>
              <Label>If Jeremy ran the call</Label>
              <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--text-secondary)" }}>{rewrite}</div>
            </div>
          )}
        </div>
      )}

      {/* Manager only */}
      {managerLines.length > 0 && (
        <div className="da-manager">
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--warning)", marginBottom: 8 }}>
            <Flag size={12} /> Manager only
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
            {managerLines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      {/* Footer */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 22, fontSize: 12, color: "var(--text-muted)" }}>
        {deal.fathomUrl && (
          <a href={deal.fathomUrl} target="_blank" rel="noreferrer" className="da-link" onClick={(e) => e.stopPropagation()}>
            <ExternalLink size={12} /> Recording
          </a>
        )}
        <button className="da-link" onClick={(e) => { e.stopPropagation(); setShowFull(!showFull); }}>
          {showFull ? "Hide full review" : "Full review"}
        </button>
        {detail.adherence_score != null && <span>Script adherence {detail.adherence_score}/100</span>}
        <span>Reviewed by Jeremy{detail.created_at ? ` · ${fmtDate(detail.created_at)}` : ""}</span>
      </div>
      {showFull && (
        <div style={{ marginTop: 14, padding: "16px 18px", borderRadius: 12, border: "1px solid var(--border-subtle)", background: "var(--bg-primary, transparent)" }}>
          <ReviewMarkdown content={detail.review_md} />
        </div>
      )}
    </div>
  );
}

/* --------------------------------- call card -------------------------------- */

function CallCard({ deal, open, onToggle, cardRef }: { deal: Deal; open: boolean; onToggle: () => void; cardRef?: (el: HTMLDivElement | null) => void }) {
  const clickable = deal.reviewed;
  const cash = deal.cash != null && deal.cash > 0 ? `$${deal.cash.toLocaleString("en-US")}` : null;
  return (
    <div
      ref={cardRef}
      className={`da-card${open ? " open" : ""}${clickable ? "" : " queued"}`}
      onClick={clickable ? onToggle : undefined}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
    >
      <div className="da-card-head">
        <GradeRing value={deal.grade} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 650, color: "var(--text-primary)", letterSpacing: "-0.2px" }}>{deal.prospect}</span>
            <OutcomePill outcome={deal.outcome} reviewed={deal.reviewed} />
            {cash && <span style={{ fontSize: 13, fontWeight: 650, color: "var(--success)" }}>{cash}</span>}
            {deal.flag && (
              <span className="da-pill" style={{ color: "var(--warning)", background: "var(--warning-soft)" }} title={deal.flag}>
                <Flag size={11} /> Listen
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 4, fontSize: 12.5, color: "var(--text-muted)" }}>
            {deal.closer && <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>{deal.closer}</span>}
            {deal.closer && <span>·</span>}
            <span>{deal.callType || "Sales call"}</span>
            <span>·</span>
            <span>{fmtDate(deal.time || deal.date)}{deal.time ? `, ${fmtTime(deal.time)}` : ""}</span>
            {deal.durationMin != null && <><span>·</span><span>{deal.durationMin} min</span></>}
            {deal.setter && <><span>·</span><span>set by {deal.setter}</span></>}
          </div>
          {deal.verdict && !open && (
            <div className="da-verdict">{deal.verdict}</div>
          )}
          {!deal.reviewed && (
            <div className="da-verdict" style={{ color: "var(--text-muted)" }}>Waiting for Jeremy. Calls are reviewed newest first, a few per hour.</div>
          )}
        </div>
        {clickable && (
          <ChevronDown size={18} style={{ color: "var(--text-muted)", flexShrink: 0, transition: "transform 0.2s ease", transform: open ? "rotate(180deg)" : "none" }} />
        )}
      </div>
      {deal.reviewed && deal.phases.some((p) => p.score != null) && !open && (
        <div style={{ marginTop: 14 }}><PhaseStrip phases={deal.phases} /></div>
      )}
      {open && <CallBreakdown deal={deal} />}
    </div>
  );
}

/* ------------------------------ script drawer ------------------------------ */

function ScriptCard({ role, label, hint }: { role: "closer" | "offer" | "setter"; label: string; hint: string }) {
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

  const has = !!content.trim();
  return (
    <div className="da-script">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        <div style={{ fontSize: 13, fontWeight: 650, color: "var(--text-primary)" }}>{label}</div>
        <span style={{ fontSize: 11, color: has ? "var(--success)" : "var(--text-muted)" }}>{has ? "On file" : "Missing"}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>{hint}</div>
      {!loaded ? (
        <Loader2 size={14} className="spin" style={{ color: "var(--text-muted)" }} />
      ) : editing ? (
        <>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={12} placeholder="Paste it here." className="da-textarea" />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={save} disabled={saving} className="da-btn primary">
              {saving ? <Loader2 size={12} className="spin" /> : <Check size={12} />} Save
            </button>
            <button onClick={() => setEditing(false)} className="da-btn">Cancel</button>
          </div>
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {has ? `${content.trim().split(/\s+/).length} words${savedAt ? ` · updated ${new Date(savedAt).toLocaleDateString()}` : ""}` : "Nothing saved yet."}
          </span>
          <button onClick={() => setEditing(true)} className="da-btn">{has ? "Edit" : "Add"}</button>
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  // Deep link from the per-call Slack post: /micromanager?deal=<fathomId>.
  const [deepLinkApplied, setDeepLinkApplied] = useState(false);
  useEffect(() => {
    if (deepLinkApplied || !data) return;
    const id = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("deal") : null;
    if (!id) { setDeepLinkApplied(true); return; }
    const hit = data.deals.find((d) => String(d.fathomId) === id && d.reviewed);
    if (hit) {
      setOpenId(hit.fathomId);
      setDeepLinkApplied(true);
      setTimeout(() => cardRefs.current[hit.fathomId]?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } else if (days < 90) setDays(90); // older call: widen the window once
    else setDeepLinkApplied(true);
  }, [data, days, deepLinkApplied]);

  const closers = data?.closers || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.deals || []).filter((d) => {
      if (closerFilter && (d.closer || "") !== closerFilter) return false;
      if (!q) return true;
      return [d.prospect, d.title, d.closer, d.outcome, d.setter, d.verdict].some((f) => String(f || "").toLowerCase().includes(q));
    });
  }, [data, query, closerFilter]);

  return (
    <div className="fade-up">
      <style>{`
        .da-pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600; white-space: nowrap; line-height: 1.3; }
        .da-tag { padding: 2px 7px; border-radius: 6px; background: var(--hover-bg-subtle); border: 1px solid var(--border-subtle); }
        .da-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .da-stat { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border-subtle); background: var(--bg-card); }
        .da-chip { padding: 6px 12px; border-radius: 999px; font-size: 12.5px; font-weight: 500; cursor: pointer; border: 1px solid var(--border-primary); background: transparent; color: var(--text-muted); transition: all 0.12s ease; white-space: nowrap; }
        .da-chip:hover { color: var(--text-secondary); background: var(--hover-bg-subtle); }
        .da-chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
        .da-chip b { font-weight: 650; margin-left: 5px; }
        .da-card { border: 1px solid var(--border-subtle); background: var(--bg-card); border-radius: 16px; padding: 16px 18px; transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease; }
        .da-card[role="button"] { cursor: pointer; }
        .da-card[role="button"]:hover { border-color: var(--border-primary); background: var(--bg-card-hover); }
        .da-card[role="button"]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .da-card.open { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-glow); }
        .da-card.queued { opacity: 0.6; border-style: dashed; }
        .da-card-head { display: flex; align-items: flex-start; gap: 16px; }
        .da-verdict { font-size: 13px; line-height: 1.55; color: var(--text-secondary); margin-top: 8px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .da-phases { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 8px; }
        .da-phase-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; color: var(--text-muted); margin-bottom: 4px; }
        .da-bar { height: 6px; border-radius: 999px; background: var(--hover-bg-subtle); overflow: hidden; }
        .da-bar-fill { height: 100%; border-radius: 999px; transition: width 0.5s ease; }
        .da-detail { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--border-subtle); cursor: default; }
        .da-phase-list { display: flex; flex-direction: column; gap: 4px; }
        .da-phase-row { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--border-subtle); }
        .da-phase-row:last-child { border-bottom: none; }
        .da-fix { display: flex; gap: 10px; align-items: flex-start; margin-top: 8px; padding: 9px 12px; border-radius: 10px; background: var(--hover-bg-subtle); border: 1px solid var(--border-subtle); font-size: 13px; line-height: 1.5; color: var(--text-primary); }
        .da-fix > span:first-child { flex-shrink: 0; font-size: 11px; letter-spacing: 0.6px; text-transform: uppercase; padding-top: 2px; }
        .da-objection { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border-subtle); background: var(--hover-bg-subtle); }
        .da-ssk { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .da-ssk-card { padding: 12px 14px; border-radius: 12px; border: 1px solid var(--border-subtle); border-top-width: 3px; background: var(--hover-bg-subtle); }
        .da-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
        .da-manager { margin-top: 22px; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--warning-soft); background: var(--warning-soft); }
        .da-link { display: inline-flex; align-items: center; gap: 5px; background: none; border: none; padding: 0; cursor: pointer; font: inherit; font-size: 12px; font-weight: 600; color: var(--accent); text-decoration: none; }
        .da-link:hover { text-decoration: underline; }
        .da-search { display: flex; align-items: center; gap: 6px; padding: 0 10px; border-radius: 999px; height: 32px; border: 1px solid var(--border-primary); background: var(--bg-card); }
        .da-search input { border: none; outline: none; background: transparent; font-size: 12.5px; color: var(--text-primary); width: 180px; }
        .da-search input::placeholder { color: var(--text-muted); }
        .da-scripts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .da-script { border-radius: 12px; border: 1px solid var(--border-subtle); background: var(--bg-card); padding: 14px 16px; }
        .da-textarea { width: 100%; resize: vertical; padding: 10px; border-radius: 8px; font-size: 12.5px; line-height: 1.5; border: 1px solid var(--border-primary); background: var(--bg-primary, transparent); color: var(--text-primary); font-family: inherit; }
        .da-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 7px; border: 1px solid var(--border-primary); background: var(--hover-bg-subtle); color: var(--text-secondary); font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; }
        .da-btn.primary { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 600; }
        @media (max-width: 760px) {
          .da-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .da-phases { grid-template-columns: repeat(3, minmax(0, 1fr)); }
          .da-ssk, .da-two, .da-scripts { grid-template-columns: 1fr; }
          .da-search input { width: 120px; }
        }
      `}</style>

      {/* Header */}
      <div className="page-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Deal Analysis</h1>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            Every closer call, broken down phase by phase against the script by Jeremy.
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`da-chip${days === d ? " on" : ""}`}>{d}d</button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 16px", marginBottom: 16, borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && !data ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 13, padding: "40px 0" }}>
          <Loader2 size={15} className="spin" /> Loading
        </div>
      ) : data && (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s ease" }}>
          {/* Stats */}
          <div className="da-stats">
            <Stat label="Calls reviewed" value={data.stats.reviewed} sub={`last ${data.days} days`} />
            <Stat
              label="Average grade"
              value={<span style={{ color: scoreColor(data.stats.avgGrade) }}>{data.stats.avgGrade ?? "—"}</span>}
              sub={data.stats.avgGrade != null ? gradeWord(data.stats.avgGrade) : "no graded calls yet"}
            />
            <Stat label="Closed" value={data.stats.won} sub={data.stats.closeRate != null ? `${data.stats.closeRate}% of decided calls` : "no decided calls yet"} />
            <Stat label="In queue" value={data.stats.queued} sub={data.stats.inFlight > 0 ? `${data.stats.inFlight} with Jeremy now` : "all caught up"} />
          </div>

          {/* Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "22px 0 12px", flexWrap: "wrap" }}>
            <button className={`da-chip${closerFilter === "" ? " on" : ""}`} onClick={() => setCloserFilter("")}>
              All<b>{data.deals.length}</b>
            </button>
            {closers.map((c) => (
              <button key={c.name} className={`da-chip${closerFilter === c.name ? " on" : ""}`} onClick={() => setCloserFilter(closerFilter === c.name ? "" : c.name)}
                title={`${c.calls} reviewed · avg grade ${c.avgGrade ?? "—"} · ${c.won} closed`}>
                {c.name}<b style={{ color: scoreColor(c.avgGrade) }}>{c.avgGrade ?? "—"}</b>
              </button>
            ))}
            <div className="da-search" style={{ marginLeft: "auto" }}>
              <Search size={13} style={{ color: "var(--text-muted)" }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Prospect, rep, setter" />
            </div>
          </div>

          {/* Calls */}
          {filtered.length === 0 ? (
            <div style={{ padding: "32px 16px", borderRadius: 16, border: "1px dashed var(--border-primary)", fontSize: 13, color: "var(--text-muted)", textAlign: "center" }}>
              {data.deals.length === 0 ? "No closer calls in this window yet." : "Nothing matches that filter."}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {filtered.map((d) => (
                <CallCard
                  key={d.fathomId}
                  deal={d}
                  open={openId === d.fathomId}
                  onToggle={() => setOpenId(openId === d.fathomId ? null : d.fathomId)}
                  cardRef={(el) => { cardRefs.current[d.fathomId] = el; }}
                />
              ))}
            </div>
          )}

          {/* Scripts drawer */}
          <div style={{ marginTop: 34 }}>
            <button onClick={() => setScriptsOpen(!scriptsOpen)} style={{
              display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer",
              fontSize: 11, fontWeight: 650, letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--text-muted)", fontFamily: "inherit",
            }}>
              <ChevronDown size={14} style={{ transition: "transform 0.2s ease", transform: scriptsOpen ? "none" : "rotate(-90deg)" }} />
              What Jeremy grades against
            </button>
            {scriptsOpen && (
              <div className="da-scripts" style={{ marginTop: 12 }}>
                <ScriptCard role="closer" label="Closer call script" hint="Six phases. Lines in **double asterisks** are word-for-word and graded strictly; the rest is framework." />
                <ScriptCard role="offer" label="Offer & price sheet" hint="Programs, lengths, prices and payment options. Jeremy uses it to judge the pitch and the price presentation." />
                <ScriptCard role="setter" label="Setter DM script" hint="Used by the nightly setter DM reviews, not by call reviews." />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
