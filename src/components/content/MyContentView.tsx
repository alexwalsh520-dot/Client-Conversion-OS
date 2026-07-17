"use client";

// My Content — every post, scored against the buyer. The scoring system (ON TARGET / CLOSE / DRIFT),
// the filters, the sort, the date range and the detail read are all unchanged; only the chrome is,
// so it sits on the same white page as Playbook and Buyers. The band colours are the one place colour
// carries meaning here, so they stay — retuned to read on white.

import { useEffect, useMemo, useRef, useState } from "react";
import CalendarRange, { type DateRange } from "./CalendarRange";
import { H, Section, INK, BODY, MUTED, RULE, ACCENT, CARD } from "./creator-ui";

export type StudioPost = {
  id: string; permalink: string | null; media_type: string | null; caption: string | null;
  transcript: string | null; thumb: string | null; video: string | null; taken_at: string | null;
  likes: number; comments: number; views: number;
  score: number | null; band: string | null; hits: string[]; misses: string[]; feedback: string | null; verdict: string | null;
};
type Scoreboard = { streak: number; avg30: number | null; prevAvg30: number | null; best: number | null; onTargetMonth: number; totalScored: number };

const GREEN = "#2f7d4f", AMBER = "#95710f", RED = "#b4472a", DIM = MUTED;
function bandOf(score: number | null): { label: string; color: string } {
  if (score == null) return { label: "Not scored", color: DIM };
  if (score >= 70) return { label: "On target", color: GREEN };
  if (score >= 45) return { label: "Close", color: AMBER };
  return { label: "Drift", color: RED };
}
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

