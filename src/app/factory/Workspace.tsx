"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight, ChevronDown, Plus, Trash2, MessageSquare, CheckSquare,
  Image as ImageIcon, Video, Mail, FileText, Film, StickyNote, Loader2,
} from "lucide-react";
import { WProject, WItem, WGroup, AssetKind, KIND_META, KIND_ORDER, statusDone } from "./types";
import DocEditor from "./DocEditor";

const KIND_ICON: Record<string, ReactNode> = {
  image: <ImageIcon size={14} />, video: <Video size={14} />, mail: <Mail size={14} />,
  page: <FileText size={14} />, film: <Film size={14} />, doc: <StickyNote size={14} />,
};

const POLL_MS = 6000;

// Card preview: render either HTML or markdown bodies as clean plain text.
function toPlain(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/[#*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function api(method: string, payload?: Record<string, unknown>, qs?: string) {
  const res = await fetch(`/api/factory${qs || ""}`, {
    method,
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `${method} failed (${res.status})`);
  }
  return res.json();
}

export default function Workspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<WProject | null>(null);
  const [editing, setEditing] = useState<WItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addingGroup, setAddingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupKind, setGroupKind] = useState<AssetKind>("email");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const j = await api("GET", undefined, `?projectId=${projectId}`);
      setProject((j.projects && j.projects[0]) || null);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [projectId]);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Keep the open editor's data fresh after saves.
  useEffect(() => {
    if (!editing || !project) return;
    const fresh = project.items.find((i) => i.id === editing.id);
    if (fresh && fresh !== editing) setEditing(fresh);
  }, [project, editing]);

  const groups = useMemo(() => (project?.groups || []).slice().sort((a, b) => a.sort_order - b.sort_order), [project]);
  const itemsByGroup = useMemo(() => {
    const m = new Map<string, WItem[]>();
    for (const it of project?.items || []) {
      const k = it.group_id || "__ungrouped__";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(it);
    }
    return m;
  }, [project]);

  const createGroup = async () => {
    if (!groupName.trim()) return;
    setBusy(true);
    try {
      await api("POST", { action: "createGroup", projectId, name: groupName.trim(), kind: groupKind });
      setGroupName(""); setAddingGroup(false);
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "create failed"); } finally { setBusy(false); }
  };

  const addAsset = async (g: WGroup) => {
    setBusy(true);
    try {
      const n = (itemsByGroup.get(g.id)?.length || 0) + 1;
      await api("POST", { action: "createItem", projectId, groupId: g.id, kind: g.kind, label: `${KIND_META[g.kind].label} ${n}` });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "create failed"); } finally { setBusy(false); }
  };

  const toggleCollapse = async (g: WGroup) => {
    setProject((p) => p ? { ...p, groups: (p.groups || []).map((x) => x.id === g.id ? { ...x, collapsed: !x.collapsed } : x) } : p);
    await api("PATCH", { groupId: g.id, collapsed: !g.collapsed });
  };

  const deleteGroup = async (g: WGroup) => {
    if (!confirm(`Delete the "${g.name}" group? Its assets are kept (moved to Ungrouped).`)) return;
    await api("DELETE", undefined, `?type=group&id=${g.id}`);
    await load();
  };

  if (!project) return <div className="fc-empty">{err ? `Error: ${err}` : "Loading workspace…"}</div>;

  const ungrouped = itemsByGroup.get("__ungrouped__") || [];

  return (
    <div className="fcw">
      {err && <div className="fcw-err">{err}</div>}

      <div className="fcw-toolbar">
        {!addingGroup ? (
          <button className="fcw-addgroup" onClick={() => setAddingGroup(true)}><Plus size={14} /> Add group</button>
        ) : (
          <div className="fcw-addgroup-form">
            <input autoFocus className="fcw-addgroup-name" placeholder="Group name (e.g. Pre-Call Emails)" value={groupName}
              onChange={(e) => setGroupName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createGroup(); if (e.key === "Escape") setAddingGroup(false); }} />
            <select className="fcw-status-select" value={groupKind} onChange={(e) => setGroupKind(e.target.value as AssetKind)}>
              {KIND_ORDER.map((k) => <option key={k} value={k}>{KIND_META[k].label}</option>)}
            </select>
            <button className="fcw-addbtn" onClick={createGroup} disabled={busy || !groupName.trim()}>Create</button>
            <button className="fcw-cancel" onClick={() => setAddingGroup(false)}>Cancel</button>
          </div>
        )}
        {busy && <Loader2 size={14} className="fcw-spin fcw-toolbar-busy" />}
      </div>

      {groups.map((g) => {
        const items = (itemsByGroup.get(g.id) || []).slice().sort((a, b) => a.sort_order - b.sort_order);
        const done = items.filter(statusDone).length;
        return (
          <section className="fcw-group" key={g.id}>
            <header className="fcw-group-head">
              <button className="fcw-group-toggle" onClick={() => toggleCollapse(g)}>
                {g.collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                <span className="fcw-group-icon">{KIND_ICON[KIND_META[g.kind].icon]}</span>
                <span className="fcw-group-name">{g.name}</span>
              </button>
              <span className="fcw-progress-pill">{done}/{items.length} done</span>
              <div className="fcw-group-bar"><span style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} /></div>
              <div className="fcw-group-spacer" />
              <button className="fcw-group-add" onClick={() => addAsset(g)}><Plus size={13} /> {KIND_META[g.kind].label}</button>
              <button className="fcw-icon-btn fcw-danger" title="Delete group" onClick={() => deleteGroup(g)}><Trash2 size={14} /></button>
            </header>
            {!g.collapsed && (
              <div className="fcw-cards">
                {items.length === 0 && <div className="fcw-group-empty">No assets yet — add one.</div>}
                {items.map((it) => <AssetCard key={it.id} item={it} onOpen={() => setEditing(it)} />)}
              </div>
            )}
          </section>
        );
      })}

      {ungrouped.length > 0 && (
        <section className="fcw-group">
          <header className="fcw-group-head"><span className="fcw-group-name fcw-ungrouped">Ungrouped</span><span className="fcw-progress-pill">{ungrouped.length}</span></header>
          <div className="fcw-cards">
            {ungrouped.map((it) => <AssetCard key={it.id} item={it} onOpen={() => setEditing(it)} />)}
          </div>
        </section>
      )}

      {editing && <DocEditor item={editing} onClose={() => setEditing(null)} onChanged={load} />}
    </div>
  );
}

