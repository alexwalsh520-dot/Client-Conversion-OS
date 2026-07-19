"use client";

// The Content Calendar grid — one component, two audiences.
//
//   mode="operator"  the accountability view inside /content: cadence editor, "reconcile now",
//                    the pipeline-freshness banner, and a popover to watch the post in a slot.
//   mode="creator"   the same week on the creator's own token page: his checklist, in his timezone.
//                    Tap to check off today and the past; future days are locked.
//
// Slot truth (derived in lib/content/calendar-build.ts — this only paints it):
//   VERIFIED  green         a post was actually found for that slot
//   CLAIMED   amber dashed  checked off, but no post found — believed, not proven
//   DONE      green         a story, which no scraper can see, so checking it IS the record
//   MISSED    red           the day is over and nothing filled it
//   PENDING   neutral       still to come
//
// Freshness never conflates "the pipeline is behind" with "the creator hasn't posted".

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2, ChevronLeft, ChevronRight, Settings, Film, LayoutGrid, Circle,
  AlertTriangle, Play, X, ExternalLink, RefreshCw, Check, Lock,
} from "lucide-react";
import {
  todayIn, shiftWeek, prettyDate, DOW, COMMON_TIMEZONES, isComplete,
  type StorySchedule, type SlotState,
} from "@/lib/content/calendar";

type SlotPost = {
  ig_media_id: string; permalink: string | null; thumb: string | null; video: string | null;
  taken_at: string | null; likes: number; comments: number; views: number; score: number | null;
};
type Slot = {
  slot_type: "reel" | "carousel" | "story"; slot_index: number;
  state: SlotState; manual: boolean; label?: string; post?: SlotPost;
};
type Day = {
  date: string; dow: string; story_rest: boolean; slots: Slot[];
  reels_posted: number; carousels_posted: number; reels_target: number; carousels_target: number;
  story_label: string | null; reconciled_at: string | null; finalized: boolean; day_ended: boolean;
};
type Cadence = { reels_per_day: number; carousels_per_day: number; story_schedule: StorySchedule; timezone: string };
type CalResp = {
  creator: string; viewer: "operator" | "creator"; week_start: string; today: string; timezone: string;
  cadence: Cadence; days: Day[];
  synced_at: string | null; sync_age_hours: number | null; sync_stale: boolean; newest_post_at: string | null;
};

const GREEN = "#2f9e5f", GREEN_BG = "rgba(47,158,95,0.16)";
const AMBER = "#b7791f", AMBER_BG = "rgba(214,158,46,0.13)";
const RED = "#d0512f", RED_BG = "rgba(208,81,47,0.14)";
const DOW_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function slotColor(s: Slot): React.CSSProperties {
  if (s.state === "verified" || s.state === "done") return { background: GREEN_BG, borderColor: GREEN, color: GREEN };
  // CLAIMED is deliberately not green: it is a claim we could not corroborate.
  if (s.state === "claimed") return { background: AMBER_BG, borderColor: AMBER, color: AMBER, borderStyle: "dashed" };
  if (s.state === "missed") return { background: RED_BG, borderColor: RED, color: RED };
  return { background: "var(--bg-glass)", borderColor: "var(--border-primary)", color: "var(--text-muted)" };
}
const stateTitle = (s: Slot) =>
  s.state === "verified" ? "posted — verified"
    : s.state === "claimed" ? "checked off, no post found"
      : s.state === "done" ? "checked off (stories can't be auto-detected)"
        : s.state === "missed" ? "missed" : "still to come";

