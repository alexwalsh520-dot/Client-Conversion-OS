"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  ImagePlus,
  Layers,
  MousePointer2,
  RotateCcw,
  Sparkles,
  Trash2,
  Type,
  Upload,
} from "lucide-react";

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const AUTOSAVE_KEY = "active-draft";
const DB_NAME = "ccos-studio-2";
const DB_STORE = "drafts";

const FONT_OPTIONS = [
  { label: "SF Pro Display", value: "Inter, SF Pro Display, system-ui" },
  { label: "Source Serif Pro", value: "'Source Serif Pro', Georgia, serif" },
  { label: "Montserrat", value: "'Montserrat', Arial, sans-serif" },
  { label: "Playfair Display", value: "'Playfair Display', Georgia, serif" },
  { label: "Oswald", value: "'Oswald', Arial Narrow, sans-serif" },
  { label: "Bebas Neue", value: "'Bebas Neue', Impact, sans-serif" },
];

const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@400;600;700;900&family=Montserrat:wght@400;600;700;800;900&family=Playfair+Display:wght@400;600;700;800;900&family=Oswald:wght@400;500;600;700&family=Bebas+Neue&display=swap";

const DEFAULT_COPY = `*NEW* Free Winter
Weight Loss Challenge

- 6 weeks
- my workout plan to get absolutely diced
- dead simple diet plan (no counting macros)
- accountability group so you actually stick w/ it

Free. Not eventually free.
Not "free trial." Free free.

DM to join before I start
charging for this.`;

type TextAlign = "left" | "center" | "right";
type SelectedLayer = { type: "text"; id: string } | { type: "image" } | null;

interface TextBlock {
  id: string;
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  textColor: string;
  bgColor: string;
  bgOpacity: number;
  borderRadius: number;
  paddingH: number;
  paddingV: number;
  align: TextAlign;
  lineGap: number;
  lineHeight: number;
  maxWidth: number;
  locked?: boolean;
}

interface ImageTransform {
  scale: number;
  rotate: number;
  offsetX: number;
  offsetY: number;
}

interface Creative {
  id: string;
  photoUrl: string;
  textBlocks: TextBlock[];
  imageTransform: ImageTransform;
  status: "draft" | "exported";
}

interface DraftState {
  version: 1;
  savedAt: number;
  photos: string[];
  creatives: Creative[];
  currentIndex: number;
  copyText: string;
  projectName: string;
  colorPreset: "dark" | "light";
  fontPreset: string;
  view: "setup" | "editor";
}

interface RenderedLine {
  text: string;
  x: number;
  bgY: number;
  textY: number;
  bgW: number;
  bgH: number;
  block: TextBlock;
}

interface BlockMetrics {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: RenderedLine[];
}