function AssetCard({ item, onOpen }: { item: WItem; onOpen: () => void }) {
  const meta = KIND_META[item.kind];
  const commentCount = (item.comments || []).filter((c) => !c.resolved).length;
  const steps = item.checklist || [];
  const stepsDone = steps.filter((s) => s.done).length;
  const statusLabel = (item.kind === "image_ad" ? item.stage : item.status) || meta.statuses[0];
  const preview = toPlain(item.body_md || item.copy_text || "");

  return (
    <button className={`fcw-card ${statusDone(item) ? "fcw-card-done" : ""}`} onClick={onOpen}>
      <div className="fcw-card-top">
        <span className="fcw-card-kind">{KIND_ICON[meta.icon]}</span>
        <span className="fcw-card-label">{item.label}</span>
        <span className={`fcw-card-status fcw-st-${statusLabel}`}>{String(statusLabel).replace(/_/g, " ")}</span>
      </div>
      {item.kind === "image_ad" && item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="fcw-card-thumb" src={item.image_url} alt={item.label} />
      ) : preview ? (
        <p className="fcw-card-preview">{preview.slice(0, 150)}</p>
      ) : (
        <p className="fcw-card-empty">Empty — click to write or draft with Claude</p>
      )}
      <div className="fcw-card-foot">
        {commentCount > 0 && <span className="fcw-chip"><MessageSquare size={11} /> {commentCount}</span>}
        {steps.length > 0 && <span className="fcw-chip"><CheckSquare size={11} /> {stepsDone}/{steps.length}</span>}
      </div>
    </button>
  );
}
