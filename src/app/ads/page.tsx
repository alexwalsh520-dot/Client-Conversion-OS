"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  ImagePlus,
  Type,
  Download,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Save,
  Palette,
  GripVertical,
  Sparkles,
  Upload,
  FileText,
  Eye,
  RotateCcw,
  Lock,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

/* ──────────────────────── TYPES ──────────────────────── */
interface TextBlock {
  id: string;
  lines: string[];
  x: number; // px from left
  y: number; // px from top
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  textColor: string;
  bgColor: string;
  bgOpacity: number;
  borderRadius: number;
  paddingH: number;
  paddingV: number;
  align: "left" | "center" | "right";
  lineGap: number;
  lineHeight: number; // CSS line-height multiplier (e.g. 1.5)
  highlightWords: { word: string; textColor?: string; bgColor?: string }[];
  maxWidth: number; // px
  locked?: boolean;
}

interface AdCreative {
  id: string;
  photoUrl: string;
  textBlocks: TextBlock[];
  imageTransform: { scale: number; rotate: number; offsetX: number; offsetY: number };
  status: "draft" | "edited" | "approved" | "exported";
  dbId?: string; // supabase id
}

/* ──────────────────────── HELPERS ──────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 10);

const defaultTextBlocks: TextBlock[] = [
  {
    id: uid(),
    lines: ["*NEW* Free Winter", "Weight Loss Challenge"],
    x: 90,
    y: 120,
    fontSize: 72,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 1,
    borderRadius: 18,
    paddingH: 32,
    paddingV: 18,
    align: "center",
    lineGap: 6,
    lineHeight: 1.5,
    highlightWords: [],
    maxWidth: 900,
  },
  {
    id: uid(),
    lines: [
      "- 6 weeks",
      "- my workout plan to get absolutely diced",
      "- dead simple diet plan (no counting macros)",
      "- accountability group so you actually stick w/ it",
    ],
    x: 80,
    y: 380,
    fontSize: 44,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 1,
    borderRadius: 14,
    paddingH: 24,
    paddingV: 14,
    align: "left",
    lineGap: 5,
    lineHeight: 1.5,
    highlightWords: [],
    maxWidth: 960,
  },
  {
    id: uid(),
    lines: ["Free. Not eventually free.", 'Not "free trial." Free free.'],
    x: 90,
    y: 1220,
    fontSize: 52,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 1,
    borderRadius: 16,
    paddingH: 28,
    paddingV: 16,
    align: "center",
    lineGap: 6,
    lineHeight: 1.5,
    highlightWords: [],
    maxWidth: 900,
  },
  {
    id: uid(),
    lines: ["DM to join before I start", "charging for this."],
    x: 90,
    y: 1380,
    fontSize: 56,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 1,
    borderRadius: 16,
    paddingH: 28,
    paddingV: 18,
    align: "center",
    lineGap: 6,
    lineHeight: 1.5,
    highlightWords: [],
    maxWidth: 900,
  },
];

/* ──────────────────────── STYLED LINE RENDERER ──────────────────────── */
function renderStyledLine(line: string, block: TextBlock): React.ReactNode {
  if (!block.highlightWords || block.highlightWords.length === 0) return line;

  // Build a list of segments: { start, end, style }
  type Segment = { text: string; textColor?: string; bgColor?: string };
  const segments: Segment[] = [];
  let remaining = line;
  let pos = 0;

  while (remaining.length > 0) {
    let earliestMatch: { index: number; length: number; hw: typeof block.highlightWords[0] } | null = null;

    for (const hw of block.highlightWords) {
      if (!hw.word) continue;
      const idx = remaining.toLowerCase().indexOf(hw.word.toLowerCase());
      if (idx !== -1 && (earliestMatch === null || idx < earliestMatch.index)) {
        earliestMatch = { index: idx, length: hw.word.length, hw };
      }
    }

    if (earliestMatch === null) {
      segments.push({ text: remaining });
      break;
    }

    if (earliestMatch.index > 0) {
      segments.push({ text: remaining.slice(0, earliestMatch.index) });
    }
    segments.push({
      text: remaining.slice(earliestMatch.index, earliestMatch.index + earliestMatch.length),
      textColor: earliestMatch.hw.textColor,
      bgColor: earliestMatch.hw.bgColor,
    });
    remaining = remaining.slice(earliestMatch.index + earliestMatch.length);
    pos += earliestMatch.index + earliestMatch.length;
  }

  if (segments.length <= 1 && !segments[0]?.textColor && !segments[0]?.bgColor) return line;

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.textColor && !seg.bgColor) return <span key={i}>{seg.text}</span>;
        return (
          <span
            key={i}
            style={{
              ...(seg.textColor ? { color: seg.textColor } : {}),
              ...(seg.bgColor ? { backgroundColor: seg.bgColor, borderRadius: 4, padding: "0 2px" } : {}),
            }}
          >
            {seg.text}
          </span>
        );
      })}
    </>
  );
}

