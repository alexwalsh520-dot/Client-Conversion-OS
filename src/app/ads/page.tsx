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
  highlightWords: { word: string; color: string }[];
  maxWidth: number; // px
}

interface AdCreative {
  id: string;
  photoUrl: string;
  textBlocks: TextBlock[];
  status: "draft" | "edited" | "approved" | "exported";
  dbId?: string; // supabase id
}

/* ──────────────────────── HELPERS ──────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 10);

const defaultTextBlocks: TextBlock[] = [
  {
    id: uid(),
    lines: ["*NEW* Free Winter", "Weight Loss Challenge"],
    x: 540,
    y: 120,
    fontSize: 52,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 0.9,
    borderRadius: 14,
    paddingH: 24,
    paddingV: 14,
    align: "center",
    lineGap: 6,
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
    y: 340,
    fontSize: 30,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 0.9,
    borderRadius: 10,
    paddingH: 18,
    paddingV: 10,
    align: "left",
    lineGap: 5,
    highlightWords: [],
    maxWidth: 960,
  },
  {
    id: uid(),
    lines: ["Free. Not eventually free.", 'Not "free trial." Free free.'],
    x: 540,
    y: 1420,
    fontSize: 40,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 0.9,
    borderRadius: 12,
    paddingH: 22,
    paddingV: 12,
    align: "center",
    lineGap: 6,
    highlightWords: [],
    maxWidth: 900,
  },
  {
    id: uid(),
    lines: ["DM to join before I start", "charging for this."],
    x: 540,
    y: 1620,
    fontSize: 40,
    fontFamily: "Inter, SF Pro Display, system-ui",
    fontWeight: 700,
    textColor: "#ffffff",
    bgColor: "#000000",
    bgOpacity: 0.9,
    borderRadius: 12,
    paddingH: 22,
    paddingV: 14,
    align: "center",
    lineGap: 6,
    highlightWords: [],
    maxWidth: 900,
  },
];

/* ──────────────────────── AD CANVAS ──────────────────────── */
function AdCanvas({
  creative,
  scale,
  selectedBlockId,
  onSelectBlock,
  onUpdateBlock,
  onRecordEdit,
}: {
  creative: AdCreative;
  scale: number;
  selectedBlockId: string | null;
  onSelectBlock: (id: string | null) => void;
  onUpdateBlock: (blockId: string, updates: Partial<TextBlock>) => void;
  onRecordEdit: (
    blockId: string,
    type: string,
    before: unknown,
    after: unknown
  ) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
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

  // Drag handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, block: TextBlock) => {
      e.stopPropagation();
      e.preventDefault();
      onSelectBlock(block.id);
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

  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const dx = (e.clientX - dragging.startX) / scale;
      const dy = (e.clientY - dragging.startY) / scale;
      onUpdateBlock(dragging.blockId, {
        x: Math.round(dragging.origX + dx),
        y: Math.round(dragging.origY + dy),
      });
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
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [dragging, scale, creative.textBlocks, onUpdateBlock, onRecordEdit]);

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
        // Corner handles: scale fontSize proportionally
        // Diagonal distance gives uniform scale
        const dist = (dx + -dy) / 2; // up-right = bigger
        const scaleFactor = dist / 200;
        const newSize = Math.max(14, Math.min(120, Math.round(resizing.origFontSize * (1 + scaleFactor))));
        onUpdateBlock(resizing.blockId, { fontSize: newSize });
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

  return (
    <div
      ref={canvasRef}
      style={{
        width: W,
        height: H,
        position: "relative",
        overflow: "hidden",
        transform: `scale(${scale})`,
        transformOrigin: "top center",
        borderRadius: 8,
        background: "#111",
      }}
      onClick={() => onSelectBlock(null)}
    >
      {/* Photo background */}
      <img
        src={creative.photoUrl}
        alt="Ad background"
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          position: "absolute",
          top: 0,
          left: 0,
        }}
        draggable={false}
      />

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

      {/* Text blocks */}
      {creative.textBlocks.map((block) => {
        const isSelected = block.id === selectedBlockId;
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
              width: 14,
              height: 14,
              borderRadius: "50%",
              background: "#ffffff",
              border: "1.5px solid #b0b0b0",
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
              zIndex: 20,
              cursor: pos.cursor,
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
              width: 8,
              height: 32,
              borderRadius: 4,
              background: "#ffffff",
              border: "1.5px solid #b0b0b0",
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
              top: "50%",
              transform: "translateY(-50%)",
              zIndex: 20,
              cursor: "ew-resize",
              ...(side === "e" ? { right: -12 } : { left: -12 }),
            }}
          />
        );

        // Top/bottom edge pill handles
        const edgeHandleTB = (side: "n" | "s"): React.ReactNode => (
          <div
            key={side}
            style={{
              position: "absolute",
              width: 32,
              height: 8,
              borderRadius: 4,
              background: "#ffffff",
              border: "1.5px solid #b0b0b0",
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              pointerEvents: "none" as const,
              ...(side === "n" ? { top: -12 } : { bottom: -12 }),
            }}
          />
        );

        return (
          <div
            key={block.id}
            style={{
              position: "absolute",
              left: isCentered ? "50%" : block.x,
              top: block.y,
              transform: isCentered ? "translateX(-50%)" : undefined,
              cursor: dragging?.blockId === block.id ? "grabbing" : "grab",
              outline: isSelected ? "2px solid #7B61FF" : "none",
              outlineOffset: 6,
              zIndex: isSelected ? 10 : 1,
              maxWidth: block.maxWidth,
              userSelect: "none",
            }}
            onMouseDown={(e) => handleMouseDown(e, block)}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Figma-style resize handles — visible when selected */}
            {isSelected && !dragging && (
              <>
                {cornerHandle({ top: -9, left: -9, cursor: "nwse-resize" }, "nw")}
                {cornerHandle({ top: -9, right: -9, cursor: "nesw-resize" }, "ne")}
                {cornerHandle({ bottom: -9, left: -9, cursor: "nesw-resize" }, "sw")}
                {cornerHandle({ bottom: -9, right: -9, cursor: "nwse-resize" }, "se")}
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
                    marginBottom: block.lineGap,
                    width:
                      block.align === "center" ? "100%" : undefined,
                    textAlign: block.align,
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
                      lineHeight: 1.3,
                      boxDecorationBreak: "clone" as const,
                      WebkitBoxDecorationBreak: "clone" as const,
                    }}
                  >
                    {line}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function hexToRgb(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
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
  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-primary)",
        borderRadius: 12,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: 1,
          }}
        >
          Edit Text Block
        </span>
        <button
          onClick={onDelete}
          style={{
            background: "rgba(217,142,142,0.15)",
            border: "none",
            color: "var(--danger)",
            padding: "4px 8px",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Text content */}
      <div>
        <label style={labelStyle}>Text (one line per row)</label>
        <textarea
          value={block.lines.join("\n")}
          onChange={(e) =>
            onUpdate({ lines: e.target.value.split("\n") })
          }
          rows={4}
          style={inputStyle}
        />
      </div>

      {/* Font size */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Font Size</label>
          <input
            type="range"
            min={16}
            max={80}
            value={block.fontSize}
            onChange={(e) =>
              onUpdate({ fontSize: parseInt(e.target.value) })
            }
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {block.fontSize}px
          </span>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Border Radius</label>
          <input
            type="range"
            min={0}
            max={30}
            value={block.borderRadius}
            onChange={(e) =>
              onUpdate({ borderRadius: parseInt(e.target.value) })
            }
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {block.borderRadius}px
          </span>
        </div>
      </div>

      {/* Colors */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Text Color</label>
          <input
            type="color"
            value={block.textColor}
            onChange={(e) => onUpdate({ textColor: e.target.value })}
            style={{ width: "100%", height: 32, border: "none", cursor: "pointer" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>BG Color</label>
          <input
            type="color"
            value={block.bgColor}
            onChange={(e) => onUpdate({ bgColor: e.target.value })}
            style={{ width: "100%", height: 32, border: "none", cursor: "pointer" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>BG Opacity</label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(block.bgOpacity * 100)}
            onChange={(e) =>
              onUpdate({ bgOpacity: parseInt(e.target.value) / 100 })
            }
            style={{ width: "100%", accentColor: "var(--accent)" }}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {Math.round(block.bgOpacity * 100)}%
          </span>
        </div>
      </div>

      {/* Alignment */}
      <div>
        <label style={labelStyle}>Alignment</label>
        <div style={{ display: "flex", gap: 4 }}>
          {(["left", "center", "right"] as const).map((a) => (
            <button
              key={a}
              onClick={() => onUpdate({ align: a })}
              style={{
                flex: 1,
                padding: "6px 0",
                borderRadius: 6,
                border: "1px solid var(--border-primary)",
                background:
                  block.align === a
                    ? "var(--accent)"
                    : "var(--bg-secondary)",
                color:
                  block.align === a ? "#000" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {a.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Max Width */}
      <div>
        <label style={labelStyle}>Max Width</label>
        <input
          type="range"
          min={200}
          max={1060}
          value={block.maxWidth}
          onChange={(e) =>
            onUpdate({ maxWidth: parseInt(e.target.value) })
          }
          style={{ width: "100%", accentColor: "var(--accent)" }}
        />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {block.maxWidth}px
        </span>
      </div>

      {/* Position */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>X Position</label>
          <input
            type="number"
            value={block.x}
            onChange={(e) => onUpdate({ x: parseInt(e.target.value) || 0 })}
            style={{ ...inputStyle, padding: "4px 8px" }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Y Position</label>
          <input
            type="number"
            value={block.y}
            onChange={(e) => onUpdate({ y: parseInt(e.target.value) || 0 })}
            style={{ ...inputStyle, padding: "4px 8px" }}
          />
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: 0.5,
  marginBottom: 4,
  display: "block",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-primary)",
  borderRadius: 8,
  color: "var(--text-primary)",
  padding: "8px 12px",
  fontSize: 13,
  fontFamily: "inherit",
  resize: "vertical",
};

/* ──────────────────────── MAIN ADS STUDIO ──────────────────────── */
export default function AdsPage() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [creatives, setCreatives] = useState<AdCreative[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [copyText, setCopyText] = useState("");
  const [projectName, setProjectName] = useState("New Ad Batch");
  const [view, setView] = useState<"setup" | "editor">("setup");
  const [saving, setSaving] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<
    { blockId: string; type: string; before: unknown; after: unknown; timestamp: number }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const currentCreative = creatives[currentIndex];
  const selectedBlock = currentCreative?.textBlocks.find(
    (b) => b.id === selectedBlockId
  );

  // Calculate scale to fit editor in viewport
  const [scale, setScale] = useState(0.35);
  useEffect(() => {
    const updateScale = () => {
      const availableHeight = window.innerHeight - 140;
      const s = Math.min(availableHeight / 1920, 0.45);
      setScale(s);
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
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
    const lineH = block.fontSize * 1.35;
    const contentLines = block.lines.filter((l) => l.trim()).length;
    const emptyLines = block.lines.filter((l) => !l.trim()).length;
    return (
      contentLines * (lineH + block.lineGap) +
      emptyLines * (block.fontSize * 0.5) +
      block.paddingV * 2
    );
  };

  // Generate creatives from photos + copy
  const handleGenerate = useCallback(() => {
    if (photos.length === 0) return;

    const W = 1080;
    const H = 1920;
    const MARGIN_TOP = 60;
    const MARGIN_BOTTOM = 80;
    const GAP = 40; // px between blocks

    // Parse copy text into sections split by blank lines
    let sections: string[][] = [];
    if (copyText.trim()) {
      let currentSection: string[] = [];
      copyText.split("\n").forEach((line) => {
        if (!line.trim() && currentSection.length > 0) {
          sections.push(currentSection);
          currentSection = [];
        } else if (line.trim()) {
          currentSection.push(line);
        }
      });
      if (currentSection.length > 0) sections.push(currentSection);
    }

    // If no custom copy, use default sections
    if (sections.length === 0) {
      sections = [
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
    }

    // Build text blocks with smart sizing per section role
    const makeBlock = (
      lines: string[],
      role: "title" | "body" | "callout" | "cta",
    ): TextBlock => {
      const isTitle = role === "title";
      const isCta = role === "cta";
      const isCallout = role === "callout";
      return {
        id: uid(),
        lines,
        x: W / 2, // will be centered
        y: 0, // calculated below
        fontSize: isTitle ? 52 : isCta ? 40 : isCallout ? 38 : 30,
        fontFamily: "Inter, SF Pro Display, system-ui",
        fontWeight: 700,
        textColor: "#ffffff",
        bgColor: "#000000",
        bgOpacity: 0.9,
        borderRadius: isTitle ? 14 : 10,
        paddingH: isTitle ? 24 : 18,
        paddingV: isTitle ? 14 : 10,
        align: role === "body" ? "left" : "center",
        lineGap: 6,
        highlightWords: [],
        maxWidth: 960,
      };
    };

    // Assign roles: first = title, last = cta, second-to-last = callout, middle = body
    const blocks: TextBlock[] = sections.map((lines, i) => {
      if (i === 0) return makeBlock(lines, "title");
      if (sections.length > 2 && i === sections.length - 1) return makeBlock(lines, "cta");
      if (sections.length > 3 && i === sections.length - 2) return makeBlock(lines, "callout");
      return makeBlock(lines, "body");
    });

    // ── Intelligent vertical layout ──
    // Title group goes near top, CTA group goes near bottom,
    // body blocks fill the middle — all non-overlapping.
    const heights = blocks.map((b) => estimateBlockHeight(b));
    const totalContentH = heights.reduce((s, h) => s + h, 0) + GAP * (blocks.length - 1);

    if (blocks.length <= 2) {
      // Simple: title top, cta bottom
      blocks[0].y = MARGIN_TOP;
      if (blocks.length === 2) blocks[1].y = H - MARGIN_BOTTOM - heights[1];
    } else {
      // Split: title at top, CTA at bottom, body blocks spaced in between
      // Title zone: top
      blocks[0].y = MARGIN_TOP;
      // CTA zone: bottom
      const lastIdx = blocks.length - 1;
      blocks[lastIdx].y = H - MARGIN_BOTTOM - heights[lastIdx];

      // Body + callout: distribute in remaining middle space
      const middleTop = blocks[0].y + heights[0] + GAP;
      const middleBottom = blocks[lastIdx].y - GAP;
      const middleBlocks = blocks.slice(1, lastIdx);
      const middleHeights = heights.slice(1, lastIdx);
      const middleTotalH = middleHeights.reduce((s, h) => s + h, 0);
      const middleGap =
        middleBlocks.length > 1
          ? Math.min(
              GAP * 2,
              (middleBottom - middleTop - middleTotalH) /
                (middleBlocks.length - 1),
            )
          : 0;

      // If there's only one middle block, center it vertically
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

    // Body blocks: left-aligned at x=80, centered blocks at W/2
    blocks.forEach((b) => {
      if (b.align === "left") b.x = 80;
      else b.x = W / 2;
    });

    const newCreatives: AdCreative[] = photos.map((url) => ({
      id: uid(),
      photoUrl: url,
      textBlocks: blocks.map((b) => ({ ...b, id: uid() })),
      status: "draft" as const,
    }));

    setCreatives(newCreatives);
    setCurrentIndex(0);
    setView("editor");
  }, [photos, copyText]);

  // Update a text block
  const handleUpdateBlock = useCallback(
    (blockId: string, updates: Partial<TextBlock>) => {
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
    [currentIndex]
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
    const newBlock: TextBlock = {
      id: uid(),
      lines: ["New text here"],
      x: 540,
      y: 960,
      fontSize: 36,
      fontFamily: "Inter, SF Pro Display, system-ui",
      fontWeight: 700,
      textColor: "#ffffff",
      bgColor: "#000000",
      bgOpacity: 0.9,
      borderRadius: 12,
      paddingH: 20,
      paddingV: 12,
      align: "center",
      lineGap: 6,
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
    setSelectedBlockId(newBlock.id);
  }, [currentIndex]);

  // Delete text block
  const handleDeleteBlock = useCallback(
    (blockId: string) => {
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
      setSelectedBlockId(null);
    },
    [currentIndex]
  );

  // Export current creative as PNG
  const handleExport = useCallback(async () => {
    const el = document.getElementById("ad-canvas-export");
    if (!el) return;

    // Dynamic import html2canvas
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: null,
      width: 1080,
      height: 1920,
    });

    const link = document.createElement("a");
    link.download = `ad-${currentIndex + 1}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [currentIndex]);

  // Export all
  const handleExportAll = useCallback(async () => {
    const html2canvas = (await import("html2canvas")).default;

    for (let i = 0; i < creatives.length; i++) {
      setCurrentIndex(i);
      // Wait for render
      await new Promise((r) => setTimeout(r, 200));
      const el = document.getElementById("ad-canvas-export");
      if (!el) continue;
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        width: 1080,
        height: 1920,
      });
      const link = document.createElement("a");
      link.download = `ad-${i + 1}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      await new Promise((r) => setTimeout(r, 300));
    }
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
                  (e.currentTarget.style.borderColor = "var(--accent)")
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
                  marginBottom: 12,
                }}
              >
                Paste your ad copy below. Separate text blocks with
                blank lines. Leave empty to use the default winter
                challenge template.
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
            disabled={photos.length === 0}
            style={{
              background:
                photos.length > 0
                  ? "var(--accent)"
                  : "var(--bg-secondary)",
              color: photos.length > 0 ? "#000" : "var(--text-muted)",
              border: "none",
              padding: "16px 48px",
              borderRadius: 12,
              fontSize: 18,
              fontWeight: 700,
              cursor:
                photos.length > 0 ? "pointer" : "not-allowed",
              transition: "all 0.2s",
              display: "inline-flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Sparkles size={20} />
            Generate {photos.length} Ad{photos.length !== 1 ? "s" : ""}
          </button>
        </div>
      </div>
    );
  }

  /* ──────── EDITOR VIEW ──────── */
  return (
    <div className="fade-up" style={{ display: "flex", height: "calc(100vh - 40px)", gap: 16 }}>
      {/* Left: Ad Canvas */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          overflow: "hidden",
        }}
      >
        {/* Carousel controls */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            marginBottom: 12,
            width: "100%",
            justifyContent: "center",
          }}
        >
          <button
            onClick={() => setView("setup")}
            style={{
              ...btnStyle,
              position: "absolute",
              left: 24,
            }}
          >
            <RotateCcw size={14} /> Back
          </button>

          <button
            onClick={() =>
              setCurrentIndex((i) => Math.max(0, i - 1))
            }
            disabled={currentIndex === 0}
            style={navBtnStyle}
          >
            <ChevronLeft size={20} />
          </button>

          <span
            style={{
              color: "var(--text-primary)",
              fontSize: 16,
              fontWeight: 600,
              minWidth: 80,
              textAlign: "center",
            }}
          >
            {currentIndex + 1} / {creatives.length}
          </span>

          <button
            onClick={() =>
              setCurrentIndex((i) =>
                Math.min(creatives.length - 1, i + 1)
              )
            }
            disabled={currentIndex === creatives.length - 1}
            style={navBtnStyle}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Canvas */}
        {currentCreative && (
          <div id="ad-canvas-export">
            <AdCanvas
              creative={currentCreative}
              scale={scale}
              selectedBlockId={selectedBlockId}
              onSelectBlock={setSelectedBlockId}
              onUpdateBlock={handleUpdateBlock}
              onRecordEdit={handleRecordEdit}
            />
          </div>
        )}
      </div>

      {/* Right: Editor Panel */}
      <div
        style={{
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          overflowY: "auto",
          padding: "0 8px 20px 0",
        }}
      >
        {/* ── Editing Tools ── */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-primary)",
            borderRadius: 12,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Editing
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleAddBlock} style={{ ...btnStyle, flex: 1 }}>
              <Plus size={14} /> Add Text Block
            </button>
            <button onClick={handleApplyToAll} style={{ ...btnStyle, flex: 1 }} title="Copy this ad's text layout to all other photos">
              <Sparkles size={14} /> Copy Layout to All
            </button>
          </div>
        </div>

        {/* ── Export ── */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-primary)",
            borderRadius: 12,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Export
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={handleExport} style={{ ...btnStyle, flex: 1 }}>
              <Download size={14} /> Save This Ad
            </button>
            <button onClick={handleExportAll} style={{ ...btnStyle, flex: 1, background: "var(--accent)", color: "#000", border: "1px solid var(--accent)" }}>
              <Download size={14} /> Save All ({creatives.length})
            </button>
          </div>
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
          <div
            className="glass-static"
            style={{
              padding: 20,
              color: "var(--text-muted)",
              fontSize: 13,
              lineHeight: 1.6,
            }}
          >
            <p style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>How to edit:</p>
            <p>→ <strong>Click</strong> a text block to select it</p>
            <p>→ <strong>Drag</strong> anywhere to reposition</p>
            <p>→ <strong>Corner circles</strong> to scale size</p>
            <p>→ <strong>Side pills</strong> to adjust width</p>
          </div>
        )}

        {/* Block list */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-primary)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            All Text Blocks
          </span>
          {currentCreative?.textBlocks.map((block, i) => (
            <div
              key={block.id}
              onClick={() => setSelectedBlockId(block.id)}
              style={{
                padding: "8px 10px",
                marginTop: 6,
                borderRadius: 8,
                cursor: "pointer",
                background:
                  block.id === selectedBlockId
                    ? "rgba(201,169,110,0.12)"
                    : "transparent",
                border:
                  block.id === selectedBlockId
                    ? "1px solid var(--accent)"
                    : "1px solid transparent",
                transition: "all 0.15s",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {block.lines[0]}
              </span>
            </div>
          ))}
        </div>

        {/* Thumbnail strip */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          {creatives.map((c, i) => (
            <div
              key={c.id}
              onClick={() => {
                setCurrentIndex(i);
                setSelectedBlockId(null);
              }}
              style={{
                width: 48,
                height: 85,
                borderRadius: 6,
                overflow: "hidden",
                cursor: "pointer",
                border:
                  i === currentIndex
                    ? "2px solid var(--accent)"
                    : "2px solid transparent",
                opacity: i === currentIndex ? 1 : 0.5,
                transition: "all 0.15s",
              }}
            >
              <img
                src={c.photoUrl}
                alt={`Ad ${i + 1}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            </div>
          ))}
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
