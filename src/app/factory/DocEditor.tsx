"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Sparkles, Check, MessageSquarePlus, History, Trash2, Save, Loader2, Link as LinkIcon } from "lucide-react";
import { WItem, WComment, WChecklistStep, KIND_META, rid } from "./types";

async function patch(payload: Record<string, unknown>) {
  const res = await fetch("/api/factory", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Save failed (${res.status})`);
  }
  return res.json();
}

export default function DocEditor({
  item,
  onClose,
  onChanged,
}: {
  item: WItem;
  onClose: () => void;
  onChanged: () => void;
}) {
  const meta = KIND_META[item.kind];
  const [label, setLabel] = useState(item.label);
  const [body, setBody] = useState(item.body_md || item.copy_text || "");
  const [status, setStatus] = useState(item.status || meta.statuses[0]);
  const [assetUrl, setAssetUrl] = useState(item.asset_url || "");
  const [comments, setComments] = useState<WComment[]>(item.comments || []);
  const [checklist, setChecklist] = useState<WChecklistStep[]>(item.checklist || []);
  const [newComment, setNewComment] = useState("");
  const [newStep, setNewStep] = useState("");
  const [instruction, setInstruction] = useState("");
  const [assisting, setAssisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced autosave of the body.
  const autosaveBody = useCallback((next: string) => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        setSaving(true);
        await patch({ id: item.id, bodyMd: next });
        setSavedAt(new Date().toLocaleTimeString());
        onChanged();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "save failed");
      } finally {
        setSaving(false);
      }
    }, 800);
  }, [item.id, onChanged]);

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const saveField = async (payload: Record<string, unknown>) => {
    try {
      await patch({ id: item.id, ...payload });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    }
  };

  const saveVersion = async () => {
    try {
      setSaving(true);
      await patch({ id: item.id, bodyMd: body, snapshot: true, snapshotNote: "Manual save" });
      setSavedAt(new Date().toLocaleTimeString());
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const addComment = async () => {
    const t = newComment.trim();
    if (!t) return;
    const next = [...comments, { id: rid(), author: "alex" as const, text: t, created_at: new Date().toISOString() }];
    setComments(next);
    setNewComment("");
    await saveField({ comments: next });
  };
  const toggleComment = async (id: string) => {
    const next = comments.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c));
    setComments(next);
    await saveField({ comments: next });
  };

  const addStep = async () => {
    const t = newStep.trim();
    if (!t) return;
    const next = [...checklist, { id: rid(), text: t, done: false }];
    setChecklist(next);
    setNewStep("");
    await saveField({ checklist: next });
  };
  const toggleStep = async (id: string) => {
    const next = checklist.map((s) => (s.id === id ? { ...s, done: !s.done } : s));
    setChecklist(next);
    await saveField({ checklist: next });
  };

  const runAssist = async () => {
    try {
      setAssisting(true);
      setErr(null);
      const res = await fetch("/api/factory/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, instruction: instruction.trim() || "Improve this draft using the avatar and apply any comments." }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "assist failed");
      setBody(j.draft);
      await patch({ id: item.id, bodyMd: j.draft, snapshot: true, snapshotNote: "Claude draft" });
      setSavedAt(new Date().toLocaleTimeString());
      setInstruction("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "assist failed");
    } finally {
      setAssisting(false);
    }
  };

  const del = async () => {
    if (!confirm(`Delete "${item.label}"? This can't be undone.`)) return;
    await fetch(`/api/factory?type=item&id=${item.id}`, { method: "DELETE" });
    onChanged();
    onClose();
  };

  const versions = (item.versions || []).filter((v) => v.body_md).sort((a, b) => b.version - a.version);

  return (
    <div className="fcw-drawer-overlay" onClick={onClose}>
      <div className="fcw-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="fcw-drawer-head">
          <input
            className="fcw-drawer-title"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() && label !== item.label && saveField({ label: label.trim() })}
          />
          <span className="fcw-kind-pill">{meta.label}</span>
          <select
            className="fcw-status-select"
            value={status}
            onChange={(e) => { setStatus(e.target.value); saveField(item.kind === "image_ad" ? { stage: e.target.value } : { status: e.target.value }); }}
          >
            {meta.statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
          <div className="fcw-drawer-spacer" />
          <span className="fcw-saved">{saving ? <><Loader2 size={12} className="fcw-spin" /> saving</> : savedAt ? `saved ${savedAt}` : ""}</span>
          <button className="fcw-icon-btn" title="Save version" onClick={saveVersion}><Save size={16} /></button>
          {versions.length > 0 && <button className="fcw-icon-btn" title="Version history" onClick={() => setShowHistory((v) => !v)}><History size={16} /></button>}
          <button className="fcw-icon-btn fcw-danger" title="Delete asset" onClick={del}><Trash2 size={16} /></button>
          <button className="fcw-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {err && <div className="fcw-err">{err}</div>}

        <div className="fcw-drawer-body">
          {/* Editor column */}
          <div className="fcw-editor-col">
            {item.kind !== "image_ad" && (meta.icon === "video" || meta.icon === "film") && (
              <div className="fcw-asseturl">
                <LinkIcon size={13} />
                <input
                  className="fcw-asseturl-input"
                  placeholder="Final video / file link (R2, Drive, etc.)"
                  value={assetUrl}
                  onChange={(e) => setAssetUrl(e.target.value)}
                  onBlur={() => assetUrl !== (item.asset_url || "") && saveField({ assetUrl })}
                />
              </div>
            )}
            <textarea
              className="fcw-editor"
              value={body}
              placeholder={`Write the ${meta.label.toLowerCase()} here… (or hit Claude below to draft it from the avatar)`}
              onChange={(e) => { setBody(e.target.value); autosaveBody(e.target.value); }}
            />
            {/* Claude assist bar */}
            <div className="fcw-assist">
              <Sparkles size={15} className="fcw-assist-icon" />
              <input
                className="fcw-assist-input"
                placeholder="Tell Claude what to do (draft from the avatar, apply my comments, make it harder-hitting…)"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") runAssist(); }}
              />
              <button className="fcw-assist-btn" onClick={runAssist} disabled={assisting}>
                {assisting ? <><Loader2 size={14} className="fcw-spin" /> drafting…</> : <>Claude</>}
              </button>
            </div>
          </div>

          {/* Side column: comments + checklist */}
          <div className="fcw-side-col">
            {showHistory ? (
              <div className="fcw-side-block">
                <div className="fcw-side-title"><History size={13} /> Versions</div>
                {versions.length === 0 ? <div className="fcw-muted">No saved versions yet.</div> : versions.map((v) => (
                  <div key={v.version} className="fcw-version">
                    <div className="fcw-version-meta">
                      <span>v{v.version}{v.revision_note ? ` · ${v.revision_note}` : ""}</span>
                      <button className="fcw-restore" onClick={() => { setBody(v.body_md || ""); autosaveBody(v.body_md || ""); setShowHistory(false); }}>Restore</button>
                    </div>
                    <div className="fcw-version-preview">{(v.body_md || "").slice(0, 160)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="fcw-side-block">
                  <div className="fcw-side-title"><MessageSquarePlus size={13} /> Notes & comments</div>
                  <div className="fcw-comments">
                    {comments.length === 0 && <div className="fcw-muted">Leave a note for Claude, or for yourself.</div>}
                    {comments.map((c) => (
                      <div key={c.id} className={`fcw-comment ${c.resolved ? "fcw-resolved" : ""} fcw-by-${c.author}`}>
                        <div className="fcw-comment-head">
                          <span className="fcw-comment-author">{c.author === "claude" ? "Claude" : "Alex"}</span>
                          <button className="fcw-comment-resolve" onClick={() => toggleComment(c.id)} title={c.resolved ? "Reopen" : "Resolve"}><Check size={11} /></button>
                        </div>
                        <div className="fcw-comment-text">{c.text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="fcw-addrow">
                    <textarea className="fcw-addinput" rows={2} placeholder="Add a note…" value={newComment} onChange={(e) => setNewComment(e.target.value)} />
                    <button className="fcw-addbtn" onClick={addComment} disabled={!newComment.trim()}>Add</button>
                  </div>
                </div>

                <div className="fcw-side-block">
                  <div className="fcw-side-title"><Check size={13} /> Steps</div>
                  <div className="fcw-checklist">
                    {checklist.length === 0 && <div className="fcw-muted">Tiny steps live here — they don&apos;t clutter the board.</div>}
                    {checklist.map((s) => (
                      <label key={s.id} className={`fcw-step ${s.done ? "fcw-step-done" : ""}`}>
                        <input type="checkbox" checked={s.done} onChange={() => toggleStep(s.id)} />
                        <span>{s.text}</span>
                      </label>
                    ))}
                  </div>
                  <div className="fcw-addrow">
                    <input className="fcw-addinput" placeholder="Add a step…" value={newStep} onChange={(e) => setNewStep(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addStep(); }} />
                    <button className="fcw-addbtn" onClick={addStep} disabled={!newStep.trim()}>Add</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
