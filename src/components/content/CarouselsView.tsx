"use client";

// Operator-only Carousels tab. Reader-first: one slide fills the view, copy readable without zooming.
// A calm vertical list on the side picks the carousel (replacing the old horizontal pill strip);
// swipe / arrows / chevrons move through slides and flow across the day's carousels. Editing is
// save-free — changes persist as you make them. Downloading goes through the Studio-2-style Export
// picker (this slide / all / custom), so the studio editor + PNG rendering stay identical everywhere.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, Pencil, Download, GalleryHorizontal, Sparkles } from "lucide-react";
import SlideEditor from "./SlideEditor";
import CarouselExport from "./CarouselExport";
import { renderSlide, blocksForSlide, loadAvatar, ensureFonts, CANVAS_W, CANVAS_H, type SlideBlock } from "@/lib/content/carousel-render";

type Slide = { text?: string; blocks?: SlideBlock[] };
type Row = { id: number; client_key: string; for_date: string; slot: number; topic: string | null; slides: Slide[]; edited: boolean; origin?: string | null };

// Small, unobtrusive marker for a set the external worker wrote (operator-only — this view isn't on
// the creator's token page). Provenance is stamped on the row's origin column.
function ExternalTag() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--text-muted)", background: "var(--bg-glass)", border: "1px solid var(--border-primary)", borderRadius: 5, padding: "1px 5px" }}>
      external
    </span>
  );
}

const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const shiftDate = (d: string, delta: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); };
const prettyDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const cleanTopic = (t: string | null) => (t || "Carousel").replace(/^[a-z ]+:\s*/i, "");