/* ──────────────────────── AD CANVAS ──────────────────────── */
function AdCanvas({
  creative,
  scale,
  selectedBlockIds,
  onSelectBlock,
  onUpdateBlock,
  onRecordEdit,
  onImageClick,
  imageEditMode,
  onImagePan,
  onUpdateImage,
}: {
  creative: AdCreative;
  scale: number;
  selectedBlockIds: Set<string>;
  onSelectBlock: (id: string | null, shiftKey?: boolean) => void;
  onUpdateBlock: (blockId: string, updates: Partial<TextBlock>) => void;
  onRecordEdit: (
    blockId: string,
    type: string,
    before: unknown,
    after: unknown
  ) => void;
  onImageClick?: () => void;
  imageEditMode?: boolean;
  onImagePan?: (dx: number, dy: number) => void;
  onUpdateImage?: (updates: Partial<AdCreative["imageTransform"]>) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const inlineEditRef = useRef<HTMLTextAreaElement>(null);
  const [imagePanning, setImagePanning] = useState<{ startX: number; startY: number } | null>(null);
  const [imageResizing, setImageResizing] = useState<{ startX: number; startY: number; origScale: number } | null>(null);
  const [imageRotating, setImageRotating] = useState<{ startAngle: number; origRotate: number; centerX: number; centerY: number } | null>(null);

  // Inline text editing — double-click to enter, Escape/blur to exit
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // Track natural image dimensions for crop-mode overflow rendering
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);

  // Marquee selection — drag on empty canvas to select multiple blocks
  const [marquee, setMarquee] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);

  // Image pan drag effect — with canvas edge snap guides
  useEffect(() => {
    if (!imagePanning || !onImagePan) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - imagePanning.startX) / scale;
      const dy = (e.clientY - imagePanning.startY) / scale;
      onImagePan(dx, dy);
      setImagePanning({ startX: e.clientX, startY: e.clientY });

      // Show snap guides when image offset is near 0 (aligned with canvas center)
      const imgTransform = creative.imageTransform || { offsetX: 0, offsetY: 0 };
      const newOffX = (imgTransform.offsetX || 0) + dx;
      const newOffY = (imgTransform.offsetY || 0) + dy;
      const IMG_SNAP = 8;
      const guidesX: number[] = [];
      const guidesY: number[] = [];
      let snapped = false;

      // Snap when offset X is near 0 (image horizontally centered)
      if (Math.abs(newOffX) < IMG_SNAP) {
        guidesX.push(W / 2);
        snapped = true;
      }
      // Snap when offset Y is near 0 (image vertically centered)
      if (Math.abs(newOffY) < IMG_SNAP) {
        guidesY.push(H / 2);
        snapped = true;
      }

      setImageGuides({ x: guidesX, y: guidesY, snapped });
    };
    const handleUp = () => {
      setImagePanning(null);
      setImageGuides({ x: [], y: [], snapped: false });
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [imagePanning, scale, onImagePan, creative.imageTransform]);

  // Image resize (scale) drag effect
  useEffect(() => {
    if (!imageResizing || !onUpdateImage) return;
    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - imageResizing.startX) / scale;
      const dy = (e.clientY - imageResizing.startY) / scale;
      const dist = (dx - dy) / 2;
      const ratio = 1 + dist / 400;
      const newScale = Math.max(0.3, Math.min(4, parseFloat((imageResizing.origScale * ratio).toFixed(2))));
      onUpdateImage({ scale: newScale });
    };
    const handleUp = () => setImageResizing(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [imageResizing, scale, onUpdateImage]);

  // Image rotate drag effect
  useEffect(() => {
    if (!imageRotating || !onUpdateImage) return;
    const handleMove = (e: MouseEvent) => {
      const currentAngle = Math.atan2(e.clientY - imageRotating.centerY, e.clientX - imageRotating.centerX) * (180 / Math.PI);
      const delta = currentAngle - imageRotating.startAngle;
      onUpdateImage({ rotate: Math.round(imageRotating.origRotate + delta) });
    };
    const handleUp = () => setImageRotating(null);
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [imageRotating, onUpdateImage]);

  const [dragging, setDragging] = useState<{
    blockId: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Resize state
  const [resizing, setResizing] = useState<{
    blockId: string;
    handle: "nw" | "ne" | "sw" | "se" | "e" | "w";
    startX: number;
    startY: number;
    origFontSize: number;
    origMaxWidth: number;
  } | null>(null);

  const W = 1080;
  const H = 1920;
  const SNAP_THRESHOLD = 8;

  // Alignment guide state — active during text block dragging
  const [activeGuides, setActiveGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  // Image edit mode guide state — active during image panning
  const [imageGuides, setImageGuides] = useState<{ x: number[]; y: number[]; snapped: boolean }>({ x: [], y: [], snapped: false });

  // Estimate rendered height of a text block (px)
  const estimateBlockHeight = useCallback((block: TextBlock): number => {
    const lineH = block.fontSize * (block.lineHeight || 1.5);
    const contentLines = block.lines.filter((l) => l.trim()).length;
    const emptyLines = block.lines.filter((l) => !l.trim()).length;
    return (
      contentLines * (lineH + block.lineGap) +
      emptyLines * (block.fontSize * 0.5) +
      block.paddingV * 2
    );
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, block: TextBlock) => {
      e.stopPropagation();
      e.preventDefault();
      onSelectBlock(block.id, e.shiftKey);
      // Prevent dragging locked blocks
      if (block.locked) return;
      setDragging({
        blockId: block.id,
        startX: e.clientX,
        startY: e.clientY,
        origX: block.x,
        origY: block.y,
      });
    },
    [onSelectBlock]
  );

  // Resize handlers
  const handleResizeDown = useCallback(
    (e: React.MouseEvent, block: TextBlock, handle: "nw" | "ne" | "sw" | "se" | "e" | "w") => {
      e.stopPropagation();
      e.preventDefault();
      setResizing({
        blockId: block.id,
        handle,
        startX: e.clientX,
        startY: e.clientY,
        origFontSize: block.fontSize,
        origMaxWidth: block.maxWidth,
      });
    },
    []
  );

  // Double-click handler for inline text editing
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent, block: TextBlock) => {
      e.stopPropagation();
      e.preventDefault();
      setEditingBlockId(block.id);
      setEditingText(block.lines.join("\n"));
      // Focus the textarea after render
      setTimeout(() => inlineEditRef.current?.focus(), 0);
    },
    []
  );

  // Commit inline edit — called on blur or Escape
  const commitInlineEdit = useCallback(() => {
    if (!editingBlockId) return;
    const newLines = editingText.split("\n");
    const editingBlock = creative.textBlocks.find((b) => b.id === editingBlockId);
    if (editingBlock) {
      onRecordEdit(editingBlockId, "inline-text", { lines: editingBlock.lines }, { lines: newLines });
    }
    onUpdateBlock(editingBlockId, { lines: newLines });
    setEditingBlockId(null);
    setEditingText("");
  }, [editingBlockId, editingText, creative.textBlocks, onUpdateBlock, onRecordEdit]);

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragging.startX) / scale;
      const dy = (e.clientY - dragging.startY) / scale;
      let rawX = Math.round(dragging.origX + dx);
      let rawY = Math.round(dragging.origY + dy);

      // Find the dragged block to get its dimensions
      const draggedBlock = creative.textBlocks.find((b) => b.id === dragging.blockId);
      if (!draggedBlock) {
        onUpdateBlock(dragging.blockId, { x: rawX, y: rawY });
        return;
      }

      const blockW = draggedBlock.maxWidth;
      const blockH = estimateBlockHeight(draggedBlock);

      // Dragged block edges and center at raw position
      const dLeft = rawX;
      const dRight = rawX + blockW;
      const dCenterX = rawX + blockW / 2;
      const dTop = rawY;
      const dBottom = rawY + blockH;
      const dCenterY = rawY + blockH / 2;

      // Collect all snap targets: canvas center, canvas edges, other blocks
      const snapTargetsX: number[] = [0, W / 2, W]; // canvas left, center, right
      const snapTargetsY: number[] = [0, H / 2, H]; // canvas top, center, bottom

      for (const other of creative.textBlocks) {
        if (other.id === dragging.blockId) continue;
        const oH = estimateBlockHeight(other);
        const oLeft = other.x;
        const oRight = other.x + other.maxWidth;
        const oCenterX = other.x + other.maxWidth / 2;
        const oTop = other.y;
        const oBottom = other.y + oH;
        const oCenterY = other.y + oH / 2;
        snapTargetsX.push(oLeft, oRight, oCenterX);
        snapTargetsY.push(oTop, oBottom, oCenterY);
      }

      // Find the closest X snap
      let bestSnapX: { snappedX: number; guideX: number; dist: number } | null = null;
      for (const target of snapTargetsX) {
        // Check dragged left edge vs target
        const dLeftDist = Math.abs(dLeft - target);
        if (dLeftDist < SNAP_THRESHOLD && (!bestSnapX || dLeftDist < bestSnapX.dist)) {
          bestSnapX = { snappedX: target, guideX: target, dist: dLeftDist };
        }
        // Check dragged right edge vs target
        const dRightDist = Math.abs(dRight - target);
        if (dRightDist < SNAP_THRESHOLD && (!bestSnapX || dRightDist < bestSnapX.dist)) {
          bestSnapX = { snappedX: target - blockW, guideX: target, dist: dRightDist };
        }
        // Check dragged center vs target
        const dCenterDist = Math.abs(dCenterX - target);
        if (dCenterDist < SNAP_THRESHOLD && (!bestSnapX || dCenterDist < bestSnapX.dist)) {
          bestSnapX = { snappedX: target - blockW / 2, guideX: target, dist: dCenterDist };
        }
      }

      // Find the closest Y snap
      let bestSnapY: { snappedY: number; guideY: number; dist: number } | null = null;
      for (const target of snapTargetsY) {
        // Check dragged top edge vs target
        const dTopDist = Math.abs(dTop - target);
        if (dTopDist < SNAP_THRESHOLD && (!bestSnapY || dTopDist < bestSnapY.dist)) {
          bestSnapY = { snappedY: target, guideY: target, dist: dTopDist };
        }
        // Check dragged bottom edge vs target
        const dBottomDist = Math.abs(dBottom - target);
        if (dBottomDist < SNAP_THRESHOLD && (!bestSnapY || dBottomDist < bestSnapY.dist)) {
          bestSnapY = { snappedY: target - blockH, guideY: target, dist: dBottomDist };
        }
        // Check dragged center vs target
        const dCenterYDist = Math.abs(dCenterY - target);
        if (dCenterYDist < SNAP_THRESHOLD && (!bestSnapY || dCenterYDist < bestSnapY.dist)) {
          bestSnapY = { snappedY: target - blockH / 2, guideY: target, dist: dCenterYDist };
        }
      }

      // Apply snaps
      const finalX = bestSnapX ? Math.round(bestSnapX.snappedX) : rawX;
      const finalY = bestSnapY ? Math.round(bestSnapY.snappedY) : rawY;

      // Set active guides (only those that are actually snapping)
      const guidesX = bestSnapX ? [bestSnapX.guideX] : [];
      const guidesY = bestSnapY ? [bestSnapY.guideY] : [];
      setActiveGuides({ x: guidesX, y: guidesY });

      onUpdateBlock(dragging.blockId, { x: finalX, y: finalY });
    };

    const handleUp = () => {
      const afterBlock = creative.textBlocks.find(
        (b) => b.id === dragging.blockId
      );
      if (afterBlock) {
        onRecordEdit(
          dragging.blockId,
          "move",
          { x: dragging.origX, y: dragging.origY },
          { x: afterBlock.x, y: afterBlock.y }
        );
      }
      setDragging(null);
      setActiveGuides({ x: [], y: [] });
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, scale, creative.textBlocks, onUpdateBlock, onRecordEdit, estimateBlockHeight]);

  // Resize effect
  useEffect(() => {
    if (!resizing) return;

    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - resizing.startX) / scale;
      const dy = (e.clientY - resizing.startY) / scale;
      const h = resizing.handle;

      if (h === "e" || h === "w") {
        // Edge handles: change width only
        const widthDelta = h === "e" ? dx : -dx;
        const newWidth = Math.max(200, Math.min(1060, Math.round(resizing.origMaxWidth + widthDelta)));
        onUpdateBlock(resizing.blockId, { maxWidth: newWidth });
      } else {
        // Corner handles: uniform scale (fontSize + width together)
        const dist = (dx + -dy) / 2; // up-right = bigger
        const ratio = 1 + dist / 200;
        const newSize = Math.max(14, Math.min(120, Math.round(resizing.origFontSize * ratio)));
        const newWidth = Math.max(200, Math.min(1060, Math.round(resizing.origMaxWidth * ratio)));
        onUpdateBlock(resizing.blockId, { fontSize: newSize, maxWidth: newWidth });
      }
    };

    const handleUp = () => {
      const afterBlock = creative.textBlocks.find((b) => b.id === resizing.blockId);
      if (afterBlock) {
        onRecordEdit(
          resizing.blockId,
          resizing.handle === "e" || resizing.handle === "w" ? "resize-width" : "resize-scale",
          { fontSize: resizing.origFontSize, maxWidth: resizing.origMaxWidth },
          { fontSize: afterBlock.fontSize, maxWidth: afterBlock.maxWidth }
        );
      }
      setResizing(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [resizing, scale, creative.textBlocks, onUpdateBlock, onRecordEdit]);

  // Marquee selection effect — drag on canvas to select multiple blocks
  useEffect(() => {
    if (!marquee) return;

    const handleMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      setMarquee((m) => m ? { ...m, curX: x, curY: y } : null);
    };

    const handleUp = () => {
      if (marquee) {
        // Calculate marquee bounds
        const mx1 = Math.min(marquee.startX, marquee.curX);
        const my1 = Math.min(marquee.startY, marquee.curY);
        const mx2 = Math.max(marquee.startX, marquee.curX);
        const my2 = Math.max(marquee.startY, marquee.curY);

        // Only select if the marquee was dragged a meaningful distance (>5px)
        if (mx2 - mx1 > 5 || my2 - my1 > 5) {
          // Find blocks that intersect the marquee
          const intersecting = creative.textBlocks.filter((b) => {
            const bx1 = b.x;
            const by1 = b.y;
            const bx2 = b.x + b.maxWidth;
            const by2 = b.y + estimateBlockHeight(b);
            return bx1 < mx2 && bx2 > mx1 && by1 < my2 && by2 > my1;
          });
          if (intersecting.length > 0) {
            onSelectBlock(null); // clear first
            // Select all intersecting by calling with shift for each
            intersecting.forEach((b) => onSelectBlock(b.id, true));
          }
        }
      }
      setMarquee(null);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [marquee, scale, creative.textBlocks, onSelectBlock, estimateBlockHeight]);

  return (
    <div
      ref={canvasRef}
      id="ad-canvas-inner"
      style={{
        width: W,
        height: H,
        position: "relative",
        overflow: imageEditMode ? "visible" : "hidden",
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        borderRadius: imageEditMode ? 0 : 12,
        background: "#1a1726",
      }}
      onClick={(e) => {
        if (!marquee) {
          onSelectBlock(null);
        }
      }}
      onDoubleClick={(e) => {
        if (e.target === e.currentTarget) {
          onImageClick?.();
        }
      }}
      onMouseDown={(e) => {
        if (imageEditMode && onImagePan && e.target === e.currentTarget) {
          setImagePanning({ startX: e.clientX, startY: e.clientY });
        }
        // Start marquee selection on empty canvas (not on a block, not in image edit mode)
        if (!imageEditMode && e.target === e.currentTarget) {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (rect) {
            const x = (e.clientX - rect.left) / scale;
            const y = (e.clientY - rect.top) / scale;
            setMarquee({ startX: x, startY: y, curX: x, curY: y });
          }
        }
      }}
    >
      {/* Photo background — in image edit mode, show full image overflowing canvas bounds */}
      {(() => {
        const t = creative.imageTransform;
        const imgScale = t?.scale || 1;
        const imgRotate = t?.rotate || 0;
        const imgOffX = t?.offsetX || 0;
        const imgOffY = t?.offsetY || 0;

        // In edit mode with known dimensions, render at cover-fit size (overflows visible)
        if (imageEditMode && naturalDims) {
          const imgRatio = naturalDims.w / naturalDims.h;
          const canvasRatio = W / H;
          let coverW: number, coverH: number;
          if (imgRatio > canvasRatio) {
            coverH = H;
            coverW = H * imgRatio;
          } else {
            coverW = W;
            coverH = W / imgRatio;
          }
          const coverX = (W - coverW) / 2;
          const coverY = (H - coverH) / 2;

          return (
            <img
              src={creative.photoUrl}
              alt="Ad background"
              style={{
                width: coverW,
                height: coverH,
                objectFit: "fill",
                position: "absolute",
                left: coverX,
                top: coverY,
                transform: `scale(${imgScale}) rotate(${imgRotate}deg) translate(${imgOffX}px, ${imgOffY}px)`,
                transformOrigin: "center center",
                opacity: 0.45,
                zIndex: 0,
              }}
              draggable={false}
              onMouseDown={(e) => {
                if (onImagePan) {
                  e.stopPropagation();
                  setImagePanning({ startX: e.clientX, startY: e.clientY });
                }
              }}
            />
          );
        }

        // Normal mode — object-fit: cover for browser display
        // (export uses prepareForCapture to swap to manual cover-fit dimensions)
        return (
          <img
            src={creative.photoUrl}
            alt="Ad background"
            data-ad-bg="true"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              position: "absolute",
              top: 0,
              left: 0,
              transform: `scale(${imgScale}) rotate(${imgRotate}deg) translate(${imgOffX}px, ${imgOffY}px)`,
              transformOrigin: "center center",
            }}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            onMouseDown={(e) => {
              if (imageEditMode && onImagePan) {
                e.stopPropagation();
                setImagePanning({ startX: e.clientX, startY: e.clientY });
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onImageClick?.();
            }}
          />
        );
      })()}

      {/* In-crop visible image (full brightness, clipped to canvas bounds) */}
      {imageEditMode && naturalDims && (() => {
        const t = creative.imageTransform;
        const imgScale = t?.scale || 1;
        const imgRotate = t?.rotate || 0;
        const imgOffX = t?.offsetX || 0;
        const imgOffY = t?.offsetY || 0;
        const imgRatio = naturalDims.w / naturalDims.h;
        const canvasRatio = W / H;
        let coverW: number, coverH: number;
        if (imgRatio > canvasRatio) {
          coverH = H;
          coverW = H * imgRatio;
        } else {
          coverW = W;
          coverH = W / imgRatio;
        }
        const coverX = (W - coverW) / 2;
        const coverY = (H - coverH) / 2;
        return (
          <div style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            zIndex: 1,
            pointerEvents: "none",
          }}>
            <img
              src={creative.photoUrl}
              alt="Crop preview"
              style={{
                width: coverW,
                height: coverH,
                objectFit: "fill",
                position: "absolute",
                left: coverX,
                top: coverY,
                transform: `scale(${imgScale}) rotate(${imgRotate}deg) translate(${imgOffX}px, ${imgOffY}px)`,
                transformOrigin: "center center",
              }}
              draggable={false}
            />
          </div>
        );
      })()}

      {/* Subtle gradient overlays */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "22%",
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "35%",
          background: "linear-gradient(to top, rgba(0,0,0,0.45), transparent)",
          pointerEvents: "none",
        }}
      />

      {/* Image edit handles — visible when imageEditMode is on */}
      {imageEditMode && (
        <>
          {/* Canvas boundary border — bright and visible during image editing */}
          <div style={{
            position: "absolute",
            inset: 0,
            border: imageGuides.snapped
              ? "3px solid rgba(201, 169, 110, 1)"
              : "2px solid rgba(201, 169, 110, 0.6)",
            borderRadius: 12,
            pointerEvents: "none",
            zIndex: 4,
            boxShadow: imageGuides.snapped
              ? "inset 0 0 20px rgba(201, 169, 110, 0.15), 0 0 12px rgba(201, 169, 110, 0.3)"
              : "none",
            transition: "border 0.1s, box-shadow 0.15s",
          }} />
          {/* Corner handles for scaling */}
          {([
            { top: -14, left: -14, cursor: "nwse-resize" } as React.CSSProperties,
            { top: -14, right: -14, cursor: "nesw-resize" } as React.CSSProperties,
            { bottom: -14, left: -14, cursor: "nesw-resize" } as React.CSSProperties,
            { bottom: -14, right: -14, cursor: "nwse-resize" } as React.CSSProperties,
          ]).map((posStyle, i) => (
            <div
              key={`img-corner-${i}`}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setImageResizing({
                  startX: e.clientX,
                  startY: e.clientY,
                  origScale: creative.imageTransform?.scale || 1,
                });
              }}
              style={{
                position: "absolute",
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#7C5CFC",
                border: "3px solid #fff",
                boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                zIndex: 6,
                ...posStyle,
              }}
            />
          ))}
          {/* Edge handles for scaling */}
          {([
            { top: "50%", left: -12, cursor: "ew-resize", transform: "translateY(-50%)", width: 14, height: 48 } as React.CSSProperties,
            { top: "50%", right: -12, cursor: "ew-resize", transform: "translateY(-50%)", width: 14, height: 48 } as React.CSSProperties,
            { left: "50%", top: -12, cursor: "ns-resize", transform: "translateX(-50%)", width: 48, height: 14 } as React.CSSProperties,
            { left: "50%", bottom: -12, cursor: "ns-resize", transform: "translateX(-50%)", width: 48, height: 14 } as React.CSSProperties,
          ]).map((posStyle, i) => (
            <div
              key={`img-edge-${i}`}
              onMouseDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setImageResizing({
                  startX: e.clientX,
                  startY: e.clientY,
                  origScale: creative.imageTransform?.scale || 1,
                });
              }}
              style={{
                position: "absolute",
                borderRadius: 7,
                background: "#7C5CFC",
                border: "3px solid #fff",
                boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
                zIndex: 6,
                ...posStyle,
              }}
            />
          ))}
          {/* Rotation handle — semicircular arrow at bottom-left */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return;
              const centerX = rect.left + rect.width / 2;
              const centerY = rect.top + rect.height / 2;
              const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
              setImageRotating({
                startAngle: angle,
                origRotate: creative.imageTransform?.rotate || 0,
                centerX,
                centerY,
              });
            }}
            style={{
              position: "absolute",
              bottom: 40,
              left: -55,
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: "#7C5CFC",
              border: "3px solid #fff",
              boxShadow: "0 2px 10px rgba(0,0,0,0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "grab",
              zIndex: 6,
            }}
          >
            <RotateCcw size={18} color="#fff" />
          </div>
        </>
      )}

      {/* Text blocks */}
      {creative.textBlocks.map((block) => {
        const isSelected = selectedBlockIds.has(block.id);
        const isCentered = block.align === "center";

        // Figma-style corner handle: white circle with shadow
        const cornerHandle = (pos: {
          top?: number | string;
          bottom?: number | string;
          left?: number | string;
          right?: number | string;
          cursor: string;
        }, handle: "nw" | "ne" | "sw" | "se"): React.ReactNode => (
          <div
            key={handle}
            onMouseDown={(e) => handleResizeDown(e, block, handle)}
            style={{
              position: "absolute",
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#ffffff",
              border: "2px solid #c0c0c0",
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
              zIndex: 20,
              ...pos,
            }}
          />
        );

        // Figma-style edge pill handle: white rounded rectangle with shadow
        const edgeHandle = (side: "e" | "w"): React.ReactNode => (
          <div
            key={side}
            onMouseDown={(e) => handleResizeDown(e, block, side)}
            style={{
              position: "absolute",
              width: 14,
              height: 48,
              borderRadius: 7,
              background: "#ffffff",
              border: "2px solid #c0c0c0",
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 20,
              cursor: "ew-resize",
              ...(side === "e" ? { right: -18 } : { left: -18 }),
            }}
          />
        );

        // Top/bottom edge pill handles
        const edgeHandleTB = (side: "n" | "s"): React.ReactNode => (
          <div
            key={side}
            style={{
              position: "absolute",
              width: 48,
              height: 14,
              borderRadius: 7,
              background: "#ffffff",
              border: "2px solid #c0c0c0",
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              pointerEvents: "none" as const,
              ...(side === "n" ? { top: -18 } : { bottom: -18 }),
            }}
          />
        );

        return (
          <div
            key={block.id}
            style={{
              position: "absolute",
              left: block.x,
              top: block.y,
              cursor: block.locked
                ? "default"
                : dragging?.blockId === block.id
                  ? "grabbing"
                  : "grab",
              outline: isSelected
                ? `3px solid ${block.locked ? "#7C5CFC" : "#7B61FF"}`
                : "none",
              outlineOffset: 8,
              boxShadow: isSelected
                ? `0 0 16px ${block.locked ? "rgba(124,92,252,0.4)" : "rgba(123,97,255,0.4)"}`
                : "none",
              zIndex: isSelected ? 10 : 1,
              width: block.maxWidth,
              textAlign: block.align,
              userSelect: "none",
            }}
            onMouseDown={(e) => {
              if (editingBlockId === block.id) return; // don't drag while inline editing
              handleMouseDown(e, block);
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => handleDoubleClick(e, block)}
          >
            {/* Inline text editor — shown on double-click */}
            {editingBlockId === block.id && (
              <textarea
                ref={inlineEditRef}
                value={editingText}
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={commitInlineEdit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    e.preventDefault();
                    commitInlineEdit();
                  }
                }}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  minHeight: "100%",
                  background: `rgba(${hexToRgb(block.bgColor)}, ${Math.max(block.bgOpacity, 0.85)})`,
                  color: block.textColor,
                  fontSize: block.fontSize,
                  fontWeight: block.fontWeight,
                  fontFamily: block.fontFamily,
                  padding: `${block.paddingV}px ${block.paddingH}px`,
                  borderRadius: block.borderRadius,
                  lineHeight: block.lineHeight || 1.5,
                  border: "2px solid #7B61FF",
                  outline: "none",
                  resize: "none",
                  zIndex: 30,
                  textAlign: block.align,
                  cursor: "text",
                  boxSizing: "border-box",
                }}
              />
            )}
            {/* Lock icon overlay for locked blocks */}
            {block.locked && (
              <div
                style={{
                  position: "absolute",
                  top: -12,
                  right: -12,
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#7C5CFC",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 25,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                }}
              >
                <Lock size={12} color="#000" />
              </div>
            )}
            {/* Figma-style resize handles — visible when selected and NOT locked */}
            {isSelected && !dragging && !block.locked && (
              <>
                {cornerHandle({ top: -14, left: -14, cursor: "nwse-resize" }, "nw")}
                {cornerHandle({ top: -14, right: -14, cursor: "nesw-resize" }, "ne")}
                {cornerHandle({ bottom: -14, left: -14, cursor: "nesw-resize" }, "sw")}
                {cornerHandle({ bottom: -14, right: -14, cursor: "nwse-resize" }, "se")}
                {edgeHandle("e")}
                {edgeHandle("w")}
                {edgeHandleTB("n")}
                {edgeHandleTB("s")}
              </>
            )}
            {block.lines.map((line, li) => {
              // Empty lines = visual spacing, no background
              if (!line.trim()) {
                return (
                  <div
                    key={li}
                    style={{
                      height: Math.round(block.fontSize * 0.5 + block.lineGap),
                    }}
                  />
                );
              }
              return (
                <div
                  key={li}
                  style={{
                    display: "inline-block",
                    marginBottom: Math.max(block.lineGap, block.paddingV * 0.5),
                  }}
                >
                  <span
                    style={{
                      display: "inline",
                      backgroundColor: `rgba(${hexToRgb(block.bgColor)}, ${block.bgOpacity})`,
                      color: block.textColor,
                      fontSize: block.fontSize,
                      fontWeight: block.fontWeight,
                      fontFamily: block.fontFamily,
                      padding: `${block.paddingV}px ${block.paddingH}px`,
                      borderRadius: block.borderRadius,
                      lineHeight: block.lineHeight || 1.5,
                      boxDecorationBreak: "clone" as const,
                      WebkitBoxDecorationBreak: "clone" as const,
                    }}
                  >
                    {renderStyledLine(line, block)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Marquee selection rectangle */}
      {marquee && (() => {
        const x = Math.min(marquee.startX, marquee.curX);
        const y = Math.min(marquee.startY, marquee.curY);
        const w = Math.abs(marquee.curX - marquee.startX);
        const h = Math.abs(marquee.curY - marquee.startY);
        return (
          <div style={{
            position: "absolute",
            left: x,
            top: y,
            width: w,
            height: h,
            background: "rgba(59, 130, 246, 0.12)",
            border: "2px solid rgba(59, 130, 246, 0.6)",
            borderRadius: 2,
            pointerEvents: "none",
            zIndex: 60,
          }} />
        );
      })()}

      {/* Alignment guide lines — bold Canva/Photoshop style, visible during drag */}
      {activeGuides.x.map((gx, i) => (
        <div
          key={`guide-x-${i}`}
          style={{
            position: "absolute",
            left: gx - 1,
            top: -20,
            width: 3,
            height: H + 40,
            background: "#ff3366",
            boxShadow: "0 0 12px rgba(255, 51, 102, 0.7), 0 0 4px rgba(255, 51, 102, 0.9)",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      ))}
      {activeGuides.y.map((gy, i) => (
        <div
          key={`guide-y-${i}`}
          style={{
            position: "absolute",
            top: gy - 1,
            left: -20,
            height: 3,
            width: W + 40,
            background: "#ff3366",
            boxShadow: "0 0 12px rgba(255, 51, 102, 0.7), 0 0 4px rgba(255, 51, 102, 0.9)",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      ))}

      {/* Image edit mode — canvas boundary snap guides */}
      {imageEditMode && imageGuides.x.map((gx, i) => (
        <div
          key={`img-guide-x-${i}`}
          style={{
            position: "absolute",
            left: gx - 1,
            top: -20,
            width: imageGuides.snapped ? 3 : 2,
            height: H + 40,
            background: imageGuides.snapped ? "#7C5CFC" : "rgba(201, 169, 110, 0.6)",
            boxShadow: imageGuides.snapped ? "0 0 14px rgba(201, 169, 110, 0.8), 0 0 4px rgba(201, 169, 110, 1)" : "0 0 6px rgba(201, 169, 110, 0.3)",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      ))}
      {imageEditMode && imageGuides.y.map((gy, i) => (
        <div
          key={`img-guide-y-${i}`}
          style={{
            position: "absolute",
            top: gy - 1,
            left: -20,
            height: imageGuides.snapped ? 3 : 2,
            width: W + 40,
            background: imageGuides.snapped ? "#7C5CFC" : "rgba(201, 169, 110, 0.6)",
            boxShadow: imageGuides.snapped ? "0 0 14px rgba(201, 169, 110, 0.8), 0 0 4px rgba(201, 169, 110, 1)" : "0 0 6px rgba(201, 169, 110, 0.3)",
            pointerEvents: "none",
            zIndex: 50,
          }}
        />
      ))}
    </div>
  );
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

/* ──────────────────────── MINI CANVAS (read-only preview) ──────────────────────── */
function MiniCanvas({ creative }: { creative: AdCreative }) {
  const t = creative.imageTransform;
  return (
    <div style={{ width: 1080, height: 1920, position: "relative", overflow: "hidden" }}>
      <img
        src={creative.photoUrl}
        alt=""
        style={{
          width: "100%", height: "100%", objectFit: "cover", position: "absolute", top: 0, left: 0,
          transform: `scale(${t?.scale || 1}) rotate(${t?.rotate || 0}deg) translate(${t?.offsetX || 0}px, ${t?.offsetY || 0}px)`,
          transformOrigin: "center center",
        }}
        draggable={false}
      />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "22%", background: "linear-gradient(to bottom, rgba(0,0,0,0.35), transparent)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "35%", background: "linear-gradient(to top, rgba(0,0,0,0.45), transparent)", pointerEvents: "none" }} />
      {creative.textBlocks.map((block) => (
        <div
          key={block.id}
          style={{
            position: "absolute",
            left: block.x,
            top: block.y,
            width: block.maxWidth,
            textAlign: block.align,
          }}
        >
          {block.lines.map((line, li) => {
            if (!line.trim()) return <div key={li} style={{ height: Math.round(block.fontSize * 0.5 + block.lineGap) }} />;
            return (
              <div key={li} style={{ display: "inline-block", marginBottom: Math.max(block.lineGap, block.paddingV * 0.5) }}>
                <span style={{
                  display: "inline",
                  backgroundColor: `rgba(${hexToRgb(block.bgColor)}, ${block.bgOpacity})`,
                  color: block.textColor,
                  fontSize: block.fontSize,
                  fontWeight: block.fontWeight,
                  fontFamily: block.fontFamily,
                  padding: `${block.paddingV}px ${block.paddingH}px`,
                  borderRadius: block.borderRadius,
                  lineHeight: block.lineHeight || 1.5,
                  boxDecorationBreak: "clone" as const,
                  WebkitBoxDecorationBreak: "clone" as const,
                }}>{renderStyledLine(line, block)}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────── DOCK STRIP ──────────────────────── */
function DockStrip({
  creatives,
  currentIndex,
  onSelect,
}: {
  creatives: AdCreative[];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [stripW, setStripW] = useState(0);

  const BASE_W = 48;
  const BASE_H = 85;
  const GAP = 8;
  const MAX_SCALE = 2.2;
  const INFLUENCE = 110;

  useEffect(() => {
    const measure = () => { if (stripRef.current) setStripW(stripRef.current.offsetWidth); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const totalW = creatives.length * BASE_W + (creatives.length - 1) * GAP;
  const startX = (stripW - totalW) / 2;

  const getScale = (i: number) => {
    if (mouseX === null) return 1;
    const center = startX + i * (BASE_W + GAP) + BASE_W / 2;
    const dist = Math.abs(mouseX - center);
    const t = Math.max(0, 1 - dist / INFLUENCE);
    return 1 + (MAX_SCALE - 1) * t * t;
  };

  if (creatives.length <= 1) return null;

  return (
    <div
      ref={stripRef}
      onMouseMove={(e) => {
        const rect = stripRef.current?.getBoundingClientRect();
        if (rect) setMouseX(e.clientX - rect.left);
      }}
      onMouseLeave={() => setMouseX(null)}
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        gap: GAP,
        padding: "20px 16px 10px",
        minHeight: BASE_H + 30,
        width: "100%",
      }}
    >
      {creatives.map((c, i) => {
        const s = getScale(i);
        const isCurrent = i === currentIndex;
        return (
          <div
            key={c.id}
            onClick={() => onSelect(i)}
            style={{
              width: BASE_W,
              height: BASE_H,
              borderRadius: 8,
              overflow: "hidden",
              cursor: "pointer",
              flexShrink: 0,
              transform: `scale(${s})`,
              transformOrigin: "bottom center",
              transition: mouseX !== null ? "transform 0.06s linear" : "transform 0.3s cubic-bezier(.34,1.56,.64,1)",
              boxShadow: isCurrent
                ? `0 0 0 2px #7C5CFC, 0 4px 16px rgba(124,92,252,0.35)`
                : s > 1.05
                  ? "0 6px 20px rgba(0,0,0,0.5)"
                  : "0 2px 8px rgba(16,14,28,0.7)",
              zIndex: Math.round(s * 10),
              position: "relative",
              opacity: isCurrent ? 1 : mouseX !== null && s < 1.05 ? 0.7 : 0.85,
            }}
          >
            <div style={{ width: BASE_W, height: BASE_H, overflow: "hidden" }}>
              <div style={{ transform: `scale(${BASE_W / 1080})`, transformOrigin: "top left", width: 1080, height: 1920 }}>
                <MiniCanvas creative={c} />
              </div>
            </div>
            <div style={{
              position: "absolute", bottom: 3, right: 3,
              background: isCurrent ? "#7C5CFC" : "rgba(20,17,32,0.85)",
              color: "#fff",
              fontSize: 8, fontWeight: 700,
              width: 14, height: 14, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(4px)",
            }}>
              {i + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────── TEXT EDITOR PANEL ──────────────────────── */
function TextEditorPanel({
  block,
  onUpdate,
  onDelete,
}: {
  block: TextBlock;
  onUpdate: (updates: Partial<TextBlock>) => void;
  onDelete: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [wordTextColor, setWordTextColor] = useState("#ff4444");
  const [wordBgColor, setWordBgColor] = useState("#ffff00");

  const applyWordTextColor = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    if (!sel.trim()) return;
    onUpdate({
      highlightWords: [...(block.highlightWords || []), { word: sel.trim(), textColor: wordTextColor }],
    });
  };

  const applyWordBgColor = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    if (!sel.trim()) return;
    onUpdate({
      highlightWords: [...(block.highlightWords || []), { word: sel.trim(), bgColor: wordBgColor }],
    });
  };

  const removeHighlightWord = (index: number) => {
    onUpdate({
      highlightWords: (block.highlightWords || []).filter((_, i) => i !== index),
    });
  };

  // Inline row: label left, control right
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
      <span style={panelLabelStyle}>{label}</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>{children}</div>
    </div>
  );

  const recessedInput: React.CSSProperties = {
    width: "100%",
    background: "rgba(16,14,28,0.7)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 5,
    color: "rgba(255,255,255,0.85)",
    padding: "4px 8px",
    height: 28,
    fontSize: 12,
    fontFamily: "inherit",
    outline: "none",
  };

  const sliderStyle: React.CSSProperties = {
    flex: 1,
    accentColor: "#7C5CFC",
    height: 3,
    cursor: "pointer",
  };

  return (
    <div style={{
      borderRadius: 8,
      background: "rgba(26,23,42,0.7)",
      border: "1px solid rgba(255,255,255,0.06)",
      padding: "10px 10px",
      display: "flex",
      flexDirection: "column",
      gap: 6,
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(124,92,252,0.8)", letterSpacing: 0.5 }}>
          Text properties
        </span>
        <button
          onClick={onDelete}
          style={{
            background: "rgba(255,80,80,0.08)",
            border: "none",
            color: "rgba(255,100,100,0.6)",
            padding: "3px 6px",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 11,
            transition: "all 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,80,80,0.2)"; e.currentTarget.style.color = "#ff6666"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,80,80,0.08)"; e.currentTarget.style.color = "rgba(255,100,100,0.6)"; }}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Text content */}
      <textarea
        ref={textareaRef}
        value={block.lines.join("\n")}
        onChange={(e) => onUpdate({ lines: e.target.value.split("\n") })}
        rows={3}
        style={{
          ...recessedInput,
          height: "auto",
          resize: "vertical",
          fontSize: 12,
          lineHeight: 1.4,
        }}
      />

      {/* Word styling */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <span style={{ ...panelLabelStyle, whiteSpace: "nowrap" }}>Word</span>
        <div style={{ width: 16, height: 16, borderRadius: "50%", overflow: "hidden", flexShrink: 0, position: "relative" }}>
          <input type="color" value={wordTextColor} onChange={(e) => setWordTextColor(e.target.value)} style={{ position: "absolute", inset: -4, width: 24, height: 24, border: "none", cursor: "pointer" }} />
        </div>
        <button onClick={applyWordTextColor} style={{ ...panelBtnStyle, padding: "2px 8px", fontSize: 10 }} title="Apply text color">Aa</button>
        <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.06)" }} />
        <div style={{ width: 16, height: 16, borderRadius: "50%", overflow: "hidden", flexShrink: 0, position: "relative" }}>
          <input type="color" value={wordBgColor} onChange={(e) => setWordBgColor(e.target.value)} style={{ position: "absolute", inset: -4, width: 24, height: 24, border: "none", cursor: "pointer" }} />
        </div>
        <button onClick={applyWordBgColor} style={{ ...panelBtnStyle, padding: "2px 8px", fontSize: 10 }} title="Apply highlight bg">
          <Palette size={10} />
        </button>
      </div>
      {block.highlightWords && block.highlightWords.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
          {block.highlightWords.map((hw, i) => (
            <span key={i} style={{
              display: "inline-flex", alignItems: "center", gap: 3,
              padding: "1px 6px", borderRadius: 4, fontSize: 10,
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(255,255,255,0.5)",
            }}>
              {hw.word}
              <span style={{
                width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                background: hw.textColor || hw.bgColor || "#888",
              }} />
              <button onClick={() => removeHighlightWord(i)} style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.3)",
                cursor: "pointer", fontSize: 10, padding: 0, lineHeight: 1,
              }}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Separator */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "2px 0" }} />

      {/* Font size + Border radius */}
      <Row label="Size">
        <input type="range" min={16} max={80} value={block.fontSize} onChange={(e) => onUpdate({ fontSize: parseInt(e.target.value) })} style={sliderStyle} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>{block.fontSize}</span>
      </Row>
      <Row label="Radius">
        <input type="range" min={0} max={30} value={block.borderRadius} onChange={(e) => onUpdate({ borderRadius: parseInt(e.target.value) })} style={sliderStyle} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>{block.borderRadius}</span>
      </Row>

      {/* Colors — inline with circles */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={panelLabelStyle}>Color</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", overflow: "hidden", flexShrink: 0, position: "relative", border: "1px solid rgba(255,255,255,0.12)" }}>
            <input type="color" value={block.textColor} onChange={(e) => onUpdate({ textColor: e.target.value })} style={{ position: "absolute", inset: -4, width: 24, height: 24, border: "none", cursor: "pointer" }} />
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Text</span>
          <div style={{ width: 16, height: 16, borderRadius: "50%", overflow: "hidden", flexShrink: 0, position: "relative", border: "1px solid rgba(255,255,255,0.12)" }}>
            <input type="color" value={block.bgColor} onChange={(e) => onUpdate({ bgColor: e.target.value })} style={{ position: "absolute", inset: -4, width: 24, height: 24, border: "none", cursor: "pointer" }} />
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>BG</span>
        </div>
      </div>

      {/* BG Opacity */}
      <Row label="Opacity">
        <input type="range" min={0} max={100} value={Math.round(block.bgOpacity * 100)} onChange={(e) => onUpdate({ bgOpacity: parseInt(e.target.value) / 100 })} style={sliderStyle} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>{Math.round(block.bgOpacity * 100)}%</span>
      </Row>

      {/* Text alignment */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
        <span style={panelLabelStyle}>Align</span>
        <div style={{ display: "flex", gap: 2, flex: 1 }}>
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              onClick={() => onUpdate({ align: a })}
              style={{
                flex: 1,
                padding: "4px 0",
                borderRadius: 4,
                border: "none",
                background: block.align === a ? "rgba(124,92,252,0.2)" : "rgba(255,255,255,0.03)",
                color: block.align === a ? "#7C5CFC" : "rgba(255,255,255,0.35)",
                cursor: "pointer",
                fontSize: 10,
                fontWeight: 600,
                transition: "all 0.12s",
              }}
            >
              {a[0].toUpperCase() + a.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Separator */}
      <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "2px 0" }} />

      {/* Max Width */}
      <Row label="Width">
        <input type="range" min={200} max={1060} value={block.maxWidth} onChange={(e) => onUpdate({ maxWidth: parseInt(e.target.value) })} style={sliderStyle} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 32, textAlign: "right" }}>{block.maxWidth}</span>
      </Row>

      {/* Line Height + Gap */}
      <Row label="Height">
        <input type="range" min={100} max={250} step={5} value={Math.round((block.lineHeight || 1.5) * 100)} onChange={(e) => onUpdate({ lineHeight: parseInt(e.target.value) / 100 })} style={sliderStyle} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>{(block.lineHeight || 1.5).toFixed(1)}×</span>
      </Row>
      <Row label="Gap">
        <input type="range" min={0} max={40} value={block.lineGap} onChange={(e) => onUpdate({ lineGap: parseInt(e.target.value) })} style={sliderStyle} />
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>{block.lineGap}</span>
      </Row>

      {/* Position */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
        <span style={panelLabelStyle}>Pos</span>
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          <input type="number" value={block.x} onChange={(e) => onUpdate({ x: parseInt(e.target.value) || 0 })} style={{ ...recessedInput, width: "50%" }} />
          <input type="number" value={block.y} onChange={(e) => onUpdate({ y: parseInt(e.target.value) || 0 })} style={{ ...recessedInput, width: "50%" }} />
        </div>
      </div>
    </div>
  );
}

/* Panel-wide shared styles — compact Affinity/Photoshop feel */
const panelLabelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 400,
  color: "rgba(255,255,255,0.35)",
  minWidth: 42,
  flexShrink: 0,
};

const panelBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: "rgba(255,255,255,0.55)",
  padding: "6px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 500,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  transition: "all 0.12s",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 400,
  color: "rgba(255,255,255,0.35)",
  marginBottom: 4,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(16,14,28,0.7)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 5,
  color: "rgba(255,255,255,0.85)",
  padding: "6px 10px",
  fontSize: 12,
  fontFamily: "inherit",
  resize: "vertical",
};

/* ──────────────────────── MAIN ADS STUDIO ──────────────────────── */
export default function AdsPage() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedBlockIds, setSelectedBlockIds] = useState<Set<string>>(new Set());
  const [copyText, setCopyText] = useState("");
  const [projectName, setProjectName] = useState("New Ad Batch");
  const [view, setView] = useState<"setup" | "editor">("setup");
  const [saving, setSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState("");
  const [relayouting, setRelayouting] = useState(false);
  const [editHistory, setEditHistory] = useState<
    { blockId: string; type: string; before: unknown; after: unknown; timestamp: number }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  // Copy/paste style ref — stores style properties for Cmd+Alt+C / Cmd+Alt+V
  const copiedStyleRef = useRef<Partial<Omit<TextBlock, "id" | "lines" | "x" | "y" | "locked">> | null>(null);

  // Arrow key nudge debounce — pushUndo only on first keydown, not while held
  const nudgeUndoPushedRef = useRef(false);

  // Proportional scale slider — stores base sizes at drag start
  const scaleBaseRef = useRef<Map<string, { fontSize: number; paddingH: number; paddingV: number; borderRadius: number }> | null>(null);

  // Undo/Redo stacks
  const [undoStack, setUndoStack] = useState<AdCreative[][]>([]);
  const [redoStack, setRedoStack] = useState<AdCreative[][]>([]);

  // Image edit mode
  const [imageEditMode, setImageEditMode] = useState(false);

  const currentCreative = creatives[currentIndex];
  // Primary selected block (last one added to set) — used for sidebar editor
  const selectedBlockId = selectedBlockIds.size > 0 ? [...selectedBlockIds].at(-1)! : null;
  const selectedBlock = currentCreative?.textBlocks.find(
    (b) => b.id === selectedBlockId
  );

  // Push undo snapshot (call BEFORE every mutation)
  const pushUndo = useCallback(() => {
    setUndoStack((s) => [...s.slice(-49), creatives]);
    setRedoStack([]);
  }, [creatives]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, creatives]);
    setCreatives(prev);
    setUndoStack((s) => s.slice(0, -1));
  }, [undoStack, creatives]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((s) => [...s, creatives]);
    setCreatives(next);
    setRedoStack((r) => r.slice(0, -1));
  }, [redoStack, creatives]);

  // Keyboard shortcuts — see comprehensive handler after all callbacks are defined

  // Calculate scale to fit editor in viewport — uses both height and width
  const [scale, setScale] = useState(0.35);
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const updateScale = () => {
      const availableHeight = window.innerHeight - 160; // toolbar + dock strip
      const availableWidth = window.innerWidth - 220 - 340 - 40; // nav sidebar + editor panel + gap
      const scaleH = availableHeight / 1920;
      const scaleW = availableWidth / 1080;
      const s = Math.min(scaleH, scaleW, 0.55);
      setScale(Math.max(0.15, s));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, []);

  // Trackpad pinch-to-zoom (wheel event with ctrlKey = pinch gesture)
  useEffect(() => {
    const el = canvasAreaRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        // Pinch zoom: deltaY negative = zoom in, positive = zoom out
        const zoomSpeed = 0.002;
        setScale((prev) => {
          const next = prev - e.deltaY * zoomSpeed;
          return Math.max(0.15, Math.min(0.7, parseFloat(next.toFixed(3))));
        });
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Handle photo upload (local)
  const handlePhotoDrop = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      files.forEach((file) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          setPhotos((prev) => [...prev, ev.target?.result as string]);
        };
        reader.readAsDataURL(file);
      });
    },
    []
  );

  // Estimate rendered height of a text block (px)
  const estimateBlockHeight = (block: TextBlock): number => {
    const lineH = block.fontSize * (block.lineHeight || 1.5);
    const contentLines = block.lines.filter((l) => l.trim()).length;
    const emptyLines = block.lines.filter((l) => !l.trim()).length;
    return (
      contentLines * (lineH + block.lineGap) +
      emptyLines * (block.fontSize * 0.5) +
      block.paddingV * 2
    );
  };

  // ── Parse copy into per-ad groups ──
  // Detects separators like -----, =====, or ~~~~ to split distinct ads.
  // Within each ad, blank lines separate text blocks (title / body / CTA).
  const parseCopyIntoAds = useCallback((raw: string): string[][][] => {
    if (!raw.trim()) return [];

    // Split on separator lines (3+ dashes, equals, or tildes)
    const separatorRe = /^[\-=~]{3,}\s*$/;
    const adChunks: string[] = [];
    let current: string[] = [];

    raw.split("\n").forEach((line) => {
      if (separatorRe.test(line)) {
        if (current.length > 0) {
          adChunks.push(current.join("\n"));
          current = [];
        }
      } else {
        current.push(line);
      }
    });
    if (current.length > 0) adChunks.push(current.join("\n"));

    // For each ad chunk, split into sections by blank lines
    return adChunks.map((chunk) => {
      const sections: string[][] = [];
      let sec: string[] = [];
      chunk.split("\n").forEach((line) => {
        if (!line.trim() && sec.length > 0) {
          sections.push(sec);
          sec = [];
        } else if (line.trim()) {
          sec.push(line);
        }
      });
      if (sec.length > 0) sections.push(sec);
      return sections;
    }).filter((s) => s.length > 0);
  }, []);

  // ── AI Photo Analysis ──
  type AIAnalysis = {
    face: { centerX: number; centerY: number; radius: number };
    textSide: "left" | "center" | "right";
    titleY: number;
    bodyY: number;
    ctaY: number;
  };

  // Compress image to max 1024px dimension before sending to API
  // Full-res photos can be 5-20MB as base64 — far too large for Vercel's 4.5MB body limit
  const compressImage = useCallback(async (dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const MAX_DIM = 1024;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(dataUrl); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = () => resolve(dataUrl); // fallback to original on error
      img.src = dataUrl;
    });
  }, []);

  const analyzePhoto = useCallback(async (photoBase64: string): Promise<AIAnalysis | null> => {
    try {
      // Compress image first to avoid Vercel body size limits
      const compressed = await compressImage(photoBase64);

      // 30-second timeout to prevent hanging
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch("/api/ads/analyze-photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoBase64: compressed }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      if (data.error) return null;
      return data;
    } catch {
      return null;
    }
  }, [compressImage]);

  // Build text blocks with smart sizing per section role
  const makeBlock = useCallback((
    lines: string[],
    role: "title" | "body" | "callout" | "cta",
  ): TextBlock => {
    const W = 1080;
    const isTitle = role === "title";
    const isCta = role === "cta";
    const isCallout = role === "callout";
    return {
      id: uid(),
      lines,
      x: role === "body" ? 60 : (W - 960) / 2,
      y: 0,
      fontSize: isTitle ? 72 : isCta ? 56 : isCallout ? 52 : 44,
      fontFamily: "Inter, SF Pro Display, system-ui",
      fontWeight: 700,
      textColor: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 1,
      borderRadius: isTitle ? 18 : isCta ? 16 : 14,
      paddingH: isTitle ? 32 : isCta ? 28 : 24,
      paddingV: isTitle ? 18 : isCta ? 18 : 14,
      align: role === "body" ? "left" : "center",
      lineGap: 8,
      lineHeight: 1.5,
      highlightWords: [],
      maxWidth: 960,
    };
  }, []);

  // Default vertical layout (fallback when AI is unavailable)
  const layoutBlocksDefault = useCallback((blocks: TextBlock[]) => {
    const W = 1080;
    const H = 1920;
    const MARGIN_TOP = 60;
    const MARGIN_BOTTOM = 80;
    const GAP = 40;
    const heights = blocks.map((b) => estimateBlockHeight(b));

    if (blocks.length <= 2) {
      blocks[0].y = MARGIN_TOP;
      if (blocks.length === 2) blocks[1].y = H - MARGIN_BOTTOM - heights[1];
    } else {
      blocks[0].y = MARGIN_TOP;
      const lastIdx = blocks.length - 1;
      blocks[lastIdx].y = H - MARGIN_BOTTOM - heights[lastIdx];

      const middleTop = blocks[0].y + heights[0] + GAP;
      const middleBottom = blocks[lastIdx].y - GAP;
      const middleBlocks = blocks.slice(1, lastIdx);
      const middleHeights = heights.slice(1, lastIdx);
      const middleTotalH = middleHeights.reduce((s, h) => s + h, 0);
      const middleGap =
        middleBlocks.length > 1
          ? Math.min(GAP * 2, (middleBottom - middleTop - middleTotalH) / (middleBlocks.length - 1))
          : 0;

      if (middleBlocks.length === 1) {
        middleBlocks[0].y = Math.round((middleTop + middleBottom - middleHeights[0]) / 2);
      } else {
        let curY = middleTop;
        middleBlocks.forEach((b, mi) => {
          b.y = Math.round(curY);
          curY += middleHeights[mi] + middleGap;
        });
      }
    }

    blocks.forEach((b) => {
      if (b.align === "left") b.x = 80;
      else b.x = (W - b.maxWidth) / 2;
    });

    return blocks;
  }, [estimateBlockHeight]);

  // AI-guided layout — uses face position + text side to place blocks smartly
  const layoutBlocksAI = useCallback((blocks: TextBlock[], analysis: AIAnalysis) => {
    const W = 1080;
    const DEAD_ZONE_Y = 1440;
    const MIN_GAP = 30; // minimum px between blocks
    const FULL_WIDTH = 920; // near-full canvas width
    const SIDE_WIDTH = 700; // width when text is on one side

    const side = analysis.textSide || "left";
    const face = analysis.face || { centerX: 540, centerY: 400, radius: 150 };

    // Determine X position and width based on which side
    let textX: number;
    let textW: number;
    let textAlign: "left" | "center" | "right";

    if (side === "left") {
      textX = 60;
      textW = Math.min(SIDE_WIDTH, face.centerX - face.radius - 20);
      textW = Math.max(textW, 500); // never go below 500px
      textW = Math.min(textW, FULL_WIDTH);
      textAlign = "left";
    } else if (side === "right") {
      textW = Math.min(SIDE_WIDTH, W - face.centerX - face.radius - 20);
      textW = Math.max(textW, 500);
      textW = Math.min(textW, FULL_WIDTH);
      textX = W - textW - 60;
      textAlign = "left"; // left-align text even on right side for readability
    } else {
      // center — use full width
      textX = (W - FULL_WIDTH) / 2;
      textW = FULL_WIDTH;
      textAlign = "center";
    }

    // Get Y positions from AI, with strong validation
    let titleY = Math.max(50, Math.min(analysis.titleY || 80, 300));
    let bodyY = Math.max(350, Math.min(analysis.bodyY || 500, 900));
    let ctaY = Math.max(1050, Math.min(analysis.ctaY || 1200, 1350));

    // If the face is near the top, push title down below it
    if (face.centerY - face.radius < 300 && face.centerY + face.radius > titleY) {
      titleY = Math.min(face.centerY + face.radius + 40, 350);
    }

    // Assign positions to blocks — spread evenly across title → body → cta range
    if (blocks.length === 1) {
      blocks[0].x = textX;
      blocks[0].y = titleY;
      blocks[0].maxWidth = textW;
      blocks[0].align = textAlign;
    } else if (blocks.length === 2) {
      blocks[0].x = textX;
      blocks[0].y = titleY;
      blocks[0].maxWidth = textW;
      blocks[0].align = textAlign;
      blocks[1].x = textX;
      blocks[1].y = ctaY;
      blocks[1].maxWidth = textW;
      blocks[1].align = textAlign;
    } else {
      // 3+ blocks: title at top, CTA at bottom, body blocks spread in between
      blocks[0].x = textX;
      blocks[0].y = titleY;
      blocks[0].maxWidth = textW;
      blocks[0].align = textAlign;

      const lastIdx = blocks.length - 1;
      blocks[lastIdx].x = textX;
      blocks[lastIdx].y = ctaY;
      blocks[lastIdx].maxWidth = textW;
      blocks[lastIdx].align = textAlign;

      // Spread middle blocks evenly between title bottom and CTA top
      const titleBottom = titleY + estimateBlockHeight(blocks[0]) + MIN_GAP;
      const ctaTop = ctaY - MIN_GAP;
      const middleBlocks = blocks.slice(1, lastIdx);
      const middleCount = middleBlocks.length;

      if (middleCount === 1) {
        middleBlocks[0].x = textX;
        middleBlocks[0].y = Math.round((titleBottom + ctaTop) / 2 - estimateBlockHeight(middleBlocks[0]) / 2);
        middleBlocks[0].maxWidth = textW;
        middleBlocks[0].align = textAlign === "center" ? "center" : "left";
      } else {
        const middleHeights = middleBlocks.map((b) => estimateBlockHeight(b));
        const totalMiddleH = middleHeights.reduce((s, h) => s + h, 0);
        const availableSpace = ctaTop - titleBottom;
        const gap = Math.max(MIN_GAP, (availableSpace - totalMiddleH) / (middleCount + 1));

        let curY = titleBottom + gap;
        middleBlocks.forEach((b, mi) => {
          b.x = textX;
          b.y = Math.round(curY);
          b.maxWidth = textW;
          b.align = textAlign === "center" ? "center" : "left";
          curY += middleHeights[mi] + gap;
        });
      }
    }

    // Final safety pass: ensure nothing is in the dead zone and no overlaps
    blocks.forEach((block) => {
      const height = estimateBlockHeight(block);
      if (block.y + height > DEAD_ZONE_Y) {
        block.y = DEAD_ZONE_Y - height - 30;
      }
      block.y = Math.max(40, block.y);
    });

    // Fix any overlaps by pushing blocks down
    for (let i = 1; i < blocks.length; i++) {
      const prevBottom = blocks[i - 1].y + estimateBlockHeight(blocks[i - 1]) + MIN_GAP;
      if (blocks[i].y < prevBottom) {
        blocks[i].y = prevBottom;
      }
    }

    return blocks;
  }, [estimateBlockHeight]);

  // Build blocks for a set of copy sections
  const buildBlocksForSections = useCallback((sections: string[][]): TextBlock[] => {
    return sections.map((lines, i) => {
      if (i === 0) return makeBlock(lines, "title");
      if (sections.length > 2 && i === sections.length - 1) return makeBlock(lines, "cta");
      if (sections.length > 3 && i === sections.length - 2) return makeBlock(lines, "callout");
      return makeBlock(lines, "body");
    });
  }, [makeBlock]);

  // Generate creatives from photos + copy (with AI layout analysis)
  const handleGenerate = useCallback(async () => {
    if (photos.length === 0) return;

    setGenerating(true);
    setGenProgress(`Analyzing photo 1 of ${photos.length}...`);

    try {
      // Parse into distinct ads
      let adGroups = parseCopyIntoAds(copyText);

      const defaultSections: string[][] = [
        ["*NEW* Free Winter", "Weight Loss Challenge"],
        [
          "- 6 weeks",
          "- my workout plan to get absolutely diced",
          "- dead simple diet plan (no counting macros)",
          "- accountability group so you actually stick w/ it",
        ],
        ["Free. Not eventually free.", 'Not "free trial." Free free.'],
        ["DM to join before I start", "charging for this."],
      ];

      if (adGroups.length === 0) {
        adGroups = [defaultSections];
      }

      // Analyze all photos in parallel with individual error handling
      setGenProgress(`Analyzing ${photos.length} photo${photos.length > 1 ? "s" : ""}...`);
      const analyses = await Promise.allSettled(
        photos.map(async (url, i) => {
          setGenProgress(`Analyzing photo ${i + 1} of ${photos.length}...`);
          return analyzePhoto(url);
        })
      );

      setGenProgress("Building layouts...");

      // Build creatives with AI-guided or fallback layout
      const newCreatives: AdCreative[] = photos.map((url, photoIdx) => {
        const adIdx = adGroups.length === 1 ? 0 : photoIdx % adGroups.length;
        const sections = adGroups[adIdx];
        const blocks = buildBlocksForSections(sections);

        // Get AI analysis result for this photo
        const analysisResult = analyses[photoIdx];
        const aiData = analysisResult?.status === "fulfilled" ? analysisResult.value : null;

        // Use AI layout if available, otherwise fall back to default
        if (aiData) {
          layoutBlocksAI(blocks, aiData);
        } else {
          layoutBlocksDefault(blocks);
        }

        return {
          id: uid(),
          photoUrl: url,
          textBlocks: blocks.map((b) => ({ ...b, id: uid() })),
          imageTransform: { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 },
          status: "draft" as const,
        };
      });

      setCreatives(newCreatives);
      setCurrentIndex(0);
      setView("editor");
    } catch (err) {
      console.error("Generate failed:", err);
    } finally {
      // ALWAYS clear loading state — prevents permanent stuck screen
      setGenerating(false);
      setGenProgress("");
    }
  }, [photos, copyText, parseCopyIntoAds, analyzePhoto, buildBlocksForSections, layoutBlocksAI, layoutBlocksDefault]);

  // Re-layout current creative with AI (re-analyze the current photo)
  const handleRelayout = useCallback(async () => {
    if (!currentCreative) return;
    setRelayouting(true);

    try {
      const analysis = await analyzePhoto(currentCreative.photoUrl);

      if (analysis) {
        pushUndo();
        setCreatives((prev) =>
          prev.map((c, i) => {
            if (i !== currentIndex) return c;
            // Rebuild blocks with current text but AI-positioned layout
            const blocks = c.textBlocks.map((b) => ({ ...b }));
            layoutBlocksAI(blocks, analysis);
            return { ...c, textBlocks: blocks };
          })
        );
      }
    } catch (err) {
      console.error("Re-layout failed:", err);
    } finally {
      setRelayouting(false);
    }
  }, [currentCreative, currentIndex, analyzePhoto, layoutBlocksAI, pushUndo]);

  // Update a text block
  const handleUpdateBlock = useCallback(
    (blockId: string, updates: Partial<TextBlock>) => {
      pushUndo();
      setCreatives((prev) =>
        prev.map((c, i) =>
          i === currentIndex
            ? {
                ...c,
                textBlocks: c.textBlocks.map((b) =>
                  b.id === blockId ? { ...b, ...updates } : b
                ),
              }
            : c
        )
      );
    },
    [currentIndex, pushUndo]
  );

  // Record edit for learning — fires for ALL edit types (move, resize, text change, style)
  const handleRecordEdit = useCallback(
    async (blockId: string, type: string, before: unknown, after: unknown) => {
      // Store locally for this-session learning even without DB
      setEditHistory((prev) => [
        ...prev,
        { blockId, type, before, after, timestamp: Date.now() },
      ]);

      if (!currentCreative?.dbId) return;
      try {
        await fetch("/api/ads/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            creativeId: currentCreative.dbId,
            textBlocks: currentCreative.textBlocks,
            editType: type,
            beforeState: before,
            afterState: after,
          }),
        });
      } catch {
        // Silent fail for edit tracking
      }
    },
    [currentCreative]
  );

  // Add new text block
  const handleAddBlock = useCallback(() => {
    pushUndo();
    const existingCount = currentCreative?.textBlocks.length || 0;
    const offsetY = existingCount * 120; // stagger each new block 120px down
    const baseY = 200 + offsetY;
    const newBlock: TextBlock = {
      id: uid(),
      lines: ["New text here"],
      x: 90,
      y: baseY > 1600 ? 200 : baseY,
      fontSize: 52,
      fontFamily: "Inter, SF Pro Display, system-ui",
      fontWeight: 700,
      textColor: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 1,
      borderRadius: 16,
      paddingH: 28,
      paddingV: 16,
      align: "center",
      lineGap: 6,
      lineHeight: 1.5,
      highlightWords: [],
      maxWidth: 900,
    };
    setCreatives((prev) =>
      prev.map((c, i) =>
        i === currentIndex
          ? { ...c, textBlocks: [...c.textBlocks, newBlock] }
          : c
      )
    );
    setSelectedBlockIds(new Set([newBlock.id]));
  }, [currentIndex, currentCreative, pushUndo]);

  // Delete text block
  const handleDeleteBlock = useCallback(
    (blockId: string) => {
      pushUndo();
      setCreatives((prev) =>
        prev.map((c, i) =>
          i === currentIndex
            ? {
                ...c,
                textBlocks: c.textBlocks.filter((b) => b.id !== blockId),
              }
            : c
        )
      );
      setSelectedBlockIds(new Set());
    },
    [currentIndex, pushUndo]
  );

  // Update image transform
  const handleUpdateImage = useCallback(
    (updates: Partial<AdCreative["imageTransform"]>) => {
      pushUndo();
      setCreatives((prev) =>
        prev.map((c, i) =>
          i === currentIndex
            ? { ...c, imageTransform: { ...(c.imageTransform || { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 }), ...updates } }
            : c
        )
      );
    },
    [currentIndex, pushUndo]
  );

  // Image pan handler (called from canvas drag)
  const handleImagePan = useCallback(
    (dx: number, dy: number) => {
      setCreatives((prev) =>
        prev.map((c, i) =>
          i === currentIndex
            ? {
                ...c,
                imageTransform: {
                  ...(c.imageTransform || { scale: 1, rotate: 0, offsetX: 0, offsetY: 0 }),
                  offsetX: (c.imageTransform?.offsetX || 0) + dx,
                  offsetY: (c.imageTransform?.offsetY || 0) + dy,
                },
              }
            : c
        )
      );
    },
    [currentIndex]
  );

  // ── EXPORT ENGINE ──────────────────────────────────────────────────────────
  // 100% Canvas 2D rendering — no html2canvas. Draws photo, text backgrounds,
  // and text all on the same canvas. Zero alignment issues, pixel-perfect output.

  const canvasRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  };

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] => {
    if (maxW <= 0) return [text];
    const words = text.split(" ");
    const lines: string[] = [];
    let cur = words[0] || "";
    for (let i = 1; i < words.length; i++) {
      const test = cur + " " + words[i];
      if (ctx.measureText(test).width > maxW) {
        lines.push(cur);
        cur = words[i];
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // Render the entire ad to a Canvas 2D — photo, text backgrounds, text
  const renderAdToCanvas = (creative: AdCreative): HTMLCanvasElement => {
    const c = document.createElement("canvas");
    c.width = 2160; // 2x for retina
    c.height = 3840;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2); // draw in 1080x1920 space at 2x resolution

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, 1080, 1920);

    // ── 1. Photo background ──
    const bgImg = document.querySelector('#ad-canvas-inner img[data-ad-bg="true"]') as HTMLImageElement | null;
    if (bgImg && bgImg.naturalWidth && bgImg.naturalHeight) {
      const imgR = bgImg.naturalWidth / bgImg.naturalHeight;
      const canR = 1080 / 1920;
      let sx: number, sy: number, sw: number, sh: number;
      if (imgR > canR) {
        sh = bgImg.naturalHeight; sw = sh * canR;
        sx = (bgImg.naturalWidth - sw) / 2; sy = 0;
      } else {
        sw = bgImg.naturalWidth; sh = sw / canR;
        sx = 0; sy = (bgImg.naturalHeight - sh) / 2;
      }
      const t = creative.imageTransform;
      if (t && (t.scale !== 1 || t.rotate || t.offsetX || t.offsetY)) {
        ctx.save();
        ctx.translate(540, 960);
        ctx.scale(t.scale || 1, t.scale || 1);
        ctx.rotate((t.rotate || 0) * Math.PI / 180);
        ctx.translate(t.offsetX || 0, t.offsetY || 0);
        ctx.translate(-540, -960);
        ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, 1080, 1920);
        ctx.restore();
      } else {
        ctx.drawImage(bgImg, sx, sy, sw, sh, 0, 0, 1080, 1920);
      }
    }

    // ── 2. Text blocks (background rects + text) ──
    for (const block of creative.textBlocks) {
      const { x, y, fontSize, fontWeight, fontFamily, bgColor, bgOpacity,
              paddingH, paddingV, borderRadius, lineHeight: lhMult, lineGap,
              maxWidth, align, lines, textColor, highlightWords } = block;

      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.textBaseline = "alphabetic";
      const lh = fontSize * (lhMult || 1.5);
      const availW = maxWidth - 2 * paddingH;
      let curY = y;

      for (const line of lines) {
        if (!line.trim()) {
          curY += Math.round(fontSize * 0.5 + lineGap);
          continue;
        }

        const wrapped = wrapText(ctx, line, availW);

        for (const wLine of wrapped) {
          const textW = ctx.measureText(wLine).width;
          const bgW = textW + 2 * paddingH;
          const bgH = lh;

          // Horizontal alignment
          let lineX = x;
          if (align === "center") lineX = x + (maxWidth - bgW) / 2;
          else if (align === "right") lineX = x + maxWidth - bgW;

          // Draw background rounded rect
          if (bgOpacity > 0) {
            ctx.fillStyle = `rgba(${hexToRgb(bgColor)}, ${bgOpacity})`;
            canvasRoundRect(ctx, lineX, curY, bgW, bgH, borderRadius);
            ctx.fill();
          }

          // Draw text — handle per-word highlights if any
          const textY = curY + lh * 0.72; // baseline position (~72% of line-height)

          if (highlightWords && highlightWords.length > 0) {
            // Split into styled segments (same logic as renderStyledLine)
            type Seg = { text: string; color?: string; bg?: string };
            const segs: Seg[] = [];
            let rem = wLine;
            while (rem.length > 0) {
              let earliest: { idx: number; len: number; hw: typeof highlightWords[0] } | null = null;
              for (const hw of highlightWords) {
                if (!hw.word) continue;
                const idx = rem.toLowerCase().indexOf(hw.word.toLowerCase());
                if (idx !== -1 && (!earliest || idx < earliest.idx)) {
                  earliest = { idx, len: hw.word.length, hw };
                }
              }
              if (!earliest) { segs.push({ text: rem }); break; }
              if (earliest.idx > 0) segs.push({ text: rem.slice(0, earliest.idx) });
              segs.push({ text: rem.slice(earliest.idx, earliest.idx + earliest.len), color: earliest.hw.textColor, bg: earliest.hw.bgColor });
              rem = rem.slice(earliest.idx + earliest.len);
            }

            let segX = lineX + paddingH;
            for (const seg of segs) {
              const segW = ctx.measureText(seg.text).width;
              if (seg.bg) {
                ctx.fillStyle = seg.bg;
                canvasRoundRect(ctx, segX - 2, curY + 2, segW + 4, lh - 4, 4);
                ctx.fill();
              }
              ctx.fillStyle = seg.color || textColor;
              ctx.fillText(seg.text, segX, textY);
              segX += segW;
            }
          } else {
            ctx.fillStyle = textColor;
            ctx.fillText(wLine, lineX + paddingH, textY);
          }

          curY += bgH + Math.max(lineGap, paddingV * 0.5);
        }
      }
    }

    return c;
  };

  // Export current creative as PNG (2160x3840 retina)
  const handleExport = useCallback(async () => {
    setSelectedBlockIds(new Set());
    await new Promise((r) => setTimeout(r, 50));
    const creative = creatives[currentIndex];
    if (!creative) return;

    const canvas = renderAdToCanvas(creative);

    const link = document.createElement("a");
    link.download = `ad-${currentIndex + 1}.png`;
    link.href = canvas.toDataURL("image/png", 1.0);
    link.click();
  }, [currentIndex, creatives]);

  // Export all creatives as a ZIP file with a dated folder
  const handleExportAll = useCallback(async () => {
    setSelectedBlockIds(new Set());
    await new Promise((r) => setTimeout(r, 50));
    const JSZip = (await import("jszip")).default;

    const zip = new JSZip();

    const now = new Date();
    const date = now.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\//g, "-");
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/:/g, "-").replace(/\s/g, "");
    const folderName = `Ads - ${date} ${time}`;
    const folder = zip.folder(folderName)!;

    for (let i = 0; i < creatives.length; i++) {
      setCurrentIndex(i);
      setGenProgress(`Exporting ad ${i + 1} of ${creatives.length}...`);
      await new Promise((r) => setTimeout(r, 100));

      const creative = creatives[i];
      const canvas = renderAdToCanvas(creative);

      const blob: Blob = await new Promise((resolve) => {
        canvas.toBlob((b) => resolve(b!), "image/png");
      });
      folder.file(`ad-${i + 1}.png`, blob);
    }

    setGenProgress("Zipping...");

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const link = document.createElement("a");
    link.download = `${folderName}.zip`;
    link.href = URL.createObjectURL(zipBlob);
    link.click();
    URL.revokeObjectURL(link.href);
    setGenProgress("");
  }, [creatives]);

  // Copy edits to all
  const handleApplyToAll = useCallback(() => {
    if (!currentCreative) return;
    const blocks = currentCreative.textBlocks;
    setCreatives((prev) =>
      prev.map((c) => ({
        ...c,
        textBlocks: blocks.map((b) => ({ ...b, id: uid() })),
      }))
    );
  }, [currentCreative]);

  // ── Comprehensive keyboard shortcuts ──
  useEffect(() => {
    const isTyping = () => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select";
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only active in editor view
      if (view !== "editor") return;

      const meta = e.metaKey || e.ctrlKey;

      // ── Cmd/Ctrl + Z = Undo, Cmd/Ctrl + Shift + Z = Redo ──
      if (meta && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }

      // ── Cmd/Ctrl + S = Export current ──
      if (meta && !e.shiftKey && !e.altKey && e.key === "s") {
        e.preventDefault();
        handleExport();
        return;
      }

      // ── Cmd/Ctrl + Shift + S = Export all ──
      if (meta && e.shiftKey && !e.altKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        handleExportAll();
        return;
      }

      // ── Cmd/Ctrl + A = Select all blocks ──
      if (meta && (e.key === "a" || e.key === "A") && !e.altKey && !e.shiftKey) {
        if (!isTyping() && currentCreative) {
          e.preventDefault();
          setSelectedBlockIds(new Set(currentCreative.textBlocks.map(b => b.id)));
          return;
        }
      }

      // ── Cmd/Ctrl + Alt + C = Copy style of selected block ──
      // On macOS, Cmd+Alt+C can produce special chars, so check code too
      if (meta && e.altKey && (e.key === "c" || e.key === "C" || e.code === "KeyC")) {
        e.preventDefault();
        if (selectedBlockId && currentCreative) {
          const block = currentCreative.textBlocks.find((b) => b.id === selectedBlockId);
          if (block) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { id, lines, x, y, locked, ...style } = block;
            copiedStyleRef.current = style;
          }
        }
        return;
      }

      // ── Cmd/Ctrl + Alt + V = Paste style onto selected block ──
      if (meta && e.altKey && (e.key === "v" || e.key === "V" || e.code === "KeyV")) {
        e.preventDefault();
        if (selectedBlockId && copiedStyleRef.current) {
          pushUndo();
          setCreatives((prev) =>
            prev.map((c, i) =>
              i === currentIndex
                ? {
                    ...c,
                    textBlocks: c.textBlocks.map((b) =>
                      b.id === selectedBlockId ? { ...b, ...copiedStyleRef.current } : b
                    ),
                  }
                : c
            )
          );
        }
        return;
      }

      // ── Escape = Deselect block + exit image edit mode ──
      if (e.key === "Escape") {
        setSelectedBlockIds(new Set());
        setImageEditMode(false);
        return;
      }

      // ── Delete / Backspace = Delete selected block(s) ──
      if ((e.key === "Delete" || e.key === "Backspace") && !isTyping()) {
        if (selectedBlockIds.size > 0) {
          e.preventDefault();
          pushUndo();
          setCreatives((prev) =>
            prev.map((c, i) =>
              i === currentIndex
                ? { ...c, textBlocks: c.textBlocks.filter((b) => !selectedBlockIds.has(b.id)) }
                : c
            )
          );
          setSelectedBlockIds(new Set());
        }
        return;
      }

      // ── Tab / Shift+Tab = Cycle through text blocks ──
      if (e.key === "Tab" && !isTyping()) {
        e.preventDefault();
        if (!currentCreative || currentCreative.textBlocks.length === 0) return;
        const blocks = currentCreative.textBlocks;
        const currentIdx = blocks.findIndex((b) => b.id === selectedBlockId);
        let nextIdx: number;
        if (e.shiftKey) {
          nextIdx = currentIdx <= 0 ? blocks.length - 1 : currentIdx - 1;
        } else {
          nextIdx = currentIdx >= blocks.length - 1 ? 0 : currentIdx + 1;
        }
        setSelectedBlockIds(new Set([blocks[nextIdx].id]));
        return;
      }

      // ── Arrow keys (when block(s) selected) = Nudge position ──
      if (
        ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) &&
        selectedBlockIds.size > 0 &&
        !isTyping()
      ) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        // Push undo only on first press (not while held)
        if (!nudgeUndoPushedRef.current) {
          pushUndo();
          nudgeUndoPushedRef.current = true;
        }
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        setCreatives((prev) =>
          prev.map((c, i) =>
            i === currentIndex
              ? {
                  ...c,
                  textBlocks: c.textBlocks.map((b) =>
                    selectedBlockIds.has(b.id)
                      ? { ...b, x: b.x + dx, y: b.y + dy }
                      : b
                  ),
                }
              : c
          )
        );
        return;
      }

      // ── Arrow Left/Right (NO block selected, NOT image edit) = Navigate creatives ──
      if (
        (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        selectedBlockIds.size === 0 &&
        !imageEditMode &&
        !isTyping()
      ) {
        e.preventDefault();
        if (creatives.length <= 1) return;
        setCurrentIndex((prev) => {
          if (e.key === "ArrowLeft") {
            return prev <= 0 ? creatives.length - 1 : prev - 1;
          } else {
            return prev >= creatives.length - 1 ? 0 : prev + 1;
          }
        });
        return;
      }

      // ── Letter key shortcuts — only when NOT typing in an input ──
      if (isTyping()) return;

      // ── +/- or =/- keys = Scale selected blocks proportionally ±10% ──
      if ((e.key === "=" || e.key === "+" || e.key === "-" || e.key === "_") && selectedBlockIds.size > 0 && currentCreative) {
        e.preventDefault();
        const factor = (e.key === "=" || e.key === "+") ? 1.1 : 0.9;
        pushUndo();
        setCreatives(prev => prev.map((c, i) =>
          i === currentIndex ? {
            ...c,
            textBlocks: c.textBlocks.map(b => {
              if (!selectedBlockIds.has(b.id)) return b;
              return {
                ...b,
                fontSize: Math.round(b.fontSize * factor),
                paddingH: Math.round(b.paddingH * factor),
                paddingV: Math.round(b.paddingV * factor),
                borderRadius: Math.round(b.borderRadius * factor),
              };
            }),
          } : c
        ));
        return;
      }

      // ── D key = Duplicate selected block ──
      if (e.key === "d" || e.key === "D") {
        if (selectedBlockId && currentCreative) {
          const block = currentCreative.textBlocks.find((b) => b.id === selectedBlockId);
          if (block) {
            pushUndo();
            const newId = uid();
            const clone: TextBlock = { ...block, id: newId, y: block.y + 40 };
            setCreatives((prev) =>
              prev.map((c, i) => {
                if (i !== currentIndex) return c;
                const idx = c.textBlocks.findIndex((b) => b.id === selectedBlockId);
                const newBlocks = [...c.textBlocks];
                newBlocks.splice(idx + 1, 0, clone);
                return { ...c, textBlocks: newBlocks };
              })
            );
            setSelectedBlockIds(new Set([newId]));
          }
        }
        return;
      }

      // ── T key = Add new text block ──
      if (e.key === "t" || e.key === "T") {
        handleAddBlock();
        return;
      }

      // ── L key = Toggle lock on selected block ──
      if (e.key === "l" || e.key === "L") {
        if (selectedBlockId && currentCreative) {
          const block = currentCreative.textBlocks.find((b) => b.id === selectedBlockId);
          if (block) {
            pushUndo();
            setCreatives((prev) =>
              prev.map((c, i) =>
                i === currentIndex
                  ? {
                      ...c,
                      textBlocks: c.textBlocks.map((b) =>
                        b.id === selectedBlockId ? { ...b, locked: !b.locked } : b
                      ),
                    }
                  : c
              )
            );
          }
        }
        return;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Reset nudge undo debounce when arrow key is released
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        nudgeUndoPushedRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    view,
    handleUndo,
    handleRedo,
    handleExport,
    handleExportAll,
    handleAddBlock,
    handleDeleteBlock,
    selectedBlockId,
    selectedBlockIds,
    currentCreative,
    currentIndex,
    creatives,
    imageEditMode,
    pushUndo,
  ]);

  /* ──────── SETUP VIEW ──────── */
  if (view === "setup") {
    return (
      <div className="fade-up">
        <div className="page-header">
          <h1 className="page-title">Ad Studio</h1>
          <p className="page-subtitle">
            Upload photos, paste your copy, generate ads
          </p>
        </div>

        <div className="section">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
            }}
          >
            {/* Photo Upload */}
            <div className="glass-static" style={{ padding: 24 }}>
              <h2
                className="section-title"
                style={{ marginBottom: 16 }}
              >
                <ImagePlus size={16} />
                Photos
              </h2>
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--border-primary)",
                  borderRadius: 12,
                  padding: 40,
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "border-color 0.2s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderColor = "#7C5CFC")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderColor =
                    "var(--border-primary)")
                }
              >
                <Upload
                  size={32}
                  style={{
                    color: "var(--text-muted)",
                    marginBottom: 8,
                  }}
                />
                <p
                  style={{
                    color: "var(--text-secondary)",
                    fontSize: 14,
                  }}
                >
                  Click to upload athlete photos
                </p>
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 12,
                  }}
                >
                  JPG, PNG — select multiple
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: "none" }}
                onChange={handlePhotoDrop}
              />

              {/* Photo grid */}
              {photos.length > 0 && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4, 1fr)",
                    gap: 8,
                    marginTop: 16,
                  }}
                >
                  {photos.map((url, i) => (
                    <div
                      key={i}
                      style={{
                        position: "relative",
                        borderRadius: 8,
                        overflow: "hidden",
                        aspectRatio: "9/16",
                      }}
                    >
                      <img
                        src={url}
                        alt={`Photo ${i + 1}`}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                        }}
                      />
                      <button
                        onClick={() =>
                          setPhotos((prev) =>
                            prev.filter((_, j) => j !== i)
                          )
                        }
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          background: "rgba(0,0,0,0.7)",
                          border: "none",
                          color: "#fff",
                          borderRadius: "50%",
                          width: 20,
                          height: 20,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: 12,
                  marginTop: 8,
                }}
              >
                {photos.length} photo{photos.length !== 1 ? "s" : ""}{" "}
                uploaded
              </p>
            </div>

            {/* Copy Input */}
            <div className="glass-static" style={{ padding: 24 }}>
              <h2
                className="section-title"
                style={{ marginBottom: 16 }}
              >
                <FileText size={16} />
                Ad Copy
              </h2>
              <p
                style={{
                  color: "var(--text-secondary)",
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                Paste your ad copy below. Blank lines separate text blocks within one ad.
              </p>
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: 12,
                  marginBottom: 12,
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: "#7C5CFC" }}>Multiple ads?</strong>{" "}
                Use <code style={{ background: "var(--bg-secondary)", padding: "1px 5px", borderRadius: 4 }}>-----</code> between each ad to distribute different copy across your photos.
              </p>
              <textarea
                value={copyText}
                onChange={(e) => setCopyText(e.target.value)}
                placeholder={`*NEW* Free Winter\nWeight Loss Challenge\n\n- 6 weeks\n- my workout plan to get absolutely diced\n- dead simple diet plan (no counting macros)\n- accountability group so you actually stick w/ it\n\nFree. Not eventually free.\nNot "free trial." Free free.\n\nDM to join before I start\ncharging for this.`}
                rows={14}
                style={{
                  ...inputStyle,
                  fontFamily: "var(--font-geist-mono)",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              />
            </div>
          </div>
        </div>

        {/* Generate button */}
        <div className="section" style={{ textAlign: "center" }}>
          <button
            onClick={handleGenerate}
            disabled={photos.length === 0 || generating}
            style={{
              background:
                photos.length > 0 && !generating
                  ? "#7C5CFC"
                  : "var(--bg-secondary)",
              color: photos.length > 0 && !generating ? "#fff" : "var(--text-muted)",
              border: "none",
              padding: "16px 48px",
              borderRadius: 12,
              fontSize: 18,
              fontWeight: 700,
              cursor:
                photos.length > 0 && !generating ? "pointer" : "not-allowed",
              transition: "all 0.2s",
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Sparkles size={20} />
            {generating ? "Generating..." : `Generate ${photos.length} Ad${photos.length !== 1 ? "s" : ""}`}
          </button>
        </div>

        {/* ── Mad Scientist Loading Overlay ── */}
        {generating && (
          <div style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(9,9,11,0.92)",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(12px)",
          }}>
            {/* Mad Scientist SVG Animation */}
            <div style={{ width: 280, height: 280, position: "relative", marginBottom: 24 }}>
              {/* Cauldron */}
              <svg viewBox="0 0 280 280" style={{ width: "100%", height: "100%" }}>
                {/* Glow under cauldron */}
                <ellipse cx="140" cy="235" rx="70" ry="12" fill="rgba(80,255,120,0.15)">
                  <animate attributeName="rx" values="70;80;70" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.15;0.3;0.15" dur="2s" repeatCount="indefinite" />
                </ellipse>
                {/* Cauldron body */}
                <ellipse cx="140" cy="200" rx="55" ry="35" fill="#1a1a2e" stroke="#333" strokeWidth="3" />
                <path d="M85 200 Q85 235 140 235 Q195 235 195 200" fill="#111127" stroke="#333" strokeWidth="2" />
                {/* Cauldron rim */}
                <ellipse cx="140" cy="186" rx="58" ry="14" fill="#2a2a3e" stroke="#444" strokeWidth="2" />
                {/* Green goop surface */}
                <ellipse cx="140" cy="188" rx="50" ry="10" fill="#22cc66" opacity="0.85">
                  <animate attributeName="ry" values="10;12;10" dur="1.5s" repeatCount="indefinite" />
                </ellipse>
                <ellipse cx="140" cy="188" rx="50" ry="10" fill="url(#goopGlow)">
                  <animate attributeName="opacity" values="0.4;0.7;0.4" dur="2s" repeatCount="indefinite" />
                </ellipse>
                {/* Goop glow gradient */}
                <defs>
                  <radialGradient id="goopGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#66ff99" stopOpacity="0.8" />
                    <stop offset="100%" stopColor="#22cc66" stopOpacity="0" />
                  </radialGradient>
                </defs>
                {/* Bubbles */}
                <circle cx="125" cy="185" r="4" fill="#66ff99" opacity="0.7">
                  <animate attributeName="cy" values="185;160;140" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0.4;0" dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="r" values="4;6;3" dur="1.8s" repeatCount="indefinite" />
                </circle>
                <circle cx="155" cy="182" r="3" fill="#88ffaa" opacity="0.6">
                  <animate attributeName="cy" values="182;155;130" dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.6;0.3;0" dur="2.2s" repeatCount="indefinite" />
                  <animate attributeName="r" values="3;5;2" dur="2.2s" repeatCount="indefinite" />
                </circle>
                <circle cx="140" cy="187" r="5" fill="#44ee88" opacity="0.5">
                  <animate attributeName="cy" values="187;150;120" dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.5;0.2;0" dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="r" values="5;7;4" dur="2.5s" repeatCount="indefinite" />
                </circle>
                <circle cx="130" cy="186" r="2.5" fill="#55ffcc" opacity="0.8">
                  <animate attributeName="cy" values="186;165;145" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.8;0.4;0" dur="1.4s" repeatCount="indefinite" />
                </circle>
                {/* Steam wisps */}
                <path d="M120 170 Q115 150 125 130" fill="none" stroke="rgba(100,255,150,0.2)" strokeWidth="3" strokeLinecap="round">
                  <animate attributeName="d" values="M120 170 Q115 150 125 130;M120 170 Q110 145 120 120;M120 170 Q115 150 125 130" dur="3s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.2;0.4;0.2" dur="3s" repeatCount="indefinite" />
                </path>
                <path d="M160 168 Q165 145 155 125" fill="none" stroke="rgba(100,255,150,0.15)" strokeWidth="2" strokeLinecap="round">
                  <animate attributeName="d" values="M160 168 Q165 145 155 125;M160 168 Q170 140 158 115;M160 168 Q165 145 155 125" dur="3.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.15;0.35;0.15" dur="3.5s" repeatCount="indefinite" />
                </path>
                {/* Scientist body */}
                <rect x="118" y="88" width="44" height="85" rx="8" fill="#1e1e32" stroke="#333" strokeWidth="1.5" />
                {/* Lab coat lapels */}
                <path d="M118 88 L130 130" stroke="#2a2a44" strokeWidth="2" />
                <path d="M162 88 L150 130" stroke="#2a2a44" strokeWidth="2" />
                {/* Head */}
                <circle cx="140" cy="68" r="22" fill="#e8c9a0" />
                {/* Crazy hair */}
                <path d="M118 60 Q110 35 120 30 Q125 25 118 20" fill="none" stroke="#aaa" strokeWidth="3" strokeLinecap="round">
                  <animate attributeName="d" values="M118 60 Q110 35 120 30 Q125 25 118 20;M118 60 Q108 33 118 28 Q123 22 115 18;M118 60 Q110 35 120 30 Q125 25 118 20" dur="2s" repeatCount="indefinite" />
                </path>
                <path d="M130 48 Q128 30 135 22 Q138 18 132 12" fill="none" stroke="#bbb" strokeWidth="3" strokeLinecap="round">
                  <animate attributeName="d" values="M130 48 Q128 30 135 22 Q138 18 132 12;M130 48 Q126 28 133 20 Q136 15 130 10;M130 48 Q128 30 135 22 Q138 18 132 12" dur="2.3s" repeatCount="indefinite" />
                </path>
                <path d="M150 48 Q155 28 148 20 Q145 15 152 10" fill="none" stroke="#bbb" strokeWidth="3" strokeLinecap="round">
                  <animate attributeName="d" values="M150 48 Q155 28 148 20 Q145 15 152 10;M150 48 Q157 26 150 18 Q147 12 154 8;M150 48 Q155 28 148 20 Q145 15 152 10" dur="1.9s" repeatCount="indefinite" />
                </path>
                <path d="M162 58 Q170 38 165 28 Q162 22 168 16" fill="none" stroke="#aaa" strokeWidth="3" strokeLinecap="round">
                  <animate attributeName="d" values="M162 58 Q170 38 165 28 Q162 22 168 16;M162 58 Q172 36 167 26 Q164 20 170 14;M162 58 Q170 38 165 28 Q162 22 168 16" dur="2.6s" repeatCount="indefinite" />
                </path>
                {/* Goggles */}
                <circle cx="131" cy="65" r="9" fill="none" stroke="#555" strokeWidth="2.5" />
                <circle cx="149" cy="65" r="9" fill="none" stroke="#555" strokeWidth="2.5" />
                <line x1="140" y1="65" x2="140" y2="65" stroke="#555" strokeWidth="2" />
                <circle cx="131" cy="65" r="6" fill="rgba(100,200,255,0.3)" />
                <circle cx="149" cy="65" r="6" fill="rgba(100,200,255,0.3)" />
                {/* Goggle glint */}
                <circle cx="128" cy="62" r="2" fill="rgba(255,255,255,0.5)" />
                <circle cx="146" cy="62" r="2" fill="rgba(255,255,255,0.5)" />
                {/* Mouth — grinning */}
                <path d="M133 78 Q140 84 147 78" fill="none" stroke="#444" strokeWidth="1.5" strokeLinecap="round" />
                {/* Arms — stirring */}
                <g>
                  <animateTransform attributeName="transform" type="rotate" values="-5 140 140;5 140 140;-5 140 140" dur="1.5s" repeatCount="indefinite" />
                  {/* Left arm */}
                  <path d="M118 110 Q95 130 105 175" fill="none" stroke="#e8c9a0" strokeWidth="6" strokeLinecap="round" />
                  {/* Right arm */}
                  <path d="M162 110 Q185 130 175 175" fill="none" stroke="#e8c9a0" strokeWidth="6" strokeLinecap="round" />
                  {/* Stirring stick */}
                  <line x1="105" y1="175" x2="140" y2="195" stroke="#8B6914" strokeWidth="4" strokeLinecap="round" />
                  <line x1="175" y1="175" x2="155" y2="188" stroke="#8B6914" strokeWidth="3" strokeLinecap="round" />
                </g>
                {/* Cauldron legs */}
                <line x1="100" y1="225" x2="95" y2="250" stroke="#333" strokeWidth="4" strokeLinecap="round" />
                <line x1="180" y1="225" x2="185" y2="250" stroke="#333" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </div>
            <div style={{
              fontSize: 18, fontWeight: 700, color: "var(--text-primary)",
              letterSpacing: -0.3, marginBottom: 8,
            }}>
              Cooking up your layouts...
            </div>
            <div style={{
              fontSize: 13, color: "#7C5CFC",
              fontFamily: "var(--font-geist-mono)",
            }}>
              {genProgress}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ──────── EDITOR VIEW ──────── */

  const canvasVisualW = Math.round(1080 * scale);
  const canvasVisualH = Math.round(1920 * scale);

  return (
    <div className="fade-up ad-studio-fullbleed" style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* ── Top Toolbar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 16px",
        gap: 12,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(20,17,32,0.9)",
        backdropFilter: "blur(12px)",
        flexShrink: 0,
        zIndex: 50,
      }}>
        <button onClick={() => setView("setup")} style={{ ...toolbarBtnStyle }}>
          <ChevronLeft size={16} /> Back
        </button>
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
        {/* PRO badge */}
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 6,
          background: "linear-gradient(135deg, #7C5CFC 0%, #a855f7 50%, #ec4899 100%)",
          fontSize: 11,
          fontWeight: 700,
          color: "#fff",
          letterSpacing: 0.5,
        }}>
          <span style={{ fontSize: 12 }}>◆</span> PRO
          <div style={{ width: 1, height: 12, background: "rgba(255,255,255,0.3)" }} />
          <span style={{ fontWeight: 500, fontSize: 10, opacity: 0.9 }}>∞ credits</span>
        </div>
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
        <span style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 600, letterSpacing: -0.2 }}>
          {projectName}
        </span>
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          — Ad {currentIndex + 1} of {creatives.length}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-geist-mono)" }}>
            {Math.round(scale * 100)}%
          </span>
          <input
            type="range"
            min={15}
            max={70}
            value={Math.round(scale * 100)}
            onChange={(e) => setScale(parseInt(e.target.value) / 100)}
            style={{ width: 80, accentColor: "#7C5CFC", height: 3, cursor: "pointer" }}
          />
        </div>
        <button onClick={handleUndo} disabled={undoStack.length === 0} style={{ ...toolbarBtnStyle, opacity: undoStack.length === 0 ? 0.3 : 1 }} title="Undo (Cmd+Z)">
          <RotateCcw size={14} />
        </button>
        <button onClick={handleRedo} disabled={redoStack.length === 0} style={{ ...toolbarBtnStyle, opacity: redoStack.length === 0 ? 0.3 : 1 }} title="Redo (Cmd+Shift+Z)">
          <RotateCcw size={14} style={{ transform: "scaleX(-1)" }} />
        </button>
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
        <button onClick={handleExport} style={{ ...toolbarBtnStyle }}>
          <Download size={14} /> Save
        </button>
        <button onClick={handleExportAll} style={{ ...toolbarBtnStyle, background: "#7C5CFC", color: "#fff", border: "1px solid #7C5CFC" }}>
          <Download size={14} /> Export All ({creatives.length})
        </button>
        <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.08)" }} />
        <button
          onClick={handleRelayout}
          disabled={relayouting}
          style={{
            ...toolbarBtnStyle,
            background: relayouting ? "rgba(255,255,255,0.03)" : "rgba(100,255,150,0.08)",
            border: "1px solid rgba(100,255,150,0.2)",
            color: relayouting ? "var(--text-muted)" : "#66ff99",
          }}
          title="Re-analyze this photo and reposition text blocks"
        >
          <Sparkles size={14} /> {relayouting ? "Analyzing..." : "Re-layout"}
        </button>
      </div>

      {/* ── Main content: canvas + sidebar ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Canvas Area — pinch-to-zoom target */}
        <div ref={canvasAreaRef} style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#08080e",
          backgroundImage: `
            linear-gradient(rgba(60,60,220,0.13) 1px, transparent 1px),
            linear-gradient(90deg, rgba(60,60,220,0.13) 1px, transparent 1px)
          `,
          backgroundSize: "56px 56px",
          position: "relative",
          overflow: "hidden",
        }}>
          {/* Canvas wrapper — uses visual dimensions so it doesn't push sidebar off screen */}
          {currentCreative && (
            <div
              id="ad-canvas-export"
              style={{
                width: canvasVisualW,
                height: canvasVisualH,
                flexShrink: 0,
                position: "relative",
                overflow: imageEditMode ? "visible" : "hidden",
                boxShadow: "0 4px 40px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.06)",
                borderRadius: 4,
              }}
            >
              <AdCanvas
                creative={currentCreative}
                scale={scale}
                selectedBlockIds={selectedBlockIds}
                onSelectBlock={(id, shiftKey) => {
                  if (id === null) {
                    setSelectedBlockIds(new Set());
                  } else if (shiftKey) {
                    setSelectedBlockIds(prev => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  } else {
                    setSelectedBlockIds(new Set([id]));
                  }
                }}
                onUpdateBlock={handleUpdateBlock}
                onRecordEdit={handleRecordEdit}
                onImageClick={() => setImageEditMode((m) => !m)}
                imageEditMode={imageEditMode}
                onImagePan={handleImagePan}
                onUpdateImage={handleUpdateImage}
              />
            </div>
          )}

          {/* Dock Strip — below canvas */}
          <DockStrip
            creatives={creatives}
            currentIndex={currentIndex}
            onSelect={(i) => { setCurrentIndex(i); setSelectedBlockIds(new Set()); setImageEditMode(false); }}
          />
        </div>

        {/* ── Sidebar ── */}
        <div style={{
          width: 300,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          overflowY: "auto",
          padding: "10px 10px 16px 10px",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(20,17,32,0.92)",
          flexShrink: 0,
        }}>
          {/* ── Quick Actions ── */}
          <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
            <button onClick={handleAddBlock} style={{ ...panelBtnStyle, flex: 1 }}>
              <Plus size={13} /> Add Text
            </button>
            <button onClick={handleApplyToAll} style={{ ...panelBtnStyle, flex: 1 }} title="Copy layout to all">
              <Sparkles size={13} /> Apply All
            </button>
          </div>

          {/* ── Alignment Toolbar ── */}
          <div style={{
            borderRadius: 8,
            background: "rgba(26,23,42,0.7)",
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "8px 10px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={panelLabelStyle}>Align</span>
              {selectedBlockIds.size >= 1 && (
                <span style={{ fontSize: 10, color: "rgba(124,92,252,0.7)" }}>{selectedBlockIds.size === 1 ? "canvas" : `${selectedBlockIds.size} selected`}</span>
              )}
            </div>
            {(() => {
              const disabled = selectedBlockIds.size < 1 || !currentCreative;
              const alignAction = (action: string) => {
                if (!currentCreative || selectedBlockIds.size < 1) return;
                pushUndo();
                const blocks = currentCreative.textBlocks.filter(b => selectedBlockIds.has(b.id));
                // 1 block = align to canvas, 2+ blocks = align to group bounding box
                let minX: number, minY: number, maxX: number, maxY: number;
                if (blocks.length === 1) {
                  // Canvas bounds
                  minX = 0; minY = 0; maxX = 1080; maxY = 1920;
                } else {
                  minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
                  for (const b of blocks) {
                    minX = Math.min(minX, b.x);
                    minY = Math.min(minY, b.y);
                    const bw = b.maxWidth;
                    const bh = b.fontSize * (b.lineHeight || 1.5) * b.lines.length + b.paddingV * 2;
                    maxX = Math.max(maxX, b.x + bw);
                    maxY = Math.max(maxY, b.y + bh);
                  }
                }
                setCreatives(prev => prev.map((c, ci) =>
                  ci === currentIndex ? {
                    ...c,
                    textBlocks: c.textBlocks.map(b => {
                      if (!selectedBlockIds.has(b.id)) return b;
                      const bw = b.maxWidth;
                      const bh = b.fontSize * (b.lineHeight || 1.5) * b.lines.length + b.paddingV * 2;
                      switch (action) {
                        case "left": return { ...b, x: minX };
                        case "centerH": return { ...b, x: minX + (maxX - minX) / 2 - bw / 2 };
                        case "right": return { ...b, x: maxX - bw };
                        case "top": return { ...b, y: minY };
                        case "centerV": return { ...b, y: minY + (maxY - minY) / 2 - bh / 2 };
                        case "bottom": return { ...b, y: maxY - bh };
                        default: return b;
                      }
                    }),
                  } : c
                ));
              };
              const abStyle = (d: boolean): React.CSSProperties => ({
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "5px 0",
                borderRadius: 5,
                border: "none",
                background: d ? "transparent" : "rgba(255,255,255,0.04)",
                color: d ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.55)",
                cursor: d ? "default" : "pointer",
                transition: "all 0.12s",
              });
              const hIn = (e: React.MouseEvent) => { if (!disabled) { (e.currentTarget as HTMLElement).style.background = "rgba(124,92,252,0.15)"; (e.currentTarget as HTMLElement).style.color = "#7C5CFC"; } };
              const hOut = (e: React.MouseEvent) => { if (!disabled) { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)"; (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.55)"; } };
              return (
                <div style={{ display: "flex", gap: 2 }}>
                  <button title="Align left" disabled={disabled} onClick={() => alignAction("left")} style={abStyle(disabled)} onMouseEnter={hIn} onMouseLeave={hOut}><AlignHorizontalJustifyStart size={16} /></button>
                  <button title="Center horizontally" disabled={disabled} onClick={() => alignAction("centerH")} style={abStyle(disabled)} onMouseEnter={hIn} onMouseLeave={hOut}><AlignHorizontalJustifyCenter size={16} /></button>
                  <button title="Align right" disabled={disabled} onClick={() => alignAction("right")} style={abStyle(disabled)} onMouseEnter={hIn} onMouseLeave={hOut}><AlignHorizontalJustifyEnd size={16} /></button>
                  <div style={{ width: 1, height: 22, background: "rgba(255,255,255,0.08)", margin: "0 3px", alignSelf: "center" }} />
                  <button title="Align top" disabled={disabled} onClick={() => alignAction("top")} style={abStyle(disabled)} onMouseEnter={hIn} onMouseLeave={hOut}><AlignVerticalJustifyStart size={16} /></button>
                  <button title="Center vertically" disabled={disabled} onClick={() => alignAction("centerV")} style={abStyle(disabled)} onMouseEnter={hIn} onMouseLeave={hOut}><AlignVerticalJustifyCenter size={16} /></button>
                  <button title="Align bottom" disabled={disabled} onClick={() => alignAction("bottom")} style={abStyle(disabled)} onMouseEnter={hIn} onMouseLeave={hOut}><AlignVerticalJustifyEnd size={16} /></button>
                </div>
              );
            })()}
          </div>

          {/* ── Select All + Scale ── */}
          <div style={{
            borderRadius: 8,
            background: "rgba(26,23,42,0.7)",
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "8px 10px",
          }}>
            <label style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontSize: 11,
              color: "rgba(255,255,255,0.5)",
              marginBottom: selectedBlockIds.size > 0 ? 8 : 0,
            }}>
              <input
                type="checkbox"
                checked={currentCreative ? selectedBlockIds.size === currentCreative.textBlocks.length && currentCreative.textBlocks.length > 0 : false}
                onChange={(e) => {
                  if (!currentCreative) return;
                  if (e.target.checked) {
                    setSelectedBlockIds(new Set(currentCreative.textBlocks.map(b => b.id)));
                  } else {
                    setSelectedBlockIds(new Set());
                  }
                }}
                style={{ accentColor: "#7C5CFC", width: 13, height: 13 }}
              />
              Select all
              {selectedBlockIds.size > 0 && (
                <span style={{ color: "rgba(124,92,252,0.7)", fontSize: 10, fontWeight: 600, marginLeft: "auto" }}>
                  {selectedBlockIds.size}
                </span>
              )}
            </label>

            {selectedBlockIds.size > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>Scale</span>
                  <input
                    type="range"
                    min={50}
                    max={200}
                    defaultValue={100}
                    onChange={(e) => {
                      const multiplier = parseInt(e.target.value) / 100;
                      if (!currentCreative) return;
                      if (!scaleBaseRef.current) {
                        scaleBaseRef.current = new Map();
                        currentCreative.textBlocks.forEach(b => {
                          if (selectedBlockIds.has(b.id)) {
                            scaleBaseRef.current!.set(b.id, {
                              fontSize: b.fontSize,
                              paddingH: b.paddingH,
                              paddingV: b.paddingV,
                              borderRadius: b.borderRadius,
                            });
                          }
                        });
                      }
                      setCreatives(prev => prev.map((c, i) =>
                        i === currentIndex ? {
                          ...c,
                          textBlocks: c.textBlocks.map(b => {
                            const base = scaleBaseRef.current?.get(b.id);
                            if (!base || !selectedBlockIds.has(b.id)) return b;
                            return {
                              ...b,
                              fontSize: Math.round(base.fontSize * multiplier),
                              paddingH: Math.round(base.paddingH * multiplier),
                              paddingV: Math.round(base.paddingV * multiplier),
                              borderRadius: Math.round(base.borderRadius * multiplier),
                            };
                          }),
                        } : c
                      ));
                    }}
                    onMouseDown={() => {
                      pushUndo();
                      scaleBaseRef.current = null;
                    }}
                    onMouseUp={(e) => {
                      (e.target as HTMLInputElement).value = "100";
                      scaleBaseRef.current = null;
                    }}
                    style={{
                      flex: 1,
                      accentColor: "#7C5CFC",
                      height: 3,
                      cursor: "pointer",
                    }}
                  />
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>
                    {selectedBlockIds.size > 0 && currentCreative
                      ? `${Math.round(
                          currentCreative.textBlocks
                            .filter(b => selectedBlockIds.has(b.id))
                            .reduce((s, b) => s + b.fontSize, 0)
                          / selectedBlockIds.size
                        )}px`
                      : ""}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Selected block editor */}
          {selectedBlock ? (
            <TextEditorPanel
              block={selectedBlock}
              onUpdate={(updates) =>
                handleUpdateBlock(selectedBlock.id, updates)
              }
              onDelete={() => handleDeleteBlock(selectedBlock.id)}
            />
          ) : (
            <div style={{
              padding: "10px 10px",
              borderRadius: 8,
              background: "rgba(26,23,42,0.7)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}>
              {imageEditMode && currentCreative ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(124,92,252,0.8)", letterSpacing: 0.5, marginBottom: 2 }}>Image properties</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
                    <span style={panelLabelStyle}>Zoom</span>
                    <input type="range" min={50} max={300} step={5} value={Math.round((currentCreative.imageTransform?.scale || 1) * 100)} onChange={(e) => handleUpdateImage({ scale: parseInt(e.target.value) / 100 })} style={{ flex: 1, accentColor: "#7C5CFC", height: 3, cursor: "pointer" }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>{Math.round((currentCreative.imageTransform?.scale || 1) * 100)}%</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
                    <span style={panelLabelStyle}>Rotate</span>
                    <input type="range" min={-180} max={180} step={1} value={currentCreative.imageTransform?.rotate || 0} onChange={(e) => handleUpdateImage({ rotate: parseInt(e.target.value) })} style={{ flex: 1, accentColor: "#7C5CFC", height: 3, cursor: "pointer" }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", minWidth: 28, textAlign: "right" }}>{currentCreative.imageTransform?.rotate || 0}°</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 28 }}>
                    <span style={panelLabelStyle}>Offset</span>
                    <input type="number" value={Math.round(currentCreative.imageTransform?.offsetX || 0)} onChange={(e) => handleUpdateImage({ offsetX: parseInt(e.target.value) || 0 })} style={{ flex: 1, background: "rgba(16,14,28,0.7)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5, color: "rgba(255,255,255,0.85)", padding: "4px 8px", height: 28, fontSize: 12, outline: "none" }} />
                    <input type="number" value={Math.round(currentCreative.imageTransform?.offsetY || 0)} onChange={(e) => handleUpdateImage({ offsetY: parseInt(e.target.value) || 0 })} style={{ flex: 1, background: "rgba(16,14,28,0.7)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 5, color: "rgba(255,255,255,0.85)", padding: "4px 8px", height: 28, fontSize: 12, outline: "none" }} />
                  </div>
                  <button
                    onClick={() => handleUpdateImage({ scale: 1, rotate: 0, offsetX: 0, offsetY: 0 })}
                    style={{ ...panelBtnStyle, justifyContent: "center", marginTop: 2 }}
                  >
                    <RotateCcw size={11} /> Reset
                  </button>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", marginBottom: 2 }}>Select a text block</span>
                  {[
                    ["Click", "select"],
                    ["Drag", "reposition"],
                    ["Shift+Click", "multi-select"],
                    ["Marquee", "drag to select"],
                    ["Dbl-click bg", "edit image"],
                  ].map(([key, action]) => (
                    <span key={key} style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", lineHeight: 1.4 }}>
                      <strong style={{ color: "rgba(255,255,255,0.4)" }}>{key}</strong> {action}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Layers ── */}
          <div style={{
            borderRadius: 8,
            background: "rgba(26,23,42,0.7)",
            border: "1px solid rgba(255,255,255,0.06)",
            padding: "8px 8px 6px",
          }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,0.3)", letterSpacing: 0.5 }}>
              Layers
            </span>
            {currentCreative?.textBlocks.map((block) => (
              <div
                key={block.id}
                onClick={(e) => {
                  if (e.shiftKey) {
                    setSelectedBlockIds(prev => {
                      const next = new Set(prev);
                      if (next.has(block.id)) next.delete(block.id);
                      else next.add(block.id);
                      return next;
                    });
                  } else {
                    setSelectedBlockIds(new Set([block.id]));
                  }
                }}
                style={{
                  padding: "5px 8px",
                  marginTop: 3,
                  borderRadius: 4,
                  cursor: "pointer",
                  background: selectedBlockIds.has(block.id) ? "rgba(124,92,252,0.1)" : "transparent",
                  border: selectedBlockIds.has(block.id) ? "1px solid rgba(124,92,252,0.2)" : "1px solid transparent",
                  transition: "all 0.1s",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {block.locked ? (
                  <Lock size={10} style={{ color: "rgba(124,92,252,0.6)", flexShrink: 0 }} />
                ) : (
                  <Type size={10} style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
                )}
                <span style={{
                  fontSize: 11,
                  color: selectedBlockIds.has(block.id) ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.4)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}>
                  {block.lines[0] || "Empty block"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-primary)",
  color: "var(--text-secondary)",
  padding: "6px 12px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  transition: "all 0.15s",
};

const toolbarBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "var(--text-secondary)",
  padding: "6px 14px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  transition: "all 0.15s",
};


const navBtnStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-primary)",
  color: "var(--text-primary)",
  width: 40,
  height: 40,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  transition: "all 0.15s",
};
