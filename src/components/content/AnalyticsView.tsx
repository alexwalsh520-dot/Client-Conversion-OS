"use client";

import { useMemo, useState } from "react";
import { X, Copy, Check, ExternalLink, Play } from "lucide-react";
import type { CreatorContent, ContentReel } from "@/lib/content-data";

const RANGES = [
  { key: "30", label: "30 days", days: 30 },
  { key: "90", label: "90 days", days: 90 },
  { key: "365", label: "12 months", days: 365 },
  { key: "all", label: "All time", days: 99999 },
] as const;

function fmt(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n ?? 0); }
function dateShort(s: string | null) { return s ? new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—"; }
function embedUrl(permalink: string | null) { return permalink ? permalink.replace(/\/+$/, "") + "/embed" : null; }

function CopyBtn({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--border-hover)", background: "var(--bg-glass)", color: done ? "var(--accent)" : "var(--text-secondary)", cursor: "pointer" }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? "Copied" : label}
    </button>
  );
}

// Ads-tab-style trend card: a labelled mini bar chart in the CCOS glass style.
function TrendCard({ title, value, series, labels, color = "var(--accent)" }: { title: string; value: string; series: number[]; labels: string[]; color?: string }) {
  const max = Math.max(1, ...series);
  return (
    <div className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: "13px 16px 11px", flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: "2px 0 8px" }}>{value}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40 }}>
        {series.map((v, i) => (
          <div key={i} title={`${labels[i]}: ${v}`} style={{ flex: 1, height: `${Math.max(3, (v / max) * 100)}%`, background: color, opacity: 0.35 + 0.65 * (v / max), borderRadius: "2px 2px 0 0" }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9.5, color: "var(--text-muted)" }}>
        <span>{labels[0]}</span><span>{labels[labels.length - 1]}</span>
      </div>
    </div>
  );
}

