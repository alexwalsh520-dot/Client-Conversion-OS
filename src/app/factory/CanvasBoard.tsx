"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// A dot-grid infinite whiteboard for organizing content (Forester cycle bins, ad sets, notes).
// Custom-built (no dependency) so it matches the CCOS black/gold aesthetic. Paste an Instagram reel
// link into a card and it previews instantly from our own scraped library (thumbnail + caption +
// the transcript we already ran); links we don't have fall back to Instagram's embed iframe. Cards
// drag, wire together with arrows, and the whole board autosaves to the project.

type NodeType = "reel" | "note" | "frame";
interface Preview {
  ok: boolean;
  source: "library" | "embed";
  permalink: string;
  embedUrl: string;
  creator?: string | null;
  thumbnail?: string | null;
  caption?: string | null;
  transcript?: string | null;
  transcriptWords?: number;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
}
interface CanvasNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  w: number;
  h?: number;
  title?: string;
  url?: string;
  notes?: string;
  preview?: Preview | null;
  color?: string;
}
interface CanvasEdge { id: string; source: string; target: string }
interface Viewport { tx: number; ty: number; scale: number }

const DEFAULT_VIEWPORT: Viewport = { tx: 0, ty: 0, scale: 1 };
const NODE_W = { reel: 260, note: 240, frame: 520 } as const;
const FRAME_COLORS = ["#c9a96e", "#6ea8c9", "#8bc96e", "#c96e8b", "#a98bc9"];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
function fmtReach(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export default function CanvasBoard({
  projectId,
  initial,
}: {
  projectId: string;
  initial: { nodes?: unknown[]; edges?: unknown[]; viewport?: unknown } | null;
}) {
  const [nodes, setNodes] = useState<CanvasNode[]>((initial?.nodes as CanvasNode[]) ?? []);
  const [edges, setEdges] = useState<CanvasEdge[]>((initial?.edges as CanvasEdge[]) ?? []);
  const [vp, setVp] = useState<Viewport>((initial?.viewport as Viewport) ?? DEFAULT_VIEWPORT);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  const wrapRef = useRef<HTMLDivElement>(null);
  // Mutable interaction state kept in a ref so pointer handlers don't re-bind every render.
  const drag = useRef<{
    mode: "pan" | "node" | "connect" | null;
    id?: string;
    startX: number;
    startY: number;
    origTx: number;
    origTy: number;
    origNode?: { x: number; y: number };
    tempTo?: { x: number; y: number };
  }>({ mode: null, startX: 0, startY: 0, origTx: 0, origTy: 0 });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0); // repaint temp connect line

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const r = wrapRef.current?.getBoundingClientRect();
      const rx = clientX - (r?.left ?? 0);
      const ry = clientY - (r?.top ?? 0);
      return { x: (rx - vp.tx) / vp.scale, y: (ry - vp.ty) / vp.scale };
    },
    [vp]
  );

  // -------- autosave (debounced) --------
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        // Don't persist the (large, re-fetchable) preview blobs; re-hydrate them on load from our
        // library so cards stay fresh and the saved canvas stays small.
        const slimNodes = nodes.map((n) => { const { preview, ...rest } = n; void preview; return rest; });
        await fetch("/api/factory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, canvas: { nodes: slimNodes, edges, viewport: vp } }),
        });
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1200);
      } catch { setSaveState("idle"); }
    }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [nodes, edges, vp, projectId]);

  // -------- node ops --------
  const patchNode = useCallback((id: string, patch: Partial<CanvasNode>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);
  const removeNode = useCallback((id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
  }, []);

  const addNode = useCallback((type: NodeType) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const center = screenToWorld((r?.left ?? 0) + (r?.width ?? 800) / 2, (r?.top ?? 0) + (r?.height ?? 600) / 2);
    const n: CanvasNode = {
      id: uid(),
      type,
      x: Math.round(center.x - NODE_W[type] / 2),
      y: Math.round(center.y - 60),
      w: NODE_W[type],
      ...(type === "frame"
        ? { h: 340, title: "New group", color: FRAME_COLORS[Math.floor(Math.random() * FRAME_COLORS.length)] }
        : type === "note"
        ? { title: "Note", notes: "" }
        : { url: "", notes: "" }),
    };
    setNodes((ns) => [...ns, n]);
  }, [screenToWorld]);

  // -------- preview fetch --------
  const loadPreview = useCallback(async (id: string, url: string) => {
    patchNode(id, { url });
    if (!/instagram\.com/i.test(url)) { patchNode(id, { preview: null }); return; }
    try {
      const res = await fetch(`/api/factory/ig-preview?url=${encodeURIComponent(url)}`);
      const p = (await res.json()) as Preview;
      patchNode(id, { preview: p.ok ? p : null });
    } catch { patchNode(id, { preview: null }); }
  }, [patchNode]);

  // Hydrate previews on load: any reel card that has a link but no preview (seeded boards, or a reload
  // where we intentionally did not persist the blob) fetches its preview from our library once.
  const didHydrate = useRef(false);
  useEffect(() => {
    if (didHydrate.current) return;
    didHydrate.current = true;
    for (const n of nodes) if (n.type === "reel" && n.url && !n.preview) loadPreview(n.id, n.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- pointer handlers --------
  // We capture the pointer on the SURFACE for every drag (pan / move / connect) so the surface's
  // pointermove keeps firing even when the gesture started on a card. Connect targets are hit-tested
  // on release via elementFromPoint, which is more reliable than a per-card up handler under capture.
  const capture = useCallback((pointerId: number) => {
    try { surfaceRef.current?.setPointerCapture(pointerId); } catch { /* ignore */ }
  }, []);

  const onBgPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { mode: "pan", startX: e.clientX, startY: e.clientY, origTx: vp.tx, origTy: vp.ty };
    capture(e.pointerId);
  }, [vp, capture]);

  const onNodePointerDown = useCallback((e: React.PointerEvent, n: CanvasNode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    drag.current = { mode: "node", id: n.id, startX: e.clientX, startY: e.clientY, origTx: vp.tx, origTy: vp.ty, origNode: { x: n.x, y: n.y } };
    capture(e.pointerId);
  }, [vp, capture]);

  const onHandlePointerDown = useCallback((e: React.PointerEvent, n: CanvasNode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const w = screenToWorld(e.clientX, e.clientY);
    drag.current = { mode: "connect", id: n.id, startX: e.clientX, startY: e.clientY, origTx: 0, origTy: 0, tempTo: w };
    capture(e.pointerId);
    force((x) => x + 1);
  }, [screenToWorld, capture]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d.mode) return;
    if (d.mode === "pan") {
      setVp((v) => ({ ...v, tx: d.origTx + (e.clientX - d.startX), ty: d.origTy + (e.clientY - d.startY) }));
    } else if (d.mode === "node" && d.id && d.origNode) {
      const dx = (e.clientX - d.startX) / vp.scale;
      const dy = (e.clientY - d.startY) / vp.scale;
      patchNode(d.id, { x: Math.round(d.origNode.x + dx), y: Math.round(d.origNode.y + dy) });
    } else if (d.mode === "connect") {
      d.tempTo = screenToWorld(e.clientX, e.clientY);
      force((x) => x + 1);
    }
  }, [vp, patchNode, screenToWorld]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (d.mode === "connect" && d.id) {
      // find the node under the cursor on release
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const host = el?.closest?.("[data-node-id]") as HTMLElement | null;
      const targetId = host?.getAttribute("data-node-id");
      if (targetId && targetId !== d.id) {
        setEdges((es) =>
          es.some((x) => x.source === d.id && x.target === targetId)
            ? es
            : [...es, { id: uid(), source: d.id!, target: targetId }]
        );
      }
    }
    drag.current.mode = null;
    force((x) => x + 1);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const mx = e.clientX - (r?.left ?? 0);
    const my = e.clientY - (r?.top ?? 0);
    setVp((v) => {
      const next = Math.min(2.5, Math.max(0.2, v.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
      // keep the point under the cursor fixed
      const wx = (mx - v.tx) / v.scale;
      const wy = (my - v.ty) / v.scale;
      return { scale: next, tx: mx - wx * next, ty: my - wy * next };
    });
  }, []);

  const resetView = useCallback(() => setVp(DEFAULT_VIEWPORT), []);

  const nodeById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Approximate node heights for edge anchors (frames use their h; cards vary, use a stable estimate).
  const nodeHeight = (n: CanvasNode) => (n.type === "frame" ? n.h ?? 340 : n.type === "note" ? 150 : 210);
  const anchor = (n: CanvasNode, side: "r" | "l") => ({
    x: side === "r" ? n.x + n.w : n.x,
    y: n.y + nodeHeight(n) / 2,
  });
  const edgePath = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
  };

  const dotBg = 24 * vp.scale;
  const tempEdge =
    drag.current.mode === "connect" && drag.current.id && drag.current.tempTo
      ? { from: anchor(nodeById.get(drag.current.id)!, "r"), to: drag.current.tempTo }
      : null;

  return (
    <div className="cnv-wrap" ref={wrapRef}>
      {/* Toolbar */}
      <div className="cnv-toolbar">
        <button className="cnv-tool" onClick={() => addNode("reel")} title="Add a reel card">＋ Reel</button>
        <button className="cnv-tool" onClick={() => addNode("note")} title="Add a note">＋ Note</button>
        <button className="cnv-tool" onClick={() => addNode("frame")} title="Add a group frame">＋ Group</button>
        <span className="cnv-sep" />
        <button className="cnv-tool ghost" onClick={() => setVp((v) => ({ ...v, scale: Math.min(2.5, v.scale * 1.1) }))}>＋</button>
        <button className="cnv-tool ghost" onClick={() => setVp((v) => ({ ...v, scale: Math.max(0.2, v.scale * 0.9) }))}>－</button>
        <button className="cnv-tool ghost" onClick={resetView}>{Math.round(vp.scale * 100)}%</button>
        <span className={`cnv-save ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}</span>
      </div>

      {/* Pan/zoom surface */}
      <div
        ref={surfaceRef}
        className="cnv-surface"
        style={{
          backgroundSize: `${dotBg}px ${dotBg}px`,
          backgroundPosition: `${vp.tx}px ${vp.ty}px`,
        }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <div className="cnv-world" style={{ transform: `translate(${vp.tx}px, ${vp.ty}px) scale(${vp.scale})` }}>
          {/* edges */}
          <svg className="cnv-edges" style={{ overflow: "visible" }}>
            {edges.map((e) => {
              const s = nodeById.get(e.source);
              const t = nodeById.get(e.target);
              if (!s || !t) return null;
              return (
                <g key={e.id} className="cnv-edge" onClick={() => setEdges((es) => es.filter((x) => x.id !== e.id))}>
                  <path d={edgePath(anchor(s, "r"), anchor(t, "l"))} />
                  <path className="cnv-edge-hit" d={edgePath(anchor(s, "r"), anchor(t, "l"))} />
                </g>
              );
            })}
            {tempEdge && <path className="cnv-edge-temp" d={edgePath(tempEdge.from, tempEdge.to)} />}
          </svg>

          {/* frames (behind cards) */}
          {nodes.filter((n) => n.type === "frame").map((n) => (
            <div
              key={n.id}
              data-node-id={n.id}
              className="cnv-frame"
              style={{ left: n.x, top: n.y, width: n.w, height: n.h ?? 340, ["--fc" as string]: n.color }}
            >
              <div className="cnv-frame-head" onPointerDown={(e) => onNodePointerDown(e, n)}>
                <input
                  className="cnv-frame-title"
                  value={n.title ?? ""}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(ev) => patchNode(n.id, { title: ev.target.value })}
                />
                <button className="cnv-x" onClick={() => removeNode(n.id)}>✕</button>
              </div>
              <div
                className="cnv-frame-resize"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const start = { x: e.clientX, y: e.clientY, w: n.w, h: n.h ?? 340 };
                  const move = (ev: PointerEvent) => {
                    patchNode(n.id, {
                      w: Math.max(220, start.w + (ev.clientX - start.x) / vp.scale),
                      h: Math.max(160, start.h + (ev.clientY - start.y) / vp.scale),
                    });
                  };
                  const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              />
            </div>
          ))}

          {/* cards */}
          {nodes.filter((n) => n.type !== "frame").map((n) => (
            <NodeCard
              key={n.id}
              n={n}
              onHeaderDown={(e) => onNodePointerDown(e, n)}
              onHandleDown={(e) => onHandlePointerDown(e, n)}
              onPatch={(p) => patchNode(n.id, p)}
              onRemove={() => removeNode(n.id)}
              onSetUrl={(u) => loadPreview(n.id, u)}
            />
          ))}
        </div>
      </div>

      {nodes.length === 0 && (
        <div className="cnv-empty">
          <div className="cnv-empty-title">Empty canvas</div>
          <div className="cnv-empty-sub">Add a group, then drop reel cards inside it. Paste an Instagram link and it previews instantly.</div>
        </div>
      )}
    </div>
  );
}

function NodeCard({
  n, onHeaderDown, onHandleDown, onPatch, onRemove, onSetUrl,
}: {
  n: CanvasNode;
  onHeaderDown: (e: React.PointerEvent) => void;
  onHandleDown: (e: React.PointerEvent) => void;
  onPatch: (p: Partial<CanvasNode>) => void;
  onRemove: () => void;
  onSetUrl: (u: string) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(n.url ?? "");
  const [showTx, setShowTx] = useState(false);
  const p = n.preview;

  return (
    <div
      className="cnv-card"
      data-node-id={n.id}
      style={{ left: n.x, top: n.y, width: n.w }}
      // stop body clicks (textareas, links) from bubbling to the surface and starting a pan;
      // the header + connect handle have their own handlers that also stop propagation.
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cnv-card-head" onPointerDown={onHeaderDown}>
        <span className="cnv-card-kind">{n.type === "reel" ? "REEL" : "NOTE"}</span>
        {n.type === "reel" && p?.reach != null && <span className="cnv-chip">{fmtReach(p.reach)} views</span>}
        {n.type === "reel" && p?.creator && <span className="cnv-chip cap">{String(p.creator)}</span>}
        <button className="cnv-x" onPointerDown={(e) => e.stopPropagation()} onClick={onRemove}>✕</button>
      </div>

      {n.type === "note" && (
        <div className="cnv-card-body">
          <input
            className="cnv-note-title"
            value={n.title ?? ""}
            placeholder="Title"
            onChange={(e) => onPatch({ title: e.target.value })}
          />
          <textarea
            className="cnv-note-text"
            value={n.notes ?? ""}
            placeholder="Settings, targeting, budget, anything…"
            onChange={(e) => onPatch({ notes: e.target.value })}
          />
        </div>
      )}

      {n.type === "reel" && (
        <div className="cnv-card-body">
          {!p && (
            <input
              className="cnv-url"
              value={urlDraft}
              placeholder="Paste Instagram reel link…"
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onSetUrl(urlDraft.trim()); }}
              onBlur={() => urlDraft.trim() && urlDraft.trim() !== n.url && onSetUrl(urlDraft.trim())}
            />
          )}
          {p && p.thumbnail && (
            <a href={p.permalink} target="_blank" rel="noreferrer" className="cnv-thumb-link">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.thumbnail} alt="" className="cnv-thumb" />
              <span className="cnv-play">▶</span>
            </a>
          )}
          {p && !p.thumbnail && p.embedUrl && (
            <iframe className="cnv-embed" src={p.embedUrl} title="reel" loading="lazy" />
          )}
          {p && (p.caption || p.transcript) && (
            <>
              {p.caption && <div className="cnv-caption">{p.caption.slice(0, 140)}</div>}
              {p.transcript && (
                <button className="cnv-tx-toggle" onClick={() => setShowTx((s) => !s)}>
                  {showTx ? "Hide transcript" : `Transcript (${p.transcriptWords} words)`}
                </button>
              )}
              {showTx && p.transcript && <div className="cnv-transcript">{p.transcript}</div>}
            </>
          )}
          {p && (
            <a className="cnv-relink" href={p.permalink} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()}>
              Open on Instagram ↗
            </a>
          )}
          <textarea
            className="cnv-note-text sm"
            value={n.notes ?? ""}
            placeholder="Ad set settings, objective, audience, budget…"
            onChange={(e) => onPatch({ notes: e.target.value })}
          />
        </div>
      )}

      {/* connect handle */}
      <div className="cnv-handle" title="Drag to connect" onPointerDown={onHandleDown} />
    </div>
  );
}
