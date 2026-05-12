"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  ArrowLeft,
  BringToFront,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Clock3,
  CopyPlus,
  Download,
  FilePlus2,
  Film,
  Folder,
  FolderPlus,
  Grid3X3,
  HardDrive,
  ImagePlus,
  Layers,
  MoreHorizontal,
  MousePointer2,
  Paintbrush,
  PanelBottom,
  PanelTop,
  Plus,
  Replace,
  RotateCcw,
  Search,
  SendToBack,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Video,
} from "lucide-react";

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const AUTOSAVE_KEY = "active-draft";
const DB_NAME = "ccos-studio-2";
const DB_STORE = "drafts";
const DRAG_THRESHOLD = 5;
const SNAP_THRESHOLD = 10;
const IG_SAFE_ZONES = [
  { id: "top" as const, x: 0, y: 0, w: CANVAS_W, h: 150, label: "Instagram top bar" },
  { id: "dm" as const, x: 170, y: 1590, w: 740, h: 195, label: "Send message button" },
  { id: "bottom" as const, x: 0, y: 1830, w: 170, h: 82, label: "Ad label" },
];
const ADS_BRAND = {
  bg: "#0a0a0a",
  bgDeep: "#050505",
  panel: "#111111",
  panel2: "#141414",
  panel3: "#0f0f0f",
  active: "#1e1e1e",
  border: "#1f1f1f",
  border2: "#262626",
  text: "#e8e8e8",
  text2: "#a8a8a8",
  text3: "#6b6b6b",
  text4: "#4a4a4a",
  gold: "#d4b27a",
  goldDim: "#8a7348",
  goldSoft: "rgba(212,178,122,0.08)",
  goldBorder: "rgba(212,178,122,0.32)",
  success: "#7dd3a8",
  successText: "#07130d",
};

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
type StudioView = "home" | "setup" | "editor";
type SelectedLayer = { type: "text"; id: string } | { type: "image" } | null;
type SafeZoneId = (typeof IG_SAFE_ZONES)[number]["id"];
type TextStyle = Omit<TextBlock, "id" | "lines" | "x" | "y" | "locked">;

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
  approved?: boolean;
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
  view: StudioView;
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

interface AlignmentGuides {
  x: number[];
  y: number[];
}

interface ContextMenuState {
  x: number;
  y: number;
  target: SelectedLayer;
}

type DragState =
  | {
      kind: "move-text";
      active: boolean;
      blockId: string;
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origMetrics: BlockMetrics;
    }
  | {
      kind: "resize-text";
      active: boolean;
      blockId: string;
      handle: ResizeHandle;
      startX: number;
      startY: number;
      orig: TextBlock;
      origMetrics: BlockMetrics;
    }
  | {
      kind: "move-image";
      active: boolean;
      startX: number;
      startY: number;
      orig: ImageTransform;
    }
  | {
      kind: "resize-image";
      active: boolean;
      startX: number;
      startY: number;
      orig: ImageTransform;
      startDistance: number;
    };

type ResizeHandle = "nw" | "ne" | "sw" | "se" | "e" | "w";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const cloneCreatives = (creatives: Creative[]) =>
  JSON.parse(JSON.stringify(creatives)) as Creative[];

function normalizeTextBlock(block: TextBlock): TextBlock {
  const fontSize = block.fontSize || 44;
  const looksLikeFirstPass = (block.lineHeight || 0) < 1.3 || block.lineGap >= 8;
  const next: TextBlock = {
    ...block,
    lineHeight: looksLikeFirstPass ? 1.5 : block.lineHeight || 1.5,
    lineGap: looksLikeFirstPass ? (fontSize <= 46 ? 5 : 6) : block.lineGap ?? (fontSize <= 46 ? 5 : 6),
  };

  if (looksLikeFirstPass && fontSize === 52 && block.paddingH === 24 && block.paddingV === 14) {
    next.paddingH = 28;
    next.paddingV = 16;
    next.borderRadius = 16;
  }

  if (looksLikeFirstPass && fontSize === 56 && block.paddingH === 24 && block.paddingV === 14) {
    next.paddingH = 28;
    next.paddingV = 18;
    next.borderRadius = 16;
  }

  return next;
}

function normalizeCreative(creative: Creative): Creative {
  return {
    ...creative,
    textBlocks: creative.textBlocks.map(normalizeTextBlock),
  };
}

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
  let bottom = block.y;

  for (const logicalLine of block.lines) {
    if (!logicalLine.trim()) {
      y += Math.round(block.fontSize * 0.55 + block.lineGap);
      bottom = Math.max(bottom, y);
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
      bottom = Math.max(bottom, y + bgH);
      y += lineH + block.lineGap;
    }
  }

  const h = Math.max(24, bottom - block.y);
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
  pixelRatio: number,
  editingTextBlockId?: string | null
) {
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = ADS_BRAND.bgDeep;
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
      if (block.id === editingTextBlockId) continue;
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
  activeGuides: AlignmentGuides,
  activeSafeZones: SafeZoneId[],
  measureCtx: CanvasRenderingContext2D,
  pixelRatio: number
) {
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawSafeZones(ctx, activeSafeZones);
  drawAlignmentGuides(ctx, activeGuides);

  if (!creative || !selectedLayer) {
    ctx.restore();
    return;
  }

  ctx.lineWidth = 5;
  ctx.strokeStyle = ADS_BRAND.gold;
  ctx.fillStyle = ADS_BRAND.gold;
  ctx.shadowColor = "rgba(212,178,122,0.32)";
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

function drawSafeZones(ctx: CanvasRenderingContext2D, zones: SafeZoneId[]) {
  if (!zones.length) return;

  ctx.save();
  ctx.font = "800 28px Inter, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  for (const id of zones) {
    const zone = IG_SAFE_ZONES.find((z) => z.id === id);
    if (!zone) continue;
    ctx.fillStyle = "rgba(255, 51, 102, 0.13)";
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    ctx.strokeStyle = "rgba(255, 51, 102, 0.86)";
    ctx.lineWidth = 5;
    ctx.setLineDash([22, 14]);
    ctx.beginPath();
    ctx.rect(zone.x + 2.5, zone.y + 2.5, Math.max(0, zone.w - 5), Math.max(0, zone.h - 5));
    ctx.stroke();
    ctx.setLineDash([]);
    const labelW = Math.min(330, Math.max(130, zone.w - 28));
    const labelX = Math.min(zone.x + 18, CANVAS_W - labelW - 18);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    roundRect(ctx, labelX, zone.y + zone.h / 2 - 27, labelW, 54, 18);
    ctx.fillStyle = "rgba(255, 51, 102, 0.9)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(zone.label, labelX + 22, zone.y + zone.h / 2);
  }

  ctx.restore();
}

function drawAlignmentGuides(ctx: CanvasRenderingContext2D, guides: AlignmentGuides) {
  if (!guides.x.length && !guides.y.length) return;

  ctx.save();
  ctx.strokeStyle = ADS_BRAND.gold;
  ctx.lineWidth = 4;
  ctx.shadowColor = "rgba(212,178,122,0.65)";
  ctx.shadowBlur = 12;
  ctx.setLineDash([18, 12]);

  for (const x of guides.x) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, -30);
    ctx.lineTo(Math.round(x) + 0.5, CANVAS_H + 30);
    ctx.stroke();
  }

  for (const y of guides.y) {
    ctx.beginPath();
    ctx.moveTo(-30, Math.round(y) + 0.5);
    ctx.lineTo(CANVAS_W + 30, Math.round(y) + 0.5);
    ctx.stroke();
  }

  ctx.restore();
}

