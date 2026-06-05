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
  Bookmark,
  BringToFront,
  Check,
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
  GripVertical,
  Home,
  ImagePlus,
  Layers,
  Library,
  Maximize2,
  Minimize2,
  Link2,
  LoaderCircle,
  Menu,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Palette,
  Paintbrush,
  PanelBottom,
  PanelTop,
  Pause,
  Pencil,
  Play,
  Plus,
  Replace,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  SendToBack,
  Scissors,
  SwatchBook,
  Square,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Video,
  Wand2,
  X,
  ZoomIn,
  ZoomOut,
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
const GENERATE_PRESETS_KEY = "ccos-studio2-generate-presets";
const GENERATE_HIDDEN_PRESETS_KEY = "ccos-studio2-hidden-generate-presets";
const COPY_LAB_PRESETS_KEY = "ccos-studio2-copy-lab-presets";
// Saved colors + text-style presets are global so they're reusable across every ad/project.
const COLOR_PALETTE_KEY = "ccos-studio2-color-palette";
const TEXT_STYLE_PRESETS_KEY = "ccos-studio2-text-style-presets";
const DEFAULT_COLOR_PALETTE = [
  "#FFFFFF",
  "#000000",
  "#4E944F",
  "#22C55E",
  "#FACC15",
  "#EF4444",
  "#3B82F6",
  "#C9A96E",
];
const MAX_PALETTE_COLORS = 24;
const MAX_TEXT_STYLE_PRESETS = 16;
const AI_GENERATED_FOLDER_NAME = "AI Generated";
const MAX_GENERATE_BATCH_COUNT = 30;
const GENERATE_RUN_TIMEOUT_MS = 8 * 60 * 1000;
const DRAG_THRESHOLD = 5;
const SNAP_THRESHOLD = 10;
const IMAGE_CENTER_SNAP_THRESHOLD = 14;
const IG_SAFE_ZONES = [
  { id: "top" as const, x: 0, y: 0, w: CANVAS_W, h: 150, label: "Instagram top bar" },
  { id: "dm" as const, x: 170, y: 1590, w: 740, h: 195, label: "Send message button" },
  { id: "bottom" as const, x: 0, y: 1830, w: 170, h: 82, label: "Ad label" },
];
// Editor-chrome palette. Surface/text keys resolve to CSS variables so the
// builder frame follows light/dark mode (defined in globals.css). Brand keys
// (gold/success) stay literal so they read on both themes AND keep working in
// the few places that can't accept a CSS var (canvas draws, SVG icon color).
// IMPORTANT: the ad creative itself is NEVER styled from this palette — it is
// drawn on <canvas> using CREATIVE_BG + the user's own block colors, so the
// exported ad is byte-identical regardless of the app theme.
const ADS_BRAND = {
  bg: "var(--studio-bg)",
  bgDeep: "var(--studio-bg-deep)",
  panel: "var(--studio-panel)",
  panel2: "var(--studio-panel2)",
  panel3: "var(--studio-panel3)",
  active: "var(--studio-active)",
  border: "var(--studio-border)",
  border2: "var(--studio-border2)",
  text: "var(--studio-text)",
  text2: "var(--studio-text2)",
  text3: "var(--studio-text3)",
  text4: "var(--studio-text4)",
  gold: "#d4b27a",
  goldDim: "#8a7348",
  goldSoft: "rgba(212,178,122,0.08)",
  goldBorder: "rgba(212,178,122,0.32)",
  success: "#7dd3a8",
  successText: "#07130d",
  // Fixed dark "ink" for text sitting on a solid gold chip (gold reads the
  // same in both themes, so this must stay dark in both).
  inkOnGold: "#0a0a0a",
};

// Colors baked into the exported ad creative on <canvas>. These must NEVER
// change with the theme, or every ad's background would shift. Keep literal.
const CREATIVE_BG = "#050505";

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

const DEFAULT_GENERATE_PRESETS = [
  {
    id: "same-style",
    label: "Same text style",
    prompt: "Use the exact same bold font style, line spacing, black rounded background highlights, text placement style, and overall Instagram Story ad format.",
  },
  {
    id: "same-person",
    label: "Keep person identical",
    prompt: "Keep the person, body, face, pose, lighting, and background image as identical as possible. Only make the requested ad variation.",
  },
  {
    id: "copy-only",
    label: "Copy only",
    prompt: "Only vary the ad copy slightly. Keep the image, layout, text styling, highlight backgrounds, and visual composition the same.",
  },
  {
    id: "premium-readable",
    label: "More premium",
    prompt: "Make the final ad feel cleaner, more premium, and easier to read while preserving the same direct-response style.",
  },
];

const BLANK_IMAGE_DATA_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1080' height='1920' viewBox='0 0 1080 1920'%3E%3Crect width='1080' height='1920' fill='%23000000'/%3E%3C/svg%3E";

type TextAlign = "left" | "center" | "right";
type StudioView = "home" | "setup" | "editor";
type StudioHomeMode = "designs" | "media";
type StudioFolderType = "design" | "media";
type MediaKind = "image" | "video";
type SetupMediaKindFilter = "all" | MediaKind;
type SelectedLayer = { type: "text"; id: string } | { type: "image" } | null;
type ContextMenuTarget = SelectedLayer | { type: "multi-text" };
type EditorSidebarMode = "edit" | "generate";
type ExportMode = "current" | "all" | "custom";
type CopyLabOfferType = "Direct Offer" | "Lead Magnet" | "Other";
type SafeZoneId = (typeof IG_SAFE_ZONES)[number]["id"];
type MediaPickerMode = "generate-reference" | "replace-current" | "new-ad";
type EditorMediaActionMode = "replace-current" | "new-ad";
type TextStyle = Omit<TextBlock, "id" | "lines" | "x" | "y" | "locked" | "colorSpans">;

interface TextColorSpan {
  start: number;
  end: number;
  color: string;
}

