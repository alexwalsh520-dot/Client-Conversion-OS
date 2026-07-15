"use client";

// Operator-only Carousels tab: the day's 5 generated carousels for one creator, each editable in the
// /studio-style slide editor and downloadable as 1080×1350 PNGs. Everything renders client-side.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ChevronLeft, ChevronRight, Pencil, Download, GalleryHorizontal, Sparkles } from "lucide-react";
import SlideEditor from "./SlideEditor";
import { renderSlide, blocksForSlide, loadAvatar, ensureFonts, downloadSlide, CANVAS_W, CANVAS_H, type SlideBlock } from "@/lib/content/carousel-render";

type Slide = { text?: string; blocks?: SlideBlock[] };
type Row = { id: number; client_key: string; for_date: string; slot: number; topic: string | null; slides: Slide[]; edited: boolean };

const todayET = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const shiftDate = (d: string, delta: number) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + delta); return t.toISOString().slice(0, 10); };
const prettyDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

function SlideThumb({ blocks, creator, onClick, w = 116 }: { blocks: SlideBlock[]; creator: string; onClick?: () => void; w?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);
  useEffect(() => { let live = true; loadAvatar(creator).then((a) => { if (live) setAvatar(a); }); return () => { live = false; }; }, [creator]);
  useEffect(() => { if (ref.current) renderSlide(ref.current, blocks, creator, avatar); }, [blocks, creator, avatar]);
  return <canvas ref={ref} onClick={onClick} style={{ width: w, height: (w * CANVAS_H) / CANVAS_W, borderRadius: 6, display: "block", background: "#000", cursor: onClick ? "pointer" : "default", border: "1px solid var(--border-primary)" }} />;
}

export default function CarouselsView({ creator }: { creator: string }) {
  const [date, setDate] = useState<string>(todayET);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<{ carIdx: number; slideIdx: number } | null>(null);

  useEffect(() => { ensureFonts(); }, []);

  const load = useCallback(async (d: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/carousels?creator=${creator}&date=${d}`, { cache: "no-store" });
      const j = await res.json();
      setRows((j.carousels || []).sort((a: Row, b: Row) => a.slot - b.slot));
    } finally { setLoading(false); }
  }, [creator]);
  useEffect(() => { load(date); }, [date, load]);

  const generate = async () => {
    setGenerating(true);
    try {
      await fetch(`/api/content/carousels/generate?creator=${creator}&date=${date}`, { method: "POST" });
      await load(date);
    } finally { setGenerating(false); }
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
  const dlCarousel = async (row: Row) => {
    await ensureFonts();
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const avatar = await loadAvatar(creator);
    for (let i = 0; i < row.slides.length; i++) {
      const canvas = document.createElement("canvas");
      renderSlide(canvas, blocksForSlide(row.slides[i]), creator, avatar);
      const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), "image/png"));
      zip.file(`${creator}-${date}-c${row.slot + 1}-s${i + 1}.png`, blob);
    }
    const out = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out); a.download = `${creator}-${date}-carousel-${row.slot + 1}.zip`; a.click();
    URL.revokeObjectURL(a.href);
  };

  const editRow = editing && rows ? rows[editing.carIdx] : null;
  const editSlide = editRow ? editRow.slides[editing!.slideIdx] : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Date nav */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => setDate((d) => shiftDate(d, -1))} style={navBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", minWidth: 140, textAlign: "center" }}>{prettyDate(date)}{date === todayET() ? " · Today" : ""}</div>
        <button onClick={() => setDate((d) => shiftDate(d, 1))} disabled={date >= todayET()} style={{ ...navBtn, opacity: date >= todayET() ? 0.4 : 1 }}><ChevronRight size={16} /></button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>5 carousels · a day · edited in the studio</span>
      </div>

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 50, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>
      ) : !rows || rows.length === 0 ? (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 44, textAlign: "center" }}>
          <GalleryHorizontal size={26} style={{ color: "var(--text-muted)", marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>No carousels for {prettyDate(date)} yet</div>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 16px" }}>Five text carousels aimed at the buyer who pays — generated once, then edited and downloaded here.</p>
          <button onClick={generate} disabled={generating} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 18px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#1a1a1a", fontSize: 13.5, fontWeight: 800, cursor: "pointer", opacity: generating ? 0.6 : 1 }}>
            {generating ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} {generating ? "Generating…" : "Generate today's carousels"}
          </button>
        </div>
      ) : (
        rows.map((row, carIdx) => (
          <div key={row.id} style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent)", background: "var(--accent-soft)", borderRadius: 6, padding: "3px 8px" }}>#{row.slot + 1}</span>
              <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)" }}>{row.topic || "Carousel"}</span>
              {row.edited && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-muted)", border: "1px solid var(--border-primary)", borderRadius: 999, padding: "2px 8px" }}>EDITED</span>}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{row.slides.length} slides</span>
              <button onClick={() => dlCarousel(row)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}><Download size={13} /> All slides</button>
            </div>
            <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
              {row.slides.map((slide, slideIdx) => (
                <div key={slideIdx} style={{ flexShrink: 0 }}>
                  <SlideThumb blocks={blocksForSlide(slide)} creator={creator} onClick={() => setEditing({ carIdx, slideIdx })} />
                  <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
                    <button onClick={() => setEditing({ carIdx, slideIdx })} style={miniBtn} title="Edit"><Pencil size={12} /></button>
                    <button onClick={() => dlSlide(row, slideIdx)} style={miniBtn} title="Download"><Download size={12} /></button>
                    <span style={{ flex: 1, textAlign: "right", fontSize: 10.5, color: "var(--text-muted)", alignSelf: "center" }}>{slideIdx + 1}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editRow && editSlide && (
        <SlideEditor
          creator={creator}
          filename={`${creator}-${date}-c${editRow.slot + 1}-s${editing!.slideIdx + 1}`}
          initialBlocks={editSlide.blocks}
          initialText={editSlide.text || ""}
          onSave={(blocks) => saveSlide(editing!.carIdx, editing!.slideIdx, blocks)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = { width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" };
const miniBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 24, borderRadius: 6, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer" };
