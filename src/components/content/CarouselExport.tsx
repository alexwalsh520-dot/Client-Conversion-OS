"use client";

/* eslint-disable @next/next/no-img-element */

// Export a carousel's slides — the same pick-your-pages flow as Studio 2: choose "This slide", "All",
// or "Custom" (type a range and/or tap slide previews), name the file, and download. One slide comes
// down as a PNG; several come down as a zip in posting order. Rendering goes through the shared canvas
// renderer, so the thumbnails and the downloaded files are pixel-identical to the reader.

import { useEffect, useMemo, useState } from "react";
import { X, Download, Loader2 } from "lucide-react";
import { renderSlide, blocksForSlide, loadAvatar, ensureFonts, type SlideBlock } from "@/lib/content/carousel-render";

type Slide = { text?: string; blocks?: SlideBlock[] };
type Mode = "current" | "all" | "custom";

// "2, 4-6" -> [1,3,4,5] (0-based, clamped to the slide count, de-duped, ordered).
function parseRange(input: string, count: number): number[] {
  const out = new Set<number>();
  for (const part of input.split(",")) {
    const s = part.trim();
    if (!s) continue;
    const m = s.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (i >= 1 && i <= count) out.add(i - 1);
    } else {
      const n = Number(s);
      if (Number.isFinite(n) && n >= 1 && n <= count) out.add(n - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

export default function CarouselExport({
  creator,
  slot,
  slides,
  currentSlideIdx,
  defaultName,
  onClose,
}: {
  creator: string;
  slot: number;
  slides: Slide[];
  currentSlideIdx: number;
  defaultName: string;
  onClose: () => void;
}) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("current");
  const [name, setName] = useState(defaultName);
  const [rangeInput, setRangeInput] = useState(String(currentSlideIdx + 1));
  const [selection, setSelection] = useState<number[]>([currentSlideIdx]);
  const [busy, setBusy] = useState(false);

  // Render every slide once for the preview grid.
  useEffect(() => {
    let live = true;
    (async () => {
      await ensureFonts();
      const avatar = await loadAvatar(creator);
      const urls: string[] = [];
      for (const s of slides) {
        const c = document.createElement("canvas");
        renderSlide(c, blocksForSlide(s), creator, avatar);
        urls.push(c.toDataURL("image/png"));
      }
      if (live) setThumbs(urls);
    })();
    return () => { live = false; };
  }, [creator, slides]);

  const indices = useMemo(() => {
    if (mode === "current") return [currentSlideIdx];
    if (mode === "all") return slides.map((_, i) => i);
    const parsed = parseRange(rangeInput, slides.length);
    return parsed.length ? parsed : selection;
  }, [mode, currentSlideIdx, slides, rangeInput, selection]);

  const canExport = indices.length > 0;

  const doExport = async () => {
    if (!canExport || busy) return;
    setBusy(true);
    try {
      await ensureFonts();
      const avatar = await loadAvatar(creator);
      const toBlob = (i: number): Promise<Blob> => {
        const c = document.createElement("canvas");
        renderSlide(c, blocksForSlide(slides[i]), creator, avatar);
        return new Promise((r) => c.toBlob((b) => r(b!), "image/png"));
      };
      const base = name.trim() || `carousel-${slot + 1}`;
      const download = (href: string, filename: string) => {
        const a = document.createElement("a");
        a.href = href;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(href);
      };
      if (indices.length === 1) {
        const blob = await toBlob(indices[0]);
        download(URL.createObjectURL(blob), `${base}-s${indices[0] + 1}.png`);
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        for (const i of indices) zip.file(`s${i + 1}.png`, await toBlob(i));
        const out = await zip.generateAsync({ type: "blob" });
        download(URL.createObjectURL(out), `${base}.zip`);
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const seg = [
    { value: "current" as const, label: `This slide (${currentSlideIdx + 1})` },
    { value: "all" as const, label: `All (${slides.length})` },
    { value: "custom" as const, label: "Custom" },
  ];

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div style={{ flex: 1, fontSize: 16, fontWeight: 800, color: "var(--text-primary)" }}>Export</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={18} /></button>
        </div>

        {/* Mode toggle */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4, padding: 4, borderRadius: 10, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", marginBottom: 14 }}>
          {seg.map((o) => {
            const active = mode === o.value;
            return (
              <button
                key={o.value}
                onClick={() => {
                  setMode(o.value);
                  if (o.value === "custom" && !selection.length) {
                    setSelection([currentSlideIdx]);
                    setRangeInput(String(currentSlideIdx + 1));
                  }
                }}
                style={{ height: 40, border: "none", borderRadius: 7, background: active ? "var(--accent)" : "transparent", color: active ? "#1a1a1a" : "var(--text-secondary)", fontFamily: "inherit", fontSize: 13.5, fontWeight: 800, cursor: "pointer" }}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {/* File name */}
        <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>File name</div>
        <input value={name} onChange={(e) => setName(e.target.value)} style={input} />

        {/* Custom picker */}
        {mode === "custom" && (
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={rangeInput}
                onChange={(e) => {
                  const next = e.target.value;
                  setRangeInput(next);
                  const parsed = parseRange(next, slides.length);
                  if (parsed.length) setSelection(parsed);
                }}
                placeholder="e.g. 1, 3-5"
                style={{ ...input, flex: 1 }}
              />
              <button
                onClick={() => { const all = slides.map((_, i) => i); setSelection(all); setRangeInput(`1-${slides.length}`); }}
                style={ghost}
              >
                Select all
              </button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 10, maxHeight: 300, overflowY: "auto", paddingRight: 2 }}>
              {slides.map((_, i) => {
                const selected = indices.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setSelection((prev) => {
                        const next = prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i].sort((a, b) => a - b);
                        setRangeInput(next.map((x) => String(x + 1)).join(", "));
                        return next;
                      });
                    }}
                    style={{ position: "relative", aspectRatio: "4 / 5", borderRadius: 10, border: `2px solid ${selected ? "var(--accent)" : "var(--border-primary)"}`, background: selected ? "var(--accent-soft)" : "#000", padding: 0, overflow: "hidden", cursor: "pointer" }}
                  >
                    {thumbs[i]
                      ? <img src={thumbs[i]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: selected ? 1 : 0.85 }} />
                      : <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#666" }}><Loader2 size={14} className="spin" /></span>}
                    <span style={{ position: "absolute", left: 6, bottom: 6, minWidth: 22, height: 20, padding: "0 6px", borderRadius: 999, background: selected ? "var(--accent)" : "rgba(0,0,0,.62)", color: selected ? "#1a1a1a" : "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900 }}>{i + 1}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 16 }}>
          <span style={{ flex: 1, fontSize: 12.5, color: "var(--text-muted)" }}>{indices.length} slide{indices.length === 1 ? "" : "s"} selected</span>
          <button onClick={onClose} style={ghost}>Cancel</button>
          <button onClick={doExport} disabled={!canExport || busy} style={{ ...primary, opacity: canExport && !busy ? 1 : 0.5, cursor: canExport && !busy ? "pointer" : "default" }}>
            {busy ? <Loader2 size={14} className="spin" /> : <Download size={14} />} {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 };
const panel: React.CSSProperties = { width: "min(680px, 94vw)", maxHeight: "88vh", overflowY: "auto", borderRadius: 14, border: "1px solid var(--border-primary)", background: "var(--bg-card)", boxShadow: "0 28px 80px rgba(0,0,0,.35)", padding: 18 };
const input: React.CSSProperties = { width: "100%", height: 40, padding: "0 12px", borderRadius: 9, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 13.5, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const ghost: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 14px", borderRadius: 9, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, cursor: "pointer" };
const primary: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, height: 40, padding: "0 18px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#1a1a1a", fontSize: 13.5, fontWeight: 800 };