type DragState =
  | {
      kind: "move-text";
      blockId: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
    }
  | {
      kind: "resize-text";
      blockId: string;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      orig: TextBlock;
    }
  | {
      kind: "move-image";
      startX: number;
      startY: number;
      orig: ImageTransform;
    }
  | {
      kind: "resize-image";
      startX: number;
      startY: number;
      orig: ImageTransform;
    };

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "e" | "w";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const cloneCreatives = (creatives: Creative[]) =>
  JSON.parse(JSON.stringify(creatives)) as Creative[];

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDraft(state: DraftState) {
  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).put(state, AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadDraft(): Promise<DraftState | null> {
  const db = await openDraftDb();
  const result = await new Promise<DraftState | null>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readonly");
    const req = tx.objectStore(DB_STORE).get(AUTOSAVE_KEY);
    req.onsuccess = () => resolve((req.result as DraftState | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function clearDraft() {
  const db = await openDraftDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DB_STORE, "readwrite");
    tx.objectStore(DB_STORE).delete(AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  const value = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function setBlockFont(ctx: CanvasRenderingContext2D, block: TextBlock) {
  ctx.font = `${block.fontWeight} ${block.fontSize}px ${block.fontFamily}`;
  ctx.textBaseline = "middle";
}

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  if (!text.trim()) return [""];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = words[0] ?? "";

  for (let i = 1; i < words.length; i++) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width > maxW && current) {
      lines.push(current);
      current = words[i] ?? "";
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function measureTextBlock(ctx: CanvasRenderingContext2D, block: TextBlock): BlockMetrics {
  setBlockFont(ctx, block);
  const lineH = block.fontSize * block.lineHeight;
  const availableW = Math.max(40, block.maxWidth - block.paddingH * 2);
  let y = block.y;
  const rendered: RenderedLine[] = [];

  for (const logicalLine of block.lines) {
    if (!logicalLine.trim()) {
      y += Math.round(block.fontSize * 0.55 + block.lineGap);
      continue;
    }

    for (const visualLine of wrapLine(ctx, logicalLine, availableW)) {
      const textW = ctx.measureText(visualLine).width;
      const bgW = textW + block.paddingH * 2;
      const bgH = lineH + block.paddingV * 2;
      let x = block.x;
      if (block.align === "center") x = block.x + (block.maxWidth - bgW) / 2;
      if (block.align === "right") x = block.x + block.maxWidth - bgW;
      rendered.push({
        text: visualLine,
        x,
        bgY: y,
        textY: y + bgH / 2,
        bgW,
        bgH,
        block,
      });
      y += bgH + block.lineGap;
    }
  }

  const h = Math.max(24, y - block.y - block.lineGap);
  return { x: block.x, y: block.y, w: block.maxWidth, h, lines: rendered };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  transform: ImageTransform
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const canvasRatio = CANVAS_W / CANVAS_H;
  let drawW = CANVAS_W;
  let drawH = CANVAS_H;

  if (imageRatio > canvasRatio) {
    drawH = CANVAS_H;
    drawW = drawH * imageRatio;
  } else {
    drawW = CANVAS_W;
    drawH = drawW / imageRatio;
  }

  ctx.save();
  ctx.translate(CANVAS_W / 2 + transform.offsetX, CANVAS_H / 2 + transform.offsetY);
  ctx.rotate((transform.rotate * Math.PI) / 180);
  ctx.scale(transform.scale, transform.scale);
  ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function drawArtwork(
  ctx: CanvasRenderingContext2D,
  creative: Creative,
  image: HTMLImageElement | null,
  pixelRatio: number
) {
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = "#05040a";
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (image) {
    drawCoverImage(ctx, image, creative.imageTransform);
  }

  for (const block of creative.textBlocks) {
    const metrics = measureTextBlock(ctx, block);
    setBlockFont(ctx, block);

    for (const line of metrics.lines) {
      if (block.bgOpacity > 0) {
        ctx.fillStyle = `rgba(${hexToRgb(block.bgColor)}, ${block.bgOpacity})`;
        roundRect(ctx, line.x, line.bgY, line.bgW, line.bgH, block.borderRadius);
        ctx.fill();
      }
    }

    for (const line of metrics.lines) {
      ctx.fillStyle = block.textColor;
      ctx.fillText(line.text, line.x + block.paddingH, line.textY);
    }
  }

  ctx.restore();
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  creative: Creative | undefined,
  selectedLayer: SelectedLayer,
  measureCtx: CanvasRenderingContext2D,
  pixelRatio: number
) {
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (!creative || !selectedLayer) {
    ctx.restore();
    return;
  }

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#7C5CFC";
  ctx.fillStyle = "#7C5CFC";
  ctx.shadowColor = "rgba(124,92,252,0.35)";
  ctx.shadowBlur = 16;

  if (selectedLayer.type === "image") {
    ctx.strokeRect(8, 8, CANVAS_W - 16, CANVAS_H - 16);
    drawImageHandles(ctx);
    ctx.restore();
    return;
  }

  const block = creative.textBlocks.find((b) => b.id === selectedLayer.id);
  if (!block) {
    ctx.restore();
    return;
  }

  const m = measureTextBlock(measureCtx, block);
  ctx.strokeRect(m.x, m.y, m.w, m.h);
  ctx.shadowBlur = 0;
  drawTextHandles(ctx, m);
  ctx.restore();
}

function drawTextHandles(ctx: CanvasRenderingContext2D, m: BlockMetrics) {
  const handles = getTextHandles(m);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#7C5CFC";
  ctx.lineWidth = 2;
  for (const h of handles) {
    roundRect(ctx, h.x - 10, h.y - 10, 20, 20, 6);
    ctx.fill();
    ctx.stroke();
  }
}

function drawImageHandles(ctx: CanvasRenderingContext2D) {
  const points = [
    [22, 22],
    [CANVAS_W - 22, 22],
    [22, CANVAS_H - 22],
    [CANVAS_W - 22, CANVAS_H - 22],
  ];
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#7C5CFC";
  ctx.lineWidth = 2;
  for (const [x, y] of points) {
    roundRect(ctx, x - 13, y - 13, 26, 26, 8);
    ctx.fill();
    ctx.stroke();
  }
}

function getTextHandles(m: BlockMetrics): { handle: ResizeHandle; x: number; y: number }[] {
  const midY = m.y + m.h / 2;
  return [
    { handle: "nw", x: m.x, y: m.y },
    { handle: "ne", x: m.x + m.w, y: m.y },
    { handle: "sw", x: m.x, y: m.y + m.h },
    { handle: "se", x: m.x + m.w, y: m.y + m.h },
    { handle: "w", x: m.x, y: midY },
    { handle: "e", x: m.x + m.w, y: midY },
  ];
}

function hitTextHandle(point: { x: number; y: number }, metrics: BlockMetrics): ResizeHandle | null {
  for (const h of getTextHandles(metrics)) {
    if (Math.abs(point.x - h.x) <= 18 && Math.abs(point.y - h.y) <= 18) return h.handle;
  }
  return null;
}

function hitImageHandle(point: { x: number; y: number }) {
  const corners = [
    { x: 22, y: 22 },
    { x: CANVAS_W - 22, y: 22 },
    { x: 22, y: CANVAS_H - 22 },
    { x: CANVAS_W - 22, y: CANVAS_H - 22 },
  ];
  return corners.some((c) => Math.abs(point.x - c.x) <= 28 && Math.abs(point.y - c.y) <= 28);
}

function pointInMetrics(point: { x: number; y: number }, m: BlockMetrics) {
  return point.x >= m.x && point.x <= m.x + m.w && point.y >= m.y && point.y <= m.y + m.h;
}

function parseCopyIntoAds(raw: string): string[][][] {
  if (!raw.trim()) return [];
  const separatorRe = /^[\-=~]{3,}\s*$/;
  const chunks: string[] = [];
  let current: string[] = [];

  raw.split("\n").forEach((line) => {
    if (separatorRe.test(line.trim())) {
      if (current.length) chunks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  });
  if (current.length) chunks.push(current.join("\n"));

  return chunks
    .map((chunk) => {
      const sections: string[][] = [];
      let section: string[] = [];
      chunk.split("\n").forEach((line) => {
        if (!line.trim()) {
          if (section.length) sections.push(section);
          section = [];
        } else {
          section.push(line);
        }
      });
      if (section.length) sections.push(section);
      return sections;
    })
    .filter((sections) => sections.length > 0);
}

function getDraftDate(savedAt: number) {
  return new Date(savedAt).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buttonStyle(active = false): React.CSSProperties {
  return {
    border: active ? "1px solid #7C5CFC" : "1px solid rgba(255,255,255,0.08)",
    background: active ? "#7C5CFC" : "rgba(255,255,255,0.05)",
    color: active ? "#ffffff" : "rgba(255,255,255,0.72)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    fontFamily: "inherit",
  };
}

const panelStyle: React.CSSProperties = {
  background: "rgba(20,17,32,0.92)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  padding: 12,
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "rgba(255,255,255,0.4)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(8,8,14,0.75)",
  color: "rgba(255,255,255,0.9)",
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
};

export default function Studio2Page() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copyText, setCopyText] = useState(DEFAULT_COPY);
  const [projectName, setProjectName] = useState("Studio 2.0 Batch");
  const [view, setView] = useState<"setup" | "editor">("setup");
  const [colorPreset, setColorPreset] = useState<"dark" | "light">("dark");
  const [fontPreset, setFontPreset] = useState(FONT_OPTIONS[0].value);
  const [selectedLayer, setSelectedLayer] = useState<SelectedLayer>(null);
  const [viewScale, setViewScale] = useState(0.35);
  const [saveStatus, setSaveStatus] = useState("Autosave ready");
  const [exportStatus, setExportStatus] = useState("");
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [undoStack, setUndoStack] = useState<Creative[][]>([]);
  const [redoStack, setRedoStack] = useState<Creative[][]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const [, bumpImageVersion] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const hydratedRef = useRef(false);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const currentCreative = creatives[currentIndex];
  const selectedBlock =
    selectedLayer?.type === "text"
      ? currentCreative?.textBlocks.find((b) => b.id === selectedLayer.id)
      : undefined;

  const getMeasureCtx = useCallback(() => {
    if (!measureCanvasRef.current) measureCanvasRef.current = document.createElement("canvas");
    return measureCanvasRef.current.getContext("2d")!;
  }, []);

  const currentImage = currentCreative
    ? imageCacheRef.current.get(currentCreative.photoUrl) ?? null
    : null;

  useEffect(() => {
    if (!document.querySelector(`link[href="${GOOGLE_FONTS_URL}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = GOOGLE_FONTS_URL;
      document.head.appendChild(link);
    }
    document.fonts?.ready.then(() => bumpImageVersion((v) => v + 1)).catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDraft()
      .then((draft) => {
        if (!draft || cancelled) return;
        setPhotos(draft.photos || []);
        setCreatives(draft.creatives || []);
        setCurrentIndex(draft.currentIndex || 0);
        setCopyText(draft.copyText || DEFAULT_COPY);
        setProjectName(draft.projectName || "Studio 2.0 Batch");
        setColorPreset(draft.colorPreset || "dark");
        setFontPreset(draft.fontPreset || FONT_OPTIONS[0].value);
        setView(draft.view === "editor" && draft.creatives?.length ? "editor" : "setup");
        setRestoredAt(draft.savedAt);
        setSaveStatus(`Restored ${getDraftDate(draft.savedAt)}`);
      })
      .catch(() => setSaveStatus("Autosave unavailable"))
      .finally(() => {
        hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const handle = window.setTimeout(() => {
      const draft: DraftState = {
        version: 1,
        savedAt: Date.now(),
        photos,
        creatives,
        currentIndex,
        copyText,
        projectName,
        colorPreset,
        fontPreset,
        view,
      };
      saveDraft(draft)
        .then(() => setSaveStatus(`Saved ${getDraftDate(draft.savedAt)}`))
        .catch(() => setSaveStatus("Autosave failed"));
    }, 700);
    return () => window.clearTimeout(handle);
  }, [photos, creatives, currentIndex, copyText, projectName, colorPreset, fontPreset, view]);

  useEffect(() => {
    const updateScale = () => {
      const panelW = 326;
      const toolbarH = 60;
      const dockH = 104;
      const availableW = Math.max(320, window.innerWidth - panelW - 300);
      const availableH = Math.max(420, window.innerHeight - toolbarH - dockH - 30);
      const next = Math.min(availableW / CANVAS_W, availableH / CANVAS_H, 0.62);
      setViewScale(clamp(next, 0.18, 0.7));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  useEffect(() => {
    const urls = new Set([...photos, ...creatives.map((c) => c.photoUrl)]);
    urls.forEach((url) => {
      if (imageCacheRef.current.has(url)) return;
      loadImage(url)
        .then((img) => {
          imageCacheRef.current.set(url, img);
          bumpImageVersion((v) => v + 1);
        })
        .catch(() => undefined);
    });
  }, [photos, creatives]);

  const renderPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!canvas || !overlay) return;
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(CANVAS_W * dpr);
    canvas.height = Math.round(CANVAS_H * dpr);
    overlay.width = Math.round(CANVAS_W * dpr);
    overlay.height = Math.round(CANVAS_H * dpr);

    const ctx = canvas.getContext("2d")!;
    const overlayCtx = overlay.getContext("2d")!;
    if (currentCreative) {
      drawArtwork(ctx, currentCreative, currentImage, dpr);
    } else {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#05040a";
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
    drawOverlay(overlayCtx, currentCreative, selectedLayer, getMeasureCtx(), dpr);
  }, [currentCreative, currentImage, selectedLayer, getMeasureCtx]);

  useEffect(() => {
    renderPreview();
  }, [renderPreview, viewScale]);

  const pushUndo = useCallback(() => {
    setUndoStack((stack) => [...stack.slice(-29), cloneCreatives(creatives)]);
    setRedoStack([]);
  }, [creatives]);

  const undo = useCallback(() => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((stack) => [...stack, cloneCreatives(creatives)]);
    setCreatives(cloneCreatives(previous));
    setUndoStack((stack) => stack.slice(0, -1));
    setSelectedLayer(null);
  }, [creatives, undoStack]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((stack) => [...stack, cloneCreatives(creatives)]);
    setCreatives(cloneCreatives(next));
    setRedoStack((stack) => stack.slice(0, -1));
    setSelectedLayer(null);
  }, [creatives, redoStack]);

  const updateCurrentCreative = useCallback(
    (updater: (creative: Creative) => Creative) => {
      setCreatives((prev) =>
        prev.map((creative, index) => (index === currentIndex ? updater(creative) : creative))
      );
    },
    [currentIndex]
  );

  const updateSelectedBlock = useCallback(
    (updates: Partial<TextBlock>) => {
      if (!selectedBlock) return;
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          block.id === selectedBlock.id ? { ...block, ...updates } : block
        ),
      }));
    },
    [selectedBlock, updateCurrentCreative]
  );

  const updateImage = useCallback(
    (updates: Partial<ImageTransform>) => {
      updateCurrentCreative((creative) => ({
        ...creative,
        imageTransform: { ...creative.imageTransform, ...updates },
      }));
    },
    [updateCurrentCreative]
  );

  const makeBlock = useCallback(
    (lines: string[], role: "title" | "body" | "callout" | "cta"): TextBlock => {
      const isLight = colorPreset === "light";
      const isSerif = fontPreset.includes("Source Serif");
      return {
        id: uid(),
        lines,
        x: 60,
        y: 80,
        fontSize: role === "title" ? 72 : role === "cta" ? 56 : role === "callout" ? 52 : 44,
        fontFamily: fontPreset,
        fontWeight: isSerif ? 400 : 700,
        textColor: isLight ? "#000000" : "#ffffff",
        bgColor: isLight ? "#ffffff" : "#000000",
        bgOpacity: 1,
        borderRadius: role === "title" ? 18 : 14,
        paddingH: role === "title" ? 32 : 24,
        paddingV: role === "title" ? 18 : 14,
        align: role === "body" ? "left" : "center",
        lineGap: 8,
        lineHeight: 1.18,
        maxWidth: 960,
      };
    },
    [colorPreset, fontPreset]
  );

  const layoutBlocks = useCallback(
    (blocks: TextBlock[]) => {
      const ctx = getMeasureCtx();
      const top = 72;
      const bottom = 1600;
      const measured = blocks.map((block) => measureTextBlock(ctx, block).h);
      const totalH = measured.reduce((sum, h) => sum + h, 0);
      const gap = blocks.length > 1
        ? clamp((bottom - top - totalH) / (blocks.length - 1), 28, 96)
        : 0;
      let y = top;

      return blocks.map((block, index) => {
        const next = {
          ...block,
          x: 60,
          y: Math.round(y),
          maxWidth: 960,
          align: index === 0 || index === blocks.length - 1 ? "center" as TextAlign : "left" as TextAlign,
        };
        y += measured[index] + gap;
        return next;
      });
    },
    [getMeasureCtx]
  );

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    const urls = await Promise.all(Array.from(files).map(fileToDataUrl));
    setPhotos((prev) => [...prev, ...urls]);
  }, []);

  const buildBlocksForSections = useCallback(
    (sections: string[][]) =>
      layoutBlocks(
        sections.map((lines, index) => {
          if (index === 0) return makeBlock(lines, "title");
          if (sections.length > 2 && index === sections.length - 1) return makeBlock(lines, "cta");
          if (sections.length > 3 && index === sections.length - 2) return makeBlock(lines, "callout");
          return makeBlock(lines, "body");
        })
      ),
    [layoutBlocks, makeBlock]
  );

  const generateAds = useCallback(() => {
    if (!photos.length) return;
    const groups = parseCopyIntoAds(copyText);
    const usableGroups = groups.length ? groups : parseCopyIntoAds(DEFAULT_COPY);
    const nextCreatives = photos.map((photoUrl, index): Creative => {
      const sections = usableGroups[index % usableGroups.length];
      return {
        id: uid(),
        photoUrl,
        textBlocks: buildBlocksForSections(sections),
        imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
        status: "draft",
      };
    });
    setCreatives(nextCreatives);
    setCurrentIndex(0);
    setSelectedLayer(null);
    setUndoStack([]);
    setRedoStack([]);
    setView("editor");
  }, [buildBlocksForSections, copyText, photos]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS_H,
    };
  };

  const findHitBlock = useCallback(
    (point: { x: number; y: number }) => {
      if (!currentCreative) return null;
      const ctx = getMeasureCtx();
      for (let i = currentCreative.textBlocks.length - 1; i >= 0; i--) {
        const block = currentCreative.textBlocks[i];
        if (pointInMetrics(point, measureTextBlock(ctx, block))) return block;
      }
      return null;
    },
    [currentCreative, getMeasureCtx]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!currentCreative) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = pointFromEvent(event);
      const ctx = getMeasureCtx();

      if (selectedLayer?.type === "text") {
        const block = currentCreative.textBlocks.find((b) => b.id === selectedLayer.id);
        if (block && !block.locked) {
          const handle = hitTextHandle(point, measureTextBlock(ctx, block));
          if (handle) {
            pushUndo();
            dragRef.current = {
              kind: "resize-text",
              blockId: block.id,
              handle,
              startX: point.x,
              startY: point.y,
              orig: { ...block, lines: [...block.lines] },
            };
            return;
          }
        }
      }

      if (selectedLayer?.type === "image" && hitImageHandle(point)) {
        pushUndo();
        dragRef.current = {
          kind: "resize-image",
          startX: point.x,
          startY: point.y,
          orig: { ...currentCreative.imageTransform },
        };
        return;
      }

      const hit = findHitBlock(point);
      if (hit) {
        setSelectedLayer({ type: "text", id: hit.id });
        if (!hit.locked) {
          pushUndo();
          dragRef.current = {
            kind: "move-text",
            blockId: hit.id,
            startX: point.x,
            startY: point.y,
            origX: hit.x,
            origY: hit.y,
          };
        }
        return;
      }

      setSelectedLayer({ type: "image" });
      pushUndo();
      dragRef.current = {
        kind: "move-image",
        startX: point.x,
        startY: point.y,
        orig: { ...currentCreative.imageTransform },
      };
    },
    [currentCreative, findHitBlock, getMeasureCtx, pushUndo, selectedLayer]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag) return;
      const point = pointFromEvent(event);
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;

      if (drag.kind === "move-text") {
        updateCurrentCreative((creative) => ({
          ...creative,
          textBlocks: creative.textBlocks.map((block) =>
            block.id === drag.blockId
              ? { ...block, x: Math.round(drag.origX + dx), y: Math.round(drag.origY + dy) }
              : block
          ),
        }));
      }

      if (drag.kind === "resize-text") {
        const handle = drag.handle;
        const widthDelta = handle.includes("e") ? dx : handle.includes("w") ? -dx : 0;
        const scaleDelta = handle.length === 2 ? (widthDelta - dy) / 360 : 0;
        const factor = clamp(1 + scaleDelta, 0.35, 2.6);
        const maxWidth = clamp(Math.round(drag.orig.maxWidth + widthDelta), 220, 1060);
        const fontSize = handle.length === 2
          ? clamp(Math.round(drag.orig.fontSize * factor), 14, 150)
          : drag.orig.fontSize;
        const paddingH = handle.length === 2 ? Math.round(drag.orig.paddingH * factor) : drag.orig.paddingH;
        const paddingV = handle.length === 2 ? Math.round(drag.orig.paddingV * factor) : drag.orig.paddingV;
        const borderRadius = handle.length === 2
          ? Math.round(drag.orig.borderRadius * factor)
          : drag.orig.borderRadius;
        const x = handle.includes("w")
          ? Math.round(drag.orig.x + (drag.orig.maxWidth - maxWidth))
          : drag.orig.x;

        updateCurrentCreative((creative) => ({
          ...creative,
          textBlocks: creative.textBlocks.map((block) =>
            block.id === drag.blockId
              ? { ...block, x, maxWidth, fontSize, paddingH, paddingV, borderRadius }
              : block
          ),
        }));
      }

      if (drag.kind === "move-image") {
        updateImage({
          offsetX: Math.round(drag.orig.offsetX + dx),
          offsetY: Math.round(drag.orig.offsetY + dy),
        });
      }

      if (drag.kind === "resize-image") {
        updateImage({
          scale: clamp(parseFloat((drag.orig.scale + (dx - dy) / 850).toFixed(3)), 0.4, 4),
        });
      }
    },
    [updateCurrentCreative, updateImage]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (view !== "editor") return;
      const active = document.activeElement?.tagName.toLowerCase();
      const typing = active === "input" || active === "textarea" || active === "select";
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }

      if (!typing && selectedLayer?.type === "text" && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        pushUndo();
        updateCurrentCreative((creative) => ({
          ...creative,
          textBlocks: creative.textBlocks.filter((block) => block.id !== selectedLayer.id),
        }));
        setSelectedLayer(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pushUndo, redo, selectedLayer, undo, updateCurrentCreative, view]);

  const renderCreativeToCanvas = useCallback(
    async (creative: Creative, pixelRatio = 2) => {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W * pixelRatio;
      canvas.height = CANVAS_H * pixelRatio;
      const ctx = canvas.getContext("2d")!;
      let image = imageCacheRef.current.get(creative.photoUrl) ?? null;
      if (!image) {
        image = await loadImage(creative.photoUrl);
        imageCacheRef.current.set(creative.photoUrl, image);
      }
      drawArtwork(ctx, creative, image, pixelRatio);
      return canvas;
    },
    []
  );

  const exportCurrent = useCallback(async () => {
    if (!currentCreative) return;
    setExportStatus("Exporting current ad...");
    const canvas = await renderCreativeToCanvas(currentCreative, 2);
    const link = document.createElement("a");
    link.download = `studio-2-ad-${currentIndex + 1}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setCreatives((prev) =>
      prev.map((creative, index) => index === currentIndex ? { ...creative, status: "exported" } : creative)
    );
    setExportStatus("");
  }, [currentCreative, currentIndex, renderCreativeToCanvas]);

  const exportAll = useCallback(async () => {
    if (!creatives.length) return;
    setExportStatus(`Exporting 1 of ${creatives.length}...`);
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const folderName = `${projectName || "Studio 2.0 Ads"} - ${new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", " ")
      .replace(":", "-")}`;
    const folder = zip.folder(folderName)!;

    for (let i = 0; i < creatives.length; i++) {
      setExportStatus(`Exporting ${i + 1} of ${creatives.length}...`);
      const canvas = await renderCreativeToCanvas(creatives[i], 2);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });
      folder.file(`ad-${i + 1}.png`, blob);
    }

    setExportStatus("Zipping...");
    const blob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    const href = URL.createObjectURL(blob);
    link.href = href;
    link.download = `${folderName}.zip`;
    link.click();
    URL.revokeObjectURL(href);
    setCreatives((prev) => prev.map((creative) => ({ ...creative, status: "exported" })));
    setExportStatus("");
  }, [creatives, projectName, renderCreativeToCanvas]);

  const addTextBlock = useCallback(() => {
    if (!currentCreative) return;
    pushUndo();
    const newBlock = makeBlock(["New text here"], "body");
    updateCurrentCreative((creative) => ({
      ...creative,
      textBlocks: [...creative.textBlocks, { ...newBlock, x: 90, y: 180 }],
    }));
    setSelectedLayer({ type: "text", id: newBlock.id });
  }, [currentCreative, makeBlock, pushUndo, updateCurrentCreative]);

  const applyCurrentLayoutToAll = useCallback(() => {
    if (!currentCreative) return;
    pushUndo();
    setCreatives((prev) =>
      prev.map((creative, index) =>
        index === currentIndex
          ? creative
          : {
              ...creative,
              textBlocks: currentCreative.textBlocks.map((block) => ({ ...block, id: uid() })),
            }
      )
    );
  }, [currentCreative, currentIndex, pushUndo]);

  if (view === "setup") {
    return (
      <div className="fade-up" style={{ paddingBottom: 40 }}>
        <div className="page-header">
          <h1 className="page-title">Studio 2.0</h1>
          <p className="page-subtitle">
            A new canvas-first ad builder where preview and export use the same renderer.
          </p>
        </div>

        {restoredAt && (
          <div className="section">
            <div className="glass-static" style={{ padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
                Autosave restored from {getDraftDate(restoredAt)}.
              </span>
              <button
                style={buttonStyle(false)}
                onClick={async () => {
                  await clearDraft();
                  setPhotos([]);
                  setCreatives([]);
                  setCurrentIndex(0);
                  setCopyText(DEFAULT_COPY);
                  setRestoredAt(null);
                  setSaveStatus("Draft cleared");
                }}
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        <div className="section" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 18 }}>
          <div className="glass-static" style={{ padding: 22 }}>
            <h2 className="section-title" style={{ marginBottom: 16 }}>
              <ImagePlus size={16} /> Photos
            </h2>
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "100%",
                border: "2px dashed rgba(255,255,255,0.14)",
                background: "rgba(255,255,255,0.03)",
                borderRadius: 10,
                padding: 34,
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <Upload size={30} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>Upload athlete photos</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Select multiple JPG or PNG images</div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: "none" }}
              onChange={(event) => handleFiles(event.target.files)}
            />

            {photos.length > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginTop: 16 }}>
                {photos.map((photo, index) => (
                  <div key={`${photo.slice(0, 24)}-${index}`} style={{ position: "relative", aspectRatio: "9 / 16", borderRadius: 7, overflow: "hidden", background: "#05040a" }}>
                    <img src={photo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <button
                      aria-label="Remove photo"
                      onClick={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        border: "none",
                        background: "rgba(0,0,0,0.72)",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10, color: "var(--text-muted)", fontSize: 12 }}>{photos.length} photo{photos.length === 1 ? "" : "s"} ready</div>
          </div>

          <div className="glass-static" style={{ padding: 22 }}>
            <h2 className="section-title" style={{ marginBottom: 16 }}>
              <Type size={16} /> Copy
            </h2>
            <label style={labelStyle}>Batch Name</label>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} style={{ ...inputStyle, margin: "6px 0 14px" }} />
            <textarea
              value={copyText}
              onChange={(e) => setCopyText(e.target.value)}
              rows={15}
              style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-geist-mono)", lineHeight: 1.45 }}
              placeholder={DEFAULT_COPY}
            />
            <p style={{ margin: "10px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
              Blank lines create separate text blocks. A line with <code>-----</code> starts another ad.
            </p>
          </div>
        </div>

        <div className="section" style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button style={buttonStyle(colorPreset === "dark")} onClick={() => setColorPreset("dark")}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "#000", border: "1px solid #444" }} />
            White on Black
          </button>
          <button style={buttonStyle(colorPreset === "light")} onClick={() => setColorPreset("light")}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "#fff", border: "1px solid #aaa" }} />
            Black on White
          </button>
          <select value={fontPreset} onChange={(e) => setFontPreset(e.target.value)} style={{ ...inputStyle, width: 230, height: 38 }}>
            {FONT_OPTIONS.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
        </div>

        <div className="section" style={{ display: "flex", justifyContent: "center" }}>
          <button
            disabled={!photos.length}
            onClick={generateAds}
            style={{
              ...buttonStyle(true),
              padding: "15px 44px",
              fontSize: 17,
              opacity: photos.length ? 1 : 0.35,
              cursor: photos.length ? "pointer" : "not-allowed",
            }}
          >
            <Sparkles size={19} />
            Generate {photos.length || ""} Ad{photos.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ad-studio-fullbleed" style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <div style={{
        height: 58,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(20,17,32,0.96)",
      }}>
        <button style={buttonStyle(false)} onClick={() => setView("setup")}>
          <ArrowLeft size={14} /> Setup
        </button>
        <div style={{ height: 24, width: 1, background: "rgba(255,255,255,0.1)" }} />
        <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>{projectName}</strong>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Ad {currentIndex + 1} of {creatives.length}</span>
        <span style={{ color: "rgba(124,92,252,0.85)", fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
          {saveStatus}
        </span>
        <div style={{ flex: 1 }} />
        <input
          type="range"
          min={18}
          max={70}
          value={Math.round(viewScale * 100)}
          onChange={(e) => setViewScale(parseInt(e.target.value) / 100)}
          style={{ accentColor: "#7C5CFC", width: 96 }}
        />
        <span style={{ color: "var(--text-muted)", fontSize: 11, width: 34 }}>{Math.round(viewScale * 100)}%</span>
        <button style={{ ...buttonStyle(false), opacity: undoStack.length ? 1 : 0.35 }} onClick={undo} disabled={!undoStack.length}>
          <RotateCcw size={14} /> Undo
        </button>
        <button style={{ ...buttonStyle(false), opacity: redoStack.length ? 1 : 0.35 }} onClick={redo} disabled={!redoStack.length}>
          Redo
        </button>
        <button style={buttonStyle(false)} onClick={exportCurrent}>
          <Download size={14} /> Export
        </button>
        <button style={buttonStyle(true)} onClick={exportAll}>
          <Download size={14} /> Export All
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div ref={canvasAreaRef} style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#07070d",
          backgroundImage: "linear-gradient(rgba(124,92,252,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(124,92,252,0.08) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          position: "relative",
        }}>
          {exportStatus && (
            <div style={{ position: "absolute", top: 14, zIndex: 10, ...panelStyle, color: "#fff", fontSize: 12 }}>
              {exportStatus}
            </div>
          )}
          <div style={{
            position: "relative",
            width: CANVAS_W * viewScale,
            height: CANVAS_H * viewScale,
            boxShadow: "0 22px 70px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.08)",
            background: "#05040a",
          }}>
            <canvas
              ref={canvasRef}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
            />
            <canvas
              ref={overlayRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", touchAction: "none", cursor: selectedLayer?.type === "image" ? "grab" : "default" }}
            />
          </div>

          <div style={{ height: 92, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, overflowX: "auto", padding: "14px 18px" }}>
            {creatives.map((creative, index) => (
              <button
                key={creative.id}
                onClick={() => {
                  setCurrentIndex(index);
                  setSelectedLayer(null);
                }}
                style={{
                  width: 42,
                  height: 74,
                  borderRadius: 6,
                  overflow: "hidden",
                  border: index === currentIndex ? "2px solid #7C5CFC" : "1px solid rgba(255,255,255,0.12)",
                  background: "#05040a",
                  padding: 0,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                title={`Ad ${index + 1}`}
              >
                <img src={creative.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </button>
            ))}
          </div>
        </div>

        <aside style={{
          width: 326,
          flexShrink: 0,
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(13,11,22,0.98)",
          padding: 12,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button style={buttonStyle(false)} onClick={addTextBlock}>
              <Type size={13} /> Add Text
            </button>
            <button style={buttonStyle(false)} onClick={applyCurrentLayoutToAll}>
              <Sparkles size={13} /> Apply All
            </button>
          </div>

          <div style={panelStyle}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>
              <MousePointer2 size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
              Selection
            </div>
            <div style={{ color: "rgba(255,255,255,0.58)", fontSize: 12, lineHeight: 1.6 }}>
              Click text to move it. Drag white handles to resize. Click the background image to crop, move, or zoom it.
            </div>
          </div>

          {selectedBlock && (
            <div style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={labelStyle}>Text Block</span>
                <button
                  style={{ ...buttonStyle(false), padding: "5px 8px", color: "#ff8b8b" }}
                  onClick={() => {
                    pushUndo();
                    updateCurrentCreative((creative) => ({
                      ...creative,
                      textBlocks: creative.textBlocks.filter((block) => block.id !== selectedBlock.id),
                    }));
                    setSelectedLayer(null);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <textarea
                value={selectedBlock.lines.join("\n")}
                onFocus={pushUndo}
                onChange={(e) => updateSelectedBlock({ lines: e.target.value.split("\n") })}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.4, marginBottom: 10 }}
              />
              <Control label="Font">
                <select value={selectedBlock.fontFamily} onMouseDown={pushUndo} onChange={(e) => updateSelectedBlock({ fontFamily: e.target.value })} style={inputStyle}>
                  {FONT_OPTIONS.map((font) => (
                    <option key={font.value} value={font.value}>{font.label}</option>
                  ))}
                </select>
              </Control>
              <Slider label="Size" min={14} max={150} value={selectedBlock.fontSize} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ fontSize: value })} />
              <Slider label="Width" min={220} max={1060} value={selectedBlock.maxWidth} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ maxWidth: value })} />
              <Slider label="Padding" min={0} max={70} value={selectedBlock.paddingH} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ paddingH: value, paddingV: Math.round(value * 0.58) })} />
              <Slider label="Radius" min={0} max={40} value={selectedBlock.borderRadius} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ borderRadius: value })} />
              <Slider label="Opacity" min={0} max={100} value={Math.round(selectedBlock.bgOpacity * 100)} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ bgOpacity: value / 100 })} suffix="%" />
              <Control label="Colors">
                <input type="color" value={selectedBlock.textColor} onMouseDown={pushUndo} onChange={(e) => updateSelectedBlock({ textColor: e.target.value })} style={{ width: 42, height: 32, border: "none", background: "transparent" }} title="Text color" />
                <input type="color" value={selectedBlock.bgColor} onMouseDown={pushUndo} onChange={(e) => updateSelectedBlock({ bgColor: e.target.value })} style={{ width: 42, height: 32, border: "none", background: "transparent" }} title="Highlight color" />
                <span style={{ color: "rgba(255,255,255,0.35)", fontSize: 11 }}>text / highlight</span>
              </Control>
              <Control label="Align">
                {(["left", "center", "right"] as const).map((align) => (
                  <button key={align} style={buttonStyle(selectedBlock.align === align)} onClick={() => { pushUndo(); updateSelectedBlock({ align }); }}>
                    {align}
                  </button>
                ))}
              </Control>
            </div>
          )}

          {selectedLayer?.type === "image" && currentCreative && (
            <div style={panelStyle}>
              <span style={{ ...labelStyle, display: "block", marginBottom: 10 }}>Image Crop</span>
              <Slider label="Zoom" min={40} max={400} value={Math.round(currentCreative.imageTransform.scale * 100)} onStart={pushUndo} onChange={(value) => updateImage({ scale: value / 100 })} suffix="%" />
              <Slider label="Rotate" min={-180} max={180} value={currentCreative.imageTransform.rotate} onStart={pushUndo} onChange={(value) => updateImage({ rotate: value })} suffix="°" />
              <Control label="Offset">
                <input type="number" value={currentCreative.imageTransform.offsetX} onFocus={pushUndo} onChange={(e) => updateImage({ offsetX: parseInt(e.target.value) || 0 })} style={inputStyle} />
                <input type="number" value={currentCreative.imageTransform.offsetY} onFocus={pushUndo} onChange={(e) => updateImage({ offsetY: parseInt(e.target.value) || 0 })} style={inputStyle} />
              </Control>
              <button
                style={{ ...buttonStyle(false), width: "100%", marginTop: 8 }}
                onClick={() => {
                  pushUndo();
                  updateImage({ scale: 1, rotate: 0, offsetX: 0, offsetY: 0 });
                }}
              >
                <RotateCcw size={13} /> Reset Image
              </button>
            </div>
          )}

          <div style={panelStyle}>
            <span style={{ ...labelStyle, display: "block", marginBottom: 8 }}>
              <Layers size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
              Layers
            </span>
            <button
              style={{ ...buttonStyle(selectedLayer?.type === "image"), width: "100%", justifyContent: "flex-start", marginBottom: 5 }}
              onClick={() => setSelectedLayer({ type: "image" })}
            >
              <ImagePlus size={13} /> Background Image
            </button>
            {currentCreative?.textBlocks.map((block) => (
              <button
                key={block.id}
                onClick={() => setSelectedLayer({ type: "text", id: block.id })}
                style={{
                  ...buttonStyle(selectedLayer?.type === "text" && selectedLayer.id === block.id),
                  width: "100%",
                  justifyContent: "flex-start",
                  marginBottom: 5,
                  overflow: "hidden",
                }}
              >
                <Type size={13} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {block.lines[0] || "Empty text"}
                </span>
              </button>
            ))}
          </div>

          <div style={{ color: "rgba(255,255,255,0.28)", fontSize: 11, lineHeight: 1.5, padding: "2px 2px 10px" }}>
            Studio 2.0 saves locally in this browser. It can recover your work after refresh or Wi-Fi loss.
          </div>
        </aside>
      </div>
    </div>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ ...labelStyle, marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", gap: 7, alignItems: "center" }}>{children}</div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  value,
  onStart,
  onChange,
  suffix = "",
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onStart: () => void;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={labelStyle}>{label}</span>
        <span style={{ color: "rgba(255,255,255,0.36)", fontSize: 11 }}>{value}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onPointerDown={onStart}
        onChange={(e) => onChange(parseInt(e.target.value))}
        style={{ width: "100%", accentColor: "#7C5CFC" }}
      />
    </div>
  );
}
