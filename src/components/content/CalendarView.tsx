"use client";

// Operator-only Content Calendar — the accountability grid. A week of Mon..Sun columns, each a stack
// of slots: labeled reel rectangles ("Reel 1"..), one carousel, one story with its theme. Green =
// done (detected post or manual mark), red = the ET day is over and the slot is unfilled, neutral =
// today/future or a rest day. Clicking a REEL opens a popover to watch the post that filled it (with
// its real numbers) or to override the mark; carousel/story toggle directly. A metrics panel on the
// right (below on mobile) reads the visible week; a gear opens the editable cadence.
//
// Freshness answers two separate questions and never merges them: "did the pipeline run?" (the
// ingest heartbeat — only this raises the amber unverified banner) and "did the creator post?"
// (newest_post_at). A live pipeline that found nothing new means the reds are honest misses.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, Settings, Film, LayoutGrid, Circle, AlertTriangle, Play, X, ExternalLink } from "lucide-react";
import { etToday, shiftWeek, prettyDate, DOW, type StorySchedule } from "@/lib/content/calendar";

type SlotPost = {
  ig_media_id: string; permalink: string | null; thumb: string | null; video: string | null;
  taken_at: string | null; likes: number; comments: number; views: number; score: number | null;
};
type Slot = {
  slot_type: "reel" | "carousel" | "story"; slot_index: number;
  state: "done" | "missed" | "pending"; manual: boolean; label?: string; post?: SlotPost;
};
type Day = { date: string; dow: string; is_rest: boolean; slots: Slot[]; reels_posted: number; carousels_posted: number; reels_target: number; carousels_target: number; story_label: string | null };
type Cadence = { reels_per_day: number; carousels_per_day: number; story_schedule: StorySchedule };
type CalResp = {
  creator: string; week_start: string; today: string; cadence: Cadence; days: Day[];
  synced_at: string | null; sync_age_hours: number | null; sync_stale: boolean; newest_post_at: string | null;
};

const GREEN = "#2f9e5f", GREEN_BG = "rgba(47,158,95,0.16)";
const RED = "#d0512f", RED_BG = "rgba(208,81,47,0.14)";
const DOW_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function slotColor(s: Slot): React.CSSProperties {
  if (s.state === "done") return { background: GREEN_BG, borderColor: GREEN, color: GREEN };
  if (s.state === "missed") return { background: RED_BG, borderColor: RED, color: RED };
  return { background: "var(--bg-glass)", borderColor: "var(--border-primary)", color: "var(--text-muted)" };
}