interface TextStylePreset {
  id: string;
  textColor: string;
  bgColor: string;
  bgOpacity: number;
  bgStyle: "solid" | "marker";
  borderRadius: number;
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
  bgStyle?: "solid" | "marker";
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

interface VideoTrim {
  start: number;
  end: number | null;
}

interface VideoSegment {
  id: string;
  start: number;
  end: number | null;
  enabled: boolean;
}

interface Creative {
  id: string;
  photoUrl: string;
  mediaKind?: MediaKind;
  videoTrim?: VideoTrim;
  videoTimeline?: VideoSegment[];
  videoMuted?: boolean;
  videoVolume?: number;
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
  thumbnailUrl?: string | null;
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

interface CopyLabWinner {
  id: string;
  clientKey: string;
  adId?: string | null;
  adName?: string | null;
  campaignName?: string | null;
  keyword?: string;
  spend: number;
  previewImageUrl: string;
  previewThumbnailUrl?: string | null;
  extractedCopy: string;
  offerType: CopyLabOfferType;
  transcribing?: boolean;
}

interface CopyLabPreset {
  id: string;
  label: string;
  prompt: string;
}

interface GeneratedPreviewState {
  generation: StudioAIGeneration;
  asset: StudioMediaAsset;
}

interface GenerateReferenceImage {
  name: string;
  dataUrl: string;
}

interface GenerateChatMessage {
  id: string;
  prompt: string;
  sourcePreview: string;
  reference?: GenerateReferenceImage | null;
  status: "sent" | "running" | "complete" | "failed";
  createdAt: number;
}

interface ActiveGenerateRun {
  id: string;
  messageId: string;
  label: string;
  total: number;
  ready: number;
  startedAt: number;
}

interface GenerateRunTracker {
  messageId: string;
  controllers: Set<AbortController>;
  generationIds: Set<string>;
  timeoutId: number | null;
  stopped: boolean;
  stopReason: string;
}

interface PendingGenerateRetry {
  prompt: string;
  sourcePreview: string;
  reference?: GenerateReferenceImage | null;
  retryMessageId?: string;
}

type GenerateConversationItem =
  | { type: "message"; id: string; sort: number; message: GenerateChatMessage }
  | { type: "generation"; id: string; sort: number; generation: StudioAIGeneration }
  | { type: "status"; id: string; sort: number; status: string; run?: ActiveGenerateRun };

interface GeneratePreset {
  id: string;
  label: string;
  prompt: string;
}

interface HiggsfieldAuthModalState {
  open: boolean;
  message?: string;
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

interface MarqueeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  target: ContextMenuTarget;
}

type DragState =
  | {
      kind: "move-text";
      active: boolean;
      blockId: string;
      blockIds?: string[];
      startX: number;
      startY: number;
      origX: number;
      origY: number;
      origPositions?: Record<string, { x: number; y: number }>;
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
      kind: "resize-text-group";
      active: boolean;
      blockIds: string[];
      handle: ResizeHandle;
      startX: number;
      startY: number;
      origBlocks: Record<string, TextBlock>;
      groupMetrics: BlockMetrics;
    }
  | {
      kind: "marquee-select";
      active: boolean;
      startX: number;
      startY: number;
      currentX: number;
      currentY: number;
      selectImageOnClick?: boolean;
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

function roundVideoTime(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizeVideoTrim(trim?: Partial<VideoTrim> | null): VideoTrim {
  const rawStart = Number(trim?.start);
  const start = Number.isFinite(rawStart) ? Math.max(0, roundVideoTime(rawStart)) : 0;
  const rawEnd = trim?.end;
  const endValue = typeof rawEnd === "number" && Number.isFinite(rawEnd)
    ? Math.max(0, roundVideoTime(rawEnd))
    : null;

  return {
    start,
    end: endValue !== null && endValue > start ? endValue : null,
  };
}

function normalizeVideoSegment(segment: Partial<VideoSegment>, fallback: VideoTrim, duration = 0): VideoSegment {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const minGap = safeDuration ? Math.min(0.15, safeDuration) : 0.15;
  const rawStart = Number(segment.start);
  const startMax = safeDuration ? Math.max(0, safeDuration - minGap) : Number.POSITIVE_INFINITY;
  const start = clamp(Number.isFinite(rawStart) ? rawStart : fallback.start, 0, startMax);
  const explicitEnd = typeof segment.end === "number" && Number.isFinite(segment.end) ? segment.end : null;
  const fallbackEnd = fallback.end ?? null;
  const rawEnd = explicitEnd ?? fallbackEnd;
  const end = safeDuration
    ? clamp(Math.max(rawEnd ?? safeDuration, start + minGap), start + minGap, safeDuration)
    : rawEnd === null
      ? null
      : Math.max(rawEnd, start + minGap);

  return {
    id: segment.id || uid(),
    start: roundVideoTime(start),
    end: end === null ? null : roundVideoTime(end),
    enabled: segment.enabled !== false,
  };
}

function normalizeVideoTimeline(
  segments?: Partial<VideoSegment>[] | null,
  trim?: Partial<VideoTrim> | null,
  duration = 0
): VideoSegment[] {
  const fallbackTrim = normalizeVideoTrim(trim);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const source = Array.isArray(segments) && segments.length
    ? segments
    : [{ id: uid(), start: fallbackTrim.start, end: fallbackTrim.end ?? (safeDuration || null), enabled: true }];

  return source
    .map((segment) => normalizeVideoSegment(segment, fallbackTrim, safeDuration))
    .sort((a, b) => a.start - b.start);
}

function createDefaultVideoTimeline(): VideoSegment[] {
  return [{ id: uid(), start: 0, end: null, enabled: true }];
}

function resolveVideoTrimRange(trimValue?: Partial<VideoTrim> | null, duration = 0) {
  const trim = normalizeVideoTrim(trimValue);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const fallbackEnd = safeDuration || trim.end || trim.start;
  const minGap = safeDuration ? Math.min(0.2, safeDuration) : 0;
  const startMax = safeDuration ? Math.max(0, safeDuration - minGap) : Number.POSITIVE_INFINITY;
  const start = clamp(trim.start, 0, startMax);
  const rawEnd = trim.end ?? fallbackEnd;
  const end = safeDuration
    ? clamp(Math.max(rawEnd, start + minGap), Math.min(safeDuration, start + minGap), safeDuration)
    : Math.max(rawEnd, start);

  return {
    start: roundVideoTime(start),
    end: roundVideoTime(end),
    length: roundVideoTime(Math.max(0, end - start)),
  };
}

function getVideoTrimRange(creative?: Creative | null, duration = 0) {
  if (creative?.videoTimeline?.length) {
    const segments = getVideoTimelineSegments(creative, duration);
    const enabled = segments.filter((segment) => segment.enabled);
    const first = enabled[0] || segments[0];
    if (first) return resolveVideoTrimRange({ start: first.start, end: first.end }, duration);
  }
  return resolveVideoTrimRange(creative?.videoTrim, duration);
}

function getVideoTimelineSegments(creative?: Creative | null, duration = 0) {
  if (!creative || (creative.mediaKind || "image") !== "video") return [];
  const segments = normalizeVideoTimeline(creative.videoTimeline, creative.videoTrim, duration);
  const safeDuration = Number.isFinite(duration) && duration > 1.25 ? duration : 0;
  const isOldDefaultOneSecondClip =
    safeDuration > 0 &&
    segments.length === 1 &&
    segments[0].start === 0 &&
    segments[0].enabled &&
    typeof segments[0].end === "number" &&
    segments[0].end <= 1.01 &&
    !creative.videoTrim?.end;
  return isOldDefaultOneSecondClip ? [{ ...segments[0], end: roundVideoTime(safeDuration) }] : segments;
}

function getEnabledVideoSegments(creative?: Creative | null, duration = 0) {
  const segments = getVideoTimelineSegments(creative, duration);
  const enabled = segments.filter((segment) => segment.enabled);
  return enabled.length ? enabled : segments.slice(0, 1);
}

function findVideoSegmentAtTime(segments: VideoSegment[], time: number) {
  return segments.find((segment) => time >= segment.start && time < (segment.end ?? time + 1)) || null;
}

function getFirstVideoSegmentStart(creative?: Creative | null, duration = 0) {
  return getEnabledVideoSegments(creative, duration)[0]?.start ?? 0;
}

function formatVideoTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  const tenths = Math.floor((value % 1) * 10);
  return `${minutes}:${seconds.toString().padStart(2, "0")}${tenths ? `.${tenths}` : ""}`;
}

function normalizeCreative(creative: Creative): Creative {
  const mediaKind = creative.mediaKind || "image";
  const videoTimeline = mediaKind === "video"
    ? normalizeVideoTimeline(creative.videoTimeline, creative.videoTrim)
    : undefined;
  return {
    ...creative,
    mediaKind,
    videoTrim: mediaKind === "video" ? normalizeVideoTrim(creative.videoTrim) : undefined,
    videoTimeline,
    videoMuted: mediaKind === "video" ? creative.videoMuted ?? true : undefined,
    videoVolume: mediaKind === "video" ? clamp(creative.videoVolume ?? 1, 0, 1) : undefined,
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

function isHeicFile(file: File) {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type.includes("heic") || type.includes("heif") || /\.(heic|heif)$/.test(name);
}

async function normalizeUploadFile(file: File): Promise<File> {
  if (!isHeicFile(file) || typeof window === "undefined") return file;
  const { default: heic2any } = await import("heic2any");
  const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const blob = Array.isArray(converted) ? converted[0] : converted;
  const filename = file.name.replace(/\.(heic|heif)$/i, "") || "heic-image";
  return new File([blob], `${filename}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

async function normalizeUploadFiles(files: FileList | File[] | null): Promise<File[]> {
  if (!files?.length) return [];
  const list = Array.from(files);
  return Promise.all(list.map((file) => normalizeUploadFile(file).catch(() => file)));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 60_000) {
  const controller = new AbortController();
  const externalSignal = init.signal;
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const abortFromExternal = () => controller.abort();

  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(externalSignal?.aborted ? "Upload cancelled." : "Upload timed out. Try the file again.");
    }
    throw err;
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
}

async function makeVideoPosterFile(file: File): Promise<File | null> {
  if (typeof document === "undefined" || !getUploadContentType(file).startsWith("video/")) return null;

  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<File | null>((resolve) => {
      const video = document.createElement("video");
      let settled = false;
      const finish = (poster: File | null) => {
        if (settled) return;
        settled = true;
        resolve(poster);
      };

      const timer = window.setTimeout(() => finish(null), 8000);

      video.preload = "metadata";
      video.muted = true;
      video.playsInline = true;
      video.src = objectUrl;

      const capture = () => {
        try {
          const width = video.videoWidth || 540;
          const height = video.videoHeight || 960;
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            window.clearTimeout(timer);
            finish(null);
            return;
          }
          ctx.drawImage(video, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              window.clearTimeout(timer);
              if (!blob) {
                finish(null);
                return;
              }
              const base = file.name.replace(/\.[^.]+$/, "") || "video";
              finish(new File([blob], `${base}-poster.jpg`, { type: "image/jpeg", lastModified: Date.now() }));
            },
            "image/jpeg",
            0.82
          );
        } catch {
          window.clearTimeout(timer);
          finish(null);
        }
      };

      video.onloadedmetadata = () => {
        try {
          const duration = Number.isFinite(video.duration) ? video.duration : 0;
          video.currentTime = duration > 0 ? Math.min(0.18, duration / 5) : 0;
        } catch {
          capture();
        }
      };
      video.onseeked = capture;
      video.onloadeddata = capture;
      video.onerror = () => {
        window.clearTimeout(timer);
        finish(null);
      };
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function uploadFileToR2(file: File, projectId?: string | null, folderId?: string | null, signal?: AbortSignal) {
  const contentType = getUploadContentType(file);
  const presignRes = await fetchWithTimeout("/api/studio-2/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      filename: file.name,
      contentType,
      fileSize: file.size,
      projectId,
      folderId,
    }),
  }, 30_000);

  if (!presignRes.ok) throw new Error("R2 upload URL failed");
  const presign = await presignRes.json() as {
    key: string;
    publicUrl: string;
    uploadUrl: string;
    headers?: Record<string, string>;
  };

  const uploadRes = await fetchWithTimeout(presign.uploadUrl, {
    method: "PUT",
    headers: presign.headers || { "Content-Type": contentType },
    signal,
    body: file,
  }, contentType.startsWith("video/") ? 180_000 : 60_000);

  if (!uploadRes.ok) throw new Error("R2 upload failed");

  return { ...presign, contentType };
}

async function uploadStudioMedia(file: File, projectId?: string | null, folderId?: string | null, signal?: AbortSignal): Promise<StudioMediaAsset> {
  const contentType = getUploadContentType(file);
  const upload = await uploadFileToR2(file, projectId, folderId, signal);
  const posterFile = contentType.startsWith("video/") ? await makeVideoPosterFile(file) : null;
  let thumbnailUrl: string | null = null;

  if (posterFile && !signal?.aborted) {
    try {
      const posterUpload = await uploadFileToR2(posterFile, projectId, folderId, signal);
      thumbnailUrl = posterUpload.publicUrl;
    } catch {
      thumbnailUrl = null;
    }
  }

  const completeRes = await fetchWithTimeout("/api/studio-2/media/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      key: upload.key,
      publicUrl: upload.publicUrl,
      thumbnailUrl,
      filename: file.name,
      contentType,
      fileSize: file.size,
      projectId,
      folderId,
    }),
  }, 30_000);

  if (!completeRes.ok) throw new Error("Media save failed");

  const data = await completeRes.json() as { media?: Partial<StudioMediaAsset> };
  return {
    id: String(data.media?.id || uid()),
    url: String(data.media?.url || upload.publicUrl),
    thumbnailUrl: typeof data.media?.thumbnailUrl === "string" ? data.media.thumbnailUrl : thumbnailUrl,
    kind: data.media?.kind === "video" ? "video" : contentType.startsWith("video/") ? "video" : "image",
    filename: String(data.media?.filename || file.name),
    folderId: typeof data.media?.folderId === "string" ? data.media.folderId : folderId || null,
    createdAt: typeof data.media?.createdAt === "string" ? data.media.createdAt : new Date().toISOString(),
  };
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
  if (ext === "heic") return "image/heic";
  if (ext === "heif") return "image/heif";
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

function loadVideoFrame(src: string, atSeconds = 0): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const resolvedSrc = getCanvasImageSrc(src);
    let settled = false;
    const wantsSeek = atSeconds > 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(video);
    };

    if (/^https?:\/\//i.test(resolvedSrc)) video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadedmetadata = () => {
      if (!wantsSeek) {
        finish();
        return;
      }
      const maxSeek = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : atSeconds;
      video.currentTime = clamp(atSeconds, 0, maxSeek);
    };
    video.onseeked = finish;
    video.onloadeddata = () => {
      if (!wantsSeek) finish();
    };
    video.oncanplay = () => {
      if (!wantsSeek) finish();
    };
    video.onerror = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Video failed to load"));
    };
    video.src = resolvedSrc;
    video.load();
  });
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: keyof HTMLMediaElementEventMap, timeoutMs = 12_000) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener(eventName, onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Video failed to load"));
    };
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Video took too long to load"));
    }, timeoutMs);
    video.addEventListener(eventName, onReady, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function ensureVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration)) return;
  await waitForVideoEvent(video, "loadedmetadata");
}

async function seekVideoElement(video: HTMLVideoElement, time: number) {
  await ensureVideoMetadata(video);
  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : time;
  const nextTime = clamp(time, 0, Math.max(0, duration - 0.02));
  if (Math.abs(video.currentTime - nextTime) < 0.025 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const seeked = waitForVideoEvent(video, "seeked", 12_000);
  video.currentTime = nextTime;
  await seeked;
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    await waitForVideoEvent(video, "canplay", 12_000).catch(() => undefined);
  }
}

function getVideoRecorderFormat() {
  if (typeof MediaRecorder === "undefined") return null;
  const mp4Type = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ].find((type) => MediaRecorder.isTypeSupported(type));
  return mp4Type ? { mimeType: mp4Type, extension: "mp4" } : null;
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
  return src;
}

function isHeicMediaName(value: string) {
  return /\.(heic|heif)(?:$|\?)/i.test(value);
}

function looksLikeVideoUrl(value: string) {
  return /\.(mp4|mov|m4v|webm|avi|mkv)(?:$|\?)/i.test(value);
}

async function downloadBlob(blob: Blob, filename: string) {
  // Chromium (Chrome/Edge): open the native Save dialog so the user can choose
  // the destination folder and rename the file. Falls back to a normal download
  // into the default Downloads folder on browsers without the API.
  const picker = (window as unknown as {
    showSaveFilePicker?: (opts: { suggestedName?: string }) => Promise<{
      createWritable: () => Promise<{ write: (d: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled
      // Any other error (unsupported context, permission) → fall through.
    }
  }
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(href);
  }, 60_000);
}

function MediaAssetPreview({
  asset,
  style,
  alt = "",
}: {
  asset: Pick<StudioMediaAsset, "url" | "thumbnailUrl" | "filename" | "kind">;
  style?: React.CSSProperties;
  alt?: string;
}) {
  const previewSrc = asset.thumbnailUrl || asset.url;
  const heic = isHeicMediaName(asset.filename || "") || isHeicMediaName(previewSrc || "");
  const [convertedSrc, setConvertedSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!heic) {
      setConvertedSrc("");
      return;
    }
    let cancelled = false;
    let objectUrl = "";
    (async () => {
      try {
        const res = await fetch(getMediaPreviewSrc(previewSrc));
        if (!res.ok) throw new Error("HEIC preview fetch failed");
        const sourceBlob = await res.blob();
        const { default: heic2any } = await import("heic2any");
        const converted = await heic2any({ blob: sourceBlob, toType: "image/jpeg", quality: 0.9 });
        const blob = Array.isArray(converted) ? converted[0] : converted;
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setConvertedSrc(objectUrl);
      } catch {
        if (!cancelled) setConvertedSrc("");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewSrc, heic]);

  if (asset.kind === "video" && !asset.thumbnailUrl && !failed) {
    return (
      <video
        draggable={false}
        src={getMediaPreviewSrc(asset.url)}
        muted
        playsInline
        preload="metadata"
        style={{
          ...style,
          background: ADS_BRAND.bgDeep,
        }}
        onLoadedMetadata={(event) => {
          try {
            const video = event.currentTarget;
            if (Number.isFinite(video.duration) && video.duration > 0) {
              video.currentTime = Math.min(0.12, video.duration / 4);
            }
          } catch {
            // Some browsers reject currentTime before enough video data is buffered.
          }
        }}
        onError={() => setFailed(true)}
      />
    );
  }

  if (failed) {
    return (
      <div
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ADS_BRAND.text3,
          background: ADS_BRAND.bgDeep,
          position: "relative",
        }}
      >
        {asset.kind === "video" ? <Video size={22} /> : <ImagePlus size={22} />}
      </div>
    );
  }

  if (heic && !convertedSrc) {
    return (
      <div
        style={{
          ...style,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ADS_BRAND.text3,
          background: ADS_BRAND.bgDeep,
        }}
      >
        <LoaderCircle size={18} style={{ animation: "spin 1s linear infinite" }} />
      </div>
    );
  }

  return <img draggable={false} src={convertedSrc || getMediaPreviewSrc(previewSrc)} alt={alt} style={style} onError={() => setFailed(true)} />;
}

function isGenerateErrorStatus(status: string) {
  const value = status.toLowerCase();
  return (
    value.includes("could") ||
    value.includes("failed") ||
    value.includes("error") ||
    value.includes("snag") ||
    value.includes("unexpected token") ||
    value.includes("invalid json") ||
    value.includes("non-json") ||
    value.includes("rejected") ||
    value.includes("timed out") ||
    value.includes("stopped") ||
    value.includes("canceled") ||
    value.includes("cancelled") ||
    value.includes("too large")
  );
}

function isHiggsfieldAuthStatus(status: string) {
  const value = status.toLowerCase();
  if (value.includes("unexpected token")) return false;
  return (
    value.includes("fresh login") ||
    value.includes("reconnect higgsfield") ||
    value.includes("credential") ||
    value.includes("unauthorized") ||
    value.includes("forbidden") ||
    value.includes("auth") ||
    value.includes("login token")
  );
}

function isGenerateSuccessStatus(status: string) {
  const value = status.toLowerCase();
  return value.includes("saved") || value.includes("ready") || value.includes("complete") || value.includes("created");
}

function formatGenerationStatusLabel(status: string) {
  const value = status.toLowerCase();
  if (["starting", "queued", "pending", "in_progress", "processing", "running"].includes(value)) return "Creating";
  if (value === "completed") return "Ready";
  if (value === "failed") return "Failed";
  return value.replace(/_/g, " ") || "Creating";
}

function summarizeStoredGenerationPrompt(prompt: string) {
  return prompt
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .find((part) => part && !/^use this exact ad copy/i.test(part) && !/^preserve readable text/i.test(part))
    ?.slice(0, 700) || prompt.slice(0, 700);
}

async function requestCopyLabTranscription(winner: CopyLabWinner) {
  const res = await fetch("/api/studio-2/copy-lab/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      imageUrl: winner.previewImageUrl,
      adId: winner.adId || winner.id,
      clientKey: winner.clientKey,
      adName: winner.adName,
      campaignName: winner.campaignName,
    }),
  });
  const data = await res.json() as { transcription?: { text?: string }; error?: string };
  if (!res.ok) throw new Error(data.error || "Transcription failed");
  return data.transcription?.text || "";
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

// Deterministic pseudo-random so the marker texture stays stable across redraws
// (Math.random would re-jitter the strokes on every frame).
function seededRandom(seed: number) {
  let t = (seed >>> 0) + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Draws a hand-drawn highlighter / marker stroke behind a line of text:
// a slightly wobbly capsule with overshooting, tapered ends — like a real
// marker swiped across the line. Deterministic per `seed`.
function drawMarkerHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  opacity: number,
  seed: number
) {
  const rand = seededRandom(seed);
  const rgb = hexToRgb(color);
  const cap = h * 0.5;

  // Per-line character so no two highlights read the same.
  // Thinner band that hugs the text — an aesthetic swipe, not a heavy block.
  const half = (h / 2) * (0.6 + rand() * 0.12); // ink height varies line to line
  const slant = (rand() - 0.5) * h * 0.09; // the whole swipe tilts a hair
  const wob = h * (0.04 + rand() * 0.05); // edge waviness amount

  // Each END gets its own shape: overshoot, how far/round the tip bulges,
  // a vertical tip offset (asymmetry), and how much the corners taper.
  const makeCap = () => ({
    over: cap * (0.4 + rand() * 1.0),
    bulge: 0.18 + rand() * 0.62,
    tip: (rand() - 0.5) * h * 0.26,
    topPull: 0.22 + rand() * 0.5,
    botPull: 0.22 + rand() * 0.5,
  });
  const capL = makeCap();
  const capR = makeCap();

  const left = x - capL.over;
  const right = x + w + capR.over;
  const midY = y + h / 2;
  const baseAt = (t: number) => midY - slant + slant * 2 * t; // left baseline -> right baseline
  const segments = Math.max(3, Math.round((right - left) / (h * (0.62 + rand() * 0.4))));

  // Precompute the wavy top/bottom edges once so the caps reuse the exact
  // same corner points (otherwise re-rolling rand would tear the path).
  const topPts: Array<{ x: number; y: number }> = [];
  const botPts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const px = left + (right - left) * t;
    const edge = i === 0 || i === segments ? wob * 0.2 : wob; // calmer right at the caps
    topPts.push({ x: px, y: baseAt(t) - half + (rand() - 0.5) * edge });
    botPts.push({ x: px, y: baseAt(t) + half + (rand() - 0.5) * edge });
  }

  const tl = topPts[0];
  const bl = botPts[0];
  const tr = topPts[segments];
  const br = botPts[segments];
  const leftTipX = left - capL.bulge * cap;
  const leftTipY = baseAt(0) + capL.tip;
  const rightTipX = right + capR.bulge * cap;
  const rightTipY = baseAt(1) + capR.tip;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  // Left cap: top corner -> tip -> bottom corner
  ctx.quadraticCurveTo(leftTipX, tl.y + (leftTipY - tl.y) * capL.topPull, leftTipX, leftTipY);
  ctx.quadraticCurveTo(leftTipX, bl.y + (leftTipY - bl.y) * capL.botPull, bl.x, bl.y);
  // Bottom edge left -> right
  for (let i = 1; i <= segments; i++) ctx.lineTo(botPts[i].x, botPts[i].y);
  // Right cap: bottom corner -> tip -> top corner
  ctx.quadraticCurveTo(rightTipX, br.y + (rightTipY - br.y) * capR.botPull, rightTipX, rightTipY);
  ctx.quadraticCurveTo(rightTipX, tr.y + (rightTipY - tr.y) * capR.topPull, tr.x, tr.y);
  // Top edge right -> left
  for (let i = segments - 1; i >= 0; i--) ctx.lineTo(topPts[i].x, topPts[i].y);
  ctx.closePath();
  // Solid, opaque ink — the swipe aesthetic comes from the thin band + organic
  // varied ends, not from translucency.
  ctx.fillStyle = `rgba(${rgb}, ${Math.min(1, opacity)})`;
  ctx.fill();
  ctx.restore();
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

function getGroupMetrics(ctx: CanvasRenderingContext2D, blocks: TextBlock[]): BlockMetrics | null {
  if (!blocks.length) return null;
  const metrics = blocks.map((block) => measureTextBlock(ctx, block));
  const left = Math.min(...metrics.map((m) => m.x));
  const top = Math.min(...metrics.map((m) => m.y));
  const right = Math.max(...metrics.map((m) => m.x + m.w));
  const bottom = Math.max(...metrics.map((m) => m.y + m.h));
  return { x: left, y: top, w: right - left, h: bottom - top, lines: [] };
}

function normalizeMarqueeRect(startX: number, startY: number, currentX: number, currentY: number): MarqueeRect {
  const left = Math.min(startX, currentX);
  const top = Math.min(startY, currentY);
  return {
    x: left,
    y: top,
    w: Math.abs(currentX - startX),
    h: Math.abs(currentY - startY),
  };
}

function normalizeHex(value: string, fallback = "#ffffff") {
  const clean = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(clean)) return clean;
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean}`;
  if (/^#[0-9a-f]{3}$/i.test(clean)) {
    return `#${clean.slice(1).split("").map((char) => char + char).join("")}`;
  }
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return `#${clean.split("").map((char) => char + char).join("")}`;
  }
  return fallback;
}

function getMediaPreviewUrl(asset?: Pick<StudioMediaAsset, "url" | "thumbnailUrl" | "kind"> | null) {
  if (!asset) return "";
  if (asset.kind === "video") return asset.thumbnailUrl || "";
  return asset.thumbnailUrl || asset.url;
}

function isAiGeneratedFolder(folder?: Pick<StudioFolder, "name"> | null) {
  return folder?.name.trim().toLowerCase() === AI_GENERATED_FOLDER_NAME.toLowerCase();
}

function parsePageRangeInput(input: string, total: number) {
  const selected = new Set<number>();
  input.split(",").forEach((part) => {
    const trimmed = part.trim();
    if (!trimmed) return;
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = clamp(Number(rangeMatch[1]), 1, total);
      const end = clamp(Number(rangeMatch[2]), 1, total);
      for (let page = Math.min(start, end); page <= Math.max(start, end); page++) selected.add(page - 1);
      return;
    }
    const single = Number(trimmed);
    if (Number.isFinite(single)) selected.add(clamp(single, 1, total) - 1);
  });
  return [...selected].sort((a, b) => a - b);
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

function drawCreativeTextBlocks(
  ctx: CanvasRenderingContext2D,
  creative: Creative,
  editingTextBlockId?: string | null
) {
  for (const block of creative.textBlocks) {
    const metrics = measureTextBlock(ctx, block);
    setBlockFont(ctx, block);

    for (const line of metrics.lines) {
      if (block.bgOpacity > 0) {
        if ((block.bgStyle ?? "solid") === "marker") {
          drawMarkerHighlight(
            ctx,
            line.x,
            line.bgY,
            line.bgW,
            line.bgH,
            block.bgColor,
            block.bgOpacity,
            hashString(block.id) ^ (line.start * 2654435761)
          );
        } else {
          ctx.fillStyle = `rgba(${hexToRgb(block.bgColor)}, ${block.bgOpacity})`;
          roundRect(ctx, line.x, line.bgY, line.bgW, line.bgH, block.borderRadius);
          ctx.fill();
        }
      }
    }

    for (const line of metrics.lines) {
      if (block.id === editingTextBlockId) continue;
      drawStyledTextLine(ctx, block, line);
    }
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
  const canDrawVideoMedia =
    hasVideoMedia &&
    media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    media.videoWidth > 0 &&
    media.videoHeight > 0;

  if (!isVideoCreative || !media || canDrawVideoMedia) {
    ctx.fillStyle = CREATIVE_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  if (media) {
    if (canDrawVideoMedia) {
      drawCoverVideo(ctx, media, creative.imageTransform);
    } else if (!hasVideoMedia) {
      drawCoverImage(ctx, media as HTMLImageElement, creative.imageTransform);
    }
  }

  drawCreativeTextBlocks(ctx, creative, editingTextBlockId);

  ctx.restore();
}

function drawArtworkTextOverlay(
  ctx: CanvasRenderingContext2D,
  creative: Creative,
  pixelRatio: number
) {
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  drawCreativeTextBlocks(ctx, creative);
  ctx.restore();
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  creative: Creative | undefined,
  selectedLayer: SelectedLayer,
  selectedTextBlockIds: string[],
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

  if (!creative) {
    ctx.restore();
    return;
  }

  ctx.lineWidth = 5;
  ctx.strokeStyle = ADS_BRAND.gold;
  ctx.fillStyle = ADS_BRAND.gold;
  ctx.shadowColor = "rgba(212,178,122,0.32)";
  ctx.shadowBlur = 16;

  if (selectedLayer?.type === "image") {
    ctx.strokeRect(8, 8, CANVAS_W - 16, CANVAS_H - 16);
    drawImageHandles(ctx);
    ctx.restore();
    return;
  }

  const highlightedTextIds = new Set(selectedTextBlockIds);
  if (selectedLayer?.type === "text") highlightedTextIds.add(selectedLayer.id);

  if (!highlightedTextIds.size) {
    ctx.restore();
    return;
  }

  for (const block of creative.textBlocks) {
    if (!highlightedTextIds.has(block.id)) continue;
    const m = measureTextBlock(measureCtx, block);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
  }

  if (highlightedTextIds.size > 1) {
    const group = getGroupMetrics(
      measureCtx,
      creative.textBlocks.filter((block) => highlightedTextIds.has(block.id))
    );
    if (group) {
      ctx.lineWidth = 6;
      ctx.strokeRect(group.x, group.y, group.w, group.h);
      ctx.shadowBlur = 0;
      drawTextHandles(ctx, group);
      ctx.shadowBlur = 16;
    }
  } else if (selectedLayer?.type === "text") {
    const block = creative.textBlocks.find((item) => item.id === selectedLayer.id);
    if (block) {
      ctx.shadowBlur = 0;
      drawTextHandles(ctx, measureTextBlock(measureCtx, block));
      ctx.shadowBlur = 16;
    }
  }
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
    { handle: "w", x: m.x, y: midY },
    { handle: "e", x: m.x + m.w, y: midY },
    { handle: "nw", x: m.x, y: m.y },
    { handle: "ne", x: m.x + m.w, y: m.y },
    { handle: "sw", x: m.x, y: m.y + m.h },
    { handle: "se", x: m.x + m.w, y: m.y + m.h },
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
    bgStyle: block.bgStyle ?? "solid",
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
  border: "1px solid var(--studio-chip-border)",
  background: "var(--studio-chip-bg)",
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
    border: `1px solid ${isSelected ? ADS_BRAND.gold : "var(--studio-chip-border)"}`,
    background: isSelected ? ADS_BRAND.gold : "var(--studio-chip-bg)",
    color: isSelected ? ADS_BRAND.inkOnGold : ADS_BRAND.text2,
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

const copyLabOfferTypes: CopyLabOfferType[] = ["Direct Offer", "Lead Magnet", "Other"];

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
  const [textBackgroundsEnabled, setTextBackgroundsEnabled] = useState(true);
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
  const [marqueeRect, setMarqueeRect] = useState<MarqueeRect | null>(null);
  const [canvasCursor, setCanvasCursor] = useState("default");
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [editingOriginalLines, setEditingOriginalLines] = useState<string[] | null>(null);
  const [copiedStyle, setCopiedStyle] = useState<TextStyle | null>(null);
  const [colorPalette, setColorPalette] = useState<string[]>(DEFAULT_COLOR_PALETTE);
  const [textStylePresets, setTextStylePresets] = useState<TextStylePreset[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportMode, setExportMode] = useState<ExportMode>("current");
  const [exportFolderName, setExportFolderName] = useState(projectName);
  const [customExportInput, setCustomExportInput] = useState("");
  const [customExportSelection, setCustomExportSelection] = useState<number[]>([]);
  const [topNavMenuOpen, setTopNavMenuOpen] = useState(false);
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
  const [homeLibraryDropActive, setHomeLibraryDropActive] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedDesignIds, setSelectedDesignIds] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const [selectedMediaFolderIds, setSelectedMediaFolderIds] = useState<string[]>([]);
  const [selectedMediaIds, setSelectedMediaIds] = useState<string[]>([]);
  const [hiddenDesignFolderIds, setHiddenDesignFolderIds] = useState<string[]>([]);
  const [draggedDesignIds, setDraggedDesignIds] = useState<string[]>([]);
  const [draggedMediaIds, setDraggedMediaIds] = useState<string[]>([]);
  const [draggedDesignFolderIds, setDraggedDesignFolderIds] = useState<string[]>([]);
  const [draggedMediaFolderIds, setDraggedMediaFolderIds] = useState<string[]>([]);
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
  const [setupMediaKindFilter, setSetupMediaKindFilter] = useState<SetupMediaKindFilter>("all");
  // Explicit order of every selected media url (images + videos interleaved by
  // pick order, not images-then-videos). Drives the ad sequence + the number
  // badges in the picker. Reorder via drag updates this list.
  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);
  const [setupMediaExpanded, setSetupMediaExpanded] = useState(false);
  const [setupMediaZoom, setSetupMediaZoom] = useState(150);
  const [dragOverUrl, setDragOverUrl] = useState<string | null>(null);
  const dragUrlRef = useRef<string | null>(null);
  const [includeAiGeneratedMedia, setIncludeAiGeneratedMedia] = useState(false);
  const [textBackgroundMenuOpen, setTextBackgroundMenuOpen] = useState(false);
  const [setupFontMenuOpen, setSetupFontMenuOpen] = useState(false);
  const [editorFontMenuOpen, setEditorFontMenuOpen] = useState(false);
  const [renameFolderTarget, setRenameFolderTarget] = useState<StudioFolder | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameFolderStatus, setRenameFolderStatus] = useState("");
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
  const [aiGenerations, setAiGenerations] = useState<StudioAIGeneration[]>([]);
  const [selectedGenerationIds, setSelectedGenerationIds] = useState<string[]>([]);
  const [generateDropActive, setGenerateDropActive] = useState(false);
  const [generateSourcePreview, setGenerateSourcePreview] = useState("");
  const [generateSourceAttached, setGenerateSourceAttached] = useState(true);
  const [generateGalleryPercent, setGenerateGalleryPercent] = useState(50);
  const [generateGalleryOpen, setGenerateGalleryOpen] = useState(true);
  const [generateMessages, setGenerateMessages] = useState<GenerateChatMessage[]>([]);
  const [activeGenerateRuns, setActiveGenerateRuns] = useState<ActiveGenerateRun[]>([]);
  const [generateBatchCount, setGenerateBatchCount] = useState(1);
  const [generateToast, setGenerateToast] = useState<{ message: string } | null>(null);
  const [generateAddMenuOpen, setGenerateAddMenuOpen] = useState(false);
  const [generateMediaPickerOpen, setGenerateMediaPickerOpen] = useState(false);
  const [mediaPickerMode, setMediaPickerMode] = useState<MediaPickerMode | null>(null);
  const [generateMediaPickerFolderId, setGenerateMediaPickerFolderId] = useState<string | null>(null);
  const [generatePresetMenuOpen, setGeneratePresetMenuOpen] = useState(false);
  const [galleryFolderMenuOpen, setGalleryFolderMenuOpen] = useState(false);
  const [galleryProjectMenuOpen, setGalleryProjectMenuOpen] = useState(false);
  const [addingGeneratePreset, setAddingGeneratePreset] = useState(false);
  const [newGeneratePresetLabel, setNewGeneratePresetLabel] = useState("");
  const [newGeneratePresetPrompt, setNewGeneratePresetPrompt] = useState("");
  const [customGeneratePresets, setCustomGeneratePresets] = useState<GeneratePreset[]>([]);
  const [hiddenGeneratePresetIds, setHiddenGeneratePresetIds] = useState<string[]>([]);
  const [hoveredGeneratePresetId, setHoveredGeneratePresetId] = useState<string | null>(null);
  const [editingGeneratePreset, setEditingGeneratePreset] = useState<GeneratePreset | null>(null);
  const [editingGeneratePresetLabel, setEditingGeneratePresetLabel] = useState("");
  const [editingGeneratePresetPrompt, setEditingGeneratePresetPrompt] = useState("");
  const [generatedPreview, setGeneratedPreview] = useState<GeneratedPreviewState | null>(null);
  const [higgsfieldAuthModal, setHiggsfieldAuthModal] = useState<HiggsfieldAuthModalState>({ open: false });
  const [pendingHiggsfieldRetry, setPendingHiggsfieldRetry] = useState<PendingGenerateRetry | null>(null);
  const [higgsfieldAuthLoginUrl, setHiggsfieldAuthLoginUrl] = useState("");
  const [higgsfieldAuthStatus, setHiggsfieldAuthStatus] = useState("");
  const [savingHiggsfieldAuth, setSavingHiggsfieldAuth] = useState(false);
  const [selectedTextBlockIds, setSelectedTextBlockIds] = useState<string[]>([]);
  const [creativeThumbs, setCreativeThumbs] = useState<Record<string, string>>({});
  const [hoveredStripIndex, setHoveredStripIndex] = useState<number | null>(null);
  const [editorMediaActionMode, setEditorMediaActionMode] = useState<EditorMediaActionMode | null>(null);
  const [editorUploadMode, setEditorUploadMode] = useState<EditorMediaActionMode | null>(null);
  const [newAdModalOpen, setNewAdModalOpen] = useState(false);
  const [newAdCopy, setNewAdCopy] = useState("");
  const [newAdMediaAssets, setNewAdMediaAssets] = useState<StudioMediaAsset[]>([]);
  const [newAdStatus, setNewAdStatus] = useState("");
  const [draggedLayerBlockId, setDraggedLayerBlockId] = useState<string | null>(null);
  const [layerDropBlockId, setLayerDropBlockId] = useState<string | null>(null);
  const [copyLabOpen, setCopyLabOpen] = useState(false);
  const [copyLabStatus, setCopyLabStatus] = useState("");
  const [copyLabWinners, setCopyLabWinners] = useState<CopyLabWinner[]>([]);
  const [copyLabVariationCount, setCopyLabVariationCount] = useState(12);
  const [copyLabDirection, setCopyLabDirection] = useState("");
  const [copyLabGenerating, setCopyLabGenerating] = useState(false);
  const [copyLabPresets, setCopyLabPresets] = useState<CopyLabPreset[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const videoTimeUpdateRef = useRef(0);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  const generateWorkspaceRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadQueueInputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const generateReferenceInputRef = useRef<HTMLInputElement>(null);
  const generatePromptTextareaRef = useRef<HTMLTextAreaElement>(null);
  const generateConversationEndRef = useRef<HTMLDivElement>(null);
  const generateAddMenuRef = useRef<HTMLDivElement>(null);
  const generatePresetMenuRef = useRef<HTMLDivElement>(null);
  const generateRunControllersRef = useRef(new Map<string, GenerateRunTracker>());
  const topNavMenuRef = useRef<HTMLDivElement>(null);
  const editorSidebarModeRef = useRef(editorSidebarMode);
  const stripRef = useRef<HTMLDivElement>(null);
  const replaceImageInputRef = useRef<HTMLInputElement>(null);
  const sidebarTextRef = useRef<HTMLTextAreaElement>(null);
  const inlineEditRef = useRef<HTMLTextAreaElement>(null);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const [, bumpImageVersion] = useState(0);
  const dragRef = useRef<DragState | null>(null);
  const hydratedRef = useRef(false);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoPendingSeekRef = useRef<number | null>(null);
  const [videoPreviewPlaying, setVideoPreviewPlaying] = useState(true);
  const [videoPreviewDuration, setVideoPreviewDuration] = useState(0);
  const [videoPreviewTime, setVideoPreviewTime] = useState(0);
  const [videoTimelineZoom, setVideoTimelineZoom] = useState(1);
  const [videoTimelineOpen, setVideoTimelineOpen] = useState(true);

  const currentCreative = creatives[currentIndex];
  const defaultGeneratePresetIds = useMemo(() => new Set(DEFAULT_GENERATE_PRESETS.map((preset) => preset.id)), []);
  const selectedBlock =
    selectedLayer?.type === "text"
      ? currentCreative?.textBlocks.find((b) => b.id === selectedLayer.id)
      : undefined;
  const selectedTextBlocks = useMemo(
    () => currentCreative?.textBlocks.filter((block) => selectedTextBlockIds.includes(block.id)) || [],
    [currentCreative?.textBlocks, selectedTextBlockIds]
  );
  const multiSelectedTextBlocks = selectedTextBlocks.length > 1;
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
  const currentVideoTimelineSegments = useMemo(
    () => currentCreative && (currentCreative.mediaKind || "image") === "video"
      ? getVideoTimelineSegments(currentCreative, videoPreviewDuration)
      : [],
    [currentCreative, videoPreviewDuration]
  );
  const videoTimelineAvailable = editorSidebarMode === "edit" && (currentCreative?.mediaKind || "image") === "video";
  const videoTimelineDockOpen = videoTimelineAvailable && videoTimelineOpen;
  const designFolders = useMemo(
    () => cloudFolders.filter((folder) => (folder.folderType || "design") === "design"),
    [cloudFolders]
  );
  const mediaFolders = useMemo(
    () => cloudFolders.filter((folder) => folder.folderType === "media"),
    [cloudFolders]
  );
  const aiGeneratedFolder = useMemo(
    () => mediaFolders.find((folder) => isAiGeneratedFolder(folder)) || null,
    [mediaFolders]
  );
  const aiGeneratedFolderIds = useMemo(
    () => new Set(mediaFolders.filter(isAiGeneratedFolder).map((folder) => folder.id)),
    [mediaFolders]
  );
  const generatingAd = activeGenerateRuns.length > 0;
  const getAssetForUrl = useCallback(
    (url?: string | null) => mediaAssets.find((asset) => asset.url === url) || libraryMedia.find((asset) => asset.url === url) || null,
    [libraryMedia, mediaAssets]
  );
  const getCreativeThumbnailUrl = useCallback(
    (creative?: Creative | null) => {
      if (!creative) return "";
      const asset = getAssetForUrl(creative.photoUrl);
      return getMediaPreviewUrl(asset) || creative.photoUrl;
    },
    [getAssetForUrl]
  );
  const selectedMediaForAds = useMemo(() => {
    // Canonical set of selected media, keyed by url with its kind. Images live
    // in `photos`, videos in `mediaAssets`. Default insertion = images then
    // videos (matches legacy behavior for anything not yet hand-ordered).
    const kindByUrl = new Map<string, MediaKind>();
    photos.forEach((url) => {
      if (!kindByUrl.has(url)) kindByUrl.set(url, "image");
    });
    mediaAssets.forEach((asset) => {
      if (asset.kind === "video" && !kindByUrl.has(asset.url)) kindByUrl.set(asset.url, "video");
    });
    const result: { url: string; kind: MediaKind }[] = [];
    const used = new Set<string>();
    // selectionOrder wins (this is the user's pick/drag order)...
    selectionOrder.forEach((url) => {
      const kind = kindByUrl.get(url);
      if (kind && !used.has(url)) {
        result.push({ url, kind });
        used.add(url);
      }
    });
    // ...then anything selected but not yet tracked falls in after, in default order.
    kindByUrl.forEach((kind, url) => {
      if (!used.has(url)) {
        result.push({ url, kind });
        used.add(url);
      }
    });
    return result;
  }, [mediaAssets, photos, selectionOrder]);
  const selectedOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    selectedMediaForAds.forEach((media, index) => map.set(media.url, index + 1));
    return map;
  }, [selectedMediaForAds]);
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
    () => {
      const folderFiltered = setupMediaFolderId
        ? libraryMedia.filter((asset) => (asset.folderId || null) === setupMediaFolderId)
        : libraryMedia.filter((asset) => includeAiGeneratedMedia || !aiGeneratedFolderIds.has(asset.folderId || ""));
      return folderFiltered.filter((asset) => setupMediaKindFilter === "all" || asset.kind === setupMediaKindFilter);
    },
    [aiGeneratedFolderIds, includeAiGeneratedMedia, libraryMedia, setupMediaFolderId, setupMediaKindFilter]
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
    const deduped = [...imageAssets, ...videoAssets, ...setupLibraryMedia].filter((asset) => {
      if (setupMediaKindFilter !== "all" && asset.kind !== setupMediaKindFilter) return false;
      if (seen.has(asset.url)) return false;
      seen.add(asset.url);
      return true;
    });
    // Float selected media to the front in its ad-sequence order so the number
    // badges read 1, 2, 3... in a clean run and drag-reorder is unambiguous.
    // Array.sort is stable, so unselected media keeps its existing order.
    return deduped
      .map((asset, index) => ({ asset, index }))
      .sort((a, b) => {
        const ao = selectedOrderMap.get(a.asset.url) ?? Infinity;
        const bo = selectedOrderMap.get(b.asset.url) ?? Infinity;
        if (ao !== bo) return ao - bo;
        return a.index - b.index;
      })
      .map((entry) => entry.asset);
  }, [mediaAssets, photos, setupLibraryMedia, setupMediaKindFilter, selectedOrderMap]);

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
      thumb: (currentCreative ? creativeThumbs[currentCreative.id] : "") || getCreativeThumbnailUrl(currentCreative) || getMediaPreviewUrl(getAssetForUrl(photos[0])) || photos[0] || "",
      isActiveDraft: true,
    }),
    [activeDraftId, creativeThumbs, currentCreative, getAssetForUrl, getCreativeThumbnailUrl, photos, projectName]
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
    if (homeMode !== "designs") return [];
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return designFolders.filter((folder) => {
      if ((folder.parentId || null) !== selectedFolderId) return false;
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
  const currentGenerateMediaFolder = useMemo(
    () => mediaFolders.find((folder) => folder.id === generateMediaPickerFolderId) || null,
    [generateMediaPickerFolderId, mediaFolders]
  );
  const visibleGenerateMediaFolders = useMemo(
    () => mediaFolders.filter((folder) => (folder.parentId || null) === generateMediaPickerFolderId),
    [generateMediaPickerFolderId, mediaFolders]
  );
  const visibleGenerateMediaAssets = useMemo(
    () => libraryMedia.filter((asset) => (asset.folderId || null) === generateMediaPickerFolderId),
    [generateMediaPickerFolderId, libraryMedia]
  );
  const generateMediaFolderTrail = useMemo(() => {
    const trail: StudioFolder[] = [];
    const seenFolderIds = new Set<string>();
    let cursor = currentGenerateMediaFolder;
    while (cursor && !seenFolderIds.has(cursor.id)) {
      seenFolderIds.add(cursor.id);
      trail.unshift(cursor);
      cursor = mediaFolders.find((folder) => folder.id === cursor?.parentId) || null;
    }
    return trail;
  }, [currentGenerateMediaFolder, mediaFolders]);
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
    () => mediaFolders,
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
      const firstCreative = draft.creatives[0];
      const firstAsset = firstCreative
        ? draft.mediaAssets?.find((asset) => asset.url === firstCreative.photoUrl)
        : draft.mediaAssets?.find((asset) => asset.url === draft.photos[0]);
      const fallbackPhotoThumb = firstCreative && (firstCreative.mediaKind || "image") === "image" ? firstCreative.photoUrl : draft.photos[0] || null;
      const thumbnailUrl = (firstCreative ? creativeThumbs[firstCreative.id] : "") || getMediaPreviewUrl(firstAsset) || fallbackPhotoThumb;
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
    [activeProjectFolderId, creativeThumbs, fetchStudioHome, projectId]
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
        thumbnailUrl: getCreativeThumbnailUrl(currentCreative) || getMediaPreviewUrl(getAssetForUrl(photos[0])) || photos[0] || null,
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
    currentCreative,
    getAssetForUrl,
    getCreativeThumbnailUrl,
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
    editorSidebarModeRef.current = editorSidebarMode;
    if (editorSidebarMode === "generate") setGenerateToast(null);
  }, [editorSidebarMode]);

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
      const panelW = videoTimelineDockOpen ? 0 : 326;
      const toolbarH = 60;
      const dockH = videoTimelineDockOpen ? 332 : 132;
      const availableW = Math.max(320, window.innerWidth - panelW - 300);
      const availableH = Math.max(420, window.innerHeight - toolbarH - dockH - 30);
      const next = Math.min(availableW / CANVAS_W, availableH / CANVAS_H, 0.62);
      setViewScale(clamp(next, 0.18, 0.7));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [videoTimelineDockOpen]);

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
      const liveVideo = (currentCreative.mediaKind || "image") === "video" ? videoPreviewRef.current : null;
      drawArtwork(ctx, currentCreative, liveVideo || currentImage, dpr, editingBlockId);
    } else {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = CREATIVE_BG;
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      ctx.restore();
    }
    drawOverlay(
      overlayCtx,
      currentCreative,
      editingBlockId ? null : selectedLayer,
      editingBlockId ? [] : selectedTextBlockIds,
      activeGuides,
      activeSafeZones,
      getMeasureCtx(),
      dpr
    );
  }, [activeGuides, activeSafeZones, currentCreative, currentImage, selectedLayer, selectedTextBlockIds, editingBlockId, getMeasureCtx]);

  useEffect(() => {
    renderPreview();
  }, [renderPreview, viewScale]);

  useEffect(() => {
    if ((currentCreative?.mediaKind || "image") !== "video") return;
    renderPreview();
  }, [currentCreative?.id, currentCreative?.mediaKind, renderPreview, videoPreviewTime]);

  useEffect(() => {
    if ((currentCreative?.mediaKind || "image") !== "video" || !videoPreviewPlaying) return;
    let frame = 0;
    const tick = () => {
      renderPreview();
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [currentCreative?.id, currentCreative?.mediaKind, renderPreview, videoPreviewPlaying]);

  useEffect(() => {
    if (editorSidebarMode !== "edit" || !currentCreative || (currentCreative.mediaKind || "image") === "video") return;
    const url = currentCreative.photoUrl;
    let cancelled = false;
    loadImage(url)
      .then((img) => {
        if (cancelled) return;
        imageCacheRef.current.set(url, img);
        bumpImageVersion((v) => v + 1);
        window.requestAnimationFrame(() => renderPreview());
      })
      .catch(() => window.requestAnimationFrame(() => renderPreview()));
    return () => {
      cancelled = true;
    };
  }, [currentCreative, editorSidebarMode, renderPreview]);

  useEffect(() => {
    if (!currentCreative || (currentCreative.mediaKind || "image") !== "video") {
      setVideoPreviewDuration(0);
      setVideoPreviewTime(0);
      return;
    }
    const video = videoPreviewRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const segments = getEnabledVideoSegments(currentCreative, duration);
    const range = segments[0] ? resolveVideoTrimRange({ start: segments[0].start, end: segments[0].end }, duration) : getVideoTrimRange(currentCreative, duration);
    if (duration) setVideoPreviewDuration(duration);
    if (!findVideoSegmentAtTime(segments, video.currentTime)) {
      video.currentTime = range.start;
    }
    setVideoPreviewTime(video.currentTime || range.start);
  }, [currentCreative]);

  useEffect(() => {
    const video = videoPreviewRef.current;
    if (!video || !currentCreative || (currentCreative.mediaKind || "image") !== "video") return;
    video.volume = clamp(currentCreative.videoVolume ?? 1, 0, 1);
    video.muted = currentCreative.videoMuted ?? true;
  }, [currentCreative]);

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

  useEffect(() => {
    if (!topNavMenuOpen) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && topNavMenuRef.current?.contains(target)) return;
      setTopNavMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [topNavMenuOpen]);

  useEffect(() => {
    if (!generateAddMenuOpen) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && generateAddMenuRef.current?.contains(target)) return;
      setGenerateAddMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsidePointerDown);
    return () => window.removeEventListener("pointerdown", closeOnOutsidePointerDown);
  }, [generateAddMenuOpen]);

  useEffect(() => {
    if (!textBackgroundMenuOpen) return;
    const close = () => setTextBackgroundMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [textBackgroundMenuOpen]);

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
    setSelectedTextBlockIds([]);
  }, [creatives, undoStack]);

  const redo = useCallback(() => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((stack) => [...stack, cloneCreatives(creatives)]);
    setCreatives(cloneCreatives(next));
    setRedoStack((stack) => stack.slice(0, -1));
    setSelectedLayer(null);
    setSelectedTextBlockIds([]);
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

  const updateSelectedTextBlocks = useCallback(
    (updates: Partial<TextBlock>) => {
      if (!selectedTextBlocks.length) return;
      const ids = new Set(selectedTextBlocks.map((block) => block.id));
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          ids.has(block.id) ? { ...block, ...updates } : block
        ),
      }));
    },
    [selectedTextBlocks, updateCurrentCreative]
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
      const nextColor = normalizeHex(color, selectedBlock.textColor).toUpperCase();
      const range = selectedTextRange;
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          block.id === selectedBlock.id
            ? applyTextColorSpan(block, range.start, range.end, nextColor)
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

  const addPaletteColor = useCallback((color: string) => {
    const hex = normalizeHex(color, "").toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) return;
    setColorPalette((prev) => [hex, ...prev.filter((c) => c.toUpperCase() !== hex)].slice(0, MAX_PALETTE_COLORS));
  }, []);

  const removePaletteColor = useCallback((color: string) => {
    const hex = color.toUpperCase();
    setColorPalette((prev) => prev.filter((c) => c.toUpperCase() !== hex));
  }, []);

  // Select every text block on the current ad — so a saved style can be applied to all at once.
  const selectAllTextBlocks = useCallback(() => {
    const ids = currentCreative?.textBlocks.map((block) => block.id) ?? [];
    if (!ids.length) return;
    setEditingBlockId(null);
    setSelectedTextBlockIds(ids);
    setSelectedLayer(ids.length === 1 ? { type: "text", id: ids[0] } : null);
  }, [currentCreative?.textBlocks]);

  // Apply a saved style to the selected block(s), or to every block if nothing is selected.
  const applyTextStylePreset = useCallback(
    (preset: TextStylePreset) => {
      if (!currentCreative) return;
      const targetIds = selectedTextBlocks.length
        ? new Set(selectedTextBlocks.map((block) => block.id))
        : selectedBlock
          ? new Set([selectedBlock.id])
          : new Set(currentCreative.textBlocks.map((block) => block.id));
      if (!targetIds.size) return;
      pushUndo();
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) =>
          targetIds.has(block.id)
            ? {
                ...block,
                textColor: preset.textColor,
                bgColor: preset.bgColor,
                bgOpacity: preset.bgOpacity,
                bgStyle: preset.bgStyle,
                borderRadius: preset.borderRadius,
              }
            : block
        ),
      }));
    },
    [currentCreative, pushUndo, selectedBlock, selectedTextBlocks, updateCurrentCreative]
  );

  const saveTextStylePreset = useCallback(() => {
    const source = selectedBlock ?? selectedTextBlocks[0];
    if (!source) return;
    const preset: TextStylePreset = {
      id: `style-${hashString(`${source.textColor}|${source.bgColor}|${source.bgStyle}|${source.bgOpacity}`)}-${(source.textColor + source.bgColor).replace(/[^0-9A-F]/gi, "").slice(0, 6)}`,
      textColor: normalizeHex(source.textColor, "#FFFFFF").toUpperCase(),
      bgColor: normalizeHex(source.bgColor, "#000000").toUpperCase(),
      bgOpacity: source.bgOpacity > 0 ? source.bgOpacity : 1,
      bgStyle: source.bgStyle ?? "solid",
      borderRadius: source.borderRadius,
    };
    setTextStylePresets((prev) => {
      const exists = prev.some(
        (p) =>
          p.textColor === preset.textColor &&
          p.bgColor === preset.bgColor &&
          p.bgStyle === preset.bgStyle &&
          Math.abs(p.bgOpacity - preset.bgOpacity) < 0.01
      );
      if (exists) return prev;
      return [preset, ...prev].slice(0, MAX_TEXT_STYLE_PRESETS);
    });
  }, [selectedBlock, selectedTextBlocks]);

  const removeTextStylePreset = useCallback((id: string) => {
    setTextStylePresets((prev) => prev.filter((preset) => preset.id !== id));
  }, []);

  const updateImage = useCallback(
    (updates: Partial<ImageTransform>) => {
      updateCurrentCreative((creative) => ({
        ...creative,
        imageTransform: { ...creative.imageTransform, ...updates },
      }));
    },
    [updateCurrentCreative]
  );

  const updateVideoSettings = useCallback(
    (updates: Partial<Pick<Creative, "videoTrim" | "videoTimeline" | "videoMuted" | "videoVolume">>) => {
      updateCurrentCreative((creative) => {
        if ((creative.mediaKind || "image") !== "video") return creative;
        const nextTimeline = updates.videoTimeline
          ? normalizeVideoTimeline(updates.videoTimeline, updates.videoTrim || creative.videoTrim, videoPreviewDuration)
          : undefined;
        const enabled = nextTimeline?.filter((segment) => segment.enabled) || [];
        const firstEnabled = enabled[0] || nextTimeline?.[0];
        return {
          ...creative,
          ...(updates.videoTrim ? { videoTrim: normalizeVideoTrim(updates.videoTrim) } : {}),
          ...(nextTimeline
            ? {
                videoTimeline: nextTimeline,
                videoTrim: firstEnabled
                  ? { start: firstEnabled.start, end: firstEnabled.end }
                  : normalizeVideoTrim(updates.videoTrim || creative.videoTrim),
              }
            : {}),
          ...(typeof updates.videoMuted === "boolean" ? { videoMuted: updates.videoMuted } : {}),
          ...(typeof updates.videoVolume === "number"
            ? { videoVolume: clamp(updates.videoVolume, 0, 1) }
            : {}),
        };
      });
    },
    [updateCurrentCreative, videoPreviewDuration]
  );

  const seekVideoPreview = useCallback((time: number) => {
    const video = videoPreviewRef.current;
    const duration = video && Number.isFinite(video.duration) && video.duration > 0 ? video.duration : videoPreviewDuration;
    const nextTime = clamp(time, 0, Math.max(duration, 0));
    videoPendingSeekRef.current = nextTime;
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      try {
        if (Math.abs(video.currentTime - nextTime) > 0.015) video.currentTime = nextTime;
      } catch {
        // The pending seek is applied as soon as metadata/data is ready.
      }
    }
    setVideoPreviewTime(nextTime);
    window.requestAnimationFrame(() => renderPreview());
  }, [renderPreview, videoPreviewDuration]);

  const toggleVideoPlayback = useCallback(() => {
    const video = videoPreviewRef.current;
    if (!video || !currentCreative || (currentCreative.mediaKind || "image") !== "video") return;
    if (video.paused) {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) video.load();
      void video.play().then(() => setVideoPreviewPlaying(true)).catch(() => undefined);
      return;
    }
    video.pause();
    setVideoPreviewPlaying(false);
  }, [currentCreative]);

  const updateVideoTimelineSegments = useCallback(
    (segments: VideoSegment[], previewTime?: number) => {
      const normalized = normalizeVideoTimeline(segments, currentCreative?.videoTrim, videoPreviewDuration);
      updateVideoSettings({ videoTimeline: normalized });
      if (typeof previewTime === "number") seekVideoPreview(previewTime);
    },
    [currentCreative?.videoTrim, seekVideoPreview, updateVideoSettings, videoPreviewDuration]
  );

  const splitVideoAtPlayhead = useCallback(() => {
    if (!currentCreative || (currentCreative.mediaKind || "image") !== "video") return;
    const duration = videoPreviewDuration;
    const segments = getVideoTimelineSegments(currentCreative, duration);
    const playhead = clamp(videoPreviewTime, 0, duration || Number.POSITIVE_INFINITY);
    const target = segments.find((segment) => playhead > segment.start + 0.12 && playhead < (segment.end ?? duration) - 0.12);
    if (!target) return;
    pushUndo();
    updateVideoTimelineSegments(
      segments.flatMap((segment) =>
        segment.id === target.id
          ? [
              { ...segment, end: roundVideoTime(playhead) },
              { ...segment, id: uid(), start: roundVideoTime(playhead), end: target.end, enabled: target.enabled },
            ]
          : [segment]
      ),
      playhead
    );
  }, [currentCreative, pushUndo, updateVideoTimelineSegments, videoPreviewDuration, videoPreviewTime]);

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
        bgOpacity: textBackgroundsEnabled ? 1 : 0,
        borderRadius: config.borderRadius,
        paddingH: config.paddingH,
        paddingV: config.paddingV,
        align: role === "body" ? "left" : "center",
        lineGap: config.lineGap,
        lineHeight: 1.5,
        maxWidth: config.maxWidth,
      };
    },
    [colorPreset, fontPreset, textBackgroundsEnabled]
  );

  const addTextBlock = useCallback(() => {
    if (!currentCreative) return;
    pushUndo();
    const newBlock = makeBlock(["New text here"], "body");
    updateCurrentCreative((creative) => ({
      ...creative,
      textBlocks: [
        ...creative.textBlocks,
        {
          ...newBlock,
          x: Math.round((CANVAS_W - newBlock.maxWidth) / 2),
          y: Math.round(CANVAS_H / 2 - newBlock.fontSize * newBlock.lineHeight),
        },
      ],
    }));
    setSelectedLayer({ type: "text", id: newBlock.id });
    setSelectedTextBlockIds([newBlock.id]);
  }, [currentCreative, makeBlock, pushUndo, updateCurrentCreative]);

  const layoutBlocks = useCallback(
    (blocks: TextBlock[]) => {
      const ctx = getMeasureCtx();
      const top = 72;
      const bottom = 1600;
      const measured = blocks.map((block) => measureTextBlock(ctx, block).h);
      const totalH = measured.reduce((sum, h) => sum + h, 0);
      const gap = blocks.length > 1
        ? clamp((bottom - top - totalH) / (blocks.length - 1), totalH > bottom - top ? 8 : 28, 96)
        : 0;
      let y = top;

      const laidOut = blocks.map((block, index) => {
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

      const laidOutMetrics = laidOut.map((block) => measureTextBlock(ctx, block));
      const lastBottom = Math.max(...laidOutMetrics.map((m) => m.y + m.h));
      const overflow = Math.max(0, lastBottom - (CANVAS_H - 120));
      if (!overflow) return laidOut;

      return laidOut.map((block, index) => ({
        ...block,
        y: Math.max(36, Math.round(block.y - overflow * ((index + 1) / laidOut.length))),
      }));
    },
    [getMeasureCtx]
  );

  const handleMediaOnlyUpload = useCallback(async (files: FileList | File[] | null) => {
    const normalizedFiles = await normalizeUploadFiles(files);
    if (!normalizedFiles.length) return;
    const mediaFiles = normalizedFiles.filter((file) => getUploadContentType(file).startsWith("video/"));
    if (!mediaFiles.length) return;
    const uploaded = await Promise.all(
      mediaFiles.map(async (file) => ({
        file,
        asset: await uploadStudioMedia(file, projectId, setupMediaFolderId).catch(() => null),
      }))
    );
    const savedVideos = uploaded.filter((item): item is { file: File; asset: StudioMediaAsset } => !!item.asset);
    if (savedVideos.length) {
      setMediaAssets((prev) => [
        ...prev,
        ...savedVideos.map((item) => item.asset),
      ]);
      setPhotoCopies((prev) => {
        const next = { ...prev };
        savedVideos.forEach((item) => {
          if (!next[item.asset.url]) next[item.asset.url] = 1;
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
    const fileList = await normalizeUploadFiles(files);
    if (!fileList.length) return;
    const imageFiles = fileList.filter((file) => getUploadContentType(file).startsWith("image/"));
    const videoFiles = fileList.filter((file) => getUploadContentType(file).startsWith("video/"));

    if (videoFiles.length) await handleMediaOnlyUpload(videoFiles);
    if (!imageFiles.length) return;

    const urls = await Promise.all(
      imageFiles.map(async (file) => {
        try {
          return { file, asset: await uploadStudioMedia(file, projectId, setupMediaFolderId) };
        } catch {
          const url = await fileToDataUrl(file);
          return {
            file,
            asset: {
              id: uid(),
              url,
              kind: "image" as const,
              filename: file.name,
              folderId: setupMediaFolderId,
            },
          };
        }
      })
    );
    const uploadedImages = urls.filter((item) => item.asset?.url);
    setPhotos((prev) => [...prev, ...uploadedImages.map((item) => item.asset.url)]);
    setMediaAssets((prev) => [
      ...prev,
      ...uploadedImages.map((item) => item.asset),
    ]);
    setPhotoCopies((prev) => {
      const next = { ...prev };
      uploadedImages.forEach((item) => {
        if (!next[item.asset.url]) next[item.asset.url] = 1;
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
    setSelectionOrder((prev) => prev.filter((url) => url !== photo));
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
      setSelectionOrder((prev) => prev.filter((url) => url !== asset.url));
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
    // Append to the pick order so the new item lands at the end of the sequence.
    setSelectionOrder((prev) => (prev.includes(asset.url) ? prev : [...prev, asset.url]));
    setPhotoCopies((prev) => (prev[asset.url] ? prev : { ...prev, [asset.url]: 1 }));
  }, [mediaAssets, photos, removeSetupPhoto]);

  // Drag-to-reorder: materialize the full selected sequence, then move `fromUrl`
  // to `toUrl`'s slot. Writing the whole order back to selectionOrder keeps it
  // canonical regardless of how items were originally added.
  const moveSelectedMedia = useCallback((fromUrl: string, toUrl: string) => {
    if (fromUrl === toUrl) return;
    setSelectionOrder(() => {
      const order = selectedMediaForAds.map((media) => media.url);
      const from = order.indexOf(fromUrl);
      const to = order.indexOf(toUrl);
      if (from < 0 || to < 0 || from === to) return order;
      const next = [...order];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, [selectedMediaForAds]);

  // Single source of truth for a media tile, shared by the inline picker and the
  // full-screen picker. `tileKey` disambiguates the two grids (same asset can
  // render in both). Selected tiles get a draggable handle + an order badge.
  const renderSetupMediaTile = useCallback(
    (asset: StudioMediaAsset, tileKey: string) => {
      const copyCount = getPhotoCopies(photoCopies, asset.url);
      const isSelected = asset.kind === "image"
        ? photos.includes(asset.url)
        : mediaAssets.some((item) => item.url === asset.url);
      const orderNumber = selectedOrderMap.get(asset.url);
      const isDropTarget = dragOverUrl === asset.url && dragUrlRef.current !== asset.url;
      return (
        <div
          role="button"
          tabIndex={0}
          key={tileKey}
          draggable={isSelected}
          onClick={() => toggleSetupMediaAsset(asset)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleSetupMediaAsset(asset);
            }
          }}
          onDragStart={(event) => {
            if (!isSelected) return;
            dragUrlRef.current = asset.url;
            event.dataTransfer.effectAllowed = "move";
            try {
              event.dataTransfer.setData("text/plain", asset.url);
            } catch {
              /* some browsers disallow setData mid-drag; ref still carries it */
            }
          }}
          onDragOver={(event) => {
            if (!isSelected || !dragUrlRef.current || dragUrlRef.current === asset.url) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            if (dragOverUrl !== asset.url) setDragOverUrl(asset.url);
          }}
          onDragLeave={() => {
            if (dragOverUrl === asset.url) setDragOverUrl(null);
          }}
          onDrop={(event) => {
            if (!isSelected || !dragUrlRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            moveSelectedMedia(dragUrlRef.current, asset.url);
            dragUrlRef.current = null;
            setDragOverUrl(null);
          }}
          onDragEnd={() => {
            dragUrlRef.current = null;
            setDragOverUrl(null);
          }}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "9 / 16",
            borderRadius: 8,
            overflow: "hidden",
            background: ADS_BRAND.bgDeep,
            border: `2px solid ${isDropTarget ? "#fff" : isSelected ? ADS_BRAND.gold : "transparent"}`,
            boxShadow: isDropTarget ? `0 0 0 2px ${ADS_BRAND.gold}` : "none",
            cursor: isSelected ? "grab" : "pointer",
            padding: 0,
          }}
        >
          <MediaAssetPreview asset={asset} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
            <span
              aria-hidden
              style={{
                position: "absolute",
                right: 5,
                top: 5,
                width: 20,
                height: 20,
                borderRadius: 6,
                background: "rgba(0,0,0,0.6)",
                color: "rgba(255,255,255,0.85)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backdropFilter: "blur(6px)",
              }}
            >
              <GripVertical size={12} />
            </span>
          )}
          {isSelected && orderNumber !== undefined && (
            <span
              style={{
                position: "absolute",
                right: 6,
                bottom: 6,
                minWidth: 22,
                height: 22,
                padding: "0 5px",
                borderRadius: 999,
                background: ADS_BRAND.gold,
                color: ADS_BRAND.inkOnGold,
                fontSize: 12,
                fontWeight: 900,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 1px 5px rgba(0,0,0,0.45)",
              }}
            >
              {orderNumber}
            </span>
          )}
          {isSelected && (
            <div
              style={{
                position: "absolute",
                left: 6,
                bottom: 6,
                height: 22,
                display: "inline-flex",
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
                onDragStart={(event) => event.preventDefault()}
                style={{
                  width: 20,
                  height: 22,
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
              <span style={{ textAlign: "center", fontSize: 10, fontWeight: 800, minWidth: 18 }}>
                {copyCount}x
              </span>
              <button
                type="button"
                aria-label="Use more copies"
                onClick={(event) => {
                  event.stopPropagation();
                  updatePhotoCopyCount(asset.url, 1);
                }}
                onDragStart={(event) => event.preventDefault()}
                style={{
                  width: 20,
                  height: 22,
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
    },
    [dragOverUrl, mediaAssets, moveSelectedMedia, photoCopies, photos, selectedOrderMap, toggleSetupMediaAsset, updatePhotoCopyCount]
  );

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
      event.stopPropagation();
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
    const normalizedFiles = await normalizeUploadFiles(files);
    if (!normalizedFiles.length) return 0;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const mediaFiles = normalizedFiles.filter((file) => {
      const contentType = getUploadContentType(file);
      return contentType.startsWith("image/") || contentType.startsWith("video/");
    });
    if (!mediaFiles.length) return 0;

    try {
      const uploaded = await Promise.all(
        mediaFiles.map(async (file) => {
          try {
            const targetFolderId = uploadTargetFolderId || (homeMode === "media" ? selectedMediaFolderId : null);
            const asset = await uploadStudioMedia(file, null, targetFolderId, controller.signal);
            return { file, asset };
          } catch (err) {
            if (controller.signal.aborted) throw err;
            return { file, asset: null };
          }
        })
      );
      const savedAssets = uploaded.map((item) => item.asset).filter(Boolean) as StudioMediaAsset[];
      const savedCount = savedAssets.length;
      if (savedAssets.length) {
        setLibraryMedia((prev) => {
          const existing = new Set(prev.map((asset) => asset.id));
          return [...savedAssets.filter((asset) => !existing.has(asset.id)), ...prev];
        });
      }
      await fetchStudioMedia();
      void fetchStudioHome();
      return savedCount;
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
    }
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

  const handleHomeLibraryDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (homeMode !== "media" || !Array.from(event.dataTransfer.types).includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setHomeLibraryDropActive(true);
  }, [homeMode]);

  const handleHomeLibraryDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
      setHomeLibraryDropActive(false);
    }
  }, []);

  const handleHomeLibraryDrop = useCallback(
    async (event: React.DragEvent<HTMLElement>) => {
      if (homeMode !== "media") return;
      event.preventDefault();
      setHomeLibraryDropActive(false);
      if (!event.dataTransfer.files.length) return;
      setUploadStatus("Uploading media...");
      try {
        const savedCount = await uploadLibraryFiles(event.dataTransfer.files);
        setUploadStatus(savedCount ? "Upload complete." : "No supported media found.");
        window.setTimeout(() => setUploadStatus(""), 2400);
      } catch (err) {
        setUploadStatus(err instanceof Error ? err.message : "Upload failed. Try again.");
      }
    },
    [homeMode, uploadLibraryFiles]
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
    } catch (err) {
      setUploadStatus(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setUploadingQueuedMedia(false);
    }
  }, [uploadLibraryFiles, uploadQueue, uploadingQueuedMedia]);

  const cancelQueuedUpload = useCallback(() => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    setUploadQueue([]);
    setUploadingQueuedMedia(false);
    setUploadStatus("");
  }, []);

  const removeQueuedUploadFile = useCallback((index: number) => {
    setUploadQueue((prev) => {
      const next = prev.filter((_, fileIndex) => fileIndex !== index);
      if (!next.length && uploadingQueuedMedia) {
        uploadAbortRef.current?.abort();
        setUploadingQueuedMedia(false);
        setUploadStatus("");
      }
      return next;
    });
  }, [uploadingQueuedMedia]);

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

  const openMediaLibraryPicker = useCallback((mode: MediaPickerMode) => {
    setMediaPickerMode(mode);
    setGenerateMediaPickerFolderId(null);
    setGenerateMediaPickerOpen(true);
    setGenerateAddMenuOpen(false);
    setEditorMediaActionMode(null);
  }, []);

  const closeMediaLibraryPicker = useCallback(() => {
    setGenerateMediaPickerOpen(false);
    setMediaPickerMode(null);
  }, []);

  const prepareStudioMediaAsset = useCallback(
    async (file: File | null): Promise<StudioMediaAsset | null> => {
      if (!file) return null;
      const contentType = getUploadContentType(file);
      const mediaKind: MediaKind = contentType.startsWith("video/") ? "video" : "image";
      if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) return null;
      try {
        return await uploadStudioMedia(file, projectId, setupMediaFolderId);
      } catch {
        const url = await fileToDataUrl(file);
        return {
          id: uid(),
          url,
          kind: mediaKind,
          filename: file.name,
          folderId: setupMediaFolderId,
        };
      }
    },
    [projectId, setupMediaFolderId]
  );

  const registerDraftMediaAsset = useCallback((asset: StudioMediaAsset) => {
    const url = asset.url;
    if (asset.kind === "image") {
      setPhotos((prev) => (prev.includes(url) ? prev : [...prev, url]));
    }
    setMediaAssets((prev) =>
      prev.some((existing) => existing.url === url || existing.id === asset.id)
        ? prev
        : [...prev, asset]
    );
    setPhotoCopies((prev) => (prev[url] ? prev : { ...prev, [url]: 1 }));
  }, []);

  const applyMediaAssetToCurrentCreative = useCallback(
    (asset: StudioMediaAsset) => {
      if (!currentCreative) return;
      const url = asset.url;
      pushUndo();
      registerDraftMediaAsset(asset);
      updateCurrentCreative((creative) => ({
        ...creative,
        photoUrl: url,
        mediaKind: asset.kind,
        videoTrim: asset.kind === "video" ? { start: 0, end: null } : undefined,
        videoTimeline: asset.kind === "video" ? createDefaultVideoTimeline() : undefined,
        videoMuted: asset.kind === "video" ? true : undefined,
        videoVolume: asset.kind === "video" ? 1 : undefined,
        imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
      }));
      setSelectedLayer({ type: "image" });
      setSelectedTextBlockIds([]);
      setContextMenu(null);
      void fetchStudioMedia();
      void fetchStudioHome();
    },
    [currentCreative, fetchStudioHome, fetchStudioMedia, pushUndo, registerDraftMediaAsset, updateCurrentCreative]
  );

  const replaceCurrentImage = useCallback(
    async (file: File | null) => {
      if (!file || !currentCreative) return;
      const asset = await prepareStudioMediaAsset(file);
      if (!asset) return;
      applyMediaAssetToCurrentCreative(asset);
    },
    [applyMediaAssetToCurrentCreative, currentCreative, prepareStudioMediaAsset]
  );

  const handleEditorMediaUpload = useCallback(
    async (file: File | null) => {
      if (!file || !editorUploadMode) return;
      if (editorUploadMode === "new-ad") setNewAdStatus("Uploading media...");
      try {
        const asset = await prepareStudioMediaAsset(file);
        if (!asset) return;
        if (editorUploadMode === "replace-current") {
          applyMediaAssetToCurrentCreative(asset);
          setEditorMediaActionMode(null);
        } else {
          registerDraftMediaAsset(asset);
          setNewAdMediaAssets([asset]);
          setNewAdStatus("Media ready.");
        }
        void fetchStudioMedia();
        void fetchStudioHome();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Media upload failed.";
        if (editorUploadMode === "new-ad") setNewAdStatus(message);
        else setCloudStatus(message);
      } finally {
        setEditorUploadMode(null);
      }
    },
    [applyMediaAssetToCurrentCreative, editorUploadMode, fetchStudioHome, fetchStudioMedia, prepareStudioMediaAsset, registerDraftMediaAsset]
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
    setSelectedTextBlockIds([copy.id]);
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
    setSelectedTextBlockIds([]);
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

  const alignSelectedTextBlocks = useCallback(
    (align: TextAlign) => {
      if (selectedTextBlocks.length < 2) return;
      pushUndo();
      const ctx = getMeasureCtx();
      const metrics = selectedTextBlocks.map((block) => ({ block, metrics: measureTextBlock(ctx, block) }));
      const left = Math.min(...metrics.map((item) => item.metrics.x));
      const right = Math.max(...metrics.map((item) => item.metrics.x + item.metrics.w));
      const center = (left + right) / 2;
      const ids = new Set(selectedTextBlocks.map((block) => block.id));
      updateCurrentCreative((creative) => ({
        ...creative,
        textBlocks: creative.textBlocks.map((block) => {
          if (!ids.has(block.id)) return block;
          const measured = metrics.find((item) => item.block.id === block.id)?.metrics;
          if (!measured) return block;
          const nextX = align === "left"
            ? left
            : align === "right"
              ? right - measured.w
              : center - measured.w / 2;
          return { ...block, x: Math.round(nextX), align };
        }),
      }));
      setContextMenu(null);
    },
    [getMeasureCtx, pushUndo, selectedTextBlocks, updateCurrentCreative]
  );

  const deleteSelectedTextBlocks = useCallback(() => {
    if (!selectedTextBlocks.length) return;
    pushUndo();
    const ids = new Set(selectedTextBlocks.map((block) => block.id));
    updateCurrentCreative((creative) => ({
      ...creative,
      textBlocks: creative.textBlocks.filter((block) => !ids.has(block.id)),
    }));
    setSelectedLayer(null);
    setSelectedTextBlockIds([]);
    setContextMenu(null);
  }, [pushUndo, selectedTextBlocks, updateCurrentCreative]);

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

  const moveTextLayerBefore = useCallback(
    (blockId: string, beforeBlockId: string) => {
      if (blockId === beforeBlockId) return;
      pushUndo();
      updateCurrentCreative((creative) => {
        const blocks = [...creative.textBlocks];
        const fromIndex = blocks.findIndex((block) => block.id === blockId);
        const targetIndex = blocks.findIndex((block) => block.id === beforeBlockId);
        if (fromIndex < 0 || targetIndex < 0) return creative;
        const [moved] = blocks.splice(fromIndex, 1);
        if (!moved) return creative;
        const nextTargetIndex = blocks.findIndex((block) => block.id === beforeBlockId);
        blocks.splice(nextTargetIndex < 0 ? blocks.length : nextTargetIndex, 0, moved);
        return { ...creative, textBlocks: blocks };
      });
      setDraggedLayerBlockId(null);
      setLayerDropBlockId(null);
    },
    [pushUndo, updateCurrentCreative]
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

  const createAdFromModal = useCallback(() => {
    const groups = parseCopyIntoAds(newAdCopy);
    const sections = groups[0] || [];
    const textBlocks = sections.length ? buildBlocksForSections(sections) : [];
    const assets = newAdMediaAssets.length ? newAdMediaAssets : [null];
    newAdMediaAssets.forEach(registerDraftMediaAsset);
    const cloneBlocks = () =>
      textBlocks.map((block) => ({
        ...block,
        id: uid(),
        lines: [...block.lines],
        colorSpans: block.colorSpans?.map((span) => ({ ...span })),
      }));
    pushUndo();
    const nextCreatives = assets.map((asset): Creative => ({
      id: uid(),
      photoUrl: asset?.url || BLANK_IMAGE_DATA_URL,
      mediaKind: asset?.kind || "image",
      videoTrim: asset?.kind === "video" ? { start: 0, end: null } : undefined,
      videoTimeline: asset?.kind === "video" ? createDefaultVideoTimeline() : undefined,
      videoMuted: asset?.kind === "video" ? true : undefined,
      videoVolume: asset?.kind === "video" ? 1 : undefined,
      textBlocks: cloneBlocks(),
      imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
      status: "draft",
    }));
    const firstBlock = nextCreatives[0]?.textBlocks[0] || null;
    setCreatives((prev) => {
      setCurrentIndex(prev.length);
      return [...prev, ...nextCreatives];
    });
    setSelectedLayer(firstBlock ? { type: "text", id: firstBlock.id } : { type: "image" });
    setSelectedTextBlockIds(firstBlock ? [firstBlock.id] : []);
    setNewAdModalOpen(false);
    setNewAdCopy("");
    setNewAdMediaAssets([]);
    setNewAdStatus("");
  }, [buildBlocksForSections, newAdCopy, newAdMediaAssets, pushUndo, registerDraftMediaAsset]);

  const openNewAdModal = useCallback(() => {
    setNewAdModalOpen(true);
    setNewAdCopy("");
    setNewAdMediaAssets([]);
    setNewAdStatus("");
  }, []);

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
        videoTrim: media.kind === "video" ? { start: 0, end: null } : undefined,
        videoTimeline: media.kind === "video" ? createDefaultVideoTimeline() : undefined,
        videoMuted: media.kind === "video" ? true : undefined,
        videoVolume: media.kind === "video" ? 1 : undefined,
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

  const pointFromClientOnCanvas = useCallback((clientX: number, clientY: number) => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((clientY - rect.top) / rect.height) * CANVAS_H,
    };
  }, []);

  const selectTextBlocksInMarquee = useCallback(
    (rect: MarqueeRect) => {
      if (!currentCreative) return [];
      const ctx = getMeasureCtx();
      const ids = currentCreative.textBlocks
        .filter((block) => rectsIntersect(rect, measureTextBlock(ctx, block)))
        .map((block) => block.id);
      setSelectedTextBlockIds(ids);
      setSelectedLayer(ids.length ? { type: "text", id: ids[ids.length - 1] } : null);
      return ids;
    },
    [currentCreative, getMeasureCtx]
  );

  const startGridMarqueeSelect = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!currentCreative || editorSidebarMode !== "edit") {
        setSelectedLayer(null);
        setSelectedTextBlockIds([]);
        setContextMenu(null);
        return;
      }

      event.preventDefault();
      const start = pointFromClientOnCanvas(event.clientX, event.clientY);
      const drag: DragState = {
        kind: "marquee-select",
        active: false,
        startX: start.x,
        startY: start.y,
        currentX: start.x,
        currentY: start.y,
        selectImageOnClick: false,
      };
      dragRef.current = drag;
      setSelectedLayer(null);
      setSelectedTextBlockIds([]);
      setContextMenu(null);
      setMarqueeRect(null);
      setCanvasCursor("crosshair");

      const handleMove = (moveEvent: PointerEvent) => {
        const activeDrag = dragRef.current;
        if (!activeDrag || activeDrag.kind !== "marquee-select") return;
        const point = pointFromClientOnCanvas(moveEvent.clientX, moveEvent.clientY);
        const dx = point.x - activeDrag.startX;
        const dy = point.y - activeDrag.startY;
        if (!activeDrag.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        activeDrag.active = true;
        activeDrag.currentX = point.x;
        activeDrag.currentY = point.y;
        const rect = normalizeMarqueeRect(activeDrag.startX, activeDrag.startY, point.x, point.y);
        setMarqueeRect(rect);
        selectTextBlocksInMarquee(rect);
      };

      const handleUp = () => {
        const activeDrag = dragRef.current;
        if (activeDrag?.kind === "marquee-select" && !activeDrag.active) {
          setSelectedLayer(null);
          setSelectedTextBlockIds([]);
        }
        dragRef.current = null;
        setMarqueeRect(null);
        setCanvasCursor("default");
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [currentCreative, editorSidebarMode, pointFromClientOnCanvas, selectTextBlocksInMarquee]
  );

  const getHoverCursor = useCallback(
    (point: { x: number; y: number }) => {
      if (!currentCreative) return "default";
      const ctx = getMeasureCtx();

      if (selectedLayer?.type === "text") {
        if (selectedTextBlockIds.length > 1) {
          const group = getGroupMetrics(
            ctx,
            currentCreative.textBlocks.filter((block) => selectedTextBlockIds.includes(block.id))
          );
          const handle = group ? hitTextHandle(point, group) : null;
          if (handle) return cursorForResizeHandle(handle);
        }
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

      return "default";
    },
    [currentCreative, getMeasureCtx, selectedLayer, selectedTextBlockIds]
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
      const target: ContextMenuTarget = hit && selectedTextBlockIds.includes(hit.id) && selectedTextBlockIds.length > 1
        ? { type: "multi-text" }
        : hit ? { type: "text", id: hit.id } : { type: "image" };
      if (target?.type === "multi-text") {
        setSelectedLayer(hit ? { type: "text", id: hit.id } : null);
      } else if (target) {
        setSelectedLayer(target);
        if (target.type === "text") setSelectedTextBlockIds([target.id]);
        else setSelectedTextBlockIds([]);
      }
      setContextMenu({ x: event.clientX, y: event.clientY, target });
    },
    [currentCreative, findHitBlock, selectedTextBlockIds]
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

      if (selectedTextBlockIds.length > 1) {
        const selectedBlocks = currentCreative.textBlocks.filter((block) => selectedTextBlockIds.includes(block.id));
        const group = getGroupMetrics(ctx, selectedBlocks);
        const groupHandle = group ? hitTextHandle(point, group) : null;
        if (group && groupHandle) {
          dragRef.current = {
            kind: "resize-text-group",
            active: false,
            blockIds: selectedTextBlockIds,
            handle: groupHandle,
            startX: point.x,
            startY: point.y,
            origBlocks: Object.fromEntries(selectedBlocks.map((block) => [block.id, { ...block, lines: [...block.lines] }])),
            groupMetrics: group,
          };
          setCanvasCursor(cursorForResizeHandle(groupHandle));
          return;
        }
      }

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
        if (event.shiftKey) {
          setSelectedTextBlockIds((prev) => {
            const next = prev.includes(hit.id) ? prev.filter((id) => id !== hit.id) : [...prev, hit.id];
            if (!next.length) setSelectedLayer(null);
            else setSelectedLayer({ type: "text", id: hit.id });
            return next;
          });
          return;
        }
        const movingBlockIds = selectedTextBlockIds.includes(hit.id) && selectedTextBlockIds.length > 1
          ? selectedTextBlockIds
          : [hit.id];
        const origPositions = Object.fromEntries(
          currentCreative.textBlocks
            .filter((block) => movingBlockIds.includes(block.id))
            .map((block) => [block.id, { x: block.x, y: block.y }])
        );
        setSelectedLayer({ type: "text", id: hit.id });
        setSelectedTextBlockIds(movingBlockIds);
        if (!hit.locked) {
          dragRef.current = {
            kind: "move-text",
            active: false,
            blockId: hit.id,
            blockIds: movingBlockIds,
            startX: point.x,
            startY: point.y,
            origX: hit.x,
            origY: hit.y,
            origPositions,
            origMetrics: measureTextBlock(ctx, hit),
          };
          setCanvasCursor("grabbing");
        }
        return;
      }

      if (selectedLayer?.type === "image") {
        setSelectedTextBlockIds([]);
        dragRef.current = {
          kind: "move-image",
          active: false,
          startX: point.x,
          startY: point.y,
          orig: { ...currentCreative.imageTransform },
        };
        setCanvasCursor("grabbing");
        return;
      }

      dragRef.current = {
        kind: "marquee-select",
        active: false,
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        selectImageOnClick: true,
      };
      setSelectedLayer(null);
      setSelectedTextBlockIds([]);
      setContextMenu(null);
      setMarqueeRect(null);
      setCanvasCursor("crosshair");
    },
    [currentCreative, findHitBlock, getMeasureCtx, selectedLayer, selectedTextBlockIds]
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
        if (drag.kind !== "marquee-select") pushUndo();
      }

      if (drag.kind === "marquee-select") {
        const rect = normalizeMarqueeRect(drag.startX, drag.startY, point.x, point.y);
        drag.currentX = point.x;
        drag.currentY = point.y;
        setMarqueeRect(rect);
        setCanvasCursor("crosshair");
        selectTextBlocksInMarquee(rect);
        return;
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
            (drag.blockIds || [drag.blockId]).includes(block.id)
              ? {
                  ...block,
                  x: block.id === drag.blockId ? snapped.x : Math.round((drag.origPositions?.[block.id]?.x ?? block.x) + dx),
                  y: block.id === drag.blockId ? snapped.y : Math.round((drag.origPositions?.[block.id]?.y ?? block.y) + dy),
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

      if (drag.kind === "resize-text-group") {
        setActiveGuides({ x: [], y: [] });
        setActiveSafeZones([]);
        setCanvasCursor(cursorForResizeHandle(drag.handle));
        if (drag.handle === "e" || drag.handle === "w") {
          const deltaW = drag.handle === "e" ? dx : -dx;
          updateCurrentCreative((creative) => ({
            ...creative,
            textBlocks: creative.textBlocks.map((block) => {
              const orig = drag.origBlocks[block.id];
              if (!orig) return block;
              const nextMaxWidth = clamp(Math.round(orig.maxWidth + deltaW), 160, 1060);
              return {
                ...orig,
                x: drag.handle === "w" ? Math.round(orig.x + (orig.maxWidth - nextMaxWidth)) : orig.x,
                maxWidth: nextMaxWidth,
              };
            }),
          }));
          return;
        }
        const widthFactor = (drag.groupMetrics.w + (drag.handle.includes("e") ? dx : -dx)) / Math.max(1, drag.groupMetrics.w);
        const heightFactor = (drag.groupMetrics.h + (drag.handle.includes("s") ? dy : -dy)) / Math.max(1, drag.groupMetrics.h);
        const factor = clamp((widthFactor + heightFactor) / 2, 0.35, 2.8);
        const anchorX = drag.handle.includes("w") ? drag.groupMetrics.x + drag.groupMetrics.w : drag.groupMetrics.x;
        const anchorY = drag.handle.includes("n") ? drag.groupMetrics.y + drag.groupMetrics.h : drag.groupMetrics.y;
        updateCurrentCreative((creative) => ({
          ...creative,
          textBlocks: creative.textBlocks.map((block) => {
            const orig = drag.origBlocks[block.id];
            if (!orig) return block;
            return {
              ...orig,
              x: Math.round(anchorX + (orig.x - anchorX) * factor),
              y: Math.round(anchorY + (orig.y - anchorY) * factor),
              maxWidth: clamp(Math.round(orig.maxWidth * factor), 160, 1060),
              fontSize: clamp(Math.round(orig.fontSize * factor), 10, 170),
              paddingH: clamp(Math.round(orig.paddingH * factor), 0, 90),
              paddingV: clamp(Math.round(orig.paddingV * factor), 0, 90),
              borderRadius: clamp(Math.round(orig.borderRadius * factor), 0, 60),
            };
          }),
        }));
      }

      if (drag.kind === "move-image") {
        setActiveSafeZones([]);
        setCanvasCursor("grabbing");
        const rawOffsetX = drag.orig.offsetX + dx;
        const rawOffsetY = drag.orig.offsetY + dy;
        const snappedX = Math.abs(rawOffsetX) <= IMAGE_CENTER_SNAP_THRESHOLD;
        const snappedY = Math.abs(rawOffsetY) <= IMAGE_CENTER_SNAP_THRESHOLD;
        setActiveGuides({
          x: snappedX ? [CANVAS_W / 2] : [],
          y: snappedY ? [CANVAS_H / 2] : [],
        });
        updateImage({
          offsetX: snappedX ? 0 : Math.round(rawOffsetX),
          offsetY: snappedY ? 0 : Math.round(rawOffsetY),
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
    [currentCreative, getHoverCursor, getMeasureCtx, pushUndo, selectTextBlocksInMarquee, updateCurrentCreative, updateImage]
  );

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const drag = dragRef.current;
    if (drag?.kind === "marquee-select" && !drag.active) {
      if (drag.selectImageOnClick) {
        setSelectedLayer({ type: "image" });
        setSelectedTextBlockIds([]);
      } else {
        setSelectedLayer(null);
        setSelectedTextBlockIds([]);
      }
    }
    dragRef.current = null;
    setMarqueeRect(null);
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

      if (!typing && meta && event.key.toLowerCase() === "a" && currentCreative?.textBlocks.length) {
        event.preventDefault();
        selectAllTextBlocks();
        return;
      }

      if (!typing && !meta && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        setCurrentIndex((index) => clamp(index + delta, 0, Math.max(0, creatives.length - 1)));
        setSelectedLayer(null);
        setSelectedTextBlockIds([]);
        setContextMenu(null);
        setEditingBlockId(null);
        return;
      }

      if (!typing && !meta && (event.code === "Space" || event.key === " ")) {
        if ((currentCreative?.mediaKind || "image") === "video") {
          event.preventDefault();
          toggleVideoPlayback();
          return;
        }
      }

      if (!typing && !meta && event.key.toLowerCase() === "t" && !selectedLayer) {
        event.preventDefault();
        addTextBlock();
        return;
      }

      if (event.key === "Escape") {
        setSelectedLayer(null);
        setSelectedTextBlockIds([]);
        setContextMenu(null);
        setEditingBlockId(null);
        return;
      }

      if (!typing && selectedTextBlocks.length > 1 && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedTextBlocks();
        return;
      }

      if (!typing && selectedLayer?.type === "text" && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelectedBlock();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [addTextBlock, creatives.length, currentCreative?.mediaKind, currentCreative?.textBlocks.length, deleteSelectedBlock, deleteSelectedTextBlocks, duplicateSelectedBlock, redo, selectAllTextBlocks, selectedLayer, selectedTextBlocks.length, toggleVideoPlayback, undo, view]);

  const renderCreativeToCanvas = useCallback(
    async (creative: Creative, pixelRatio = 2) => {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W * pixelRatio;
      canvas.height = CANVAS_H * pixelRatio;
      const ctx = canvas.getContext("2d")!;
      let media: HTMLImageElement | HTMLVideoElement | null = null;
      if ((creative.mediaKind || "image") === "video") {
        media = await loadVideoFrame(creative.photoUrl, getFirstVideoSegmentStart(creative));
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

  const renderCreativeTextOverlayDataUrl = useCallback((creative: Creative) => {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare Studio text overlay.");
    drawArtworkTextOverlay(ctx, creative, 1);
    return canvas.toDataURL("image/png");
  }, []);

  const getVideoDurationForExport = useCallback(async (creative: Creative) => {
    const video = document.createElement("video");
    const resolvedSrc = getCanvasImageSrc(creative.photoUrl);
    if (/^https?:\/\//i.test(resolvedSrc)) video.crossOrigin = "anonymous";
    video.playsInline = true;
    video.preload = "metadata";
    video.muted = true;
    video.src = resolvedSrc;
    video.load();
    try {
      await ensureVideoMetadata(video);
      return Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    } finally {
      video.removeAttribute("src");
      video.load();
    }
  }, []);

  const renderCreativeToServerVideoBlob = useCallback(
    async (creative: Creative, label = "video") => {
      if (!/^https?:\/\//i.test(creative.photoUrl)) {
        throw new Error("Server video export needs uploaded media.");
      }

      setExportStatus(`Rendering ${label} as MP4...`);
      const duration = await getVideoDurationForExport(creative);
      const segments = getEnabledVideoSegments(creative, duration)
        .map((segment) => ({
          start: segment.start,
          end: Number.isFinite(segment.end as number)
            ? clamp(segment.end as number, segment.start, duration || (segment.end as number))
            : null,
          enabled: segment.enabled !== false,
        }))
        .filter((segment) => segment.enabled && (segment.end === null || segment.end > segment.start));

      const res = await fetch("/api/studio-2/export-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl: creative.photoUrl,
          overlayDataUrl: renderCreativeTextOverlayDataUrl(creative),
          segments,
          muted: creative.videoMuted ?? true,
          volume: clamp(creative.videoVolume ?? 1, 0, 1),
          imageTransform: creative.imageTransform,
          filename: `${label.replace(/[^\w.\- ]+/g, "").trim() || "studio-2-video"}.mp4`,
        }),
      });
      const contentType = res.headers.get("content-type") || "";
      if (res.ok && contentType.startsWith("video/")) {
        const blob = await res.blob();
        if (!blob.size) throw new Error("Finished MP4 was empty.");
        return { blob, extension: "mp4", contentType: "video/mp4" };
      }
      const data = contentType.includes("application/json") ? await res.json() : null;
      if (!res.ok) {
        throw new Error(data?.error || "Server MP4 export failed.");
      }
      const downloadUrl = data?.downloadUrl || data?.url;
      if (!downloadUrl) throw new Error("Server MP4 export did not return a download URL.");

      setExportStatus(`Downloading ${label}...`);
      const downloadRes = await fetch(downloadUrl);
      if (!downloadRes.ok) throw new Error("Finished MP4 could not be downloaded.");
      const blob = await downloadRes.blob();
      if (!blob.size) throw new Error("Finished MP4 was empty.");
      return { blob, extension: "mp4", contentType: "video/mp4" };
    },
    [getVideoDurationForExport, renderCreativeTextOverlayDataUrl]
  );

  const renderCreativeToFastVideoBlob = useCallback(
    async (creative: Creative, label = "video") => {
      if (typeof VideoEncoder === "undefined") {
        throw new Error("Fast MP4 export is not available in this browser.");
      }

      const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
      const fps = 24;
      const frameDurationUs = Math.round(1_000_000 / fps);
      const bitrate = 4_800_000;
      const sourcePlaybackRate = 8;
      const configCandidates: VideoEncoderConfig[] = [
        { codec: "avc1.640028", width: CANVAS_W, height: CANVAS_H, bitrate, framerate: fps, latencyMode: "quality" },
        { codec: "avc1.4D4028", width: CANVAS_W, height: CANVAS_H, bitrate, framerate: fps, latencyMode: "quality" },
        { codec: "avc1.42E01E", width: CANVAS_W, height: CANVAS_H, bitrate, framerate: fps, latencyMode: "quality" },
      ];

      let encoderConfig: VideoEncoderConfig | null = null;
      for (const candidate of configCandidates) {
        const support = await VideoEncoder.isConfigSupported(candidate).catch(() => null);
        if (support?.supported) {
          encoderConfig = support.config || candidate;
          break;
        }
      }
      if (!encoderConfig) throw new Error("Fast MP4 export is not supported in this browser.");

      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not start fast MP4 export.");

      const video = document.createElement("video");
      const resolvedSrc = getCanvasImageSrc(creative.photoUrl);
      if (/^https?:\/\//i.test(resolvedSrc)) video.crossOrigin = "anonymous";
      video.playsInline = true;
      video.preload = "auto";
      video.muted = true;
      video.playbackRate = sourcePlaybackRate;
      video.src = resolvedSrc;
      video.load();

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: { codec: "avc", width: CANVAS_W, height: CANVAS_H, frameRate: fps },
        fastStart: "in-memory",
      });

      let encodeError: Error | null = null;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (error) => {
          encodeError = error instanceof Error ? error : new Error(String(error));
        },
      });

      let encodedFrameCount = 0;
      const encodeFrame = async () => {
        drawArtwork(ctx, creative, video, 1);
        const frame = new VideoFrame(canvas, {
          timestamp: encodedFrameCount * frameDurationUs,
          duration: frameDurationUs,
        });
        encoder.encode(frame, { keyFrame: encodedFrameCount % fps === 0 });
        frame.close();
        encodedFrameCount += 1;
        if (encoder.encodeQueueSize > 8) await encoder.flush();
      };

      try {
        encoder.configure(encoderConfig);
        await ensureVideoMetadata(video);
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await waitForVideoEvent(video, "canplay", 15_000).catch(() => undefined);
        }

        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        const segments = getEnabledVideoSegments(creative, duration)
          .map((segment) => ({
            ...segment,
            end: clamp(segment.end ?? duration, segment.start, duration || segment.end || segment.start),
          }))
          .filter((segment) => segment.enabled && (segment.end ?? segment.start) > segment.start);
        if (!segments.length) throw new Error("This video has no enabled timeline segments to export.");

        const totalOutputSeconds = segments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? segment.start) - segment.start), 0);
        let exportedSeconds = 0;

        for (const segment of segments) {
          const segmentEnd = segment.end ?? duration;
          const segmentLength = Math.max(0, segmentEnd - segment.start);
          let segmentEncodedSeconds = 0;
          await seekVideoElement(video, segment.start);
          await encodeFrame();
          await video.play().catch(() => undefined);

          while (segmentEncodedSeconds < segmentLength - 0.001) {
            await new Promise<void>((resolve) => {
              const requestFrame = (video as HTMLVideoElement & {
                requestVideoFrameCallback?: (callback: () => void) => number;
              }).requestVideoFrameCallback;
              if (requestFrame) requestFrame.call(video, () => resolve());
              else window.requestAnimationFrame(() => resolve());
            });

            const sourceProgress = clamp(video.currentTime - segment.start, 0, segmentLength);
            const targetProgress = Math.min(segmentLength, Math.max(sourceProgress, segmentEncodedSeconds + 1 / fps));
            while (segmentEncodedSeconds < targetProgress - 0.001) {
              await encodeFrame();
              segmentEncodedSeconds += 1 / fps;
            }
            setExportStatus(`Fast exporting ${label} · ${formatVideoTime(exportedSeconds + segmentEncodedSeconds)} / ${formatVideoTime(totalOutputSeconds)}`);
            if (video.currentTime >= segmentEnd - 0.02) break;
          }

          video.pause();
          while (segmentEncodedSeconds < segmentLength - 0.001) {
            await encodeFrame();
            segmentEncodedSeconds += 1 / fps;
          }
          exportedSeconds += segmentLength;
        }

        video.pause();
        await encoder.flush();
        if (encodeError) throw encodeError;
        muxer.finalize();
        const blob = new Blob([target.buffer], { type: "video/mp4" });
        if (!blob.size) throw new Error("Fast MP4 export produced an empty file.");
        return { blob, extension: "mp4", contentType: "video/mp4" };
      } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        try {
          encoder.close();
        } catch {
          // The encoder may already be closed after an internal failure.
        }
      }
    },
    []
  );

  const renderCreativeToVideoBlob = useCallback(
    async (creative: Creative, label = "video") => {
      if ((creative.mediaKind || "image") !== "video") {
        throw new Error("This ad is not a video.");
      }
      try {
        return await renderCreativeToServerVideoBlob(creative, label);
      } catch (error) {
        console.warn("Studio server MP4 export failed; trying browser fallback.", error);
        setExportStatus(`Server export unavailable. Finishing ${label} in this browser...`);
      }
      let fastExportError: unknown = null;
      if (creative.videoMuted ?? true) {
        try {
          return await renderCreativeToFastVideoBlob(creative, label);
        } catch (error) {
          fastExportError = error;
          console.warn("Studio fast MP4 export failed; trying recorder fallback.", error);
          setExportStatus(`Fast export unavailable. Finishing ${label} the slower way...`);
        }
      }
      const recorderFormat = getVideoRecorderFormat();
      if (!recorderFormat || typeof MediaRecorder === "undefined") {
        if (!(creative.videoMuted ?? true)) {
          setExportStatus("Original audio is not available for MP4 export in this browser. Exporting a muted MP4...");
          try {
            return await renderCreativeToFastVideoBlob({ ...creative, videoMuted: true, videoVolume: 0 }, label);
          } catch (error) {
            fastExportError = fastExportError || error;
          }
        }
        const detail = fastExportError instanceof Error ? ` ${fastExportError.message}` : "";
        throw new Error(`This browser could not create a Studio MP4 video.${detail}`);
      }

      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not start video export.");

      const video = document.createElement("video");
      const resolvedSrc = getCanvasImageSrc(creative.photoUrl);
      if (/^https?:\/\//i.test(resolvedSrc)) video.crossOrigin = "anonymous";
      video.playsInline = true;
      video.preload = "auto";
      video.muted = creative.videoMuted ?? true;
      video.volume = clamp(creative.videoVolume ?? 1, 0, 1);
      video.src = resolvedSrc;
      video.load();

      let audioContext: AudioContext | null = null;
      let recordStream: MediaStream | null = null;

      try {
        await ensureVideoMetadata(video);
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          await waitForVideoEvent(video, "canplay", 15_000).catch(() => undefined);
        }
        const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
        const segments = getEnabledVideoSegments(creative, duration)
          .map((segment) => ({
            ...segment,
            end: clamp(segment.end ?? duration, segment.start, duration || segment.end || segment.start),
          }))
          .filter((segment) => segment.enabled && (segment.end ?? segment.start) > segment.start);
        if (!segments.length) throw new Error("This video has no enabled timeline segments to export.");

        const totalOutputSeconds = segments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? segment.start) - segment.start), 0);
        const canvasStream = canvas.captureStream(30);
        recordStream = new MediaStream(canvasStream.getVideoTracks());

        if (!(creative.videoMuted ?? true) && clamp(creative.videoVolume ?? 1, 0, 1) > 0 && typeof AudioContext !== "undefined") {
          audioContext = new AudioContext();
          await audioContext.resume().catch(() => undefined);
          const source = audioContext.createMediaElementSource(video);
          const gain = audioContext.createGain();
          const destination = audioContext.createMediaStreamDestination();
          gain.gain.value = clamp(creative.videoVolume ?? 1, 0, 1);
          source.connect(gain);
          gain.connect(destination);
          destination.stream.getAudioTracks().forEach((track) => recordStream?.addTrack(track));
        }

        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(recordStream, { mimeType: recorderFormat.mimeType });
        const stopped = new Promise<Blob>((resolve, reject) => {
          recorder.ondataavailable = (event) => {
            if (event.data.size > 0) chunks.push(event.data);
          };
          recorder.onerror = () => reject(new Error("Video export failed."));
          recorder.onstop = () => resolve(new Blob(chunks, { type: recorderFormat.mimeType }));
        });

        recorder.start(250);
        let renderedSeconds = 0;
        for (let index = 0; index < segments.length; index++) {
          const segment = segments[index];
          const segmentEnd = segment.end ?? duration;
          setExportStatus(`Exporting ${label} · ${formatVideoTime(renderedSeconds)} / ${formatVideoTime(totalOutputSeconds)}`);
          await seekVideoElement(video, segment.start);
          drawArtwork(ctx, creative, video, 1);
          try {
            await video.play();
          } catch {
            video.muted = true;
            await video.play();
          }
          const segmentStartedAt = video.currentTime;
          while (video.currentTime < segmentEnd - 0.025) {
            drawArtwork(ctx, creative, video, 1);
            const segmentProgress = Math.max(0, video.currentTime - segmentStartedAt);
            setExportStatus(`Exporting ${label} · ${formatVideoTime(renderedSeconds + segmentProgress)} / ${formatVideoTime(totalOutputSeconds)}`);
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          }
          video.pause();
          renderedSeconds += Math.max(0, segmentEnd - segment.start);
          await seekVideoElement(video, segmentEnd).catch(() => undefined);
          drawArtwork(ctx, creative, video, 1);
        }

        if (recorder.state !== "inactive") recorder.stop();
        const blob = await stopped;
        if (!blob.size) throw new Error("Video export produced an empty file.");
        return { blob, extension: recorderFormat.extension, contentType: recorderFormat.mimeType };
      } catch (error) {
        if (!(creative.videoMuted ?? true)) {
          console.warn("Studio recorder MP4 export failed; trying muted fast export.", error);
          setExportStatus("Original audio export failed. Exporting a muted MP4...");
          try {
            return await renderCreativeToFastVideoBlob({ ...creative, videoMuted: true, videoVolume: 0 }, label);
          } catch (fallbackError) {
            fastExportError = fastExportError || fallbackError;
          }
        }
        throw error;
      } finally {
        video.pause();
        video.removeAttribute("src");
        video.load();
        recordStream?.getTracks().forEach((track) => track.stop());
        await audioContext?.close().catch(() => undefined);
      }
    },
    [renderCreativeToFastVideoBlob, renderCreativeToServerVideoBlob]
  );

  const renderCreativeToExportBlob = useCallback(
    async (creative: Creative, index: number) => {
      const safeIndex = index + 1;
      if ((creative.mediaKind || "image") === "video") {
        return renderCreativeToVideoBlob(creative, `ad ${safeIndex}`);
      }
      const canvas = await renderCreativeToCanvas(creative, 2);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((nextBlob) => {
          if (nextBlob) resolve(nextBlob);
          else reject(new Error("Image export failed."));
        }, "image/png");
      });
      return { blob, extension: "png", contentType: "image/png" };
    },
    [renderCreativeToCanvas, renderCreativeToVideoBlob]
  );

  const renderCreativePreviewToCanvas = useCallback(
    async (creative: Creative, pixelRatio = 0.36) => {
      const canvas = document.createElement("canvas");
      canvas.width = CANVAS_W * pixelRatio;
      canvas.height = CANVAS_H * pixelRatio;
      const ctx = canvas.getContext("2d")!;
      let media: HTMLImageElement | HTMLVideoElement | null = null;
      if ((creative.mediaKind || "image") === "video") {
        const posterUrl = getMediaPreviewUrl(getAssetForUrl(creative.photoUrl));
        if (posterUrl) {
          media = await loadImage(posterUrl);
        }
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
    [getAssetForUrl]
  );

  useEffect(() => {
    if (view !== "editor" || editorSidebarMode === "generate" || !creatives.length) return;
    let cancelled = false;
    const nextThumbs: Record<string, string> = {};

    const renderThumbs = async () => {
      for (const creative of creatives) {
        try {
          const canvas = await renderCreativePreviewToCanvas(creative, 0.36);
          if (cancelled) return;
          nextThumbs[creative.id] = canvas.toDataURL("image/jpeg", 0.86);
          setCreativeThumbs((prev) => ({ ...prev, [creative.id]: nextThumbs[creative.id] }));
        } catch {
          // Thumbnails are a navigation aid; the full editor still renders independently.
        }
      }
    };

    void renderThumbs();
    return () => {
      cancelled = true;
    };
  }, [creatives, editorSidebarMode, renderCreativePreviewToCanvas, view]);

  const exportCurrent = useCallback(async (fileLabel?: string) => {
    if (!currentCreative) return;
    setExportModalOpen(false);
    setExportStatus("Exporting current ad...");
    try {
      const exportFile = await renderCreativeToExportBlob(currentCreative, currentIndex);
      downloadBlob(exportFile.blob, `${fileLabel || projectName || "studio-2"}-ad-${currentIndex + 1}.${exportFile.extension}`);
      setCreatives((prev) =>
        prev.map((creative, index) => index === currentIndex ? { ...creative, status: "exported" } : creative)
      );
      setExportStatus("");
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : "Export failed.");
      window.setTimeout(() => setExportStatus(""), 3200);
    }
  }, [currentCreative, currentIndex, projectName, renderCreativeToExportBlob]);

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
      const exportFile = await renderCreativeToExportBlob(creativesToExport[i], i);
      folder.file(`ad-${i + 1}.${exportFile.extension}`, exportFile.blob);
    }

    setExportStatus("Zipping...");
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${folderName}.zip`);
    setCreatives((prev) => prev.map((creative) => ({ ...creative, status: "exported" })));
    setExportStatus("");
  }, [creatives, projectName, renderCreativeToExportBlob]);

  const exportSelectedPages = useCallback(async (indices: number[], folderLabel?: string) => {
    const uniqueIndices = [...new Set(indices)]
      .filter((index) => index >= 0 && index < creatives.length)
      .sort((a, b) => a - b);
    if (!uniqueIndices.length) return;
    if (uniqueIndices.length === 1) {
      const index = uniqueIndices[0];
      setExportModalOpen(false);
      setExportStatus(`Exporting ad ${index + 1}...`);
      try {
        const exportFile = await renderCreativeToExportBlob(creatives[index], index);
        downloadBlob(exportFile.blob, `${folderLabel || projectName || "studio-2"}-ad-${index + 1}.${exportFile.extension}`);
        setExportStatus("");
      } catch (err) {
        setExportStatus(err instanceof Error ? err.message : "Export failed.");
        window.setTimeout(() => setExportStatus(""), 3200);
      }
      return;
    }

    setExportModalOpen(false);
    setExportStatus(`Exporting 1 of ${uniqueIndices.length}...`);
    const JSZip = (await import("jszip")).default;
    const zip = new JSZip();
    const baseName = (folderLabel || projectName || "Studio 2.0 Ads").trim();
    const folderName = `${baseName} - custom`;
    const folder = zip.folder(folderName)!;

    for (let i = 0; i < uniqueIndices.length; i++) {
      const creativeIndex = uniqueIndices[i];
      setExportStatus(`Exporting ${i + 1} of ${uniqueIndices.length}...`);
      const exportFile = await renderCreativeToExportBlob(creatives[creativeIndex], creativeIndex);
      folder.file(`ad-${creativeIndex + 1}.${exportFile.extension}`, exportFile.blob);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${folderName}.zip`);
    setExportStatus("");
  }, [creatives, projectName, renderCreativeToExportBlob]);

  const runExportModal = useCallback(() => {
    if (exportMode === "current") {
      void exportCurrent(exportFolderName);
      return;
    }
    if (exportMode === "all") {
      void exportAll(exportFolderName);
      return;
    }
    const parsed = parsePageRangeInput(customExportInput, creatives.length);
    const indices = parsed.length ? parsed : customExportSelection;
    void exportSelectedPages(indices, exportFolderName);
  }, [creatives.length, customExportInput, customExportSelection, exportAll, exportCurrent, exportFolderName, exportMode, exportSelectedPages]);

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
                thumbnailUrl: typeof media.thumbnailUrl === "string" ? media.thumbnailUrl : null,
                kind: (media.kind === "video" ? "video" : "image") as MediaKind,
                filename: String(media.filename || "Generated ad.png"),
                folderId: typeof media.folderId === "string" ? media.folderId : null,
                createdAt: typeof media.createdAt === "string" ? media.createdAt : undefined,
              }
            : null,
        };
      }));
    } catch {
      setAiGenerations([]);
    }
  }, [projectId]);

  useEffect(() => {
    if (view === "editor") void loadAiGenerations();
  }, [loadAiGenerations, view]);

  useEffect(() => {
    try {
      const key = projectId ? `ccos-studio2-generate-chat-${projectId}` : "";
      const saved = key ? window.localStorage.getItem(key) : null;
      const parsed = saved ? JSON.parse(saved) : [];
      setGenerateMessages(Array.isArray(parsed) ? parsed.filter((item) =>
        item &&
        typeof item.id === "string" &&
        typeof item.prompt === "string" &&
        typeof item.createdAt === "number"
      ) : []);
    } catch {
      setGenerateMessages([]);
    }
    setGenerateStatus("");
    setSelectedGenerationIds([]);
    setGeneratedPreview(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    try {
      const lightweightMessages = generateMessages.slice(-60).map((message) => ({
        ...message,
        sourcePreview: "",
        reference: null,
      }));
      window.localStorage.setItem(`ccos-studio2-generate-chat-${projectId}`, JSON.stringify(lightweightMessages));
    } catch {
      // Local chat history only.
    }
  }, [generateMessages, projectId]);

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

  const attachGenerateMediaReference = useCallback(async (asset: StudioMediaAsset) => {
    if (asset.kind !== "image") {
      setGenerateStatus("Choose an image reference. Video references are not supported here yet.");
      return;
    }
    try {
      const res = await fetch(getMediaPreviewSrc(asset.url));
      const blob = await res.blob();
      const dataUrl = await fileToDataUrl(new File([blob], asset.filename || "reference.png", { type: blob.type || "image/png" }));
      setGenerateReference({ name: asset.filename || "Media Library reference", dataUrl });
      setGenerateStatus("");
      setGenerateMediaPickerOpen(false);
      setMediaPickerMode(null);
      setGenerateAddMenuOpen(false);
    } catch {
      setGenerateStatus("Could not attach that media reference.");
    }
  }, []);

  const handleMediaPickerAsset = useCallback(
    async (asset: StudioMediaAsset) => {
      if (mediaPickerMode === "generate-reference") {
        await attachGenerateMediaReference(asset);
        return;
      }
      if (mediaPickerMode === "replace-current") {
        applyMediaAssetToCurrentCreative(asset);
        closeMediaLibraryPicker();
        return;
      }
      if (mediaPickerMode === "new-ad") {
        registerDraftMediaAsset(asset);
        setNewAdMediaAssets((prev) => {
          const exists = prev.some((item) => item.id === asset.id || item.url === asset.url);
          return exists
            ? prev.filter((item) => item.id !== asset.id && item.url !== asset.url)
            : [...prev, asset];
        });
        setNewAdStatus("");
      }
    },
    [applyMediaAssetToCurrentCreative, attachGenerateMediaReference, closeMediaLibraryPicker, mediaPickerMode, registerDraftMediaAsset]
  );

  const buildHiggsfieldPrompt = useCallback((promptText = generatePrompt.trim()) => {
    const text = currentCreative?.textBlocks.map(getBlockText).filter(Boolean).join("\n\n") || copyText;
    return [
      promptText.trim(),
      "",
      "Keep all important text away from the Instagram top warning area and the bottom DM/send-message button area.",
      "",
      "Use this exact ad copy when it makes sense:",
      text,
      "",
      "Preserve readable text. Make the final image feel like a finished direct-response Instagram Story ad.",
    ].join("\n");
  }, [copyText, currentCreative?.textBlocks, generatePrompt]);

  const ensureAiGeneratedFolder = useCallback(async (parentId: string | null = null) => {
    const existing = mediaFolders.find((folder) => isAiGeneratedFolder(folder) && (folder.parentId || null) === parentId);
    if (existing?.id) return existing.id;
    const res = await fetch("/api/studio-2/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: AI_GENERATED_FOLDER_NAME, folderType: "media", parentId }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { folder?: StudioFolder };
    if (!data.folder?.id) return null;
    setCloudFolders((prev) => prev.some((folder) => folder.id === data.folder!.id) ? prev : [...prev, data.folder!]);
    return data.folder.id;
  }, [mediaFolders]);

  const registerGenerateController = useCallback((runId: string) => {
    const tracker = generateRunControllersRef.current.get(runId);
    const controller = new AbortController();
    if (!tracker) return controller;
    tracker.controllers.add(controller);
    controller.signal.addEventListener("abort", () => tracker.controllers.delete(controller), { once: true });
    return controller;
  }, []);

  const finishGenerateRun = useCallback((runId: string) => {
    const tracker = generateRunControllersRef.current.get(runId);
    if (tracker?.timeoutId) window.clearTimeout(tracker.timeoutId);
    generateRunControllersRef.current.delete(runId);
    setActiveGenerateRuns((prev) => prev.filter((run) => run.id !== runId));
  }, []);

  const stopGenerateRun = useCallback((runId: string, reason = "Stopped by user.") => {
    const tracker = generateRunControllersRef.current.get(runId);
    if (!tracker) return;
    tracker.stopped = true;
    tracker.stopReason = reason;
    tracker.controllers.forEach((controller) => controller.abort());
    const generationIds = [...tracker.generationIds];
    generationIds.forEach((generationId) => {
      void fetch(`/api/studio-2/ai/generations/${encodeURIComponent(generationId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "failed", error: reason }),
      }).catch(() => undefined);
    });
    if (generationIds.length) {
      const generationIdSet = new Set(generationIds);
      setAiGenerations((prev) => prev.map((generation) =>
        generationIdSet.has(String(generation.id || generation.jobId))
          ? { ...generation, status: "failed", error: reason }
          : generation
      ));
    }
    setGenerateMessages((prev) => prev.map((message) =>
      message.id === tracker.messageId ? { ...message, status: "failed" } : message
    ));
    setGenerateStatus(reason);
    if (tracker.timeoutId) window.clearTimeout(tracker.timeoutId);
    setActiveGenerateRuns((prev) => prev.filter((run) => run.id !== runId));
  }, []);

  const editGenerateMessage = useCallback((message: GenerateChatMessage) => {
    setGeneratePrompt(message.prompt);
    setGenerateReference(message.reference ?? null);
    setGenerateSourceAttached(!!message.sourcePreview);
    if (message.sourcePreview) setGenerateSourcePreview(message.sourcePreview);
    window.requestAnimationFrame(() => {
      generatePromptTextareaRef.current?.focus();
      const textarea = generatePromptTextareaRef.current;
      if (textarea) {
        textarea.selectionStart = textarea.value.length;
        textarea.selectionEnd = textarea.value.length;
      }
    });
  }, []);

  const pollAiGeneration = useCallback(
    async (generationId: string, progressLabel = "Creating your ad", runId?: string) => {
      for (let attempt = 0; attempt < 80; attempt++) {
        const tracker = runId ? generateRunControllersRef.current.get(runId) : null;
        if (tracker?.stopped) throw new Error(tracker.stopReason || "Stopped by user.");
        await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 1800 : 3500));
        const controller = runId ? registerGenerateController(runId) : null;
        const res = await fetch(`/api/studio-2/ai/generations/${encodeURIComponent(generationId)}`, {
          signal: controller?.signal,
        });
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
                thumbnailUrl: typeof media.thumbnailUrl === "string" ? media.thumbnailUrl : null,
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
            thumbnailUrl: typeof media.thumbnailUrl === "string" ? media.thumbnailUrl : null,
            kind: "image",
            filename: String(media.filename || "Generated ad.png"),
            folderId: typeof media.folderId === "string" ? media.folderId : null,
            createdAt: typeof media.createdAt === "string" ? media.createdAt : undefined,
          };
          setLibraryMedia((prev) => prev.some((asset) => asset.id === generatedAsset.id) ? prev : [generatedAsset, ...prev]);
        }

        if (nextGeneration.status === "completed") {
          return;
        }
        if (nextGeneration.status === "failed") {
          throw new Error(nextGeneration.error || "Higgsfield generation failed");
        }
        if (runId) {
          setActiveGenerateRuns((prev) => prev.map((run) =>
            run.id === runId ? { ...run, label: progressLabel } : run
          ));
        } else {
          setGenerateStatus(progressLabel);
        }
      }
      throw new Error("Generation is still running. Check back in a minute.");
    },
    [registerGenerateController, upsertAiGeneration]
  );

  const startAiGeneration = useCallback(async (retry?: PendingGenerateRetry) => {
    const submittedPrompt = (retry?.prompt ?? generatePrompt).trim();
    if (!currentCreative || !submittedPrompt) return;
    const runId = uid();
    const messageId = retry?.retryMessageId || uid();
    const submittedAt = Date.now();
    const promptForApi = buildHiggsfieldPrompt(submittedPrompt);
    const submittedReference = retry ? retry.reference ?? null : generateReference;
    const submittedSourcePreview = retry ? retry.sourcePreview : generateSourceAttached ? generateSourcePreview : "";
    const batchCount = clamp(Math.round(generateBatchCount), 1, MAX_GENERATE_BATCH_COUNT);
    const timeoutId = window.setTimeout(() => {
      stopGenerateRun(runId, "Generation timed out. Edit the prompt and resend when ready.");
    }, GENERATE_RUN_TIMEOUT_MS);

    generateRunControllersRef.current.set(runId, {
      messageId,
      controllers: new Set(),
      generationIds: new Set(),
      timeoutId,
      stopped: false,
      stopReason: "",
    });
    setActiveGenerateRuns((prev) => [
      ...prev,
      {
        id: runId,
        messageId,
        label: batchCount === 1 ? "Preparing your ad" : `Preparing ${batchCount} ads`,
        total: batchCount,
        ready: 0,
        startedAt: submittedAt,
      },
    ]);

    setGenerateMessages((prev) => {
      if (retry?.retryMessageId) {
        return prev.map((message) =>
          message.id === retry.retryMessageId
            ? {
                ...message,
                prompt: submittedPrompt,
                sourcePreview: submittedSourcePreview,
                reference: submittedReference,
                status: "running",
                createdAt: submittedAt,
              }
            : message
        );
      }
      return [
        ...prev,
        {
          id: messageId,
          prompt: submittedPrompt,
          sourcePreview: submittedSourcePreview,
          reference: submittedReference,
          status: "running",
          createdAt: submittedAt,
        },
      ];
    });
    if (!retry) {
      setGeneratePrompt("");
      setGenerateReference(null);
    }
    setGeneratePresetMenuOpen(false);
    setGenerateStatus("");
    try {
      const sourceAssetFolderId = getAssetForUrl(currentCreative.photoUrl)?.folderId || null;
      const targetFolderId = await ensureAiGeneratedFolder(setupMediaFolderId || sourceAssetFolderId || null);
      const snapshotDataUrl = submittedSourcePreview
        ? (await renderCreativeToCanvas(currentCreative, 1)).toDataURL("image/png")
        : null;
      const startedGenerations: StudioAIGeneration[] = [];

      for (let index = 0; index < batchCount; index++) {
        const tracker = generateRunControllersRef.current.get(runId);
        if (tracker?.stopped) throw new Error(tracker.stopReason || "Stopped by user.");
        setActiveGenerateRuns((prev) => prev.map((run) =>
          run.id === runId
            ? { ...run, label: batchCount === 1 ? "Preparing your ad" : `Preparing ${index + 1} of ${batchCount}` }
            : run
        ));
        const variationPrompt = batchCount === 1
          ? promptForApi
          : [
              promptForApi,
              `This is variation ${index + 1} of ${batchCount}. Keep it aligned with the same request, but do not make it an exact duplicate of the other variations.`,
            ].join("\n\n");
        const controller = registerGenerateController(runId);
        const res = await fetch("/api/studio-2/ai/generations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            projectId,
            creativeId: currentCreative.id,
            folderId: targetFolderId || setupMediaFolderId,
            model: "gpt_image_2",
            prompt: variationPrompt,
            snapshotDataUrl,
            referenceDataUrl: submittedReference?.dataUrl || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not start Higgsfield generation");
        const generation = data.generation || {};
        const nextGeneration: StudioAIGeneration = {
          id: String(generation.id),
          jobId: String(generation.jobId || ""),
          prompt: String(generation.prompt || variationPrompt),
          status: String(generation.status || "queued"),
          resultUrl: null,
          mediaId: null,
          createdAt: typeof generation.createdAt === "string" ? generation.createdAt : new Date(submittedAt + index + 1).toISOString(),
        };
        startedGenerations.push(nextGeneration);
        generateRunControllersRef.current.get(runId)?.generationIds.add(nextGeneration.id);
        upsertAiGeneration(nextGeneration);
      }

      setActiveGenerateRuns((prev) => prev.map((run) =>
        run.id === runId ? { ...run, label: batchCount === 1 ? "Creating your ad" : `Waiting for ${batchCount} ads` } : run
      ));
      let readyCount = 0;
      const settled = await Promise.allSettled(startedGenerations.map(async (generation) => {
        await pollAiGeneration(generation.id, "Creating your ad", runId);
        readyCount += 1;
        setActiveGenerateRuns((prev) => prev.map((run) =>
          run.id === runId
            ? { ...run, ready: readyCount, label: batchCount > 1 ? `${readyCount} of ${batchCount} ready` : "Finishing up" }
            : run
        ));
        if (editorSidebarModeRef.current !== "generate") {
          setGenerateToast({ message: batchCount === 1 ? "Generated ad is ready." : `${readyCount} of ${batchCount} ready.` });
        }
      }));
      const failedCount = settled.filter((result) => result.status === "rejected").length;
      if (failedCount === settled.length) {
        const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
        throw new Error(firstFailure?.reason instanceof Error ? firstFailure.reason.message : "Higgsfield generation failed");
      }
      if (failedCount > 0) {
        setGenerateStatus(`${settled.length - failedCount} ready. ${failedCount} failed.`);
      } else {
        setGenerateStatus(batchCount === 1 ? "Your ad is ready." : `${batchCount} ads are ready.`);
      }
      setGenerateMessages((prev) => prev.map((message) => message.id === messageId ? { ...message, status: "complete" } : message));
    } catch (err) {
      const tracker = generateRunControllersRef.current.get(runId);
      const aborted = err instanceof DOMException && err.name === "AbortError";
      const message = tracker?.stopped
        ? tracker.stopReason || "Stopped by user."
        : aborted
          ? "Stopped by user."
          : err instanceof Error ? err.message : "Could not generate image.";
      setGenerateStatus(message);
      setGenerateMessages((prev) => prev.map((item) => item.id === messageId ? { ...item, status: "failed" } : item));
      if (isHiggsfieldAuthStatus(message)) {
        setPendingHiggsfieldRetry({
          prompt: submittedPrompt,
          sourcePreview: submittedSourcePreview,
          reference: submittedReference,
          retryMessageId: messageId,
        });
        setHiggsfieldAuthModal({ open: true, message });
        setHiggsfieldAuthLoginUrl("");
        setHiggsfieldAuthStatus("");
      }
    } finally {
      finishGenerateRun(runId);
    }
  }, [
    buildHiggsfieldPrompt,
    currentCreative,
    generateReference,
    generatePrompt,
    generateBatchCount,
    generateSourcePreview,
    generateSourceAttached,
    ensureAiGeneratedFolder,
    finishGenerateRun,
    getAssetForUrl,
    pollAiGeneration,
    projectId,
    registerGenerateController,
    renderCreativeToCanvas,
    setupMediaFolderId,
    stopGenerateRun,
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
    setSelectedTextBlockIds([]);
    setEditorSidebarMode("edit");
    setGeneratedPreview(null);
  }, [pushUndo]);

  const getGenerationAsset = useCallback((generation: StudioAIGeneration): StudioMediaAsset | null => {
    if (generation.status !== "completed") return null;
    const imageUrl = generation.media?.url || generation.resultUrl || "";
    if (!/^https?:\/\//i.test(imageUrl)) return null;
    if (generation.media?.url) return generation.media;
    if (!imageUrl) return null;
    return {
      id: generation.mediaId || generation.id || generation.jobId || imageUrl,
      url: imageUrl,
      thumbnailUrl: generation.media?.thumbnailUrl || null,
      kind: "image",
      filename: "Generated ad.png",
      folderId: null,
      createdAt: generation.createdAt,
    };
  }, []);

  const selectedGenerations = useMemo(
    () => aiGenerations.filter((generation) => selectedGenerationIds.includes(String(generation.id || generation.jobId))),
    [aiGenerations, selectedGenerationIds]
  );
  const selectedGenerationAssets = useMemo(
    () => selectedGenerations.map((generation) => getGenerationAsset(generation)).filter(Boolean) as StudioMediaAsset[],
    [getGenerationAsset, selectedGenerations]
  );

  const toggleGenerationSelection = useCallback((generationId: string) => {
    setSelectedGenerationIds((prev) =>
      prev.includes(generationId) ? prev.filter((id) => id !== generationId) : [...prev, generationId]
    );
  }, []);

  const deleteSelectedGenerations = useCallback(async () => {
    const ids = [...selectedGenerationIds];
    if (!ids.length) return;
    setGenerateStatus(`Deleting ${ids.length} gallery item${ids.length === 1 ? "" : "s"}...`);
    await Promise.all(ids.map((id) => fetch(`/api/studio-2/ai/generations/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null)));
    setAiGenerations((prev) => prev.filter((generation) => !ids.includes(String(generation.id || generation.jobId))));
    setSelectedGenerationIds([]);
    setGalleryFolderMenuOpen(false);
    setGalleryProjectMenuOpen(false);
    setGenerateStatus("");
  }, [selectedGenerationIds]);

  const addSelectedGenerationsToEditor = useCallback(() => {
    if (!selectedGenerationAssets.length) return;
    pushUndo();
    setMediaAssets((prev) => {
      const existing = new Set(prev.map((asset) => asset.url));
      return [
        ...selectedGenerationAssets.filter((asset) => !existing.has(asset.url)),
        ...prev,
      ];
    });
    setCreatives((prev) => {
      const nextCreatives = selectedGenerationAssets.map((asset): Creative => ({
        id: uid(),
        photoUrl: asset.url,
        mediaKind: "image",
        textBlocks: [],
        imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
        status: "draft",
      }));
      setCurrentIndex(prev.length);
      return [...prev, ...nextCreatives];
    });
    setSelectedLayer({ type: "image" });
    setSelectedTextBlockIds([]);
    setSelectedGenerationIds([]);
    setGalleryFolderMenuOpen(false);
    setGalleryProjectMenuOpen(false);
    setEditorSidebarMode("edit");
  }, [pushUndo, selectedGenerationAssets]);

  const downloadGalleryAssets = useCallback(async (assets: StudioMediaAsset[]) => {
    if (!assets.length) return;
    setGenerateStatus(assets.length === 1 ? "Preparing download..." : `Preparing ${assets.length} downloads...`);
    try {
      if (assets.length === 1) {
        const asset = assets[0];
        const res = await fetch(getMediaPreviewSrc(asset.url));
        if (!res.ok) throw new Error("Download failed");
        const blob = await res.blob();
        downloadBlob(blob, asset.filename || "generated-ad.png");
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        await Promise.all(assets.map(async (asset, index) => {
          const res = await fetch(getMediaPreviewSrc(asset.url));
          if (!res.ok) return;
          const blob = await res.blob();
          const ext = asset.filename?.split(".").pop() || "png";
          zip.file(asset.filename || `generated-ad-${index + 1}.${ext}`, blob);
        }));
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `${projectName || "generated-ads"}.zip`);
      }
    } finally {
      setGenerateStatus("");
    }
  }, [projectName]);

  const moveSelectedGenerationsToFolder = useCallback(async (folderId: string | null) => {
    const assets = selectedGenerationAssets.filter((asset) => asset.id);
    if (!assets.length) return;
    setGenerateStatus(`Moving ${assets.length} image${assets.length === 1 ? "" : "s"}...`);
    try {
      await Promise.all(assets.map(async (asset) => {
        const res = await fetch(`/api/studio-2/media/${asset.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId }),
        });
        if (!res.ok) throw new Error("Move failed");
      }));
      const movedIds = new Set(assets.map((asset) => asset.id));
      setLibraryMedia((prev) => prev.map((asset) => movedIds.has(asset.id) ? { ...asset, folderId } : asset));
      setAiGenerations((prev) => prev.map((generation) =>
        generation.media && movedIds.has(generation.media.id)
          ? { ...generation, media: { ...generation.media, folderId } }
          : generation
      ));
      setGalleryFolderMenuOpen(false);
      setGenerateStatus("Moved.");
    } catch {
      setGenerateStatus("Could not move those gallery images.");
    }
  }, [selectedGenerationAssets]);

  const moveSelectedGenerationsToProject = useCallback(async (targetProjectId: string) => {
    const ids = [...selectedGenerationIds];
    if (!ids.length || !targetProjectId) return;
    setGenerateStatus(`Moving ${ids.length} gallery item${ids.length === 1 ? "" : "s"}...`);
    try {
      await Promise.all(ids.map(async (id) => {
        const res = await fetch(`/api/studio-2/ai/generations/${encodeURIComponent(id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: targetProjectId }),
        });
        if (!res.ok) throw new Error("Generation move failed");
      }));
      setAiGenerations((prev) => prev.filter((generation) => !ids.includes(String(generation.id || generation.jobId))));
      setSelectedGenerationIds([]);
      setGalleryProjectMenuOpen(false);
      setGenerateStatus("Moved.");
    } catch {
      setGenerateStatus("Could not move those gallery items.");
    }
  }, [selectedGenerationIds]);

  const openHiggsfieldAuthModal = useCallback((message?: string) => {
    setHiggsfieldAuthModal({ open: true, message });
    setHiggsfieldAuthLoginUrl("");
    setHiggsfieldAuthStatus("");
  }, []);

  const startHiggsfieldAuthLogin = useCallback(async () => {
    const loginWindow = window.open("about:blank", "higgsfield-login", "width=960,height=820");
    let sawLoginUrl = false;
    if (loginWindow) {
      loginWindow.document.title = "Higgsfield Login";
      loginWindow.document.body.style.fontFamily = "system-ui, sans-serif";
      loginWindow.document.body.style.background = "#111";
      loginWindow.document.body.style.color = "#fff";
      loginWindow.document.body.style.padding = "32px";
      loginWindow.document.body.textContent = "Opening Higgsfield login...";
    }

    setSavingHiggsfieldAuth(true);
    setHiggsfieldAuthLoginUrl("");
    setHiggsfieldAuthStatus("Starting Higgsfield login...");

    const handleAuthEvent = (event: string, payload: { message?: string; url?: string }) => {
      if (event === "status" && payload.message) {
        setHiggsfieldAuthStatus(payload.message);
        return;
      }
      if (event === "login_url" && payload.url) {
        sawLoginUrl = true;
        setHiggsfieldAuthLoginUrl(payload.url);
        setHiggsfieldAuthStatus(payload.message || "Approve Higgsfield in the tab that opened.");
        if (loginWindow) {
          loginWindow.location.href = payload.url;
        } else {
          window.open(payload.url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (event === "connected") {
        setHiggsfieldAuthStatus(payload.message || "Higgsfield is connected.");
        const retry = pendingHiggsfieldRetry;
        if (retry) {
          setHiggsfieldAuthStatus("Higgsfield is connected. Retrying your generation...");
          setPendingHiggsfieldRetry(null);
          window.setTimeout(() => {
            setHiggsfieldAuthModal({ open: false });
            void startAiGeneration(retry);
          }, 500);
        } else {
          window.setTimeout(() => setHiggsfieldAuthModal({ open: false }), 1200);
        }
        return;
      }
      if (event === "error") {
        throw new Error(payload.message || "Could not reconnect Higgsfield.");
      }
    };

    try {
      const res = await fetch("/api/studio-2/ai/higgsfield-auth/login", { cache: "no-store" });
      if (!res.ok || !res.body) throw new Error("Could not start Higgsfield login.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const event = chunk.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "message";
          const data = chunk.match(/^data:\s*(.+)$/m)?.[1]?.trim() || "{}";
          handleAuthEvent(event, JSON.parse(data));
        }
      }
    } catch (err) {
      if (loginWindow && !loginWindow.closed && !sawLoginUrl) loginWindow.close();
      setHiggsfieldAuthStatus(err instanceof Error ? err.message : "Could not save Higgsfield login.");
    } finally {
      setSavingHiggsfieldAuth(false);
    }
  }, [pendingHiggsfieldRetry, startAiGeneration]);

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
    try {
      const saved = window.localStorage.getItem(GENERATE_PRESETS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) {
        setCustomGeneratePresets(parsed.filter((item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.label === "string" &&
          typeof item.prompt === "string"
        ));
      }
    } catch {
      // Local preference only.
    }
  }, []);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(GENERATE_HIDDEN_PRESETS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) {
        setHiddenGeneratePresetIds(parsed.filter((id) => typeof id === "string"));
      }
    } catch {
      // Local preference only.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(GENERATE_PRESETS_KEY, JSON.stringify(customGeneratePresets));
    } catch {
      // Local preference only.
    }
  }, [customGeneratePresets]);

  // Saved color palette (shared across every ad/project).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COLOR_PALETTE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      if (Array.isArray(parsed) && parsed.length) {
        const colors = parsed
          .filter((c) => typeof c === "string")
          .map((c) => normalizeHex(c, "").toUpperCase())
          .filter((c) => /^#[0-9A-F]{6}$/.test(c));
        if (colors.length) setColorPalette(Array.from(new Set(colors)).slice(0, MAX_PALETTE_COLORS));
      }
    } catch {
      // Local preference only.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLOR_PALETTE_KEY, JSON.stringify(colorPalette));
    } catch {
      // Local preference only.
    }
  }, [colorPalette]);

  // Saved text-style presets (text color + highlight color + marker/solid).
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TEXT_STYLE_PRESETS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) {
        setTextStylePresets(
          parsed
            .filter((item) => item && typeof item.id === "string" && typeof item.textColor === "string")
            .map((item): TextStylePreset => ({
              id: String(item.id),
              textColor: normalizeHex(item.textColor, "#FFFFFF").toUpperCase(),
              bgColor: normalizeHex(item.bgColor ?? "#000000", "#000000").toUpperCase(),
              bgOpacity: typeof item.bgOpacity === "number" ? clamp(item.bgOpacity, 0, 1) : 1,
              bgStyle: item.bgStyle === "marker" ? "marker" : "solid",
              borderRadius: typeof item.borderRadius === "number" ? item.borderRadius : 16,
            }))
            .slice(0, MAX_TEXT_STYLE_PRESETS)
        );
      }
    } catch {
      // Local preference only.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(TEXT_STYLE_PRESETS_KEY, JSON.stringify(textStylePresets));
    } catch {
      // Local preference only.
    }
  }, [textStylePresets]);

  useEffect(() => {
    try {
      window.localStorage.setItem(GENERATE_HIDDEN_PRESETS_KEY, JSON.stringify(hiddenGeneratePresetIds));
    } catch {
      // Local preference only.
    }
  }, [hiddenGeneratePresetIds]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(COPY_LAB_PRESETS_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) {
        setCopyLabPresets(parsed.filter((item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.label === "string" &&
          typeof item.prompt === "string"
        ));
      }
    } catch {
      // Local preference only.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COPY_LAB_PRESETS_KEY, JSON.stringify(copyLabPresets));
    } catch {
      // Local preference only.
    }
  }, [copyLabPresets]);

  useEffect(() => {
    const textarea = generatePromptTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(54, textarea.scrollHeight)}px`;
  }, [generatePrompt, editorSidebarMode]);

  useEffect(() => {
    if (editorSidebarMode !== "generate") return;
    window.requestAnimationFrame(() => {
      generateConversationEndRef.current?.scrollIntoView({ block: "end" });
    });
  }, [activeGenerateRuns, aiGenerations, editorSidebarMode, generateMessages, generateStatus, generatingAd]);

  useEffect(() => {
    if (generatingAd || !generateStatus || isGenerateErrorStatus(generateStatus) || !isGenerateSuccessStatus(generateStatus)) return;
    const timeout = window.setTimeout(() => setGenerateStatus(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [generateStatus, generatingAd]);

  useEffect(() => {
    if (!generatePresetMenuOpen) return;

    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && generatePresetMenuRef.current?.contains(target)) return;
      setGeneratePresetMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [generatePresetMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    if (editorSidebarMode !== "generate" || !currentCreative) {
      setGenerateSourcePreview("");
      return;
    }

    renderCreativePreviewToCanvas(currentCreative, 0.25)
      .then((canvas) => {
        if (!cancelled) setGenerateSourcePreview(canvas.toDataURL("image/png"));
      })
      .catch(() => {
        if (!cancelled) setGenerateSourcePreview("");
      });

    return () => {
      cancelled = true;
    };
  }, [currentCreative, editorSidebarMode, renderCreativePreviewToCanvas]);

  useEffect(() => {
    if (editorSidebarMode === "generate" && currentCreative?.id) {
      setGenerateSourceAttached(true);
    }
  }, [currentCreative?.id, editorSidebarMode]);

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

  const applyGeneratePreset = useCallback((preset: GeneratePreset) => {
    setGeneratePrompt((prev) => {
      const current = prev.trim();
      return current ? `${current}\n\n${preset.prompt}` : preset.prompt;
    });
  }, []);

  const openAddGeneratePresetModal = useCallback(() => {
    const prompt = generatePrompt.trim();
    setNewGeneratePresetPrompt(prompt);
    setNewGeneratePresetLabel(prompt ? (prompt.length > 34 ? `${prompt.slice(0, 34)}...` : prompt) : "");
    setAddingGeneratePreset(true);
  }, [generatePrompt]);

  const saveNewGeneratePreset = useCallback(() => {
    const prompt = newGeneratePresetPrompt.trim();
    const label = newGeneratePresetLabel.trim();
    if (!prompt) return;
    setCustomGeneratePresets((prev) => [
      {
        id: uid(),
        label: label || (prompt.length > 34 ? `${prompt.slice(0, 34)}...` : prompt),
        prompt,
      },
      ...prev,
    ].slice(0, 12));
    setAddingGeneratePreset(false);
  }, [newGeneratePresetLabel, newGeneratePresetPrompt]);

  const openGeneratePresetEditor = useCallback((preset: GeneratePreset) => {
    setEditingGeneratePreset(preset);
    setEditingGeneratePresetLabel(preset.label);
    setEditingGeneratePresetPrompt(preset.prompt);
  }, []);

  const saveGeneratePresetEdit = useCallback(() => {
    if (!editingGeneratePreset) return;
    const label = editingGeneratePresetLabel.trim();
    const prompt = editingGeneratePresetPrompt.trim();
    if (!label || !prompt) return;
    const nextPreset = { ...editingGeneratePreset, label, prompt };
    setCustomGeneratePresets((prev) => {
      const existing = prev.some((preset) => preset.id === nextPreset.id);
      return existing
        ? prev.map((preset) => preset.id === nextPreset.id ? nextPreset : preset)
        : [nextPreset, ...prev];
    });
    setHiddenGeneratePresetIds((prev) => prev.filter((id) => id !== nextPreset.id));
    setEditingGeneratePreset(null);
  }, [editingGeneratePreset, editingGeneratePresetLabel, editingGeneratePresetPrompt]);

  const deleteGeneratePresetEdit = useCallback(() => {
    if (!editingGeneratePreset) return;
    setCustomGeneratePresets((prev) => prev.filter((preset) => preset.id !== editingGeneratePreset.id));
    if (defaultGeneratePresetIds.has(editingGeneratePreset.id)) {
      setHiddenGeneratePresetIds((prev) => prev.includes(editingGeneratePreset.id) ? prev : [...prev, editingGeneratePreset.id]);
    }
    setEditingGeneratePreset(null);
  }, [defaultGeneratePresetIds, editingGeneratePreset]);

  const deleteCreativeAt = useCallback((indexToDelete: number) => {
    if (creatives.length <= 1) return;
    pushUndo();
    setCreatives((prev) => prev.filter((_, index) => index !== indexToDelete));
    setCurrentIndex((index) => clamp(index > indexToDelete ? index - 1 : index, 0, Math.max(0, creatives.length - 2)));
    setSelectedLayer(null);
    setSelectedTextBlockIds([]);
  }, [creatives.length, pushUndo]);

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
    setExportMode("current");
    setCustomExportInput(String(currentIndex + 1));
    setCustomExportSelection([currentIndex]);
    setExportModalOpen(true);
  }, [currentIndex, projectName]);

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

  const moveFoldersToParent = useCallback(async (parentId: string | null, folderIds: string[], folderType: StudioFolderType) => {
    const ids = [...new Set(folderIds)].filter((id) => id && id !== parentId);
    if (!ids.length) return;
    try {
      await Promise.all(
        ids.map(async (folderId) => {
          const res = await fetch(`/api/studio-2/folders/${folderId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ parentId }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null) as { error?: string } | null;
            throw new Error(data?.error || "Folder move failed");
          }
        })
      );
      setCloudFolders((prev) => prev.map((folder) => ids.includes(folder.id) ? { ...folder, parentId } : folder));
      if (folderType === "media") {
        setSelectedMediaFolderIds((prev) => prev.filter((id) => !ids.includes(id)));
      } else {
        setSelectedFolderIds((prev) => prev.filter((id) => !ids.includes(id)));
      }
      setFolderCardMenuId(null);
      setDragOverFolderId(null);
      setDraggedDesignFolderIds([]);
      setDraggedMediaFolderIds([]);
      setCloudStatus(`${ids.length} folder${ids.length === 1 ? "" : "s"} moved.`);
      void fetchStudioHome();
    } catch (err) {
      setCloudStatus(err instanceof Error ? err.message : "Could not move those folders.");
    }
  }, [fetchStudioHome]);

  const confirmDeleteFolders = useCallback(async () => {
    const ids = deleteFolderIds;
    if (!ids.length || deletingFolder) return;
    setDeletingFolder(true);
    setDeleteFolderStatus("Deleting...");
    try {
      const parentByFolderId = new Map(deleteFolders.map((folder) => [folder.id, folder.parentId || null]));
      await Promise.all(
        ids.map(async (folderId) => {
          const res = await fetch(`/api/studio-2/folders/${folderId}`, { method: "DELETE" });
          if (!res.ok) throw new Error("Folder delete failed");
        })
      );
      setCloudFolders((prev) => prev.filter((folder) => !ids.includes(folder.id)));
      setCloudProjects((prev) => prev.map((project) => (
        project.folderId && ids.includes(project.folderId) ? { ...project, folderId: parentByFolderId.get(project.folderId) || null } : project
      )));
      setLibraryMedia((prev) => prev.map((asset) => (
        asset.folderId && ids.includes(asset.folderId) ? { ...asset, folderId: parentByFolderId.get(asset.folderId) || null } : asset
      )));
      setProjectFolderId((current) => (current && ids.includes(current) ? parentByFolderId.get(current) || null : current));
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
    deleteFolders,
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
              thumbnailUrl: draft.creatives[0]
                ? (creativeThumbs[draft.creatives[0].id] || ((draft.creatives[0].mediaKind || "image") === "image" ? draft.creatives[0].photoUrl : null))
                : draft.photos[0] || null,
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
    [activeDraftId, buildDraftState, creativeThumbs, fetchStudioHome, projectId]
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
        homeMode === "media" ? selectedMediaFolderId : selectedFolderId
      );
      if (folderId && homeMode === "designs" && !selectedFolderId) setSelectedFolderId(folderId);
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
  }, [createStudioFolder, fetchStudioHome, homeFolderName, homeMode, savingHomeFolder, selectedFolderId, selectedMediaFolderId]);

  const openRenameFolderModal = useCallback((folder: StudioFolder) => {
    setRenameFolderTarget(folder);
    setRenameFolderName(folder.name);
    setRenameFolderStatus("");
    setFolderCardMenuId(null);
  }, []);

  const saveFolderRename = useCallback(async () => {
    if (!renameFolderTarget || !renameFolderName.trim()) return;
    setRenameFolderStatus("Saving...");
    try {
      const res = await fetch(`/api/studio-2/folders/${renameFolderTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameFolderName.trim() }),
      });
      const data = await res.json() as { folder?: StudioFolder; error?: string };
      if (!res.ok || !data.folder) throw new Error(data.error || "Rename failed");
      setCloudFolders((prev) => prev.map((folder) => folder.id === data.folder!.id ? { ...folder, name: data.folder!.name } : folder));
      setRenameFolderTarget(null);
      setRenameFolderStatus("");
      setCloudStatus("Folder renamed.");
    } catch (err) {
      setRenameFolderStatus(err instanceof Error ? err.message : "Could not rename that folder.");
    }
  }, [renameFolderName, renameFolderTarget]);

  const loadCopyLabWinners = useCallback(async () => {
    setCopyLabOpen(true);
    setCopyLabStatus("Loading top-spend winners and reading the copy...");
    try {
      const res = await fetch("/api/studio-2/copy-lab/winners?limit=12&status=all", { cache: "no-store" });
      const data = await res.json() as { winners?: CopyLabWinner[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Could not load winners");
      const normalized = (data.winners || []).map((winner) => ({
        ...winner,
        offerType: winner.offerType || "Lead Magnet",
        extractedCopy: winner.extractedCopy || "",
        transcribing: !!winner.previewImageUrl,
      }));
      setCopyLabWinners(normalized);
      if (!normalized.length) {
        setCopyLabStatus("No top-spend creative previews found yet.");
        return;
      }
      await Promise.allSettled(normalized.slice(0, 8).map(async (winner) => {
        if (!winner.previewImageUrl) return;
        try {
          const extractedCopy = await requestCopyLabTranscription(winner);
          setCopyLabWinners((prev) => prev.map((item) => item.id === winner.id ? { ...item, extractedCopy, transcribing: false } : item));
        } catch {
          setCopyLabWinners((prev) => prev.map((item) => item.id === winner.id ? { ...item, transcribing: false } : item));
        }
      }));
      setCopyLabStatus("Winning copy loaded. Pick an offer type, add direction if needed, then write variations.");
    } catch (err) {
      setCopyLabStatus(err instanceof Error ? err.message : "Could not load winning ads.");
    }
  }, []);

  const updateCopyLabWinner = useCallback((winnerId: string, patch: Partial<CopyLabWinner>) => {
    setCopyLabWinners((prev) => prev.map((winner) => winner.id === winnerId ? { ...winner, ...patch } : winner));
  }, []);

  const generateCopyLabVariations = useCallback(async () => {
    const winners = copyLabWinners.filter((winner) => winner.extractedCopy.trim());
    if (!winners.length) {
      setCopyLabStatus("Load winning ads first.");
      return;
    }
    setCopyLabGenerating(true);
    setCopyLabStatus("Writing close variations...");
    try {
      const res = await fetch("/api/studio-2/copy-lab/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          winners,
          count: copyLabVariationCount,
          direction: copyLabDirection,
        }),
      });
      const data = await res.json() as { copy?: string; error?: string };
      if (!res.ok || !data.copy) throw new Error(data.error || "Could not generate copy");
      setCopyText(data.copy);
      setCopyLabStatus("Variations added to the copy box.");
    } catch (err) {
      setCopyLabStatus(err instanceof Error ? err.message : "Could not generate variations.");
    } finally {
      setCopyLabGenerating(false);
    }
  }, [copyLabDirection, copyLabVariationCount, copyLabWinners]);

  const saveCopyLabPreset = useCallback(() => {
    const prompt = copyLabDirection.trim();
    if (!prompt) {
      setCopyLabStatus("Write a prompt first, then save it.");
      return;
    }
    const label = prompt.length > 28 ? `${prompt.slice(0, 28)}...` : prompt;
    setCopyLabPresets((prev) => [{ id: uid(), label, prompt }, ...prev].slice(0, 12));
    setCopyLabStatus("Copy prompt saved.");
  }, [copyLabDirection]);

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
      <div style={{ maxHeight: 128, overflowY: "auto", display: "grid", gap: 6, marginBottom: 10 }}>
        <button
          type="button"
          onClick={() => {
            setUploadTargetFolderId(null);
            setShareLinkStatus("");
          }}
          style={{ ...buttonStyle(!uploadTargetFolderId), height: 34, justifyContent: "flex-start" }}
        >
          <Library size={14} /> All Media
        </button>
        {mediaFolders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            onClick={() => {
              setUploadTargetFolderId(folder.id);
              setShareLinkStatus("");
            }}
            style={{ ...buttonStyle(uploadTargetFolderId === folder.id), height: 34, justifyContent: "flex-start", paddingLeft: folder.parentId ? 22 : 12 }}
          >
            <Folder size={14} /> {folder.parentId ? "- " : ""}{folder.name}
          </button>
        ))}
      </div>
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
    const canGenerate = !!currentCreative && !!generatePrompt.trim();
    const allGeneratePresets = [
      ...customGeneratePresets,
      ...DEFAULT_GENERATE_PRESETS.filter((preset) =>
        !hiddenGeneratePresetIds.includes(preset.id) &&
        !customGeneratePresets.some((customPreset) => customPreset.id === preset.id)
      ),
    ];
    const hydratedMessages = generateMessages.length
      ? generateMessages
      : aiGenerations
          .filter((generation) => generation.prompt)
          .map((generation) => {
            const createdAt = generation.createdAt ? Date.parse(generation.createdAt) : Date.now();
            return {
              id: `stored-${generation.id || generation.jobId}`,
              prompt: summarizeStoredGenerationPrompt(generation.prompt),
              sourcePreview: "",
              reference: null,
              status: generation.status === "failed" ? "failed" : "sent",
              createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
            } satisfies GenerateChatMessage;
          });
    const conversationItems: GenerateConversationItem[] = [
      ...hydratedMessages.map((message) => ({
        type: "message" as const,
        id: `message-${message.id}`,
        sort: message.createdAt,
        message,
      })),
      ...aiGenerations
        .filter((generation) => generation.status === "completed" && (generation.media?.url || generation.resultUrl))
        .map((generation) => {
          const createdAt = generation.createdAt ? Date.parse(generation.createdAt) : NaN;
          return {
            type: "generation" as const,
            id: `generation-${generation.id || generation.jobId}`,
            sort: Number.isFinite(createdAt) ? createdAt : 0,
            generation,
          };
        }),
      ...activeGenerateRuns.map((run) => ({
        type: "status" as const,
        id: `run-${run.id}`,
        sort: run.startedAt + 1,
        status: run.ready > 0 && run.total > 1 ? `${run.ready} of ${run.total} ready` : run.label,
        run,
      })),
      ...(generateStatus && (!activeGenerateRuns.length || isGenerateErrorStatus(generateStatus) || isGenerateSuccessStatus(generateStatus)) ? [{
        type: "status" as const,
        id: "generate-status",
        sort: Number.MAX_SAFE_INTEGER,
        status: generateStatus,
      }] : []),
    ].sort((a, b) => a.sort - b.sort);
    const hasGenerateActivity = conversationItems.length > 0 || generatingAd;
    const selectedGalleryCount = selectedGenerationIds.length;
    const selectedGalleryReadyCount = selectedGenerationAssets.length;
    const generateNeedsAuth = isHiggsfieldAuthStatus(generateStatus);
    const generateFolderTrail: StudioFolder[] = [];
    const seenGenerateFolderIds = new Set<string>();
    let generateFolderCursor: StudioFolder | null = currentGenerateMediaFolder;
    while (generateFolderCursor && !seenGenerateFolderIds.has(generateFolderCursor.id)) {
      seenGenerateFolderIds.add(generateFolderCursor.id);
      generateFolderTrail.unshift(generateFolderCursor);
      generateFolderCursor = mediaFolders.find((folder) => folder.id === generateFolderCursor?.parentId) || null;
    }

    return (
      <>
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
            flex: "1 1 auto",
            minWidth: 360,
            display: "flex",
            flexDirection: "column",
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
            <div style={{ flex: 1 }} />
            <button
              type="button"
              aria-pressed={generateGalleryOpen}
              onClick={() => setGenerateGalleryOpen((open) => !open)}
              style={{
                ...buttonStyle(false),
                height: 34,
                padding: "0 13px",
                gap: 7,
                background: generateGalleryOpen ? ADS_BRAND.active : ADS_BRAND.panel3,
                color: generateGalleryOpen ? ADS_BRAND.text : ADS_BRAND.text2,
                border: `1px solid ${generateGalleryOpen ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
              }}
            >
              <ImagePlus size={15} />
              <span>Gallery</span>
              {aiGenerations.length > 0 && (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: generateGalleryOpen ? ADS_BRAND.goldSoft : ADS_BRAND.active,
                    border: `1px solid ${generateGalleryOpen ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                    color: generateGalleryOpen ? ADS_BRAND.gold : ADS_BRAND.text2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "0 5px",
                    fontSize: 11,
                    fontWeight: 900,
                    lineHeight: 1,
                  }}
                >
                  {aiGenerations.length}
                </span>
              )}
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "28px 28px 18px" }}>
            {hasGenerateActivity && (
              <div style={{ maxWidth: 760, margin: "0 auto", display: "grid", gap: 16 }}>
                {conversationItems.map((item) => {
                  if (item.type === "message") {
                    const { message } = item;
                    const activeMessageRun = activeGenerateRuns.find((run) => run.messageId === message.id);
                    const messageStatusLabel =
                      activeMessageRun ? "Generating" :
                      message.status === "complete" ? "Ready" :
                      message.status === "failed" ? "Failed" :
                      message.status === "running" ? "Generating" :
                      "Sent";
                    return (
                      <div
                        key={item.id}
                        style={{
                          justifySelf: "end",
                          maxWidth: 620,
                          border: `1px solid ${message.status === "failed" ? "rgba(255,155,155,0.36)" : ADS_BRAND.border2}`,
                          borderRadius: 18,
                          background: ADS_BRAND.panel2,
                          color: ADS_BRAND.text,
                          padding: 12,
                          display: "grid",
                          gap: 10,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                          {message.sourcePreview && (
                            <img
                              src={message.sourcePreview}
                              alt=""
                              style={{ width: 58, height: 58, objectFit: "cover", borderRadius: 9, border: `1px solid ${ADS_BRAND.border2}`, flexShrink: 0 }}
                            />
                          )}
                          {message.reference && (
                            <img
                              src={message.reference.dataUrl}
                              alt=""
                              title={message.reference.name}
                              style={{ width: 58, height: 58, objectFit: "cover", borderRadius: 9, border: `1px solid ${ADS_BRAND.border2}`, flexShrink: 0 }}
                            />
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ color: ADS_BRAND.text, fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{message.prompt}</div>
                            <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 9 }}>
                              <div
                                style={{
                                  color: message.status === "failed" ? "#ff9b9b" : activeMessageRun ? ADS_BRAND.gold : ADS_BRAND.text3,
                                  fontSize: 11,
                                  fontWeight: 850,
                                  textTransform: "uppercase",
                                }}
                              >
                                {messageStatusLabel}
                              </div>
                              {activeMessageRun && (
                                <button
                                  type="button"
                                  onClick={() => stopGenerateRun(activeMessageRun.id)}
                                  style={{ ...buttonStyle(false), height: 28, padding: "0 9px", fontSize: 11 }}
                                >
                                  <Square size={10} fill="currentColor" /> Stop
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => editGenerateMessage(message)}
                                style={{ ...buttonStyle(false), height: 28, padding: "0 9px", fontSize: 11 }}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void startAiGeneration({
                                  prompt: message.prompt,
                                  sourcePreview: message.sourcePreview,
                                  reference: message.reference ?? null,
                                })}
                                disabled={!currentCreative}
                                style={{ ...buttonStyle(false), height: 28, padding: "0 9px", fontSize: 11, opacity: currentCreative ? 1 : 0.45 }}
                              >
                                Resend
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (item.type === "status") {
                    const statusIsError = isGenerateErrorStatus(item.status);
                    const statusIsDone = !generatingAd && isGenerateSuccessStatus(item.status);
                    const statusDetail = statusIsError
                      ? item.status
                      : item.run
                        ? item.run.total > 1
                          ? `${item.run.ready} of ${item.run.total} ready. You can keep working, stop this run, or start another one.`
                          : "You can keep working, stop this run, or start another one."
                      : statusIsDone
                        ? "Saved to your gallery and Media Library."
                        : "This can take about a minute. You can keep working while it finishes.";
                    return (
                      <div
                        key={item.id}
                        style={{
                          justifySelf: "start",
                          maxWidth: 620,
                          border: `1px solid ${statusIsError ? "rgba(255,155,155,0.3)" : statusIsDone ? "rgba(125,211,168,0.26)" : ADS_BRAND.border2}`,
                          borderRadius: 18,
                          background: ADS_BRAND.panel2,
                          color: statusIsError ? "#ff9b9b" : ADS_BRAND.text2,
                          padding: "14px 16px",
                          display: "grid",
                          gridTemplateColumns: "34px minmax(0, 1fr)",
                          alignItems: "center",
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            width: 34,
                            height: 34,
                            borderRadius: "50%",
                            background: statusIsError ? "rgba(255,155,155,0.1)" : statusIsDone ? "rgba(125,211,168,0.1)" : ADS_BRAND.panel3,
                            color: statusIsError ? "#ff9b9b" : statusIsDone ? ADS_BRAND.success : ADS_BRAND.gold,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {statusIsError ? (
                            <X size={16} />
                          ) : statusIsDone ? (
                            <CheckCircle2 size={17} />
                          ) : (
                            <LoaderCircle size={17} style={{ animation: "spin 1s linear infinite" }} />
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: statusIsError ? "#ffb3b3" : ADS_BRAND.text, fontSize: 14, fontWeight: 850 }}>
                            {statusIsError ? "Generation hit a snag" : item.status}
                          </div>
                          <div style={{ color: statusIsError ? "#ffb3b3" : ADS_BRAND.text3, fontSize: 12, lineHeight: 1.45, marginTop: 3 }}>
                            {statusDetail}
                          </div>
                          {statusIsError && generateNeedsAuth && (
                            <button
                              type="button"
                              onClick={() => openHiggsfieldAuthModal(item.status)}
                              style={{ ...buttonStyle(false), height: 32, marginTop: 10, padding: "0 10px" }}
                            >
                              Reconnect Higgsfield
                            </button>
                          )}
                          {item.run && !statusIsError && (
                            <button
                              type="button"
                              onClick={() => stopGenerateRun(item.run!.id)}
                              style={{ ...buttonStyle(false), height: 32, marginTop: 10, padding: "0 10px" }}
                            >
                              <Square size={10} fill="currentColor" /> Stop this run
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  }

                  const { generation } = item;
                  const asset = getGenerationAsset(generation);
                  const status = generation.status || "queued";
                  const failed = status === "failed";
                  const ready = !!asset;

                  return (
                    <div
                      key={item.id}
                      style={{
                        justifySelf: "start",
                        maxWidth: 260,
                        border: `1px solid ${failed ? "rgba(255,155,155,0.38)" : ADS_BRAND.border2}`,
                        borderRadius: 14,
                        overflow: "hidden",
                        background: ADS_BRAND.panel2,
                      }}
                    >
                      {asset ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (asset) setGeneratedPreview({ generation, asset });
                          }}
                          style={{
                            width: "100%",
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            cursor: asset ? "pointer" : "default",
                            display: "block",
                          }}
                          title={asset ? "Open preview" : status}
                        >
                          <img src={getMediaPreviewSrc(asset.url)} alt="" style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover", display: "block" }} />
                        </button>
                      ) : (
                        <div
                          style={{
                            width: 220,
                            maxWidth: "100%",
                            aspectRatio: "9 / 16",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 10,
                            color: failed ? "#ff9b9b" : ADS_BRAND.text3,
                            background: ADS_BRAND.bgDeep,
                          }}
                        >
                          {failed ? (
                            <X size={24} color="#ff9b9b" />
                          ) : (
                            <LoaderCircle size={24} color={ADS_BRAND.gold} style={{ animation: "spin 1s linear infinite" }} />
                          )}
                          <span style={{ fontSize: 12, fontWeight: 800 }}>
                            {failed ? "Generation failed" : "Creating"}
                          </span>
                        </div>
                      )}
                      <div style={{ padding: "9px 10px", color: failed ? "#ff9b9b" : ready ? ADS_BRAND.success : ADS_BRAND.gold, fontSize: 10, fontWeight: 900, textTransform: "uppercase" }}>
                        {ready ? "Image ready" : failed ? "Failed" : formatGenerationStatusLabel(status)}
                      </div>
                    </div>
                  );
                })}
                <div ref={generateConversationEndRef} />
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
              minHeight: 150,
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
            <div style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 46 }}>
              {generateSourceAttached && (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 9,
                    overflow: "hidden",
                    border: `1px solid ${ADS_BRAND.border2}`,
                    background: ADS_BRAND.bgDeep,
                    flexShrink: 0,
                    position: "relative",
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
                  <button
                    type="button"
                    onClick={() => setGenerateSourceAttached(false)}
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      width: 18,
                      height: 18,
                      borderRadius: "50%",
                      border: "none",
                      background: "rgba(0,0,0,0.7)",
                      color: ADS_BRAND.text,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: 0,
                    }}
                    title="Remove source ad"
                  >
                    <X size={11} />
                  </button>
                </div>
              )}

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
              ref={generatePromptTextareaRef}
              value={generatePrompt}
              onChange={(event) => setGeneratePrompt(event.target.value)}
              rows={3}
              style={{
                width: "100%",
                minHeight: 54,
                border: "none",
                outline: "none",
                resize: "none",
                overflow: "hidden",
                background: "transparent",
                color: ADS_BRAND.text,
                fontFamily: "inherit",
                fontSize: 17,
                lineHeight: 1.45,
              }}
              placeholder="Describe what you want to generate..."
            />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
              <div ref={generateAddMenuRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setGenerateAddMenuOpen((open) => !open)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: `1px solid ${ADS_BRAND.border2}`,
                    background: ADS_BRAND.panel3,
                    color: ADS_BRAND.text2,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                  title="Add reference"
                >
                  <Plus size={15} />
                </button>
                {generateAddMenuOpen && (
                  <div
	                    style={{
	                      position: "absolute",
	                      left: 0,
	                      bottom: 38,
	                      width: 230,
	                      border: `1px solid ${ADS_BRAND.border2}`,
	                      borderRadius: 12,
	                      background: ADS_BRAND.panel,
	                      boxShadow: "0 20px 60px rgba(0,0,0,0.48)",
                      padding: 7,
                      zIndex: 9,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setGenerateAddMenuOpen(false);
                        generateReferenceInputRef.current?.click();
                      }}
                      className="studio2-menu-row"
                      style={{ minHeight: 38 }}
                    >
                      <Upload size={14} /> Upload new
                    </button>
                    <button
                      type="button"
	                      onClick={() => {
	                        openMediaLibraryPicker("generate-reference");
	                      }}
                      className="studio2-menu-row"
                      style={{ minHeight: 38 }}
                    >
                      <Library size={14} /> Media Library
                    </button>
                  </div>
                )}
              </div>
              <div ref={generatePresetMenuRef} style={{ position: "relative", marginRight: "auto" }}>
                <button
                  type="button"
                  onClick={() => setGeneratePresetMenuOpen((open) => !open)}
                  style={{
                    height: 36,
                    borderRadius: 999,
                    border: `1px solid ${ADS_BRAND.border2}`,
                    background: ADS_BRAND.panel3,
                    color: ADS_BRAND.text2,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "0 12px",
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  <Bookmark size={14} color={ADS_BRAND.gold} />
                  Presets
                  <ChevronDown size={14} />
                </button>
                {generatePresetMenuOpen && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      bottom: 44,
                      width: 300,
                      border: `1px solid ${ADS_BRAND.border2}`,
                      borderRadius: 14,
                      background: ADS_BRAND.panel,
                      boxShadow: "0 20px 60px rgba(0,0,0,0.48)",
                      padding: 7,
                      zIndex: 8,
                    }}
                  >
                    <button
                      type="button"
                      onClick={openAddGeneratePresetModal}
                      style={{
                        width: "100%",
                        minHeight: 38,
                        border: "none",
                        borderRadius: 9,
                        background: "transparent",
                        color: ADS_BRAND.text,
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "8px 10px",
                        fontFamily: "inherit",
                        fontSize: 13,
                        fontWeight: 800,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <Plus size={15} /> Add prompt
                    </button>
                    <div style={{ height: 1, background: ADS_BRAND.border2, margin: "6px 4px" }} />
                    {allGeneratePresets.map((preset) => {
                      const hovered = hoveredGeneratePresetId === preset.id;
                      return (
                      <div
                        key={preset.id}
                        onMouseEnter={() => setHoveredGeneratePresetId(preset.id)}
                        onMouseLeave={() => setHoveredGeneratePresetId(null)}
                        style={{
                          width: "100%",
                          borderRadius: 9,
                          background: hovered ? ADS_BRAND.active : "transparent",
                          color: ADS_BRAND.text2,
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => applyGeneratePreset(preset)}
                          style={{
                            flex: 1,
                            minWidth: 0,
                            border: "none",
                            borderRadius: 9,
                            background: "transparent",
                            color: hovered ? ADS_BRAND.text : ADS_BRAND.text2,
                            display: "grid",
                            gap: 3,
                            padding: "9px 10px",
                            fontFamily: "inherit",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span style={{ fontSize: 13, fontWeight: 850 }}>{preset.label}</span>
                          <span style={{ color: ADS_BRAND.text3, fontSize: 11, lineHeight: 1.35 }}>{preset.prompt}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => openGeneratePresetEditor(preset)}
                          style={{
                            width: 30,
                            height: 30,
                            marginRight: 6,
                            border: `1px solid ${ADS_BRAND.border2}`,
                            borderRadius: 8,
                            background: ADS_BRAND.panel3,
                            color: ADS_BRAND.text2,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            opacity: hovered ? 1 : 0,
                            pointerEvents: hovered ? "auto" : "none",
                            cursor: "pointer",
                          }}
                          title="Edit preset"
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div
                title="Images to generate"
                style={{
                  height: 30,
                  borderRadius: 999,
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.panel3,
                  color: ADS_BRAND.text2,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 2,
                  padding: "0 4px",
                }}
              >
                <button
                  type="button"
                  onClick={() => setGenerateBatchCount((count) => clamp(count - 1, 1, MAX_GENERATE_BATCH_COUNT))}
                  disabled={generateBatchCount <= 1}
                  style={{
                    width: 22,
                    height: 22,
                    border: "none",
                    borderRadius: "50%",
                    background: "transparent",
                    color: generateBatchCount <= 1 ? ADS_BRAND.text4 : ADS_BRAND.text2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: generateBatchCount <= 1 ? "not-allowed" : "pointer",
                  }}
                  aria-label="Generate fewer images"
                >
                  <Minus size={13} />
                </button>
                <input
                  className="studio2-number-clean"
                  aria-label="Images to generate"
                  type="text"
                  inputMode="numeric"
                  value={generateBatchCount}
                  onChange={(event) => {
                    const parsed = Number(event.target.value.replace(/\D/g, ""));
                    setGenerateBatchCount(Number.isFinite(parsed) ? clamp(Math.round(parsed), 1, MAX_GENERATE_BATCH_COUNT) : 1);
                  }}
                  style={{
                    width: 28,
                    border: "none",
                    outline: "none",
                    background: "transparent",
                    color: ADS_BRAND.text,
                    fontFamily: "inherit",
                    fontSize: 12,
                    fontWeight: 900,
                    textAlign: "center",
                  }}
                />
                <span style={{ color: ADS_BRAND.text3, fontSize: 11, fontWeight: 800 }}>x</span>
                <button
                  type="button"
                  onClick={() => setGenerateBatchCount((count) => clamp(count + 1, 1, MAX_GENERATE_BATCH_COUNT))}
                  disabled={generateBatchCount >= MAX_GENERATE_BATCH_COUNT}
                  style={{
                    width: 22,
                    height: 22,
                    border: "none",
                    borderRadius: "50%",
                    background: "transparent",
                    color: generateBatchCount >= MAX_GENERATE_BATCH_COUNT ? ADS_BRAND.text4 : ADS_BRAND.text2,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: generateBatchCount >= MAX_GENERATE_BATCH_COUNT ? "not-allowed" : "pointer",
                  }}
                  aria-label="Generate more images"
                >
                  <Plus size={13} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => void startAiGeneration()}
                disabled={!canGenerate}
                style={{
                  width: 36,
                  height: 36,
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
                title={generatingAd ? "Generate another run" : "Generate"}
              >
                <ArrowLeft size={18} style={{ transform: "rotate(90deg)" }} />
              </button>
            </div>
          </div>
        </section>

        {generateGalleryOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              onPointerDown={startGenerateDividerDrag}
              style={{
                position: "relative",
                width: 10,
                flexShrink: 0,
                cursor: "col-resize",
                background: ADS_BRAND.bg,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  bottom: 0,
                  left: "50%",
                  width: 1,
                  transform: "translateX(-50%)",
                  background: ADS_BRAND.border,
                }}
              />
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
              <div
                style={{
                  minHeight: 40,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {selectedGalleryCount > 0 ? (
                  <>
                    <div style={{ color: ADS_BRAND.text2, fontSize: 12, fontWeight: 850 }}>
                      {selectedGalleryCount} selected
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        disabled={!selectedGalleryReadyCount}
                        onClick={addSelectedGenerationsToEditor}
                        style={{ ...buttonStyle(false), height: 32, padding: "0 9px", opacity: selectedGalleryReadyCount ? 1 : 0.45 }}
                      >
                        <FilePlus2 size={13} /> Use
                      </button>
                      <button
                        type="button"
                        disabled={!selectedGalleryReadyCount}
                        onClick={() => void downloadGalleryAssets(selectedGenerationAssets)}
                        style={{ ...buttonStyle(false), height: 32, padding: "0 9px", opacity: selectedGalleryReadyCount ? 1 : 0.45 }}
                      >
                        <Download size={13} /> Download
                      </button>
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          disabled={!selectedGalleryReadyCount}
                          onClick={() => {
                            setGalleryFolderMenuOpen((open) => !open);
                            setGalleryProjectMenuOpen(false);
                          }}
                          style={{ ...buttonStyle(false), height: 32, padding: "0 9px", opacity: selectedGalleryReadyCount ? 1 : 0.45 }}
                        >
                          <FolderPlus size={13} /> Folder
                        </button>
                        {galleryFolderMenuOpen && (
                          <div
                            className="studio2-create-menu"
                            style={{ ...cardMenuStyle, right: 0, top: 38, width: 220, maxHeight: 260, overflowY: "auto" }}
                          >
                            <HomeMenuButton
                              icon={Library}
                              label="All Media"
                              onClick={() => {
                                setGalleryFolderMenuOpen(false);
                                void moveSelectedGenerationsToFolder(null);
                              }}
                            />
                            {mediaFolders.map((folder) => (
                              <HomeMenuButton
                                key={folder.id}
                                icon={Folder}
                                label={`${folder.parentId ? "- " : ""}${folder.name}`}
                                onClick={() => {
                                  setGalleryFolderMenuOpen(false);
                                  void moveSelectedGenerationsToFolder(folder.id);
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                      {cloudProjects.filter((project) => project.id !== projectId).length > 0 && (
                        <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={() => {
                              setGalleryProjectMenuOpen((open) => !open);
                              setGalleryFolderMenuOpen(false);
                            }}
                            style={{ ...buttonStyle(false), height: 32, padding: "0 9px" }}
                          >
                            <FilePlus2 size={13} /> Project
                          </button>
                          {galleryProjectMenuOpen && (
                            <div
                              className="studio2-create-menu"
                              style={{ ...cardMenuStyle, right: 0, top: 38, width: 240, maxHeight: 260, overflowY: "auto" }}
                            >
                              {cloudProjects.filter((project) => project.id !== projectId).map((project) => (
                                <HomeMenuButton
                                  key={project.id}
                                  icon={Palette}
                                  label={project.name || "Untitled design"}
                                  onClick={() => {
                                    setGalleryProjectMenuOpen(false);
                                    void moveSelectedGenerationsToProject(project.id);
                                  }}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void deleteSelectedGenerations()}
                        style={{ ...buttonStyle(false), height: 32, padding: "0 9px", color: "#ff9b9b", borderColor: "rgba(255,155,155,0.28)" }}
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedGenerationIds([])}
                        style={{ ...buttonStyle(false), height: 32, width: 32, padding: 0 }}
                        aria-label="Clear gallery selection"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div />
                  </>
                )}
              </div>
              {aiGenerations.length ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                  {aiGenerations.map((generation) => {
                    const asset = getGenerationAsset(generation);
                    const ready = !!asset;
                    const generationKey = String(generation.id || generation.jobId);
                    const isSelected = selectedGenerationIds.includes(generationKey);
                    return (
                      <button
                        key={generationKey}
                        type="button"
                        onClick={() => {
                          if (selectedGalleryCount > 0 || !asset) {
                            toggleGenerationSelection(generationKey);
                            return;
                          }
                          setGeneratedPreview({ generation, asset });
                        }}
                        style={{
                          position: "relative",
                          border: `1px solid ${isSelected ? ADS_BRAND.gold : ADS_BRAND.border2}`,
                          boxShadow: isSelected ? "0 0 0 2px rgba(212,178,122,0.14)" : "none",
                          borderRadius: 10,
                          overflow: "hidden",
                          background: ADS_BRAND.panel3,
                          padding: 0,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        title={asset ? "Open preview" : generation.status}
                      >
                        <span
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleGenerationSelection(generationKey);
                          }}
                          style={{
                            position: "absolute",
                            zIndex: 2,
                            left: 9,
                            top: 9,
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            border: `1px solid ${isSelected ? ADS_BRAND.gold : "var(--studio-chip-border)"}`,
                            background: isSelected ? ADS_BRAND.gold : "var(--studio-chip-bg)",
                            color: isSelected ? ADS_BRAND.bg : ADS_BRAND.text2,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {isSelected && <CheckCircle2 size={14} />}
                        </span>
                        {asset ? (
                          <img src={getMediaPreviewSrc(asset.url)} alt="" style={{ width: "100%", aspectRatio: "9 / 16", objectFit: "cover", display: "block" }} />
                        ) : (
                          <div style={{ aspectRatio: "9 / 16", display: "flex", flexDirection: "column", gap: 9, alignItems: "center", justifyContent: "center", color: generation.status === "failed" ? "#ff9b9b" : ADS_BRAND.text3 }}>
                            {generation.status === "failed" ? (
                              <X size={23} />
                            ) : (
                              <LoaderCircle size={23} color={ADS_BRAND.gold} style={{ animation: "spin 1s linear infinite" }} />
                            )}
                            <span style={{ fontSize: 11, fontWeight: 850, textTransform: "uppercase" }}>
                              {generation.status === "failed" ? "Failed" : "Creating"}
                            </span>
                          </div>
                        )}
                        {!ready && (
                          <span
                            style={{
                              position: "absolute",
                              left: 9,
                              bottom: 9,
                              borderRadius: 999,
                              background: "rgba(0,0,0,0.72)",
                              color: ADS_BRAND.gold,
                              fontSize: 10,
                              fontWeight: 900,
                              padding: "4px 8px",
                              textTransform: "uppercase",
                            }}
                          >
                            {formatGenerationStatusLabel(generation.status || "queued")}
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
          </>
        )}
        </div>
        {generateMediaPickerOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose media reference"
            onClick={closeMediaLibraryPicker}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 80,
              background: "rgba(0,0,0,0.58)",
              backdropFilter: "blur(10px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "min(980px, 94vw)",
                maxHeight: "min(760px, 88vh)",
                border: `1px solid ${ADS_BRAND.border2}`,
                borderRadius: 18,
                background: ADS_BRAND.panel,
                boxShadow: "0 28px 90px rgba(0,0,0,0.58)",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div style={{ height: 58, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${ADS_BRAND.border}` }}>
                <Library size={18} color={ADS_BRAND.gold} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 900 }}>Media Library</div>
                  <div style={{ color: ADS_BRAND.text3, fontSize: 11, fontWeight: 750, marginTop: 2 }}>
                    {generateFolderTrail.length ? generateFolderTrail.map((folder) => folder.name).join(" / ") : "All Media"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeMediaLibraryPicker}
                  style={{ ...buttonStyle(false), width: 34, height: 34, padding: 0, justifyContent: "center" }}
                  aria-label="Close media library"
                >
                  <X size={15} />
                </button>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${ADS_BRAND.border}` }}>
                <button
                  type="button"
                  onClick={() => setGenerateMediaPickerFolderId(currentGenerateMediaFolder?.parentId || null)}
                  disabled={!currentGenerateMediaFolder}
                  style={{ ...buttonStyle(false), height: 32, opacity: currentGenerateMediaFolder ? 1 : 0.45, cursor: currentGenerateMediaFolder ? "pointer" : "default" }}
                >
                  <ArrowLeft size={13} /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setGenerateMediaPickerFolderId(null)}
                  style={{ ...buttonStyle(!currentGenerateMediaFolder), height: 32 }}
                >
                  All Media
                </button>
                {generateFolderTrail.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => setGenerateMediaPickerFolderId(folder.id)}
                    style={{ ...buttonStyle(folder.id === generateMediaPickerFolderId), height: 32, maxWidth: 180 }}
                    title={folder.name}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                  </button>
                ))}
              </div>

              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18 }}>
                {visibleGenerateMediaFolders.length > 0 && (
                  <>
                    <div style={{ color: ADS_BRAND.text, fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Folders</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10, marginBottom: 22 }}>
                      {visibleGenerateMediaFolders.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          onClick={() => setGenerateMediaPickerFolderId(folder.id)}
                          style={{
                            border: `1px solid ${ADS_BRAND.border2}`,
                            borderRadius: 12,
                            background: ADS_BRAND.panel2,
                            color: ADS_BRAND.text,
                            minHeight: 118,
                            padding: 12,
                            display: "grid",
                            alignContent: "center",
                            justifyItems: "center",
                            gap: 10,
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontWeight: 850,
                          }}
                        >
                          <Folder size={26} style={{ color: ADS_BRAND.text3 }} />
                          <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                <div style={{ color: ADS_BRAND.text, fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Media</div>
                {visibleGenerateMediaAssets.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                    {visibleGenerateMediaAssets.map((asset) => {
                      const isUsableReference = mediaPickerMode !== "generate-reference" || asset.kind === "image";
                      const selectedForNewAd = mediaPickerMode === "new-ad" && newAdMediaAssets.some((item) => item.id === asset.id || item.url === asset.url);
                      return (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => {
                            if (isUsableReference) void handleMediaPickerAsset(asset);
                          }}
                          style={{
                            border: `1px solid ${selectedForNewAd ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                            borderRadius: 12,
                            background: selectedForNewAd ? ADS_BRAND.goldSoft : ADS_BRAND.panel2,
                            padding: 0,
                            overflow: "hidden",
                            cursor: isUsableReference ? "pointer" : "not-allowed",
                            opacity: isUsableReference ? 1 : 0.58,
                            textAlign: "left",
                            fontFamily: "inherit",
                          }}
                          title={isUsableReference ? "Use this media" : "Video references are not supported yet"}
                        >
                          <div style={{ width: "100%", aspectRatio: "1 / 1", background: ADS_BRAND.bgDeep, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                            <MediaAssetPreview asset={asset} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                            {selectedForNewAd && (
                              <span
                                style={{
                                  position: "absolute",
                                  top: 8,
                                  right: 8,
                                  width: 22,
                                  height: 22,
                                  borderRadius: "50%",
                                  background: ADS_BRAND.gold,
                                  color: "#111",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 12,
                                  fontWeight: 950,
                                }}
                              >
                                <Check size={14} />
                              </span>
                            )}
                          </div>
                          <div style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 7 }}>
                            {asset.kind === "video" ? <Video size={13} style={{ color: ADS_BRAND.text3 }} /> : <ImagePlus size={13} style={{ color: ADS_BRAND.text3 }} />}
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ADS_BRAND.text2, fontSize: 12, fontWeight: 800 }}>
                              {asset.filename || "Media"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div
                    style={{
                      minHeight: 220,
                      border: `1px dashed ${ADS_BRAND.border2}`,
                      borderRadius: 14,
                      color: ADS_BRAND.text3,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 13,
                    }}
                  >
                    No media in this folder.
                  </div>
                )}
              </div>
              {mediaPickerMode === "new-ad" && (
                <div style={{ minHeight: 58, borderTop: `1px solid ${ADS_BRAND.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ color: ADS_BRAND.text3, fontSize: 12, fontWeight: 800 }}>
                    {newAdMediaAssets.length ? `${newAdMediaAssets.length} selected` : "Select one or more media items."}
                  </div>
                  <button
                    type="button"
                    onClick={closeMediaLibraryPicker}
                    style={{ ...buttonStyle(true), height: 36, opacity: newAdMediaAssets.length ? 1 : 0.55 }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  if (view === "home") {
    return (
      <div
        className="ad-studio-fullbleed"
        onDragEnter={handleHomeLibraryDragOver}
        onDragOver={handleHomeLibraryDragOver}
        onDragLeave={handleHomeLibraryDragLeave}
        onDrop={(event) => {
          void handleHomeLibraryDrop(event);
        }}
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
            background: var(--studio-chip-bg-hover);
            color: ${ADS_BRAND.text};
          }
          .studio2-folder-choice:hover {
            background: ${ADS_BRAND.panel2} !important;
          }
        `}</style>
        {homeLibraryDropActive && homeMode === "media" && (
          <div
            style={{
              position: "fixed",
              inset: 12,
              zIndex: 70,
              pointerEvents: "none",
              border: `2px dashed ${ADS_BRAND.gold}`,
              borderRadius: 18,
              background: "rgba(212,178,122,0.08)",
              backdropFilter: "blur(5px)",
              boxShadow: "0 0 0 999px rgba(0,0,0,0.32)",
            }}
          />
        )}

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
                  color: ADS_BRAND.inkOnGold,
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
                {(!selectedFolder || visibleDesignFolders.length > 0) && <HomeSectionTitle title="Folders" />}
                {(!selectedFolder || visibleDesignFolders.length > 0) && (
                  <div style={homeGridStyle}>
                    {!selectedFolder && <div
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
                    </div>}
                    {visibleDesignFolders.map((folder) => {
                      const isSelected = selectedFolderIds.includes(folder.id);
                      const isDropTarget = dragOverFolderId === folder.id && (draggedDesignIds.length > 0 || draggedDesignFolderIds.some((id) => id !== folder.id));
                      return (
                        <div
                          key={folder.id}
                          role="button"
                          tabIndex={0}
                          className="studio2-design-card"
                          draggable={selectMode && isSelected}
                          onDragStart={(event) => {
                            if (!selectMode || !isSelected) {
                              event.preventDefault();
                              return;
                            }
                            const ids = selectedFolderIds.includes(folder.id) ? selectedFolderIds : [folder.id];
                            if (!ids.length) {
                              event.preventDefault();
                              return;
                            }
                            setDraggedDesignFolderIds(ids);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", ids.join(","));
                            setStudioCardDragImage(event);
                          }}
                          onDragEnd={() => {
                            setDraggedDesignFolderIds([]);
                            setDragOverFolderId(null);
                          }}
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
                            if (!draggedDesignIds.length && !draggedDesignFolderIds.some((id) => id !== folder.id)) return;
                            event.preventDefault();
                            setDragOverFolderId(folder.id);
                          }}
                          onDragOver={(event) => {
                            if (!draggedDesignIds.length && !draggedDesignFolderIds.some((id) => id !== folder.id)) return;
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
                            if (!draggedDesignIds.length && !draggedDesignFolderIds.some((id) => id !== folder.id)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (draggedDesignFolderIds.some((id) => id !== folder.id)) {
                              void moveFoldersToParent(folder.id, draggedDesignFolderIds, "design");
                            } else {
                              void moveDesignsToFolder(folder.id, draggedDesignIds);
                            }
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
                              {selectedFolderIds.filter((id) => id !== folder.id).length > 0 && (
                                <HomeMenuButton
                                  icon={FolderPlus}
                                  label={`Nest ${selectedFolderIds.filter((id) => id !== folder.id).length} folder${selectedFolderIds.filter((id) => id !== folder.id).length === 1 ? "" : "s"} here`}
                                  onClick={() => {
                                    setFolderCardMenuId(null);
                                    void moveFoldersToParent(folder.id, selectedFolderIds, "design");
                                  }}
                                />
                              )}
                              <HomeMenuButton
                                icon={EyeOff}
                                label="Hide"
                                onClick={() => hideDesignFolder(folder.id)}
                              />
                              <HomeMenuButton
                                icon={Pencil}
                                label="Rename"
                                onClick={() => openRenameFolderModal(folder)}
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
                            <MediaAssetPreview
                              asset={{
                                url: project.thumb,
                                thumbnailUrl: getMediaPreviewUrl(getAssetForUrl(project.thumb)),
                                filename: project.name,
                                kind: getAssetForUrl(project.thumb)?.kind || (looksLikeVideoUrl(project.thumb) ? "video" : "image"),
                              }}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
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
                      const isDropTarget = dragOverFolderId === folder.id && (draggedMediaIds.length > 0 || draggedMediaFolderIds.some((id) => id !== folder.id));
                      return (
                        <div
                          key={folder.id}
                          role="button"
                          tabIndex={0}
                          className="studio2-design-card"
                          draggable={selectMode && isSelected}
                          onDragStart={(event) => {
                            if (!selectMode || !isSelected) {
                              event.preventDefault();
                              return;
                            }
                            const ids = selectedMediaFolderIds.includes(folder.id) ? selectedMediaFolderIds : [folder.id];
                            setDraggedMediaFolderIds(ids);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", ids.join(","));
                            setStudioCardDragImage(event);
                          }}
                          onDragEnd={() => {
                            setDraggedMediaFolderIds([]);
                            setDragOverFolderId(null);
                          }}
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
                            if (!draggedMediaIds.length && !draggedMediaFolderIds.some((id) => id !== folder.id)) return;
                            event.preventDefault();
                            setDragOverFolderId(folder.id);
                          }}
                          onDragOver={(event) => {
                            if (!draggedMediaIds.length && !draggedMediaFolderIds.some((id) => id !== folder.id)) return;
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
                            if (!draggedMediaIds.length && !draggedMediaFolderIds.some((id) => id !== folder.id)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            if (draggedMediaFolderIds.some((id) => id !== folder.id)) {
                              void moveFoldersToParent(folder.id, draggedMediaFolderIds, "media");
                            } else {
                              void moveMediaToFolder(folder.id, draggedMediaIds);
                            }
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
                            {selectedMediaFolderIds.filter((id) => id !== folder.id).length > 0 && (
                              <HomeMenuButton
                                icon={FolderPlus}
                                label={`Nest ${selectedMediaFolderIds.filter((id) => id !== folder.id).length} folder${selectedMediaFolderIds.filter((id) => id !== folder.id).length === 1 ? "" : "s"} here`}
                                onClick={() => {
                                  setFolderCardMenuId(null);
                                  void moveFoldersToParent(folder.id, selectedMediaFolderIds, "media");
                                }}
                              />
                            )}
                            <HomeMenuButton
                              icon={Pencil}
                              label="Rename"
                              onClick={() => openRenameFolderModal(folder)}
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
                      <div
                        style={{
                          minHeight: 230,
                          background: ADS_BRAND.bgDeep,
                          borderRadius: "12px 12px 0 0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "relative",
                          overflow: "hidden",
                        }}
                      >
                        <MediaAssetPreview asset={asset} style={{ width: "100%", height: "100%", maxHeight: 320, objectFit: "contain" }} />
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
                <MediaAssetPreview
                  asset={previewMedia}
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
            onClick={() => {
              if (uploadingQueuedMedia) cancelQueuedUpload();
              setUploadModalOpen(false);
            }}
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
                        onClick={() => removeQueuedUploadFile(index)}
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
                    if (uploadingQueuedMedia) cancelQueuedUpload();
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
        {renameFolderTarget && (
          <div
            onClick={() => setRenameFolderTarget(null)}
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
              <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 800, marginBottom: 12 }}>Rename folder</div>
              <input
                value={renameFolderName}
                onChange={(event) => setRenameFolderName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveFolderRename();
                }}
                style={{ ...inputStyle, height: 40, marginBottom: 12 }}
                autoFocus
              />
              {renameFolderStatus && <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginBottom: 12 }}>{renameFolderStatus}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={() => setRenameFolderTarget(null)} style={buttonStyle(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveFolderRename()}
                  disabled={!renameFolderName.trim()}
                  style={{ ...buttonStyle(true), opacity: renameFolderName.trim() ? 1 : 0.45 }}
                >
                  Save
                </button>
              </div>
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
                    This deletes <strong style={{ color: ADS_BRAND.text2 }}>{deleteFolders[0]?.name}</strong>. Its contents will move up one level.
                  </>
                ) : (
                  <>This deletes {deleteFolderIds.length} folders. Their contents will move up one level.</>
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
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 700 }}>
                  {setupMediaFolder ? setupMediaFolder.name : "All Media"}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {!setupMediaFolderId && aiGeneratedFolder && (
                    <button
                      type="button"
                      onClick={() => setIncludeAiGeneratedMedia((value) => !value)}
                      style={{
                        border: `1px solid ${includeAiGeneratedMedia ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                        borderRadius: 7,
                        background: includeAiGeneratedMedia ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                        color: includeAiGeneratedMedia ? ADS_BRAND.gold : ADS_BRAND.text3,
                        height: 26,
                        padding: "0 8px",
                        fontFamily: "inherit",
                        fontSize: 11,
                        fontWeight: 800,
                        cursor: "pointer",
                      }}
                    >
                      Include AI
                    </button>
                  )}
                  <div
                    style={{
                      display: "inline-flex",
                      gap: 2,
                      padding: 3,
                      borderRadius: 8,
                      border: `1px solid ${ADS_BRAND.border2}`,
                      background: ADS_BRAND.panel3,
                    }}
                  >
                    {([
                      ["all", "All"],
                      ["image", "Images"],
                      ["video", "Videos"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSetupMediaKindFilter(value)}
                        style={{
                          border: "none",
                          borderRadius: 6,
                          background: setupMediaKindFilter === value ? ADS_BRAND.active : "transparent",
                          color: setupMediaKindFilter === value ? ADS_BRAND.text : ADS_BRAND.text3,
                          height: 26,
                          padding: "0 8px",
                          fontFamily: "inherit",
                          fontSize: 11,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label="Expand media to full screen"
                    title="Expand to full screen"
                    onClick={() => setSetupMediaExpanded(true)}
                    style={{
                      border: `1px solid ${ADS_BRAND.border2}`,
                      borderRadius: 7,
                      background: ADS_BRAND.panel3,
                      color: ADS_BRAND.text2,
                      height: 26,
                      width: 30,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                    }}
                  >
                    <Maximize2 size={13} />
                  </button>
                </div>
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
                    {setupMediaAssets.map((asset, index) =>
                      renderSetupMediaTile(asset, `inline-${asset.id}-${index}`)
                    )}
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
            {selectedMediaCount > 1 && (
              <div style={{ marginTop: 4, color: ADS_BRAND.text3, fontSize: 11.5 }}>
                The number on each picked item is its order in the batch. Drag any selected item onto another to reorder.
              </div>
            )}
          </div>

          <div className="glass-static" style={{ padding: 22 }}>
            <h2 className="section-title" style={{ marginBottom: 16 }}>
              <Type size={16} /> Copy
            </h2>
            <label style={labelStyle}>Batch Name</label>
            <input value={projectName} onChange={(e) => setProjectName(e.target.value)} style={{ ...inputStyle, margin: "6px 0 14px" }} />
            <div onClick={(event) => event.stopPropagation()} style={{ position: "relative", marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setTextBackgroundMenuOpen((open) => !open)}
                style={{
                  ...buttonStyle(textBackgroundsEnabled),
                  width: "100%",
                  height: 38,
                  justifyContent: "space-between",
                  background: textBackgroundsEnabled ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                  color: textBackgroundsEnabled ? ADS_BRAND.gold : ADS_BRAND.text2,
                  border: `1px solid ${textBackgroundsEnabled ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                  <SwatchBook size={14} /> Text Backgrounds: {textBackgroundsEnabled ? (colorPreset === "light" ? "Black on White" : "White on Black") : "Off"}
                </span>
                <ChevronDown size={14} />
              </button>
              {textBackgroundMenuOpen && (
                <div className="studio2-create-menu" style={{ ...cardMenuStyle, top: 44, left: 0, right: 0, width: "auto" }}>
                  <HomeMenuButton
                    icon={X}
                    label="Off"
                    onClick={() => {
                      setTextBackgroundsEnabled(false);
                      setTextBackgroundMenuOpen(false);
                    }}
                  />
                  <HomeMenuButton
                    icon={SwatchBook}
                    label="White on Black"
                    onClick={() => {
                      setTextBackgroundsEnabled(true);
                      setColorPreset("dark");
                      setTextBackgroundMenuOpen(false);
                    }}
                  />
                  <HomeMenuButton
                    icon={SwatchBook}
                    label="Black on White"
                    onClick={() => {
                      setTextBackgroundsEnabled(true);
                      setColorPreset("light");
                      setTextBackgroundMenuOpen(false);
                    }}
                  />
                </div>
              )}
            </div>
            <div style={{ position: "relative", marginBottom: 12 }}>
              <button
                type="button"
                onClick={() => setSetupFontMenuOpen((open) => !open)}
                style={{ ...buttonStyle(false), width: "100%", height: 38, justifyContent: "space-between" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, overflow: "hidden" }}>
                  <Type size={14} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Font: {FONT_OPTIONS.find((font) => font.value === fontPreset)?.label || "Font"}
                  </span>
                </span>
                <ChevronDown size={14} />
              </button>
              {setupFontMenuOpen && (
                <div className="studio2-create-menu" style={{ ...cardMenuStyle, top: 44, left: 0, right: 0, maxHeight: 260, overflowY: "auto" }}>
                  {FONT_OPTIONS.map((font) => (
                    <HomeMenuButton
                      key={font.value}
                      icon={Type}
                      label={font.label}
                      onClick={() => {
                        setFontPreset(font.value);
                        setSetupFontMenuOpen(false);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
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
            <div
              style={{
                marginTop: 14,
                border: `1px solid ${ADS_BRAND.border2}`,
                borderRadius: 10,
                background: ADS_BRAND.panel3,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                onClick={() => {
                  setCopyLabOpen((open) => !open);
                  if (!copyLabOpen && !copyLabWinners.length) void loadCopyLabWinners();
                }}
                style={{
                  width: "100%",
                  height: 44,
                  border: "none",
                  background: "transparent",
                  color: ADS_BRAND.text2,
                  fontFamily: "inherit",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 12px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 850,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Wand2 size={15} /> Copy Lab
                </span>
                <ChevronDown size={15} style={{ transform: copyLabOpen ? "rotate(180deg)" : "none", transition: "transform 120ms ease" }} />
              </button>
	              {copyLabOpen && (
	                <div style={{ borderTop: `1px solid ${ADS_BRAND.border}`, padding: 16, display: "grid", gap: 14 }}>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => void loadCopyLabWinners()} style={{ ...buttonStyle(false), height: 34 }}>
                      <RefreshCw size={13} /> Load winning ads
                    </button>
                    <button
                      type="button"
                      onClick={saveCopyLabPreset}
                      style={{ ...buttonStyle(false), height: 34 }}
                    >
                      <Bookmark size={13} /> Save as prompt
                    </button>
                  </div>
                  {copyLabPresets.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {copyLabPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setCopyLabDirection((prev) => [prev.trim(), preset.prompt].filter(Boolean).join("\n"))}
                          style={{ ...buttonStyle(false), height: 28, padding: "0 8px", fontSize: 11 }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  )}
	                  <div style={{ display: "grid", gridTemplateColumns: "104px minmax(0, 1fr)", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={labelStyle}>Variations</span>
                      <input
                        value={copyLabVariationCount}
                        inputMode="numeric"
                        onChange={(event) => setCopyLabVariationCount(clamp(parseInt(event.target.value.replace(/\D/g, ""), 10) || 1, 1, 60))}
                        style={{ ...inputStyle, height: 38 }}
                      />
                    </label>
                    <label style={{ display: "grid", gap: 6 }}>
                      <span style={labelStyle}>Prompt notes</span>
                      <textarea
                        value={copyLabDirection}
                        onChange={(event) => setCopyLabDirection(event.target.value)}
                        placeholder="Example: make close variations, keep the same offer, sharpen the pain point"
                        style={{ ...inputStyle, minHeight: 74, resize: "vertical", lineHeight: 1.4 }}
                      />
                    </label>
                  </div>
	                  <div style={{ maxHeight: 420, overflowY: "auto", display: "grid", gap: 11, paddingRight: 4 }}>
                    {copyLabWinners.map((winner) => (
                      <div
                        key={winner.id}
                        style={{
                          border: `1px solid ${ADS_BRAND.border2}`,
                          borderRadius: 10,
                          background: ADS_BRAND.bg,
	                          padding: 10,
	                          display: "grid",
	                          gridTemplateColumns: "88px minmax(0, 1fr)",
	                          gap: 12,
                        }}
                      >
                        <MediaAssetPreview
                          asset={{
                            url: winner.previewImageUrl,
                            thumbnailUrl: winner.previewThumbnailUrl || winner.previewImageUrl,
                            filename: winner.adName || winner.id,
                            kind: "image",
                          }}
	                          style={{ width: 88, height: 112, objectFit: "cover", borderRadius: 8, background: ADS_BRAND.bgDeep }}
	                        />
	                        <div style={{ minWidth: 0 }}>
	                          <div style={{ color: ADS_BRAND.text, fontSize: 13, fontWeight: 850, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
	                            {winner.adName || winner.campaignName || winner.id}
	                          </div>
	                          <div style={{ color: ADS_BRAND.gold, fontSize: 12, fontWeight: 850, marginTop: 3 }}>
	                            ${Math.round(winner.spend).toLocaleString()} spend · {winner.clientKey}
	                          </div>
	                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
                            {copyLabOfferTypes.map((offer) => (
                              <button
                                key={offer}
                                type="button"
                                onClick={() => updateCopyLabWinner(winner.id, { offerType: offer })}
                                style={{
                                  height: 24,
                                  border: `1px solid ${winner.offerType === offer ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                                  borderRadius: 999,
                                  background: winner.offerType === offer ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                                  color: winner.offerType === offer ? ADS_BRAND.gold : ADS_BRAND.text3,
                                  fontFamily: "inherit",
                                  fontSize: 10,
                                  fontWeight: 850,
	                                  padding: "0 6px",
	                                  cursor: "pointer",
	                                  whiteSpace: "nowrap",
	                                }}
                              >
                                {winner.offerType === offer && <CheckCircle2 size={10} style={{ marginRight: 4, verticalAlign: -1 }} />}
                                {offer}
                              </button>
                            ))}
                          </div>
	                          <div style={{ marginTop: 8, color: ADS_BRAND.text3, fontSize: 12, lineHeight: 1.45, maxHeight: 72, overflow: "auto", whiteSpace: "pre-wrap" }}>
                            {winner.extractedCopy || "No copy extracted yet."}
                          </div>
                          {winner.transcribing && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, color: ADS_BRAND.gold, fontSize: 11, fontWeight: 800, marginTop: 8 }}>
                              <LoaderCircle size={12} style={{ animation: "spin 1s linear infinite" }} /> Reading copy
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {!copyLabWinners.length && (
                      <div style={{ color: ADS_BRAND.text3, fontSize: 12, padding: "8px 2px" }}>
                        Load winners to pull top-spend Meta ads into this panel.
                      </div>
                    )}
                  </div>
                  {copyLabStatus && <div style={{ color: ADS_BRAND.text3, fontSize: 12 }}>{copyLabStatus}</div>}
                  <button
                    type="button"
                    onClick={() => void generateCopyLabVariations()}
                    disabled={copyLabGenerating}
                    style={{ ...buttonStyle(true), height: 38, justifyContent: "center" }}
                  >
                    {copyLabGenerating ? <LoaderCircle size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Wand2 size={14} />}
                    {copyLabGenerating ? "Writing..." : "Write variations into copy box"}
                  </button>
                </div>
              )}
            </div>
          </div>
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

        {setupMediaExpanded && (
          <div
            role="dialog"
            aria-modal
            onClick={() => setSetupMediaExpanded(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 1000,
              background: "rgba(0,0,0,0.78)",
              backdropFilter: "blur(4px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "2vh 2vw",
            }}
          >
            <style>{`
              .studio2-zoom-range {
                -webkit-appearance: none; appearance: none;
                height: 5px; width: 150px; border-radius: 999px; outline: none; cursor: pointer;
                background: ${ADS_BRAND.border};
              }
              .studio2-zoom-range::-webkit-slider-thumb {
                -webkit-appearance: none; appearance: none;
                width: 15px; height: 15px; border-radius: 999px;
                background: #fff; border: 3px solid ${ADS_BRAND.gold}; box-shadow: 0 2px 8px rgba(0,0,0,0.4);
              }
              .studio2-zoom-range::-moz-range-thumb {
                width: 15px; height: 15px; border-radius: 999px;
                background: #fff; border: 3px solid ${ADS_BRAND.gold};
              }
            `}</style>
            <div
              onClick={(event) => event.stopPropagation()}
              style={{
                width: "96vw",
                height: "92vh",
                display: "flex",
                flexDirection: "column",
                background: ADS_BRAND.panel,
                border: `1px solid ${ADS_BRAND.border2}`,
                borderRadius: 14,
                overflow: "hidden",
                boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 14,
                  padding: "14px 18px",
                  borderBottom: `1px solid ${ADS_BRAND.border2}`,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: ADS_BRAND.text, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <ImagePlus size={16} /> Select &amp; order media
                  </div>
                  <div style={{ fontSize: 12, color: ADS_BRAND.text3 }}>
                    {selectedMediaCount} selected - {plannedAdCount} ad{plannedAdCount === 1 ? "" : "s"} planned - drag a numbered item onto another to reorder
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div
                    style={{
                      display: "inline-flex",
                      gap: 2,
                      padding: 3,
                      borderRadius: 8,
                      border: `1px solid ${ADS_BRAND.border2}`,
                      background: ADS_BRAND.panel3,
                    }}
                  >
                    {([
                      ["all", "All"],
                      ["image", "Images"],
                      ["video", "Videos"],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSetupMediaKindFilter(value)}
                        style={{
                          border: "none",
                          borderRadius: 6,
                          background: setupMediaKindFilter === value ? ADS_BRAND.active : "transparent",
                          color: setupMediaKindFilter === value ? ADS_BRAND.text : ADS_BRAND.text3,
                          height: 28,
                          padding: "0 10px",
                          fontFamily: "inherit",
                          fontSize: 12,
                          fontWeight: 800,
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: ADS_BRAND.text3 }}>
                    <button
                      type="button"
                      aria-label="Smaller"
                      onClick={() => setSetupMediaZoom((value) => clamp(value - 20, 90, 360))}
                      style={{ border: "none", background: "transparent", color: ADS_BRAND.text2, cursor: "pointer", display: "inline-flex", padding: 2 }}
                    >
                      <ZoomOut size={16} />
                    </button>
                    <input
                      type="range"
                      className="studio2-zoom-range"
                      min={90}
                      max={360}
                      step={10}
                      value={setupMediaZoom}
                      onChange={(event) => setSetupMediaZoom(Number(event.target.value))}
                    />
                    <button
                      type="button"
                      aria-label="Bigger"
                      onClick={() => setSetupMediaZoom((value) => clamp(value + 20, 90, 360))}
                      style={{ border: "none", background: "transparent", color: ADS_BRAND.text2, cursor: "pointer", display: "inline-flex", padding: 2 }}
                    >
                      <ZoomIn size={16} />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSetupMediaExpanded(false)}
                    style={{
                      border: `1px solid ${ADS_BRAND.border2}`,
                      borderRadius: 8,
                      background: ADS_BRAND.panel3,
                      color: ADS_BRAND.text2,
                      height: 32,
                      padding: "0 12px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      fontFamily: "inherit",
                      fontSize: 12,
                      fontWeight: 800,
                      cursor: "pointer",
                    }}
                  >
                    <Minimize2 size={14} /> Close
                  </button>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 18, background: ADS_BRAND.bg }}>
                {setupMediaAssets.length > 0 ? (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: `repeat(auto-fill, minmax(${setupMediaZoom}px, 1fr))`,
                      gap: 12,
                      justifyContent: "start",
                    }}
                  >
                    {setupMediaAssets.map((asset, index) =>
                      renderSetupMediaTile(asset, `full-${asset.id}-${index}`)
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      height: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "column",
                      gap: 8,
                      color: ADS_BRAND.text3,
                      fontSize: 14,
                    }}
                  >
                    <Palette size={32} strokeWidth={1.7} />
                    No media uploaded yet
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const editingMetrics = editingBlock ? measureTextBlock(getMeasureCtx(), editingBlock) : null;
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
        .studio2-menu-row {
          width: 100%;
          min-height: 34px;
          border: none;
          border-radius: 7px;
          background: transparent;
          color: ${ADS_BRAND.text2};
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 9px;
          font: inherit;
          font-size: 12px;
          font-weight: 750;
          cursor: pointer;
          text-align: left;
        }
        .studio2-menu-row:hover {
          background: ${ADS_BRAND.active};
          color: ${ADS_BRAND.text};
        }
        .studio2-number-clean::-webkit-outer-spin-button,
        .studio2-number-clean::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
      `}</style>
      <input
        ref={replaceImageInputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: "none" }}
        onChange={(event) => {
          void handleEditorMediaUpload(event.target.files?.[0] ?? null);
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
        <div ref={topNavMenuRef} style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setTopNavMenuOpen((open) => !open)}
            style={{ ...buttonStyle(false), width: 36, height: 36, padding: 0 }}
            aria-label="Studio navigation"
          >
            <Menu size={16} />
          </button>
          {topNavMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: 42,
                left: 0,
                zIndex: 35,
                width: 240,
                border: `1px solid ${ADS_BRAND.border2}`,
                borderRadius: 10,
                background: ADS_BRAND.panel,
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
                padding: 7,
              }}
            >
              <button type="button" onClick={() => { setTopNavMenuOpen(false); setView("home"); }} className="studio2-menu-row">
                <Home size={14} /> Home
              </button>
              <button type="button" onClick={() => { setTopNavMenuOpen(false); setView("setup"); }} className="studio2-menu-row">
                <ArrowLeft size={14} /> Setup
              </button>
              <div style={{ height: 1, background: ADS_BRAND.border2, margin: "6px 2px" }} />
              <div style={{ color: ADS_BRAND.text3, fontSize: 12, fontWeight: 700, padding: "8px 9px" }}>
                Ad {currentIndex + 1} of {creatives.length} · {saveStatus || "Saved"}
              </div>
            </div>
          )}
        </div>
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
        <div style={{ flex: 1 }} />
        {editorSidebarMode !== "generate" && (
          <>
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
          </>
        )}
        <button
          type="button"
          aria-label="Undo"
          title="Undo"
          style={{
            width: 34,
            height: 34,
            border: "none",
            borderRadius: 6,
            background: "transparent",
            color: undoStack.length ? ADS_BRAND.text2 : ADS_BRAND.text4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: undoStack.length ? "pointer" : "not-allowed",
          }}
          onClick={undo}
          disabled={!undoStack.length}
        >
          <RotateCcw size={17} />
        </button>
        <button
          type="button"
          aria-label="Redo"
          title="Redo"
          style={{
            width: 34,
            height: 34,
            border: "none",
            borderRadius: 6,
            background: "transparent",
            color: redoStack.length ? ADS_BRAND.text2 : ADS_BRAND.text4,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: redoStack.length ? "pointer" : "not-allowed",
          }}
          onClick={redo}
          disabled={!redoStack.length}
        >
          <RotateCw size={17} />
        </button>
        {editorSidebarMode !== "generate" && (
          <button
            aria-pressed={!!currentCreative?.approved}
            style={approveButtonStyle(!!currentCreative?.approved)}
            onClick={toggleCurrentApproved}
          >
            <CheckCircle2 size={14} /> {currentCreative?.approved ? "Approved" : "Approve"}
          </button>
        )}
        <button style={buttonStyle(true)} onClick={openExportModal}>
          <Download size={14} /> Export
        </button>
      </div>

      {generateToast && editorSidebarMode !== "generate" && (
        <button
          type="button"
          onClick={() => {
            setGenerateToast(null);
            setGenerateGalleryOpen(true);
            setEditorSidebarMode("generate");
          }}
          style={{
            position: "fixed",
            top: 70,
            right: 18,
            zIndex: 52,
            minHeight: 42,
            borderRadius: 10,
            border: `1px solid ${ADS_BRAND.goldBorder}`,
            background: ADS_BRAND.panel,
            color: ADS_BRAND.text,
            boxShadow: "0 18px 54px rgba(0,0,0,0.42)",
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            padding: "0 13px",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 850,
            cursor: "pointer",
          }}
        >
          <ImagePlus size={15} color={ADS_BRAND.gold} />
          {generateToast.message}
        </button>
      )}

      {editorSidebarMode === "generate" ? renderGenerateWorkspace() : (
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div
          ref={canvasAreaRef}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            startGridMarqueeSelect(event);
          }}
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
            <div style={{ position: "absolute", top: 14, zIndex: 10, ...panelStyle, color: ADS_BRAND.text, fontSize: 12 }}>
              {exportStatus}
            </div>
          )}
          <div style={{
            position: "relative",
            width: CANVAS_W * viewScale,
            height: CANVAS_H * viewScale,
            boxShadow: "0 12px 34px rgba(0,0,0,0.24), 0 0 0 1px rgba(255,255,255,0.08)",
            background: ADS_BRAND.bgDeep,
          }}>
            {currentCreative?.mediaKind === "video" && (
              <>
                <video
                  key={currentCreative.id}
	                  ref={videoPreviewRef}
	                  src={getMediaPreviewSrc(currentCreative.photoUrl)}
	                  poster={getMediaPreviewUrl(getAssetForUrl(currentCreative.photoUrl)) || undefined}
	                  muted={currentCreative.videoMuted ?? true}
	                  autoPlay
	                  playsInline
	                  preload="auto"
	                  onLoadedMetadata={(event) => {
	                    const video = event.currentTarget;
	                    const duration = Number.isFinite(video.duration) ? video.duration : 0;
	                    setVideoPreviewDuration(duration);
	                    const start = getFirstVideoSegmentStart(currentCreative, duration);
	                    video.volume = clamp(currentCreative.videoVolume ?? 1, 0, 1);
	                    video.muted = currentCreative.videoMuted ?? true;
	                    const pendingSeek = videoPendingSeekRef.current;
	                    const targetTime = typeof pendingSeek === "number"
	                      ? clamp(pendingSeek, 0, duration || pendingSeek)
	                      : findVideoSegmentAtTime(getEnabledVideoSegments(currentCreative, duration), video.currentTime)
	                        ? video.currentTime
	                        : start;
	                    try {
	                      video.currentTime = targetTime;
	                    } catch {
	                      videoPendingSeekRef.current = targetTime;
	                    }
	                    setVideoPreviewTime(targetTime);
	                    window.requestAnimationFrame(() => renderPreview());
	                  }}
	                  onLoadedData={(event) => {
	                    setVideoPreviewPlaying(!event.currentTarget.paused);
	                    window.requestAnimationFrame(() => renderPreview());
	                    if (videoPreviewPlaying) void event.currentTarget.play().catch(() => undefined);
	                  }}
	                  onCanPlay={(event) => {
	                    const pendingSeek = videoPendingSeekRef.current;
	                    if (typeof pendingSeek === "number") {
	                      try {
	                        event.currentTarget.currentTime = pendingSeek;
	                        videoPendingSeekRef.current = null;
	                      } catch {
	                        // Keep it pending for the next ready event.
	                      }
	                    }
	                    window.requestAnimationFrame(() => renderPreview());
	                  }}
	                  onSeeked={(event) => {
	                    videoPendingSeekRef.current = null;
	                    setVideoPreviewTime(event.currentTarget.currentTime || 0);
	                    window.requestAnimationFrame(() => renderPreview());
	                  }}
	                  onTimeUpdate={(event) => {
	                    const video = event.currentTarget;
	                    const now = performance.now();
	                    const duration = video.duration || videoPreviewDuration;
	                    const segments = getEnabledVideoSegments(currentCreative, duration);
	                    const segment = findVideoSegmentAtTime(segments, video.currentTime);
	                    let jumped = false;
	                    if (!segment && segments[0]) {
	                      video.currentTime = segments[0].start;
	                      jumped = true;
	                    } else if (segment && video.currentTime >= (segment.end ?? duration) - 0.04) {
	                      const index = segments.findIndex((item) => item.id === segment.id);
	                      const next = segments[index + 1] || segments[0];
	                      video.currentTime = next?.start ?? 0;
	                      jumped = true;
	                      if (!video.paused) void video.play().catch(() => undefined);
	                    }
	                    if (jumped || now - videoTimeUpdateRef.current > 140) {
	                      videoTimeUpdateRef.current = now;
	                      setVideoPreviewTime(video.currentTime || 0);
	                      window.requestAnimationFrame(() => renderPreview());
	                    }
	                  }}
	                  onPlay={(event) => {
	                    const video = event.currentTarget;
	                    const duration = video.duration || videoPreviewDuration;
	                    const segments = getEnabledVideoSegments(currentCreative, duration);
	                    if (!findVideoSegmentAtTime(segments, video.currentTime)) {
	                      video.currentTime = segments[0]?.start ?? 0;
	                    }
	                    setVideoPreviewPlaying(true);
	                    window.requestAnimationFrame(() => renderPreview());
	                  }}
	                  onPause={() => {
	                    setVideoPreviewPlaying(false);
	                    window.requestAnimationFrame(() => renderPreview());
	                  }}
	                  onError={() => {
	                    setVideoPreviewPlaying(false);
	                    window.requestAnimationFrame(() => renderPreview());
	                  }}
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
                  height: Math.max(editingMetrics.h * viewScale, editingBlock.fontSize * viewScale * 2.1),
                  boxSizing: "border-box",
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
            {marqueeRect && (
              <div
                style={{
                  position: "absolute",
                  left: marqueeRect.x * viewScale,
                  top: marqueeRect.y * viewScale,
                  width: marqueeRect.w * viewScale,
                  height: marqueeRect.h * viewScale,
                  border: `1px solid ${ADS_BRAND.gold}`,
                  background: ADS_BRAND.goldSoft,
                  boxShadow: "0 0 0 1px rgba(212,178,122,0.18)",
                  pointerEvents: "none",
                  zIndex: 4,
                }}
              />
            )}
          </div>

          <div
            ref={stripRef}
            onWheel={(event) => {
              if (!stripRef.current) return;
              if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
              stripRef.current.scrollLeft += event.deltaY;
            }}
            style={{
              height: videoTimelineDockOpen ? 72 : 178,
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: 10,
              overflowX: "auto",
              overflowY: "visible",
              padding: videoTimelineDockOpen ? "8px 18px 4px" : "18px 22px",
              scrollBehavior: "smooth",
              borderTop: videoTimelineDockOpen ? `1px solid ${ADS_BRAND.border}` : "none",
              background: videoTimelineDockOpen ? ADS_BRAND.bg : "transparent",
            }}
          >
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
                onMouseEnter={() => setHoveredStripIndex(index)}
                onMouseLeave={() => setHoveredStripIndex(null)}
                style={{
                  position: "relative",
                  width: videoTimelineDockOpen ? (hoveredStripIndex === index ? 58 : 42) : (hoveredStripIndex === index ? 96 : 48),
                  height: videoTimelineDockOpen ? (hoveredStripIndex === index ? 58 : 52) : (hoveredStripIndex === index ? 164 : 84),
                  borderRadius: 6,
                  overflow: "hidden",
                  border: index === currentIndex ? `2px solid ${ADS_BRAND.gold}` : `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.bgDeep,
                  padding: 0,
                  cursor: "pointer",
                  flexShrink: 0,
                  transition: "width 140ms ease, height 140ms ease, transform 140ms ease",
                  transform: hoveredStripIndex === index ? (videoTimelineDockOpen ? "translateY(-3px)" : "translateY(-7px)") : "none",
                }}
                title={`Ad ${index + 1}`}
              >
                {creativeThumbs[creative.id] ? (
                  <img src={creativeThumbs[creative.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                ) : (
                  <MediaAssetPreview
                    asset={{
                      url: creative.photoUrl,
                      thumbnailUrl: getMediaPreviewUrl(getAssetForUrl(creative.photoUrl)),
                      filename: creative.photoUrl,
                      kind: creative.mediaKind || "image",
                    }}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                )}
                {(creative.mediaKind || "image") === "video" && (
                  <span style={mediaVideoBadgeStyle}>
                    <Video size={11} />
                  </span>
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
                {hoveredStripIndex === index && creatives.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteCreativeAt(index);
                    }}
                    style={{
                      position: "absolute",
                      top: 3,
                      right: 3,
                      width: 22,
                      height: 22,
                      borderRadius: 7,
                      background: "rgba(0,0,0,0.72)",
                      color: "#ffb3b3",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      border: "1px solid rgba(255,155,155,0.25)",
                    }}
                    title="Delete ad"
                  >
                    <X size={13} />
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={openNewAdModal}
              style={{
                width: 48,
                height: videoTimelineDockOpen ? 52 : 84,
                borderRadius: 6,
                border: `1px dashed ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel3,
                color: ADS_BRAND.text3,
                flexShrink: 0,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              title="Add ad"
            >
              <Plus size={17} />
            </button>
          </div>

          {videoTimelineDockOpen && currentCreative && (
            <div style={{
              width: "100%",
              height: 258,
              flexShrink: 0,
              borderTop: `1px solid ${ADS_BRAND.border}`,
              background: ADS_BRAND.bg,
              padding: "10px 18px 12px",
              boxShadow: "none",
            }}>
              <VideoTrimControls
                duration={videoPreviewDuration}
                segments={currentVideoTimelineSegments}
                currentTime={videoPreviewTime}
                zoom={videoTimelineZoom}
                playing={videoPreviewPlaying}
                muted={currentCreative.videoMuted ?? true}
                volume={currentCreative.videoVolume ?? 1}
                onStart={pushUndo}
                onSegmentsChange={updateVideoTimelineSegments}
                onPreviewTime={seekVideoPreview}
                onZoomChange={setVideoTimelineZoom}
                onSplit={splitVideoAtPlayhead}
                onTogglePlay={toggleVideoPlayback}
                onClose={() => setVideoTimelineOpen(false)}
                onUndo={undo}
                onRedo={redo}
                canUndo={undoStack.length > 0}
                canRedo={redoStack.length > 0}
                onMutedChange={(videoMuted) => updateVideoSettings({ videoMuted })}
                onVolumeChange={(videoVolume) => updateVideoSettings({ videoVolume })}
                onReset={() => {
                  pushUndo();
                  updateVideoSettings({
                    videoTrim: { start: 0, end: null },
                    videoTimeline: createDefaultVideoTimeline(),
                    videoMuted: true,
                    videoVolume: 1,
                  });
                  seekVideoPreview(0);
                }}
              />
            </div>
          )}
        </div>

        <aside style={{
          width: 326,
          flexShrink: 0,
          borderLeft: `1px solid ${ADS_BRAND.border}`,
          background: ADS_BRAND.bg,
          padding: 12,
          overflowY: "auto",
          display: videoTimelineDockOpen ? "none" : "flex",
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
            <button style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={addTextBlock}>
              <Plus size={13} /> Add Text
            </button>
          </div>

          {currentCreative && currentCreative.textBlocks.length > 0 && (
            <div style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={labelStyle}>Saved Styles</span>
                <button
                  type="button"
                  onClick={selectAllTextBlocks}
                  style={{ ...buttonStyle(false), padding: "5px 9px", gap: 5 }}
                  title="Select every text block on this ad"
                >
                  <SwatchBook size={13} /> Select all
                </button>
              </div>
              {textStylePresets.length > 0 ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {textStylePresets.map((preset) => (
                    <div key={preset.id} style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => applyTextStylePreset(preset)}
                        title="Apply to selected text (or all text if nothing is selected)"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 46,
                          height: 34,
                          padding: "0 12px",
                          borderRadius: preset.bgStyle === "marker" ? 17 : 9,
                          border: `1px solid ${ADS_BRAND.border2}`,
                          background: preset.bgOpacity > 0 ? preset.bgColor : ADS_BRAND.panel3,
                          color: preset.textColor,
                          fontSize: 15,
                          fontWeight: 900,
                          cursor: "pointer",
                          fontFamily: "Inter, system-ui, sans-serif",
                        }}
                      >
                        Aa
                      </button>
                      <button
                        type="button"
                        onClick={() => removeTextStylePreset(preset.id)}
                        title="Delete style"
                        style={{
                          position: "absolute",
                          top: -6,
                          right: -6,
                          width: 16,
                          height: 16,
                          borderRadius: 999,
                          border: `1px solid ${ADS_BRAND.border2}`,
                          background: ADS_BRAND.panel,
                          color: ADS_BRAND.text2,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        <X size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 11, color: ADS_BRAND.text3, lineHeight: 1.5 }}>
                  Style a text block (color + highlight), then tap “Save current style” to reuse it on any ad.
                </p>
              )}
              {(selectedBlock || selectedTextBlocks.length > 0) && (
                <button
                  type="button"
                  onClick={saveTextStylePreset}
                  style={{ ...buttonStyle(false), width: "100%", justifyContent: "center", height: 32, marginTop: 10, gap: 6 }}
                >
                  <Plus size={13} /> Save current style
                </button>
              )}
            </div>
          )}

          {multiSelectedTextBlocks && (
            <div style={panelStyle}>
              <span style={{ ...labelStyle, display: "block", marginBottom: 10 }}>Multi Select</span>
              <Control label="Align">
                <button style={{ ...buttonStyle(false), width: 38, height: 34, padding: 0 }} onClick={() => alignSelectedTextBlocks("left")} title="Align left">
                  <AlignLeft size={16} />
                </button>
                <button style={{ ...buttonStyle(false), width: 38, height: 34, padding: 0 }} onClick={() => alignSelectedTextBlocks("center")} title="Align center">
                  <AlignCenter size={16} />
                </button>
                <button style={{ ...buttonStyle(false), width: 38, height: 34, padding: 0 }} onClick={() => alignSelectedTextBlocks("right")} title="Align right">
                  <AlignRight size={16} />
                </button>
              </Control>
              <Control label="Text">
                <ColorPicker
                  value={selectedTextBlocks[0]?.textColor || "#ffffff"}
                  onStart={pushUndo}
                  onChange={(value) => updateSelectedTextBlocks({ textColor: normalizeHex(value, selectedTextBlocks[0]?.textColor || "#ffffff").toUpperCase() })}
                  ariaLabel="Text color"
                  palette={colorPalette}
                  onAddToPalette={addPaletteColor}
                  onRemoveFromPalette={removePaletteColor}
                />
              </Control>
              <Control label="Highlight">
                <ColorPicker
                  value={selectedTextBlocks[0]?.bgColor || "#000000"}
                  onStart={pushUndo}
                  onChange={(value) => updateSelectedTextBlocks({
                    bgColor: normalizeHex(value, selectedTextBlocks[0]?.bgColor || "#000000").toUpperCase(),
                    bgOpacity: selectedTextBlocks[0]?.bgOpacity && selectedTextBlocks[0].bgOpacity > 0 ? selectedTextBlocks[0].bgOpacity : 1,
                  })}
                  ariaLabel="Highlight color"
                  palette={colorPalette}
                  onAddToPalette={addPaletteColor}
                  onRemoveFromPalette={removePaletteColor}
                />
                <button
                  type="button"
                  onClick={() => {
                    pushUndo();
                    const nextOpacity = selectedTextBlocks.some((block) => block.bgOpacity > 0) ? 0 : 1;
                    updateSelectedTextBlocks({ bgOpacity: nextOpacity });
                  }}
                  style={{ ...buttonStyle(false), height: 32 }}
                >
                  {selectedTextBlocks.some((block) => block.bgOpacity > 0) ? "Off" : "On"}
                </button>
              </Control>
              <Control label="Style">
                <div style={{ display: "inline-flex", gap: 3, padding: 3, borderRadius: 8, border: `1px solid ${ADS_BRAND.border2}`, background: ADS_BRAND.panel3 }}>
                  {(["solid", "marker"] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      style={segmentedButtonStyle(selectedTextBlocks.every((block) => (block.bgStyle ?? "solid") === style))}
                      onClick={() => {
                        pushUndo();
                        updateSelectedTextBlocks({ bgStyle: style });
                      }}
                    >
                      {style === "solid" ? "Solid" : "Marker"}
                    </button>
                  ))}
                </div>
              </Control>
            </div>
          )}

          {selectedBlock && !multiSelectedTextBlocks && (
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
              {!selectedTextRange && (
                <p style={{ margin: "-4px 0 10px", fontSize: 11, color: ADS_BRAND.text3, lineHeight: 1.5 }}>
                  Tip: highlight a word above to recolor just that word.
                </p>
              )}
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
                      maxWidth: 86,
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
                  <ColorPicker
                    value={selectedTextColor}
                    onStart={pushUndo}
                    onChange={applySelectedTextColor}
                    ariaLabel="Selected word color"
                    palette={colorPalette}
                    onAddToPalette={addPaletteColor}
                    onRemoveFromPalette={removePaletteColor}
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
                <ColorPicker
                  value={selectedBlock.textColor}
                  onStart={pushUndo}
                  onChange={(value) => updateSelectedBlock({ textColor: normalizeHex(value, selectedBlock.textColor).toUpperCase() })}
                  ariaLabel="Text color"
                  palette={colorPalette}
                  onAddToPalette={addPaletteColor}
                  onRemoveFromPalette={removePaletteColor}
                />
              </Control>
              <Control label="Highlight">
                <ColorPicker
                  value={selectedBlock.bgColor}
                  onStart={pushUndo}
                  onChange={(value) => updateSelectedBlock({
                    bgColor: normalizeHex(value, selectedBlock.bgColor).toUpperCase(),
                    bgOpacity: selectedBlock.bgOpacity > 0 ? selectedBlock.bgOpacity : 1,
                  })}
                  ariaLabel="Highlight color"
                  palette={colorPalette}
                  onAddToPalette={addPaletteColor}
                  onRemoveFromPalette={removePaletteColor}
                />
                <button
                  type="button"
                  onClick={() => {
                    pushUndo();
                    updateSelectedBlock({ bgOpacity: selectedBlock.bgOpacity > 0 ? 0 : 1 });
                  }}
                  style={{ ...buttonStyle(false), height: 32 }}
                >
                  {selectedBlock.bgOpacity > 0 ? "Off" : "On"}
                </button>
              </Control>
              <Control label="Highlight style">
                <div style={{ display: "inline-flex", gap: 3, padding: 3, borderRadius: 8, border: `1px solid ${ADS_BRAND.border2}`, background: ADS_BRAND.panel3 }}>
                  {(["solid", "marker"] as const).map((style) => (
                    <button
                      key={style}
                      type="button"
                      style={segmentedButtonStyle((selectedBlock.bgStyle ?? "solid") === style)}
                      onClick={() => {
                        pushUndo();
                        updateSelectedBlock({ bgStyle: style });
                      }}
                    >
                      {style === "solid" ? "Solid" : "Marker"}
                    </button>
                  ))}
                </div>
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
                <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => setEditorFontMenuOpen((open) => !open)}
                    style={{ ...buttonStyle(false), width: "100%", height: 36, justifyContent: "space-between" }}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {FONT_OPTIONS.find((font) => font.value === selectedBlock.fontFamily)?.label || "Font"}
                    </span>
                    <ChevronDown size={14} />
                  </button>
                  {editorFontMenuOpen && (
                    <div className="studio2-create-menu" style={{ ...cardMenuStyle, top: 42, left: 0, right: 0, maxHeight: 240, overflowY: "auto" }}>
                      {FONT_OPTIONS.map((font) => (
                        <HomeMenuButton
                          key={font.value}
                          icon={Type}
                          label={font.label}
                          onClick={() => {
                            pushUndo();
                            updateSelectedBlock({ fontFamily: font.value });
                            setEditorFontMenuOpen(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </Control>
              {selectedBlock.fontFamily.includes("Source Serif") && (
                <Control label="Weight">
                  {[400, 600, 700, 900].map((weight) => (
                    <button
                      key={weight}
                      type="button"
                      onClick={() => {
                        pushUndo();
                        updateSelectedBlock({ fontWeight: weight });
                      }}
                      style={{ ...buttonStyle(selectedBlock.fontWeight === weight), height: 32, padding: "0 9px" }}
                    >
                      {weight}
                    </button>
                  ))}
                </Control>
              )}
              <Slider label="Size" min={14} max={150} value={selectedBlock.fontSize} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ fontSize: value })} />
              <Slider label="Width" min={220} max={1060} value={selectedBlock.maxWidth} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ maxWidth: value })} />
              <Slider label="Padding" min={0} max={70} value={selectedBlock.paddingH} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ paddingH: value, paddingV: Math.round(value * 0.58) })} />
              <Slider label="Radius" min={0} max={40} value={selectedBlock.borderRadius} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ borderRadius: value })} />
              <Slider label="Opacity" min={0} max={100} value={Math.round(selectedBlock.bgOpacity * 100)} onStart={pushUndo} onChange={(value) => updateSelectedBlock({ bgOpacity: value / 100 })} suffix="%" />
              <Control label="Position">
                <button
                  type="button"
                  aria-label="Center horizontally"
                  title="Center horizontally"
                  style={{ ...buttonStyle(false), width: 38, height: 34, padding: 0 }}
                  onClick={() => positionSelectedBlock("center-x")}
                >
                  <AlignHorizontalJustifyCenter size={16} />
                </button>
                <button
                  type="button"
                  aria-label="Center vertically"
                  title="Center vertically"
                  style={{ ...buttonStyle(false), width: 38, height: 34, padding: 0 }}
                  onClick={() => positionSelectedBlock("center-y")}
                >
                  <AlignVerticalJustifyCenter size={16} />
                </button>
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
              {currentCreative.mediaKind === "video" && !videoTimelineOpen && (
                <button
                  type="button"
                  style={{ ...buttonStyle(true), width: "100%", marginBottom: 10, justifyContent: "center" }}
                  onClick={() => setVideoTimelineOpen(true)}
                >
                  <PanelBottom size={13} /> Open Video Editor
                </button>
              )}
              <Slider label="Zoom" min={40} max={400} value={Math.round(currentCreative.imageTransform.scale * 100)} onStart={pushUndo} onChange={(value) => updateImage({ scale: value / 100 })} suffix="%" />
              <Slider label="Rotate" min={-180} max={180} value={currentCreative.imageTransform.rotate} onStart={pushUndo} onChange={(value) => updateImage({ rotate: value })} suffix="°" />
              <Control label="Offset">
                <input type="number" value={currentCreative.imageTransform.offsetX} onFocus={pushUndo} onChange={(e) => updateImage({ offsetX: parseInt(e.target.value) || 0 })} style={inputStyle} />
                <input type="number" value={currentCreative.imageTransform.offsetY} onFocus={pushUndo} onChange={(e) => updateImage({ offsetY: parseInt(e.target.value) || 0 })} style={inputStyle} />
              </Control>
              <button
                style={{ ...buttonStyle(false), width: "100%", marginTop: 8 }}
                onClick={() => setEditorMediaActionMode("replace-current")}
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

          {(selectedLayer || selectedTextBlockIds.length > 0) && (
          <div style={panelStyle}>
            <span style={{ ...labelStyle, display: "block", marginBottom: 8 }}>
              <Layers size={12} style={{ verticalAlign: -2, marginRight: 5 }} />
              Layers
            </span>
            <button
              style={{ ...buttonStyle(selectedLayer?.type === "image"), width: "100%", justifyContent: "flex-start", marginBottom: 5 }}
              onClick={() => {
                setSelectedLayer({ type: "image" });
                setSelectedTextBlockIds([]);
              }}
            >
              <ImagePlus size={13} /> Background Media
            </button>
            {currentCreative?.textBlocks.map((block) => (
              <button
                key={block.id}
                type="button"
                draggable
                onDragStart={(event) => {
                  setDraggedLayerBlockId(block.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", block.id);
                }}
                onDragOver={(event) => {
                  if (!draggedLayerBlockId || draggedLayerBlockId === block.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setLayerDropBlockId(block.id);
                }}
                onDragLeave={() => {
                  setLayerDropBlockId((current) => (current === block.id ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggedLayerBlockId || event.dataTransfer.getData("text/plain");
                  if (sourceId) moveTextLayerBefore(sourceId, block.id);
                }}
                onDragEnd={() => {
                  setDraggedLayerBlockId(null);
                  setLayerDropBlockId(null);
                }}
                onClick={() => {
                  setSelectedLayer({ type: "text", id: block.id });
                  setSelectedTextBlockIds([block.id]);
                }}
                style={{
                  ...buttonStyle(selectedLayer?.type === "text" && selectedLayer.id === block.id),
                  width: "100%",
                  justifyContent: "flex-start",
                  marginBottom: 5,
                  overflow: "hidden",
                  cursor: draggedLayerBlockId === block.id ? "grabbing" : "grab",
                  borderColor: layerDropBlockId === block.id ? ADS_BRAND.gold : undefined,
                  boxShadow: layerDropBlockId === block.id ? "inset 0 2px 0 rgba(212,178,122,0.9)" : undefined,
                }}
              >
                <Type size={13} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {block.lines[0] || "Empty text"}
                </span>
              </button>
            ))}
          </div>
          )}

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
          {contextMenu.target?.type === "multi-text" && (
            <>
              <MenuAction icon={AlignLeft} label="Align left" onClick={() => alignSelectedTextBlocks("left")} />
              <MenuAction icon={AlignCenter} label="Align center" onClick={() => alignSelectedTextBlocks("center")} />
              <MenuAction icon={AlignRight} label="Align right" onClick={() => alignSelectedTextBlocks("right")} />
              <MenuDivider />
              <MenuAction icon={Trash2} label={`Delete ${selectedTextBlocks.length} blocks`} shortcut="DEL" danger onClick={deleteSelectedTextBlocks} />
            </>
          )}
          {contextMenu.target?.type === "image" && (
            <>
              <MenuAction
                icon={Replace}
                label="Replace media"
                onClick={() => {
                  setContextMenu(null);
                  setEditorMediaActionMode("replace-current");
                }}
              />
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
      {editorMediaActionMode && (
        <div
          onClick={() => setEditorMediaActionMode(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.42)",
            zIndex: 45,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 280,
              borderRadius: 14,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 80px rgba(0,0,0,0.58)",
              padding: 8,
              display: "grid",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setEditorUploadMode(editorMediaActionMode);
                setEditorMediaActionMode(null);
                window.setTimeout(() => replaceImageInputRef.current?.click(), 0);
              }}
              className="studio2-menu-row"
              style={{ minHeight: 42, fontSize: 13 }}
            >
              <Upload size={15} /> Upload new
            </button>
            <button
              type="button"
              onClick={() => openMediaLibraryPicker(editorMediaActionMode)}
              className="studio2-menu-row"
              style={{ minHeight: 42, fontSize: 13 }}
            >
              <Library size={15} /> Media Library
            </button>
          </div>
        </div>
      )}
      {newAdModalOpen && (
        <div
          onClick={() => setNewAdModalOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            backdropFilter: "blur(8px)",
            zIndex: 46,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(560px, 94vw)",
              borderRadius: 16,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 90px rgba(0,0,0,0.62)",
              padding: 16,
              display: "grid",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 900 }}>Add ad</div>
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginTop: 3 }}>Pick media, paste copy, then generate the text blocks onto the new ad.</div>
              </div>
              <button
                type="button"
                onClick={() => setNewAdModalOpen(false)}
                style={{ ...buttonStyle(false), width: 34, height: 34, padding: 0 }}
                aria-label="Close add ad"
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 12, alignItems: "stretch" }}>
              <div
                style={{
                  height: 150,
                  borderRadius: 12,
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.bgDeep,
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: ADS_BRAND.text3,
                }}
              >
                {newAdMediaAssets[0] ? (
                  <div style={{ position: "relative", width: "100%", height: "100%" }}>
                    <MediaAssetPreview asset={newAdMediaAssets[0]} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                    {newAdMediaAssets.length > 1 && (
                      <div
                        style={{
                          position: "absolute",
                          right: 8,
                          bottom: 8,
                          borderRadius: 999,
                          background: "rgba(0,0,0,0.72)",
                          border: `1px solid ${ADS_BRAND.border2}`,
                          color: ADS_BRAND.text,
                          padding: "4px 8px",
                          fontSize: 11,
                          fontWeight: 900,
                        }}
                      >
                        {newAdMediaAssets.length} selected
                      </div>
                    )}
                  </div>
                ) : (
                  <ImagePlus size={24} />
                )}
              </div>
              <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                <button
                  type="button"
                  onClick={() => {
                    setEditorUploadMode("new-ad");
                    window.setTimeout(() => replaceImageInputRef.current?.click(), 0);
                  }}
                  style={{ ...buttonStyle(false), height: 42, justifyContent: "flex-start" }}
                >
                  <Upload size={15} /> Upload new
                </button>
                <button
                  type="button"
                  onClick={() => openMediaLibraryPicker("new-ad")}
                  style={{ ...buttonStyle(false), height: 42, justifyContent: "flex-start" }}
                >
                  <Library size={15} /> Media Library
                </button>
                {newAdStatus && <div style={{ color: ADS_BRAND.text3, fontSize: 12 }}>{newAdStatus}</div>}
              </div>
            </div>

            <label style={{ display: "grid", gap: 7 }}>
              <span style={labelStyle}>Copy</span>
              <textarea
                value={newAdCopy}
                onChange={(event) => setNewAdCopy(event.target.value)}
                placeholder={"Paste copy here.\n\nBlank lines become separate text blocks."}
                rows={8}
                style={{ ...inputStyle, minHeight: 160, resize: "vertical", lineHeight: 1.45, fontSize: 13 }}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setNewAdModalOpen(false)} style={{ ...buttonStyle(false), height: 38 }}>
                Cancel
              </button>
              <button type="button" onClick={createAdFromModal} style={{ ...buttonStyle(true), height: 38 }}>
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
      {generateMediaPickerOpen && editorSidebarMode !== "generate" && (
        <div
          aria-label="Choose media"
          onClick={closeMediaLibraryPicker}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 80,
            background: "rgba(0,0,0,0.58)",
            backdropFilter: "blur(10px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(980px, 94vw)",
              maxHeight: "min(760px, 88vh)",
              border: `1px solid ${ADS_BRAND.border2}`,
              borderRadius: 18,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 90px rgba(0,0,0,0.58)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ height: 58, display: "flex", alignItems: "center", gap: 10, padding: "0 16px", borderBottom: `1px solid ${ADS_BRAND.border}` }}>
              <Library size={18} color={ADS_BRAND.gold} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 900 }}>Media Library</div>
                <div style={{ color: ADS_BRAND.text3, fontSize: 11, fontWeight: 750, marginTop: 2 }}>
                  {generateMediaFolderTrail.length ? generateMediaFolderTrail.map((folder) => folder.name).join(" / ") : "All Media"}
                </div>
              </div>
              <button
                type="button"
                onClick={closeMediaLibraryPicker}
                style={{ ...buttonStyle(false), width: 34, height: 34, padding: 0, justifyContent: "center" }}
                aria-label="Close media library"
              >
                <X size={15} />
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `1px solid ${ADS_BRAND.border}` }}>
              <button
                type="button"
                onClick={() => setGenerateMediaPickerFolderId(currentGenerateMediaFolder?.parentId || null)}
                disabled={!currentGenerateMediaFolder}
                style={{ ...buttonStyle(false), height: 32, opacity: currentGenerateMediaFolder ? 1 : 0.45, cursor: currentGenerateMediaFolder ? "pointer" : "default" }}
              >
                <ArrowLeft size={13} /> Back
              </button>
              <button
                type="button"
                onClick={() => setGenerateMediaPickerFolderId(null)}
                style={{ ...buttonStyle(!currentGenerateMediaFolder), height: 32 }}
              >
                All Media
              </button>
              {generateMediaFolderTrail.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setGenerateMediaPickerFolderId(folder.id)}
                  style={{ ...buttonStyle(folder.id === generateMediaPickerFolderId), height: 32, maxWidth: 180 }}
                  title={folder.name}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                </button>
              ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 18 }}>
              {visibleGenerateMediaFolders.length > 0 && (
                <>
                  <div style={{ color: ADS_BRAND.text, fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Folders</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10, marginBottom: 22 }}>
                    {visibleGenerateMediaFolders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        onClick={() => setGenerateMediaPickerFolderId(folder.id)}
                        style={{
                          border: `1px solid ${ADS_BRAND.border2}`,
                          borderRadius: 12,
                          background: ADS_BRAND.panel2,
                          color: ADS_BRAND.text,
                          minHeight: 118,
                          padding: 12,
                          display: "grid",
                          alignContent: "center",
                          justifyItems: "center",
                          gap: 10,
                          cursor: "pointer",
                          fontFamily: "inherit",
                          fontWeight: 850,
                        }}
                      >
                        <Folder size={26} style={{ color: ADS_BRAND.text3 }} />
                        <span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{folder.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div style={{ color: ADS_BRAND.text, fontSize: 14, fontWeight: 900, marginBottom: 10 }}>Media</div>
              {visibleGenerateMediaAssets.length > 0 ? (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
                  {visibleGenerateMediaAssets.map((asset) => {
                    const isUsableReference = mediaPickerMode !== "generate-reference" || asset.kind === "image";
                    const selectedForNewAd = mediaPickerMode === "new-ad" && newAdMediaAssets.some((item) => item.id === asset.id || item.url === asset.url);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          if (isUsableReference) void handleMediaPickerAsset(asset);
                        }}
                        style={{
                          border: `1px solid ${selectedForNewAd ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                          borderRadius: 12,
                          background: selectedForNewAd ? ADS_BRAND.goldSoft : ADS_BRAND.panel2,
                          padding: 0,
                          overflow: "hidden",
                          cursor: isUsableReference ? "pointer" : "not-allowed",
                          opacity: isUsableReference ? 1 : 0.58,
                          textAlign: "left",
                          fontFamily: "inherit",
                        }}
                        title={isUsableReference ? "Use this media" : "Video references are not supported yet"}
                      >
                        <div style={{ width: "100%", aspectRatio: "1 / 1", background: ADS_BRAND.bgDeep, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
                          <MediaAssetPreview asset={asset} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          {selectedForNewAd && (
                            <span
                              style={{
                                position: "absolute",
                                top: 8,
                                right: 8,
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: ADS_BRAND.gold,
                                color: "#111",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 12,
                                fontWeight: 950,
                              }}
                            >
                              <Check size={14} />
                            </span>
                          )}
                        </div>
                        <div style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 7 }}>
                          {asset.kind === "video" ? <Video size={13} style={{ color: ADS_BRAND.text3 }} /> : <ImagePlus size={13} style={{ color: ADS_BRAND.text3 }} />}
                          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ADS_BRAND.text2, fontSize: 12, fontWeight: 800 }}>
                            {asset.filename || "Media"}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  style={{
                    minHeight: 220,
                    border: `1px dashed ${ADS_BRAND.border2}`,
                    borderRadius: 14,
                    color: ADS_BRAND.text3,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                  }}
                >
                  No media in this folder.
                </div>
              )}
            </div>
            {mediaPickerMode === "new-ad" && (
              <div style={{ minHeight: 58, borderTop: `1px solid ${ADS_BRAND.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, fontWeight: 800 }}>
                  {newAdMediaAssets.length ? `${newAdMediaAssets.length} selected` : "Select one or more media items."}
                </div>
                <button
                  type="button"
                  onClick={closeMediaLibraryPicker}
                  style={{ ...buttonStyle(true), height: 36, opacity: newAdMediaAssets.length ? 1 : 0.55 }}
                >
                  Done
                </button>
              </div>
            )}
          </div>
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
              maxHeight: "calc(100vh - 48px)",
              borderRadius: 14,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 90px rgba(0,0,0,0.62)",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                background: ADS_BRAND.bgDeep,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                minHeight: 0,
                flex: "1 1 auto",
              }}
            >
              <img
                src={getMediaPreviewSrc(generatedPreview.asset.url)}
                alt=""
                style={{
                  width: "100%",
                  maxHeight: "calc(100vh - 136px)",
                  aspectRatio: "9 / 16",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>
            <div style={{ padding: 14, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <button
                type="button"
                onClick={() => addGeneratedImageAsAd(generatedPreview.asset)}
                style={{ ...buttonStyle(true), flex: 1, justifyContent: "center", height: 40 }}
              >
                <FilePlus2 size={14} /> Use in editor
              </button>
              <button
                type="button"
                onClick={() => void downloadGalleryAssets([generatedPreview.asset])}
                style={{ ...buttonStyle(false), height: 40 }}
              >
                <Download size={14} />
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
      {higgsfieldAuthModal.open && (
        <div
          onClick={() => !savingHiggsfieldAuth && setHiggsfieldAuthModal({ open: false })}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.64)",
            backdropFilter: "blur(8px)",
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(540px, 94vw)",
              borderRadius: 14,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 90px rgba(0,0,0,0.62)",
              padding: 16,
              display: "grid",
              gap: 13,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
	              <div>
	                <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 850 }}>Reconnect Higgsfield</div>
	                <div style={{ color: ADS_BRAND.text3, fontSize: 12, lineHeight: 1.45, marginTop: 5 }}>
	                  Click once, approve Higgsfield in the tab that opens, then come back here. Studio saves the fresh login automatically.
	                </div>
	              </div>
              <button
                type="button"
                onClick={() => setHiggsfieldAuthModal({ open: false })}
                disabled={savingHiggsfieldAuth}
                style={{ ...buttonStyle(false), width: 34, height: 34, padding: 0 }}
              >
                <X size={14} />
              </button>
            </div>
            {higgsfieldAuthModal.message && (
              <div style={{ color: "#ffb3b3", fontSize: 12, lineHeight: 1.45, border: "1px solid rgba(255,155,155,0.22)", background: "rgba(255,155,155,0.08)", borderRadius: 10, padding: 10 }}>
                {higgsfieldAuthModal.message}
              </div>
            )}
	            <button
	              type="button"
	              onClick={() => void startHiggsfieldAuthLogin()}
	              disabled={savingHiggsfieldAuth}
	              style={{
	                ...buttonStyle(true),
	                height: 48,
	                justifyContent: "center",
	                fontSize: 14,
	                opacity: savingHiggsfieldAuth ? 0.7 : 1,
	              }}
	            >
	              {savingHiggsfieldAuth ? <LoaderCircle size={16} style={{ animation: "spin 1s linear infinite" }} /> : <Link2 size={16} />}
	              {savingHiggsfieldAuth ? "Waiting for approval..." : "Open Higgsfield login"}
	            </button>
	            {higgsfieldAuthLoginUrl && (
	              <a
	                href={higgsfieldAuthLoginUrl}
	                target="_blank"
	                rel="noreferrer"
	                style={{
	                  color: ADS_BRAND.gold,
	                  fontSize: 12,
	                  fontWeight: 800,
	                  textDecoration: "none",
	                  justifySelf: "start",
	                }}
	              >
	                Open login page again
	              </a>
	            )}
	            {higgsfieldAuthStatus && (
	              <div style={{ color: higgsfieldAuthStatus.includes("connected") ? ADS_BRAND.success : ADS_BRAND.text3, fontSize: 12, lineHeight: 1.45 }}>
	                {higgsfieldAuthStatus}
	              </div>
	            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setHiggsfieldAuthModal({ open: false })}
                disabled={savingHiggsfieldAuth}
                style={buttonStyle(false)}
              >
                Cancel
              </button>
	              <button
	                type="button"
	                onClick={() => void startHiggsfieldAuthLogin()}
	                disabled={savingHiggsfieldAuth}
	                style={{ ...buttonStyle(true), opacity: savingHiggsfieldAuth ? 0.45 : 1 }}
	              >
	                {savingHiggsfieldAuth ? "Connecting..." : "Reconnect"}
	              </button>
            </div>
          </div>
        </div>
      )}
      {editingGeneratePreset && (
        <div
          onClick={() => setEditingGeneratePreset(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            backdropFilter: "blur(8px)",
            zIndex: 49,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(520px, 94vw)",
              borderRadius: 14,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 90px rgba(0,0,0,0.62)",
              padding: 16,
              display: "grid",
              gap: 13,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ color: ADS_BRAND.text, fontSize: 15, fontWeight: 850 }}>Edit preset</div>
                <div style={{ color: ADS_BRAND.text3, fontSize: 12, marginTop: 3 }}>Change the saved prompt text or remove this preset.</div>
              </div>
              <button
                type="button"
                onClick={() => setEditingGeneratePreset(null)}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  border: `1px solid ${ADS_BRAND.border2}`,
                  background: ADS_BRAND.panel3,
                  color: ADS_BRAND.text2,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>Name</span>
              <input
                value={editingGeneratePresetLabel}
                onChange={(event) => setEditingGeneratePresetLabel(event.target.value)}
                style={{ ...inputStyle, height: 38, fontSize: 13 }}
                autoFocus
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>Prompt Text</span>
              <textarea
                value={editingGeneratePresetPrompt}
                onChange={(event) => setEditingGeneratePresetPrompt(event.target.value)}
                rows={7}
                style={{ ...inputStyle, minHeight: 150, resize: "vertical", lineHeight: 1.45, fontSize: 13 }}
              />
            </label>

            <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
              <button
                type="button"
                onClick={deleteGeneratePresetEdit}
                style={{
                  ...buttonStyle(false),
                  height: 38,
                  color: "#ff9b9b",
                  borderColor: "rgba(255,155,155,0.26)",
                }}
              >
                <Trash2 size={14} /> Delete
              </button>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setEditingGeneratePreset(null)}
                  style={{ ...buttonStyle(false), height: 38 }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveGeneratePresetEdit}
                  disabled={!editingGeneratePresetLabel.trim() || !editingGeneratePresetPrompt.trim()}
                  style={{
                    ...buttonStyle(true),
                    height: 38,
                    opacity: editingGeneratePresetLabel.trim() && editingGeneratePresetPrompt.trim() ? 1 : 0.45,
                    cursor: editingGeneratePresetLabel.trim() && editingGeneratePresetPrompt.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {addingGeneratePreset && (
        <div
          onClick={() => setAddingGeneratePreset(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            backdropFilter: "blur(8px)",
            zIndex: 49,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(520px, 94vw)",
              borderRadius: 14,
              border: `1px solid ${ADS_BRAND.border2}`,
              background: ADS_BRAND.panel,
              boxShadow: "0 28px 90px rgba(0,0,0,0.62)",
              padding: 16,
              display: "grid",
              gap: 13,
            }}
          >
            <div style={{ color: ADS_BRAND.text, fontSize: 15, fontWeight: 850 }}>Add prompt preset</div>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>Name</span>
              <input
                value={newGeneratePresetLabel}
                onChange={(event) => setNewGeneratePresetLabel(event.target.value)}
                placeholder="Same style variation"
                style={{ ...inputStyle, height: 38, fontSize: 13 }}
                autoFocus
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={labelStyle}>Prompt</span>
              <textarea
                value={newGeneratePresetPrompt}
                onChange={(event) => setNewGeneratePresetPrompt(event.target.value)}
                placeholder="Save the current prompt or type a reusable instruction..."
                rows={7}
                style={{ ...inputStyle, minHeight: 150, resize: "vertical", lineHeight: 1.45, fontSize: 13 }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" onClick={() => setAddingGeneratePreset(false)} style={{ ...buttonStyle(false), height: 38 }}>
                Cancel
              </button>
              <button
                type="button"
                onClick={saveNewGeneratePreset}
                disabled={!newGeneratePresetPrompt.trim()}
                style={{ ...buttonStyle(true), height: 38, opacity: newGeneratePresetPrompt.trim() ? 1 : 0.45 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      {uploadModalOpen && (
        <div
          onClick={() => {
            if (uploadingQueuedMedia) cancelQueuedUpload();
            setUploadModalOpen(false);
          }}
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
                      onClick={() => removeQueuedUploadFile(index)}
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
                  if (uploadingQueuedMedia) cancelQueuedUpload();
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
            width: "min(760px, 94vw)",
            maxHeight: "88vh",
            borderRadius: 12,
            border: `1px solid ${ADS_BRAND.border2}`,
            background: ADS_BRAND.panel,
            boxShadow: "0 28px 80px rgba(0,0,0,0.55)",
            padding: 18,
            overflowY: "auto",
          }}>
            <div style={{ color: ADS_BRAND.text, fontSize: 16, fontWeight: 850, marginBottom: 12 }}>Export</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 4,
                padding: 4,
                borderRadius: 10,
                border: `1px solid ${ADS_BRAND.border2}`,
                background: ADS_BRAND.panel3,
                marginBottom: 14,
              }}
            >
              {[
                { value: "current" as const, label: `This page (${currentIndex + 1})` },
                { value: "all" as const, label: "All" },
                { value: "custom" as const, label: "Custom" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setExportMode(option.value);
                    if (option.value === "custom" && !customExportSelection.length) {
                      setCustomExportSelection([currentIndex]);
                      setCustomExportInput(String(currentIndex + 1));
                    }
                  }}
                  style={{
                    height: 42,
                    border: "none",
                    borderRadius: 7,
                    background: exportMode === option.value ? ADS_BRAND.gold : "transparent",
                    color: exportMode === option.value ? ADS_BRAND.inkOnGold : ADS_BRAND.text2,
                    fontFamily: "inherit",
                    fontSize: 14,
                    fontWeight: 850,
                    cursor: "pointer",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label style={{ ...labelStyle, display: "block", marginBottom: 7 }}>File or folder name</label>
            <input
              value={exportFolderName}
              onChange={(event) => setExportFolderName(event.target.value)}
              style={{ ...inputStyle, height: 40, marginBottom: 12 }}
              autoFocus
            />
            {exportMode === "custom" && (
              <div style={{ display: "grid", gap: 12, marginBottom: 14 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    value={customExportInput}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCustomExportInput(next);
                      const parsed = parsePageRangeInput(next, creatives.length);
                      if (parsed.length) setCustomExportSelection(parsed);
                    }}
                    placeholder="2, 4-29"
                    style={{ ...inputStyle, height: 42, flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const all = creatives.map((_, index) => index);
                      setCustomExportSelection(all);
                      setCustomExportInput(`1-${creatives.length}`);
                    }}
                    style={{ ...buttonStyle(false), height: 42 }}
                  >
                    Select all
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 10, maxHeight: 320, overflowY: "auto", paddingRight: 4 }}>
                  {creatives.map((creative, index) => {
                    const selected = customExportSelection.includes(index);
                    return (
                      <button
                        key={creative.id}
                        type="button"
                        onClick={() => {
                          setCustomExportSelection((prev) => {
                            const next = prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index].sort((a, b) => a - b);
                            setCustomExportInput(next.map((item) => String(item + 1)).join(", "));
                            return next;
                          });
                        }}
                        style={{
                          position: "relative",
                          height: 104,
                          borderRadius: 10,
                          border: `2px solid ${selected ? ADS_BRAND.gold : ADS_BRAND.border2}`,
                          background: selected ? ADS_BRAND.goldSoft : ADS_BRAND.panel3,
                          padding: 0,
                          overflow: "hidden",
                          cursor: "pointer",
                        }}
                      >
                        {creativeThumbs[creative.id] ? (
                          <img src={creativeThumbs[creative.id]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                        ) : (
                          <MediaAssetPreview
                            asset={{
                              url: creative.photoUrl,
                              thumbnailUrl: getMediaPreviewUrl(getAssetForUrl(creative.photoUrl)),
                              filename: creative.photoUrl,
                              kind: creative.mediaKind || (looksLikeVideoUrl(creative.photoUrl) ? "video" : "image"),
                            }}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        )}
                        <span
                          style={{
                            position: "absolute",
                            left: 8,
                            bottom: 8,
                            minWidth: 28,
                            height: 24,
                            borderRadius: 999,
                            background: selected ? ADS_BRAND.gold : "rgba(0,0,0,0.62)",
                            color: selected ? ADS_BRAND.inkOnGold : ADS_BRAND.text2,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 900,
                          }}
                        >
                          {index + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={buttonStyle(false)} onClick={() => setExportModalOpen(false)}>Cancel</button>
              <button
                style={{
                  ...buttonStyle(true),
                  opacity: exportMode !== "custom" || customExportSelection.length || parsePageRangeInput(customExportInput, creatives.length).length ? 1 : 0.45,
                }}
                onClick={runExportModal}
                disabled={exportMode === "custom" && !customExportSelection.length && !parsePageRangeInput(customExportInput, creatives.length).length}
              >
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

function HexColorControl({
  value,
  onStart,
  onChange,
  ariaLabel,
}: {
  value: string;
  onStart: () => void;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const normalizedValue = normalizeHex(value);
  const [draft, setDraft] = useState(normalizedValue.toUpperCase());

  useEffect(() => {
    setDraft(normalizeHex(value).toUpperCase());
  }, [value]);

  const commit = (rawValue: string) => {
    const next = normalizeHex(rawValue, normalizedValue).toUpperCase();
    setDraft(next);
    onChange(next);
  };

  return (
    <>
      <span
        aria-hidden="true"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          border: `1px solid ${ADS_BRAND.border2}`,
          background: normalizedValue,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
          flexShrink: 0,
        }}
      />
      <input
        value={draft}
        onFocus={onStart}
        onChange={(event) => {
          const next = event.target.value.toUpperCase();
          setDraft(next);
          if (/^#?[0-9A-F]{6}$/.test(next) || /^#?[0-9A-F]{3}$/.test(next)) {
            onChange(normalizeHex(next, normalizedValue).toUpperCase());
          }
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
        spellCheck={false}
        style={{
          ...inputStyle,
          height: 32,
          width: 86,
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          textTransform: "uppercase",
        }}
        aria-label={ariaLabel}
      />
    </>
  );
}

// Clickable color control: swatch opens a real picker + saved-color palette.
// The palette is shared across every ad/project so colors stay reusable.
function ColorPicker({
  value,
  onStart,
  onChange,
  ariaLabel,
  palette,
  onAddToPalette,
  onRemoveFromPalette,
}: {
  value: string;
  onStart: () => void;
  onChange: (value: string) => void;
  ariaLabel: string;
  palette: string[];
  onAddToPalette: (value: string) => void;
  onRemoveFromPalette: (value: string) => void;
}) {
  const normalizedValue = normalizeHex(value);
  const [draft, setDraft] = useState(normalizedValue.toUpperCase());
  const [open, setOpen] = useState(false);
  const [removeMode, setRemoveMode] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraft(normalizeHex(value).toUpperCase());
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (swatchRef.current?.contains(event.target as Node)) return;
      if (popRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setRemoveMode(false);
    };
    const dismiss = () => {
      setOpen(false);
      setRemoveMode(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  const commit = (rawValue: string) => {
    const next = normalizeHex(rawValue, normalizedValue).toUpperCase();
    setDraft(next);
    onChange(next);
  };

  const togglePopover = () => {
    if (!open) {
      const rect = swatchRef.current?.getBoundingClientRect();
      if (rect) {
        const width = 236;
        const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
        setAnchor({ top: rect.bottom + 6, left });
      }
      onStart();
    }
    setOpen((value) => !value);
    setRemoveMode(false);
  };

  return (
    <>
      <button
        ref={swatchRef}
        type="button"
        onClick={togglePopover}
        aria-label={ariaLabel}
        title="Pick color"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          border: `1px solid ${ADS_BRAND.border2}`,
          background: normalizedValue,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
          flexShrink: 0,
          cursor: "pointer",
          padding: 0,
        }}
      />
      <input
        value={draft}
        onFocus={onStart}
        onChange={(event) => {
          const next = event.target.value.toUpperCase();
          setDraft(next);
          if (/^#?[0-9A-F]{6}$/.test(next) || /^#?[0-9A-F]{3}$/.test(next)) {
            onChange(normalizeHex(next, normalizedValue).toUpperCase());
          }
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(event.currentTarget.value);
            event.currentTarget.blur();
          }
        }}
        spellCheck={false}
        style={{
          ...inputStyle,
          height: 32,
          width: 78,
          fontFamily: "var(--font-geist-mono), ui-monospace, monospace",
          textTransform: "uppercase",
        }}
        aria-label={`${ariaLabel} hex`}
      />
      {open && anchor && (
        <div
          ref={popRef}
          style={{
            position: "fixed",
            top: anchor.top,
            left: anchor.left,
            width: 236,
            zIndex: 1000,
            background: ADS_BRAND.panel2,
            border: `1px solid ${ADS_BRAND.border2}`,
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 18px 40px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="color"
              value={normalizedValue}
              onChange={(event) => commit(event.target.value)}
              aria-label={`${ariaLabel} picker`}
              style={{
                width: 46,
                height: 36,
                padding: 0,
                border: `1px solid ${ADS_BRAND.border2}`,
                borderRadius: 8,
                background: "transparent",
                cursor: "pointer",
              }}
            />
            <button
              type="button"
              onClick={() => onAddToPalette(draft)}
              style={{ ...buttonStyle(false), flex: 1, height: 36, justifyContent: "center", gap: 6 }}
            >
              <Plus size={13} /> Save color
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={labelStyle}>Saved colors</span>
            {palette.length > 0 && (
              <button
                type="button"
                onClick={() => setRemoveMode((value) => !value)}
                style={{
                  background: "none",
                  border: "none",
                  color: removeMode ? "#ff8b8b" : ADS_BRAND.text3,
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {removeMode ? "Done" : "Edit"}
              </button>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 6 }}>
            {palette.map((color) => {
              const isCurrent = color.toUpperCase() === normalizedValue.toUpperCase();
              return (
                <button
                  key={color}
                  type="button"
                  title={removeMode ? "Remove color" : color}
                  onClick={() => {
                    if (removeMode) {
                      onRemoveFromPalette(color);
                      return;
                    }
                    commit(color);
                    setOpen(false);
                  }}
                  style={{
                    position: "relative",
                    width: "100%",
                    aspectRatio: "1 / 1",
                    borderRadius: 6,
                    background: color,
                    border: isCurrent ? `2px solid ${ADS_BRAND.gold}` : `1px solid ${ADS_BRAND.border2}`,
                    boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {removeMode && (
                    <span
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        background: "rgba(0,0,0,0.4)",
                        borderRadius: 5,
                        fontSize: 13,
                        fontWeight: 900,
                      }}
                    >
                      ×
                    </span>
                  )}
                </button>
              );
            })}
            {!palette.length && (
              <span style={{ gridColumn: "1 / -1", fontSize: 11, color: ADS_BRAND.text3 }}>
                No saved colors yet — pick one and tap “Save color”.
              </span>
            )}
          </div>
        </div>
      )}
    </>
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

function VideoTrimControls({
  duration,
  segments,
  currentTime,
  zoom,
  playing,
  muted,
  volume,
  onStart,
  onSegmentsChange,
  onPreviewTime,
  onZoomChange,
  onSplit,
  onTogglePlay,
  onClose,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onMutedChange,
  onVolumeChange,
  onReset,
}: {
  duration: number;
  segments: VideoSegment[];
  currentTime: number;
  zoom: number;
  playing: boolean;
  muted: boolean;
  volume: number;
  onStart: () => void;
  onSegmentsChange: (segments: VideoSegment[], previewTime?: number) => void;
  onPreviewTime: (time: number) => void;
  onZoomChange: (zoom: number) => void;
  onSplit: () => void;
  onTogglePlay: () => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onMutedChange: (muted: boolean) => void;
  onVolumeChange: (volume: number) => void;
  onReset: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draftSegmentsRef = useRef<VideoSegment[]>([]);
  const playheadDragRef = useRef(false);
  const dragRef = useRef<{
    type: "start" | "end" | "move";
    id: string;
    pointerStartX: number;
    start: number;
    end: number;
    baseSegments: VideoSegment[];
    previewTime: number;
  } | null>(null);
  const [draftSegments, setDraftSegmentsState] = useState<VideoSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(segments[0]?.id ?? null);
  const [snapGuideTime, setSnapGuideTime] = useState<number | null>(null);
  const safeDuration = Math.max(0, duration);
  const setDraftSegments = useCallback((next: VideoSegment[]) => {
    draftSegmentsRef.current = next;
    setDraftSegmentsState(next);
  }, []);
  const normalizedSegments = useMemo(
    () => normalizeVideoTimeline(draftSegments.length ? draftSegments : segments, null, safeDuration),
    [draftSegments, segments, safeDuration]
  );
  const max = safeDuration || Math.max(...normalizedSegments.map((segment) => segment.end || segment.start + 1), 1);
  const pxPerSecond = 10 + clamp(zoom, 0.5, 4) * 38;
  const trackWidth = Math.max(720, Math.ceil(max * pxPerSecond));
  const previewLeft = clamp((currentTime / max) * trackWidth, 0, trackWidth);
  const activeSegment = normalizedSegments.find((segment) => segment.id === selectedSegmentId)
    ?? normalizedSegments.find((segment) => currentTime >= segment.start && currentTime <= (segment.end ?? max))
    ?? normalizedSegments[0];
  const enabledSegments = normalizedSegments.filter((segment) => segment.enabled);
  const totalEnabledLength = enabledSegments.reduce((sum, segment) => sum + Math.max(0, (segment.end ?? max) - segment.start), 0);
  const canTrim = safeDuration > 0 || normalizedSegments.length > 0;
  const minGap = Math.min(0.15, max || 0.15);
  const tickStep = zoom > 2.8 ? 0.5 : zoom > 1.6 ? 1 : zoom > 0.85 ? 2 : 5;
  const tickCount = Math.min(260, Math.floor(max / tickStep) + 1);
  const snapThresholdSeconds = Math.max(0.04, 12 / pxPerSecond);
  const smallButton: React.CSSProperties = {
    ...buttonStyle(false),
    height: 30,
    padding: "0 9px",
    fontSize: 11,
  };
  const toolbarButton = (active = false, disabled = false): React.CSSProperties => ({
    width: 34,
    height: 34,
    borderRadius: 9,
    border: `1px solid ${active ? ADS_BRAND.goldBorder : "transparent"}`,
    background: active ? ADS_BRAND.goldSoft : "transparent",
    color: disabled ? ADS_BRAND.text4 : active ? ADS_BRAND.gold : ADS_BRAND.text2,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontFamily: "inherit",
    fontSize: 13,
    fontWeight: 900,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.42 : 1,
  });
  const getTimeFromClientX = useCallback(
    (clientX: number) => {
      const root = rootRef.current;
      if (!root || !max) return 0;
      const bounds = root.getBoundingClientRect();
      const x = clientX - bounds.left + root.scrollLeft;
      return roundVideoTime(clamp(x / pxPerSecond, 0, max));
    },
    [max, pxPerSecond]
  );
  const findSnapBoundary = useCallback(
    (time: number, segmentId: string) => {
      const boundaries = activeSegment
        ? [0, max, ...normalizedSegments.flatMap((segment) => segment.id === segmentId ? [] : [segment.start, segment.end ?? max])]
        : [0, max];
      let best: number | null = null;
      let bestDistance = snapThresholdSeconds;
      boundaries.forEach((boundary) => {
        const distance = Math.abs(time - boundary);
        if (distance <= bestDistance) {
          best = boundary;
          bestDistance = distance;
        }
      });
      return best === null ? null : roundVideoTime(best);
    },
    [activeSegment, max, normalizedSegments, snapThresholdSeconds]
  );

  const commitDrag = useCallback(
    (clientX: number) => {
      const active = dragRef.current;
      if (!active) return;
      const deltaSeconds = (clientX - active.pointerStartX) / pxPerSecond;
      let nextSnapGuide: number | null = null;
      const next = active.baseSegments.map((segment) => {
        if (segment.id !== active.id) return segment;
        if (active.type === "start") {
          let start = clamp(active.start + deltaSeconds, 0, Math.max(0, active.end - minGap));
          const snap = findSnapBoundary(start, active.id);
          if (snap !== null) {
            start = clamp(snap, 0, Math.max(0, active.end - minGap));
            nextSnapGuide = start;
          }
          return { ...segment, start: roundVideoTime(start) };
        }
        if (active.type === "end") {
          let end = clamp(active.end + deltaSeconds, active.start + minGap, max);
          const snap = findSnapBoundary(end, active.id);
          if (snap !== null) {
            end = clamp(snap, active.start + minGap, max);
            nextSnapGuide = end;
          }
          return { ...segment, end: roundVideoTime(end) };
        }
        const length = active.end - active.start;
        let start = clamp(active.start + deltaSeconds, 0, Math.max(0, max - length));
        let end = start + length;
        const startSnap = findSnapBoundary(start, active.id);
        const endSnap = findSnapBoundary(end, active.id);
        if (startSnap !== null) {
          start = clamp(startSnap, 0, Math.max(0, max - length));
          end = start + length;
          nextSnapGuide = start;
        } else if (endSnap !== null) {
          end = clamp(endSnap, length, max);
          start = end - length;
          nextSnapGuide = end;
        }
        return { ...segment, start: roundVideoTime(start), end: roundVideoTime(start + length) };
      });
      const updated = next.find((segment) => segment.id === active.id);
      active.previewTime = updated
        ? active.type === "end"
          ? (updated.end ?? currentTime)
          : updated.start
        : currentTime;
      setSnapGuideTime(nextSnapGuide);
      setDraftSegments(next);
      onPreviewTime(active.previewTime);
    },
    [currentTime, findSnapBoundary, max, minGap, onPreviewTime, pxPerSecond, setDraftSegments]
  );

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>, type: "start" | "end" | "move", segment: VideoSegment) => {
      if (!canTrim) return;
      event.preventDefault();
      event.stopPropagation();
      setSelectedSegmentId(segment.id);
      onStart();
      const end = segment.end ?? max;
      draftSegmentsRef.current = normalizedSegments;
      dragRef.current = {
        type,
        id: segment.id,
        pointerStartX: event.clientX,
        start: segment.start,
        end,
        baseSegments: normalizedSegments,
        previewTime: type === "end" ? end : segment.start,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      onPreviewTime(type === "end" ? end : segment.start);
    },
    [canTrim, max, normalizedSegments, onPreviewTime, onStart]
  );

  const startPlayheadDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!canTrim) return;
      event.preventDefault();
      event.stopPropagation();
      playheadDragRef.current = true;
      const move = (moveEvent: PointerEvent) => {
        if (!playheadDragRef.current) return;
        onPreviewTime(getTimeFromClientX(moveEvent.clientX));
      };
      const stop = () => {
        playheadDragRef.current = false;
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
      onPreviewTime(getTimeFromClientX(event.clientX));
    },
    [canTrim, getTimeFromClientX, onPreviewTime]
  );

  const stopDrag = useCallback(() => {
    if (playheadDragRef.current) {
      playheadDragRef.current = false;
      return;
    }
    const active = dragRef.current;
    if (active) onSegmentsChange(draftSegmentsRef.current, active.previewTime);
    dragRef.current = null;
    setSnapGuideTime(null);
    setDraftSegmentsState([]);
  }, [onSegmentsChange]);

  const toggleSegment = useCallback(
    (segmentId: string) => {
      onStart();
      const enabledCount = normalizedSegments.filter((segment) => segment.enabled).length;
      onSegmentsChange(
        normalizedSegments.map((segment) =>
          segment.id === segmentId
            ? { ...segment, enabled: enabledCount <= 1 && segment.enabled ? true : !segment.enabled }
            : segment
        )
      );
    },
    [normalizedSegments, onSegmentsChange, onStart]
  );

  const deleteSegment = useCallback(
    (segmentId: string) => {
      if (normalizedSegments.length <= 1) return;
      onStart();
      const next = normalizedSegments.filter((segment) => segment.id !== segmentId);
      setSelectedSegmentId(next[0]?.id ?? null);
      onSegmentsChange(next, next[0]?.start ?? 0);
    },
    [normalizedSegments, onSegmentsChange, onStart]
  );

  const splitAtPlayhead = useCallback(() => {
    if (!canTrim) return;
    onSplit();
  }, [canTrim, onSplit]);

  const deleteActiveSegment = useCallback(() => {
    if (!activeSegment || normalizedSegments.length <= 1) return;
    deleteSegment(activeSegment.id);
  }, [activeSegment, deleteSegment, normalizedSegments.length]);

  const trimActiveSegment = useCallback(
    (edge: "start" | "end") => {
      if (!activeSegment || !canTrim) return;
      const segmentEnd = activeSegment.end ?? max;
      const nextPoint = edge === "start"
        ? clamp(currentTime, activeSegment.start, Math.max(activeSegment.start, segmentEnd - minGap))
        : clamp(currentTime, activeSegment.start + minGap, segmentEnd);
      onStart();
      const next = normalizedSegments.map((segment) =>
        segment.id === activeSegment.id
          ? edge === "start"
            ? { ...segment, start: roundVideoTime(nextPoint) }
            : { ...segment, end: roundVideoTime(nextPoint) }
          : segment
      );
      onSegmentsChange(next, roundVideoTime(nextPoint));
    },
    [activeSegment, canTrim, currentTime, max, minGap, normalizedSegments, onSegmentsChange, onStart]
  );

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div style={{
        height: 42,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 4,
        borderBottom: `1px solid ${ADS_BRAND.border}`,
        background: "transparent",
        padding: "0 2px 8px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <button type="button" style={toolbarButton(true)} title="Select clips">
            <MousePointer2 size={15} />
          </button>
          <button type="button" style={toolbarButton(false)} onClick={onTogglePlay} title="Play / pause video (Space)">
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button type="button" style={toolbarButton(false, !canUndo)} onClick={onUndo} disabled={!canUndo} title="Undo">
            <RotateCcw size={15} />
          </button>
          <button type="button" style={toolbarButton(false, !canRedo)} onClick={onRedo} disabled={!canRedo} title="Redo">
            <RotateCw size={15} />
          </button>
          <span style={{ width: 1, height: 20, background: ADS_BRAND.border2, margin: "0 3px" }} />
          <button type="button" style={toolbarButton(false, !activeSegment)} onClick={() => trimActiveSegment("start")} disabled={!activeSegment} title="Trim clip start to playhead">
            <span style={{ fontSize: 15, lineHeight: 1 }}>[|</span>
          </button>
          <button type="button" style={toolbarButton(false, !canTrim)} onClick={splitAtPlayhead} disabled={!canTrim} title="Split at playhead">
            <Scissors size={15} />
          </button>
          <button type="button" style={toolbarButton(false, !activeSegment)} onClick={() => trimActiveSegment("end")} disabled={!activeSegment} title="Trim clip end to playhead">
            <span style={{ fontSize: 15, lineHeight: 1 }}>|]</span>
          </button>
          <button type="button" style={toolbarButton(false, !activeSegment || normalizedSegments.length <= 1)} onClick={deleteActiveSegment} disabled={!activeSegment || normalizedSegments.length <= 1} title="Delete selected clip">
            <Trash2 size={15} />
          </button>
          <span style={{ width: 1, height: 20, background: ADS_BRAND.border2, margin: "0 3px" }} />
          <button type="button" style={toolbarButton(false)} onClick={onClose} title="Hide video editor">
            <PanelBottom size={15} />
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}>
          <span style={{
            color: ADS_BRAND.gold,
            background: ADS_BRAND.goldSoft,
            border: `1px solid ${ADS_BRAND.goldBorder}`,
            borderRadius: 999,
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 900,
          }}>
            {formatVideoTime(totalEnabledLength || max)}
          </span>
          <button type="button" style={toolbarButton(false)} onClick={() => onZoomChange(clamp(zoom - 0.35, 0.5, 4))} title="Zoom out timeline">
            <ZoomOut size={15} />
          </button>
          <input
            className="studio2-range"
            type="range"
            min={0.5}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(event) => onZoomChange(Number(event.currentTarget.value))}
            aria-label="Timeline zoom"
            style={{
              width: 128,
              background: `linear-gradient(90deg, ${ADS_BRAND.gold} 0%, ${ADS_BRAND.gold} ${((zoom - 0.5) / 3.5) * 100}%, ${ADS_BRAND.border2} ${((zoom - 0.5) / 3.5) * 100}%, ${ADS_BRAND.border2} 100%)`,
            }}
          />
          <button type="button" style={toolbarButton(false)} onClick={() => onZoomChange(clamp(zoom + 0.35, 0.5, 4))} title="Zoom in timeline">
            <ZoomIn size={15} />
          </button>
        </div>
      </div>

      <div style={{
        border: "none",
        borderRadius: 0,
        background: "transparent",
        padding: "6px 0 0",
        marginBottom: 6,
        minHeight: 0,
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
      }}>
        <div
          ref={rootRef}
          style={{
            width: "100%",
            flex: 1,
            overflowX: "auto",
            overflowY: "hidden",
            paddingBottom: 4,
            cursor: canTrim ? "pointer" : "default",
          }}
          onClick={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-video-segment='true']")) return;
            onPreviewTime(getTimeFromClientX(event.clientX));
          }}
          onPointerMove={(event) => {
            if (playheadDragRef.current) {
              onPreviewTime(getTimeFromClientX(event.clientX));
              return;
            }
            commitDrag(event.clientX);
          }}
          onPointerUp={stopDrag}
          onPointerCancel={stopDrag}
        >
          <div style={{ position: "relative", width: trackWidth, height: "100%", minHeight: 132 }}>
            <div style={{ position: "absolute", inset: "0 0 auto", height: 30, color: ADS_BRAND.text3, fontSize: 11, fontWeight: 800 }}>
              {Array.from({ length: tickCount }).map((_, index) => {
                const time = index * tickStep;
                const left = time * pxPerSecond;
                return (
                  <div key={time} style={{ position: "absolute", left, top: 0, width: 1, height: 30, background: "rgba(127,127,127,0.22)" }}>
                    <span style={{ position: "absolute", left: 4, top: 0, whiteSpace: "nowrap" }}>{formatVideoTime(time)}</span>
                  </div>
                );
              })}
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, top: 42, height: 68, borderRadius: 10, background: ADS_BRAND.panel2, border: `1px solid ${ADS_BRAND.border}` }} />
            {snapGuideTime !== null && (
              <div
                style={{
                  position: "absolute",
                  left: snapGuideTime * pxPerSecond,
                  top: 34,
                  width: 2,
                  height: 86,
                  borderRadius: 999,
                  background: ADS_BRAND.gold,
                  boxShadow: "0 0 0 3px rgba(212,178,122,0.14)",
                  pointerEvents: "none",
                  zIndex: 6,
                }}
              />
            )}
            {normalizedSegments.map((segment, index) => {
              const segmentEnd = segment.end ?? max;
              const left = segment.start * pxPerSecond;
              const width = Math.max(28, (segmentEnd - segment.start) * pxPerSecond);
              const isSelected = segment.id === selectedSegmentId;
              return (
                <div
                  key={segment.id}
                  data-video-segment="true"
                  onPointerDown={(event) => startDrag(event, "move", segment)}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedSegmentId(segment.id);
                  }}
                  style={{
                    position: "absolute",
                    left,
                    top: 48,
                    width,
                    height: 56,
                    borderRadius: 8,
                    border: `${isSelected ? 2 : 1}px ${segment.enabled ? "solid" : "dashed"} ${isSelected ? ADS_BRAND.gold : segment.enabled ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                    background: segment.enabled
                      ? "rgba(212,178,122,0.14)"
                      : "rgba(255,255,255,0.035)",
                    opacity: segment.enabled ? 1 : 0.55,
                    boxShadow: "none",
                    cursor: "grab",
                    overflow: "hidden",
                  }}
                  title="Drag clip to move it"
                >
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSegment(segment.id);
                    }}
                    style={{
                      position: "absolute",
                      left: 5,
                      top: 5,
                      height: 20,
                      borderRadius: 999,
                      border: `1px solid ${segment.enabled ? ADS_BRAND.goldBorder : ADS_BRAND.border2}`,
                      background: segment.enabled ? "rgba(212,178,122,0.16)" : ADS_BRAND.bgDeep,
                      color: segment.enabled ? ADS_BRAND.gold : ADS_BRAND.text3,
                      fontFamily: "inherit",
                      fontSize: 9,
                      fontWeight: 900,
                      padding: "0 6px",
                      cursor: "pointer",
                    }}
                    title={segment.enabled ? "Turn segment off" : "Turn segment on"}
                  >
                    {segment.enabled ? "ON" : "OFF"}
                  </button>
                  <div style={{
                    position: "absolute",
                    left: 8,
                    bottom: 6,
                    right: 8,
                    color: ADS_BRAND.text2,
                    fontSize: 10,
                    fontWeight: 900,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    pointerEvents: "none",
                  }}>
                    Clip {index + 1} · {formatVideoTime(segment.start)}-{formatVideoTime(segmentEnd)}
                  </div>
                  <button
                    type="button"
                    onPointerDown={(event) => startDrag(event, "start", segment)}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 10,
                      border: "none",
                      background: isSelected ? ADS_BRAND.gold : "rgba(212,178,122,0.38)",
                      cursor: "ew-resize",
                    }}
                    aria-label="Trim clip start"
                  />
                  <button
                    type="button"
                    onPointerDown={(event) => startDrag(event, "end", segment)}
                    style={{
                      position: "absolute",
                      right: 0,
                      top: 0,
                      bottom: 0,
                      width: 10,
                      border: "none",
                      background: isSelected ? ADS_BRAND.gold : "rgba(212,178,122,0.38)",
                      cursor: "ew-resize",
                    }}
                    aria-label="Trim clip end"
                  />
                  {normalizedSegments.length > 1 && (
                    <button
                      type="button"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        deleteSegment(segment.id);
                      }}
                      style={{
                        position: "absolute",
                        right: 14,
                        top: 5,
                        width: 20,
                        height: 20,
                        borderRadius: 999,
                        border: `1px solid ${ADS_BRAND.border2}`,
                        background: ADS_BRAND.bg,
                        color: "#ffb3b3",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                      }}
                      title="Delete segment"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onPointerDown={startPlayheadDrag}
              aria-label="Drag playhead"
              title="Drag playhead"
              style={{
                position: "absolute",
                left: previewLeft - 8,
                top: 28,
                width: 16,
                height: 94,
                border: "none",
                background: "transparent",
                padding: 0,
                cursor: "ew-resize",
                zIndex: 8,
              }}
            >
              <span style={{
                position: "absolute",
                left: 7,
                top: 0,
                width: 2,
                height: "100%",
                borderRadius: 999,
                background: ADS_BRAND.text,
                boxShadow: "0 0 0 3px rgba(212,178,122,0.16)",
              }} />
            </button>
            <button
              type="button"
              onPointerDown={startPlayheadDrag}
              aria-label="Drag playhead handle"
              style={{
                position: "absolute",
                left: previewLeft - 7,
                top: 23,
                width: 14,
                height: 16,
                borderRadius: "0 0 6px 6px",
                border: `1px solid ${ADS_BRAND.text}`,
                borderTop: "none",
                background: ADS_BRAND.panel2,
                boxShadow: "0 0 0 3px rgba(212,178,122,0.16)",
                cursor: "ew-resize",
                zIndex: 9,
              }}
              title="Drag playhead"
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ color: ADS_BRAND.text3, fontSize: 12, fontWeight: 850 }}>
            Playhead {formatVideoTime(currentTime)}
          </span>
          <button type="button" style={{ ...smallButton, marginLeft: "auto", background: "transparent" }} onClick={onReset}>
            Reset
          </button>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "auto auto minmax(140px, 260px)",
        alignItems: "center",
        justifyContent: "end",
        gap: 10,
        minHeight: 34,
        borderTop: `1px solid ${ADS_BRAND.border}`,
        paddingTop: 8,
      }}>
        <span style={{ ...labelStyle, margin: 0 }}>Audio</span>
        <button
          type="button"
          style={{ ...buttonStyle(muted), height: 28, padding: "0 10px", fontSize: 11, borderRadius: 999 }}
          onClick={() => {
            onStart();
            onMutedChange(!muted);
          }}
        >
          {muted ? "Muted" : "On"}
        </button>
        <input
          className="studio2-range"
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onPointerDown={onStart}
          onChange={(event) => onVolumeChange(Number(event.currentTarget.value) / 100)}
          disabled={muted}
          style={{
            opacity: muted ? 0.45 : 1,
            background: `linear-gradient(90deg, ${ADS_BRAND.gold} 0%, ${ADS_BRAND.gold} ${Math.round(volume * 100)}%, ${ADS_BRAND.border2} ${Math.round(volume * 100)}%, ${ADS_BRAND.border2} 100%)`,
          }}
          aria-label="Original video volume"
        />
      </div>
    </div>
  );
}
