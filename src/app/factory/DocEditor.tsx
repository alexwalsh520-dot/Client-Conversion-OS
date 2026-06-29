"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Sparkles, Check, History, Trash2, Loader2, Link as LinkIcon, Bold, Italic, List, Heading2, MessageSquarePlus } from "lucide-react";
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

// One-time conversion so older markdown drafts open as real formatted text. Going
// forward the editor stores HTML directly (what you see is what's saved).
function toHtml(body: string): string {
  if (!body) return "";
  if (/<(p|div|h\d|ul|ol|li|strong|em|span|br)\b/i.test(body)) return body; // already html
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = body.split("\n");
  const out: string[] = [];
  let inList = false;
  for (const ln of lines) {
    const h = ln.match(/^(#{1,3})\s+(.*)$/);
    const li = ln.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(esc(li[1]))}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (h) { out.push(`<h${h[1].length}>${inline(esc(h[2]))}</h${h[1].length}>`); continue; }
    if (ln.trim() === "") { out.push("<p><br></p>"); continue; }
    out.push(`<p>${inline(esc(ln))}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("");
  function inline(s: string) {
    return s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
  }
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
  const [status, setStatus] = useState(item.status || item.stage || meta.statuses[0]);
  const [statusOpen, setStatusOpen] = useState(false);
  const [assetUrl, setAssetUrl] = useState(item.asset_url || "");
  const [comments, setComments] = useState<WComment[]>(item.comments || []);
  const [checklist, setChecklist] = useState<WChecklistStep[]>(item.checklist || []);
  const [newStep, setNewStep] = useState("");
  const [instruction, setInstruction] = useState("");
  const [assisting, setAssisting] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const [showHistory, setShowHistory] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [draftCid, setDraftCid] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [addBtn, setAddBtn] = useState<{ top: number; left: number } | null>(null);

  const edRef = useRef<HTMLDivElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inited = useRef<string>("");

  // Initialize the editable surface once per asset (never on every render — that
  // would fight the contentEditable DOM and wipe the cursor).
  useEffect(() => {
    if (inited.current === item.id) return;
    inited.current = item.id;
    if (edRef.current) edRef.current.innerHTML = toHtml(item.body_md || item.copy_text || "");
    setComments(item.comments || []);
    setChecklist(item.checklist || []);
    setLabel(item.label);
    setStatus(item.status || item.stage || meta.statuses[0]);
  }, [item.id, item.body_md, item.copy_text, item.comments, item.checklist, item.label, item.status, item.stage, meta.statuses]);

  useEffect(() => () => { if (debounce.current) clearTimeout(debounce.current); }, []);

  const currentHtml = () => edRef.current?.innerHTML || "";

  const autosave = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setSaved("saving");
    debounce.current = setTimeout(async () => {
      try {
        await patch({ id: item.id, bodyMd: currentHtml() });
        setSaved("saved");
        onChanged();
      } catch (e) { setErr(e instanceof Error ? e.message : "save failed"); setSaved("idle"); }
    }, 700);
  }, [item.id, onChanged]);

  // Snapshot a version when you pause editing (blur) — gives a clean Google-Docs
  // style history without spamming a version on every keystroke.
  const snapshot = useCallback(async () => {
    try { await patch({ id: item.id, bodyMd: currentHtml(), snapshot: true, snapshotNote: "edit" }); onChanged(); } catch { /* non-fatal */ }
  }, [item.id, onChanged]);

  const saveField = async (payload: Record<string, unknown>) => {
    try { await patch({ id: item.id, ...payload }); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : "save failed"); }
  };

  const fmt = (cmd: string, val?: string) => {
    edRef.current?.focus();
    document.execCommand(cmd, false, val);
    autosave();
  };

  // ---- selection -> floating "comment" button ----
  const onSelect = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !edRef.current || !edRef.current.contains(sel.anchorNode)) { setAddBtn(null); return; }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const host = edRef.current.getBoundingClientRect();
    if (rect.width < 1) { setAddBtn(null); return; }
    setAddBtn({ top: rect.top - host.top + (edRef.current.scrollTop || 0) - 30, left: rect.left - host.left });
  };

  const addCommentOnSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const cid = rid();
    let quote = sel.toString().slice(0, 200);
    const range = sel.getRangeAt(0);
    const span = document.createElement("span");
    span.className = "fcw-hl";
    span.setAttribute("data-cid", cid);
    let wrapped = false;
    try { range.surroundContents(span); wrapped = true; } catch { document.execCommand("hiliteColor", false, "#3a3320"); }
    if (wrapped) quote = (span.textContent || quote).slice(0, 200); // store exactly what got highlighted
    sel.removeAllRanges();
    setAddBtn(null);
    const next = [...comments, { id: cid, author: "alex" as const, text: "", created_at: new Date().toISOString(), quote } as WComment & { quote: string }];
    setComments(next);
    setDraftCid(cid);
    setDraftText("");
    saveField({ comments: next, bodyMd: currentHtml() });
  };

  const saveComment = (cid: string, text: string) => {
    const next = comments.map((c) => (c.id === cid ? { ...c, text } : c));
    setComments(next);
    setDraftCid(null);
    saveField({ comments: next });
  };
  const removeComment = (cid: string) => {
    const next = comments.filter((c) => c.id !== cid);
    setComments(next);
    const el = edRef.current?.querySelector(`[data-cid="${cid}"]`);
    if (el) { const t = document.createTextNode(el.textContent || ""); el.replaceWith(t); }
    saveField({ comments: next, bodyMd: currentHtml() });
  };

  // Align each comment card to the vertical position of its highlight.
  useLayoutEffect(() => {
    const ed = edRef.current; if (!ed) return;
    const next: Record<string, number> = {};
    for (const c of comments) {
      const el = ed.querySelector(`[data-cid="${c.id}"]`) as HTMLElement | null;
      if (el) next[c.id] = el.offsetTop;
    }
    setTops(next);
  }, [comments, showHistory]);

  const addStep = async () => {
    const t = newStep.trim(); if (!t) return;
    const next = [...checklist, { id: rid(), text: t, done: false }];
    setChecklist(next); setNewStep(""); await saveField({ checklist: next });
  };
  const toggleStep = async (id: string) => {
    const next = checklist.map((s) => (s.id === id ? { ...s, done: !s.done } : s));
    setChecklist(next); await saveField({ checklist: next });
  };

  const runAssist = async () => {
    try {
      setAssisting(true); setErr(null);
      const res = await fetch("/api/factory/assist", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, instruction: instruction.trim() || "Improve this draft using the avatar and apply any comments." }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "assist failed");
      if (edRef.current) edRef.current.innerHTML = toHtml(j.draft);
      await patch({ id: item.id, bodyMd: currentHtml(), snapshot: true, snapshotNote: "Claude draft" });
      setInstruction(""); onChanged();
    } catch (e) { setErr(e instanceof Error ? e.message : "assist failed"); }
    finally { setAssisting(false); }
  };

  const del = async () => {
    if (!confirm(`Delete "${item.label}"? This can't be undone.`)) return;
    await fetch(`/api/factory?type=item&id=${item.id}`, { method: "DELETE" });
    onChanged(); onClose();
  };

  const versions = (item.versions || []).filter((v) => v.body_md).sort((a, b) => b.version - a.version);
  const isVideo = meta.icon === "video" || meta.icon === "film";
  // Comments stack in document order (by where their highlight sits), so they sit
  // beside the text without ever overlapping the Steps block.
  const orderedComments = [...comments].sort((a, b) => (tops[a.id] ?? 1e9) - (tops[b.id] ?? 1e9));

  return (
    <div className="fcw-drawer-overlay" onClick={onClose}>
      <div className="fcw-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="fcw-drawer-head">
          <input className="fcw-drawer-title" value={label} onChange={(e) => setLabel(e.target.value)}
            onBlur={() => label.trim() && label !== item.label && saveField({ label: label.trim() })} />
          <span className="fcw-kind-pill">{meta.label}</span>

          {/* Custom status dropdown (not the raw OS select) */}
          <div className="fcw-dd">
            <button className="fcw-dd-btn" onClick={() => setStatusOpen((o) => !o)}>
              <span className={`fcw-dot fcw-dot-${status}`} />{status.replace(/_/g, " ")}
              <span className="fcw-dd-caret">▾</span>
            </button>
            {statusOpen && (
              <div className="fcw-dd-menu">
                {meta.statuses.map((s) => (
                  <button key={s} className={`fcw-dd-item ${s === status ? "on" : ""}`}
                    onClick={() => { setStatus(s); setStatusOpen(false); saveField(item.kind === "image_ad" ? { stage: s } : { status: s }); }}>
                    <span className={`fcw-dot fcw-dot-${s}`} />{s.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="fcw-drawer-spacer" />
          <span className="fcw-saved">{saved === "saving" ? <><Loader2 size={12} className="fcw-spin" /> saving</> : saved === "saved" ? "saved" : ""}</span>
          {versions.length > 0 && <button className="fcw-icon-btn" title="Version history" onClick={() => setShowHistory((v) => !v)}><History size={16} /></button>}
          <button className="fcw-icon-btn fcw-danger" title="Delete" onClick={del}><Trash2 size={16} /></button>
          <button className="fcw-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        {err && <div className="fcw-err">{err}</div>}

        <div className="fcw-drawer-body">
          {/* Editor */}
          <div className="fcw-editor-col">
            {isVideo && (
              <div className="fcw-asseturl">
                <LinkIcon size={13} />
                <input className="fcw-asseturl-input" placeholder="Final video / file link (R2, Drive, etc.)"
                  value={assetUrl} onChange={(e) => setAssetUrl(e.target.value)}
                  onBlur={() => assetUrl !== (item.asset_url || "") && saveField({ assetUrl })} />
              </div>
            )}
            {/* Formatting toolbar */}
            <div className="fcw-toolbar2">
              <button onMouseDown={(e) => { e.preventDefault(); fmt("bold"); }} title="Bold"><Bold size={14} /></button>
              <button onMouseDown={(e) => { e.preventDefault(); fmt("italic"); }} title="Italic"><Italic size={14} /></button>
              <button onMouseDown={(e) => { e.preventDefault(); fmt("formatBlock", "h2"); }} title="Heading"><Heading2 size={14} /></button>
              <button onMouseDown={(e) => { e.preventDefault(); fmt("insertUnorderedList"); }} title="Bullets"><List size={14} /></button>
              <span className="fcw-tb-hint">select any text to leave a comment</span>
            </div>

            <div className="fcw-doc-wrap">
              <div
                ref={edRef}
                className="fcw-doc"
                contentEditable
                suppressContentEditableWarning
                onInput={autosave}
                onBlur={snapshot}
                onMouseUp={onSelect}
                onKeyUp={onSelect}
              />
              {addBtn && (
                <button className="fcw-add-comment-float" style={{ top: addBtn.top, left: addBtn.left }} onMouseDown={(e) => { e.preventDefault(); addCommentOnSelection(); }}>
                  <MessageSquarePlus size={13} /> Comment
                </button>
              )}
            </div>

            {/* Claude assist */}
            <div className="fcw-assist">
              <Sparkles size={15} className="fcw-assist-icon" />
              <input className="fcw-assist-input" placeholder="Tell Claude what to do (draft from the avatar, apply my comments, tighten it…)"
                value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runAssist(); }} />
              <button className="fcw-assist-btn" onClick={runAssist} disabled={assisting}>
                {assisting ? <><Loader2 size={14} className="fcw-spin" /> drafting…</> : "Claude"}
              </button>
            </div>
          </div>

          {/* Right rail: margin comments (aligned to highlights) OR history */}
          <div className="fcw-side-col">
            {showHistory ? (
              <div className="fcw-side-block">
                <div className="fcw-side-title"><History size={13} /> Version history</div>
                {versions.length === 0 ? <div className="fcw-muted">No versions yet.</div> : versions.map((v) => (
                  <div key={v.version} className="fcw-version">
                    <div className="fcw-version-meta">
                      <span>v{v.version} · {new Date(v.created_at).toLocaleString()}</span>
                      <button className="fcw-restore" onClick={() => { if (edRef.current) edRef.current.innerHTML = toHtml(v.body_md || ""); autosave(); setShowHistory(false); }}>Restore</button>
                    </div>
                    <div className="fcw-version-preview" dangerouslySetInnerHTML={{ __html: toHtml(v.body_md || "").slice(0, 400) }} />
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="fcw-margin">
                  <div className="fcw-side-title"><MessageSquarePlus size={13} /> Comments</div>
                  {comments.length === 0 && (
                    <div className="fcw-muted">Highlight any text in the doc to leave a comment. It shows up here, in the order it appears in the doc.</div>
                  )}
                  {orderedComments.map((c) => (
                    <CommentCard key={c.id} c={c} onSave={saveComment} onRemove={removeComment} editing={draftCid === c.id} draftText={draftText} setDraftText={setDraftText} onEdit={() => { setDraftCid(c.id); setDraftText(c.text); }} />
                  ))}
                </div>

                <div className="fcw-side-block fcw-steps-block">
                  <div className="fcw-side-title"><Check size={13} /> Steps</div>
                  {checklist.map((s) => (
                    <label key={s.id} className={`fcw-step ${s.done ? "fcw-step-done" : ""}`}>
                      <input type="checkbox" checked={s.done} onChange={() => toggleStep(s.id)} /><span>{s.text}</span>
                    </label>
                  ))}
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

function CommentCard({ c, onSave, onRemove, editing, draftText, setDraftText, onEdit }: {
  c: WComment & { quote?: string }; onSave: (id: string, t: string) => void; onRemove: (id: string) => void;
  editing: boolean; draftText: string; setDraftText: (s: string) => void; onEdit: () => void;
}) {
  return (
    <div className={`fcw-comment fcw-by-${c.author}`}>
      {c.quote && <div className="fcw-comment-quote">“{c.quote}”</div>}
      {editing ? (
        <>
          <textarea autoFocus className="fcw-addinput" rows={2} placeholder="Your comment…" value={draftText} onChange={(e) => setDraftText(e.target.value)} />
          <div className="fcw-comment-actions">
            <button className="fcw-addbtn" onClick={() => onSave(c.id, draftText)}>Save</button>
            <button className="fcw-cancel" onClick={() => onRemove(c.id)}>Delete</button>
          </div>
        </>
      ) : (
        <>
          <div className="fcw-comment-head"><span className="fcw-comment-author">{c.author === "claude" ? "Claude" : "Alex"}</span>
            <button className="fcw-comment-resolve" onClick={onEdit} title="Edit">edit</button>
            <button className="fcw-comment-resolve" onClick={() => onRemove(c.id)} title="Delete">×</button>
          </div>
          <div className="fcw-comment-text">{c.text || <span className="fcw-muted">click edit to add your note</span>}</div>
        </>
      )}
    </div>
  );
}
