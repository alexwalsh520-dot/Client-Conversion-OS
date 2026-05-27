"use client";

/* eslint-disable @next/next/no-img-element */

import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  ArrowLeft,
  BringToFront,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  EyeOff,
  FilePlus2,
  Folder,
  FolderPlus,
  Home,
  ImagePlus,
  Layers,
  Library,
  Link2,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Palette,
  Paintbrush,
  PanelBottom,
  PanelTop,
  Pause,
  Play,
  Plus,
  Replace,
  RotateCcw,
  Search,
  SendToBack,
  Square,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Video,
  X,
} from "lucide-react";

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const AUTOSAVE_KEY = "active-draft";
const DB_NAME = "ccos-studio-2";
const DB_STORE = "drafts";
const DEFAULT_PROJECT_NAME = "Studio 2.0 Batch";
const EMPTY_PROJECT_NAME = "Untitled design";
const HIDDEN_FOLDERS_KEY = "ccos-studio2-hidden-design-folders";
const GENERATE_SPLIT_KEY = "ccos-studio2-generate-gallery-percent";
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
type StudioHomeMode = "designs" | "media";
type StudioFolderType = "design" | "media";
type MediaKind = "image" | "video";
type SelectedLayer = { type: "text"; id: string } | { type: "image" } | null;
type EditorSidebarMode = "edit" | "generate";
type SafeZoneId = (typeof IG_SAFE_ZONES)[number]["id"];
type TextStyle = Omit<TextBlock, "id" | "lines" | "x" | "y" | "locked" | "colorSpans">;

interface TextColorSpan {
  start: number;
  end: number;
  color: string;
}

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
  colorSpans?: TextColorSpan[];
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
  mediaKind?: MediaKind;
  textBlocks: TextBlock[];
  imageTransform: ImageTransform;
  status: "draft" | "exported";
  approved?: boolean;
}

interface DraftState {
  version: 1 | 2;
  savedAt: number;
  projectId?: string | null;
  projectFolderId?: string | null;
  photos: string[];
  photoCopies?: Record<string, number>;
  mediaAssets?: StudioMediaAsset[];
  creatives: Creative[];
  currentIndex: number;
  copyText: string;
  projectName: string;
  colorPreset: "dark" | "light";
  fontPreset: string;
  view: StudioView;
}

interface StudioFolder {
  id: string;
  name: string;
  folderType?: StudioFolderType;
  parentId?: string | null;
}

interface StudioProjectSummary {
  id: string;
  folderId: string | null;
  name: string;
  thumbnailUrl: string | null;
  status: string;
  updatedAt: string;
  createdAt: string;
}

interface HomeProjectCard {
  id: string;
  name: string;
  updated: string;
  thumb: string;
  isActiveDraft: boolean;
}

interface StudioMediaAsset {
  id: string;
  url: string;
  kind: MediaKind;
  filename: string;
  folderId?: string | null;
  createdAt?: string;
}

interface StudioAIGeneration {
  id: string;
  jobId: string;
  prompt: string;
  status: string;
  resultUrl?: string | null;
  mediaId?: string | null;
  error?: string | null;
  createdAt?: string;
  media?: StudioMediaAsset | null;
}

interface GeneratedPreviewState {
  generation: StudioAIGeneration;
  asset: StudioMediaAsset;
}

interface GenerateReferenceImage {
  name: string;
  dataUrl: string;
}

interface StudioProjectDetail {
  id: string;
  folderId: string | null;
  name: string;
  copyText: string;
  draft: Partial<DraftState>;
  thumbnailUrl: string | null;
  status: string;
}

interface RenderedLine {
  text: string;
  start: number;
  end: number;
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
      clearOnClick?: boolean;
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
const getPhotoCopies = (photoCopies: Record<string, number>, photo: string) =>
  Math.round(clamp(photoCopies[photo] || 1, 1, 30));

const cloneCreatives = (creatives: Creative[]) =>
  JSON.parse(JSON.stringify(creatives)) as Creative[];

function hasMeaningfulProjectName(projectName: string) {
  const trimmed = projectName.trim();
  return !!trimmed && trimmed !== DEFAULT_PROJECT_NAME && trimmed !== EMPTY_PROJECT_NAME;
}

function getBlockText(block: Pick<TextBlock, "lines">) {
  return block.lines.join("\n");
}

function normalizeColorSpans(spans: TextColorSpan[] | undefined, textLength: number) {
  if (!spans?.length) return [];

  return spans
    .map((span) => ({
      start: clamp(Math.min(span.start, span.end), 0, textLength),
      end: clamp(Math.max(span.start, span.end), 0, textLength),
      color: span.color,
    }))
    .filter((span) => span.end > span.start && /^#[0-9a-f]{6}$/i.test(span.color));
}

function getColorAtTextIndex(block: TextBlock, index: number) {
  const spans = normalizeColorSpans(block.colorSpans, getBlockText(block).length);
  for (let i = spans.length - 1; i >= 0; i--) {
    const span = spans[i];
    if (index >= span.start && index < span.end) return span.color;
  }
  return block.textColor;
}

function applyTextColorSpan(block: TextBlock, start: number, end: number, color: string): TextBlock {
  const textLength = getBlockText(block).length;
  const rangeStart = clamp(Math.min(start, end), 0, textLength);
  const rangeEnd = clamp(Math.max(start, end), 0, textLength);

  if (rangeEnd <= rangeStart) {
    return { ...block, textColor: color };
  }

  const spans = normalizeColorSpans(block.colorSpans, textLength).flatMap((span) => {
    if (span.end <= rangeStart || span.start >= rangeEnd) return [span];
    const pieces: TextColorSpan[] = [];
    if (span.start < rangeStart) pieces.push({ ...span, end: rangeStart });
    if (span.end > rangeEnd) pieces.push({ ...span, start: rangeEnd });
    return pieces;
  });

  spans.push({ start: rangeStart, end: rangeEnd, color });
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  return { ...block, colorSpans: spans };
}

function removeTextColorRange(block: TextBlock, start: number, end: number): TextBlock {
  const textLength = getBlockText(block).length;
  const rangeStart = clamp(Math.min(start, end), 0, textLength);
  const rangeEnd = clamp(Math.max(start, end), 0, textLength);

  if (rangeEnd <= rangeStart) return block;

  const spans = normalizeColorSpans(block.colorSpans, textLength).flatMap((span) => {
    if (span.end <= rangeStart || span.start >= rangeEnd) return [span];
    const pieces: TextColorSpan[] = [];
    if (span.start < rangeStart) pieces.push({ ...span, end: rangeStart });
    if (span.end > rangeEnd) pieces.push({ ...span, start: rangeEnd });
    return pieces;
  });

  return { ...block, colorSpans: spans };
}

function removeTextColorSpan(block: TextBlock, target: TextColorSpan): TextBlock {
  const textLength = getBlockText(block).length;
  return {
    ...block,
    colorSpans: normalizeColorSpans(block.colorSpans, textLength).filter(
      (span) => !(span.start === target.start && span.end === target.end && span.color === target.color)
    ),
  };
}

function getTextRangeSnippet(text: string, start: number, end: number) {
  const snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (!snippet) return "Selected text";
  return snippet.length > 34 ? `${snippet.slice(0, 31)}...` : snippet;
}

function withTextBlockText(block: TextBlock, text: string): TextBlock {
  return {
    ...block,
    lines: text.split("\n"),
    colorSpans: normalizeColorSpans(block.colorSpans, text.length),
  };
}

function normalizeTextBlock(block: TextBlock): TextBlock {
  const fontSize = block.fontSize || 44;
  const looksLikeFirstPass = (block.lineHeight || 0) < 1.3 || block.lineGap >= 8;
  const next: TextBlock = {
    ...block,
    lineHeight: looksLikeFirstPass ? 1.5 : block.lineHeight || 1.5,
    lineGap: looksLikeFirstPass ? (fontSize <= 46 ? 5 : 6) : block.lineGap ?? (fontSize <= 46 ? 5 : 6),
    colorSpans: normalizeColorSpans(block.colorSpans || [], getBlockText(block).length),
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
    mediaKind: creative.mediaKind || "image",
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

async function uploadStudioMedia(file: File, projectId?: string | null, folderId?: string | null): Promise<string> {
  const contentType = getUploadContentType(file);
  const presignRes = await fetch("/api/studio-2/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType,
      fileSize: file.size,
      projectId,
      folderId,
    }),
  });

  if (!presignRes.ok) throw new Error("R2 upload URL failed");
  const presign = await presignRes.json() as {
    key: string;
    publicUrl: string;
    uploadUrl: string;
    headers?: Record<string, string>;
  };

  const uploadRes = await fetch(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || { "Content-Type": contentType },
    body: file,
  });

  if (!uploadRes.ok) throw new Error("R2 upload failed");

  await fetch("/api/studio-2/media/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: presign.key,
      publicUrl: presign.publicUrl,
      filename: file.name,
      contentType,
      fileSize: file.size,
      projectId,
      folderId,
    }),
  }).catch(() => undefined);

  return presign.publicUrl;
}

function getUploadContentType(file: File) {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "mov" || ext === "qt") return "video/quicktime";
  if (ext === "mp4" || ext === "m4v") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const resolvedSrc = getCanvasImageSrc(src);
    if (/^https?:\/\//i.test(resolvedSrc)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = resolvedSrc;
  });
}

function loadVideoFrame(src: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const resolvedSrc = getCanvasImageSrc(src);
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(video);
    };

    if (/^https?:\/\//i.test(resolvedSrc)) video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = finish;
    video.oncanplay = finish;
    video.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Video failed to load"));
    };
    video.src = resolvedSrc;
    video.load();
  });
}