export default function AnalyticsView({ data }: { data: CreatorContent }) {
  const [range, setRange] = useState<string>("90");
  const [open, setOpen] = useState<ContentReel | null>(null);

  const reels = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? 99999;
    const cutoff = Date.now() - days * 864e5;
    return data.reels
      .filter((r) => !r.taken_at || new Date(r.taken_at).getTime() >= cutoff)
      .sort((a, b) => ((b.like_count || 0) + (b.comment_count || 0)) - ((a.like_count || 0) + (a.comment_count || 0)));
  }, [data.reels, range]);

  const totalLikes = reels.reduce((s, r) => s + (r.like_count || 0), 0);
  const totalComments = reels.reduce((s, r) => s + (r.comment_count || 0), 0);

  // Monthly trend over the selected range (last up to 12 months with posts).
  const trend = useMemo(() => {
    const months = new Map<string, { posts: number; eng: number }>();
    for (const r of reels) {
      if (!r.taken_at) continue;
      const d = new Date(r.taken_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const m = months.get(k) || { posts: 0, eng: 0 };
      m.posts += 1; m.eng += (r.like_count || 0) + (r.comment_count || 0);
      months.set(k, m);
    }
    const keys = [...months.keys()].sort().slice(-12);
    const labels = keys.map((k) => { const [, mo] = k.split("-"); return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(mo) - 1]; });
    return {
      labels,
      posts: keys.map((k) => months.get(k)!.posts),
      avgEng: keys.map((k) => { const m = months.get(k)!; return m.posts ? Math.round(m.eng / m.posts) : 0; }),
    };
  }, [reels]);

  const stat = (v: string, l: string) => (
    <div className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: "13px 18px" }}>
      <div style={{ fontSize: 21, fontWeight: 700, color: "var(--text-primary)" }}>{v}</div>
      <div style={{ fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 2 }}>{l}</div>
    </div>
  );

  return (
    <div>
      {/* Range pills + summary */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ display: "inline-flex", background: "var(--bg-glass)", borderRadius: 10, padding: 3, border: "1px solid var(--border-primary)" }}>
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)}
              style={{ padding: "6px 13px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: range === r.key ? "var(--accent)" : "transparent", color: range === r.key ? "#1a1a1a" : "var(--text-secondary)" }}>
              {r.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 10 }}>{stat(String(reels.length), "Posts")}{stat(fmt(totalLikes), "Likes")}{stat(fmt(totalComments), "Comments")}</div>
      </div>

      {trend.labels.length > 1 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <TrendCard title="Posts per month" value={String(reels.length)} series={trend.posts} labels={trend.labels} />
          <TrendCard title="Avg engagement / post" value={fmt(Math.round((totalLikes + totalComments) / Math.max(1, reels.length)))} series={trend.avgEng} labels={trend.labels} color="#37d67a" />
        </div>
      )}

      <p style={{ color: "var(--text-muted)", fontSize: 12.5, margin: "0 0 16px" }}>
        Ranked by engagement — top performers first. Click any post to watch it, read the transcript, and copy the copy. Views unlock once the creator re-approves the Instagram connection with insights access.
      </p>

      {reels.length === 0 ? (
        <div className="glass" style={{ background: "var(--bg-card)", border: "1px dashed var(--border-hover)", borderRadius: 14, padding: 28, color: "var(--text-secondary)" }}>
          No posts in this range. {data.reels.length === 0 ? "Hit “Pull latest posts” to ingest this creator’s reels." : "Try a wider range."}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 14 }}>
          {reels.map((r, i) => (
            <button key={r.id} onClick={() => setOpen(r)} className="glass"
              style={{ textAlign: "left", background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, overflow: "hidden", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ aspectRatio: "9/16", background: "var(--bg-glass)", position: "relative" }}>
                {(r.stored_thumb_url || r.thumbnail_url)
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={r.stored_thumb_url || r.thumbnail_url || ""} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <div style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)" }}><Play size={22} /></div>}
                {i < 3 && <span style={{ position: "absolute", top: 6, left: 6, fontSize: 10, fontWeight: 700, color: "#1a1a1a", background: "var(--accent)", padding: "2px 7px", borderRadius: 5 }}>#{i + 1}</span>}
                {r.transcript_status === "done" && <span style={{ position: "absolute", top: 6, right: 6, fontSize: 9, fontWeight: 700, color: "#fff", background: "rgba(0,0,0,.6)", padding: "2px 6px", borderRadius: 5 }}>T:✓</span>}
              </div>
              <div style={{ padding: "9px 11px" }}>
                <div style={{ fontSize: 11.5, color: "var(--text-secondary)", lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", minHeight: 30 }}>
                  {(r.caption || "(no caption)").slice(0, 120)}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginTop: 7 }}>
                  <span>♥ {fmt(r.like_count || 0)} · 💬 {fmt(r.comment_count || 0)}</span><span>{dateShort(r.taken_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Reel popup */}
      {open && (
        <div onClick={() => setOpen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", backdropFilter: "blur(6px)", zIndex: 1000, display: "grid", placeItems: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} className="glass"
            style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-hover)", borderRadius: 18, width: "min(880px, 96vw)", maxHeight: "90vh", overflow: "hidden", display: "grid", gridTemplateColumns: "minmax(300px, 360px) 1fr" }}>
            <div style={{ background: "#000", minHeight: 480, display: "flex" }}>
              {open.stored_video_url
                ? <video controls autoPlay playsInline src={open.stored_video_url} style={{ width: "100%", height: "100%", minHeight: 480, objectFit: "contain", background: "#000" }} />
                : embedUrl(open.permalink)
                  ? <iframe src={embedUrl(open.permalink)!} title="reel" style={{ width: "100%", height: "100%", minHeight: 480, border: "none" }} allow="encrypted-media" />
                  : <div style={{ color: "#888", display: "grid", placeItems: "center", height: "100%", width: "100%" }}>No video available</div>}
            </div>
            <div style={{ padding: 20, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>♥ {fmt(open.like_count || 0)} · 💬 {fmt(open.comment_count || 0)} · {dateShort(open.taken_at)}</div>
                <button onClick={() => setOpen(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <h4 style={{ margin: 0, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Caption</h4>
                  {open.caption && <CopyBtn text={open.caption} label="Copy" />}
                </div>
                <div style={{ fontSize: 13.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{open.caption || "(no caption)"}</div>
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <h4 style={{ margin: 0, fontSize: 12, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Transcript</h4>
                  {open.transcript && <CopyBtn text={open.transcript} label="Copy" />}
                </div>
                <div style={{ fontSize: 13.5, color: open.transcript ? "var(--text-secondary)" : "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {open.transcript
                    || (open.transcript_status === "failed" ? "Transcription failed for this one."
                    : open.transcript_status === "na" ? "No audio / not transcribable."
                    : "Not transcribed yet — runs automatically once the Groq key is added.")}
                </div>
              </div>
              {open.permalink && <a href={open.permalink} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}><ExternalLink size={13} /> Open on Instagram</a>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