export default function CalendarView({ creator, mode = "operator", token }: { creator: string; mode?: "operator" | "creator"; token?: string }) {
  const isCreator = mode === "creator";
  const [tz, setTz] = useState<string>("America/New_York");
  const [week, setWeek] = useState<string>(() => todayIn("America/New_York"));
  const [data, setData] = useState<CalResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [openSlot, setOpenSlot] = useState<{ day: Day; slot: Slot } | null>(null);

  const qs = useCallback(
    (wk: string) => (token ? `token=${encodeURIComponent(token)}&week=${wk}` : `creator=${creator}&week=${wk}`),
    [creator, token],
  );

  const load = useCallback(async (wk: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/calendar?${qs(wk)}`, { cache: "no-store" });
      const j = await res.json();
      if (Array.isArray(j?.days)) { setData(j); if (j.timezone) setTz(j.timezone); }
      else setData(null);
    } catch { setData(null); } finally { setLoading(false); }
  }, [qs]);
  useEffect(() => { load(week); }, [week, load]);

  // Creators check off today and the past only, and never a day that has been closed.
  const canToggle = (day: Day) => {
    if (!data) return false;
    if (day.date > data.today) return false;
    if (isCreator && day.finalized) return false;
    return true;
  };

  const toggle = async (day: Day, slot: Slot) => {
    if (!canToggle(day)) return;
    setBusy(`${day.date}|${slot.slot_type}|${slot.slot_index}`);
    try {
      await fetch(`/api/content/calendar/mark${token ? `?token=${encodeURIComponent(token)}` : ""}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(token ? {} : { creator }),
          for_date: day.date, slot_type: slot.slot_type, slot_index: slot.slot_index,
          done: !isComplete(slot.state),
        }),
      });
      await load(week);
    } finally { setBusy(null); }
  };

  const reconcileNow = async () => {
    setReconciling(true);
    try {
      await fetch(`/api/content/calendar/reconcile?creator=${creator}`, { method: "POST" });
      await load(week);
    } finally { setReconciling(false); }
  };

  const metrics = useMemo(() => {
    if (!data?.days?.length) return null;
    const tally = { reel: [0, 0], carousel: [0, 0], story: [0, 0] } as Record<string, [number, number]>;
    let done = 0, due = 0, streak = 0;
    for (const d of data.days) {
      for (const s of d.slots) {
        tally[s.slot_type][1] += 1;
        if (isComplete(s.state)) tally[s.slot_type][0] += 1;
        if (s.state !== "pending") { due += 1; if (isComplete(s.state)) done += 1; }
      }
    }
    const past = data.days.filter((d) => d.date <= data.today);
    for (let i = past.length - 1; i >= 0; i--) {
      const d = past[i];
      if (!d.slots.length) continue;
      if (d.slots.every((s) => isComplete(s.state))) streak += 1; else break;
    }
    const today = data.days.find((d) => d.date === data.today);
    let todayLine = "";
    if (today) {
      const need = (t: string) => today.slots.filter((s) => s.slot_type === t && !isComplete(s.state)).length;
      const parts = [
        need("reel") ? `${need("reel")} reel${need("reel") > 1 ? "s" : ""}` : "",
        need("carousel") ? `${need("carousel")} carousel${need("carousel") > 1 ? "s" : ""}` : "",
        need("story") ? "1 story" : "",
      ].filter(Boolean);
      todayLine = parts.length
        ? `${parts.join(", ")}${today.story_label && need("story") ? ` — ${today.story_label}` : ""}`
        : "All done for today ✓";
    }
    return { tally, pct: due ? Math.round((done / due) * 100) : null, streak, todayLine };
  }, [data]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setWeek((w) => shiftWeek(w, -1))} style={navBtn} title="Previous week"><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", minWidth: 186, textAlign: "center" }}>
          {data ? `${prettyDate(data.days[0].date)} – ${prettyDate(data.days[6].date)}` : "…"}
        </div>
        <button onClick={() => setWeek((w) => shiftWeek(w, 1))} style={navBtn} title="Next week"><ChevronRight size={16} /></button>
        <button onClick={() => setWeek(todayIn(tz))} style={{ ...pillBtn, fontSize: 12.5 }}>This week</button>
        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{tz.replace("_", " ")}</span>
        <span style={{ flex: 1 }} />
        {!isCreator && (
          <>
            <button onClick={reconcileNow} disabled={reconciling} title="Re-check posts and close finished days"
              style={{ ...pillBtn, display: "inline-flex", alignItems: "center", gap: 6 }}>
              {reconciling ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {reconciling ? "Reconciling…" : "Reconcile now"}
            </button>
            <button onClick={() => setEditing(true)} title="Edit cadence" aria-label="Edit cadence" style={navBtn}><Settings size={16} /></button>
          </>
        )}
      </div>

      {/* Only a behind PIPELINE raises this. A live pipeline that found nothing new means the
          creator didn't post, and the reds are honest. */}
      {data?.sync_stale && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 14px", borderRadius: 10, border: `1px solid ${AMBER}55`, background: AMBER_BG }}>
          <AlertTriangle size={16} style={{ color: AMBER, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text-primary)" }}>The post sync is behind.</strong>{" "}
            {data.synced_at ? `Last completed ${data.sync_age_hours}h ago.` : "No successful ingest on record."}{" "}
            Red slots are <em>unverified</em>, not confirmed misses.
          </div>
        </div>
      )}

      {loading || !data ? (
        <div style={{ color: "var(--text-muted)", padding: 60, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>
      ) : (
        <div className="cal-wrap" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 258px", gap: 18, alignItems: "start" }}>
          <div className="cal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 8, minWidth: 0 }}>
            {data.days.map((d) => {
              const isToday = d.date === data.today;
              const locked = !canToggle(d);
              return (
                <div key={d.date} style={{ background: "var(--bg-card)", border: `1px solid ${isToday ? "var(--accent)" : "var(--border-primary)"}`, borderRadius: 12, padding: "10px 8px", minWidth: 0, opacity: d.date > data.today ? 0.62 : 1 }}>
                  <div style={{ textAlign: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: isToday ? "var(--accent)" : "var(--text-secondary)" }}>{DOW_LABEL[d.dow]}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>
                      {d.date.slice(5)}{d.finalized && <Lock size={8} />}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 3 }}>
                    {d.slots.filter((s) => s.slot_type === "reel").map((s) => (
                      <button key={s.slot_index} disabled={!!busy || locked}
                        onClick={() => (isCreator ? toggle(d, s) : setOpenSlot({ day: d, slot: s }))}
                        title={`Reel ${s.slot_index} — ${stateTitle(s)}`}
                        style={{ height: 20, borderRadius: 5, border: "1px solid", cursor: locked ? "default" : "pointer", padding: "0 6px", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, ...slotColor(s) }}>
                        <span>Reel {s.slot_index}</span>
                        <span style={{ marginLeft: "auto", display: "inline-flex" }}>
                          {s.post ? <Play size={8} /> : isComplete(s.state) ? <Check size={9} /> : null}
                        </span>
                      </button>
                    ))}
                    {d.slots.filter((s) => s.slot_type === "carousel").map((s) => (
                      <button key={s.slot_index} disabled={!!busy || locked}
                        onClick={() => (isCreator ? toggle(d, s) : setOpenSlot({ day: d, slot: s }))}
                        title={`Carousel — ${stateTitle(s)}`}
                        style={{ height: 19, borderRadius: 5, border: "1px solid", cursor: locked ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, ...slotColor(s) }}>
                        <LayoutGrid size={10} />{s.post ? <Play size={8} /> : isComplete(s.state) ? <Check size={9} /> : null}
                      </button>
                    ))}
                    {d.slots.filter((s) => s.slot_type === "story").map((s) => (
                      <button key={s.slot_index} disabled={!!busy || locked} onClick={() => toggle(d, s)}
                        title={`Story — ${stateTitle(s)}`}
                        style={{ borderRadius: 6, border: "1px solid", cursor: locked ? "default" : "pointer", padding: "5px 6px", textAlign: "left", ...slotColor(s) }}>
                        <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.85, display: "flex", alignItems: "center", gap: 3 }}>
                          Story {isComplete(s.state) && <Check size={8} />}
                        </div>
                        <div style={{ fontSize: 10, lineHeight: 1.25, color: "var(--text-secondary)" }}>{s.label}</div>
                      </button>
                    ))}
                    {d.story_rest && (
                      <div style={{ fontSize: 9.5, color: "var(--text-muted)", textAlign: "center", padding: "3px 0" }}>no story</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {metrics && (
            <div className="cal-metrics" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 18, display: "grid", gap: 15 }}>
              <div>
                <div style={{ fontSize: 34, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{metrics.pct == null ? "—" : `${metrics.pct}%`}</div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>quota hit so far this week</div>
              </div>
              <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border-primary)", paddingTop: 14 }}>
                {(["reel", "carousel", "story"] as const).map((t) => (
                  <div key={t} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                    {t === "reel" ? <Film size={13} /> : t === "carousel" ? <LayoutGrid size={13} /> : <Circle size={13} />}
                    <span>{t === "reel" ? "Reels" : t === "carousel" ? "Carousels" : "Stories"}</span>
                    <span style={{ flex: 1 }} />
                    <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700, color: "var(--text-primary)" }}>{metrics.tally[t][0]}/{metrics.tally[t][1]}</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid var(--border-primary)", paddingTop: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>Today</div>
                <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>{metrics.todayLine || "—"}</div>
              </div>
              <div style={{ borderTop: "1px solid var(--border-primary)", paddingTop: 14, display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: metrics.streak > 0 ? GREEN : "var(--text-primary)" }}>{metrics.streak}</span>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>day streak</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, borderTop: "1px solid var(--border-primary)", paddingTop: 12, display: "grid", gap: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: AMBER_BG, border: `1px dashed ${AMBER}`, flexShrink: 0 }} />
                  <span>Amber = checked off, no post found yet.</span>
                </div>
                <div>
                  {data.newest_post_at
                    ? `Last post detected ${new Date(data.newest_post_at).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                    : "No posts detected yet"}
                </div>
                <div>Stories are manual-only — tap the story box once you post it.</div>
              </div>
            </div>
          )}
        </div>
      )}

      {openSlot && !isCreator && (
        <SlotPopover day={openSlot.day} slot={openSlot.slot} busy={!!busy} locked={!canToggle(openSlot.day)}
          onClose={() => setOpenSlot(null)}
          onToggle={async () => { await toggle(openSlot.day, openSlot.slot); setOpenSlot(null); }} />
      )}

      {editing && data && (
        <CadenceEditor creator={creator} initial={data.cadence} onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); load(week); }} />
      )}

      <style>{`
        .spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
        @media (max-width: 860px){
          .cal-wrap{grid-template-columns:1fr !important}
          .cal-grid{grid-template-columns:repeat(7, minmax(104px, 1fr)) !important; overflow-x:auto; padding-bottom:6px}
        }
      `}</style>
    </div>
  );
}

function CadenceEditor({ creator, initial, onClose, onSaved }: { creator: string; initial: Cadence; onClose: () => void; onSaved: () => void }) {
  const [reels, setReels] = useState(initial.reels_per_day);
  const [cars, setCars] = useState(initial.carousels_per_day);
  const [zone, setZone] = useState(initial.timezone || "America/New_York");
  const [labels, setLabels] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const d of DOW) o[d] = initial.story_schedule[d]?.label || "";
    return o;
  });
  const [rest, setRest] = useState<Record<string, boolean>>(() => {
    const o: Record<string, boolean> = {};
    for (const d of DOW) o[d] = initial.story_schedule[d] == null;
    return o;
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const schedule: StorySchedule = {};
    for (const d of DOW) schedule[d] = rest[d] || !labels[d].trim() ? null : { label: labels[d].trim() };
    try {
      await fetch("/api/content/calendar/cadence", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator, reels_per_day: reels, carousels_per_day: cars, story_schedule: schedule, timezone: zone }),
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "6vh 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", marginBottom: 16 }}>Cadence — {creator}</div>
        <div style={{ display: "flex", gap: 18, marginBottom: 16, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>Reels / day
            <input type="number" min={0} max={20} value={reels} onChange={(e) => setReels(Number(e.target.value))} style={numInput} />
          </label>
          <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>Carousels / day
            <input type="number" min={0} max={20} value={cars} onChange={(e) => setCars(Number(e.target.value))} style={numInput} />
          </label>
        </div>
        <label style={{ fontSize: 13, color: "var(--text-secondary)", display: "block", marginBottom: 18 }}>
          Timezone — every day, deadline and streak is judged in this zone
          <div style={{ display: "flex", gap: 8, marginTop: 5, flexWrap: "wrap" }}>
            <select value={COMMON_TIMEZONES.includes(zone) ? zone : "__custom__"}
              onChange={(e) => setZone(e.target.value === "__custom__" ? "" : e.target.value)}
              style={{ ...textInput, flex: "0 0 auto", minWidth: 190 }}>
              {COMMON_TIMEZONES.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
              <option value="__custom__">Other (type it)…</option>
            </select>
            {!COMMON_TIMEZONES.includes(zone) && (
              <input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Europe/London" style={textInput} />
            )}
          </div>
        </label>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
          Story theme by day — rest applies to STORIES only; reels &amp; carousels are expected daily
        </div>
        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {DOW.map((d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 34, fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>{DOW_LABEL[d]}</span>
              <input value={labels[d]} disabled={rest[d]} onChange={(e) => setLabels((o) => ({ ...o, [d]: e.target.value }))}
                placeholder={rest[d] ? "No story this day" : "Story theme"} style={{ ...textInput, opacity: rest[d] ? 0.5 : 1 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={rest[d]} onChange={(e) => setRest((o) => ({ ...o, [d]: e.target.checked }))} /> no story
              </label>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={pillBtn}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...pillBtn, background: "var(--accent)", color: "#1a1a1a", border: "none", fontWeight: 800 }}>{saving ? "Saving…" : "Save cadence"}</button>
        </div>
      </div>
    </div>
  );
}

function SlotPopover({ day, slot, busy, locked, onClose, onToggle }: { day: Day; slot: Slot; busy: boolean; locked: boolean; onClose: () => void; onToggle: () => void }) {
  const p = slot.post;
  const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "5vh 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, maxHeight: "90vh", overflowY: "auto", background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)", textTransform: "capitalize" }}>{slot.slot_type} {slot.slot_index}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{prettyDate(day.date)}</div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "grid", placeItems: "center" }}><X size={16} /></button>
        </div>

        {p ? (
          <>
            {p.video ? (
              <video src={p.video} poster={p.thumb || undefined} controls playsInline style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 380, objectFit: "contain" }} />
            ) : p.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumb} alt="" style={{ width: "100%", borderRadius: 10, objectFit: "cover" }} />
            ) : (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12.5, border: "1px dashed var(--border-primary)", borderRadius: 10 }}>Post detected, no media stored yet.</div>
            )}
            <div style={{ display: "flex", gap: 14, alignItems: "center", margin: "12px 0 4px", fontSize: 12.5, color: "var(--text-secondary)", flexWrap: "wrap" }}>
              {p.views > 0 && <span>{num(p.views)} views</span>}
              <span>{num(p.likes)} likes</span>
              <span>{num(p.comments)} comments</span>
              {p.score != null && <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>ICP {p.score}</span>}
            </div>
            {p.permalink && (
              <a href={p.permalink} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
                Open on Instagram <ExternalLink size={12} />
              </a>
            )}
          </>
        ) : (
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 4px" }}>
            {slot.state === "claimed"
              ? "Checked off, but no post was found for this slot. It turns green automatically if one shows up before the day closes."
              : `No ${slot.slot_type} detected yet for this slot.`}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16, borderTop: "1px solid var(--border-primary)", paddingTop: 14 }}>
          <button onClick={onToggle} disabled={busy || locked} style={{ ...pillBtn, cursor: busy || locked ? "default" : "pointer", opacity: locked ? 0.5 : 1 }}>
            {isComplete(slot.state) ? "Mark as missed" : "Mark done manually"}
          </button>
        </div>
        {day.finalized && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, textAlign: "right" }}>This day is closed</div>}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" };
const pillBtn: React.CSSProperties = { padding: "7px 14px", borderRadius: 999, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const numInput: React.CSSProperties = { display: "block", marginTop: 5, width: 70, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 14 };
const textInput: React.CSSProperties = { flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 13 };