// Animated circular score ring with a counting-up number.
function ScoreRing({ score, size = 96 }: { score: number; size?: number }) {
  const [shown, setShown] = useState(0);
  const band = bandOf(score);
  const r = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(score); return; }
    let raf = 0; const start = performance.now(); const dur = 750;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(score * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [score]);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={RULE} strokeWidth={7} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={band.color} strokeWidth={7} fill="none" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - shown / 100)} style={{ transition: "stroke-dashoffset 60ms linear" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 500, color: band.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{shown}</span>
        <span style={{ fontSize: 11, color: band.color, marginTop: 2 }}>{band.label}</span>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span style={{ fontSize: 12, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
      {n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n} {label}
    </span>
  );
}

export default function MyContentView({ data, range, setRange }: { data: { posts: StudioPost[]; scoreboard: Scoreboard }; range: DateRange; setRange: (r: DateRange) => void }) {
  const [sort, setSort] = useState<"new" | "high" | "low" | "liked">("new");
  const [band, setBand] = useState<"all" | "on" | "close" | "drift">("all");
  const [open, setOpen] = useState<StudioPost | null>(null);
  const [calOpen, setCalOpen] = useState(false);
  const scrollRef = useRef(0);

  const inRange = useMemo(() => data.posts.filter((p) => { const d = dayOf(p.taken_at); return d && d >= range.from && d <= range.to; }), [data.posts, range]);
  const counts = useMemo(() => ({
    all: inRange.length,
    on: inRange.filter((p) => (p.score ?? -1) >= 70).length,
    close: inRange.filter((p) => (p.score ?? -1) >= 45 && (p.score ?? -1) < 70).length,
    drift: inRange.filter((p) => p.score != null && p.score < 45).length,
  }), [inRange]);
  const posts = useMemo(() => {
    let list = inRange;
    if (band === "on") list = list.filter((p) => (p.score ?? -1) >= 70);
    else if (band === "close") list = list.filter((p) => (p.score ?? -1) >= 45 && (p.score ?? -1) < 70);
    else if (band === "drift") list = list.filter((p) => p.score != null && p.score < 45);
    const s = [...list];
    if (sort === "new") s.sort((a, b) => (b.taken_at || "").localeCompare(a.taken_at || ""));
    else if (sort === "high") s.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    else if (sort === "low") s.sort((a, b) => (a.score ?? 999) - (b.score ?? 999));
    else s.sort((a, b) => b.likes - a.likes);
    return s;
  }, [inRange, band, sort]);

  const openPost = (p: StudioPost) => { scrollRef.current = window.scrollY; setOpen(p); };
  const closePost = () => { setOpen(null); requestAnimationFrame(() => window.scrollTo(0, scrollRef.current)); };

  const sb = data.scoreboard;
  const trend = sb.avg30 != null && sb.prevAvg30 != null ? sb.avg30 - sb.prevAvg30 : null;
  const link = (active: boolean): React.CSSProperties => ({
    background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 14, fontFamily: "inherit",
    color: active ? INK : MUTED, fontWeight: active ? 500 : 400,
  });

  const stat = (big: string, label: string, color?: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 500, color: color || INK, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{big}</div>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>{label}</div>
    </div>
  );

  return (
    <div>
      {/* Scoreboard — plain numbers in a card, no tiles-inside-tiles */}
      <Section>
        <H>Your numbers</H>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 24 }}>
          {stat(String(sb.streak), "on target streak", sb.streak > 0 ? GREEN : undefined)}
          {stat(sb.avg30 != null ? String(sb.avg30) : "n/a", trend != null ? `30-day avg (${trend >= 0 ? "+" : ""}${trend})` : "30-day avg", sb.avg30 != null ? bandOf(sb.avg30).color : undefined)}
          {stat(sb.best != null ? String(sb.best) : "n/a", "personal best", sb.best != null ? bandOf(sb.best).color : undefined)}
          {stat(String(sb.onTargetMonth), "on target this month", GREEN)}
        </div>
      </Section>

      <Section>
      {/* Controls — plain text links */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center", paddingBottom: 20, marginBottom: 20, borderBottom: `1px solid ${RULE}` }}>
        {(["all", "on", "close", "drift"] as const).map((b) => (
          <button key={b} onClick={() => setBand(b)} style={link(band === b)}>
            {b === "all" ? "All" : b === "on" ? "On target" : b === "close" ? "Close" : "Drift"}
            <span style={{ color: MUTED, marginLeft: 5 }}>{counts[b]}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
          style={{ border: "none", background: "none", color: MUTED, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>
          <option value="new">Newest</option>
          <option value="high">Highest score</option>
          <option value="low">Lowest score</option>
          <option value="liked">Most liked</option>
        </select>
        <button onClick={() => setCalOpen((v) => !v)} style={link(calOpen)}>Dates</button>
      </div>
      {calOpen && (
        <div style={{ marginBottom: 24, maxWidth: 420 }}>
          <CalendarRange value={range} onChange={(r) => setRange(r)} />
        </div>
      )}

      {/* Feed */}
      {posts.length === 0 ? (
        <p style={{ color: MUTED, fontSize: 16, margin: 0 }}>No posts in this range yet.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
          {posts.map((p) => {
            const bd = bandOf(p.score);
            return (
              <button key={p.id} onClick={() => openPost(p)} style={{ textAlign: "left", padding: 0, border: "none", background: "none", cursor: "pointer" }}>
                <div style={{ position: "relative", aspectRatio: "1/1", background: "#f2f2ef", borderRadius: 4, overflow: "hidden" }}>
                  {p.thumb ? <img src={p.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                  <span style={{ position: "absolute", top: 7, right: 7, padding: "2px 7px", borderRadius: 3, background: "rgba(255,255,255,.92)", color: bd.color, fontSize: 12.5, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{p.score ?? "?"}</span>
                </div>
                <div style={{ padding: "7px 1px 0", display: "flex", gap: 10 }}>
                  <Stat n={p.likes} label="likes" /><Stat n={p.comments} label="comments" />
                </div>
              </button>
            );
          })}
        </div>
      )}
      </Section>

      {/* Detail overlay */}
      {open && (
        <div onClick={closePost} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(20,20,20,.4)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "5vh 16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, background: CARD, backdropFilter: "blur(8px)", borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <div style={{ position: "relative", background: "#f2f2ef" }}>
              {open.video ? (
                <video src={open.video} poster={open.thumb || undefined} controls playsInline style={{ width: "100%", maxHeight: 420, objectFit: "contain", background: "#000" }} />
              ) : open.thumb ? <img src={open.thumb} alt="" style={{ width: "100%", maxHeight: 420, objectFit: "contain" }} /> : null}
              <button onClick={closePost} aria-label="Close" style={{ position: "absolute", top: 10, right: 10, width: 32, height: 32, borderRadius: 999, border: "none", background: "rgba(255,255,255,.9)", color: INK, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: 26 }}>
              {open.score != null ? (
                <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 22 }}>
                  <ScoreRing score={open.score} />
                  <div style={{ minWidth: 0 }}>
                    {open.verdict && <div style={{ fontSize: 17, color: INK, lineHeight: 1.45 }}>{open.verdict}</div>}
                    <div style={{ fontSize: 13, color: MUTED, marginTop: 5 }}>how well this speaks to your buyer</div>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 15, color: MUTED, margin: "0 0 18px" }}>Not scored yet. Scoring runs automatically as your content syncs.</p>
              )}

              {open.hits?.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, color: MUTED, marginBottom: 10 }}>Why this lands</div>
                  {open.hits.slice(0, 5).map((h, i) => (
                    <p key={i} style={{ fontSize: 15, color: BODY, lineHeight: 1.6, margin: "0 0 7px" }}>{h}</p>
                  ))}
                </div>
              )}
              {open.misses?.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 14, color: MUTED, marginBottom: 10 }}>What would make your buyer stop scrolling</div>
                  {open.misses.slice(0, 5).map((h, i) => (
                    <p key={i} style={{ fontSize: 15, color: BODY, lineHeight: 1.6, margin: "0 0 7px" }}>{h}</p>
                  ))}
                </div>
              )}
              {open.feedback && <p style={{ fontSize: 16, color: INK, lineHeight: 1.65, margin: "0 0 20px" }}>{open.feedback}</p>}

              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
                <Stat n={open.likes} label="likes" /><Stat n={open.comments} label="comments" />{open.views > 0 && <Stat n={open.views} label="views" />}
                {open.taken_at && <span style={{ fontSize: 12, color: MUTED }}>{dayOf(open.taken_at)}</span>}
              </div>
              {open.caption && <p style={{ fontSize: 15, color: BODY, lineHeight: 1.65, margin: "0 0 12px", whiteSpace: "pre-wrap" }}>{open.caption.slice(0, 600)}</p>}
              {open.permalink && <a href={open.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: ACCENT, textDecoration: "none" }}>open on Instagram</a>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