// One slide rendered large + responsive (the same canvas renderer used everywhere).
function BigSlide({ blocks, creator }: { blocks: SlideBlock[]; creator: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);
  useEffect(() => { let live = true; ensureFonts().then(() => loadAvatar(creator)).then((a) => { if (live) setAvatar(a); }); return () => { live = false; }; }, [creator]);
  useEffect(() => { if (ref.current) renderSlide(ref.current, blocks, creator, avatar); }, [blocks, creator, avatar]);
  return <canvas ref={ref} style={{ width: "100%", aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, display: "block", background: "#000", borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,.45)" }} />;
}

const LAYOUT_CSS = `
.car-shell{display:grid;grid-template-columns:1fr;gap:18px;align-items:start}
@media (min-width:860px){.car-shell{grid-template-columns:236px 1fr;gap:28px}}
.car-list{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}
@media (min-width:860px){.car-list{flex-direction:column;overflow:visible;padding-bottom:0;position:sticky;top:12px}}
`;

// mode="creator" is the token page: the same swipe-through viewer and the same downloads, but no
// editor, no generate, no provenance tags — the creator reads and uses their carousels, they don't
// manage them. Reads go through the token (server derives the creator from it), so the component
// never needs to be trusted with scoping.
export default function CarouselsView({ creator, mode = "operator", token }: { creator: string; mode?: "operator" | "creator"; token?: string }) {
  const isCreator = mode === "creator";
  const [date, setDate] = useState<string>(todayET);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<{ carIdx: number; slideIdx: number } | null>(null);
  const [exportCar, setExportCar] = useState<number | null>(null); // carousel index whose Export picker is open
  const [pos, setPos] = useState(0); // flat index across the day's slides

  useEffect(() => { ensureFonts(); }, []);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const qs = token ? `token=${encodeURIComponent(token)}&date=${d}` : `creator=${creator}&date=${d}`;
      const res = await fetch(`/api/content/carousels?${qs}`, { cache: "no-store" });
      const j = await res.json();
      setRows((j.carousels || []).sort((a: Row, b: Row) => a.slot - b.slot));
      setPos(0);
    } finally { setLoading(false); }
  }, [creator, token]);
  useEffect(() => { load(date); }, [date, load]);

  // Flat list of every slide across the carousels → one continuous swipe through the whole day.
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

  // Keyboard arrows (paused while a modal is open).
  useEffect(() => {
    if (!rows || rows.length === 0 || editing || exportCar !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, editing, exportCar, next, prev]);

  // Trackpad horizontal swipe (one move per gesture).
  const wheelLock = useRef(0);
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 24) return;
    const now = Date.now();
    if (now - wheelLock.current < 350) return;
    wheelLock.current = now;
    if (e.deltaX > 0) next(); else prev();
  };
  // Drag swipe — mouse + touch. Horizontal move past the threshold moves one slide; taps do nothing.
  const drag = useRef<number | null>(null);
  const startAt = (x: number) => { drag.current = x; };
  const endAt = (x: number) => { const s = drag.current; drag.current = null; if (s == null) return; const dx = x - s; if (dx < -45) next(); else if (dx > 45) prev(); };

  const generate = async () => {
    setGenerating(true);
    try { await fetch(`/api/content/carousels/generate?creator=${creator}&date=${date}`, { method: "POST" }); await load(date); }
    finally { setGenerating(false); }
  };

  // Save-free editing: persist each change as it happens, without closing the editor. A ref keeps the
  // latest rows so this callback stays stable (the editor's auto-save effect depends on its identity).
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const persist = useCallback(async (carIdx: number, slideIdx: number, blocks: SlideBlock[]) => {
    const rs = rowsRef.current;
    if (!rs || !rs[carIdx]) return;
    const row = rs[carIdx];
    const slides = row.slides.map((s, i) => (i === slideIdx ? { ...s, blocks } : s));
    setRows((prev) => (prev ? prev.map((r, i) => (i === carIdx ? { ...r, slides, edited: true } : r)) : prev));
    await fetch("/api/content/carousels", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: row.id, slides }) });
  }, []);

  const editRef = useRef(editing);
  useEffect(() => { editRef.current = editing; }, [editing]);
  const onEditorSave = useCallback(async (blocks: SlideBlock[]) => {
    const e = editRef.current;
    if (e) await persist(e.carIdx, e.slideIdx, blocks);
  }, [persist]);

  const curRow = rows && cur ? rows[cur.carIdx] : null;
  const curSlide = curRow && cur ? curRow.slides[cur.slideIdx] : null;
  const editRow = editing && rows ? rows[editing.carIdx] : null;
  const editSlide = editRow && editing ? editRow.slides[editing.slideIdx] : null;
  const exportRow = exportCar !== null && rows ? rows[exportCar] : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <style>{LAYOUT_CSS}</style>

      {/* Top bar: date nav + export the carousel in view */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setDate((d) => shiftDate(d, -1))} style={navBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", minWidth: 140, textAlign: "center" }}>{prettyDate(date)}{date === todayET() ? " · Today" : ""}</div>
        <button onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= todayET()} style={{ ...navBtn, opacity: date >= todayET() ? 0.4 : 1 }}><ChevronRight size={16} /></button>
        <span style={{ flex: 1 }} />
        {curRow && cur && (
          <button onClick={() => setExportCar(cur.carIdx)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#1a1a1a", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
            <Download size={14} /> Export
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 60, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>
      ) : !rows || rows.length === 0 ? (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 44, textAlign: "center" }}>
          <GalleryHorizontal size={26} style={{ color: "var(--text-muted)", marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{isCreator ? "Today\u2019s carousels are on the way." : `No carousels for ${prettyDate(date)} yet`}</div>
          {!isCreator && (
            <>
              <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 16px" }}>Text carousels aimed at the buyer who pays — generated once, then read, edited, and exported here.</p>
              <button onClick={generate} disabled={generating} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#1a1a1a", fontSize: 13.5, fontWeight: 800, cursor: "pointer", opacity: generating ? 0.6 : 1 }}>
                {generating ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {generating ? "Generating…" : "Generate today's carousels"}
              </button>
            </>
          )}
        </div>
      ) : curRow && curSlide && cur ? (
        <div className="car-shell">
          {/* Vertical carousel picker (was a clunky horizontal strip) */}
          <nav className="car-list" aria-label="Carousels">
            {rows.map((row, ci) => {
              const active = ci === cur.carIdx;
              return (
                <button
                  key={row.id}
                  onClick={() => jumpToCar(ci)}
                  title={row.topic || `Carousel ${ci + 1}`}
                  style={{
                    flexShrink: 0, textAlign: "left", display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 13px", borderRadius: 11, cursor: "pointer", fontFamily: "inherit",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border-primary)"}`,
                    background: active ? "var(--accent-soft)" : "var(--bg-card)",
                    minWidth: 190, maxWidth: 260,
                  }}
                >
                  <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 800, color: active ? "var(--accent)" : "var(--text-muted)", lineHeight: 1.5 }}>{ci + 1}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cleanTopic(row.topic)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, marginTop: 3, fontSize: 11.5, color: "var(--text-muted)" }}>
                      {row.slides.length} slides
                      {row.edited && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--accent)" }} /> edited</span>}
                      {!isCreator && row.origin === "external" && <ExternalTag />}
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Reader */}
          <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
              <span style={{ flexShrink: 0, whiteSpace: "nowrap", fontWeight: 800, color: "var(--text-secondary)" }}>{cur.carIdx + 1} / {rows.length}</span>
              <span style={{ flexShrink: 0 }}>·</span>
              <span style={{ minWidth: 0, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{curRow.topic || "Carousel"}</span>
              {!isCreator && curRow.origin === "external" && <ExternalTag />}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center" }}>
              <button onClick={prev} disabled={safePos === 0} style={{ ...chevBtn, flexShrink: 0, opacity: safePos === 0 ? 0.3 : 1 }} title="Previous"><ChevronLeft size={22} /></button>
              {/* minWidth:0 is load-bearing: without it the canvas's intrinsic width becomes the flex
                  item's minimum and the slide overflows the phone viewport instead of scaling down. */}
              <div style={{ position: "relative", width: "100%", minWidth: 0, maxWidth: 520, touchAction: "pan-y", userSelect: "none" }} onWheel={onWheel}
                onMouseDown={(e) => startAt(e.clientX)} onMouseUp={(e) => endAt(e.clientX)}
                onTouchStart={(e) => startAt(e.touches[0].clientX)} onTouchEnd={(e) => endAt(e.changedTouches[0].clientX)}>
                <BigSlide blocks={blocksForSlide(curSlide)} creator={creator} />
                <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
                  {!isCreator && (
                    <button onClick={() => setEditing({ carIdx: cur.carIdx, slideIdx: cur.slideIdx })} style={overlayBtn} title="Edit slide"><Pencil size={15} /></button>
                  )}
                  <button onClick={() => setExportCar(cur.carIdx)} style={overlayBtn} title="Export"><Download size={15} /></button>
                </div>
              </div>
              <button onClick={next} disabled={safePos === last} style={{ ...chevBtn, flexShrink: 0, opacity: safePos === last ? 0.3 : 1 }} title="Next"><ChevronRight size={22} /></button>
            </div>

            {/* Slide dots for the current carousel */}
            <div style={{ display: "flex", gap: 7, justifyContent: "center", alignItems: "center" }}>
              {curRow.slides.map((_, si) => (
                <button key={si} onClick={() => jumpToSlide(si)} title={`Slide ${si + 1}`} style={{ width: si === cur.slideIdx ? 22 : 8, height: 8, borderRadius: 999, border: "none", cursor: "pointer", padding: 0, background: si === cur.slideIdx ? "var(--accent)" : "var(--border-hover)", transition: "width .15s" }} />
              ))}
            </div>
            <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--text-muted)" }}>Swipe, use ← →, or the arrows · slide {cur.slideIdx + 1} of {curRow.slides.length}</div>
          </div>
        </div>
      ) : null}

      {editRow && editSlide && editing && (
        <SlideEditor
          creator={creator}
          filename={`${creator}-${date}-c${editRow.slot + 1}-s${editing.slideIdx + 1}`}
          initialBlocks={editSlide.blocks}
          initialText={editSlide.text || ""}
          onSave={onEditorSave}
          onClose={() => setEditing(null)}
        />
      )}

      {exportRow && exportCar !== null && (
        <CarouselExport
          creator={creator}
          slot={exportRow.slot}
          slides={exportRow.slides}
          currentSlideIdx={cur && cur.carIdx === exportCar ? cur.slideIdx : 0}
          defaultName={`${creator}-${date}-c${exportRow.slot + 1}`}
          onClose={() => setExportCar(null)}
        />
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" };
const chevBtn: React.CSSProperties = { flexShrink: 0, width: 40, height: 40, borderRadius: 999, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" };
const overlayBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,.18)", background: "rgba(0,0,0,.55)", color: "#fff", cursor: "pointer", backdropFilter: "blur(4px)" };