function getCanvasImageSrc(src: string) {
  if (!/^https?:\/\//i.test(src) || typeof window === "undefined") return src;
  try {
    const url = new URL(src);
    if (url.origin === window.location.origin) return src;
    return `/api/studio-2/media/proxy?url=${encodeURIComponent(src)}`;
  } catch {
    return src;
  }
}

function getMediaPreviewSrc(src: string) {
  return getCanvasImageSrc(src);
}

function getDraftProjectFolderId(draft?: Partial<DraftState> & { folderId?: string | null }) {
  return draft?.projectFolderId ?? draft?.folderId ?? null;
}

function setStudioCardDragImage(event: React.DragEvent<HTMLElement>) {
  const source = event.currentTarget;
  const rect = source.getBoundingClientRect();
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.style.position = "fixed";
  ghost.style.left = "-10000px";
  ghost.style.top = "-10000px";
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.pointerEvents = "none";
  ghost.style.transform = "none";
  ghost.style.opacity = "0.92";
  document.body.appendChild(ghost);
  event.dataTransfer.setDragImage(ghost, Math.min(44, rect.width / 2), Math.min(44, rect.height / 2));
  window.setTimeout(() => ghost.remove(), 0);
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

function wrapLine(ctx: CanvasRenderingContext2D, text: string, maxW: number, startOffset: number) {
  const tokens = Array.from(text.matchAll(/\S+/g)).map((match) => ({
    word: match[0],
    start: startOffset + (match.index ?? 0),
    end: startOffset + (match.index ?? 0) + match[0].length,
  }));

  if (!tokens.length) return [{ text: "", start: startOffset, end: startOffset }];

  const lines: Array<{ text: string; start: number; end: number }> = [];
  let current = tokens[0]?.word ?? "";
  let currentStart = tokens[0]?.start ?? startOffset;
  let currentEnd = tokens[0]?.end ?? startOffset;

  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    const next = `${current} ${token.word}`;
    if (ctx.measureText(next).width > maxW && current) {
      lines.push({ text: current, start: currentStart, end: currentEnd });
      current = token.word;
      currentStart = token.start;
      currentEnd = token.end;
    } else {
      current = next;
      currentEnd = token.end;
    }
  }

  if (current) lines.push({ text: current, start: currentStart, end: currentEnd });
  return lines;
}

function measureTextBlock(ctx: CanvasRenderingContext2D, block: TextBlock): BlockMetrics {
  setBlockFont(ctx, block);
  const lineH = block.fontSize * block.lineHeight;
  const availableW = Math.max(40, block.maxWidth - block.paddingH * 2);
  let y = block.y;
  let textOffset = 0;
  const rendered: RenderedLine[] = [];
  let bottom = block.y;

  for (const logicalLine of block.lines) {
    if (!logicalLine.trim()) {
      y += Math.round(block.fontSize * 0.55 + block.lineGap);
      bottom = Math.max(bottom, y);
      textOffset += logicalLine.length + 1;
      continue;
    }

    for (const visualLine of wrapLine(ctx, logicalLine, availableW, textOffset)) {
      const textW = ctx.measureText(visualLine.text).width;
      const bgW = textW + block.paddingH * 2;
      const bgH = lineH + block.paddingV * 2;
      let x = block.x;
      if (block.align === "center") x = block.x + (block.maxWidth - bgW) / 2;
      if (block.align === "right") x = block.x + block.maxWidth - bgW;
      rendered.push({
        text: visualLine.text,
        start: visualLine.start,
        end: visualLine.end,
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
    textOffset += logicalLine.length + 1;
  }

  const h = Math.max(24, bottom - block.y);
  return { x: block.x, y: block.y, w: block.maxWidth, h, lines: rendered };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  transform: ImageTransform
) {
  drawCoverMedia(ctx, image, image.naturalWidth, image.naturalHeight, transform);
}

function drawCoverVideo(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  transform: ImageTransform
) {
  if (!video.videoWidth || !video.videoHeight) return;
  drawCoverMedia(ctx, video, video.videoWidth, video.videoHeight, transform);
}

function drawCoverMedia(
  ctx: CanvasRenderingContext2D,
  media: CanvasImageSource,
  mediaWidth: number,
  mediaHeight: number,
  transform: ImageTransform
) {
  const imageRatio = mediaWidth / mediaHeight;
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
  ctx.drawImage(media, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function drawStyledTextLine(ctx: CanvasRenderingContext2D, block: TextBlock, line: RenderedLine) {
  let x = line.x + block.paddingH;
  let index = 0;

  while (index < line.text.length) {
    const color = getColorAtTextIndex(block, line.start + index);
    let next = index + 1;
    while (next < line.text.length && getColorAtTextIndex(block, line.start + next) === color) {
      next++;
    }
    const segment = line.text.slice(index, next);
    ctx.fillStyle = color;
    ctx.fillText(segment, x, line.textY);
    x += ctx.measureText(segment).width;
    index = next;
  }
}

function drawArtwork(
  ctx: CanvasRenderingContext2D,
  creative: Creative,
  media: HTMLImageElement | HTMLVideoElement | null,
  pixelRatio: number,
  editingTextBlockId?: string | null
) {
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  const isVideoCreative = (creative.mediaKind || "image") === "video";
  const hasVideoMedia =
    media && typeof HTMLVideoElement !== "undefined" && media instanceof HTMLVideoElement;

  if (!isVideoCreative || media) {
    ctx.fillStyle = ADS_BRAND.bgDeep;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (media) {
    if (hasVideoMedia) {
      drawCoverVideo(ctx, media, creative.imageTransform);
    } else {
      drawCoverImage(ctx, media as HTMLImageElement, creative.imageTransform);
    }
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
      drawStyledTextLine(ctx, block, line);
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

function formatProjectDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
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

const studioHomeIconButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  border: `1px solid ${ADS_BRAND.border2}`,
  borderRadius: 8,
  background: ADS_BRAND.panel,
  color: ADS_BRAND.text2,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const homeBackButtonStyle: React.CSSProperties = {
  height: 36,
  border: `1px solid ${ADS_BRAND.border2}`,
  borderRadius: 8,
  background: ADS_BRAND.panel,
  color: ADS_BRAND.text2,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "0 11px",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 650,
};

const homeKickerStyle: React.CSSProperties = {
  color: ADS_BRAND.text3,
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const homeCrumbTitleStyle: React.CSSProperties = {
  color: ADS_BRAND.text,
  fontSize: 18,
  fontWeight: 700,
};

const homeGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
  gap: 20,
  maxWidth: 1040,
  marginBottom: 34,
};

const folderCardStyle: React.CSSProperties = {
  border: `1px solid ${ADS_BRAND.border}`,
  borderRadius: 12,
  background: ADS_BRAND.panel,
  cursor: "pointer",
  padding: 0,
  overflow: "hidden",
  fontFamily: "inherit",
  textAlign: "left",
  minHeight: 228,
};

const folderThumbStyle: React.CSSProperties = {
  height: 150,
  background: ADS_BRAND.panel2,
  borderRadius: "12px 12px 0 0",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: ADS_BRAND.text4,
};

const homeCardBodyStyle: React.CSSProperties = {
  padding: "17px 18px 18px",
};

const homeCardTitleStyle: React.CSSProperties = {
  color: ADS_BRAND.text2,
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.25,
  letterSpacing: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const homeCardSubtleStyle: React.CSSProperties = {
  color: ADS_BRAND.text3,
  fontSize: 13,
  fontWeight: 400,
  marginTop: 8,
};

const cardMenuButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 9,
  right: 9,
  zIndex: 5,
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.56)",
  color: ADS_BRAND.text2,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const cardMenuStyle: React.CSSProperties = {
  position: "absolute",
  top: 44,
  right: 9,
  zIndex: 20,
  width: 180,
  padding: 7,
  borderRadius: 8,
  border: `1px solid ${ADS_BRAND.border2}`,
  background: ADS_BRAND.panel,
  boxShadow: "0 18px 48px rgba(0,0,0,0.52)",
};

const mediaCardStyle: React.CSSProperties = {
  position: "relative",
  border: `1px solid ${ADS_BRAND.border}`,
  background: ADS_BRAND.panel,
  borderRadius: 12,
  overflow: "visible",
  minHeight: 228,
};

const mediaVideoBadgeStyle: React.CSSProperties = {
  position: "absolute",
  left: 9,
  bottom: 9,
  width: 24,
  height: 24,
  borderRadius: 8,
  background: "rgba(0,0,0,0.62)",
  color: "#fff",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function projectThumbStyle(hasThumb?: string): React.CSSProperties {
  return {
    height: 150,
    background: hasThumb ? ADS_BRAND.bgDeep : ADS_BRAND.panel2,
    borderRadius: "12px 12px 0 0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
  };
}

function selectBadgeStyle(isSelected: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: 10,
    left: 10,
    zIndex: 5,
    width: 24,
    height: 24,
    borderRadius: 7,
    border: `1px solid ${isSelected ? ADS_BRAND.gold : "rgba(255,255,255,0.28)"}`,
    background: isSelected ? ADS_BRAND.gold : "rgba(0,0,0,0.48)",
    color: isSelected ? ADS_BRAND.bgDeep : ADS_BRAND.text2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

const alignOptions = [
  { value: "left" as const, label: "Left", icon: AlignLeft },
  { value: "center" as const, label: "Center", icon: AlignCenter },
  { value: "right" as const, label: "Right", icon: AlignRight },
];

export default function Studio2Page() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoCopies, setPhotoCopies] = useState<Record<string, number>>({});
  const [mediaAssets, setMediaAssets] = useState<StudioMediaAsset[]>([]);
  const [libraryMedia, setLibraryMedia] = useState<StudioMediaAsset[]>([]);
  const [creatives, setCreatives] = useState<Creative[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copyText, setCopyText] = useState(DEFAULT_COPY);
  const [projectName, setProjectName] = useState(DEFAULT_PROJECT_NAME);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectFolderId, setProjectFolderId] = useState<string | null>(null);
  const [view, setView] = useState<StudioView>("home");
  const [colorPreset, setColorPreset] = useState<"dark" | "light">("dark");
  const [fontPreset, setFontPreset] = useState(FONT_OPTIONS[0].value);
  const [selectedLayer, setSelectedLayer] = useState<SelectedLayer>(null);
  const [editorSidebarMode, setEditorSidebarMode] = useState<EditorSidebarMode>("edit");
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
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [homeMode, setHomeMode] = useState<StudioHomeMode>("designs");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedMediaFolderId, setSelectedMediaFolderId] = useState<string | null>(null);
  const [setupMediaFolderId, setSetupMediaFolderId] = useState<string | null>(null);
  const [cloudFolders, setCloudFolders] = useState<StudioFolder[]>([]);
  const [cloudProjects, setCloudProjects] = useState<StudioProjectSummary[]>([]);
  const [cloudStatus, setCloudStatus] = useState("Loading designs...");
  const [searchTerm, setSearchTerm] = useState("");
  const [setupDropActive, setSetupDropActive] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [selectedMediaFolderIds, setSelectedMediaFolderIds] = useState<string[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [hiddenDesignFolderIds, setHiddenDesignFolderIds] = useState<string[]>([]);
  const [draggedDesignIds, setDraggedDesignIds] = useState<string[]>([]);
  const [draggedMediaIds, setDraggedMediaIds] = useState<string[]>([]);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [cardMenuId, setCardMenuId] = useState<string | null>(null);
  const [folderCardMenuId, setFolderCardMenuId] = useState<string | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<File[]>([]);
  const [uploadDropActive, setUploadDropActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadTargetFolderId, setUploadTargetFolderId] = useState<string | null>(null);
  const [shareLinkStatus, setShareLinkStatus] = useState("");
  const [uploadingQueuedMedia, setUploadingQueuedMedia] = useState(false);
  const [folderPickerProjectId, setFolderPickerProjectId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderPickerStatus, setFolderPickerStatus] = useState("");
  const [savingFolderPick, setSavingFolderPick] = useState(false);
  const [createFolderModalOpen, setCreateFolderModalOpen] = useState(false);
  const [homeFolderName, setHomeFolderName] = useState("");
  const [homeFolderStatus, setHomeFolderStatus] = useState("");
  const [savingHomeFolder, setSavingHomeFolder] = useState(false);
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null);
  const [deleteProjectStatus, setDeleteProjectStatus] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [mediaCardMenuId, setMediaCardMenuId] = useState<string | null>(null);
  const [previewMediaId, setPreviewMediaId] = useState<string | null>(null);
  const [deleteMediaId, setDeleteMediaId] = useState<string | null>(null);
  const [deleteMediaStatus, setDeleteMediaStatus] = useState("");
  const [deletingMedia, setDeletingMedia] = useState(false);
  const [deleteFolderIds, setDeleteFolderIds] = useState<string[]>([]);
  const [deleteFolderStatus, setDeleteFolderStatus] = useState("");
  const [deletingFolder, setDeletingFolder] = useState(false);
  const [editorTitleFocused, setEditorTitleFocused] = useState(false);
  const [textSelection, setTextSelection] = useState<{ blockId: string; start: number; end: number } | null>(null);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateReference, setGenerateReference] = useState<GenerateReferenceImage | null>(null);
  const [generateStatus, setGenerateStatus] = useState("");
  const [generatingAd, setGeneratingAd] = useState(false);
  const [aiGenerations, setAiGenerations] = useState<StudioAIGeneration[]>([]);
  const [generateDropActive, setGenerateDropActive] = useState(false);
  const [generateSourcePreview, setGenerateSourcePreview] = useState("");
  const [generateGalleryPercent, setGenerateGalleryPercent] = useState(50);
  const [generatedPreview, setGeneratedPreview] = useState<GeneratedPreviewState | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const generateWorkspaceRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadQueueInputRef = useRef<HTMLInputElement>(null);
  const generateReferenceInputRef = useRef<HTMLInputElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const sidebarTextRef = useRef<HTMLTextAreaElement>(null);
  const inlineEditRef = useRef<HTMLTextAreaElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const [, bumpImageVersion] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const hydratedRef = useRef(false);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [videoPreviewPlaying, setVideoPreviewPlaying] = useState(true);

  const currentCreative = creatives[currentIndex];
  const selectedBlock =
    selectedLayer?.type === "text"
      ? currentCreative?.textBlocks.find((b) => b.id === selectedLayer.id)
      : undefined;
  const editingBlock = editingBlockId
    ? currentCreative?.textBlocks.find((block) => block.id === editingBlockId)
    : undefined;
  const selectedTextRange = useMemo(
    () =>
      selectedBlock && textSelection?.blockId === selectedBlock.id && textSelection.start !== textSelection.end
        ? {
            start: Math.min(textSelection.start, textSelection.end),
            end: Math.max(textSelection.start, textSelection.end),
          }
        : null,
    [selectedBlock, textSelection]
  );
  const selectedBlockText = selectedBlock ? getBlockText(selectedBlock) : "";
  const selectedTextSnippet =
    selectedBlock && selectedTextRange
      ? getTextRangeSnippet(selectedBlockText, selectedTextRange.start, selectedTextRange.end)
      : "";
  const selectedTextColor =
    selectedBlock && selectedTextRange
      ? getColorAtTextIndex(selectedBlock, selectedTextRange.start)
      : selectedBlock?.textColor ?? "#ffffff";
  const selectedColorSpans = useMemo(
    () => (selectedBlock ? normalizeColorSpans(selectedBlock.colorSpans, selectedBlockText.length) : []),
    [selectedBlock, selectedBlockText]
  );

  const getMeasureCtx = useCallback(() => {
    if (!measureCanvasRef.current) measureCanvasRef.current = document.createElement("canvas");
    return measureCanvasRef.current.getContext("2d")!;
  }, []);

  const currentImage = currentCreative && (currentCreative.mediaKind || "image") === "image"
    ? imageCacheRef.current.get(currentCreative.photoUrl) ?? null
    : null;
  const designFolders = useMemo(
    () => cloudFolders.filter((folder) => (folder.folderType || "design") === "design"),
    [cloudFolders]
  );
  const mediaFolders = useMemo(
    () => cloudFolders.filter((folder) => folder.folderType === "media"),
    [cloudFolders]
  );
  const selectedMediaForAds = useMemo(() => {
    const media = [
      ...photos.map((url) => ({ url, kind: "image" as MediaKind })),
      ...mediaAssets.filter((asset) => asset.kind === "video").map((asset) => ({
        url: asset.url,
        kind: "video" as MediaKind,
      })),
    ];
    const seen = new Set<string>();
    return media.filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }, [mediaAssets, photos]);
  const plannedAdCount = useMemo(
    () => selectedMediaForAds.reduce((total, media) => total + getPhotoCopies(photoCopies, media.url), 0),
    [photoCopies, selectedMediaForAds]
  );
  const selectedMediaCount = selectedMediaForAds.length;
  const uploadShareUrl = useMemo(() => {
    if (!uploadTargetFolderId || typeof window === "undefined") return "";
    return `${window.location.origin}/studio-2/upload/${uploadTargetFolderId}`;
  }, [uploadTargetFolderId]);
  const setupLibraryMedia = useMemo(
    () => libraryMedia.filter((asset) => (asset.folderId || null) === setupMediaFolderId),
    [libraryMedia, setupMediaFolderId]
  );
  const setupMediaAssets = useMemo(() => {
    const imageAssets = photos.map((photo, index) => {
      const existing = mediaAssets.find((asset) => asset.kind === "image" && asset.url === photo);
      return existing || {
        id: `photo-${index}-${photo.slice(0, 16)}`,
        url: photo,
        kind: "image" as const,
        filename: `Image ${index + 1}`,
      };
    });
    const videoAssets = mediaAssets.filter((asset) => asset.kind === "video");
    const seen = new Set<string>();
    return [...imageAssets, ...videoAssets, ...setupLibraryMedia].filter((asset) => {
      if (seen.has(asset.url)) return false;
      seen.add(asset.url);
      return true;
    });
  }, [mediaAssets, photos, setupLibraryMedia]);

  const hasActiveDraft =
    photos.length > 0 ||
    mediaAssets.length > 0 ||
    creatives.length > 0 ||
    !!projectId ||
    hasMeaningfulProjectName(projectName) ||
    copyText !== DEFAULT_COPY;
  const activeDraftId = projectId || "active-draft";
  const currentCloudProject = useMemo(
    () => cloudProjects.find((project) => project.id === projectId) || null,
    [cloudProjects, projectId]
  );
  const activeProjectFolderId = projectFolderId ?? currentCloudProject?.folderId ?? null;
  const activeDraftCard = useMemo(
    (): HomeProjectCard => ({
      id: activeDraftId,
      name: projectName || "Untitled Studio batch",
      updated: "May 13, 2026",
      thumb: currentCreative?.photoUrl || photos[0] || "",
      isActiveDraft: true,
    }),
    [activeDraftId, currentCreative?.photoUrl, photos, projectName]
  );
  const activeDraftVisible =
    hasActiveDraft &&
    homeMode === "designs" &&
    (selectedFolderId ? activeProjectFolderId === selectedFolderId : !activeProjectFolderId);
  const selectedHomeCount = selectedDesignIds.length + selectedFolderIds.length;
  const selectedMediaHomeCount = selectedMediaIds.length + selectedMediaFolderIds.length;
  const selectedVisibleCount = homeMode === "media" ? selectedMediaHomeCount : selectedHomeCount;
  const visibleCloudProjects = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return cloudProjects.filter((project) => {
      if (project.id === projectId) return false;
      if (homeMode !== "designs") return false;
      if (selectedFolderId && project.folderId !== selectedFolderId) return false;
      if (!selectedFolderId && project.folderId) return false;
      if (normalizedSearch && !project.name.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [cloudProjects, homeMode, projectId, searchTerm, selectedFolderId]);
  const homeProjects = useMemo(
    (): HomeProjectCard[] => [
      ...(activeDraftVisible ? [activeDraftCard] : []),
      ...visibleCloudProjects.map((project) => ({
        id: project.id,
        name: project.name,
        updated: formatProjectDate(project.updatedAt),
        thumb: project.thumbnailUrl || "",
        isActiveDraft: false,
      })),
    ],
    [activeDraftCard, activeDraftVisible, visibleCloudProjects]
  );
  const deleteProject = useMemo(
    () => homeProjects.find((project) => project.id === deleteProjectId) || null,
    [deleteProjectId, homeProjects]
  );
  const visibleDesignFolders = useMemo(() => {
    if (homeMode !== "designs" || selectedFolderId) return [];
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return designFolders.filter((folder) => {
      if (hiddenDesignFolderIds.includes(folder.id)) return false;
      return !normalizedSearch || folder.name.toLowerCase().includes(normalizedSearch);
    });
  }, [designFolders, hiddenDesignFolderIds, homeMode, searchTerm, selectedFolderId]);
  const hiddenDesignFolders = useMemo(
    () => designFolders.filter((folder) => hiddenDesignFolderIds.includes(folder.id)),
    [designFolders, hiddenDesignFolderIds]
  );
  const currentMediaFolder = useMemo(
    () => mediaFolders.find((folder) => folder.id === selectedMediaFolderId) || null,
    [mediaFolders, selectedMediaFolderId]
  );
  const visibleMediaFolders = useMemo(() => {
    if (homeMode !== "media") return [];
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return mediaFolders.filter((folder) => {
      if ((folder.parentId || null) !== selectedMediaFolderId) return false;
      if (normalizedSearch && !folder.name.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [homeMode, mediaFolders, searchTerm, selectedMediaFolderId]);
  const visibleLibraryMedia = useMemo(() => {
    if (homeMode !== "media") return [];
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return libraryMedia.filter((asset) => {
      if ((asset.folderId || null) !== selectedMediaFolderId) return false;
      if (normalizedSearch && !asset.filename.toLowerCase().includes(normalizedSearch)) return false;
      return true;
    });
  }, [homeMode, libraryMedia, searchTerm, selectedMediaFolderId]);
  const deleteMedia = useMemo(
    () => libraryMedia.find((asset) => asset.id === deleteMediaId) || null,
    [deleteMediaId, libraryMedia]
  );
  const previewMedia = useMemo(
    () => libraryMedia.find((asset) => asset.id === previewMediaId) || null,
    [libraryMedia, previewMediaId]
  );
  const deleteFolders = useMemo(
    () => cloudFolders.filter((folder) => deleteFolderIds.includes(folder.id)),
    [cloudFolders, deleteFolderIds]
  );
  const setupMediaFolder = useMemo(
    () => mediaFolders.find((folder) => folder.id === setupMediaFolderId) || null,
    [mediaFolders, setupMediaFolderId]
  );
  const setupMediaFolderOptions = useMemo(
    () => mediaFolders.filter((folder) => !folder.parentId),
    [mediaFolders]
  );
  const selectedFolder = useMemo(
    () => cloudFolders.find((folder) => folder.id === selectedFolderId) || null,
    [cloudFolders, selectedFolderId]
  );

  const buildDraftState = useCallback(
    (overrides: Partial<DraftState> = {}): DraftState => ({
      version: 2,
      savedAt: Date.now(),
      projectId,
      projectFolderId: activeProjectFolderId,
      photos,
      photoCopies,
      mediaAssets,
      creatives,
      currentIndex,
      copyText,
      projectName,
      colorPreset,
      fontPreset,
      view,
      ...overrides,
    }),
    [activeProjectFolderId, colorPreset, copyText, creatives, currentIndex, fontPreset, mediaAssets, photoCopies, photos, projectId, projectName, view]
  );

  const fetchStudioHome = useCallback(async () => {
    try {
      const res = await fetch("/api/studio-2/projects", { cache: "no-store" });
      if (!res.ok) throw new Error("Project library unavailable");
      const data = await res.json() as { projects?: StudioProjectSummary[]; folders?: StudioFolder[] };
      setCloudProjects(data.projects || []);
      setCloudFolders(data.folders || []);
      setCloudStatus("");
    } catch {
      setCloudStatus("Cloud library unavailable. Local autosave is still on.");
    }
  }, []);

  const fetchStudioMedia = useCallback(async () => {
    try {
      const res = await fetch("/api/studio-2/media", { cache: "no-store" });
      if (!res.ok) throw new Error("Media library unavailable");
      const data = await res.json() as { media?: StudioMediaAsset[] };
      setLibraryMedia(data.media || []);
    } catch {
      setLibraryMedia([]);
    }
  }, []);

  const persistProjectToCloud = useCallback(
    async (draft: DraftState, refreshHome = false) => {
      const thumbnailUrl = draft.creatives[0]?.photoUrl || draft.photos[0] || null;
      const body = {
        name: draft.projectName || EMPTY_PROJECT_NAME,
        copyText: draft.copyText,
        draft,
        thumbnailUrl,
        folderId: activeProjectFolderId,
        status: draft.creatives.length ? "in_progress" : "draft",
      };
      const res = await fetch(projectId ? `/api/studio-2/projects/${projectId}` : "/api/studio-2/projects", {
        method: projectId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Cloud project save failed");
      const data = await res.json() as { project?: { id?: string } };
      if (!projectId && data.project?.id) setProjectId(data.project.id);
      if (refreshHome) void fetchStudioHome();
      return data.project;
    },
    [activeProjectFolderId, fetchStudioHome, projectId]
  );

  const getHomeProjectDetail = useCallback(async (cardId: string): Promise<StudioProjectDetail | null> => {
    const isActive = cardId === activeDraftId;
    if (isActive) {
      return {
        id: projectId || activeDraftId,
        folderId: activeProjectFolderId,
        name: projectName || EMPTY_PROJECT_NAME,
        copyText,
        draft: buildDraftState(),
        thumbnailUrl: currentCreative?.photoUrl || photos[0] || null,
        status: creatives.length ? "in_progress" : "draft",
      };
    }

    const res = await fetch(`/api/studio-2/projects/${cardId}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Project load failed");
    const data = await res.json() as { project?: StudioProjectDetail };
    if (!data.project) throw new Error("Project not found");
    return data.project;
  }, [
    activeDraftId,
    buildDraftState,
    copyText,
    creatives.length,
    currentCreative?.photoUrl,
    photos,
    projectId,
    activeProjectFolderId,
    projectName,
  ]);

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
    try {
      const saved = window.localStorage.getItem(HIDDEN_FOLDERS_KEY);
      if (saved) setHiddenDesignFolderIds(JSON.parse(saved) as string[]);
    } catch {
      setHiddenDesignFolderIds([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(HIDDEN_FOLDERS_KEY, JSON.stringify(hiddenDesignFolderIds));
    } catch {
      // Local UI preference only.
    }
  }, [hiddenDesignFolderIds]);

  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
        event.preventDefault();
      }
    };

    window.addEventListener("dragover", preventFileNavigation);
    window.addEventListener("drop", preventFileNavigation);
    return () => {
      window.removeEventListener("dragover", preventFileNavigation);
      window.removeEventListener("drop", preventFileNavigation);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadDraft()
      .then((draft) => {
        if (!draft || cancelled) return;
        setPhotos(draft.photos || []);
        setPhotoCopies(draft.photoCopies || {});
        setMediaAssets(draft.mediaAssets || []);
        setCreatives((draft.creatives || []).map(normalizeCreative));
        setCurrentIndex(draft.currentIndex || 0);
        setCopyText(draft.copyText || DEFAULT_COPY);
        setProjectName(draft.projectName || DEFAULT_PROJECT_NAME);
        setProjectId(draft.projectId || null);
        setProjectFolderId(getDraftProjectFolderId(draft));
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
    void fetchStudioHome();
    void fetchStudioMedia();
  }, [fetchStudioHome, fetchStudioMedia]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!hasActiveDraft) {
      void clearDraft().catch(() => undefined);
      setSaveStatus("");
      return;
    }

    const handle = window.setTimeout(() => {
      const draft = buildDraftState();
      saveDraft(draft)
        .then(() => setSaveStatus(`Saved ${getDraftDate(draft.savedAt)}`))
        .catch(() => setSaveStatus("Autosave failed"));
    }, 700);
    return () => window.clearTimeout(handle);
  }, [buildDraftState, hasActiveDraft]);

  useEffect(() => {
    if (!hydratedRef.current || !projectId) return;
    const handle = window.setTimeout(() => {
      void persistProjectToCloud(buildDraftState(), true).catch(() => undefined);
    }, 1800);
    return () => window.clearTimeout(handle);
  }, [buildDraftState, persistProjectToCloud, projectId]);

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
    const urls = new Set([
      ...photos,
      ...creatives.filter((creative) => (creative.mediaKind || "image") === "image").map((c) => c.photoUrl),
    ]);
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
    if (view !== "editor" || !currentCreative?.photoUrl || (currentCreative.mediaKind || "image") === "video") return;
    const url = currentCreative.photoUrl;
    let cancelled = false;
    loadImage(url)
      .then((img) => {
        if (cancelled) return;
        imageCacheRef.current.set(url, img);
        bumpImageVersion((v) => v + 1);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [currentCreative?.mediaKind, currentCreative?.photoUrl, view]);

  useEffect(() => {
    if (view !== "editor" || (currentCreative?.mediaKind || "image") !== "video") return;
    setVideoPreviewPlaying(true);
  }, [currentCreative?.id, currentCreative?.mediaKind, view]);

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
    if (!createMenuOpen && !folderMenuOpen) return;
    const close = () => {
      setCreateMenuOpen(false);
      setFolderMenuOpen(false);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [createMenuOpen, folderMenuOpen]);

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

  const captureTextSelection = useCallback((blockId: string, target: HTMLTextAreaElement) => {
    setTextSelection({
      blockId,
      start: target.selectionStart,
      end: target.selectionEnd,
    });
  }, []);

  const updateSelectedBlockText = useCallback(
    (text: string) => {
      if (!selectedBlock) return;
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          block.id === selectedBlock.id ? withTextBlockText(block, text) : block
        ),
      }));
      setTextSelection((selection) =>
        selection?.blockId === selectedBlock.id
          ? {
              ...selection,
              start: clamp(selection.start, 0, text.length),
              end: clamp(selection.end, 0, text.length),
            }
          : selection
      );
    },
    [selectedBlock, updateCurrentCreative]
  );

  const applySelectedTextColor = useCallback(
    (color: string) => {
      if (!selectedBlock || !selectedTextRange) return;
      const range = selectedTextRange;
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          block.id === selectedBlock.id
            ? applyTextColorSpan(block, range.start, range.end, color)
            : block
        ),
      }));
    },
    [selectedBlock, selectedTextRange, updateCurrentCreative]
  );

  const clearSelectedTextColor = useCallback(() => {
    if (!selectedBlock || !selectedTextRange) return;
    pushUndo();
    const range = selectedTextRange;
    updateCurrentCreative((creative) => ({
      ...creative,
      textBlocks: creative.textBlocks.map((block) =>
        block.id === selectedBlock.id ? removeTextColorRange(block, range.start, range.end) : block
      ),
    }));
  }, [pushUndo, selectedBlock, selectedTextRange, updateCurrentCreative]);

  const removeColorSpan = useCallback(
    (span: TextColorSpan) => {
      if (!selectedBlock) return;
      pushUndo();
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          block.id === selectedBlock.id ? removeTextColorSpan(block, span) : block
        ),
      }));
    },
    [pushUndo, selectedBlock, updateCurrentCreative]
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

  const handleMediaOnlyUpload = useCallback(async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const mediaFiles = Array.from(files).filter((file) => getUploadContentType(file).startsWith("video/"));
    if (!mediaFiles.length) return;
    const uploaded = await Promise.all(
      mediaFiles.map(async (file) => ({
        file,
        url: await uploadStudioMedia(file, projectId, setupMediaFolderId).catch(() => ""),
      }))
    );
    const savedVideos = uploaded.filter((item) => item.url);
    if (savedVideos.length) {
      setMediaAssets((prev) => [
        ...prev,
        ...savedVideos.map((item) => ({
          id: uid(),
          url: item.url,
          kind: "video" as const,
          filename: item.file.name,
        })),
      ]);
      setPhotoCopies((prev) => {
        const next = { ...prev };
        savedVideos.forEach((item) => {
          if (!next[item.url]) next[item.url] = 1;
        });
        return next;
      });
    }
    setCloudStatus(
      savedVideos.length
        ? `${savedVideos.length} video${savedVideos.length === 1 ? "" : "s"} uploaded to Media.`
        : "Video upload failed."
    );
    void fetchStudioMedia();
    void fetchStudioHome();
  }, [fetchStudioHome, fetchStudioMedia, projectId, setupMediaFolderId]);

  const handleFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    const fileList = Array.from(files);
    const imageFiles = fileList.filter((file) => getUploadContentType(file).startsWith("image/"));
    const videoFiles = fileList.filter((file) => getUploadContentType(file).startsWith("video/"));

    if (videoFiles.length) await handleMediaOnlyUpload(videoFiles);
    if (!imageFiles.length) return;

    const urls = await Promise.all(
      imageFiles.map(async (file) => {
        try {
          return { file, url: await uploadStudioMedia(file, projectId, setupMediaFolderId) };
        } catch {
          return { file, url: await fileToDataUrl(file) };
        }
      })
    );
    const uploadedImages = urls.filter((item) => item.url);
    setPhotos((prev) => [...prev, ...uploadedImages.map((item) => item.url)]);
    setMediaAssets((prev) => [
      ...prev,
      ...uploadedImages.map((item) => ({
        id: uid(),
        url: item.url,
        kind: "image" as const,
        filename: item.file.name,
      })),
    ]);
    setPhotoCopies((prev) => {
      const next = { ...prev };
      uploadedImages.forEach((item) => {
        if (!next[item.url]) next[item.url] = 1;
      });
      return next;
    });
    void fetchStudioMedia();
    void fetchStudioHome();
  }, [fetchStudioHome, fetchStudioMedia, handleMediaOnlyUpload, projectId, setupMediaFolderId]);

  const updatePhotoCopyCount = useCallback((photo: string, delta: number) => {
    setPhotoCopies((prev) => ({
      ...prev,
      [photo]: Math.round(clamp(getPhotoCopies(prev, photo) + delta, 1, 30)),
    }));
  }, []);

  const removeSetupPhoto = useCallback((photo: string, index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setMediaAssets((prev) => prev.filter((asset) => asset.url !== photo));
    setPhotoCopies((prev) => {
      const next = { ...prev };
      delete next[photo];
      return next;
    });
  }, []);

  const toggleSetupMediaAsset = useCallback((asset: StudioMediaAsset) => {
    const isSelected =
      asset.kind === "image"
        ? photos.includes(asset.url)
        : mediaAssets.some((item) => item.url === asset.url);

    if (isSelected) {
      if (asset.kind === "image") {
        const photoIndex = photos.findIndex((photo) => photo === asset.url);
        if (photoIndex >= 0) removeSetupPhoto(asset.url, photoIndex);
        return;
      }
      setMediaAssets((prev) => prev.filter((item) => item.url !== asset.url));
      setPhotoCopies((prev) => {
        const next = { ...prev };
        delete next[asset.url];
        return next;
      });
      return;
    }

    if (asset.kind === "image") {
      setPhotos((prev) => (prev.includes(asset.url) ? prev : [...prev, asset.url]));
    }
    setMediaAssets((prev) =>
      prev.some((item) => item.url === asset.url)
        ? prev
        : [...prev, { ...asset, id: asset.id || uid() }]
    );
    setPhotoCopies((prev) => (prev[asset.url] ? prev : { ...prev, [asset.url]: 1 }));
  }, [mediaAssets, photos, removeSetupPhoto]);

  const handleSetupDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setSetupDropActive(true);
  }, []);

  const handleSetupDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setSetupDropActive(false);
    }
  }, []);

  const handleSetupDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setSetupDropActive(false);
      if (!event.dataTransfer.files.length) return;
      void handleFiles(event.dataTransfer.files);
    },
    [handleFiles]
  );

  const addQueuedUploadFiles = useCallback((files: FileList | File[] | null) => {
    if (!files?.length) return;
    const nextFiles = Array.from(files).filter((file) => {
      const contentType = getUploadContentType(file);
      return contentType.startsWith("image/") || contentType.startsWith("video/");
    });
    if (!nextFiles.length) {
      setUploadStatus("Only image and video files are supported.");
      return;
    }
    setUploadQueue((prev) => [...prev, ...nextFiles]);
    setUploadStatus("");
  }, []);

  const uploadLibraryFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files?.length) return 0;
    const mediaFiles = Array.from(files).filter((file) => {
      const contentType = getUploadContentType(file);
      return contentType.startsWith("image/") || contentType.startsWith("video/");
    });
    if (!mediaFiles.length) return 0;

    const uploaded = await Promise.all(
      mediaFiles.map(async (file) => {
        try {
          const targetFolderId = uploadTargetFolderId || (homeMode === "media" ? selectedMediaFolderId : null);
          const url = await uploadStudioMedia(file, null, targetFolderId);
          return { file, url };
        } catch {
          return { file, url: "" };
        }
      })
    );
    const savedCount = uploaded.filter((item) => item.url).length;
    await fetchStudioMedia();
    void fetchStudioHome();
    return savedCount;
  }, [fetchStudioHome, fetchStudioMedia, homeMode, selectedMediaFolderId, uploadTargetFolderId]);

  const handleUploadModalDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setUploadDropActive(true);
  }, []);

  const handleUploadModalDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setUploadDropActive(false);
    }
  }, []);

  const handleUploadModalDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault();
      setUploadDropActive(false);
      addQueuedUploadFiles(event.dataTransfer.files);
    },
    [addQueuedUploadFiles]
  );

  const uploadQueuedMedia = useCallback(async () => {
    if (!uploadQueue.length || uploadingQueuedMedia) return;
    setUploadingQueuedMedia(true);
    setUploadStatus(`Uploading ${uploadQueue.length} file${uploadQueue.length === 1 ? "" : "s"}...`);
    try {
      const savedCount = await uploadLibraryFiles(uploadQueue);
      if (!savedCount) throw new Error("No media uploaded");
      setUploadStatus("Upload complete.");
      setCloudStatus("Upload complete.");
      setUploadQueue([]);
      setUploadModalOpen(false);
      setShareLinkStatus("");
      setView("home");
    } catch {
      setUploadStatus("Upload failed. Try again.");
    } finally {
      setUploadingQueuedMedia(false);
    }
  }, [uploadLibraryFiles, uploadQueue, uploadingQueuedMedia]);

  const openUploadMediaModal = useCallback(
    (folderId?: string | null) => {
      setCreateMenuOpen(false);
      setFolderMenuOpen(false);
      setFolderCardMenuId(null);
      setUploadTargetFolderId(folderId ?? (homeMode === "media" ? selectedMediaFolderId : null));
      setUploadQueue([]);
      setUploadDropActive(false);
      setUploadStatus("");
      setShareLinkStatus("");
      setUploadModalOpen(true);
    },
    [homeMode, selectedMediaFolderId]
  );

  const copyUploadShareLink = useCallback(async () => {
    if (!uploadShareUrl) {
      setShareLinkStatus("Pick a media folder first.");
      return;
    }
    try {
      await navigator.clipboard.writeText(uploadShareUrl);
      setShareLinkStatus("Share link copied.");
    } catch {
      setShareLinkStatus("Copy failed. You can select the link and copy it.");
    }
  }, [uploadShareUrl]);

  const replaceCurrentImage = useCallback(
    async (file: File | null) => {
      if (!file || !currentCreative) return;
      const contentType = getUploadContentType(file);
      const mediaKind: MediaKind = contentType.startsWith("video/") ? "video" : "image";
      if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) return;
      let url: string;
      try {
        url = await uploadStudioMedia(file, projectId, setupMediaFolderId);
      } catch {
        url = await fileToDataUrl(file);
      }
      pushUndo();
      if (mediaKind === "image") {
        setPhotos((prev) => (prev.includes(url) ? prev : [...prev, url]));
      }
      setMediaAssets((prev) =>
        prev.some((asset) => asset.url === url)
          ? prev
          : [...prev, { id: uid(), url, kind: mediaKind, filename: file.name }]
      );
      setPhotoCopies((prev) => (prev[url] ? prev : { ...prev, [url]: 1 }));
      updateCurrentCreative((creative) => ({
        ...creative,
        photoUrl: url,
        mediaKind,
        imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
      }));
      setSelectedLayer({ type: "image" });
      setContextMenu(null);
      void fetchStudioMedia();
      void fetchStudioHome();
    },
    [currentCreative, fetchStudioHome, fetchStudioMedia, projectId, pushUndo, setupMediaFolderId, updateCurrentCreative]
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
      colorSpans: selectedBlock.colorSpans?.map((span) => ({ ...span })),
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
    const expandedMedia = selectedMediaForAds.flatMap((media) =>
      Array.from({ length: getPhotoCopies(photoCopies, media.url) }, () => media)
    );
    if (!expandedMedia.length) return;
    const groups = parseCopyIntoAds(copyText);
    const usableGroups = groups.length ? groups : parseCopyIntoAds(DEFAULT_COPY);
    const nextCreatives = expandedMedia.map((media, index): Creative => {
      const sections = usableGroups[index % usableGroups.length];
      return {
        id: uid(),
        photoUrl: media.url,
        mediaKind: media.kind,
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
    const draft = buildDraftState({
      creatives: nextCreatives,
      currentIndex: 0,
      view: "editor",
    });
    void persistProjectToCloud(draft, true).catch(() => setCloudStatus("Saved locally. Cloud save failed."));
  }, [buildBlocksForSections, buildDraftState, copyText, persistProjectToCloud, photoCopies, selectedMediaForAds]);

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
      setEditingText(getBlockText(block));
      setEditingOriginalLines([...block.lines]);
      setSelectedLayer({ type: "text", id: block.id });
      setTextSelection(null);
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

      if (selectedLayer?.type === "image") {
        dragRef.current = {
          kind: "move-image",
          active: false,
          clearOnClick: true,
          startX: point.x,
          startY: point.y,
          orig: { ...currentCreative.imageTransform },
        };
        setCanvasCursor("grabbing");
        return;
      }

      if (selectedLayer) {
        setSelectedLayer(null);
        return;
      }

      setSelectedLayer({ type: "image" });
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
    const drag = dragRef.current;
    if (drag?.kind === "move-image" && drag.clearOnClick && !drag.active) {
      setSelectedLayer(null);
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

      if (!typing && !meta && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        setCurrentIndex((index) => clamp(index + delta, 0, Math.max(0, creatives.length - 1)));
        setSelectedLayer(null);
        setContextMenu(null);
        setEditingBlockId(null);
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
  }, [creatives.length, deleteSelectedBlock, duplicateSelectedBlock, redo, selectedLayer, undo, view]);

  const renderCreativeToCanvas = useCallback(
    async (creative: Creative, pixelRatio = 2) => {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W * pixelRatio;
      canvas.height = CANVAS_H * pixelRatio;
      const ctx = canvas.getContext("2d")!;
      let media: HTMLImageElement | HTMLVideoElement | null = null;
      if ((creative.mediaKind || "image") === "video") {
        media = await loadVideoFrame(creative.photoUrl);
      } else {
        let image = imageCacheRef.current.get(creative.photoUrl) ?? null;
        if (!image) {
          image = await loadImage(creative.photoUrl);
          imageCacheRef.current.set(creative.photoUrl, image);
        }
        media = image;
      }
      drawArtwork(ctx, creative, media, pixelRatio);
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

  const upsertAiGeneration = useCallback((generation: StudioAIGeneration) => {
    setAiGenerations((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === generation.id || item.jobId === generation.jobId);
      if (existingIndex === -1) return [generation, ...prev].slice(0, 20);
      const next = [...prev];
      next[existingIndex] = { ...next[existingIndex], ...generation, media: generation.media ?? next[existingIndex].media };
      return next;
    });
  }, []);

  const loadAiGenerations = useCallback(async () => {
    if (!projectId) {
      setAiGenerations([]);
      return;
    }
    try {
      const res = await fetch(`/api/studio-2/ai/generations?projectId=${encodeURIComponent(projectId)}`);
      if (!res.ok) throw new Error("AI history load failed");
      const data = await res.json();
      setAiGenerations((data.generations || []).map((generation: Record<string, unknown>) => {
        const media = generation.media && typeof generation.media === "object" ? generation.media as Record<string, unknown> : null;
        return {
          id: String(generation.id || ""),
          jobId: String(generation.jobId || ""),
          prompt: String(generation.prompt || ""),
          status: String(generation.status || "queued"),
          resultUrl: typeof generation.resultUrl === "string" ? generation.resultUrl : null,
          mediaId: typeof generation.mediaId === "string" ? generation.mediaId : null,
          error: typeof generation.error === "string" ? generation.error : null,
          createdAt: typeof generation.createdAt === "string" ? generation.createdAt : undefined,
          media: media
            ? {
                id: String(media.id || ""),
                url: String(media.url || ""),
                kind: (media.kind === "video" ? "video" : "image") as MediaKind,
                filename: String(media.filename || "Generated ad.png"),
                folderId: typeof media.folderId === "string" ? media.folderId : null,
                createdAt: typeof media.createdAt === "string" ? media.createdAt : undefined,
              }
            : null,
        };
      }));
    } catch {
      setGenerateStatus("Could not load Generate history.");
    }
  }, [projectId]);

  useEffect(() => {
    if (view === "editor") void loadAiGenerations();
  }, [loadAiGenerations, view]);

  const pickGenerateReference = useCallback(async (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) {
      setGenerateStatus("Drop or select an image reference.");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setGenerateReference({ name: file.name || "Reference image", dataUrl });
      setGenerateStatus("");
    } catch {
      setGenerateStatus("Could not read that reference image.");
    }
  }, []);

  const buildHiggsfieldPrompt = useCallback(() => {
    const text = currentCreative?.textBlocks.map(getBlockText).filter(Boolean).join("\n\n") || copyText;
    return [
      generatePrompt.trim(),
      "",
      "Use this exact ad copy when it makes sense:",
      text,
      "",
      "Preserve readable text. Make the final image feel like a finished direct-response Instagram Story ad.",
    ].join("\n");
  }, [copyText, currentCreative?.textBlocks, generatePrompt]);

  const pollAiGeneration = useCallback(
    async (generationId: string) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1800 : 3500));
        const res = await fetch(`/api/studio-2/ai/generations/${encodeURIComponent(generationId)}`);
        if (!res.ok) throw new Error("Generation status failed");
        const data = await res.json();
        const generation = data.generation || {};
        const media = data.media || null;
        const nextGeneration: StudioAIGeneration = {
          id: String(generation.id || generationId),
          jobId: String(generation.jobId || ""),
          prompt: String(generation.prompt || ""),
          status: String(generation.status || "queued"),
          resultUrl: typeof generation.resultUrl === "string" ? generation.resultUrl : null,
          mediaId: typeof generation.mediaId === "string" ? generation.mediaId : null,
          error: typeof generation.error === "string" ? generation.error : null,
          createdAt: typeof generation.createdAt === "string" ? generation.createdAt : undefined,
          media: media
            ? {
                id: String(media.id),
                url: String(media.url),
                kind: "image",
                filename: String(media.filename || "Generated ad.png"),
                folderId: typeof media.folderId === "string" ? media.folderId : null,
                createdAt: typeof media.createdAt === "string" ? media.createdAt : undefined,
              }
            : null,
        };
        upsertAiGeneration(nextGeneration);

        if (media?.url) {
          const generatedAsset: StudioMediaAsset = {
            id: String(media.id),
            url: String(media.url),
            kind: "image",
            filename: String(media.filename || "Generated ad.png"),
            folderId: typeof media.folderId === "string" ? media.folderId : null,
            createdAt: typeof media.createdAt === "string" ? media.createdAt : undefined,
          };
          setLibraryMedia((prev) => prev.some((asset) => asset.id === generatedAsset.id) ? prev : [generatedAsset, ...prev]);
        }

        if (nextGeneration.status === "completed") {
          setGenerateStatus("Generated image saved to Media Library.");
          return;
        }
        if (nextGeneration.status === "failed") {
          throw new Error(nextGeneration.error || "Higgsfield generation failed");
        }
        setGenerateStatus(`Generating... ${attempt + 1}`);
      }
      throw new Error("Generation is still running. Check back in a minute.");
    },
    [upsertAiGeneration]
  );

  const startAiGeneration = useCallback(async () => {
    if (!currentCreative || generatingAd || !generatePrompt.trim()) return;
    setGeneratingAd(true);
    setGenerateStatus("Preparing selected ad...");
    try {
      const snapshotCanvas = await renderCreativeToCanvas(currentCreative, 1);
      const snapshotDataUrl = snapshotCanvas.toDataURL("image/png");
      setGenerateStatus("Starting Higgsfield job...");
      const res = await fetch("/api/studio-2/ai/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          creativeId: currentCreative.id,
          folderId: setupMediaFolderId,
          model: "gpt_image_2",
          prompt: buildHiggsfieldPrompt(),
          snapshotDataUrl,
          referenceDataUrl: generateReference?.dataUrl || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start Higgsfield generation");
      const generation = data.generation || {};
      const nextGeneration: StudioAIGeneration = {
        id: String(generation.id),
        jobId: String(generation.jobId || ""),
        prompt: String(generation.prompt || buildHiggsfieldPrompt()),
        status: String(generation.status || "queued"),
        resultUrl: null,
        mediaId: null,
      };
      upsertAiGeneration(nextGeneration);
      setGenerateStatus("Generating...");
      await pollAiGeneration(nextGeneration.id);
    } catch (err) {
      setGenerateStatus(err instanceof Error ? err.message : "Could not generate image.");
    } finally {
      setGeneratingAd(false);
    }
  }, [
    buildHiggsfieldPrompt,
    currentCreative,
    generateReference?.dataUrl,
    generatePrompt,
    generatingAd,
    pollAiGeneration,
    projectId,
    renderCreativeToCanvas,
    setupMediaFolderId,
    upsertAiGeneration,
  ]);

  const addGeneratedImageAsAd = useCallback((asset: StudioMediaAsset) => {
    pushUndo();
    setMediaAssets((prev) => prev.some((media) => media.url === asset.url) ? prev : [asset, ...prev]);
    setCreatives((prev) => {
      const nextCreative: Creative = {
        id: uid(),
        photoUrl: asset.url,
        mediaKind: "image",
        textBlocks: [],
        imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
        status: "draft",
      };
      setCurrentIndex(prev.length);
      return [...prev, nextCreative];
    });
    setSelectedLayer({ type: "image" });
    setEditorSidebarMode("edit");
    setGeneratedPreview(null);
  }, [pushUndo]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GENERATE_SPLIT_KEY);
      const parsed = saved ? Number(saved) : NaN;
      if (Number.isFinite(parsed)) setGenerateGalleryPercent(clamp(parsed, 26, 74));
    } catch {
      // Local preference only.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(GENERATE_SPLIT_KEY, String(Math.round(generateGalleryPercent)));
    } catch {
      // Local preference only.
    }
  }, [generateGalleryPercent]);

  useEffect(() => {
    let cancelled = false;
    if (editorSidebarMode !== "generate" || !currentCreative) {
      setGenerateSourcePreview("");
      return;
    }

    renderCreativeToCanvas(currentCreative, 0.25)
      .then((canvas) => {
        if (!cancelled) setGenerateSourcePreview(canvas.toDataURL("image/png"));
      })
      .catch(() => {
        if (!cancelled) setGenerateSourcePreview("");
      });

    return () => {
      cancelled = true;
    };
  }, [currentCreative, editorSidebarMode, renderCreativeToCanvas]);

  const startGenerateDividerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = generateWorkspaceRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();

    const update = (clientX: number) => {
      const nextGalleryPercent = ((rect.right - clientX) / rect.width) * 100;
      setGenerateGalleryPercent(clamp(Math.round(nextGalleryPercent), 26, 74));
    };

    update(event.clientX);

    const handleMove = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, []);

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
      const file = Array.from(event.dataTransfer.files).find((item) => {
        const contentType = getUploadContentType(item);
        return contentType.startsWith("image/") || contentType.startsWith("video/");
      });
      if (file) await replaceCurrentImage(file);
    },
    [replaceCurrentImage]
  );

  const openExportModal = useCallback(() => {
    setExportFolderName(projectName || "Studio 2.0 Ads");
    setExportApprovedOnly(false);
    setExportModalOpen(true);
  }, [projectName]);

  const resetLocalDraftState = useCallback(() => {
    setPhotos([]);
    setPhotoCopies({});
    setMediaAssets([]);
    setCreatives([]);
    setCurrentIndex(0);
    setCopyText(DEFAULT_COPY);
    setProjectId(null);
    setProjectFolderId(null);
    setProjectName(DEFAULT_PROJECT_NAME);
    setSelectedLayer(null);
    setUndoStack([]);
    setRedoStack([]);
    setRestoredAt(null);
    setSetupMediaFolderId(null);
  }, []);

  const openSetupFlow = useCallback(() => {
    setCreateMenuOpen(false);
    setFolderMenuOpen(false);
    setProjectId(null);
    setProjectFolderId(selectedFolderId);
    setPhotos([]);
    setPhotoCopies({});
    setMediaAssets([]);
    setCreatives([]);
    setCurrentIndex(0);
    setCopyText(DEFAULT_COPY);
    setProjectName(EMPTY_PROJECT_NAME);
    setSelectedLayer(null);
    setUndoStack([]);
    setRedoStack([]);
    setRestoredAt(null);
    setSetupMediaFolderId(null);
    setView("setup");
  }, [selectedFolderId]);

  const openHomeProject = useCallback(
    async (cardId: string) => {
      if (selectMode) {
        setSelectedDesignIds((prev) =>
          prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]
        );
        return;
      }
      if (cardId === activeDraftId) {
        setView(creatives.length ? "editor" : "setup");
        return;
      }
      try {
        const project = await getHomeProjectDetail(cardId);
        if (!project) throw new Error("Project not found");
        const draft = project.draft || {};
        const nextCreatives = (draft.creatives || []).map(normalizeCreative);
        setProjectId(project.id);
        setProjectFolderId(project.folderId || null);
        setPhotos(draft.photos || []);
        setPhotoCopies(draft.photoCopies || {});
        setMediaAssets(draft.mediaAssets || []);
        setCreatives(nextCreatives);
        setCurrentIndex(draft.currentIndex || 0);
        setCopyText(draft.copyText || project.copyText || DEFAULT_COPY);
        setProjectName(draft.projectName || project.name || EMPTY_PROJECT_NAME);
        setColorPreset(draft.colorPreset || "dark");
        setFontPreset(draft.fontPreset || FONT_OPTIONS[0].value);
        setSelectedLayer(null);
        setUndoStack([]);
        setRedoStack([]);
        setView(nextCreatives.length ? "editor" : "setup");
      } catch {
        setCloudStatus("Could not open that cloud project yet.");
      }
    },
    [activeDraftId, creatives.length, getHomeProjectDetail, selectMode]
  );

  const duplicateHomeProject = useCallback(
    async (cardId: string) => {
      try {
        const project = await getHomeProjectDetail(cardId);
        if (!project) throw new Error("Project not found");
        const copyName = `${project.name || EMPTY_PROJECT_NAME} copy`;
        const draft = {
          ...(project.draft || {}),
          projectId: null,
          projectName: copyName,
          savedAt: Date.now(),
        };
        const res = await fetch("/api/studio-2/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            folderId: project.folderId || null,
            name: copyName,
            copyText: project.copyText || "",
            draft,
            thumbnailUrl: project.thumbnailUrl || null,
            status: project.status || "draft",
          }),
        });
        if (!res.ok) throw new Error("Duplicate failed");
        setCardMenuId(null);
        setCloudStatus("Project duplicated.");
        void fetchStudioHome();
      } catch {
        setCloudStatus("Could not duplicate that project.");
      }
    },
    [fetchStudioHome, getHomeProjectDetail]
  );

  const createStudioFolder = useCallback(async (
    name: string,
    folderType: StudioFolderType = "design",
    parentId: string | null = null
  ) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const existing = cloudFolders.find((folder) =>
      folder.name.toLowerCase() === trimmed.toLowerCase() &&
      (folder.folderType || "design") === folderType &&
      (folder.parentId || null) === parentId
    );
    if (existing) return existing.id;
    const res = await fetch("/api/studio-2/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: trimmed, folderType, parentId }),
    });
    if (!res.ok) throw new Error("Folder create failed");
    const data = await res.json() as { folder?: StudioFolder };
    if (!data.folder?.id) throw new Error("Folder create failed");
    setCloudFolders((prev) => [...prev, data.folder!].sort((a, b) => a.name.localeCompare(b.name)));
    return data.folder.id;
  }, [cloudFolders]);

  const toggleHomeFolderSelection = useCallback((folderId: string) => {
    setSelectedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  }, []);

  const toggleMediaSelection = useCallback((mediaId: string) => {
    setSelectedMediaIds((prev) =>
      prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId]
    );
  }, []);

  const toggleDesignSelectionFromMenu = useCallback((designId: string) => {
    setSelectMode(true);
    setSelectedDesignIds((prev) =>
      prev.includes(designId) ? prev.filter((id) => id !== designId) : [...prev, designId]
    );
    setCardMenuId(null);
  }, []);

  const toggleFolderSelectionFromMenu = useCallback((folderId: string) => {
    setSelectMode(true);
    setSelectedFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
    setFolderCardMenuId(null);
  }, []);

  const toggleMediaFolderSelection = useCallback((folderId: string) => {
    setSelectedMediaFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
  }, []);

  const toggleMediaFolderSelectionFromMenu = useCallback((folderId: string) => {
    setSelectMode(true);
    setSelectedMediaFolderIds((prev) =>
      prev.includes(folderId) ? prev.filter((id) => id !== folderId) : [...prev, folderId]
    );
    setFolderCardMenuId(null);
  }, []);

  const toggleMediaSelectionFromMenu = useCallback((mediaId: string) => {
    setSelectMode(true);
    setSelectedMediaIds((prev) =>
      prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId]
    );
    setMediaCardMenuId(null);
  }, []);

  const hideDesignFolder = useCallback((folderId: string) => {
    setHiddenDesignFolderIds((prev) => (prev.includes(folderId) ? prev : [...prev, folderId]));
    setSelectedFolderIds((prev) => prev.filter((id) => id !== folderId));
    setFolderCardMenuId(null);
    setCloudStatus("Folder hidden.");
  }, []);

  const moveMediaToFolder = useCallback(async (folderId: string | null, mediaIds: string[]) => {
    const ids = [...new Set(mediaIds)].filter(Boolean);
    if (!ids.length) return;
    try {
      await Promise.all(
        ids.map(async (mediaId) => {
          const res = await fetch(`/api/studio-2/media/${mediaId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folderId }),
          });
          if (!res.ok) throw new Error("Media move failed");
        })
      );
      setLibraryMedia((prev) => prev.map((asset) => (
        ids.includes(asset.id) ? { ...asset, folderId } : asset
      )));
      setSelectedMediaIds((prev) => prev.filter((id) => !ids.includes(id)));
      setDragOverFolderId(null);
      setDraggedMediaIds([]);
      setCloudStatus(`${ids.length} media item${ids.length === 1 ? "" : "s"} moved.`);
      void fetchStudioMedia();
    } catch {
      setCloudStatus("Could not move that media.");
    }
  }, [fetchStudioMedia]);

  const confirmDeleteFolders = useCallback(async () => {
    const ids = deleteFolderIds;
    if (!ids.length || deletingFolder) return;
    setDeletingFolder(true);
    setDeleteFolderStatus("Deleting...");
    try {
      await Promise.all(
        ids.map(async (folderId) => {
          const res = await fetch(`/api/studio-2/folders/${folderId}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Folder delete failed");
        })
      );
      setCloudFolders((prev) => prev.filter((folder) => !ids.includes(folder.id)));
      setCloudProjects((prev) => prev.map((project) => (
        project.folderId && ids.includes(project.folderId) ? { ...project, folderId: null } : project
      )));
      setLibraryMedia((prev) => prev.map((asset) => (
        asset.folderId && ids.includes(asset.folderId) ? { ...asset, folderId: null } : asset
      )));
      setProjectFolderId((current) => (current && ids.includes(current) ? null : current));
      if (selectedFolderId && ids.includes(selectedFolderId)) setSelectedFolderId(null);
      if (selectedMediaFolderId && ids.includes(selectedMediaFolderId)) setSelectedMediaFolderId(null);
      if (setupMediaFolderId && ids.includes(setupMediaFolderId)) setSetupMediaFolderId(null);
      setSelectedFolderIds((prev) => prev.filter((id) => !ids.includes(id)));
      setSelectedMediaFolderIds((prev) => prev.filter((id) => !ids.includes(id)));
      setHiddenDesignFolderIds((prev) => prev.filter((id) => !ids.includes(id)));
      setFolderCardMenuId(null);
      setDeleteFolderIds([]);
      setDeleteFolderStatus("");
      setCloudStatus(ids.length === 1 ? "Folder deleted." : "Folders deleted.");
      await Promise.all([fetchStudioHome(), fetchStudioMedia()]);
    } catch {
      setDeleteFolderStatus("Could not delete that folder.");
    } finally {
      setDeletingFolder(false);
    }
  }, [
    deleteFolderIds,
    deletingFolder,
    fetchStudioHome,
    fetchStudioMedia,
    selectedFolderId,
    selectedMediaFolderId,
    setupMediaFolderId,
  ]);

  const addHomeProjectToFolder = useCallback(
    async (cardId: string, folderId: string) => {
      try {
        if (!folderId) return;

        let targetId = cardId;
        const movingActiveProject = cardId === activeDraftId || cardId === projectId;
        if (cardId === activeDraftId && !projectId) {
          const draft = buildDraftState();
          const res = await fetch("/api/studio-2/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              folderId,
              name: draft.projectName || EMPTY_PROJECT_NAME,
              copyText: draft.copyText,
              draft: { ...draft, projectFolderId: folderId, folderId },
              thumbnailUrl: draft.creatives[0]?.photoUrl || draft.photos[0] || null,
              status: draft.creatives.length ? "in_progress" : "draft",
            }),
          });
          if (!res.ok) throw new Error("Project save failed");
          const data = await res.json() as { project?: { id?: string } };
          if (!data.project?.id) throw new Error("Project save failed");
          targetId = data.project.id;
          setProjectId(targetId);
        }

        const res = await fetch(`/api/studio-2/projects/${targetId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId }),
        });
        if (!res.ok) throw new Error("Folder update failed");
        setCloudProjects((prev) => prev.map((project) => (
          project.id === targetId ? { ...project, folderId } : project
        )));
        if (movingActiveProject) setProjectFolderId(folderId);
        setCardMenuId(null);
        setFolderPickerProjectId(null);
        setFolderPickerStatus("");
        setNewFolderName("");
        setCloudStatus("Project added to folder.");
        void fetchStudioHome();
      } catch {
        setFolderPickerStatus("Could not add that project to a folder.");
      }
    },
    [activeDraftId, buildDraftState, fetchStudioHome, projectId]
  );

  const moveDesignsToFolder = useCallback(async (folderId: string, designIds: string[]) => {
    const ids = [...new Set(designIds)].filter(Boolean);
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => addHomeProjectToFolder(id, folderId)));
      setCloudProjects((prev) => prev.map((project) => (
        ids.includes(project.id) ? { ...project, folderId } : project
      )));
      setSelectedDesignIds((prev) => prev.filter((id) => !ids.includes(id)));
      setDraggedDesignIds([]);
      setDragOverFolderId(null);
      setCloudStatus(`${ids.length} design${ids.length === 1 ? "" : "s"} moved.`);
      void fetchStudioHome();
    } catch {
      setCloudStatus("Could not move those designs.");
    }
  }, [addHomeProjectToFolder, fetchStudioHome]);

  const addHomeProjectToNewFolder = useCallback(async () => {
    if (!folderPickerProjectId || !newFolderName.trim() || savingFolderPick) return;
    setSavingFolderPick(true);
    setFolderPickerStatus("Creating folder...");
    try {
      const folderId = await createStudioFolder(newFolderName);
      if (!folderId) return;
      await addHomeProjectToFolder(folderPickerProjectId, folderId);
    } catch {
      setFolderPickerStatus("Could not create that folder.");
    } finally {
      setSavingFolderPick(false);
    }
  }, [addHomeProjectToFolder, createStudioFolder, folderPickerProjectId, newFolderName, savingFolderPick]);

  const createHomeFolder = useCallback(async () => {
    if (!homeFolderName.trim() || savingHomeFolder) return;
    setSavingHomeFolder(true);
    setHomeFolderStatus("Creating folder...");
    try {
      const folderId = await createStudioFolder(
        homeFolderName,
        homeMode === "media" ? "media" : "design",
        homeMode === "media" ? selectedMediaFolderId : null
      );
      if (folderId && homeMode === "designs") setSelectedFolderId(folderId);
      setSelectedFolderIds([]);
      setSelectedMediaFolderIds([]);
      setHomeFolderName("");
      setHomeFolderStatus("");
      setCreateFolderModalOpen(false);
      setCloudStatus("Folder created.");
      void fetchStudioHome();
    } catch {
      setHomeFolderStatus("Could not create that folder.");
    } finally {
      setSavingHomeFolder(false);
    }
  }, [createStudioFolder, fetchStudioHome, homeFolderName, homeMode, savingHomeFolder, selectedMediaFolderId]);

  const confirmDeleteHomeProject = useCallback(
    async () => {
      const cardId = deleteProjectId;
      if (!cardId || deletingProject) return;
      setDeletingProject(true);
      setDeleteProjectStatus("Deleting...");
      try {
        if (cardId === activeDraftId && !projectId) {
          await clearDraft();
          resetLocalDraftState();
          setCardMenuId(null);
          setSelectedDesignIds((prev) => prev.filter((id) => id !== cardId));
          setDeleteProjectId(null);
          setDeleteProjectStatus("");
          setCloudStatus("Project deleted.");
          return;
        }

        const res = await fetch(`/api/studio-2/projects/${cardId}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        setCloudProjects((prev) => prev.filter((project) => project.id !== cardId));
        if (cardId === projectId) {
          await clearDraft();
          resetLocalDraftState();
        }
        setCardMenuId(null);
        setSelectedDesignIds((prev) => prev.filter((id) => id !== cardId));
        setDeleteProjectId(null);
        setDeleteProjectStatus("");
        setCloudStatus("Project deleted.");
        void fetchStudioHome();
      } catch {
        setDeleteProjectStatus("Could not delete that project.");
      } finally {
        setDeletingProject(false);
      }
    },
    [activeDraftId, deleteProjectId, deletingProject, fetchStudioHome, projectId, resetLocalDraftState]
  );

  const confirmDeleteMedia = useCallback(async () => {
    const mediaId = deleteMediaId;
    if (!mediaId || deletingMedia) return;
    setDeletingMedia(true);
    setDeleteMediaStatus("Deleting...");
    try {
      const target = libraryMedia.find((asset) => asset.id === mediaId);
      const res = await fetch(`/api/studio-2/media/${mediaId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Media delete failed");
      if (target) {
        setPhotos((prev) => prev.filter((photo) => photo !== target.url));
        setMediaAssets((prev) => prev.filter((asset) => asset.url !== target.url));
        setPhotoCopies((prev) => {
          const next = { ...prev };
          delete next[target.url];
          return next;
        });
      }
      setDeleteMediaId(null);
      setDeleteMediaStatus("");
      setMediaCardMenuId(null);
      setCloudStatus("Media deleted.");
      await fetchStudioMedia();
    } catch {
      setDeleteMediaStatus("Could not delete that media.");
    } finally {
      setDeletingMedia(false);
    }
  }, [deleteMediaId, deletingMedia, fetchStudioMedia, libraryMedia]);

  const renderUploadDestinationControls = () => (
    <div
      style={{
        border: `1px solid ${ADS_BRAND.border2}`,
        borderRadius: 10,
        background: ADS_BRAND.panel3,
        padding: 12,
        marginBottom: 14,
      }}
    >
      <label style={{ ...labelStyle, display: "block", marginBottom: 7 }}>Media folder</label>
      <select
        value={uploadTargetFolderId || ""}
        onChange={(event) => {
          setUploadTargetFolderId(event.target.value || null);
          setShareLinkStatus("");
        }}
        style={{ ...inputStyle, height: 38, marginBottom: 10 }}
      >
        <option value="">All Media</option>
        {mediaFolders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.parentId ? "- " : ""}{folder.name}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          readOnly
          value={uploadShareUrl || "Pick a folder to create a client upload link"}
          onFocus={(event) => event.currentTarget.select()}
          style={{
            ...inputStyle,
            height: 38,
            flex: 1,
            color: uploadShareUrl ? ADS_BRAND.text2 : ADS_BRAND.text3,
          }}
        />
        <button
          type="button"
          onClick={() => void copyUploadShareLink()}
          disabled={!uploadShareUrl}
          style={{
            ...buttonStyle(false),
            height: 38,
            opacity: uploadShareUrl ? 1 : 0.42,
            cursor: uploadShareUrl ? "pointer" : "not-allowed",
            whiteSpace: "nowrap",
          }}
        >
          <Copy size={14} /> Copy link
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: ADS_BRAND.text3, fontSize: 11, marginTop: 8 }}>
        <Link2 size={12} />
        <span>{shareLinkStatus || "The link only opens a media upload page for this folder."}</span>
      </div>
    </div>
  );

  const renderGenerateWorkspace = () => {
    const canGenerate = !!currentCreative && !!generatePrompt.trim() && !generatingAd;

    return (
      <div
        ref={generateWorkspaceRef}
        style={{
          display: "flex",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          background: ADS_BRAND.bg,
        }}
      >
        <section
          style={{
            flex: "1 1 0",
            minWidth: 360,
            display: "flex",
            flexDirection: "column",
            borderRight: `1px solid ${ADS_BRAND.border}`,
            background: ADS_BRAND.panel,
          }}
        >
          <div style={{ height: 50, display: "flex", alignItems: "center", gap: 10, padding: "0 18px", borderBottom: `1px solid ${ADS_BRAND.border}` }}>
            <button
              type="button"
              onClick={() => setEditorSidebarMode("edit")}
              style={{ ...buttonStyle(false), height: 32, padding: "0 10px" }}
            >
              <ArrowLeft size={13} /> Edit
            </button>
            <Sparkles size={16} color={ADS_BRAND.gold} />
            <span style={{ color: ADS_BRAND.text, fontSize: 14, fontWeight: 850 }}>Generate</span>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px 28px 18px" }}>
            {generateStatus && (
              <div
                style={{
                  maxWidth: 720,
                  margin: "0 auto 18px",
                  border: `1px solid ${ADS_BRAND.border2}`,
                  borderRadius: 12,
                  background: ADS_BRAND.panel2,
                  color: generateStatus.toLowerCase().includes("could") || generateStatus.toLowerCase().includes("failed") ? "#ff9b9b" : ADS_BRAND.text2,
                  fontSize: 13,
                  lineHeight: 1.5,
                  padding: "12px 14px",
                }}
              >
                {generateStatus}
              </div>
            )}
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault();
              setGenerateDropActive(true);
            }}
            onDragLeave={() => setGenerateDropActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setGenerateDropActive(false);
              void pickGenerateReference(event.dataTransfer.files?.[0] || null);
            }}
            onPaste={(event) => {
              const file = Array.from(event.clipboardData.files || []).find((item) => item.type.startsWith("image/"));
              if (file) void pickGenerateReference(file);
            }}
            style={{
              margin: "0 auto 22px",
              width: "min(760px, calc(100% - 48px))",
              minHeight: 206,
              borderRadius: 22,
              border: `1px solid ${generateDropActive ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
              background: generateDropActive ? ADS_BRAND.goldSoft : ADS_BRAND.panel2,
              boxShadow: "0 18px 60px rgba(0,0,0,0.25)",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 13,
            }}
          >
            <div style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 58 }}>
              <div
                style={{
                  width: 58,
                  height: 58,
                  borderRadius: 9,
                  overflow: "hidden",
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.bgDeep,
                  flexShrink: 0,
                }}
                title="Source ad"
              >
                {generateSourcePreview ? (
                  <img src={generateSourcePreview} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: ADS_BRAND.text3 }}>
                    <ImagePlus size={18} />
                  </div>
                )}
              </div>

              {generateReference && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    height: 42,
                    maxWidth: 210,
                    border: `1px solid ${ADS_BRAND.border2}`,
                    background: ADS_BRAND.panel3,
                    borderRadius: 10,
                    padding: "5px 7px",
                    color: ADS_BRAND.text2,
                    fontSize: 11,
                    fontWeight: 750,
                  }}
                  title={generateReference.name}
                >
                  <img src={generateReference.dataUrl} alt="" style={{ width: 30, height: 30, objectFit: "cover", borderRadius: 7, flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{generateReference.name}</span>
                  <button
                    type="button"
                    onClick={() => setGenerateReference(null)}
                    style={{ border: "none", background: "transparent", color: ADS_BRAND.text3, cursor: "pointer", padding: 0, display: "flex" }}
                    title="Remove reference"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => generateReferenceInputRef.current?.click()}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.panel3,
                  color: ADS_BRAND.text2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  marginLeft: generateReference ? 0 : "auto",
                }}
                title="Add reference image"
              >
                <Plus size={21} />
              </button>
              <input
                ref={generateReferenceInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  void pickGenerateReference(event.currentTarget.files?.[0] || null);
                  event.currentTarget.value = "";
                }}
              />
            </div>

            <textarea
              value={generatePrompt}
              onChange={(event) => setGeneratePrompt(event.target.value)}
              rows={3}
              style={{
                width: "100%",
                minHeight: 78,
                border: "none",
                outline: "none",
                resize: "vertical",
                background: "transparent",
                color: ADS_BRAND.text,
                fontFamily: "inherit",
                fontSize: 17,
                lineHeight: 1.45,
              }}
              placeholder="Describe what you want to generate..."
            />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                onClick={() => void startAiGeneration()}
                disabled={!canGenerate}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  border: "none",
                  background: canGenerate ? "#a7f3ff" : ADS_BRAND.border2,
                  color: canGenerate ? "#061214" : ADS_BRAND.text3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: canGenerate ? "pointer" : "not-allowed",
                  opacity: canGenerate ? 1 : 0.55,
                }}
                title="Generate"
              >
                {generatingAd ? <Sparkles size={18} /> : <ArrowLeft size={20} style={{ transform: "rotate(90deg)" }} />}
              </button>
            </div>
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startGenerateDividerDrag}
          style={{
            width: 14,
            flexShrink: 0,
            cursor: "col-resize",
            background: ADS_BRAND.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          title="Resize gallery"
        >
          <div style={{ width: 3, height: 72, borderRadius: 999, background: ADS_BRAND.border2 }} />
        </div>

        <section
          style={{
            flex: `0 0 ${generateGalleryPercent}%`,
            minWidth: 320,
            maxWidth: "74%",
            minHeight: 0,
            overflowY: "auto",
            padding: "18px 18px 28px",
            background: ADS_BRAND.bg,
          }}
        >
          <div style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 14 }}>
            <div
              style={{
                height: 34,
                borderRadius: 999,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.active,
                color: ADS_BRAND.text,
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "0 13px",
                fontSize: 13,
                fontWeight: 800,
              }}
            >
              <ImagePlus size={15} />
              Gallery {aiGenerations.length || ""}
            </div>
          </div>

          {aiGenerations.length ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {aiGenerations.map((generation) => {
                const imageUrl = generation.media?.url || generation.resultUrl || "";
                const asset = generation.media || (imageUrl ? {
                  id: generation.mediaId || generation.id || generation.jobId || imageUrl,
                  url: imageUrl,
                  kind: "image" as MediaKind,
                  filename: "Generated ad.png",
                  folderId: null,
                  createdAt: generation.createdAt,
                } : null);
                const ready = generation.status === "completed" && imageUrl;
                return (
                  <button
                    key={generation.id || generation.jobId}
                    type="button"
                    disabled={!asset}
                    onClick={() => {
                      if (asset) setGeneratedPreview({ generation, asset });
                    }}
                    style={{
                      position: "relative",
                      border: `1px solid ${ADS_BRAND.border2}`,
                      borderRadius: 10,
                      overflow: "hidden",
                      background: ADS_BRAND.panel3,
                      padding: 0,
                      cursor: asset ? "pointer" : "default",
                      textAlign: "left",
                    }}
                    title={asset ? "Open preview" : generation.status}
                  >
                    {imageUrl ? (
                      <img src={getMediaPreviewSrc(imageUrl)} alt="" style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover", display: "block" }} />
                    ) : (
                      <div style={{ aspectRatio: "9 / 16", display: "flex", alignItems: "center", justifyContent: "center", color: ADS_BRAND.text3 }}>
                        <Sparkles size={24} />
                      </div>
                    )}
                    {!ready && (
                      <span
                        style={{
                          position: "absolute",
                          left: 9,
                          top: 9,
                          borderRadius: 999,
                          background: "rgba(0,0,0,0.72)",
                          color: ADS_BRAND.gold,
                          fontSize: 10,
                          fontWeight: 900,
                          padding: "4px 8px",
                          textTransform: "uppercase",
                        }}
                      >
                        {generation.status || "queued"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                minHeight: 280,
                border: `1px dashed ${ADS_BRAND.border2}`,
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: ADS_BRAND.text3,
                fontSize: 13,
              }}
            >
              Generated images will appear here.
            </div>
          )}
        </section>
      </div>
    );
  };

  if (view === "home") {
    return (
      <div
        className="ad-studio-fullbleed"
        onClick={() => {
          setCreateMenuOpen(false);
          setFolderMenuOpen(false);
          setCardMenuId(null);
          setMediaCardMenuId(null);
          setFolderCardMenuId(null);
        }}
        style={{
          minHeight: "100vh",
          background: ADS_BRAND.bg,
          color: ADS_BRAND.text,
          fontFamily: "var(--font-geist-sans), system-ui, -apple-system, sans-serif",
        }}
      >
        <style>{`
          .studio2-design-card:hover {
            border-color: ${ADS_BRAND.border2};
            background: ${ADS_BRAND.panel2};
            transform: translateY(-1px);
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
            background: ${ADS_BRAND.panel2} !important;
          }
          .studio2-card-menu-button:hover {
            background: rgba(0,0,0,0.76);
            color: ${ADS_BRAND.text};
          }
          .studio2-folder-choice:hover {
            background: ${ADS_BRAND.panel2} !important;
          }
        `}</style>

        <div style={{
          height: 80,
          borderBottom: `1px solid ${ADS_BRAND.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "0 40px",
        }}>
          <h1 style={{ margin: 0, color: ADS_BRAND.text, fontSize: 26, fontWeight: 600, letterSpacing: 0 }}>
            Studio 2.0
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
            <label style={{
              width: 330,
              height: 42,
              border: `1px solid ${ADS_BRAND.border2}`,
              borderRadius: 8,
              background: ADS_BRAND.panel,
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "0 12px",
              color: ADS_BRAND.text3,
            }}>
              <Search size={17} />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder={homeMode === "media" ? "Search media..." : "Search designs..."}
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: ADS_BRAND.text,
                  fontFamily: "inherit",
                  fontSize: 15,
                  fontWeight: 400,
                }}
              />
            </label>
            {(homeMode === "designs" || homeMode === "media") && (
              <button
                style={{
                  height: 42,
                  border: `1px solid ${selectMode ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                  borderRadius: 8,
                  background: selectMode ? ADS_BRAND.goldSoft : ADS_BRAND.panel,
                  color: selectMode ? ADS_BRAND.gold : ADS_BRAND.text2,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 12px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 650,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelectMode((active) => {
                    if (active) {
                      setSelectedDesignIds([]);
                      setSelectedFolderIds([]);
                      setSelectedMediaFolderIds([]);
                      setSelectedMediaIds([]);
                    }
                    return !active;
                  });
                  setCreateMenuOpen(false);
                  setFolderMenuOpen(false);
                  setCardMenuId(null);
                  setMediaCardMenuId(null);
                  setFolderCardMenuId(null);
                }}
              >
                <Square size={16} />
                {selectMode && selectedVisibleCount ? `${selectedVisibleCount} Selected` : "Select"}
              </button>
            )}
            {selectMode && (
              (homeMode === "designs" && selectedFolderIds.length > 0) ||
              (homeMode === "media" && selectedMediaFolderIds.length > 0)
            ) && (
              <button
                style={{
                  height: 42,
                  border: "1px solid rgba(255,107,107,0.45)",
                  borderRadius: 8,
                  background: "rgba(255,107,107,0.12)",
                  color: "#ff9b9b",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "0 12px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 650,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setDeleteFolderIds(homeMode === "media" ? selectedMediaFolderIds : selectedFolderIds);
                  setDeleteFolderStatus("");
                }}
              >
                <Trash2 size={16} />
                Delete
              </button>
            )}
            <button
              aria-label="Folders"
              style={{
                ...studioHomeIconButtonStyle,
                border: `1px solid ${selectedFolderId || homeMode === "media" ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                color: selectedFolderId || homeMode === "media" ? ADS_BRAND.gold : ADS_BRAND.text2,
              }}
              onClick={(event) => {
                event.stopPropagation();
                setFolderMenuOpen((open) => !open);
                setCreateMenuOpen(false);
                setCardMenuId(null);
                setMediaCardMenuId(null);
                setFolderCardMenuId(null);
              }}
            >
              <Folder size={17} />
            </button>
            <div style={{ position: "relative" }}>
              <button
                style={{
                  height: 42,
                  border: "none",
                  borderRadius: 8,
                  background: ADS_BRAND.gold,
                  color: ADS_BRAND.bgDeep,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "0 16px",
                  fontFamily: "inherit",
                  fontSize: 14,
                  fontWeight: 600,
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  setCreateMenuOpen((open) => !open);
                  setFolderMenuOpen(false);
                  setFolderCardMenuId(null);
                }}
              >
                <Plus size={16} /> Create <ChevronDown size={14} />
              </button>
            </div>
            {folderMenuOpen && (
              <div
                className="studio2-create-menu"
                onClick={(event) => event.stopPropagation()}
                style={{
                  position: "absolute",
                  right: 138,
                  top: 50,
                  width: 224,
                  zIndex: 10,
                  padding: 7,
                  borderRadius: 8,
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.panel,
                  boxShadow: "0 22px 70px rgba(0,0,0,0.45)",
                }}
              >
                {hiddenDesignFolders.length ? hiddenDesignFolders.map((folder) => (
                  <HomeMenuButton
                    key={folder.id}
                    icon={Folder}
                    label={folder.name}
                    onClick={() => {
                      setHomeMode("designs");
                      setSelectedFolderId(folder.id);
                      setSelectedMediaFolderId(null);
                      setSelectedFolderIds([]);
                      setSelectedMediaFolderIds([]);
                      setSelectedMediaIds([]);
                      setFolderMenuOpen(false);
                    }}
                  />
                )) : (
                  <div style={{ color: ADS_BRAND.text3, fontSize: 12, padding: "9px 10px" }}>No hidden folders</div>
                )}
                <div style={{ height: 1, background: ADS_BRAND.border, margin: "7px 3px" }} />
                <HomeMenuButton
                  icon={Library}
                  label="Media Library"
                  onClick={() => {
                    setHomeMode("media");
                    setSelectedFolderId(null);
                    setSelectedMediaFolderId(null);
                    setSelectMode(false);
                    setSelectedDesignIds([]);
                    setSelectedFolderIds([]);
                    setSelectedMediaFolderIds([]);
                    setSelectedMediaIds([]);
                    setFolderMenuOpen(false);
                  }}
                />
              </div>
            )}
            {createMenuOpen && (
              <div
                className="studio2-create-menu"
                onClick={(event) => event.stopPropagation()}
                style={{
                  position: "absolute",
                  right: 0,
                  top: 50,
                  width: 238,
                  zIndex: 10,
                  padding: 7,
                  borderRadius: 8,
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.panel,
                  boxShadow: "0 22px 70px rgba(0,0,0,0.45)",
                }}
              >
                {homeMode === "designs" && (
                  <>
                    <HomeMenuButton icon={FilePlus2} label="New design" onClick={openSetupFlow} />
                    <HomeMenuButton
                      icon={Upload}
                      label="Upload media"
                      onClick={() => openUploadMediaModal(null)}
                    />
                  </>
                )}
                {homeMode === "media" && (
                  <HomeMenuButton
                    icon={Upload}
                    label="Upload media"
                    onClick={() => openUploadMediaModal(selectedMediaFolderId)}
                  />
                )}
                <HomeMenuButton
                  icon={FolderPlus}
                  label="Create folder"
                  onClick={() => {
                    setCreateMenuOpen(false);
                    setHomeFolderName("");
                    setHomeFolderStatus("");
                    setCreateFolderModalOpen(true);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <main style={{ padding: "34px 40px 70px" }}>
            {homeMode === "designs" && selectedFolder && (
              <div style={{ marginBottom: 28, display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFolderId(null);
                    setSelectedDesignIds([]);
                    setSelectedFolderIds([]);
                    setSelectedMediaFolderIds([]);
                  }}
                  style={homeBackButtonStyle}
                >
                  <ArrowLeft size={15} /> Back to home
                </button>
                <div>
                  <div style={homeKickerStyle}>Design folder</div>
                  <div style={homeCrumbTitleStyle}>{selectedFolder.name}</div>
                </div>
              </div>
            )}

            {homeMode === "media" && (
              <div style={{ marginBottom: 28, display: "flex", alignItems: "center", gap: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (currentMediaFolder?.parentId) {
                      setSelectedMediaFolderId(currentMediaFolder.parentId);
                      setSelectedMediaFolderIds([]);
                      setSelectedMediaIds([]);
                      return;
                    }
                    setSelectedMediaFolderId(null);
                    setSelectedMediaFolderIds([]);
                    setSelectedMediaIds([]);
                    if (!currentMediaFolder) setHomeMode("designs");
                  }}
                  style={homeBackButtonStyle}
                >
                  <ArrowLeft size={15} /> {currentMediaFolder ? "Back to media library" : "Back to designs"}
                </button>
                <div>
                  <div style={homeKickerStyle}>Media Library</div>
                  <div style={homeCrumbTitleStyle}>{currentMediaFolder?.name || "All Media"}</div>
                </div>
              </div>
            )}

            {homeMode === "designs" ? (
              <>
                {!selectedFolder && <HomeSectionTitle title="Folders" />}
                {!selectedFolder && (
                  <div style={homeGridStyle}>
                    <div
                      role="button"
                      tabIndex={0}
                      className="studio2-design-card"
                      onClick={() => {
                        setHomeMode("media");
                        setSelectedFolderId(null);
                        setSelectedMediaFolderId(null);
                        setSelectMode(false);
                        setSelectedDesignIds([]);
                        setSelectedFolderIds([]);
                        setSelectedMediaFolderIds([]);
                        setSelectedMediaIds([]);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setHomeMode("media");
                          setSelectedFolderId(null);
                          setSelectedMediaFolderId(null);
                          setSelectMode(false);
                          setSelectedDesignIds([]);
                          setSelectedFolderIds([]);
                          setSelectedMediaFolderIds([]);
                          setSelectedMediaIds([]);
                        }
                      }}
                      style={{ ...folderCardStyle, position: "relative", overflow: "hidden" }}
                    >
                      <div style={folderThumbStyle}>
                        <Library size={38} strokeWidth={1.7} />
                      </div>
                      <div style={homeCardBodyStyle}>
                        <div style={homeCardTitleStyle}>Media Library</div>
                      </div>
                    </div>
                    {visibleDesignFolders.map((folder) => {
                      const isSelected = selectedFolderIds.includes(folder.id);
                      const isDropTarget = dragOverFolderId === folder.id && draggedDesignIds.length > 0;
                      return (
                        <div
                          key={folder.id}
                          role="button"
                          tabIndex={0}
                          className="studio2-design-card"
                          onClick={() => {
                            if (selectMode) {
                              toggleHomeFolderSelection(folder.id);
                              return;
                            }
                            setSelectedFolderId(folder.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              if (selectMode) toggleHomeFolderSelection(folder.id);
                              else setSelectedFolderId(folder.id);
                            }
                          }}
                          onDragEnter={(event) => {
                            if (!draggedDesignIds.length) return;
                            event.preventDefault();
                            setDragOverFolderId(folder.id);
                          }}
                          onDragOver={(event) => {
                            if (!draggedDesignIds.length) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDragOverFolderId(folder.id);
                          }}
                          onDragLeave={(event) => {
                            const nextTarget = event.relatedTarget as Node | null;
                            if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                              setDragOverFolderId(null);
                            }
                          }}
                          onDrop={(event) => {
                            if (!draggedDesignIds.length) return;
                            event.preventDefault();
                            event.stopPropagation();
                            void moveDesignsToFolder(folder.id, draggedDesignIds);
                          }}
                          style={{
                            ...folderCardStyle,
                            position: "relative",
                            overflow: "visible",
                            border: `1px solid ${isDropTarget || isSelected ? ADS_BRAND.gold : ADS_BRAND.border}`,
                            background: isDropTarget ? ADS_BRAND.goldSoft : ADS_BRAND.panel,
                            boxShadow: isDropTarget
                              ? "0 0 0 3px rgba(212,178,122,0.18), 0 18px 50px rgba(0,0,0,0.35)"
                              : isSelected ? "0 0 0 2px rgba(212,178,122,0.16)" : "none",
                          }}
                        >
                          <button
                            className="studio2-card-menu-button"
                            aria-label="Folder options"
                            onClick={(event) => {
                              event.stopPropagation();
                              setFolderCardMenuId((openId) => (openId === folder.id ? null : folder.id));
                              setCardMenuId(null);
                              setMediaCardMenuId(null);
                              setCreateMenuOpen(false);
                              setFolderMenuOpen(false);
                            }}
                            style={cardMenuButtonStyle}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                          {selectMode && (
                            <span style={selectBadgeStyle(isSelected)}>
                              {isSelected && <CheckCircle2 size={15} />}
                            </span>
                          )}
                          {folderCardMenuId === folder.id && (
                            <div className="studio2-create-menu" onClick={(event) => event.stopPropagation()} style={cardMenuStyle}>
                              <HomeMenuButton
                                icon={Square}
                                label={isSelected ? "Deselect" : "Select"}
                                onClick={() => toggleFolderSelectionFromMenu(folder.id)}
                              />
                              {selectedDesignIds.length > 0 && (
                                <HomeMenuButton
                                  icon={FolderPlus}
                                  label={`Move ${selectedDesignIds.length} selected here`}
                                  onClick={() => {
                                    setFolderCardMenuId(null);
                                    void moveDesignsToFolder(folder.id, selectedDesignIds);
                                  }}
                                />
                              )}
                              <HomeMenuButton
                                icon={EyeOff}
                                label="Hide"
                                onClick={() => hideDesignFolder(folder.id)}
                              />
                              <HomeMenuButton
                                icon={Trash2}
                                label="Delete"
                                onClick={() => {
                                  setFolderCardMenuId(null);
                                  setDeleteFolderIds([folder.id]);
                                  setDeleteFolderStatus("");
                                }}
                              />
                            </div>
                          )}
                          <div style={folderThumbStyle}>
                            <Folder size={38} strokeWidth={1.7} />
                          </div>
                          <div style={homeCardBodyStyle}>
                            <div style={homeCardTitleStyle}>{folder.name}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!selectedFolder && <HomeSectionTitle title="Designs" />}
                <div style={homeGridStyle}>
                  {homeProjects.map((project) => {
                    const isSelected = selectedDesignIds.includes(project.id);
                    return (
                      <div
                        key={project.id}
                        className="studio2-design-card"
                        draggable={selectMode && isSelected}
                        onDragStart={(event) => {
                          if (!selectMode || !isSelected) {
                            event.preventDefault();
                            return;
                          }
                          const ids = selectedDesignIds.includes(project.id) ? selectedDesignIds : [project.id];
                          setDraggedDesignIds(ids);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", ids.join(","));
                          setStudioCardDragImage(event);
                        }}
                        onDragEnd={() => {
                          setDraggedDesignIds([]);
                          setDragOverFolderId(null);
                        }}
                        onClick={() => void openHomeProject(project.id)}
                        style={{
                          position: "relative",
                          border: `1px solid ${isSelected ? ADS_BRAND.gold : ADS_BRAND.border}`,
                          background: ADS_BRAND.panel,
                          borderRadius: 12,
                          overflow: "visible",
                          cursor: selectMode ? (isSelected ? "grab" : "pointer") : "pointer",
                          minHeight: 228,
                          boxShadow: isSelected ? "0 0 0 2px rgba(212,178,122,0.16)" : "none",
                        }}
                      >
                        <button
                          className="studio2-card-menu-button"
                          aria-label="Project options"
                          onClick={(event) => {
                            event.stopPropagation();
                            setCardMenuId((openId) => (openId === project.id ? null : project.id));
                            setCreateMenuOpen(false);
                            setFolderMenuOpen(false);
                            setFolderCardMenuId(null);
                          }}
                          style={cardMenuButtonStyle}
                        >
                          <MoreHorizontal size={17} />
                        </button>
                        {selectMode && (
                          <span style={selectBadgeStyle(isSelected)}>
                            {isSelected && <CheckCircle2 size={15} />}
                          </span>
                        )}
                        {cardMenuId === project.id && (
                          <div className="studio2-create-menu" onClick={(event) => event.stopPropagation()} style={cardMenuStyle}>
                            <HomeMenuButton
                              icon={Square}
                              label={isSelected ? "Deselect" : "Select"}
                              onClick={() => toggleDesignSelectionFromMenu(project.id)}
                            />
                            <HomeMenuButton
                              icon={FolderPlus}
                              label="Add to folder"
                              onClick={() => {
                                setCardMenuId(null);
                                setFolderPickerProjectId(project.id);
                                setFolderPickerStatus("");
                                setNewFolderName("");
                              }}
                            />
                            <HomeMenuButton icon={CopyPlus} label="Duplicate" onClick={() => void duplicateHomeProject(project.id)} />
                            <HomeMenuButton
                              icon={Trash2}
                              label="Delete"
                              onClick={() => {
                                setCardMenuId(null);
                                setDeleteProjectId(project.id);
                                setDeleteProjectStatus("");
                              }}
                            />
                          </div>
                        )}
                        <div style={projectThumbStyle(project.thumb)}>
                          {project.thumb ? (
                            <img draggable={false} src={getMediaPreviewSrc(project.thumb)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <span style={{ color: ADS_BRAND.text4 }}>
                              <Palette size={38} strokeWidth={1.7} />
                            </span>
                          )}
                        </div>
                        <div style={homeCardBodyStyle}>
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
                                fontSize: 15,
                                fontWeight: 600,
                                outline: "none",
                                padding: "0 6px",
                              }}
                            />
                          ) : (
                            <div style={homeCardTitleStyle}>{project.name}</div>
                          )}
                          <div style={homeCardSubtleStyle}>{project.updated}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <HomeSectionTitle title="Folders" />
                {visibleMediaFolders.length > 0 && (
                  <div style={homeGridStyle}>
                    {visibleMediaFolders.map((folder) => {
                      const isSelected = selectedMediaFolderIds.includes(folder.id);
                      const isDropTarget = dragOverFolderId === folder.id && draggedMediaIds.length > 0;
                      return (
                        <div
                          key={folder.id}
                          role="button"
                          tabIndex={0}
                          className="studio2-design-card"
                          onClick={() => {
                            if (selectMode) {
                              toggleMediaFolderSelection(folder.id);
                              return;
                            }
                            setSelectedMediaFolderId(folder.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              if (selectMode) toggleMediaFolderSelection(folder.id);
                              else setSelectedMediaFolderId(folder.id);
                            }
                          }}
                          onDragEnter={(event) => {
                            if (!draggedMediaIds.length) return;
                            event.preventDefault();
                            setDragOverFolderId(folder.id);
                          }}
                          onDragOver={(event) => {
                            if (!draggedMediaIds.length) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = "move";
                            setDragOverFolderId(folder.id);
                          }}
                          onDragLeave={(event) => {
                            const nextTarget = event.relatedTarget as Node | null;
                            if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
                              setDragOverFolderId(null);
                            }
                          }}
                          onDrop={(event) => {
                            if (!draggedMediaIds.length) return;
                            event.preventDefault();
                            event.stopPropagation();
                            void moveMediaToFolder(folder.id, draggedMediaIds);
                          }}
                          style={{
                            ...folderCardStyle,
                            position: "relative",
                            overflow: "visible",
                            border: `1px solid ${isDropTarget || isSelected ? ADS_BRAND.gold : ADS_BRAND.border}`,
                            background: isDropTarget ? ADS_BRAND.goldSoft : ADS_BRAND.panel,
                            boxShadow: isDropTarget
                              ? "0 0 0 3px rgba(212,178,122,0.18), 0 18px 50px rgba(0,0,0,0.35)"
                              : isSelected ? "0 0 0 2px rgba(212,178,122,0.16)" : "none",
                          }}
                        >
                        <button
                          className="studio2-card-menu-button"
                          aria-label="Folder options"
                          onClick={(event) => {
                            event.stopPropagation();
                            setFolderCardMenuId((openId) => (openId === folder.id ? null : folder.id));
                            setCardMenuId(null);
                            setMediaCardMenuId(null);
                            setCreateMenuOpen(false);
                            setFolderMenuOpen(false);
                          }}
                          style={cardMenuButtonStyle}
                        >
                          <MoreHorizontal size={17} />
                        </button>
                        {selectMode && (
                          <span style={selectBadgeStyle(isSelected)}>
                            {isSelected && <CheckCircle2 size={15} />}
                          </span>
                        )}
                        {folderCardMenuId === folder.id && (
                          <div className="studio2-create-menu" onClick={(event) => event.stopPropagation()} style={cardMenuStyle}>
                            <HomeMenuButton
                              icon={Square}
                              label={isSelected ? "Deselect" : "Select"}
                              onClick={() => toggleMediaFolderSelectionFromMenu(folder.id)}
                            />
                            {selectedMediaIds.length > 0 && (
                              <HomeMenuButton
                                icon={FolderPlus}
                                label={`Move ${selectedMediaIds.length} selected here`}
                                onClick={() => {
                                  setFolderCardMenuId(null);
                                  void moveMediaToFolder(folder.id, selectedMediaIds);
                                }}
                              />
                            )}
                            <HomeMenuButton
                              icon={Trash2}
                              label="Delete"
                              onClick={() => {
                                setFolderCardMenuId(null);
                                setDeleteFolderIds([folder.id]);
                                setDeleteFolderStatus("");
                              }}
                            />
                          </div>
                        )}
                        <div style={folderThumbStyle}>
                          <Folder size={38} strokeWidth={1.7} />
                        </div>
                        <div style={homeCardBodyStyle}>
                          <div style={homeCardTitleStyle}>{folder.name}</div>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}

                <HomeSectionTitle title="Media" />
                <div style={homeGridStyle}>
                  {visibleLibraryMedia.map((asset) => {
                    const isSelected = selectedMediaIds.includes(asset.id);
                    return (
                    <div
                      key={asset.id}
                      className="studio2-design-card"
                      draggable={selectMode && isSelected}
                      onDragStart={(event) => {
                        if (!selectMode || !isSelected) {
                          event.preventDefault();
                          return;
                        }
                        const ids = selectedMediaIds.includes(asset.id) ? selectedMediaIds : [asset.id];
                        setDraggedMediaIds(ids);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", ids.join(","));
                        setStudioCardDragImage(event);
                      }}
                      onDragEnd={() => {
                        setDraggedMediaIds([]);
                        setDragOverFolderId(null);
                      }}
                      onClick={() => {
                        if (selectMode) {
                          toggleMediaSelection(asset.id);
                          return;
                        }
                        setPreviewMediaId(asset.id);
                        setMediaCardMenuId(null);
                        setFolderCardMenuId(null);
                      }}
                      style={{
                        ...mediaCardStyle,
                        border: `1px solid ${isSelected ? ADS_BRAND.gold : ADS_BRAND.border}`,
                        boxShadow: isSelected ? "0 0 0 2px rgba(212,178,122,0.16)" : "none",
                        cursor: selectMode ? (isSelected ? "grab" : "pointer") : "pointer",
                      }}
                    >
                      <button
                        className="studio2-card-menu-button"
                        aria-label="Media options"
                        onClick={(event) => {
                          event.stopPropagation();
                          setMediaCardMenuId((openId) => (openId === asset.id ? null : asset.id));
                          setCreateMenuOpen(false);
                          setFolderMenuOpen(false);
                          setFolderCardMenuId(null);
                        }}
                        style={cardMenuButtonStyle}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {selectMode && (
                        <span style={selectBadgeStyle(isSelected)}>
                          {isSelected && <CheckCircle2 size={15} />}
                        </span>
                      )}
                      {mediaCardMenuId === asset.id && (
                        <div className="studio2-create-menu" onClick={(event) => event.stopPropagation()} style={cardMenuStyle}>
                          <HomeMenuButton
                            icon={Square}
                            label={isSelected ? "Deselect" : "Select"}
                            onClick={() => toggleMediaSelectionFromMenu(asset.id)}
                          />
                          <HomeMenuButton
                            icon={Trash2}
                            label="Delete"
                            onClick={() => {
                              setMediaCardMenuId(null);
                              setDeleteMediaId(asset.id);
                              setDeleteMediaStatus("");
                            }}
                          />
                        </div>
                      )}
                      <div style={projectThumbStyle(asset.url)}>
                        {asset.kind === "video" ? (
                          <video draggable={false} src={getMediaPreviewSrc(asset.url)} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        ) : (
                          <img draggable={false} src={getMediaPreviewSrc(asset.url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        )}
                        {asset.kind === "video" && (
                          <span style={mediaVideoBadgeStyle}>
                            <Video size={12} />
                          </span>
                        )}
                      </div>
                      <div style={homeCardBodyStyle}>
                        <div style={homeCardTitleStyle}>{asset.filename}</div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </>
            )}

            {cloudStatus && cloudStatus !== "Loading designs..." && (
              <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginTop: 18 }}>{cloudStatus}</div>
            )}
        </main>
        {previewMedia && (
          <div
            onClick={() => setPreviewMediaId(null)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 60,
              background: "rgba(0,0,0,0.72)",
              backdropFilter: "blur(10px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                maxWidth: "min(92vw, 980px)",
                maxHeight: "88vh",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {previewMedia.kind === "video" ? (
                <video
                  draggable={false}
                  src={getMediaPreviewSrc(previewMedia.url)}
                  controls
                  autoPlay
                  playsInline
                  style={{
                    maxWidth: "100%",
                    maxHeight: "88vh",
                    borderRadius: 12,
                    background: ADS_BRAND.bgDeep,
                    boxShadow: "0 28px 90px rgba(0,0,0,0.7)",
                  }}
                />
              ) : (
                <img
                  draggable={false}
                  src={getMediaPreviewSrc(previewMedia.url)}
                  alt={previewMedia.filename}
                  style={{
                    maxWidth: "100%",
                    maxHeight: "88vh",
                    objectFit: "contain",
                    borderRadius: 12,
                    background: ADS_BRAND.bgDeep,
                    boxShadow: "0 28px 90px rgba(0,0,0,0.7)",
                  }}
                />
              )}
            </div>
          </div>
        )}
        {uploadModalOpen && (
          <div
            onClick={() => setUploadModalOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.58)",
              zIndex: 46,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 480,
                borderRadius: 12,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
                padding: 18,
              }}
            >
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Upload media</div>
              {renderUploadDestinationControls()}
              <input
                ref={uploadQueueInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  addQueuedUploadFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => uploadQueueInputRef.current?.click()}
                onDragEnter={handleUploadModalDragOver}
                onDragOver={handleUploadModalDragOver}
                onDragLeave={handleUploadModalDragLeave}
                onDrop={handleUploadModalDrop}
                style={{
                  width: "100%",
                  minHeight: 132,
                  border: `2px dashed ${uploadDropActive ? ADS_BRAND.gold : "rgba(255,255,255,0.16)"}`,
                  borderRadius: 10,
                  background: uploadDropActive ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                  color: ADS_BRAND.text2,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                <Upload size={26} />
                <span style={{ fontSize: 14, fontWeight: 750 }}>Drop photos or videos here</span>
                <span style={{ fontSize: 12, color: ADS_BRAND.text3 }}>or click to choose files</span>
              </button>
              {uploadQueue.length > 0 && (
                <div style={{ maxHeight: 190, overflowY: "auto", marginBottom: 12, display: "grid", gap: 7 }}>
                  {uploadQueue.map((file, index) => (
                    <div
                      key={`${file.name}-${file.size}-${index}`}
                      style={{
                        height: 38,
                        border: `1px solid ${ADS_BRAND.border2}`,
                        borderRadius: 8,
                        background: ADS_BRAND.panel3,
                        color: ADS_BRAND.text2,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "0 9px",
                        fontSize: 12,
                      }}
                    >
                      {getUploadContentType(file).startsWith("video/") ? <Video size={15} /> : <ImagePlus size={15} />}
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                      <button
                        type="button"
                        aria-label="Remove queued file"
                        onClick={() => setUploadQueue((prev) => prev.filter((_, fileIndex) => fileIndex !== index))}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: ADS_BRAND.text3,
                          cursor: "pointer",
                          fontSize: 18,
                          lineHeight: 1,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {uploadStatus && (
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginBottom: 12 }}>{uploadStatus}</div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  style={buttonStyle(false)}
                  onClick={() => {
                    setUploadModalOpen(false);
                    setUploadDropActive(false);
                    setUploadStatus("");
                    setShareLinkStatus("");
                  }}
                >
                  Cancel
                </button>
                <button
                  style={{
                    ...buttonStyle(true),
                    opacity: uploadQueue.length && !uploadingQueuedMedia ? 1 : 0.4,
                    cursor: uploadQueue.length && !uploadingQueuedMedia ? "pointer" : "not-allowed",
                  }}
                  disabled={!uploadQueue.length || uploadingQueuedMedia}
                  onClick={() => void uploadQueuedMedia()}
                >
                  <Upload size={14} /> {uploadingQueuedMedia ? "Uploading..." : "Upload"}
                </button>
              </div>
            </div>
          </div>
        )}
        {createFolderModalOpen && (
          <div
            onClick={() => {
              if (savingHomeFolder) return;
              setCreateFolderModalOpen(false);
              setHomeFolderName("");
              setHomeFolderStatus("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.58)",
              zIndex: 47,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 390,
                borderRadius: 12,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
                padding: 18,
              }}
            >
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                {homeMode === "media" ? "Create media folder" : "Create design folder"}
              </div>
              <input
                value={homeFolderName}
                onChange={(event) => setHomeFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void createHomeFolder();
                  }
                }}
                placeholder="Folder name"
                style={{ ...inputStyle, height: 40, marginBottom: 12 }}
                autoFocus
              />
              {homeFolderStatus && (
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginBottom: 12 }}>{homeFolderStatus}</div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  style={buttonStyle(false)}
                  disabled={savingHomeFolder}
                  onClick={() => {
                    setCreateFolderModalOpen(false);
                    setHomeFolderName("");
                    setHomeFolderStatus("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!homeFolderName.trim() || savingHomeFolder}
                  onClick={() => void createHomeFolder()}
                  style={{
                    ...buttonStyle(true),
                    opacity: homeFolderName.trim() && !savingHomeFolder ? 1 : 0.4,
                    cursor: homeFolderName.trim() && !savingHomeFolder ? "pointer" : "not-allowed",
                  }}
                >
                  {savingHomeFolder ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        )}
        {deleteProjectId && (
          <div
            onClick={() => {
              if (deletingProject) return;
              setDeleteProjectId(null);
              setDeleteProjectStatus("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.62)",
              zIndex: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 410,
                borderRadius: 12,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 80px rgba(0,0,0,0.58)",
                padding: 18,
              }}
            >
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Delete design?</div>
              <div style={{ color: ADS_BRAND.text3, fontSize: 13, lineHeight: 1.45, marginBottom: 16 }}>
                This will delete {deleteProject?.name ? <strong style={{ color: ADS_BRAND.text2 }}>{deleteProject.name}</strong> : "this design"} from Studio 2.
              </div>
              {deleteProjectStatus && (
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginBottom: 12 }}>{deleteProjectStatus}</div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  style={buttonStyle(false)}
                  disabled={deletingProject}
                  onClick={() => {
                    setDeleteProjectId(null);
                    setDeleteProjectStatus("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingProject}
                  onClick={() => void confirmDeleteHomeProject()}
                  style={{
                    ...buttonStyle(false),
                    border: "1px solid rgba(255,107,107,0.55)",
                    background: deletingProject ? "rgba(255,107,107,0.15)" : "#ff6b6b",
                    color: deletingProject ? "#ffb3b3" : "#190606",
                    cursor: deletingProject ? "wait" : "pointer",
                  }}
                >
                  <Trash2 size={14} /> {deletingProject ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
        {folderPickerProjectId && (
          <div
            onClick={() => {
              setFolderPickerProjectId(null);
              setFolderPickerStatus("");
              setNewFolderName("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.58)",
              zIndex: 47,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 420,
                borderRadius: 12,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
                padding: 18,
              }}
            >
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Add to folder</div>
              <div style={{ display: "grid", gap: 7, marginBottom: 16, maxHeight: 220, overflowY: "auto" }}>
                {designFolders.length ? designFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="studio2-folder-choice"
                    disabled={savingFolderPick}
                    onClick={() => void addHomeProjectToFolder(folderPickerProjectId, folder.id)}
                    style={{
                      width: "100%",
                      height: 40,
                      border: `1px solid ${ADS_BRAND.border2}`,
                      borderRadius: 8,
                      background: ADS_BRAND.panel3,
                      color: ADS_BRAND.text,
                      cursor: savingFolderPick ? "wait" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "0 11px",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 650,
                      textAlign: "left",
                    }}
                  >
                    <Folder size={15} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                  </button>
                )) : (
                  <div style={{ color: ADS_BRAND.text3, fontSize: 12, padding: "4px 2px" }}>No design folders yet.</div>
                )}
              </div>
              <div style={{ height: 1, background: ADS_BRAND.border, marginBottom: 14 }} />
              <label style={{ ...labelStyle, display: "block", marginBottom: 7 }}>Create New Folder</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="Folder name"
                  style={{ ...inputStyle, height: 40, flex: 1 }}
                />
                <button
                  type="button"
                  disabled={!newFolderName.trim() || savingFolderPick}
                  onClick={() => void addHomeProjectToNewFolder()}
                  style={{
                    ...buttonStyle(true),
                    opacity: newFolderName.trim() && !savingFolderPick ? 1 : 0.4,
                    cursor: newFolderName.trim() && !savingFolderPick ? "pointer" : "not-allowed",
                  }}
                >
                  Create
                </button>
              </div>
              {folderPickerStatus && (
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginTop: 12 }}>{folderPickerStatus}</div>
              )}
            </div>
          </div>
        )}
        {deleteFolderIds.length > 0 && (
          <div
            onClick={() => {
              if (deletingFolder) return;
              setDeleteFolderIds([]);
              setDeleteFolderStatus("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.62)",
              zIndex: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 430,
                borderRadius: 12,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 80px rgba(0,0,0,0.58)",
                padding: 18,
              }}
            >
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
                Delete {deleteFolderIds.length === 1 ? "folder" : "folders"}?
              </div>
              <div style={{ color: ADS_BRAND.text3, fontSize: 13, lineHeight: 1.45, marginBottom: 16 }}>
                {deleteFolders.length === 1 ? (
                  <>
                    This deletes <strong style={{ color: ADS_BRAND.text2 }}>{deleteFolders[0]?.name}</strong>. Its contents will move back to {deleteFolders[0]?.folderType === "media" ? "All Media" : "Designs"}.
                  </>
                ) : (
                  <>This deletes {deleteFolderIds.length} folders. Their contents will move back to Designs.</>
                )}
              </div>
              {deleteFolderStatus && (
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginBottom: 12 }}>{deleteFolderStatus}</div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  style={buttonStyle(false)}
                  disabled={deletingFolder}
                  onClick={() => {
                    setDeleteFolderIds([]);
                    setDeleteFolderStatus("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingFolder}
                  onClick={() => void confirmDeleteFolders()}
                  style={{
                    ...buttonStyle(false),
                    border: "1px solid rgba(255,107,107,0.55)",
                    background: deletingFolder ? "rgba(255,107,107,0.15)" : "#ff6b6b",
                    color: deletingFolder ? "#ffb3b3" : "#190606",
                    cursor: deletingFolder ? "wait" : "pointer",
                  }}
                >
                  <Trash2 size={14} /> {deletingFolder ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
        {deleteMediaId && (
          <div
            onClick={() => {
              if (deletingMedia) return;
              setDeleteMediaId(null);
              setDeleteMediaStatus("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.62)",
              zIndex: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 410,
                borderRadius: 12,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 80px rgba(0,0,0,0.58)",
                padding: 18,
              }}
            >
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 8 }}>Delete media?</div>
              <div style={{ color: ADS_BRAND.text3, fontSize: 13, lineHeight: 1.45, marginBottom: 16 }}>
                This will remove {deleteMedia?.filename ? <strong style={{ color: ADS_BRAND.text2 }}>{deleteMedia.filename}</strong> : "this file"} from the Media Library.
              </div>
              {deleteMediaStatus && (
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginBottom: 12 }}>{deleteMediaStatus}</div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  style={buttonStyle(false)}
                  disabled={deletingMedia}
                  onClick={() => {
                    setDeleteMediaId(null);
                    setDeleteMediaStatus("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deletingMedia}
                  onClick={() => void confirmDeleteMedia()}
                  style={{
                    ...buttonStyle(false),
                    border: "1px solid rgba(255,107,107,0.55)",
                    background: deletingMedia ? "rgba(255,107,107,0.15)" : "#ff6b6b",
                    color: deletingMedia ? "#ffb3b3" : "#190606",
                    cursor: deletingMedia ? "wait" : "pointer",
                  }}
                >
                  <Trash2 size={14} /> {deletingMedia ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === "setup") {
    return (
      <div
        className="fade-up"
        onDragEnter={handleSetupDragOver}
        onDragOver={handleSetupDragOver}
        onDragLeave={handleSetupDragLeave}
        onDrop={handleSetupDrop}
        style={{ paddingBottom: 40 }}
      >
        <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
          <div>
            <h1 className="page-title">Studio 2.0</h1>
            <p className="page-subtitle">
              A new canvas-first ad builder where preview and export use the same renderer.
            </p>
          </div>
          <button style={buttonStyle(false)} onClick={() => setView("home")}>
            <Home size={14} /> Home
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
                  resetLocalDraftState();
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
              <ImagePlus size={16} /> Media
            </h2>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleSetupDragOver}
              onDragOver={handleSetupDragOver}
              onDrop={handleSetupDrop}
              style={{
                width: "100%",
                border: `2px dashed ${setupDropActive ? ADS_BRAND.gold : "rgba(255,255,255,0.14)"}`,
                background: setupDropActive ? ADS_BRAND.goldSoft : "rgba(255,255,255,0.03)",
                borderRadius: 10,
                padding: 34,
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "border-color 120ms ease, background 120ms ease",
              }}
            >
              <Upload size={30} style={{ marginBottom: 8 }} />
              <div style={{ fontSize: 14, fontWeight: 700 }}>Drop media here or click to upload</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                Images can create ads. Videos are saved here for the project.
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              style={{ display: "none" }}
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = "";
              }}
            />

            <div style={{ marginTop: 16 }}>
              <div style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                Media folders
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setSetupMediaFolderId(null)}
                  style={{
                    height: 42,
                    border: `1px solid ${!setupMediaFolderId ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                    borderRadius: 8,
                    background: !setupMediaFolderId ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                    color: !setupMediaFolderId ? ADS_BRAND.gold : ADS_BRAND.text2,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "0 10px",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    minWidth: 0,
                  }}
                >
                  <ImagePlus size={14} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>All Media</span>
                </button>
                {setupMediaFolderOptions.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setSetupMediaFolderId(folder.id)}
                    style={{
                      height: 42,
                      border: `1px solid ${setupMediaFolderId === folder.id ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                      borderRadius: 8,
                      background: setupMediaFolderId === folder.id ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                      color: setupMediaFolderId === folder.id ? ADS_BRAND.gold : ADS_BRAND.text2,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "0 10px",
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 700,
                      minWidth: 0,
                    }}
                  >
                    <Folder size={14} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
                {setupMediaFolder ? setupMediaFolder.name : "All Media"}
              </div>
              <div
                style={{
                  height: 278,
                  overflowY: "auto",
                  border: `1px solid ${ADS_BRAND.border2}`,
                  borderRadius: 10,
                  background: ADS_BRAND.panel3,
                  padding: 10,
                }}
              >
                {setupMediaAssets.length > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 9,
                      justifyContent: "start",
                    }}
                  >
                    {setupMediaAssets.map((asset, index) => {
                      const copyCount = getPhotoCopies(photoCopies, asset.url);
                      const isSelected = asset.kind === "image"
                        ? photos.includes(asset.url)
                        : mediaAssets.some((item) => item.url === asset.url);
                      return (
                        <div
                          role="button"
                          tabIndex={0}
                          key={`${asset.id}-${index}`}
                          onClick={() => toggleSetupMediaAsset(asset)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              toggleSetupMediaAsset(asset);
                            }
                          }}
                          style={{
                            position: "relative",
                            width: "100%",
                            aspectRatio: "9 / 16",
                            borderRadius: 8,
                            overflow: "hidden",
                            background: ADS_BRAND.bgDeep,
                            border: `2px solid ${isSelected ? ADS_BRAND.gold : "transparent"}`,
                            cursor: "pointer",
                            padding: 0,
                          }}
                        >
                          {asset.kind === "video" ? (
                            <video draggable={false} src={getMediaPreviewSrc(asset.url)} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          ) : (
                            <img draggable={false} src={getMediaPreviewSrc(asset.url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          )}
                          {asset.kind === "video" && (
                            <span
                              style={{
                                position: "absolute",
                                left: 5,
                                top: 5,
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                background: "rgba(0,0,0,0.68)",
                                color: "#fff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              <Video size={10} />
                            </span>
                          )}
                          {isSelected && (
                            <div
                              style={{
                                position: "absolute",
                                left: 6,
                                right: 6,
                                bottom: 6,
                                height: 20,
                                display: "grid",
                                gridTemplateColumns: "18px 1fr 18px",
                                alignItems: "center",
                                borderRadius: 999,
                                background: "rgba(0,0,0,0.62)",
                                border: "1px solid rgba(255,255,255,0.14)",
                                color: "#fff",
                                backdropFilter: "blur(8px)",
                              }}
                            >
                              <button
                                type="button"
                                aria-label="Use fewer copies"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  updatePhotoCopyCount(asset.url, -1);
                                }}
                                style={{
                                  width: 18,
                                  height: 19,
                                  border: "none",
                                  background: "transparent",
                                  color: "rgba(255,255,255,0.88)",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  padding: 0,
                                }}
                              >
                                <Minus size={10} />
                              </button>
                              <span style={{ textAlign: "center", fontSize: 10, fontWeight: 800 }}>
                                {copyCount}x
                              </span>
                              <button
                                type="button"
                                aria-label="Use more copies"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  updatePhotoCopyCount(asset.url, 1);
                                }}
                                style={{
                                  width: 18,
                                  height: 19,
                                  border: "none",
                                  background: "transparent",
                                  color: ADS_BRAND.gold,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  cursor: "pointer",
                                  padding: 0,
                                }}
                              >
                                <Plus size={10} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "column",
                    gap: 8,
                    color: ADS_BRAND.text3,
                    fontSize: 13,
                  }}>
                    <Palette size={28} strokeWidth={1.7} />
                    No media uploaded yet
                  </div>
                )}
              </div>
            </div>
            <div style={{ marginTop: 10, color: "var(--text-muted)", fontSize: 12 }}>
              {setupMediaAssets.length} media file{setupMediaAssets.length === 1 ? "" : "s"} - {selectedMediaCount} selected - {plannedAdCount} ad{plannedAdCount === 1 ? "" : "s"} planned
            </div>
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
            disabled={!plannedAdCount}
            onClick={generateAds}
            style={{
              ...buttonStyle(true),
              padding: "15px 44px",
              fontSize: 17,
              opacity: plannedAdCount ? 1 : 0.35,
              cursor: plannedAdCount ? "pointer" : "not-allowed",
            }}
          >
            <Sparkles size={19} />
            Generate {plannedAdCount || ""} Ad{plannedAdCount === 1 ? "" : "s"}
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
        accept="image/*,video/*"
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
          <Home size={14} /> Home
        </button>
        <button style={buttonStyle(false)} onClick={() => setView("setup")}>
          <ArrowLeft size={14} /> Setup
        </button>
        <div style={{ height: 24, width: 1, background: ADS_BRAND.border2 }} />
        <input
          className="studio2-project-title"
          aria-label="Design name"
          value={projectName}
          onFocus={() => setEditorTitleFocused(true)}
          onBlur={() => setEditorTitleFocused(false)}
          onChange={(event) => setProjectName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setEditorTitleFocused(false);
              setSaveStatus(`Saved ${getDraftDate(Date.now())}`);
              event.currentTarget.blur();
            }
          }}
          style={{
            width: Math.max(170, Math.min(360, projectName.length * 9 + 30)),
            height: 34,
            borderRadius: 7,
            border: `1px solid ${editorTitleFocused ? ADS_BRAND.goldBorder : "transparent"}`,
            background: editorTitleFocused ? ADS_BRAND.panel : "transparent",
            color: "var(--text-primary)",
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 800,
            outline: "none",
            padding: "0 8px",
          }}
        />
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

      {editorSidebarMode === "generate" ? renderGenerateWorkspace() : (
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
            {currentCreative?.mediaKind === "video" && (
              <>
                <video
                  key={currentCreative.id}
                  ref={videoPreviewRef}
                  src={getMediaPreviewSrc(currentCreative.photoUrl)}
                  muted
                  loop
                  autoPlay
                  playsInline
                  onPlay={() => setVideoPreviewPlaying(true)}
                  onPause={() => setVideoPreviewPlaying(false)}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    transform: `translate(${currentCreative.imageTransform.offsetX * viewScale}px, ${currentCreative.imageTransform.offsetY * viewScale}px) scale(${currentCreative.imageTransform.scale}) rotate(${currentCreative.imageTransform.rotate}deg)`,
                    transformOrigin: "center",
                    pointerEvents: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const video = videoPreviewRef.current;
                    if (!video) return;
                    if (video.paused) {
                      void video.play();
                      setVideoPreviewPlaying(true);
                    } else {
                      video.pause();
                      setVideoPreviewPlaying(false);
                    }
                  }}
                  style={{
                    position: "absolute",
                    left: 10,
                    bottom: 10,
                    zIndex: 4,
                    height: 34,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.18)",
                    background: "rgba(0,0,0,0.64)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "0 11px",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    backdropFilter: "blur(8px)",
                  }}
                >
                  {videoPreviewPlaying ? <Pause size={13} /> : <Play size={13} />}
                  {videoPreviewPlaying ? "Pause" : "Play"}
                </button>
              </>
            )}
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
                      block.id === editingBlock.id ? withTextBlockText(block, next) : block
                    ),
                  }));
                }}
                onSelect={(event) => captureTextSelection(editingBlock.id, event.currentTarget)}
                onKeyUp={(event) => captureTextSelection(editingBlock.id, event.currentTarget)}
                onMouseUp={(event) => captureTextSelection(editingBlock.id, event.currentTarget)}
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
                  if ((creative.mediaKind || "image") === "image") {
                    loadImage(creative.photoUrl)
                      .then((img) => {
                        imageCacheRef.current.set(creative.photoUrl, img);
                        bumpImageVersion((v) => v + 1);
                      })
                      .catch(() => undefined);
                  }
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
                {(creative.mediaKind || "image") === "video" ? (
                  <>
                    <video draggable={false} src={getMediaPreviewSrc(creative.photoUrl)} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    <span style={mediaVideoBadgeStyle}>
                      <Video size={11} />
                    </span>
                  </>
                ) : (
                  <img draggable={false} src={getMediaPreviewSrc(creative.photoUrl)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                )}
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
          <div style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            padding: 4,
            borderRadius: 10,
            border: `1px solid ${ADS_BRAND.border2}`,
            background: ADS_BRAND.panel3,
          }}>
            <button
              type="button"
              onClick={() => setEditorSidebarMode("edit")}
              style={{
                ...segmentedButtonStyle(editorSidebarMode === "edit"),
                width: "100%",
                height: 34,
                gap: 6,
              }}
            >
              <MousePointer2 size={14} /> Edit
            </button>
            <button
              type="button"
              onClick={() => setEditorSidebarMode("generate")}
              style={{
                ...segmentedButtonStyle(false),
                width: "100%",
                height: 34,
                gap: 6,
              }}
            >
              <Sparkles size={14} /> Generate
            </button>
          </div>

          <>
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
                ref={sidebarTextRef}
                value={selectedBlockText}
                onFocus={pushUndo}
                onSelect={(e) => captureTextSelection(selectedBlock.id, e.currentTarget)}
                onKeyUp={(e) => captureTextSelection(selectedBlock.id, e.currentTarget)}
                onMouseUp={(e) => captureTextSelection(selectedBlock.id, e.currentTarget)}
                onChange={(e) => updateSelectedBlockText(e.target.value)}
                rows={4}
                style={{ ...inputStyle, resize: "vertical", lineHeight: 1.4, marginBottom: 10 }}
              />
              {selectedTextRange && (
                <div
                  className="studio2-selection-tools"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minHeight: 38,
                    margin: "-2px 0 12px",
                    padding: "6px 8px",
                    borderRadius: 10,
                    border: `1px solid ${ADS_BRAND.goldBorder}`,
                    background: ADS_BRAND.goldSoft,
                  }}
                >
                  <span
                    style={{
                      maxWidth: 142,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: selectedTextColor,
                      fontSize: 12,
                      fontWeight: 800,
                    }}
                    title={selectedTextSnippet}
                  >
                    {selectedTextSnippet}
                  </span>
                  <input
                    type="color"
                    value={selectedTextColor}
                    onMouseDown={pushUndo}
                    onChange={(e) => applySelectedTextColor(e.target.value)}
                    style={{ width: 30, height: 28, border: "none", background: "transparent", cursor: "pointer" }}
                    title="Color selected text"
                  />
                  <button
                    type="button"
                    onClick={clearSelectedTextColor}
                    style={{
                      ...buttonStyle(false),
                      width: 28,
                      height: 28,
                      padding: 0,
                      color: ADS_BRAND.text2,
                    }}
                    title="Remove selected text color"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
              {selectedColorSpans.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "-2px 0 12px" }}>
                  {selectedColorSpans.map((span, index) => (
                    <button
                      key={`${span.start}-${span.end}-${span.color}-${index}`}
                      type="button"
                      onClick={() => removeColorSpan(span)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        maxWidth: "100%",
                        minHeight: 28,
                        border: `1px solid ${ADS_BRAND.border2}`,
                        borderRadius: 999,
                        background: ADS_BRAND.panel3,
                        color: ADS_BRAND.text2,
                        padding: "3px 7px 3px 8px",
                        fontFamily: "inherit",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                      title="Remove this text color"
                    >
                      <span style={{ width: 8, height: 8, borderRadius: 999, background: span.color, flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {getTextRangeSnippet(selectedBlockText, span.start, span.end)}
                      </span>
                      <X size={11} style={{ flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              )}
              <Control label="Text color">
                <input
                  type="color"
                  value={selectedBlock.textColor}
                  onMouseDown={pushUndo}
                  onChange={(e) => updateSelectedBlock({ textColor: e.target.value })}
                  style={{ width: 42, height: 32, border: "none", background: "transparent" }}
                  title="Text color"
                />
                <input
                  type="color"
                  value={selectedBlock.bgColor}
                  onMouseDown={pushUndo}
                  onChange={(e) => updateSelectedBlock({ bgColor: e.target.value })}
                  style={{ width: 42, height: 32, border: "none", background: "transparent" }}
                  title="Highlight color"
                />
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
              <span style={{ ...labelStyle, display: "block", marginBottom: 10 }}>
                {currentCreative.mediaKind === "video" ? "Video Crop" : "Image Crop"}
              </span>
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
                <Replace size={13} /> Replace Media
              </button>
              <button
                style={{ ...buttonStyle(false), width: "100%", marginTop: 8 }}
                onClick={() => {
                  pushUndo();
                  updateImage({ scale: 1, rotate: 0, offsetX: 0, offsetY: 0 });
                }}
              >
                <RotateCcw size={13} /> Reset Media
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
              <ImagePlus size={13} /> Background Media
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
          </>
        </aside>
      </div>
      )}
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
              <MenuAction icon={Replace} label="Replace media" onClick={() => replaceImageInputRef.current?.click()} />
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
      {generatedPreview && (
        <div
          onClick={() => setGeneratedPreview(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(8px)",
            zIndex: 48,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(430px, 92vw)",
              maxHeight: "92vh",
              borderRadius: 14,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 90px rgba(0,0,0,0.62)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <img
              src={getMediaPreviewSrc(generatedPreview.asset.url)}
              alt=""
              style={{
                width: "100%",
                aspectRatio: "9 / 16",
                objectFit: "cover",
                background: ADS_BRAND.bgDeep,
                display: "block",
              }}
            />
            <div style={{ padding: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={() => addGeneratedImageAsAd(generatedPreview.asset)}
                style={{ ...buttonStyle(true), flex: 1, justifyContent: "center", height: 40 }}
              >
                <FilePlus2 size={14} /> Use in editor
              </button>
              <button
                type="button"
                onClick={() => setGeneratedPreview(null)}
                style={{ ...buttonStyle(false), height: 40 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {uploadModalOpen && (
        <div
          onClick={() => setUploadModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.58)",
            zIndex: 46,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 480,
              borderRadius: 12,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
              padding: 18,
            }}
          >
            <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Upload media</div>
            {renderUploadDestinationControls()}
            <input
              ref={uploadQueueInputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              style={{ display: "none" }}
              onChange={(event) => {
                addQueuedUploadFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => uploadQueueInputRef.current?.click()}
              onDragEnter={handleUploadModalDragOver}
              onDragOver={handleUploadModalDragOver}
              onDragLeave={handleUploadModalDragLeave}
              onDrop={handleUploadModalDrop}
              style={{
                width: "100%",
                minHeight: 132,
                border: `2px dashed ${uploadDropActive ? ADS_BRAND.gold : "rgba(255,255,255,0.16)"}`,
                borderRadius: 10,
                background: uploadDropActive ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                color: ADS_BRAND.text2,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <Upload size={26} />
              <span style={{ fontSize: 14, fontWeight: 750 }}>Drop photos or videos here</span>
              <span style={{ fontSize: 12, color: ADS_BRAND.text3 }}>or click to choose files</span>
            </button>
            {uploadQueue.length > 0 && (
              <div style={{ maxHeight: 190, overflowY: "auto", marginBottom: 12, display: "grid", gap: 7 }}>
                {uploadQueue.map((file, index) => (
                  <div
                    key={`${file.name}-${file.size}-${index}`}
                    style={{
                      height: 38,
                      border: `1px solid ${ADS_BRAND.border2}`,
                      borderRadius: 8,
                      background: ADS_BRAND.panel3,
                      color: ADS_BRAND.text2,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "0 9px",
                      fontSize: 12,
                    }}
                  >
                    {getUploadContentType(file).startsWith("video/") ? <Video size={15} /> : <ImagePlus size={15} />}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                    <button
                      type="button"
                      aria-label="Remove queued file"
                      onClick={() => setUploadQueue((prev) => prev.filter((_, fileIndex) => fileIndex !== index))}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: ADS_BRAND.text3,
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            {uploadStatus && (
              <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginBottom: 12 }}>{uploadStatus}</div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                style={buttonStyle(false)}
                onClick={() => {
                  setUploadModalOpen(false);
                  setUploadDropActive(false);
                  setUploadStatus("");
                  setShareLinkStatus("");
                }}
              >
                Cancel
              </button>
              <button
                style={{
                  ...buttonStyle(true),
                  opacity: uploadQueue.length && !uploadingQueuedMedia ? 1 : 0.4,
                  cursor: uploadQueue.length && !uploadingQueuedMedia ? "pointer" : "not-allowed",
                }}
                disabled={!uploadQueue.length || uploadingQueuedMedia}
                onClick={() => void uploadQueuedMedia()}
              >
                <Upload size={14} /> {uploadingQueuedMedia ? "Uploading..." : "Upload"}
              </button>
            </div>
          </div>
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
        {folderPickerProjectId && (
          <div
            onClick={() => {
              setFolderPickerProjectId(null);
              setFolderPickerStatus("");
              setNewFolderName("");
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.58)",
              zIndex: 47,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: 420,
                borderRadius: 12,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
                padding: 18,
              }}
            >
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Add to folder</div>
              <div style={{ display: "grid", gap: 7, marginBottom: 16, maxHeight: 220, overflowY: "auto" }}>
                {designFolders.length ? designFolders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className="studio2-folder-choice"
                    disabled={savingFolderPick}
                    onClick={() => void addHomeProjectToFolder(folderPickerProjectId, folder.id)}
                    style={{
                      width: "100%",
                      height: 40,
                      border: `1px solid ${ADS_BRAND.border2}`,
                      borderRadius: 8,
                      background: ADS_BRAND.panel3,
                      color: ADS_BRAND.text,
                      cursor: savingFolderPick ? "wait" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "0 11px",
                      fontFamily: "inherit",
                      fontSize: 13,
                      fontWeight: 650,
                      textAlign: "left",
                    }}
                  >
                    <Folder size={15} />
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                  </button>
                )) : (
                  <div style={{ color: ADS_BRAND.text3, fontSize: 12, padding: "4px 2px" }}>No design folders yet.</div>
                )}
              </div>
              <div style={{ height: 1, background: ADS_BRAND.border, marginBottom: 14 }} />
              <label style={{ ...labelStyle, display: "block", marginBottom: 7 }}>Create New Folder</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder="Folder name"
                  style={{ ...inputStyle, height: 40, flex: 1 }}
                />
                <button
                  type="button"
                  disabled={!newFolderName.trim() || savingFolderPick}
                  onClick={() => void addHomeProjectToNewFolder()}
                  style={{
                    ...buttonStyle(true),
                    opacity: newFolderName.trim() && !savingFolderPick ? 1 : 0.4,
                    cursor: newFolderName.trim() && !savingFolderPick ? "pointer" : "not-allowed",
                  }}
                >
                  Create
                </button>
              </div>
              {folderPickerStatus && (
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginTop: 12 }}>{folderPickerStatus}</div>
              )}
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

function HomeSectionTitle({ title }: { title: string }) {
  return (
    <h2
      style={{
        margin: "0 0 14px",
        color: ADS_BRAND.text,
        fontSize: 16,
        fontWeight: 650,
        letterSpacing: 0,
      }}
    >
      {title}
    </h2>
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