export default function CalendarView({ creator }: { creator: string }) {
  const [week, setWeek] = useState<string>(etToday);
  const [data, setData] = useState<CalResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [openSlot, setOpenSlot] = useState<{ day: Day; slot: Slot } | null>(null);

  const load = useCallback(async (creatorKey: string, wk: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/calendar?creator=${creatorKey}&week=${wk}`, { cache: "no-store" });
      const j = await res.json();
      // A failed/unauthorized response has no days[] — keep it out of state so the grid never
      // renders against a half-shaped payload.
      setData(Array.isArray(j?.days) ? j : null);
    } catch {
      setData(null);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(creator, week); }, [creator, week, load]);

  const toggle = async (day: Day, slot: Slot) => {
    if (day.is_rest) return;
    const key = `${day.date}|${slot.slot_type}|${slot.slot_index}`;
    setBusy(key);
    // Toggle target = opposite of the CURRENT visible state being "done".
    const nextDone = slot.state !== "done";
    try {
      await fetch("/api/content/calendar/mark", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator, for_date: day.date, slot_type: slot.slot_type, slot_index: slot.slot_index, done: nextDone }),
      });
      await load(creator, week);
    } finally { setBusy(null); }
  };

  // Week metrics (reels/carousels/stories done vs expected across the visible week).
  const metrics = useMemo(() => {
    if (!data || !Array.isArray(data.days) || !data.days.length) return null;
    const tally = { reel: [0, 0], carousel: [0, 0], story: [0, 0] } as Record<string, [number, number]>;
    let doneSlots = 0, dueSlots = 0, streak = 0;
    for (const d of data.days) {
      for (const s of d.slots) {
        tally[s.slot_type][1] += 1;
        if (s.state === "done") tally[s.slot_type][0] += 1;
        if (s.state !== "pending") { dueSlots += 1; if (s.state === "done") doneSlots += 1; }
      }
    }
    // Streak: consecutive fully-green days counting back from the latest day that is fully evaluated
    // (all slots done), skipping rest days, stopping at the first day with a missed slot.
    const evaluated = data.days.filter((d) => !d.is_rest && d.date <= data.today);
    for (let i = evaluated.length - 1; i >= 0; i--) {
      const d = evaluated[i];
      const anyMissed = d.slots.some((s) => s.state === "missed");
      const allDone = d.slots.length > 0 && d.slots.every((s) => s.state === "done");
      if (anyMissed) break;
      if (allDone) streak += 1; else break; // today not-yet-complete stops the streak without breaking it red
    }
    const pct = dueSlots ? Math.round((doneSlots / dueSlots) * 100) : null;
    // Today's remaining, in words.
    const today = data.days.find((d) => d.date === data.today);
    let todayLine = "";
    if (today && !today.is_rest) {
      const need = (t: string) => today.slots.filter((s) => s.slot_type === t && s.state !== "done").length;
      const parts = [
        need("reel") ? `${need("reel")} reel${need("reel") > 1 ? "s" : ""}` : "",
        need("carousel") ? `${need("carousel")} carousel` : "",
        need("story") ? "1 story" : "",
      ].filter(Boolean);
      todayLine = parts.length ? `${parts.join(", ")}${today.story_label ? ` — ${today.story_label}` : ""}` : "All done for today ✓";
    } else if (today?.is_rest) {
      todayLine = "Rest day";
    }
    return { tally, pct, streak, todayLine };
  }, [data]);

  const shiftTo = (weeks: number) => setWeek((w) => shiftWeek(w, weeks));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Top bar: week nav + gear */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => shiftTo(-1)} style={navBtn} title="Previous week"><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", minWidth: 190, textAlign: "center" }}>
          {data ? `${prettyDate(data.days[0].date)} – ${prettyDate(data.days[6].date)}` : "…"}
        </div>
        <button onClick={() => shiftTo(1)} style={navBtn} title="Next week"><ChevronRight size={16} /></button>
        <button onClick={() => setWeek(etToday())} style={{ ...pillBtn, fontSize: 12.5 }}>This week</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setEditing(true)} title="Edit cadence" aria-label="Edit cadence" style={{ ...navBtn }}><Settings size={16} /></button>
      </div>

      {/* The banner fires ONLY when the pipeline itself is behind. A healthy pipeline that found
          nothing new means the creator didn't post — the red slots are honest, so we stay quiet. */}
      {data && data.sync_stale && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 14px", borderRadius: 10, border: "1px solid rgba(214,158,46,0.45)", background: "rgba(214,158,46,0.12)" }}>
          <AlertTriangle size={16} style={{ color: "#b7791f", flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
            <strong style={{ color: "var(--text-primary)" }}>The post sync is behind.</strong>{" "}
            {data.synced_at
              ? `The ingest last completed ${data.sync_age_hours}h ago (${new Date(data.synced_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET).`
              : "No successful ingest on record."}{" "}
            Red slots below are <em>unverified</em>, not confirmed misses.
          </div>
        </div>
      )}

      {loading || !data ? (
        <div style={{ color: "var(--text-muted)", padding: 60, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 18, alignItems: "start" }} className="cal-wrap">
          {/* scroll host for the grid on narrow screens */}
          {/* Week grid — scrolls sideways on narrow screens so the seven columns stay readable
              instead of crushing the story labels together. */}
          <div className="cal-grid" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8, minWidth: 0 }}>
            {data.days.map((d) => {
              const isToday = d.date === data.today;
              return (
                <div key={d.date} style={{ background: "var(--bg-card)", border: `1px solid ${isToday ? "var(--accent)" : "var(--border-primary)"}`, borderRadius: 12, padding: "10px 8px", minWidth: 0 }}>
                  <div style={{ textAlign: "center", marginBottom: 8 }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: isToday ? "var(--accent)" : "var(--text-secondary)", letterSpacing: 0.3 }}>{DOW_LABEL[d.dow]}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{d.date.slice(5)}</div>
                  </div>
                  {d.is_rest ? (
                    <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 11, padding: "18px 0" }}>Rest</div>
                  ) : (
                    <div style={{ display: "grid", gap: 6 }}>
                      {/* reels: labeled rectangles — click opens the slot popover (watch / override) */}
                      <div style={{ display: "grid", gap: 3 }}>
                        {d.slots.filter((s) => s.slot_type === "reel").map((s) => (
                          <button key={s.slot_index} onClick={() => setOpenSlot({ day: d, slot: s })} disabled={!!busy}
                            title={`Reel ${s.slot_index} — ${s.state}${s.manual ? " (manual)" : ""}`}
                            style={{ height: 20, borderRadius: 5, border: "1px solid", cursor: "pointer", padding: "0 6px", fontSize: 9.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 4, ...slotColor(s) }}>
                            <span>Reel {s.slot_index}</span>
                            {s.post && <Play size={8} style={{ marginLeft: "auto", opacity: 0.9 }} />}
                          </button>
                        ))}
                      </div>
                      {/* carousel slot(s) */}
                      {d.slots.filter((s) => s.slot_type === "carousel").map((s) => (
                        <button key={s.slot_index} onClick={() => toggle(d, s)} disabled={!!busy} title={`Carousel — ${s.state}`}
                          style={{ height: 18, borderRadius: 5, border: "1px solid", cursor: "pointer", fontSize: 9, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", ...slotColor(s) }}>
                          <LayoutGrid size={10} />
                        </button>
                      ))}
                      {/* story slot with theme label */}
                      {d.slots.filter((s) => s.slot_type === "story").map((s) => (
                        <button key={s.slot_index} onClick={() => toggle(d, s)} disabled={!!busy} title={`Story — ${s.state} (manual only)`}
                          style={{ borderRadius: 6, border: "1px solid", cursor: "pointer", padding: "5px 6px", textAlign: "left", ...slotColor(s) }}>
                          <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", opacity: 0.8 }}>Story</div>
                          <div style={{ fontSize: 10, lineHeight: 1.25, color: "var(--text-secondary)" }}>{s.label}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Metrics panel */}
          {metrics && (
            <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 18, display: "grid", gap: 16 }} className="cal-metrics">
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
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>day green streak</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, borderTop: "1px solid var(--border-primary)", paddingTop: 12 }}>
                {/* Always state when the data is from — silence here is what let stale data pass as absence. */}
                {/* Two separate facts, never conflated: when the pipeline last ran, and when the
                    creator last posted. "Checked X ago, nothing new since Y" is the honest read. */}
                <div style={{ color: data.sync_stale ? "#b7791f" : "var(--text-muted)", fontWeight: data.sync_stale ? 700 : 400, marginBottom: 4 }}>
                  {data.synced_at
                    ? `Instagram checked ${data.sync_age_hours}h ago (${new Date(data.synced_at).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET)`
                    : "No successful ingest on record"}
                </div>
                <div style={{ marginBottom: 6 }}>
                  {data.newest_post_at
                    ? `Last post detected ${new Date(data.newest_post_at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`
                    : "No posts detected yet"}
                </div>
                Reels &amp; carousels turn green within ~2h of posting (scrape cadence). Stories are manual-only — scrapers can&rsquo;t see them, so tap the story box once you post it.
              </div>
            </div>
          )}
        </div>
      )}

      {openSlot && (
        <SlotPopover
          day={openSlot.day}
          slot={openSlot.slot}
          busy={!!busy}
          onClose={() => setOpenSlot(null)}
          onToggle={async () => { await toggle(openSlot.day, openSlot.slot); setOpenSlot(null); }}
        />
      )}

      {editing && data && (
        <CadenceEditor creator={creator} initial={data.cadence} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(creator, week); }} />
      )}

      <style>{`
        .spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
        @media (max-width: 860px){
          .cal-wrap{grid-template-columns:1fr !important}
          /* keep all seven days but give each a readable width and scroll sideways */
          .cal-grid{grid-template-columns:repeat(7, minmax(104px, 1fr)) !important; overflow-x:auto; padding-bottom:6px}
        }
      `}</style>
    </div>
  );
}

function CadenceEditor({ creator, initial, onClose, onSaved }: { creator: string; initial: Cadence; onClose: () => void; onSaved: () => void }) {
  const [reels, setReels] = useState(initial.reels_per_day);
  const [cars, setCars] = useState(initial.carousels_per_day);
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
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator, reels_per_day: reels, carousels_per_day: cars, story_schedule: schedule }),
      });
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "6vh 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 22 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text-primary)", marginBottom: 16 }}>Cadence — {creator}</div>
        <div style={{ display: "flex", gap: 18, marginBottom: 18 }}>
          <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>Reels / day
            <input type="number" min={0} max={20} value={reels} onChange={(e) => setReels(Number(e.target.value))} style={numInput} />
          </label>
          <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>Carousels / day
            <input type="number" min={0} max={20} value={cars} onChange={(e) => setCars(Number(e.target.value))} style={numInput} />
          </label>
        </div>
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Story theme by day</div>
        <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
          {DOW.map((d) => (
            <div key={d} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 34, fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>{DOW_LABEL[d]}</span>
              <input value={labels[d]} disabled={rest[d]} onChange={(e) => setLabels((o) => ({ ...o, [d]: e.target.value }))} placeholder={rest[d] ? "Rest day" : "Story theme"}
                style={{ ...textInput, opacity: rest[d] ? 0.5 : 1 }} />
              <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, color: "var(--text-muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
                <input type="checkbox" checked={rest[d]} onChange={(e) => setRest((o) => ({ ...o, [d]: e.target.checked }))} /> rest
              </label>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ ...pillBtn }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ ...pillBtn, background: "var(--accent)", color: "#1a1a1a", border: "none", fontWeight: 800 }}>{saving ? "Saving…" : "Save cadence"}</button>
        </div>
      </div>
    </div>
  );
}


// One slot, opened from the grid: the reel that filled it (playable, with its real numbers) or the
// empty-state, plus the manual override. Manual toggling for reel slots lives here rather than on the
// rectangle, so a click can mean "show me this" instead of accidentally flipping the mark.
function SlotPopover({ day, slot, busy, onClose, onToggle }: { day: Day; slot: Slot; busy: boolean; onClose: () => void; onToggle: () => void }) {
  const p = slot.post;
  const num = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "5vh 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 380, maxHeight: "90vh", overflowY: "auto", background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)", textTransform: "capitalize" }}>
            {slot.slot_type} {slot.slot_index}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{prettyDate(day.date)}</div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "grid", placeItems: "center" }}><X size={16} /></button>
        </div>

        {p ? (
          <>
            {p.video ? (
              <video src={p.video} poster={p.thumb || undefined} controls playsInline
                style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 380, objectFit: "contain" }} />
            ) : p.thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumb} alt="" style={{ width: "100%", borderRadius: 10, objectFit: "cover" }} />
            ) : (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 12.5, border: "1px dashed var(--border-primary)", borderRadius: 10 }}>
                Post detected, but no media URL stored yet.
              </div>
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
            No {slot.slot_type} detected yet for this slot.
            {slot.slot_type === "story" && " Stories can't be detected — mark it manually once posted."}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16, borderTop: "1px solid var(--border-primary)", paddingTop: 14 }}>
          <button onClick={onToggle} disabled={busy} style={{ ...pillBtn, cursor: busy ? "default" : "pointer" }}>
            {slot.state === "done" ? "Mark as missed" : "Mark done manually"}
          </button>
        </div>
        {slot.manual && (
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, textAlign: "right" }}>Manually overridden</div>
        )}
      </div>
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" };
const pillBtn: React.CSSProperties = { padding: "7px 14px", borderRadius: 999, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const numInput: React.CSSProperties = { display: "block", marginTop: 5, width: 70, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 14 };
const textInput: React.CSSProperties = { flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 13 };
