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

  useEffect(() => {
    if (!dragging) return;
    const block = creative.textBlocks.find((b) => b.id === dragging.blockId);
    if (!block) return;

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

        return (
          <div
            key={block.id}
            style={{
              position: "absolute",
              left: isCentered ? "50%" : block.x,
              top: block.y,
              transform: isCentered ? "translateX(-50%)" : undefined,
              cursor: dragging?.blockId === block.id ? "grabbing" : "grab",
              outline: isSelected ? "3px solid #c9a96e" : "none",
              outlineOffset: 4,
              zIndex: isSelected ? 10 : 1,
              maxWidth: block.maxWidth,
              userSelect: "none",
            }}
            onMouseDown={(e) => handleMouseDown(e, block)}
            onClick={(e) => e.stopPropagation()}
          >
            {block.lines.map((line, li) => (
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
            ))}
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

  // Generate creatives from photos + copy
  const handleGenerate = useCallback(() => {
    if (photos.length === 0) return;

    // Parse copy text into text blocks
    let blocks = [...defaultTextBlocks.map((b) => ({ ...b, id: uid() }))];

    // If custom copy provided, try to use it
    if (copyText.trim()) {
      const lines = copyText
        .split("\n")
        .filter((l) => l.trim());
      if (lines.length > 0) {
        // Replace title with first 1-2 lines
        blocks[0] = {
          ...blocks[0],
          id: uid(),
          lines: lines.slice(0, 2),
        };
        // Replace bullets with next lines
        if (lines.length > 2) {
          blocks[1] = {
            ...blocks[1],
            id: uid(),
            lines: lines.slice(2, 6),
          };
        }
        // Callout and CTA from remaining lines
        if (lines.length > 6) {
          blocks[2] = {
            ...blocks[2],
            id: uid(),
            lines: lines.slice(6, 8),
          };
        }
        if (lines.length > 8) {
          blocks[3] = {
            ...blocks[3],
            id: uid(),
            lines: lines.slice(8, 10),
          };
        }
      }
    }

    const newCreatives: AdCreative[] = photos.map((url, i) => ({
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

  // Record edit for learning
  const handleRecordEdit = useCallback(
    async (blockId: string, type: string, before: unknown, after: unknown) => {
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
        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <button onClick={handleAddBlock} style={btnStyle}>
            <Plus size={14} /> Add Text
          </button>
          <button onClick={handleExport} style={btnStyle}>
            <Download size={14} /> Export
          </button>
          <button onClick={handleExportAll} style={btnStyle}>
            <Download size={14} /> Export All
          </button>
          <button onClick={handleApplyToAll} style={btnStyle}>
            <Sparkles size={14} /> Apply to All
          </button>
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
              padding: 24,
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
            }}
          >
            <GripVertical
              size={24}
              style={{ marginBottom: 8, opacity: 0.3 }}
            />
            <p>Click a text block to edit it</p>
            <p>Drag to reposition</p>
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
