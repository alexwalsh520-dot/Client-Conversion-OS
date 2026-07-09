"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Heart, MessageCircle, Play, Check, ArrowUpRight, Calendar as CalIcon, Flame } from "lucide-react";
import CalendarRange, { type DateRange } from "./CalendarRange";

export type StudioPost = {
  id: string; permalink: string | null; media_type: string | null; caption: string | null;
  transcript: string | null; thumb: string | null; video: string | null; taken_at: string | null;
  likes: number; comments: number; views: number;
  score: number | null; band: string | null; hits: string[]; misses: string[]; feedback: string | null; verdict: string | null;
};
type Scoreboard = { streak: number; avg30: number | null; prevAvg30: number | null; best: number | null; onTargetMonth: number; totalScored: number };

const GREEN = "#8ce0ab", AMBER = "#e4c66a", RED = "#e0794d", DIM = "#6b6b74";
function bandOf(score: number | null): { label: string; color: string } {
  if (score == null) return { label: "NOT SCORED", color: DIM };
  if (score >= 70) return { label: "ON TARGET", color: GREEN };
  if (score >= 45) return { label: "CLOSE", color: AMBER };
  return { label: "DRIFT", color: RED };
}
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

// Animated circular score ring with a counting-up number.
function ScoreRing({ score, size = 108 }: { score: number; size?: number }) {
  const [shown, setShown] = useState(0);
  const band = bandOf(score);
  const r = (size - 14) / 2;
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
  const glow = score >= 85;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)", filter: glow ? `drop-shadow(0 0 8px ${band.color})` : "none" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#26262b" strokeWidth={9} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={band.color} strokeWidth={9} fill="none" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - shown / 100)} style={{ transition: "stroke-dashoffset 60ms linear" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.3, fontWeight: 800, color: band.color, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{shown}</span>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: band.color, marginTop: 3 }}>{band.label}</span>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
      {label === "likes" ? <Heart size={11} /> : label === "comments" ? <MessageCircle size={11} /> : <Play size={11} />}
      {n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n}
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
  const chip = (active: boolean): React.CSSProperties => ({ padding: "6px 12px", borderRadius: 999, border: `1px solid ${active ? "var(--accent)" : "var(--border-primary)"}`, background: active ? "var(--accent-soft)" : "transparent", color: active ? "var(--text-primary)" : "var(--text-muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" });

  const tile = (big: string, label: string, color?: string) => (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: color || "var(--text-primary)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{big}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>{label}</div>
    </div>
  );

  return (
    <div>
      {/* Scoreboard */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: sb.streak > 0 ? GREEN : "var(--text-primary)", lineHeight: 1, display: "flex", alignItems: "center", gap: 5 }}>
            {sb.streak > 0 && <Flame size={17} />}{sb.streak}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5 }}>on target streak</div>
        </div>
        {tile(sb.avg30 != null ? String(sb.avg30) : "n/a", trend != null ? `30-day avg (${trend >= 0 ? "+" : ""}${trend})` : "30-day avg", sb.avg30 != null ? bandOf(sb.avg30).color : undefined)}
        {tile(sb.best != null ? String(sb.best) : "n/a", "personal best", sb.best != null ? bandOf(sb.best).color : undefined)}
        {tile(String(sb.onTargetMonth), "on target this month", GREEN)}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        {(["all", "on", "close", "drift"] as const).map((b) => (
          <button key={b} onClick={() => setBand(b)} style={chip(band === b)}>
            {b === "all" ? "All" : b === "on" ? "ON TARGET" : b === "close" ? "CLOSE" : "DRIFT"}
            <span style={{ marginLeft: 6, opacity: 0.7 }}>{counts[b]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}
          style={{ padding: "7px 12px", borderRadius: 999, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          <option value="new">Newest</option>
          <option value="high">Highest score</option>
          <option value="low">Lowest score</option>
          <option value="liked">Most liked</option>
        </select>
        <button onClick={() => setCalOpen((v) => !v)} style={{ ...chip(calOpen), display: "inline-flex", alignItems: "center", gap: 6 }}><CalIcon size={14} /> Dates</button>
      </div>
      {calOpen && (
        <div style={{ marginBottom: 16, maxWidth: 420 }}>
          <CalendarRange value={range} onChange={(r) => setRange(r)} />
        </div>
      )}

      {/* Feed */}
      {posts.length === 0 ? (
        <div style={{ color: "var(--text-muted)", padding: 40, textAlign: "center", fontSize: 14 }}>No posts in this range yet.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {posts.map((p) => {
            const bd = bandOf(p.score);
            return (
              <button key={p.id} onClick={() => openPost(p)} style={{ textAlign: "left", padding: 0, border: "1px solid var(--border-primary)", borderRadius: 12, overflow: "hidden", background: "var(--bg-card)", cursor: "pointer", borderBottom: `3px solid ${bd.color}` }}>
                <div style={{ position: "relative", aspectRatio: "1/1", background: "#0d0d10" }}>
                  {p.thumb ? <img src={p.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null}
                  <span style={{ position: "absolute", top: 8, right: 8, minWidth: 30, textAlign: "center", padding: "3px 7px", borderRadius: 999, background: "rgba(0,0,0,.72)", color: bd.color, fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums", border: `1px solid ${bd.color}` }}>{p.score ?? "?"}</span>
                </div>
                <div style={{ padding: "8px 10px", display: "flex", gap: 10 }}>
                  <Stat n={p.likes} label="likes" /><Stat n={p.comments} label="comments" />{p.views > 0 && <Stat n={p.views} label="views" />}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail overlay */}
      {open && (
        <div onClick={closePost} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.66)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "5vh 16px" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 540, background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ position: "relative", background: "#0d0d10" }}>
              {open.video ? (
                <video src={open.video} poster={open.thumb || undefined} controls playsInline style={{ width: "100%", maxHeight: 420, objectFit: "contain", background: "#000" }} />
              ) : open.thumb ? <img src={open.thumb} alt="" style={{ width: "100%", maxHeight: 420, objectFit: "contain" }} /> : null}
              <button onClick={closePost} style={{ position: "absolute", top: 10, right: 10, width: 34, height: 34, borderRadius: 999, border: "none", background: "rgba(0,0,0,.6)", color: "#fff", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
            </div>
            <div style={{ padding: 20 }}>
              {open.score != null ? (
                <div style={{ display: "flex", gap: 18, alignItems: "center", marginBottom: 16 }}>
                  <ScoreRing score={open.score} />
                  <div style={{ minWidth: 0 }}>
                    {open.verdict && <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.4 }}>{open.verdict}</div>}
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>how well this speaks to your buyer</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>Not scored yet. Scoring runs automatically as your content syncs.</div>
              )}

              {open.hits?.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Why this lands</div>
                  {open.hits.slice(0, 5).map((h, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 5 }}>
                      <Check size={15} style={{ color: GREEN, flexShrink: 0, marginTop: 2 }} />{h}
                    </div>
                  ))}
                </div>
              )}
              {open.misses?.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>What would make your buyer stop scrolling</div>
                  {open.misses.slice(0, 5).map((h, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 5 }}>
                      <ArrowUpRight size={15} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2 }} />{h}
                    </div>
                  ))}
                </div>
              )}
              {open.feedback && <p style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6, margin: "0 0 14px" }}>{open.feedback}</p>}

              <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 12, color: "var(--text-muted)" }}>
                <Stat n={open.likes} label="likes" /><Stat n={open.comments} label="comments" />{open.views > 0 && <Stat n={open.views} label="views" />}
                {open.taken_at && <span style={{ fontSize: 11 }}>{dayOf(open.taken_at)}</span>}
              </div>
              {open.caption && <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.6, margin: "0 0 10px", whiteSpace: "pre-wrap" }}>{open.caption.slice(0, 600)}</p>}
              {open.permalink && <a href={open.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>open on Instagram</a>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
