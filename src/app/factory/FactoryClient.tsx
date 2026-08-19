"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Factory,
  LayoutGrid,
  FolderOpen,
  Download,
  Check,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  History,
  ChevronDown,
  BookOpen,
  ListTree,
  X,
  Pencil,
  MessageSquare,
  Link2,
  Archive as ArchiveIcon,
} from "lucide-react";
import { useSession } from "next-auth/react";
import "./factory.css";
import Workspace from "./Workspace";
import CanvasBoard from "./CanvasBoard";
import { authorIdFrom, authorLabel } from "./types";

// ---- Types mirror the /api/factory response ----
type Stage = "copy_written" | "image_generated" | "revision" | "completed";

interface FComment {
  id: string;
  // "claude" or the commenter's lowercase first name ("alex", "ahmad", …).
  author: string;
  text: string;
  created_at: string;
  quote?: string;
  resolved?: boolean;
}

interface Item {
  id: string;
  project_id: string;
  label: string;
  bucket: string;
  style: string | null;
  copy_text: string | null;
  image_direction: string | null;
  stage: Stage;
  status?: string | null;
  image_url: string | null;
  revision_note: string | null;
  comments?: FComment[] | null;
  // Client (share-link reviewer) feedback. Separate from OUR pipeline: it never
  // moves stage — it is input to Alex's decision, not the decision.
  client_verdict?: "approved" | "change" | null;
  client_note?: string | null;
  sort_order: number;
  versions?: Version[];
}

interface Version {
  version: number;
  image_url: string;
  revision_note: string | null;
  created_at: string;
}

interface Project {
  id: string;
  name: string;
  client: string | null;
  kind?: string;
  canvas?: { nodes?: unknown[]; edges?: unknown[]; viewport?: unknown } | null;
  counts: {
    copy_written: number;
    image_generated: number;
    revision: number;
    completed: number;
    total: number;
  };
  groups?: unknown[];
  items: Item[];
}

const STAGE_COLUMNS: { key: Stage; label: string }[] = [
  { key: "copy_written", label: "Copy Written" },
  { key: "image_generated", label: "Image Generated" },
  { key: "revision", label: "Revision" },
  { key: "completed", label: "Completed" },
];

const BUCKET_LABEL: Record<string, string> = {
  lead_magnet: "Lead Magnet",
  direct_cta: "Direct CTA",
  keeper: "Keeper",
};

function bucketClass(bucket: string): string {
  if (bucket === "lead_magnet") return "fc-tag-bucket fc-tag-lead";
  if (bucket === "direct_cta") return "fc-tag-bucket fc-tag-cta";
  return "fc-tag-bucket fc-tag-keeper";
}

function prettyStyle(style: string | null): string {
  if (!style) return "";
  return style.replace(/-/g, " ");
}

const POLL_MS = 5000;

