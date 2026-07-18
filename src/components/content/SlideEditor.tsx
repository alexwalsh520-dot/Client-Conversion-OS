"use client";

// Canva-style slide editor for one carousel slide, in the same spirit as /studio: a 1080×1350 stage,
// draggable blocks (a locked-by-default header + text blocks), inline text editing, and font controls,
// exporting a pixel-matching PNG. Rendering runs through the shared canvas renderer so the editor
// preview, thumbnails, and downloads are identical.

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Type, Plus, Trash2, Lock, Unlock, Download, Check, Loader2, AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import {
  renderSlide, defaultBlocks, newTextBlock, loadAvatar, ensureFonts, downloadSlide,
  CAROUSEL_FONTS, CANVAS_W, CANVAS_H, type SlideBlock, type Box,
} from "@/lib/content/carousel-render";

const STAGE_W = 452; // displayed width; canvas is 1080 → scale below
const SCALE = STAGE_W / CANVAS_W;

export default function SlideEditor({ creator, filename, initialBlocks, initialText, onSave, onClose }: {
  creator: string;
  filename: string;
  initialBlocks?: SlideBlock[];
  initialText: string;
  onSave: (blocks: SlideBlock[]) => Promise<void>;
  onClose: () => void;
}) {
  const [blocks, setBlocks] = useState<SlideBlock[]>(() => (initialBlocks && initialBlocks.length ? initialBlocks : defaultBlocks(initialText)));
  const [selId, setSelId] = useState<string | null>(null);
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; bx: number; by: number } | null>(null);

  useEffect(() => { (async () => { await ensureFonts(); setAvatar(await loadAvatar(creator)); })(); }, [creator]);

  // Re-render the canvas (source of truth) whenever blocks or the avatar change.
  useEffect(() => {
    if (!canvasRef.current) return;
    setBoxes(renderSlide(canvasRef.current, blocks, creator, avatar));
  }, [blocks, avatar, creator]);

  // Save-free editing: every change persists on its own after a short pause. There is no Save button.
  // savedSig tracks what's on the server so we skip the initial mount and redundant writes; latest lets
  // us flush a still-pending change when the editor closes.
  const latest = useRef(blocks);
  useEffect(() => { latest.current = blocks; }, [blocks]);
  const savedSig = useRef<string | null>(null);
  useEffect(() => {
    const sig = JSON.stringify(blocks);
    if (savedSig.current === null) { savedSig.current = sig; return; } // baseline — don't save on open
    if (sig === savedSig.current) return;
    const t = window.setTimeout(async () => {
      setSaveState("saving");
      try { await onSave(blocks); savedSig.current = sig; setSaveState("saved"); }
      catch { setSaveState("idle"); }
    }, 700);
    return () => window.clearTimeout(t);
  }, [blocks, onSave]);
  useEffect(() => () => {
    const sig = JSON.stringify(latest.current);
    if (savedSig.current !== null && sig !== savedSig.current) onSave(latest.current).catch(() => {});
  }, [onSave]);

  const sel = blocks.find((b) => b.id === selId) || null;
  const update = useCallback((id: string, patch: Partial<SlideBlock>) => setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b))), []);

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    const b = blocks.find((x) => x.id === id);
    if (!b || b.locked) { setSelId(id); return; }
    setSelId(id);
    const box = boxes[id];
    drag.current = { id, startX: e.clientX, startY: e.clientY, bx: b.x, by: box ? box.y : b.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.startX) / SCALE;
    const dy = (e.clientY - d.startY) / SCALE;
    const nx = Math.round(Math.max(0, Math.min(CANVAS_W - 40, d.bx + dx)));
    const ny = Math.round(Math.max(0, Math.min(CANVAS_H - 40, d.by + dy)));
    update(d.id, { x: nx, y: ny, autoY: false });
  };
  const onPointerUp = () => { drag.current = null; };

  const addBlock = () => { const nb = newTextBlock(); setBlocks((bs) => [...bs, nb]); setSelId(nb.id); };
  const delBlock = (id: string) => { setBlocks((bs) => bs.filter((b) => b.id !== id)); setSelId(null); };

  const exportPng = async () => { await downloadSlide(blocks, creator, filename.endsWith(".png") ? filename : `${filename}.png`); };

  const panel: React.CSSProperties = { background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 10, padding: 12 };
  const lbl: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,.72)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "4vh 16px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 18, alignItems: "flex-start", background: "var(--bg-secondary)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 18, maxWidth: 900 }}>
        {/* Stage */}
        <div>
          <div style={{ position: "relative", width: STAGE_W, height: CANVAS_H * SCALE, borderRadius: 6, overflow: "hidden", boxShadow: "0 8px 30px rgba(0,0,0,.5)" }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            <canvas ref={canvasRef} style={{ width: STAGE_W, height: CANVAS_H * SCALE, display: "block" }} />
            {/* Block hit/drag layers */}
            {blocks.map((b) => {
              const box = boxes[b.id];
              if (!box) return null;
              const isSel = b.id === selId;
              return (
                <div
                  key={b.id}
                  onPointerDown={(e) => onPointerDown(e, b.id)}
                  onDoubleClick={() => b.kind === "text" && setEditingId(b.id)}
                  style={{
                    position: "absolute", left: box.x * SCALE, top: box.y * SCALE, width: box.w * SCALE, height: box.h * SCALE,
                    border: isSel ? "1.5px solid var(--accent)" : "1px dashed rgba(255,255,255,.25)",
                    cursor: b.locked ? "pointer" : "move", boxSizing: "border-box",
                  }}
                  title={b.kind === "text" ? "Drag to move · double-click to edit" : "Header"}
                />
              );
            })}
            {/* Inline text edit overlay */}
            {editingId && (() => {
              const b = blocks.find((x) => x.id === editingId); const box = boxes[editingId];
              if (!b || !box) return null;
              return (
                <textarea
                  autoFocus
                  value={b.text || ""}
                  onChange={(e) => update(editingId, { text: e.target.value })}
                  onBlur={() => setEditingId(null)}
                  style={{ position: "absolute", left: box.x * SCALE, top: box.y * SCALE, width: Math.max(120, box.w * SCALE), minHeight: Math.max(40, box.h * SCALE), background: "rgba(0,0,0,.85)", color: "#fff", border: "1.5px solid var(--accent)", borderRadius: 4, padding: 6, fontSize: 12, lineHeight: 1.4, resize: "both", zIndex: 2 }}
                />
              );
            })()}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>Drag a block to move it. Double-click a text block to edit (use **bold** for emphasis).</div>
        </div>

        {/* Controls */}
        <div style={{ width: 300, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>Edit slide</div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={18} /></button>
          </div>

          <button onClick={addBlock} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent-soft)", color: "var(--accent)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}><Plus size={14} /> Add text block</button>

          {sel && sel.kind === "header" && (
            <div style={panel}>
              <div style={lbl}>Header</div>
              <button onClick={() => update(sel.id, { locked: !sel.locked })} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {sel.locked ? <Lock size={13} /> : <Unlock size={13} />} {sel.locked ? "Locked — click to unlock" : "Unlocked (drag to move)"}
              </button>
              {!sel.locked && (
                <button onClick={() => delBlock(sel.id)} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--danger)", background: "none", color: "var(--danger)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Trash2 size={13} /> Remove header</button>
              )}
            </div>
          )}

          {sel && sel.kind === "text" && (
            <div style={{ ...panel, display: "grid", gap: 10 }}>
              <div style={lbl}>Text block</div>
              <button onClick={() => setEditingId(sel.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Type size={13} /> Edit text</button>
              <div>
                <div style={lbl}>Font</div>
                <select value={sel.fontFamily} onChange={(e) => update(sel.id, { fontFamily: e.target.value })} style={{ width: "100%", padding: "6px 8px", borderRadius: 7, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 12 }}>
                  {CAROUSEL_FONTS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={lbl}>Size {sel.fontSize}</div>
                  <input type="range" min={24} max={110} value={sel.fontSize} onChange={(e) => update(sel.id, { fontSize: Number(e.target.value) })} style={{ width: "100%" }} />
                </div>
                <div>
                  <div style={lbl}>Weight</div>
                  <select value={sel.fontWeight} onChange={(e) => update(sel.id, { fontWeight: Number(e.target.value) })} style={{ padding: "6px 8px", borderRadius: 7, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 12 }}>
                    {[300, 400, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <div>
                  <div style={lbl}>Color</div>
                  <input type="color" value={sel.color} onChange={(e) => update(sel.id, { color: e.target.value })} style={{ width: 44, height: 30, border: "none", background: "none", cursor: "pointer" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={lbl}>Align</div>
                  <div style={{ display: "inline-flex", gap: 3, background: "var(--bg-glass)", borderRadius: 8, padding: 3 }}>
                    {([["left", AlignLeft], ["center", AlignCenter], ["right", AlignRight]] as const).map(([a, Ico]) => (
                      <button key={a} onClick={() => update(sel.id, { align: a })} style={{ padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer", background: sel.align === a ? "var(--accent)" : "transparent", color: sel.align === a ? "#1a1a1a" : "var(--text-muted)" }}><Ico size={14} /></button>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <div style={lbl}>Width {sel.maxWidth}</div>
                <input type="range" min={300} max={CANVAS_W - 80} value={sel.maxWidth} onChange={(e) => update(sel.id, { maxWidth: Number(e.target.value) })} style={{ width: "100%" }} />
              </div>
              <button onClick={() => delBlock(sel.id)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--danger)", background: "none", color: "var(--danger)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><Trash2 size={13} /> Delete block</button>
            </div>
          )}

          {!sel && <div style={{ ...panel, color: "var(--text-muted)", fontSize: 12.5, lineHeight: 1.5 }}>Click a block on the slide to style it, or add a new text block.</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 4, alignItems: "center" }}>
            <span style={{ flex: 1, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: saveState === "saved" ? "var(--success)" : "var(--text-muted)" }}>
              {saveState === "saving" ? <><Loader2 size={13} className="spin" /> Saving…</> : saveState === "saved" ? <><Check size={13} /> All changes saved</> : "Changes save automatically"}
            </span>
            <button onClick={exportPng} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 14px", borderRadius: 9, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}><Download size={14} /> PNG</button>
          </div>
        </div>
      </div>
    </div>
  );
}