function drawTextHandles(ctx: CanvasRenderingContext2D, m: BlockMetrics) {
  const handles = getTextHandles(m);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = ADS_BRAND.gold;
  ctx.lineWidth = 3;
  for (const h of handles) {
    roundRect(ctx, h.x - 13, h.y - 13, 26, 26, 7);
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
  ctx.strokeStyle = ADS_BRAND.gold;
  ctx.lineWidth = 2;
  for (const [x, y] of points) {
    roundRect(ctx, x - 15, y - 15, 30, 30, 8);
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
    if (Math.abs(point.x - h.x) <= 30 && Math.abs(point.y - h.y) <= 30) return h.handle;
  }
  return null;
}

function hitImageHandle(point: { x: number; y: number }): ResizeHandle | null {
  const corners = [
    { handle: "nw" as const, x: 22, y: 22 },
    { handle: "ne" as const, x: CANVAS_W - 22, y: 22 },
    { handle: "sw" as const, x: 22, y: CANVAS_H - 22 },
    { handle: "se" as const, x: CANVAS_W - 22, y: CANVAS_H - 22 },
  ];
  return corners.find((c) => Math.abs(point.x - c.x) <= 36 && Math.abs(point.y - c.y) <= 36)?.handle ?? null;
}

function pointInMetrics(point: { x: number; y: number }, m: BlockMetrics) {
  return point.x >= m.x && point.x <= m.x + m.w && point.y >= m.y && point.y <= m.y + m.h;
}

function cursorForResizeHandle(handle: ResizeHandle) {
  if (handle === "e" || handle === "w") return "ew-resize";
  if (handle === "nw" || handle === "se") return "nwse-resize";
  return "nesw-resize";
}

function findBestSnap(position: number, size: number, targets: number[]) {
  let best: { position: number; guide: number; dist: number } | null = null;

  for (const target of targets) {
    const candidates = [
      { edge: position, snapped: target },
      { edge: position + size, snapped: target - size },
      { edge: position + size / 2, snapped: target - size / 2 },
    ];

    for (const candidate of candidates) {
      const dist = Math.abs(candidate.edge - target);
      if (dist <= SNAP_THRESHOLD && (!best || dist < best.dist)) {
        best = { position: candidate.snapped, guide: target, dist };
      }
    }
  }

  return best;
}

function snapTextPosition(
  rawX: number,
  rawY: number,
  metrics: BlockMetrics,
  blockId: string,
  creative: Creative,
  measureCtx: CanvasRenderingContext2D
) {
  const targetsX = [0, CANVAS_W / 2, CANVAS_W];
  const targetsY = [0, CANVAS_H / 2, CANVAS_H];

  for (const block of creative.textBlocks) {
    if (block.id === blockId) continue;
    const other = measureTextBlock(measureCtx, block);
    targetsX.push(other.x, other.x + other.w, other.x + other.w / 2);
    targetsY.push(other.y, other.y + other.h, other.y + other.h / 2);
  }

  const snapX = findBestSnap(rawX, metrics.w, targetsX);
  const snapY = findBestSnap(rawY, metrics.h, targetsY);
  const x = Math.round(clamp(snapX ? snapX.position : rawX, -metrics.w * 0.3, CANVAS_W - metrics.w * 0.3));
  const y = Math.round(clamp(snapY ? snapY.position : rawY, -metrics.h * 0.3, CANVAS_H - metrics.h * 0.3));

  return {
    x,
    y,
    guides: {
      x: snapX ? [snapX.guide] : [],
      y: snapY ? [snapY.guide] : [],
    },
  };
}

function rectsIntersect(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function getSafeZoneHits(x: number, y: number, metrics: BlockMetrics): SafeZoneId[] {
  const textRects = metrics.lines.length
    ? metrics.lines.map((line) => ({
        x: x + (line.x - metrics.x),
        y: y + (line.bgY - metrics.y),
        w: line.bgW,
        h: line.bgH,
      }))
    : [{ x, y, w: metrics.w, h: metrics.h }];

  return IG_SAFE_ZONES
    .filter((zone) => textRects.some((rect) => rectsIntersect(rect, zone)))
    .map((zone) => zone.id);
}

function getTextStyle(block: TextBlock): TextStyle {
  return {
    fontSize: block.fontSize,
    fontFamily: block.fontFamily,
    fontWeight: block.fontWeight,
    textColor: block.textColor,
    bgColor: block.bgColor,
    bgOpacity: block.bgOpacity,
    borderRadius: block.borderRadius,
    paddingH: block.paddingH,
    paddingV: block.paddingV,
    align: block.align,
    lineGap: block.lineGap,
    lineHeight: block.lineHeight,
    maxWidth: block.maxWidth,
  };
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
    border: active ? `1px solid ${ADS_BRAND.gold}` : `1px solid ${ADS_BRAND.border2}`,
    background: active ? ADS_BRAND.gold : ADS_BRAND.panel3,
    color: active ? ADS_BRAND.bg : ADS_BRAND.text2,
    borderRadius: 6,
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

function approveButtonStyle(approved = false): React.CSSProperties {
  return {
    ...buttonStyle(false),
    border: approved ? `1px solid ${ADS_BRAND.success}` : `1px solid ${ADS_BRAND.border2}`,
    background: approved ? ADS_BRAND.success : ADS_BRAND.panel3,
    color: approved ? ADS_BRAND.successText : ADS_BRAND.text2,
  };
}

function segmentedButtonStyle(active = false): React.CSSProperties {
  return {
    width: 42,
    height: 34,
    border: "none",
    borderRadius: 4,
    background: active ? ADS_BRAND.active : "transparent",
    color: active ? ADS_BRAND.text : ADS_BRAND.text3,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

const panelStyle: React.CSSProperties = {
  background: ADS_BRAND.panel,
  border: `1px solid ${ADS_BRAND.border}`,
  borderRadius: 8,
  padding: 14,
  boxShadow: "0 16px 40px rgba(0,0,0,0.32)",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: ADS_BRAND.text3,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${ADS_BRAND.border2}`,
  background: ADS_BRAND.bg,
  color: ADS_BRAND.text,
  borderRadius: 6,
  padding: "8px 10px",
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
};

const homePanelStyle: React.CSSProperties = {
  border: `1px solid ${ADS_BRAND.border}`,
  borderRadius: 8,
  background: ADS_BRAND.panel,
  padding: 12,
};

const homeActionStyle: React.CSSProperties = {
  minHeight: 78,
  border: `1px solid ${ADS_BRAND.border}`,
  borderRadius: 8,
  background: ADS_BRAND.panel,
  color: ADS_BRAND.text,
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 9,
};

const folderButtonStyle: React.CSSProperties = {
  width: "100%",
  border: `1px solid ${ADS_BRAND.border}`,
  borderRadius: 8,
  background: ADS_BRAND.panel3,
  color: ADS_BRAND.text,
  cursor: "pointer",
  padding: 9,
  display: "flex",
  alignItems: "center",
  gap: 9,
  fontFamily: "inherit",
  textAlign: "left",
  marginBottom: 7,
};

const alignOptions = [
  { value: "left" as const, label: "Left", icon: AlignLeft },
  { value: "center" as const, label: "Center", icon: AlignCenter },
  { value: "right" as const, label: "Right", icon: AlignRight },
];

const HOME_FOLDERS = [
  { id: "tyson", name: "Tyson summer shred", count: 18, tone: "#82c5c5" },
  { id: "challenge", name: "Challenge launches", count: 9, tone: "#c9a96e" },
  { id: "raw", name: "Raw client media", count: 142, tone: "#7ec9a0" },
];

const HOME_SAMPLE_PROJECTS = [
  { id: "sample-tyson", name: "Tyson gym story ads", folder: "Tyson summer shred", ads: 30, media: "Photos + videos", updated: "Today", tone: "#82c5c5", approved: 22 },
  { id: "sample-keith", name: "Keith DM retargeting", folder: "Challenge launches", ads: 14, media: "Photos", updated: "Yesterday", tone: "#c9a96e", approved: 8 },
  { id: "sample-broll", name: "Summer b-roll cuts", folder: "Raw client media", ads: 0, media: "Videos", updated: "May 10", tone: "#7ec9a0", approved: 0 },
];

export default function Studio2Page() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copyText, setCopyText] = useState(DEFAULT_COPY);
  const [projectName, setProjectName] = useState("Studio 2.0 Batch");
  const [view, setView] = useState<StudioView>("home");
  const [colorPreset, setColorPreset] = useState<"dark" | "light">("dark");
  const [fontPreset, setFontPreset] = useState(FONT_OPTIONS[0].value);
  const [selectedLayer, setSelectedLayer] = useState<SelectedLayer>(null);
  const [viewScale, setViewScale] = useState(0.35);
  const [saveStatus, setSaveStatus] = useState("Autosave ready");
  const [exportStatus, setExportStatus] = useState("");
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [undoStack, setUndoStack] = useState<Creative[][]>([]);
  const [redoStack, setRedoStack] = useState<Creative[][]>([]);
  const [activeGuides, setActiveGuides] = useState<AlignmentGuides>({ x: [], y: [] });
  const [activeSafeZones, setActiveSafeZones] = useState<SafeZoneId[]>([]);
  const [canvasCursor, setCanvasCursor] = useState("default");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingOriginalLines, setEditingOriginalLines] = useState<string[] | null>(null);
  const [copiedStyle, setCopiedStyle] = useState<TextStyle | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFolderName, setExportFolderName] = useState(projectName);
  const [exportApprovedOnly, setExportApprovedOnly] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [selectedHomeProjects, setSelectedHomeProjects] = useState<string[]>([]);
  const [homeStatus, setHomeStatus] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const homeUploadInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const inlineEditRef = useRef<HTMLTextAreaElement>(null);
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
  const editingBlock = editingBlockId
    ? currentCreative?.textBlocks.find((block) => block.id === editingBlockId)
    : undefined;

  const getMeasureCtx = useCallback(() => {
    if (!measureCanvasRef.current) measureCanvasRef.current = document.createElement("canvas");
    return measureCanvasRef.current.getContext("2d")!;
  }, []);

  const currentImage = currentCreative
    ? imageCacheRef.current.get(currentCreative.photoUrl) ?? null
    : null;

  const hasActiveDraft =
    photos.length > 0 ||
    creatives.length > 0 ||
    projectName !== "Studio 2.0 Batch" ||
    copyText !== DEFAULT_COPY;
  const activeDraftCard = useMemo(
    () => ({
      id: "active-draft",
      name: projectName || "Untitled Studio batch",
      folder: "Active workspace",
      ads: creatives.length,
      media: `${photos.length} photo${photos.length === 1 ? "" : "s"}`,
      updated: saveStatus.replace("Saved ", "").replace("Restored ", "") || "Autosave ready",
      tone: ADS_BRAND.gold,
      approved: creatives.filter((creative) => creative.approved).length,
      thumb: currentCreative?.photoUrl || photos[0] || "",
      isActiveDraft: true,
    }),
    [creatives, currentCreative?.photoUrl, photos, projectName, saveStatus]
  );
  const homeProjects = useMemo(
    () => [
      ...(hasActiveDraft ? [activeDraftCard] : []),
      ...HOME_SAMPLE_PROJECTS.map((project) => ({ ...project, thumb: "", isActiveDraft: false })),
    ],
    [activeDraftCard, hasActiveDraft]
  );

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
        setCreatives((draft.creatives || []).map(normalizeCreative));
        setCurrentIndex(draft.currentIndex || 0);
        setCopyText(draft.copyText || DEFAULT_COPY);
        setProjectName(draft.projectName || "Studio 2.0 Batch");
        setColorPreset(draft.colorPreset || "dark");
        setFontPreset(draft.fontPreset || FONT_OPTIONS[0].value);
        setView("home");
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
      drawArtwork(ctx, currentCreative, currentImage, dpr, editingBlockId);
    } else {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = ADS_BRAND.bgDeep;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
    drawOverlay(overlayCtx, currentCreative, selectedLayer, activeGuides, activeSafeZones, getMeasureCtx(), dpr);
  }, [activeGuides, activeSafeZones, currentCreative, currentImage, selectedLayer, editingBlockId, getMeasureCtx]);

  useEffect(() => {
    renderPreview();
  }, [renderPreview, viewScale]);

  useEffect(() => {
    if (!editingBlockId) return;
    window.setTimeout(() => {
      inlineEditRef.current?.focus();
      inlineEditRef.current?.select();
    }, 0);
  }, [editingBlockId]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const close = () => setCreateMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [createMenuOpen]);

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
      const config = {
        title: { fontSize: 72, x: 90, maxWidth: 900, paddingH: 32, paddingV: 18, borderRadius: 18, lineGap: 6 },
        body: { fontSize: 44, x: 80, maxWidth: 960, paddingH: 24, paddingV: 14, borderRadius: 14, lineGap: 5 },
        callout: { fontSize: 52, x: 90, maxWidth: 900, paddingH: 28, paddingV: 16, borderRadius: 16, lineGap: 6 },
        cta: { fontSize: 56, x: 90, maxWidth: 900, paddingH: 28, paddingV: 18, borderRadius: 16, lineGap: 6 },
      }[role];
      return {
        id: uid(),
        lines,
        x: config.x,
        y: 80,
        fontSize: config.fontSize,
        fontFamily: fontPreset,
        fontWeight: isSerif ? 400 : 700,
        textColor: isLight ? "#000000" : "#ffffff",
        bgColor: isLight ? "#ffffff" : "#000000",
        bgOpacity: 1,
        borderRadius: config.borderRadius,
        paddingH: config.paddingH,
        paddingV: config.paddingV,
        align: role === "body" ? "left" : "center",
        lineGap: config.lineGap,
        lineHeight: 1.5,
        maxWidth: config.maxWidth,
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
        const align = index === 0 || index === blocks.length - 1 ? "center" as TextAlign : "left" as TextAlign;
        const next = {
          ...block,
          x: align === "center" ? Math.round((CANVAS_W - block.maxWidth) / 2) : block.x,
          y: Math.round(y),
          align,
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

  const replaceCurrentImage = useCallback(
    async (file: File | null) => {
      if (!file || !currentCreative) return;
      const url = await fileToDataUrl(file);
      pushUndo();
      setPhotos((prev) => (prev.includes(url) ? prev : [...prev, url]));
      updateCurrentCreative((creative) => ({
        ...creative,
        photoUrl: url,
        imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
      }));
      setSelectedLayer({ type: "image" });
      setContextMenu(null);
    },
    [currentCreative, pushUndo, updateCurrentCreative]
  );

  const duplicateSelectedBlock = useCallback(() => {
    if (!selectedBlock) return;
    pushUndo();
    const copy = {
      ...selectedBlock,
      id: uid(),
      x: clamp(selectedBlock.x + 36, -160, CANVAS_W - 120),
      y: clamp(selectedBlock.y + 36, -160, CANVAS_H - 120),
      lines: [...selectedBlock.lines],
    };
    updateCurrentCreative((creative) => ({
      ...creative,
      textBlocks: [...creative.textBlocks, copy],
    }));
    setSelectedLayer({ type: "text", id: copy.id });
    setContextMenu(null);
  }, [pushUndo, selectedBlock, updateCurrentCreative]);

  const deleteSelectedBlock = useCallback(() => {
    if (!selectedBlock) return;
    pushUndo();
    updateCurrentCreative((creative) => ({
      ...creative,
      textBlocks: creative.textBlocks.filter((block) => block.id !== selectedBlock.id),
    }));
    setSelectedLayer(null);
    setContextMenu(null);
  }, [pushUndo, selectedBlock, updateCurrentCreative]);

  const copySelectedStyle = useCallback(() => {
    if (!selectedBlock) return;
    setCopiedStyle(getTextStyle(selectedBlock));
    setContextMenu(null);
  }, [selectedBlock]);

  const pasteCopiedStyle = useCallback(() => {
    if (!selectedBlock || !copiedStyle) return;
    pushUndo();
    updateSelectedBlock(copiedStyle);
    setContextMenu(null);
  }, [copiedStyle, pushUndo, selectedBlock, updateSelectedBlock]);

  const positionSelectedBlock = useCallback(
    (position: "center-x" | "center-y" | "top" | "bottom") => {
      if (!selectedBlock) return;
      pushUndo();
      const metrics = measureTextBlock(getMeasureCtx(), selectedBlock);
      const updates: Partial<TextBlock> = {};
      if (position === "center-x") updates.x = Math.round((CANVAS_W - selectedBlock.maxWidth) / 2);
      if (position === "center-y") updates.y = Math.round((CANVAS_H - metrics.h) / 2);
      if (position === "top") updates.y = 210;
      if (position === "bottom") updates.y = Math.round(CANVAS_H - metrics.h - 360);
      updateSelectedBlock(updates);
      setContextMenu(null);
    },
    [getMeasureCtx, pushUndo, selectedBlock, updateSelectedBlock]
  );

  const moveSelectedLayer = useCallback(
    (direction: "front" | "back" | "forward" | "backward") => {
      if (!selectedBlock) return;
      pushUndo();
      updateCurrentCreative((creative) => {
        const index = creative.textBlocks.findIndex((block) => block.id === selectedBlock.id);
        if (index < 0) return creative;
        const blocks = [...creative.textBlocks];
        const [block] = blocks.splice(index, 1);
        if (!block) return creative;
        let nextIndex = index;
        if (direction === "front") nextIndex = blocks.length;
        if (direction === "back") nextIndex = 0;
        if (direction === "forward") nextIndex = clamp(index + 1, 0, blocks.length);
        if (direction === "backward") nextIndex = clamp(index - 1, 0, blocks.length);
        blocks.splice(nextIndex, 0, block);
        return { ...creative, textBlocks: blocks };
      });
      setContextMenu(null);
    },
    [pushUndo, selectedBlock, updateCurrentCreative]
  );

  const toggleCurrentApproved = useCallback(() => {
    if (!currentCreative) return;
    setCreatives((prev) =>
      prev.map((creative, index) =>
        index === currentIndex ? { ...creative, approved: !creative.approved } : creative
      )
    );
  }, [currentCreative, currentIndex]);

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

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
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

  const getHoverCursor = useCallback(
    (point: { x: number; y: number }) => {
      if (!currentCreative) return "default";
      const ctx = getMeasureCtx();

      if (selectedLayer?.type === "text") {
        const block = currentCreative.textBlocks.find((b) => b.id === selectedLayer.id);
        if (block) {
          const metrics = measureTextBlock(ctx, block);
          const handle = hitTextHandle(point, metrics);
          if (handle) return cursorForResizeHandle(handle);
          if (pointInMetrics(point, metrics)) return "grab";
        }
      }

      if (selectedLayer?.type === "image") {
        const handle = hitImageHandle(point);
        if (handle) return cursorForResizeHandle(handle);
      }

      for (let i = currentCreative.textBlocks.length - 1; i >= 0; i--) {
        const metrics = measureTextBlock(ctx, currentCreative.textBlocks[i]);
        if (pointInMetrics(point, metrics)) return "grab";
      }

      return "grab";
    },
    [currentCreative, getMeasureCtx, selectedLayer]
  );

  const startInlineEdit = useCallback(
    (block: TextBlock) => {
      if (block.locked) return;
      pushUndo();
      setEditingBlockId(block.id);
      setEditingText(block.lines.join("\n"));
      setEditingOriginalLines([...block.lines]);
      setSelectedLayer({ type: "text", id: block.id });
      setContextMenu(null);
    },
    [pushUndo]
  );

  const commitInlineEdit = useCallback(() => {
    setEditingBlockId(null);
    setEditingOriginalLines(null);
  }, []);

  const cancelInlineEdit = useCallback(() => {
    if (editingBlockId && editingOriginalLines) {
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          block.id === editingBlockId ? { ...block, lines: editingOriginalLines } : block
        ),
      }));
    }
    setEditingBlockId(null);
    setEditingOriginalLines(null);
  }, [editingBlockId, editingOriginalLines, updateCurrentCreative]);

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!currentCreative) return;
      const point = pointFromEvent(event);
      const hit = findHitBlock(point);
      if (hit) startInlineEdit(hit);
    },
    [currentCreative, findHitBlock, startInlineEdit]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      if (!currentCreative) return;
      event.preventDefault();
      const point = pointFromEvent(event);
      const hit = findHitBlock(point);
      const target: SelectedLayer = hit ? { type: "text", id: hit.id } : { type: "image" };
      setSelectedLayer(target);
      setContextMenu({ x: event.clientX, y: event.clientY, target });
    },
    [currentCreative, findHitBlock]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (event.button !== 0) return;
      if (!currentCreative) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const point = pointFromEvent(event);
      const ctx = getMeasureCtx();
      setActiveGuides({ x: [], y: [] });
      setActiveSafeZones([]);

      if (selectedLayer?.type === "text") {
        const block = currentCreative.textBlocks.find((b) => b.id === selectedLayer.id);
        if (block && !block.locked) {
          const metrics = measureTextBlock(ctx, block);
          const handle = hitTextHandle(point, metrics);
          if (handle) {
            dragRef.current = {
              kind: "resize-text",
              active: false,
              blockId: block.id,
              handle,
              startX: point.x,
              startY: point.y,
              orig: { ...block, lines: [...block.lines] },
              origMetrics: metrics,
            };
            setCanvasCursor(cursorForResizeHandle(handle));
            return;
          }
        }
      }

      const imageHandle = selectedLayer?.type === "image" ? hitImageHandle(point) : null;
      if (imageHandle) {
        dragRef.current = {
          kind: "resize-image",
          active: false,
          startX: point.x,
          startY: point.y,
          orig: { ...currentCreative.imageTransform },
          startDistance: Math.max(1, Math.hypot(point.x - CANVAS_W / 2, point.y - CANVAS_H / 2)),
        };
        setCanvasCursor(cursorForResizeHandle(imageHandle));
        return;
      }

      const hit = findHitBlock(point);
      if (hit) {
        setSelectedLayer({ type: "text", id: hit.id });
        if (!hit.locked) {
          dragRef.current = {
            kind: "move-text",
            active: false,
            blockId: hit.id,
            startX: point.x,
            startY: point.y,
            origX: hit.x,
            origY: hit.y,
            origMetrics: measureTextBlock(ctx, hit),
          };
          setCanvasCursor("grabbing");
        }
        return;
      }

      setSelectedLayer({ type: "image" });
      dragRef.current = {
        kind: "move-image",
        active: false,
        startX: point.x,
        startY: point.y,
        orig: { ...currentCreative.imageTransform },
      };
      setCanvasCursor("grabbing");
    },
    [currentCreative, findHitBlock, getMeasureCtx, selectedLayer]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag) {
        const point = pointFromEvent(event);
        const nextCursor = getHoverCursor(point);
        setCanvasCursor((current) => (current === nextCursor ? current : nextCursor));
        return;
      }
      event.preventDefault();
      const point = pointFromEvent(event);
      const dx = point.x - drag.startX;
      const dy = point.y - drag.startY;

      if (!drag.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.active = true;
        pushUndo();
      }

      if (drag.kind === "move-text") {
        const rawX = drag.origX + dx;
        const rawY = drag.origY + dy;
        const snapped = currentCreative
          ? snapTextPosition(rawX, rawY, drag.origMetrics, drag.blockId, currentCreative, getMeasureCtx())
          : { x: Math.round(rawX), y: Math.round(rawY), guides: { x: [], y: [] } };
        setActiveGuides(snapped.guides);
        setActiveSafeZones(getSafeZoneHits(snapped.x, snapped.y, drag.origMetrics));
        setCanvasCursor("grabbing");
        updateCurrentCreative((creative) => ({
          ...creative,
          textBlocks: creative.textBlocks.map((block) =>
            block.id === drag.blockId
              ? {
                  ...block,
                  x: snapped.x,
                  y: snapped.y,
                }
              : block
          ),
        }));
      }

      if (drag.kind === "resize-text") {
        setActiveGuides({ x: [], y: [] });
        setActiveSafeZones([]);
        setCanvasCursor(cursorForResizeHandle(drag.handle));
        const handle = drag.handle;
        const isCorner = handle.length === 2;
        const ctx = getMeasureCtx();
        let maxWidth = drag.orig.maxWidth;
        let fontSize = drag.orig.fontSize;
        let paddingH = drag.orig.paddingH;
        let paddingV = drag.orig.paddingV;
        let borderRadius = drag.orig.borderRadius;
        let x = drag.orig.x;
        let y = drag.orig.y;

        if (isCorner) {
          const nextW = Math.max(80, drag.origMetrics.w + (handle.includes("e") ? dx : -dx));
          const nextH = Math.max(40, drag.origMetrics.h + (handle.includes("s") ? dy : -dy));
          const widthFactor = nextW / Math.max(1, drag.origMetrics.w);
          const heightFactor = nextH / Math.max(1, drag.origMetrics.h);
          const factor = clamp((widthFactor + heightFactor) / 2, 0.35, 2.6);
          maxWidth = clamp(Math.round(drag.orig.maxWidth * factor), 220, 1060);
          fontSize = clamp(Math.round(drag.orig.fontSize * factor), 14, 150);
          paddingH = clamp(Math.round(drag.orig.paddingH * factor), 0, 90);
          paddingV = clamp(Math.round(drag.orig.paddingV * factor), 0, 90);
          borderRadius = clamp(Math.round(drag.orig.borderRadius * factor), 0, 60);

          const resized = { ...drag.orig, maxWidth, fontSize, paddingH, paddingV, borderRadius };
          const resizedH = measureTextBlock(ctx, resized).h;
          if (handle.includes("w")) x = Math.round(drag.orig.x + drag.orig.maxWidth - maxWidth);
          if (handle.includes("n")) y = Math.round(drag.orig.y + drag.origMetrics.h - resizedH);
        } else {
          maxWidth = clamp(
            Math.round(drag.orig.maxWidth + (handle === "e" ? dx : -dx)),
            220,
            1060
          );
          if (handle === "w") x = Math.round(drag.orig.x + drag.orig.maxWidth - maxWidth);
        }

        updateCurrentCreative((creative) => ({
          ...creative,
          textBlocks: creative.textBlocks.map((block) =>
            block.id === drag.blockId
              ? { ...block, x, y, maxWidth, fontSize, paddingH, paddingV, borderRadius }
              : block
          ),
        }));
      }

      if (drag.kind === "move-image") {
        setActiveGuides({ x: [], y: [] });
        setActiveSafeZones([]);
        setCanvasCursor("grabbing");
        updateImage({
          offsetX: Math.round(drag.orig.offsetX + dx),
          offsetY: Math.round(drag.orig.offsetY + dy),
        });
      }

      if (drag.kind === "resize-image") {
        setActiveGuides({ x: [], y: [] });
        setActiveSafeZones([]);
        setCanvasCursor("nwse-resize");
        const nextDistance = Math.max(1, Math.hypot(point.x - CANVAS_W / 2, point.y - CANVAS_H / 2));
        updateImage({
          scale: clamp(parseFloat((drag.orig.scale * (nextDistance / drag.startDistance)).toFixed(3)), 0.4, 4),
        });
      }
    },
    [currentCreative, getHoverCursor, getMeasureCtx, pushUndo, updateCurrentCreative, updateImage]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setActiveGuides({ x: [], y: [] });
    setActiveSafeZones([]);
    setCanvasCursor("default");
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

      if (!typing && meta && event.key.toLowerCase() === "d" && selectedLayer?.type === "text") {
        event.preventDefault();
        duplicateSelectedBlock();
        return;
      }

      if (event.key === "Escape") {
        setContextMenu(null);
      }

      if (!typing && selectedLayer?.type === "text" && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedBlock();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteSelectedBlock, duplicateSelectedBlock, redo, selectedLayer, undo, view]);

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

  const exportAll = useCallback(async (folderLabel?: string, approvedOnly = false) => {
    const creativesToExport = approvedOnly
      ? creatives.filter((creative) => creative.approved)
      : creatives;
    if (!creativesToExport.length) {
      setExportStatus(approvedOnly ? "No approved ads yet." : "");
      window.setTimeout(() => setExportStatus(""), 1600);
      return;
    }
    setExportModalOpen(false);
    setExportStatus(`Exporting 1 of ${creativesToExport.length}...`);
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const baseName = (folderLabel || projectName || "Studio 2.0 Ads").trim();
    const folderName = `${baseName} - ${new Date()
      .toISOString()
      .slice(0, 16)
      .replace("T", " ")
      .replace(":", "-")}`;
    const folder = zip.folder(folderName)!;

    for (let i = 0; i < creativesToExport.length; i++) {
      setExportStatus(`Exporting ${i + 1} of ${creativesToExport.length}...`);
      const canvas = await renderCreativeToCanvas(creativesToExport[i], 2);
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

  const handleCanvasDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
      if (file) await replaceCurrentImage(file);
    },
    [replaceCurrentImage]
  );

  const openExportModal = useCallback(() => {
    setExportFolderName(projectName || "Studio 2.0 Ads");
    setExportApprovedOnly(false);
    setExportModalOpen(true);
  }, [projectName]);

  const openSetupFlow = useCallback(() => {
    setCreateMenuOpen(false);
    setHomeStatus("");
    setView("setup");
  }, []);

  const openHomeProject = useCallback(
    (projectId: string) => {
      if (projectId === "active-draft") {
        setView(creatives.length ? "editor" : "setup");
        return;
      }
      const project = HOME_SAMPLE_PROJECTS.find((item) => item.id === projectId);
      setHomeStatus(`${project?.name || "Project"} is a UI preview until project storage is wired.`);
    },
    [creatives.length]
  );

  const toggleHomeProject = useCallback((projectId: string) => {
    setSelectedHomeProjects((selected) =>
      selected.includes(projectId)
        ? selected.filter((id) => id !== projectId)
        : [...selected, projectId]
    );
  }, []);

  const downloadSelectedProjects = useCallback(async () => {
    if (!selectedHomeProjects.length) return;
    const includesActiveDraft = selectedHomeProjects.includes("active-draft");
    const selectedSamples = selectedHomeProjects.filter((id) => id !== "active-draft").length;

    if (includesActiveDraft && creatives.length) {
      await exportAll(projectName, false);
    } else if (includesActiveDraft) {
      setHomeStatus("Open the batch setup and generate ads before downloading this draft.");
      setView("setup");
      return;
    }

    if (selectedSamples) {
      setHomeStatus("Saved project downloads will turn on when the Supabase/R2 project library is wired.");
    }
  }, [creatives.length, exportAll, projectName, selectedHomeProjects]);

  if (view === "home") {
    const selectedCount = selectedHomeProjects.length;
    const totalAds = creatives.length || HOME_SAMPLE_PROJECTS.reduce((sum, project) => sum + project.ads, 0);

    return (
      <div className="fade-up" style={{ paddingBottom: 40 }}>
        <style>{`
          .studio2-home-action:hover,
          .studio2-project-card:hover,
          .studio2-folder-card:hover {
            border-color: ${ADS_BRAND.border2};
            background: ${ADS_BRAND.panel2};
            transform: translateY(-1px);
          }
          .studio2-project-card:hover .studio2-project-select,
          .studio2-project-select[data-selected="true"] {
            opacity: 1;
          }
          .studio2-project-title {
            border: 1px solid transparent;
          }
          .studio2-project-title:hover,
          .studio2-project-title:focus {
            border-color: ${ADS_BRAND.border2};
            background: ${ADS_BRAND.bg};
          }
          .studio2-create-menu button:hover {
            background: ${ADS_BRAND.panel2};
          }
        `}</style>

        <input
          ref={homeUploadInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = "";
            setView("setup");
          }}
        />

        <div className="page-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 18 }}>
          <div>
            <h1 className="page-title">Studio 2.0</h1>
            <p className="page-subtitle">Projects, folders, media, and Canva-style batch creation.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
            <button
              style={buttonStyle(false)}
              disabled={!selectedCount}
              onClick={() => void downloadSelectedProjects()}
            >
              <Download size={14} /> Download{selectedCount ? ` ${selectedCount}` : ""}
            </button>
            <button
              style={{ ...buttonStyle(true), padding: "10px 14px" }}
              onClick={(event) => {
                event.stopPropagation();
                setCreateMenuOpen((open) => !open);
              }}
            >
              <Plus size={16} /> Create <ChevronDown size={14} />
            </button>
            {createMenuOpen && (
              <div
                className="studio2-create-menu"
                onClick={(event) => event.stopPropagation()}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 46,
                  width: 238,
                  zIndex: 10,
                  padding: 7,
                  borderRadius: 8,
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.panel,
                  boxShadow: "0 22px 70px rgba(0,0,0,0.45)",
                }}
              >
                <HomeMenuButton icon={FilePlus2} label="New batch of ads" onClick={openSetupFlow} />
                <HomeMenuButton
                  icon={ImagePlus}
                  label="Upload photos"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    homeUploadInputRef.current?.click();
                  }}
                />
                <HomeMenuButton
                  icon={FolderPlus}
                  label="Create folder"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setHomeStatus("Folder creation is shown in the UI and will save when the project library is wired.");
                  }}
                />
                <HomeMenuButton
                  icon={Video}
                  label="Upload videos"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setHomeStatus("Video upload is planned for the R2 media library build.");
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="section" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 280px", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
            <button className="studio2-home-action" onClick={openSetupFlow} style={homeActionStyle}>
              <FilePlus2 size={20} color={ADS_BRAND.gold} />
              <span>New batch of ads</span>
            </button>
            <button className="studio2-home-action" onClick={() => homeUploadInputRef.current?.click()} style={homeActionStyle}>
              <Upload size={20} color={ADS_BRAND.gold} />
              <span>Upload photos</span>
            </button>
            <button
              className="studio2-home-action"
              onClick={() => setHomeStatus("Video cards are ready visually. R2 video upload/export wiring comes next.")}
              style={homeActionStyle}
            >
              <Film size={20} color={ADS_BRAND.gold} />
              <span>Video project</span>
            </button>
          </div>

          <div style={{
            border: `1px solid ${ADS_BRAND.border}`,
            borderRadius: 8,
            background: ADS_BRAND.panel,
            padding: 12,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}>
            <HomeStat label="Projects" value={homeProjects.length} />
            <HomeStat label="Ads" value={totalAds} />
            <HomeStat label="Selected" value={selectedCount} />
            <HomeStat label="Autosave" value={saveStatus.startsWith("Saved") || saveStatus.startsWith("Restored") ? "On" : "Ready"} />
          </div>
        </div>

        {homeStatus && (
          <div className="section" style={{ marginTop: -4 }}>
            <div style={{
              border: `1px solid ${ADS_BRAND.goldBorder}`,
              background: ADS_BRAND.goldSoft,
              color: ADS_BRAND.text2,
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 13,
            }}>
              {homeStatus}
            </div>
          </div>
        )}

        {restoredAt && (
          <div className="section" style={{ marginTop: homeStatus ? 10 : -4 }}>
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
                  setProjectName("Studio 2.0 Batch");
                  setSelectedHomeProjects([]);
                  setRestoredAt(null);
                  setSaveStatus("Draft cleared");
                }}
              >
                Start Fresh
              </button>
            </div>
          </div>
        )}

        <div className="section" style={{ display: "grid", gridTemplateColumns: "250px minmax(0, 1fr)", gap: 18 }}>
          <aside style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={homePanelStyle}>
              <div style={{ ...labelStyle, marginBottom: 10 }}>
                <Folder size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
                Folders
              </div>
              {HOME_FOLDERS.map((folder) => (
                <button key={folder.id} className="studio2-folder-card" style={folderButtonStyle}>
                  <span style={{
                    width: 28,
                    height: 28,
                    borderRadius: 7,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: `${folder.tone}1A`,
                    color: folder.tone,
                    flexShrink: 0,
                  }}>
                    <Folder size={15} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", color: ADS_BRAND.text, fontSize: 13, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {folder.name}
                    </span>
                    <span style={{ display: "block", color: ADS_BRAND.text3, fontSize: 11, marginTop: 2 }}>{folder.count} items</span>
                  </span>
                </button>
              ))}
              <button
                className="studio2-folder-card"
                onClick={() => setHomeStatus("Folder creation is a visual prototype until the project library is wired.")}
                style={{ ...folderButtonStyle, borderStyle: "dashed", color: ADS_BRAND.text2 }}
              >
                <FolderPlus size={15} />
                New folder
              </button>
            </div>

            <div style={homePanelStyle}>
              <div style={{ ...labelStyle, marginBottom: 10 }}>
                <HardDrive size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
                Media Bank
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                <HomeMediaRow icon={ImagePlus} label="Photos" value={photos.length || 284} />
                <HomeMediaRow icon={Film} label="Videos" value={96} />
                <HomeMediaRow icon={CheckCircle2} label="Approved ads" value={creatives.filter((creative) => creative.approved).length || 30} />
              </div>
            </div>
          </aside>

          <main>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div>
                <h2 className="section-title" style={{ marginBottom: 2 }}>
                  <Grid3X3 size={16} /> Projects
                </h2>
                <div style={{ color: ADS_BRAND.text3, fontSize: 12 }}>Recent Studio workspaces</div>
              </div>
              <label style={{
                width: 250,
                height: 38,
                border: `1px solid ${ADS_BRAND.border}`,
                borderRadius: 8,
                background: ADS_BRAND.panel,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 10px",
                color: ADS_BRAND.text3,
              }}>
                <Search size={14} />
                <input
                  placeholder="Search projects"
                  style={{
                    width: "100%",
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: ADS_BRAND.text,
                    fontFamily: "inherit",
                    fontSize: 12,
                  }}
                />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(215px, 1fr))", gap: 14 }}>
              {homeProjects.map((project) => {
                const selected = selectedHomeProjects.includes(project.id);
                return (
                  <div
                    key={project.id}
                    className="studio2-project-card"
                    onClick={() => openHomeProject(project.id)}
                    style={{
                      position: "relative",
                      border: `1px solid ${selected ? ADS_BRAND.goldBorder : ADS_BRAND.border}`,
                      background: selected ? ADS_BRAND.goldSoft : ADS_BRAND.panel,
                      borderRadius: 8,
                      overflow: "hidden",
                      cursor: "pointer",
                      minHeight: 260,
                    }}
                  >
                    <button
                      aria-label={selected ? "Deselect project" : "Select project"}
                      className="studio2-project-select"
                      data-selected={selected}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleHomeProject(project.id);
                      }}
                      style={{
                        position: "absolute",
                        top: 10,
                        left: 10,
                        zIndex: 2,
                        width: 26,
                        height: 26,
                        borderRadius: 6,
                        border: `1px solid ${selected ? ADS_BRAND.gold : "rgba(255,255,255,0.24)"}`,
                        background: selected ? ADS_BRAND.gold : "rgba(0,0,0,0.45)",
                        color: selected ? ADS_BRAND.bgDeep : "#fff",
                        opacity: selected ? 1 : 0,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      {selected && <Check size={16} />}
                    </button>
                    <button
                      aria-label="Project options"
                      onClick={(event) => {
                        event.stopPropagation();
                        setHomeStatus(`${project.name} options menu is shown in the design pass.`);
                      }}
                      style={{
                        position: "absolute",
                        top: 10,
                        right: 10,
                        zIndex: 2,
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        border: "none",
                        background: "rgba(0,0,0,0.46)",
                        color: "#fff",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                    <div style={{
                      height: 142,
                      background: project.thumb
                        ? ADS_BRAND.bgDeep
                        : `linear-gradient(135deg, ${project.tone}33, rgba(255,255,255,0.04) 42%, ${ADS_BRAND.bgDeep})`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                      overflow: "hidden",
                    }}>
                      {project.thumb ? (
                        <img src={project.thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <span style={{ color: project.tone, fontSize: 34, fontWeight: 900, letterSpacing: 0 }}>
                          {project.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}
                        </span>
                      )}
                      <div style={{
                        position: "absolute",
                        left: 12,
                        bottom: 10,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        borderRadius: 999,
                        padding: "5px 8px",
                        background: "rgba(0,0,0,0.58)",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 750,
                      }}>
                        {project.media.includes("Video") || project.media.includes("videos") ? <Film size={12} /> : <ImagePlus size={12} />}
                        {project.media}
                      </div>
                    </div>
                    <div style={{ padding: 12 }}>
                      {project.isActiveDraft ? (
                        <input
                          className="studio2-project-title"
                          value={projectName}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) => setProjectName(event.target.value)}
                          style={{
                            width: "100%",
                            height: 30,
                            borderRadius: 6,
                            background: "transparent",
                            color: ADS_BRAND.text,
                            fontFamily: "inherit",
                            fontSize: 14,
                            fontWeight: 850,
                            outline: "none",
                            padding: "0 6px",
                          }}
                        />
                      ) : (
                        <div style={{ color: ADS_BRAND.text, fontSize: 14, fontWeight: 850, lineHeight: 1.25, minHeight: 35 }}>
                          {project.name}
                        </div>
                      )}
                      <div style={{ color: ADS_BRAND.text3, fontSize: 11, marginTop: 7, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {project.folder}
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                        <ProjectMetric label="Ads" value={project.ads} />
                        <ProjectMetric label="Approved" value={project.approved} />
                      </div>
                      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", color: ADS_BRAND.text3, fontSize: 11 }}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                          <Clock3 size={12} /> {project.updated}
                        </span>
                        {project.isActiveDraft && (
                          <span style={{ color: ADS_BRAND.gold, fontWeight: 800 }}>
                            {creatives.length ? "Open editor" : "Open setup"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </main>
        </div>
      </div>
    );
  }

  if (view === "setup") {
    return (
      <div className="fade-up" style={{ paddingBottom: 40 }}>
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
          <div>
            <h1 className="page-title">Studio 2.0</h1>
            <p className="page-subtitle">
              A new canvas-first ad builder where preview and export use the same renderer.
            </p>
          </div>
          <button style={buttonStyle(false)} onClick={() => setView("home")}>
            <Grid3X3 size={14} /> Home
          </button>
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
                  <div key={`${photo.slice(0, 24)}-${index}`} style={{ position: "relative", aspectRatio: "9 / 16", borderRadius: 7, overflow: "hidden", background: ADS_BRAND.bgDeep }}>
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

  const editingMetrics = editingBlock ? measureTextBlock(getMeasureCtx(), editingBlock) : null;
  const approvedCount = creatives.filter((creative) => creative.approved).length;

  return (
    <div className="ad-studio-fullbleed" style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <style>{`
        .studio2-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 999px;
          outline: none;
          cursor: pointer;
        }
        .studio2-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: #ffffff;
          border: 3px solid ${ADS_BRAND.gold};
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        }
        .studio2-range::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: #ffffff;
          border: 3px solid ${ADS_BRAND.gold};
          box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        }
      `}</style>
      <input
        ref={replaceImageInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(event) => {
          void replaceCurrentImage(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <div style={{
        height: 58,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
        borderBottom: `1px solid ${ADS_BRAND.border}`,
        background: ADS_BRAND.bg,
      }}>
        <button style={buttonStyle(false)} onClick={() => setView("home")}>
          <Grid3X3 size={14} /> Home
        </button>
        <button style={buttonStyle(false)} onClick={() => setView("setup")}>
          <ArrowLeft size={14} /> Setup
        </button>
        <div style={{ height: 24, width: 1, background: ADS_BRAND.border2 }} />
        <strong style={{ color: "var(--text-primary)", fontSize: 14 }}>{projectName}</strong>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Ad {currentIndex + 1} of {creatives.length}</span>
        <span style={{ color: ADS_BRAND.gold, fontSize: 11, fontWeight: 700, marginLeft: 4 }}>
          {saveStatus}
        </span>
        <div style={{ flex: 1 }} />
        <input
          className="studio2-range"
          type="range"
          min={18}
          max={70}
          value={Math.round(viewScale * 100)}
          onChange={(e) => setViewScale(parseInt(e.target.value) / 100)}
          style={{
            width: 96,
            background: `linear-gradient(90deg, ${ADS_BRAND.gold} 0%, ${ADS_BRAND.gold} ${Math.round(((viewScale * 100 - 18) / 52) * 100)}%, ${ADS_BRAND.border2} ${Math.round(((viewScale * 100 - 18) / 52) * 100)}%, ${ADS_BRAND.border2} 100%)`,
          }}
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
        <button
          aria-pressed={!!currentCreative?.approved}
          style={approveButtonStyle(!!currentCreative?.approved)}
          onClick={toggleCurrentApproved}
        >
          <CheckCircle2 size={14} /> {currentCreative?.approved ? "Approved" : "Approve"}
        </button>
        <button style={buttonStyle(true)} onClick={openExportModal}>
          <Download size={14} /> Export All
        </button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          ref={canvasAreaRef}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleCanvasDrop}
          style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: ADS_BRAND.bg,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
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
            background: ADS_BRAND.bgDeep,
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
              onDoubleClick={handleDoubleClick}
              onContextMenu={handleContextMenu}
              onPointerLeave={() => {
                if (!dragRef.current) setCanvasCursor("default");
              }}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                touchAction: "none",
                cursor: canvasCursor,
              }}
            />
            {editingBlock && editingMetrics && (
              <textarea
                ref={inlineEditRef}
                value={editingText}
                onChange={(event) => {
                  const next = event.target.value;
                  setEditingText(next);
                  updateCurrentCreative((creative) => ({
                    ...creative,
                    textBlocks: creative.textBlocks.map((block) =>
                      block.id === editingBlock.id ? { ...block, lines: next.split("\n") } : block
                    ),
                  }));
                }}
                onBlur={commitInlineEdit}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelInlineEdit();
                  }
                  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "enter") {
                    event.preventDefault();
                    commitInlineEdit();
                  }
                }}
                spellCheck={false}
                style={{
                  position: "absolute",
                  left: editingMetrics.x * viewScale,
                  top: editingMetrics.y * viewScale,
                  width: editingMetrics.w * viewScale,
                  minHeight: Math.max(editingMetrics.h * viewScale, editingBlock.fontSize * viewScale * 2.1),
                  border: `${Math.max(1, 2 * viewScale)}px solid ${ADS_BRAND.gold}`,
                  boxShadow: "0 0 0 3px rgba(212,178,122,0.18), 0 10px 26px rgba(0,0,0,0.28)",
                  borderRadius: Math.max(6, editingBlock.borderRadius * viewScale),
                  background: "transparent",
                  color: editingBlock.textColor,
                  fontFamily: editingBlock.fontFamily,
                  fontSize: editingBlock.fontSize * viewScale,
                  fontWeight: editingBlock.fontWeight,
                  lineHeight: editingBlock.lineHeight,
                  padding: `${editingBlock.paddingV * viewScale}px ${editingBlock.paddingH * viewScale}px`,
                  textAlign: editingBlock.align,
                  resize: "none",
                  overflow: "hidden",
                  outline: "none",
                  zIndex: 3,
                }}
              />
            )}
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
                  position: "relative",
                  width: 42,
                  height: 74,
                  borderRadius: 6,
                  overflow: "hidden",
                  border: index === currentIndex ? `2px solid ${ADS_BRAND.gold}` : `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.bgDeep,
                  padding: 0,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
                title={`Ad ${index + 1}`}
              >
                <img src={creative.photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                {creative.approved && (
                  <span style={{
                    position: "absolute",
                    right: 2,
                    bottom: 2,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: ADS_BRAND.success,
                    color: ADS_BRAND.successText,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}>
                    <CheckCircle2 size={12} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <aside style={{
          width: 326,
          flexShrink: 0,
          borderLeft: `1px solid ${ADS_BRAND.border}`,
          background: ADS_BRAND.bg,
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ color: ADS_BRAND.text2, fontSize: 12 }}>
                {selectedBlock ? "Text block" : selectedLayer?.type === "image" ? "Background image" : "Nothing selected"}
              </span>
              <span style={{
                border: `1px solid ${ADS_BRAND.goldBorder}`,
                background: ADS_BRAND.goldSoft,
                color: ADS_BRAND.gold,
                borderRadius: 999,
                padding: "4px 8px",
                fontSize: 10,
                fontWeight: 800,
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}>
                Canvas
              </span>
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
                <span style={{ color: ADS_BRAND.text3, fontSize: 11 }}>text / highlight</span>
              </Control>
              <Control label="Align">
                <div style={{
                  display: "inline-flex",
                  gap: 3,
                  padding: 3,
                  borderRadius: 8,
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.panel3,
                }}>
                  {alignOptions.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      aria-label={`Align ${label}`}
                      title={`Align ${label}`}
                      style={segmentedButtonStyle(selectedBlock.align === value)}
                      onClick={() => {
                        pushUndo();
                        updateSelectedBlock({ align: value });
                      }}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                </div>
              </Control>
              <Control label="Position">
                <button style={buttonStyle(false)} onClick={() => positionSelectedBlock("center-x")}>Center X</button>
                <button style={buttonStyle(false)} onClick={() => positionSelectedBlock("center-y")}>Center Y</button>
              </Control>
              <Control label="Layer">
                <button style={buttonStyle(false)} onClick={() => moveSelectedLayer("front")}>
                  <BringToFront size={13} /> Front
                </button>
                <button style={buttonStyle(false)} onClick={() => moveSelectedLayer("back")}>
                  <SendToBack size={13} /> Back
                </button>
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
                onClick={() => replaceImageInputRef.current?.click()}
              >
                <Replace size={13} /> Replace Image
              </button>
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

          <div style={{ color: ADS_BRAND.text4, fontSize: 11, lineHeight: 1.5, padding: "2px 2px 10px" }}>
            Studio 2.0 saves locally in this browser. It can recover your work after refresh or Wi-Fi loss.
          </div>
        </aside>
      </div>
      {contextMenu && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            position: "fixed",
            left: typeof window === "undefined" ? contextMenu.x : Math.min(contextMenu.x, window.innerWidth - 292),
            top: typeof window === "undefined" ? contextMenu.y : Math.min(contextMenu.y, window.innerHeight - 470),
            width: 276,
            padding: 8,
            borderRadius: 12,
            border: `1px solid ${ADS_BRAND.border2}`,
            background: ADS_BRAND.panel,
            boxShadow: "0 28px 80px rgba(0,0,0,0.5)",
            zIndex: 40,
          }}
        >
          {contextMenu.target?.type === "text" && (
            <>
              <MenuAction icon={CopyPlus} label="Duplicate" shortcut="⌘D" onClick={duplicateSelectedBlock} />
              <MenuAction icon={Paintbrush} label="Copy style" onClick={copySelectedStyle} />
              <MenuAction icon={ClipboardPaste} label="Paste style" disabled={!copiedStyle} onClick={pasteCopiedStyle} />
              <MenuAction icon={Trash2} label="Delete" shortcut="DEL" danger onClick={deleteSelectedBlock} />
              <MenuDivider />
              <MenuAction icon={AlignHorizontalJustifyCenter} label="Center horizontally" onClick={() => positionSelectedBlock("center-x")} />
              <MenuAction icon={AlignVerticalJustifyCenter} label="Center vertically" onClick={() => positionSelectedBlock("center-y")} />
              <MenuAction icon={PanelTop} label="Move near top" onClick={() => positionSelectedBlock("top")} />
              <MenuAction icon={PanelBottom} label="Move near bottom" onClick={() => positionSelectedBlock("bottom")} />
              <MenuDivider />
              <MenuAction icon={BringToFront} label="Bring to front" onClick={() => moveSelectedLayer("front")} />
              <MenuAction icon={SendToBack} label="Send to back" onClick={() => moveSelectedLayer("back")} />
            </>
          )}
          {contextMenu.target?.type === "image" && (
            <>
              <MenuAction icon={Replace} label="Replace image" onClick={() => replaceImageInputRef.current?.click()} />
              <MenuAction
                icon={RotateCcw}
                label="Reset image crop"
                onClick={() => {
                  pushUndo();
                  updateImage({ scale: 1, rotate: 0, offsetX: 0, offsetY: 0 });
                  setContextMenu(null);
                }}
              />
            </>
          )}
        </div>
      )}
      {exportModalOpen && (
        <div style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.58)",
          zIndex: 45,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}>
          <div style={{
            width: 390,
            borderRadius: 12,
            border: `1px solid ${ADS_BRAND.border2}`,
            background: ADS_BRAND.panel,
            boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
            padding: 18,
          }}>
            <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Name export folder</div>
            <input
              value={exportFolderName}
              onChange={(event) => setExportFolderName(event.target.value)}
              style={{ ...inputStyle, height: 40, marginBottom: 12 }}
              autoFocus
            />
            <label style={{ display: "flex", gap: 8, alignItems: "center", color: "rgba(255,255,255,0.72)", fontSize: 12, marginBottom: 14 }}>
              <input
                type="checkbox"
                checked={exportApprovedOnly}
                onChange={(event) => setExportApprovedOnly(event.target.checked)}
              />
              Export approved ads only ({approvedCount} approved)
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={buttonStyle(false)} onClick={() => setExportModalOpen(false)}>Cancel</button>
              <button style={buttonStyle(true)} onClick={() => exportAll(exportFolderName, exportApprovedOnly)}>
                <Download size={14} /> Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HomeMenuButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        height: 38,
        border: "none",
        borderRadius: 7,
        background: "transparent",
        color: ADS_BRAND.text,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 9px",
        fontFamily: "inherit",
        fontSize: 13,
        fontWeight: 750,
        textAlign: "left",
      }}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function HomeStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ color: ADS_BRAND.text3, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ color: ADS_BRAND.text, fontSize: 18, fontWeight: 900, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function HomeMediaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div style={{
      height: 36,
      border: `1px solid ${ADS_BRAND.border}`,
      borderRadius: 7,
      background: ADS_BRAND.panel3,
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "0 9px",
    }}>
      <Icon size={14} color={ADS_BRAND.gold} />
      <span style={{ color: ADS_BRAND.text2, fontSize: 12, fontWeight: 750, flex: 1 }}>{label}</span>
      <span style={{ color: ADS_BRAND.text, fontSize: 12, fontWeight: 850 }}>{value}</span>
    </div>
  );
}

function ProjectMetric({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      border: `1px solid ${ADS_BRAND.border}`,
      borderRadius: 7,
      background: ADS_BRAND.panel3,
      padding: "7px 8px",
    }}>
      <div style={{ color: ADS_BRAND.text3, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ color: ADS_BRAND.text, fontSize: 14, fontWeight: 900, marginTop: 1 }}>{value}</div>
    </div>
  );
}

