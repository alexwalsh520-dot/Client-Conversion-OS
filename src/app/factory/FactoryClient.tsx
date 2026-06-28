"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Factory,
  LayoutGrid,
  FolderOpen,
  Download,
  Check,
  RotateCcw,
  ChevronLeft,
  Image as ImageIcon,
  History,
  ChevronDown,
  BookOpen,
  ListTree,
  X,
} from "lucide-react";
import "./factory.css";
import Workspace from "./Workspace";

// ---- Types mirror the /api/factory response ----
type Stage = "copy_written" | "image_generated" | "revision" | "completed";

interface Item {
  id: string;
  project_id: string;
  label: string;
  bucket: string;
  style: string | null;
  copy_text: string | null;
  image_direction: string | null;
  stage: Stage;
  image_url: string | null;
  revision_note: string | null;
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
  const [lightbox, setLightbox] = useState<string | null>(null);
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

  // Initial load + live polling (no redeploy needed).
  useEffect(() => {
    load();
    pollRef.current = setInterval(load, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  // Default to the first project once data arrives.
  useEffect(() => {
    if (!activeProjectId && projects.length) setActiveProjectId(projects[0].id);
  }, [projects, activeProjectId]);

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

  const styleOptions = useMemo(() => {
    if (!activeProject) return [];
    const s = new Set<string>();
    for (const it of activeProject.items) if (it.style) s.add(it.style);
    return Array.from(s).sort();
  }, [activeProject]);

  const filteredItems = useMemo(() => {
    if (!activeProject) return [];
    return activeProject.items.filter((it) => {
      if (bucketFilter !== "all" && it.bucket !== bucketFilter) return false;
      if (styleFilter !== "all" && it.style !== styleFilter) return false;
      return true;
    });
  }, [activeProject, bucketFilter, styleFilter]);

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
      {/* Header */}
      <header className="fc-header">
        <div className="fc-title-row">
          <span className="fc-title-icon">
            <Factory size={20} />
          </span>
          <div>
            <h1 className="fc-title">Factory</h1>
            <p className="fc-subtitle">Live creative-production tracker</p>
          </div>
        </div>

        {projects.length > 1 && (
          <select
            className="fc-select"
            value={activeProjectId ?? ""}
            onChange={(e) => {
              setActiveProjectId(e.target.value);
              setView("board");
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </header>

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
          {/* Project bar: name + view toggle */}
          <div className="fc-projectbar">
            <div className="fc-projectwrap">
              <button
                className="fc-projectname"
                onClick={() => setProjMenuOpen((o) => !o)}
                title="Switch project"
              >
                <span className="fc-projectname-text">{activeProject.name}</span>
                {activeProject.client && <span className="fc-projectclient">{activeProject.client}</span>}
                <span className="fc-projectcount">{activeProject.counts.total} ads</span>
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
                      <span>{p.name}</span>
                      <span className="fc-projmenu-count">{p.counts.total}</span>
                    </button>
                  ))}
                  <div className="fc-projmenu-hint">More projects show up here as you add creative sprints.</div>
                </div>
              )}
            </div>

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
          </div>

          {/* Filter / group bar (image-ad views only) */}
          {view !== "workspace" && (
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

            {view === "board" && (
              <label className="fc-checkbox">
                <input
                  type="checkbox"
                  checked={groupByBucket}
                  onChange={(e) => setGroupByBucket(e.target.checked)}
                />
                Group by bucket
              </label>
            )}

            <span className="fc-filtercount">{filteredItems.length} shown</span>
          </div>
          )}

          {view === "workspace" ? (
            <Workspace projectId={activeProject.id} />
          ) : view === "board" ? (
            <BoardView
              items={filteredItems}
              groupByBucket={groupByBucket}
              onApprove={approve}
              onRevision={sendRevision}
              onExport={exportCompleted}
              onLightbox={setLightbox}
              onHistory={setHistoryItem}
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

      {lightbox && (
        <div className="fc-lightbox" onClick={() => setLightbox(null)}>
          <button className="fc-lightbox-close" aria-label="Close">
            <X size={22} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
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
  onExport,
  onLightbox,
  onHistory,
  completedCount,
}: {
  items: Item[];
  groupByBucket: boolean;
  onApprove: (id: string) => void;
  onRevision: (id: string, note: string) => void;
  onExport: () => void;
  onLightbox: (url: string) => void;
  onHistory: (item: Item) => void;
  completedCount: number;
}) {
  return (
    <div className="fc-board">
      {STAGE_COLUMNS.map((col) => {
        const colItems = items.filter((i) => i.stage === col.key);
        return (
          <div className="fc-col" key={col.key}>
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
              {colItems.length === 0 && <div className="fc-col-empty">Nothing here</div>}
              {groupByBucket
                ? groupedByBucket(colItems).map(([bucket, group]) => (
                    <div key={bucket} className="fc-subsection">
                      <div className="fc-subsection-label">{BUCKET_LABEL[bucket] || bucket}</div>
                      {group.map((it) => (
                        <Card
                          key={it.id}
                          item={it}
                          onApprove={onApprove}
                          onRevision={onRevision}
                          onLightbox={onLightbox}
                          onHistory={onHistory}
                        />
                      ))}
                    </div>
                  ))
                : colItems.map((it) => (
                    <Card
                      key={it.id}
                      item={it}
                      onApprove={onApprove}
                      onRevision={onRevision}
                      onLightbox={onLightbox}
                      onHistory={onHistory}
                    />
                  ))}
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
  onLightbox: (url: string) => void;
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
                    onClick={() => onLightbox(v.image_url)}
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
  onLightbox,
  onHistory,
}: {
  item: Item;
  onApprove: (id: string) => void;
  onRevision: (id: string, note: string) => void;
  onLightbox: (url: string) => void;
  onHistory: (item: Item) => void;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  const submitRevision = () => {
    const n = note.trim();
    if (!n) return;
    onRevision(item.id, n);
    setNote("");
  };

  return (
    <div className="fc-card">
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
      </div>

      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="fc-card-thumb"
          src={item.image_url}
          alt={item.label}
          onClick={() => onLightbox(item.image_url!)}
        />
      ) : (
        <div className="fc-card-noimg">
          <ImageIcon size={14} />
          <span>{item.image_direction || "No image yet"}</span>
        </div>
      )}

      <p className={`fc-card-copy ${open ? "fc-card-copy-open" : ""}`}>{item.copy_text}</p>
      {(item.copy_text?.length ?? 0) > 160 && (
        <button className="fc-readmore" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Read more"}
        </button>
      )}

      {item.revision_note && item.stage === "revision" && (
        <div className="fc-revision-note">
          <RotateCcw size={11} /> {item.revision_note}
        </div>
      )}

      <div className="fc-card-actions">
        {item.stage !== "completed" && (
          <button className="fc-act-approve" onClick={() => onApprove(item.id)}>
            <Check size={13} /> Approve
          </button>
        )}
      </div>

      <div className="fc-revise-row">
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
        <button className="fc-revise-send" onClick={submitRevision} disabled={!note.trim()}>
          Send
        </button>
      </div>
    </div>
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
  onLightbox: (url: string) => void;
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
              <button key={it.id} className="fc-file" onClick={() => onLightbox(it.image_url!)}>
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
