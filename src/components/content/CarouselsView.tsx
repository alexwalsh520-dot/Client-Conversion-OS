"use client";

// Operator-only Carousels tab. Reader-first: one carousel at a time, one slide filling the view, copy
// readable without zooming. Swipe / arrows / chevrons move through slides and flow across the day's 5
// carousels; pills jump straight to any carousel. Edit + per-slide download stay one tap away; the
// studio editor + PNG rendering are unchanged.
//
// Downloads are per carousel, never per day — a carousel is one post, so it comes down as one group.
// The top-bar button always names the carousel in view, and every pill can grab its own carousel
// without swiping to it first.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, Pencil, Download, GalleryHorizontal, Sparkles } from "lucide-react";
import SlideEditor from "./SlideEditor";
import { renderSlide, blocksForSlide, loadAvatar, ensureFonts, downloadSlide, CANVAS_W, CANVAS_H, type SlideBlock } from "@/lib/content/carousel-render";

type Slide = { text?: string; blocks?: SlideBlock[] };
type Row = { id: number; client_key: string; for_date: string; slot: number; topic: string | null; slides: Slide[]; edited: boolean };

const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const shiftDate = (d: string, delta: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); };
const prettyDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// One slide rendered large + responsive (the same canvas renderer used everywhere).
function BigSlide({ blocks, creator }: { blocks: SlideBlock[]; creator: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);
  useEffect(() => { let live = true; ensureFonts().then(() => loadAvatar(creator)).then((a) => { if (live) setAvatar(a); }); return () => { live = false; }; }, [creator]);
  useEffect(() => { if (ref.current) renderSlide(ref.current, blocks, creator, avatar); }, [blocks, creator, avatar]);
  return <canvas ref={ref} style={{ width: "100%", aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, display: "block", background: "#000", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,.45)" }} />;
}

export default function CarouselsView({ creator }: { creator: string }) {
  const [date, setDate] = useState<string>(todayET);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<{ carIdx: number; slideIdx: number } | null>(null);
  const [pos, setPos] = useState(0); // flat index across the day's slides
  const [dling, setDling] = useState<number | null>(null); // slot currently being zipped

  useEffect(() => { ensureFonts(); }, []);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/carousels?creator=${creator}&date=${d}`, { cache: "no-store" });
      const j = await res.json();
      setRows((j.carousels || []).sort((a: Row, b: Row) => a.slot - b.slot));
      setPos(0);
    } finally { setLoading(false); }
  }, [creator]);
  useEffect(() => { load(date); }, [date, load]);

  // Flat list of every slide across the 5 carousels → one continuous swipe through the whole day.
  const flat = useMemo(() => {
    const out: { carIdx: number; slideIdx: number }[] = [];
    (rows || []).forEach((row, carIdx) => row.slides.forEach((_, slideIdx) => out.push({ carIdx, slideIdx })));
    return out;
  }, [rows]);
  const last = flat.length - 1;
  const safePos = Math.min(Math.max(0, pos), Math.max(0, last));
  const cur = flat[safePos];
  const next = useCallback(() => setPos((p) => Math.min(last, p + 1)), [last]);
  const prev = useCallback(() => setPos((p) => Math.max(0, p - 1)), []);
  const jumpToCar = (ci: number) => { const i = flat.findIndex((f) => f.carIdx === ci); if (i >= 0) setPos(i); };
  const jumpToSlide = (slideIdx: number) => { if (!cur) return; const i = flat.findIndex((f) => f.carIdx === cur.carIdx && f.slideIdx === slideIdx); if (i >= 0) setPos(i); };

  // Keyboard arrows (paused while the editor is open).
  useEffect(() => {
    if (!rows || rows.length === 0 || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, editing, next, prev]);

  // Trackpad horizontal swipe (one move per gesture).
  const wheelLock = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 24) return;
    const now = Date.now();
    if (now - wheelLock.current < 350) return;
    wheelLock.current = now;
    if (e.deltaX > 0) next(); else prev();
  };
  // Drag swipe — mouse (trackpad/click-drag) + touch (phone). Horizontal move past the threshold moves
  // one slide; small movements (taps on Edit/download) do nothing.
  const drag = useRef<number | null>(null);
  const startAt = (x: number) => { drag.current = x; };
  const endAt = (x: number) => { const s = drag.current; drag.current = null; if (s == null) return; const dx = x - s; if (dx < -45) next(); else if (dx > 45) prev(); };

  const generate = async () => {
    setGenerating(true);
    try { await fetch(`/api/content/carousels/generate?creator=${creator}&date=${date}`, { method: "POST" }); await load(date); }
    finally { setGenerating(false); }
  };

  const saveSlide = async (carIdx: number, slideIdx: number, blocks: SlideBlock[]) => {
    if (!rows) return;
    const row = rows[carIdx];
    const slides = row.slides.map((s, i) => (i === slideIdx ? { ...s, blocks } : s));
    const res = await fetch("/api/content/carousels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, slides }) });
    if (res.ok) setRows((rs) => (rs ? rs.map((r, i) => (i === carIdx ? { ...r, slides, edited: true } : r)) : rs));
    setEditing(null);
  };

  const dlSlide = (row: Row, slideIdx: number) => downloadSlide(blocksForSlide(row.slides[slideIdx]), creator, `${creator}-${date}-c${row.slot + 1}-s${slideIdx + 1}.png`);

  // One carousel = one post, so it downloads as one group: every slide rendered through the same
  // canvas renderer (edited blocks when present, defaults otherwise) and zipped in posting order.
  // The zip name carries the creator/date/carousel, so the slides inside are just s1..sN.
  const dlCarousel = async (row: Row) => {
    if (dling !== null) return;
    setDling(row.slot);
    try {
      await ensureFonts();
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const avatar = await loadAvatar(creator);
      for (let i = 0; i < row.slides.length; i++) {
        const canvas = document.createElement("canvas");
        renderSlide(canvas, blocksForSlide(row.slides[i]), creator, avatar);
        const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
        zip.file(`s${i + 1}.png`, blob);
      }
      const out = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(out); a.download = `${creator}-${date}-c${row.slot + 1}.zip`; a.click();
      URL.revokeObjectURL(a.href);
    } finally { setDling(null); }
  };

  const curRow = rows && cur ? rows[cur.carIdx] : null;
  const curSlide = curRow && cur ? curRow.slides[cur.slideIdx] : null;
  const editRow = editing && rows ? rows[editing.carIdx] : null;
  const editSlide = editRow && editing ? editRow.slides[editing.slideIdx] : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Top bar: date nav + download the carousel currently in view (never the whole day) */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setDate((d) => shiftDate(d, -1))} style={navBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", minWidth: 140, textAlign: "center" }}>{prettyDate(date)}{date === todayET() ? " · Today" : ""}</div>
        <button onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= todayET()} style={{ ...navBtn, opacity: date >= todayET() ? 0.4 : 1 }}><ChevronRight size={16} /></button>
        <span style={{ flex: 1 }} />
        {curRow && cur && (
          <button onClick={() => dlCarousel(curRow)} disabled={dling !== null} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 12.5, fontWeight: 700, cursor: dling !== null ? "default" : "pointer", opacity: dling !== null && dling !== curRow.slot ? 0.5 : 1 }}>
            {dling === curRow.slot ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
            {dling === curRow.slot ? "Zipping…" : `Download carousel ${cur.carIdx + 1} (${curRow.slides.length} slides)`}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 60, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>
      ) : !rows || rows.length === 0 ? (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 44, textAlign: "center" }}>
          <GalleryHorizontal size={26} style={{ color: "var(--text-muted)", marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>No carousels for {prettyDate(date)} yet</div>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 16px" }}>Five text carousels aimed at the buyer who pays — generated once, then read, edited, and downloaded here.</p>
          <button onClick={generate} disabled={generating} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#1a1a1a", fontSize: 13.5, fontWeight: 800, cursor: "pointer", opacity: generating ? 0.6 : 1 }}>
            {generating ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {generating ? "Generating…" : "Generate today's carousels"}
          </button>
        </div>
      ) : curRow && curSlide && cur ? (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Topic pills — jump to any carousel, or grab it whole without swiping to it first */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {rows.map((row, ci) => {
              const activeCar = ci === cur.carIdx;
              const tint = activeCar ? "var(--accent)" : "var(--text-muted)";
              return (
                <div key={row.id} style={{
                  flexShrink: 0, maxWidth: 240, display: "inline-flex", alignItems: "center", borderRadius: 999, overflow: "hidden",
                  border: `1px solid ${activeCar ? "var(--accent)" : "var(--border-primary)"}`, background: activeCar ? "var(--accent-soft)" : "var(--bg-glass)",
                }}>
                  <button onClick={() => jumpToCar(ci)} title={row.topic || `Carousel ${ci + 1}`} style={{
                    minWidth: 0, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 4px 6px 11px", cursor: "pointer",
                    background: "none", border: "none", color: tint, fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                  }}>
                    <span style={{ opacity: 0.8 }}>{ci + 1}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(row.topic || "Carousel").replace(/^[a-z ]+:\s*/i, "")}</span>
                    {row.edited && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", flexShrink: 0 }} />}
                  </button>
                  <button onClick={() => dlCarousel(row)} disabled={dling !== null} title={`Download carousel ${ci + 1} (${row.slides.length} slides)`} aria-label={`Download carousel ${ci + 1}`} style={{
                    flexShrink: 0, display: "grid", placeItems: "center", width: 24, height: 24, marginRight: 5, borderRadius: 999,
                    background: "none", border: "none", color: tint, cursor: dling !== null ? "default" : "pointer", padding: 0,
                    opacity: dling !== null && dling !== row.slot ? 0.4 : 0.75,
                  }}>
                    {dling === row.slot ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Position + topic line */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
            <span style={{ fontWeight: 800, color: "var(--text-secondary)" }}>{cur.carIdx + 1} / {rows.length}</span>
            <span>·</span>
            <span style={{ fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curRow.topic || "Carousel"}</span>
            {curRow.edited && <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", border: "1px solid var(--border-primary)", borderRadius: 999, padding: "1px 7px" }}>EDITED</span>}
          </div>

          {/* Slide + chevrons */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
            <button onClick={prev} disabled={safePos === 0} style={{ ...chevBtn, opacity: safePos === 0 ? 0.3 : 1 }} title="Previous"><ChevronLeft size={22} /></button>
            <div style={{ position: "relative", width: "100%", maxWidth: 520, touchAction: "pan-y", userSelect: "none" }} onWheel={onWheel}
              onMouseDown={(e) => startAt(e.clientX)} onMouseUp={(e) => endAt(e.clientX)}
              onTouchStart={(e) => startAt(e.touches[0].clientX)} onTouchEnd={(e) => endAt(e.changedTouches[0].clientX)}>
              <BigSlide blocks={blocksForSlide(curSlide)} creator={creator} />
              {/* Two actions, minimal chrome */}
              <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
                <button onClick={() => setEditing({ carIdx: cur.carIdx, slideIdx: cur.slideIdx })} style={overlayBtn} title="Edit slide"><Pencil size={15} /></button>
                <button onClick={() => dlSlide(curRow, cur.slideIdx)} style={overlayBtn} title="Download this slide"><Download size={15} /></button>
              </div>
            </div>
            <button onClick={next} disabled={safePos === last} style={{ ...chevBtn, opacity: safePos === last ? 0.3 : 1 }} title="Next"><ChevronRight size={22} /></button>
          </div>

          {/* Slide dots for the current carousel */}
          <div style={{ display: "flex", gap: 7, justifyContent: "center", alignItems: "center" }}>
            {curRow.slides.map((_, si) => (
              <button key={si} onClick={() => jumpToSlide(si)} title={`Slide ${si + 1}`} style={{ width: si === cur.slideIdx ? 22 : 8, height: 8, borderRadius: 999, border: "none", cursor: "pointer", padding: 0, background: si === cur.slideIdx ? "var(--accent)" : "var(--border-hover)", transition: "width .15s" }} />
            ))}
          </div>
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)" }}>Swipe, use ← →, or the arrows · slide {cur.slideIdx + 1} of {curRow.slides.length}</div>
        </div>
      ) : null}

      {editRow && editSlide && editing && (
        <SlideEditor
          creator={creator}
          filename={`${creator}-${date}-c${editRow.slot + 1}-s${editing.slideIdx + 1}`}
          initialBlocks={editSlide.blocks}
          initialText={editSlide.text || ""}
          onSave={(blocks) => saveSlide(editing.carIdx, editing.slideIdx, blocks)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" };
const chevBtn: React.CSSProperties = { flexShrink: 0, width: 40, height: 40, borderRadius: 999, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" };
const overlayBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.55)", color: "#fff", cursor: "pointer", backdropFilter: "blur(4px)" };