function MenuAction({
  icon: Icon,
  label,
  shortcut,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const isInteractive = !disabled;
  const background = !isInteractive
    ? "transparent"
    : isPressed
      ? danger
        ? "rgba(255, 105, 105, 0.22)"
        : ADS_BRAND.active
      : isHovered
        ? danger
          ? "rgba(255, 105, 105, 0.15)"
          : ADS_BRAND.panel2
        : "transparent";

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => isInteractive && setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      onMouseDown={() => isInteractive && setIsPressed(true)}
      onMouseUp={() => setIsPressed(false)}
      onFocus={() => isInteractive && setIsHovered(true)}
      onBlur={() => {
        setIsHovered(false);
        setIsPressed(false);
      }}
      style={{
        width: "100%",
        height: 42,
        border: "none",
        borderRadius: 8,
        background,
        color: disabled ? ADS_BRAND.text4 : danger ? "#ffb4b4" : ADS_BRAND.text,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 10px",
        fontFamily: "inherit",
        fontSize: 14,
        fontWeight: 650,
        textAlign: "left",
        outline: "none",
        boxShadow: isHovered && isInteractive ? `inset 0 0 0 1px ${danger ? "rgba(255, 105, 105, 0.1)" : ADS_BRAND.border2}` : "none",
        transition: "background 120ms ease, box-shadow 120ms ease, transform 120ms ease",
        transform: isPressed && isInteractive ? "scale(0.995)" : "scale(1)",
      }}
    >
      <Icon size={18} />
      <span style={{ flex: 1 }}>{label}</span>
      {shortcut && (
        <span style={{
          color: ADS_BRAND.text2,
          background: ADS_BRAND.active,
          border: `1px solid ${ADS_BRAND.border2}`,
          borderRadius: 6,
          padding: "4px 7px",
          fontSize: 11,
          fontWeight: 800,
        }}>
          {shortcut}
        </span>
      )}
    </button>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: ADS_BRAND.border, margin: "7px -8px" }} />;
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ ...labelStyle, marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{children}</div>
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
  const fill = clamp(((value - min) / (max - min)) * 100, 0, 100);
  return (
    <div style={{ marginBottom: 13 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
        <span style={labelStyle}>{label}</span>
        <span style={{
          minWidth: 44,
          textAlign: "right",
          color: ADS_BRAND.text2,
          background: ADS_BRAND.panel3,
          border: `1px solid ${ADS_BRAND.border2}`,
          borderRadius: 999,
          padding: "3px 7px",
          fontSize: 11,
          fontWeight: 700,
        }}>
          {value}{suffix}
        </span>
      </div>
      <input
        className="studio2-range"
        type="range"
        min={min}
        max={max}
        value={value}
        onPointerDown={onStart}
        onChange={(e) => onChange(parseInt(e.target.value))}
        style={{
          background: `linear-gradient(90deg, ${ADS_BRAND.gold} 0%, ${ADS_BRAND.gold} ${fill}%, ${ADS_BRAND.border2} ${fill}%, ${ADS_BRAND.border2} 100%)`,
        }}
      />
    </div>
  );
}