export default function FactoryClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [view, setView] = useState<"board" | "files" | "detail" | "workspace">("board");
  const autoViewedRef = useRef<string | null>(null);
  const [bucketFilter, setBucketFilter] = useState<string>("all");
  const [styleFilter, setStyleFilter] = useState<string>("all");
  const [groupByBucket, setGroupByBucket] = useState(false);
  // Lightbox holds an item id when opened from a card (so it can offer approve /
  // note / arrow-nav inline), or a bare url when opened from version history,
  // where those actions do not apply.
  const [lightbox, setLightbox] = useState<{ url: string; itemId?: string } | null>(null);
  const [historyItem, setHistoryItem] = useState<Item | null>(null);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const [filesFolder, setFilesFolder] = useState<string>("all"); // bucket folder in Files view
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/factory", { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed to load (${res.status})`);
      }
      const j = await res.json();
      setProjects(j.projects || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const createProject = useCallback(async (kind: "funnel" | "canvas") => {
    const name = window.prompt(kind === "canvas" ? "Name your canvas board" : "Name your project");
    if (!name || !name.trim()) return;
    try {
      const res = await fetch("/api/factory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "createProject", name: name.trim(), kind }),
      });
      const j = await res.json();
      if (!res.ok || !j.project) throw new Error(j.error || "Failed to create");
      await load();
      setActiveProjectId(j.project.id);
      setProjMenuOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    }
  }, [load]);

  // Initial load + live polling (no redeploy needed).
  useEffect(() => {
    load();
    pollRef.current = setInterval(load, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // Default to the LAST-OPENED project (remembered across refreshes), else the first.
  useEffect(() => {
    if (activeProjectId || !projects.length) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("factory:activeProjectId"); } catch {}
    setActiveProjectId(saved && projects.some((p) => p.id === saved) ? saved : projects[0].id);
  }, [projects, activeProjectId]);

  // Remember the open project so a refresh keeps you where you were.
  useEffect(() => {
    if (activeProjectId) { try { localStorage.setItem("factory:activeProjectId", activeProjectId); } catch {} }
  }, [activeProjectId]);

  // Once per project: pick the natural view. Funnel projects (with groups) open
  // in the nested Workspace; legacy image-only projects open on the Board.
  useEffect(() => {
    if (!activeProjectId) return;
    if (autoViewedRef.current === activeProjectId) return;
    const p = projects.find((x) => x.id === activeProjectId);
    if (!p) return;
    autoViewedRef.current = activeProjectId;
    setView((p.groups?.length ?? 0) > 0 ? "workspace" : "board");
  }, [activeProjectId, projects]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || null,
    [projects, activeProjectId]
  );

  // Archived items live in the project's own archive, never on the working views.
  const activeItems = useMemo(
    () => (activeProject ? activeProject.items.filter((it) => it.status !== "archived") : []),
    [activeProject]
  );
  const archivedItems = useMemo(
    () => (activeProject ? activeProject.items.filter((it) => it.status === "archived") : []),
    [activeProject]
  );

  const styleOptions = useMemo(() => {
    const s = new Set<string>();
    for (const it of activeItems) if (it.style) s.add(it.style);
    return Array.from(s).sort();
  }, [activeItems]);

  const filteredItems = useMemo(() => {
    return activeItems.filter((it) => {
      if (bucketFilter !== "all" && it.bucket !== bucketFilter) return false;
      if (styleFilter !== "all" && it.style !== styleFilter) return false;
      return true;
    });
  }, [activeItems, bucketFilter, styleFilter]);

  // ---- Item mutations (optimistic-ish: refetch right after) ----
  const patchItem = useCallback(
    async (id: string, payload: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/factory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, ...payload }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `Update failed (${res.status})`);
        }
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      }
    },
    [load]
  );

  const approve = (id: string) => patchItem(id, { approve: true });
  const sendRevision = (id: string, note: string) => patchItem(id, { revisionNote: note });
  const archiveItem = (id: string) => patchItem(id, { status: "archived" });
  const restoreItem = (id: string) => patchItem(id, { status: "" });
  const [archiveOpen, setArchiveOpen] = useState(false);

  // Get-or-mint the public share link for the active project and put it on the
  // clipboard. The link opens the no-login client review board (/p/factory).
  const [shareState, setShareState] = useState<"idle" | "busy" | "copied" | "failed">("idle");
  const shareProject = useCallback(async () => {
    if (!activeProject || shareState === "busy") return;
    setShareState("busy");
    try {
      const res = await fetch(`/api/factory/share-link?projectId=${activeProject.id}`);
      if (!res.ok) throw new Error();
      const j = await res.json();
      if (!j.url) throw new Error();
      await navigator.clipboard.writeText(j.url);
      setShareState("copied");
    } catch {
      setShareState("failed");
    }
    window.setTimeout(() => setShareState("idle"), 2000);
  }, [activeProject, shareState]);

  function exportCompleted() {
    if (!activeProject) return;
    window.location.href = `/api/factory?export=completed&projectId=${activeProject.id}`;
  }

  // ---------------------------------------------------------------- render
  if (loading && !projects.length) {
    return (
      <div className="fc-wrap">
        <div className="fc-empty">Loading the Factory…</div>
      </div>
    );
  }

  return (
    <div className="fc-wrap">
      {error && <div className="fc-error">{error}</div>}

      {!activeProject ? (
        <div className="fc-empty">No projects yet.</div>
      ) : view === "detail" ? (
        <DetailView
          project={activeProject}
          items={filteredItems}
          onBack={() => setView("board")}
          onApprove={approve}
          onRevision={sendRevision}
          onHistory={setHistoryItem}
        />
      ) : (
        <>
          {/* One topbar: identity on the left, actions + views on the right. */}
          <header className="fc-topbar">
            <span className="fc-brand" title="Factory">
              <Factory size={16} />
            </span>

            <div className="fc-projectwrap">
              <button
                className="fc-projectname"
                onClick={() => setProjMenuOpen((o) => !o)}
                title="Switch project"
              >
                <span className="fc-projectname-text">{activeProject.name}</span>
                {activeProject.client && <span className="fc-projectclient">{activeProject.client}</span>}
                <ChevronDown size={14} className="fc-proj-chev" />
              </button>
              {projMenuOpen && (
                <div className="fc-projmenu">
                  <div className="fc-projmenu-label">Projects</div>
                  {projects.map((p) => (
                    <button
                      key={p.id}
                      className={`fc-projmenu-item ${p.id === activeProjectId ? "on" : ""}`}
                      onClick={() => { setActiveProjectId(p.id); setProjMenuOpen(false); setView("board"); }}
                    >
                      <span className="fc-projmenu-name">{p.name}</span>
                      <span className="fc-projmenu-count">
                        {p.counts.total > 0 ? `${p.counts.completed}/${p.counts.total}` : "empty"}
                      </span>
                    </button>
                  ))}
                  <div className="fc-projmenu-new">
                    <button className="fc-projmenu-newbtn" onClick={() => createProject("funnel")}>＋ New project</button>
                    <button className="fc-projmenu-newbtn canvas" onClick={() => createProject("canvas")}>＋ New canvas</button>
                  </div>
                  <div className="fc-projmenu-hint">Canvas boards are freeform whiteboards for planning content and ad sets.</div>
                </div>
              )}
            </div>

            <span className="fc-topbar-spacer" />

            {activeProject.kind === "canvas" ? (
              <span className="fc-canvas-badge">Canvas board</span>
            ) : (
              <>
                <button
                  className="fc-tool-btn"
                  onClick={() => setArchiveOpen(true)}
                  title="This project's archive"
                >
                  <ArchiveIcon size={14} />
                  Archive
                  {archivedItems.length > 0 && (
                    <span className="fc-tool-count">{archivedItems.length}</span>
                  )}
                </button>
                <button
                  className="fc-tool-btn"
                  onClick={shareProject}
                  disabled={shareState === "busy"}
                  title="Copy a no-login review link for this project"
                >
                  <Link2 size={14} />
                  {shareState === "copied" ? "Link copied" : shareState === "failed" ? "Could not copy" : "Share"}
                </button>
                <div className="fc-viewtoggle">
                  <button
                    className={`fc-vt-btn ${view === "workspace" ? "fc-vt-active" : ""}`}
                    onClick={() => setView("workspace")}
                  >
                    <ListTree size={14} /> Workspace
                  </button>
                  <button
                    className={`fc-vt-btn ${view === "board" ? "fc-vt-active" : ""}`}
                    onClick={() => setView("board")}
                  >
                    <LayoutGrid size={14} /> Board
                  </button>
                  <button
                    className={`fc-vt-btn ${view === "files" ? "fc-vt-active" : ""}`}
                    onClick={() => setView("files")}
                  >
                    <FolderOpen size={14} /> Files
                  </button>
                  <button
                    className="fc-vt-btn"
                    onClick={() => setView("detail")}
                  >
                    <BookOpen size={14} /> Read all
                  </button>
                </div>
              </>
            )}
          </header>

          {/* Filters, only where they mean something (image-ad views). */}
          {activeProject.kind !== "canvas" && view !== "workspace" && (
          <div className="fc-filterbar">
            <div className="fc-seg">
              {[
                { v: "all", l: "All" },
                { v: "lead_magnet", l: "Lead Magnet" },
                { v: "direct_cta", l: "Direct CTA" },
              ].map((b) => (
                <button
                  key={b.v}
                  className={`fc-seg-btn ${bucketFilter === b.v ? "fc-seg-active" : ""}`}
                  onClick={() => setBucketFilter(b.v)}
                >
                  {b.l}
                </button>
              ))}
            </div>

            {styleOptions.length > 0 && (
              <select
                className="fc-select fc-select-sm"
                value={styleFilter}
                onChange={(e) => setStyleFilter(e.target.value)}
              >
                <option value="all">All styles</option>
                {styleOptions.map((s) => (
                  <option key={s} value={s}>
                    {prettyStyle(s)}
                  </option>
                ))}
              </select>
            )}

            {view === "board" && (
              <button
                className={`fc-seg-btn fc-group-toggle ${groupByBucket ? "fc-seg-active" : ""}`}
                aria-pressed={groupByBucket}
                onClick={() => setGroupByBucket((g) => !g)}
                title="Group board cards by bucket"
              >
                Group by bucket
              </button>
            )}

            <span className="fc-filtercount">
              {filteredItems.length === activeItems.length
                ? `${activeItems.length} ads`
                : `${filteredItems.length} of ${activeItems.length}`}
            </span>
          </div>
          )}

          {activeProject.kind === "canvas" ? (
            <CanvasBoard projectId={activeProject.id} initial={activeProject.canvas ?? null} />
          ) : view === "workspace" ? (
            <Workspace projectId={activeProject.id} />
          ) : view === "board" ? (
            <BoardView
              items={filteredItems}
              groupByBucket={groupByBucket}
              onApprove={approve}
              onRevision={sendRevision}
              onArchive={archiveItem}
              onExport={exportCompleted}
              onLightbox={setLightbox}
              onHistory={setHistoryItem}
              onPatch={patchItem}
              completedCount={
                filteredItems.filter((i) => i.stage === "completed").length
              }
            />
          ) : (
            <FilesView
              items={filteredItems}
              folder={filesFolder}
              setFolder={setFilesFolder}
              onLightbox={setLightbox}
            />
          )}
        </>
      )}

      {historyItem && (
        <VersionHistory
          item={historyItem}
          onClose={() => setHistoryItem(null)}
          onLightbox={setLightbox}
        />
      )}

      {archiveOpen && activeProject && (
        <ArchivePanel
          projectName={activeProject.name}
          items={archivedItems}
          onRestore={restoreItem}
          onClose={() => setArchiveOpen(false)}
          onLightbox={setLightbox}
        />
      )}

      {lightbox && (
        <ImageViewer
          url={lightbox.url}
          itemId={lightbox.itemId}
          items={filteredItems}
          onNavigate={(it) => setLightbox({ url: it.image_url!, itemId: it.id })}
          onApprove={approve}
          onRevision={sendRevision}
          onArchive={archiveItem}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// =========================================================================
// Image viewer — the normal "click an image" view, with review controls built in
// =========================================================================
// Rendered through a PORTAL to document.body on purpose: .main-content sets
// position:relative + z-index:1, which creates a stacking context that traps any
// child's z-index, so an in-tree overlay renders UNDER the sidebar no matter how
// high its z-index is.
//
// Keys: ArrowLeft/Right move between images, Enter approves when the note box is
// empty and sends the note when it is not, X (with an empty note box) archives,
// Esc closes.
function ImageViewer({
  url,
  itemId,
  items,
  onNavigate,
  onApprove,
  onRevision,
  onArchive,
  onClose,
}: {
  url: string;
  itemId?: string;
  items: Item[];
  onNavigate: (item: Item) => void;
  onApprove: (id: string) => void;
  onRevision: (id: string, note: string) => void;
  onArchive?: (id: string) => void;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Only items that actually have an image take part in arrow navigation.
  const deck = useMemo(() => items.filter((i) => i.image_url), [items]);
  const index = useMemo(() => deck.findIndex((i) => i.id === itemId), [deck, itemId]);
  const item = index >= 0 ? deck[index] : null;

  // Note box owns focus so you can just start typing on any image.
  useEffect(() => {
    setNote("");
    inputRef.current?.focus();
  }, [itemId]);

  const say = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(""), 1200);
  }, []);

  const go = useCallback(
    (delta: number) => {
      if (index < 0) return;
      const next = deck[index + delta];
      if (next) onNavigate(next);
    },
    [deck, index, onNavigate]
  );

  const act = useCallback(() => {
    if (!item) return;
    const text = note.trim();
    if (text) {
      onRevision(item.id, text);
      say("Note sent");
    } else {
      onApprove(item.id);
      say("Approved");
    }
    // Advance if there is a next image, otherwise close out of the deck.
    const next = deck[index + 1];
    if (next) onNavigate(next);
    else onClose();
  }, [item, note, onRevision, onApprove, deck, index, onNavigate, onClose, say]);

  // Archive the current image and keep moving through the deck.
  const archive = useCallback(() => {
    if (!item || !onArchive) return;
    onArchive(item.id);
    say("Archived");
    const next = deck[index + 1] ?? deck[index - 1];
    if (next) onNavigate(next);
    else onClose();
  }, [item, onArchive, deck, index, onNavigate, onClose, say]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Enter" && item) {
        e.preventDefault();
        act();
      } else if ((e.key === "x" || e.key === "X") && item && !note.trim()) {
        // X only acts while the note box is empty, so typing "x" in a note
        // never fires it.
        e.preventDefault();
        archive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, act, archive, item, note, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fc-lightbox" onClick={onClose}>
      <button className="fc-lightbox-close" aria-label="Close" onClick={onClose}>
        <X size={22} />
      </button>

      {item && index > 0 && (
        <button
          className="fc-lb-nav fc-lb-prev"
          aria-label="Previous"
          onClick={(e) => {
            e.stopPropagation();
            go(-1);
          }}
        >
          <ChevronLeft size={20} />
        </button>
      )}

      <div className="fc-lb-stage" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="fc-lb-img" src={url} alt={item?.label ?? ""} />

        {item && (
          <div className="fc-lb-tools">
            <div className="fc-lb-meta">
              <span className="fc-lb-label">{item.label}</span>
              <span className={`fc-lb-stagetag fc-lb-${item.stage}`}>{item.stage.replace("_", " ")}</span>
              <span className="fc-lb-pos">
                {index + 1} / {deck.length}
              </span>
              {onArchive && (
                <button
                  className="fc-lb-archive"
                  onClick={archive}
                  title="Move to this project's archive (X)"
                >
                  <ArchiveIcon size={13} /> Archive
                </button>
              )}
            </div>
            {item.client_verdict && (
              <div className={`fc-lb-client fc-lb-client-${item.client_verdict}`}>
                {item.client_verdict === "approved"
                  ? "Client: looks good"
                  : `Client asked for: ${item.client_note ?? "a change"}`}
              </div>
            )}
            <div className="fc-lb-row">
              <input
                ref={inputRef}
                className="fc-lb-input"
                value={note}
                placeholder="Note to fix… (Enter sends · empty Enter approves · X archives)"
                onChange={(e) => setNote(e.target.value)}
              />
              <button className={`fc-lb-act ${note.trim() ? "fc-lb-send" : "fc-lb-ok"}`} onClick={act}>
                {note.trim() ? "Send" : "Approve"}
              </button>
            </div>
          </div>
        )}
      </div>

      {item && index < deck.length - 1 && (
        <button
          className="fc-lb-nav fc-lb-next"
          aria-label="Next"
          onClick={(e) => {
            e.stopPropagation();
            go(1);
          }}
        >
          <ChevronRight size={20} />
        </button>
      )}

      {flash && <div className="fc-lb-flash">{flash}</div>}
    </div>,
    document.body
  );
}

// =========================================================================
// Board (kanban)
// =========================================================================
function BoardView({
  items,
  groupByBucket,
  onApprove,
  onRevision,
  onArchive,
  onExport,
  onLightbox,
  onHistory,
  onPatch,
  completedCount,
}: {
  items: Item[];
  groupByBucket: boolean;
  onApprove: (id: string) => void;
  onRevision: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onExport: () => void;
  onLightbox: (payload: { url: string; itemId?: string }) => void;
  onHistory: (item: Item) => void;
  onPatch: (id: string, payload: Record<string, unknown>) => void;
  completedCount: number;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Stage | null>(null);
  const dragged = dragId ? items.find((i) => i.id === dragId) || null : null;

  const cardProps = (it: Item) => ({
    item: it,
    onApprove,
    onRevision,
    onArchive,
    onLightbox,
    onHistory,
    onPatch,
    dragging: dragId === it.id,
    onDragStart: () => setDragId(it.id),
    onDragEnd: () => { setDragId(null); setOverCol(null); },
  });

  return (
    <div className="fc-board">
      {STAGE_COLUMNS.map((col) => {
        const colItems = items.filter((i) => i.stage === col.key);
        const canDrop = !!dragged && dragged.stage !== col.key;
        const isOver = overCol === col.key && canDrop;
        return (
          <div
            className={`fc-col ${dragged ? (canDrop ? "fc-col-can" : "") : ""} ${isOver ? "fc-col-over" : ""}`}
            key={col.key}
            onDragOver={(e) => { if (canDrop) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setOverCol(col.key); } }}
            onDragLeave={() => setOverCol((c) => (c === col.key ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOverCol(null);
              if (dragged && canDrop) onPatch(dragged.id, { stage: col.key });
              setDragId(null);
            }}
          >
            <div className="fc-col-head">
              <span className="fc-col-title">{col.label}</span>
              <span className="fc-col-count">{colItems.length}</span>
              {col.key === "completed" && completedCount > 0 && (
                <button className="fc-export-btn" onClick={onExport} title="Export completed">
                  <Download size={13} /> Export
                </button>
              )}
            </div>
            <div className="fc-col-body">
              {colItems.length === 0 && <div className="fc-col-empty">{isOver ? "Drop here" : "Nothing here"}</div>}
              {groupByBucket
                ? groupedByBucket(colItems).map(([bucket, group]) => (
                    <div key={bucket} className="fc-subsection">
                      <div className="fc-subsection-label">{BUCKET_LABEL[bucket] || bucket}</div>
                      {group.map((it) => <Card key={it.id} {...cardProps(it)} />)}
                    </div>
                  ))
                : colItems.map((it) => <Card key={it.id} {...cardProps(it)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function groupedByBucket(items: Item[]): [string, Item[]][] {
  const map = new Map<string, Item[]>();
  for (const it of items) {
    if (!map.has(it.bucket)) map.set(it.bucket, []);
    map.get(it.bucket)!.push(it);
  }
  return Array.from(map.entries());
}

// =========================================================================
// Version history — subtle vN pill opens this read-only past-images modal
// =========================================================================
function VersionHistory({
  item,
  onClose,
  onLightbox,
}: {
  item: Item;
  onClose: () => void;
  onLightbox: (payload: { url: string; itemId?: string }) => void;
}) {
  const versions = (item.versions ?? []).slice().sort((a, b) => b.version - a.version);
  return (
    <div className="fc-history" onClick={onClose}>
      <div className="fc-history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fc-history-head">
          <span className="fc-history-title">{item.label} · version history</span>
          <button className="fc-history-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {versions.length === 0 ? (
          <div className="fc-col-empty">No versions yet.</div>
        ) : (
          <div className="fc-history-list">
            {versions.map((v) => (
              <div key={v.version} className="fc-history-row">
                {v.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="fc-history-thumb"
                    src={v.image_url}
                    alt={`v${v.version}`}
                    onClick={() => onLightbox({ url: v.image_url })}
                  />
                ) : (
                  <div className="fc-history-noimg">no image</div>
                )}
                <div className="fc-history-meta">
                  <span className="fc-history-vlabel">v{v.version}</span>
                  <span className="fc-history-date">
                    {new Date(v.created_at).toLocaleString()}
                  </span>
                  <span className="fc-history-note">
                    {v.revision_note ? v.revision_note : "Original"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({
  item,
  onApprove,
  onRevision,
  onArchive,
  onLightbox,
  onHistory,
  onPatch,
  dragging,
  onDragStart,
  onDragEnd,
}: {
  item: Item;
  onApprove: (id: string) => void;
  onRevision: (id: string, note: string) => void;
  onArchive: (id: string) => void;
  onLightbox: (payload: { url: string; itemId?: string }) => void;
  onHistory: (item: Item) => void;
  onPatch: (id: string, payload: Record<string, unknown>) => void;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [noting, setNoting] = useState(false);
  const [draft, setDraft] = useState(item.copy_text || "");
  const [commentDraft, setCommentDraft] = useState("");
  const [showComments, setShowComments] = useState(false);
  const { data: session } = useSession();
  const author = authorIdFrom(session?.user?.name, session?.user?.email);

  const comments = item.comments || [];

  const submitRevision = () => {
    const n = note.trim();
    if (!n) return;
    onRevision(item.id, n);
    setNote("");
    setNoting(false);
  };

  const saveCopy = () => {
    setEditing(false);
    if (draft !== (item.copy_text || "")) onPatch(item.id, { copyText: draft });
  };

  const addComment = () => {
    const t = commentDraft.trim();
    if (!t) return;
    const next = [...comments, {
      id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      author, text: t, created_at: new Date().toISOString(),
    }];
    setCommentDraft("");
    onPatch(item.id, { comments: next });
  };
  const removeComment = (cid: string) =>
    onPatch(item.id, { comments: comments.filter((c) => c.id !== cid) });

  return (
    <div
      className={`fc-card ${dragging ? "fc-card-dragging" : ""}`}
      draggable={!editing}
      onDragStart={(e) => {
        // Never hijack a drag that started inside a text field or on the image.
        const t = e.target as HTMLElement;
        if (t.closest("textarea, input, .fc-card-thumb")) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      <div className="fc-card-head">
        <span className="fc-card-label">{item.label}</span>
        <span className={bucketClass(item.bucket)}>{BUCKET_LABEL[item.bucket] || item.bucket}</span>
        {item.style && <span className="fc-tag-style">{prettyStyle(item.style)}</span>}
        {(item.versions?.length ?? 0) > 0 && (
          <button
            className="fc-vpill"
            onClick={() => onHistory(item)}
            title="Version history"
          >
            <History size={10} /> v{item.versions!.length}
          </button>
        )}
        <button
          className="fc-card-archive"
          onClick={() => onArchive(item.id)}
          title="Move to this project's archive"
          aria-label="Archive"
        >
          <ArchiveIcon size={13} />
        </button>
      </div>

      {item.client_verdict && (
        <div className={`fc-client fc-client-${item.client_verdict}`}>
          <span className="fc-client-tag">
            {item.client_verdict === "approved" ? "Client: looks good" : "Client asked for a change"}
          </span>
          {item.client_note && <span className="fc-client-note">{item.client_note}</span>}
        </div>
      )}

      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="fc-card-thumb"
          src={item.image_url}
          alt={item.label}
          onClick={() => onLightbox({ url: item.image_url!, itemId: item.id })}
        />
      ) : (
        <div className="fc-card-noimg">
          <ImageIcon size={14} />
          <span>{item.image_direction || "No image yet"}</span>
        </div>
      )}

      {editing ? (
        <div className="fc-copy-edit">
          <textarea
            autoFocus
            className="fc-copy-input"
            rows={Math.min(18, (draft.split("\n").length || 1) + 1)}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setDraft(item.copy_text || ""); setEditing(false); } }}
          />
          <div className="fc-copy-edit-actions">
            <button className="fc-act-approve" onClick={saveCopy}>Save</button>
            <button className="fc-readmore" onClick={() => { setDraft(item.copy_text || ""); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <p className={`fc-card-copy ${open ? "fc-card-copy-open" : ""}`}>{item.copy_text}</p>
          {(item.copy_text?.length ?? 0) > 160 && (
            <button className="fc-readmore" onClick={() => setOpen((o) => !o)}>
              {open ? "Show less" : "Read more"}
            </button>
          )}
        </>
      )}

      {item.revision_note && item.stage === "revision" && (
        <div className="fc-revision-note">
          <RotateCcw size={11} /> {item.revision_note}
        </div>
      )}

      <div className="fc-card-actions">
        {item.stage !== "completed" ? (
          <button className="fc-act-approve" onClick={() => onApprove(item.id)}>
            <Check size={13} /> Approve
          </button>
        ) : (
          <button className="fc-act-reopen" onClick={() => onPatch(item.id, { stage: "copy_written" })} title="Move back to Copy written">
            <RotateCcw size={13} /> Reopen
          </button>
        )}
        <button
          className={`fc-act-comment ${noting ? "on" : ""}`}
          onClick={() => setNoting((v) => !v)}
          title="Send a revision note"
        >
          <RotateCcw size={13} /> Note
        </button>
        {!editing && (
          <button className="fc-act-edit" onClick={() => { setDraft(item.copy_text || ""); setEditing(true); }}>
            <Pencil size={13} /> Edit copy
          </button>
        )}
        <button className={`fc-act-comment ${showComments ? "on" : ""}`} onClick={() => setShowComments((v) => !v)}>
          <MessageSquare size={13} /> {comments.length || "Comment"}
        </button>
      </div>

      {showComments && (
        <div className="fc-comments">
          {comments.length === 0 && <div className="fc-comment-empty">No comments yet.</div>}
          {comments.map((c) => (
            <div key={c.id} className={`fc-comment fc-comment-${c.author}`}>
              <div className="fc-comment-head">
                <span className="fc-comment-author">{authorLabel(c.author)}</span>
                <button className="fc-comment-x" onClick={() => removeComment(c.id)} aria-label="Delete comment">×</button>
              </div>
              <div className="fc-comment-text">{c.text}</div>
            </div>
          ))}
          <div className="fc-comment-add">
            <textarea
              className="fc-revise-input"
              rows={2}
              placeholder="Leave a note on this copy…"
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addComment(); } }}
            />
            <button className="fc-revise-send" onClick={addComment} disabled={!commentDraft.trim()}>Add</button>
          </div>
        </div>
      )}

      {noting && (
        <div className="fc-revise-row">
          <textarea
            autoFocus
            className="fc-revise-input"
            placeholder="What to change…"
            rows={2}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 220) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitRevision(); }
              if (e.key === "Escape") { setNote(""); setNoting(false); }
            }}
          />
          <button className="fc-revise-send" onClick={submitRevision} disabled={!note.trim()}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Archive panel — one tidy home per project for killed ads, with restore
// =========================================================================
function ArchivePanel({
  projectName,
  items,
  onRestore,
  onClose,
  onLightbox,
}: {
  projectName: string;
  items: Item[];
  onRestore: (id: string) => void;
  onClose: () => void;
  onLightbox: (payload: { url: string; itemId?: string }) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fc-history" onClick={onClose}>
      <div className="fc-history-panel fc-arch-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fc-history-head">
          <span className="fc-history-title">
            Archive · {projectName}
            <span className="fc-arch-count">{items.length}</span>
          </span>
          <button className="fc-history-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {items.length === 0 ? (
          <div className="fc-col-empty">
            Nothing archived. Press X on any image in the expanded view, or the
            archive icon on a card, to move it here.
          </div>
        ) : (
          <div className="fc-arch-grid">
            {items.map((it) => (
              <div key={it.id} className="fc-arch-tile">
                {it.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="fc-arch-thumb"
                    src={it.image_url}
                    alt={it.label}
                    onClick={() => onLightbox({ url: it.image_url! })}
                  />
                ) : (
                  <div className="fc-arch-noimg">
                    <ImageIcon size={14} />
                  </div>
                )}
                <div className="fc-arch-meta">
                  <span className="fc-arch-label">{it.label}</span>
                  <button className="fc-arch-restore" onClick={() => onRestore(it.id)}>
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// =========================================================================
// Detail view — read all copy in one scroll
// =========================================================================
function DetailView({
  project,
  items,
  onBack,
  onApprove,
  onRevision,
  onHistory,
}: {
  project: Project;
  items: Item[];
  onBack: () => void;
  onApprove: (id: string) => void;
  onRevision: (id: string, note: string) => void;
  onHistory: (item: Item) => void;
}) {
  return (
    <div className="fc-detail">
      <div className="fc-detail-head">
        <button className="fc-back" onClick={onBack}>
          <ChevronLeft size={16} /> Board
        </button>
        <h2 className="fc-detail-title">{project.name}</h2>
        <span className="fc-detail-count">{items.length} ads</span>
      </div>

      <div className="fc-detail-list">
        {items.map((it) => (
          <DetailRow key={it.id} item={it} onApprove={onApprove} onRevision={onRevision} onHistory={onHistory} />
        ))}
      </div>
    </div>
  );
}

function DetailRow({
  item,
  onApprove,
  onRevision,
  onHistory,
}: {
  item: Item;
  onApprove: (id: string) => void;
  onRevision: (id: string, note: string) => void;
  onHistory: (item: Item) => void;
}) {
  const [note, setNote] = useState("");
  const submit = () => {
    const n = note.trim();
    if (!n) return;
    onRevision(item.id, n);
    setNote("");
  };
  return (
    <article className="fc-detail-row">
      <div className="fc-detail-meta">
        <span className="fc-card-label">{item.label}</span>
        <span className={bucketClass(item.bucket)}>{BUCKET_LABEL[item.bucket] || item.bucket}</span>
        {item.style && <span className="fc-tag-style">{prettyStyle(item.style)}</span>}
        <span className={`fc-stage-pill fc-stage-${item.stage}`}>
          {STAGE_COLUMNS.find((s) => s.key === item.stage)?.label}
        </span>
        {(item.versions?.length ?? 0) > 0 && (
          <button className="fc-vpill" onClick={() => onHistory(item)} title="Version history">
            <History size={10} /> v{item.versions!.length}
          </button>
        )}
      </div>
      <div className="fc-detail-body">
        <pre className="fc-detail-copy">{item.copy_text}</pre>
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="fc-detail-thumb" src={item.image_url} alt={item.label} />
        ) : (
          <div className="fc-detail-imgdir">{item.image_direction}</div>
        )}
      </div>
      <div className="fc-detail-actions">
        {item.stage !== "completed" && (
          <button className="fc-act-approve" onClick={() => onApprove(item.id)}>
            <Check size={13} /> Approve
          </button>
        )}
        <textarea
          className="fc-revise-input"
          placeholder="What to change…"
          rows={2}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = Math.min(e.target.scrollHeight, 220) + "px";
          }}
        />
        <button className="fc-revise-send" onClick={submit} disabled={!note.trim()}>
          Send revision
        </button>
      </div>
    </article>
  );
}

// =========================================================================
// Files view — macOS-Finder-style browser of generated images
// =========================================================================
function FilesView({
  items,
  folder,
  setFolder,
  onLightbox,
}: {
  items: Item[];
  folder: string;
  setFolder: (f: string) => void;
  onLightbox: (payload: { url: string; itemId?: string }) => void;
}) {
  const withImages = items.filter((i) => i.image_url);
  const buckets = Array.from(new Set(items.map((i) => i.bucket)));

  const shown = withImages.filter((i) => folder === "all" || i.bucket === folder);

  return (
    <div className="fc-finder">
      <aside className="fc-finder-side">
        <button
          className={`fc-folder ${folder === "all" ? "fc-folder-active" : ""}`}
          onClick={() => setFolder("all")}
        >
          <FolderOpen size={15} /> All files
          <span className="fc-folder-count">{withImages.length}</span>
        </button>
        {buckets.map((b) => {
          const n = withImages.filter((i) => i.bucket === b).length;
          return (
            <button
              key={b}
              className={`fc-folder ${folder === b ? "fc-folder-active" : ""}`}
              onClick={() => setFolder(b)}
            >
              <FolderOpen size={15} /> {BUCKET_LABEL[b] || b}
              <span className="fc-folder-count">{n}</span>
            </button>
          );
        })}
      </aside>

      <div className="fc-finder-main">
        {shown.length === 0 ? (
          <div className="fc-col-empty">No generated images in this folder yet.</div>
        ) : (
          <div className="fc-finder-grid">
            {shown.map((it) => (
              <button key={it.id} className="fc-file" onClick={() => onLightbox({ url: it.image_url!, itemId: it.id })}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.image_url!} alt={it.label} />
                <span className="fc-file-name">{it.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
