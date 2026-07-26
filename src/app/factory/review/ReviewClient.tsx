"use client";

// Fast keyboard review deck for Factory image ads.
//
// The whole point is speed: one ad on screen at full height, the comment box
// already focused so you can just start typing, and three keys to run the whole
// review.
//
//   Left / Right : previous / next ad
//   Enter        : comment box EMPTY -> approve and advance
//                  comment box HAS TEXT -> send as a revision note and advance
//   Esc          : clear the comment box
//
// Approve and revision both go through the existing PATCH /api/factory, which
// already maps { approve } -> stage=completed and { revisionNote } -> stage=revision.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Item = {
  id: string;
  label: string;
  stage: string;
  image_url: string | null;
  copy_text: string | null;
  revision_note: string | null;
  sort_order: number | null;
};

type Project = { id: string; name: string; client: string | null; items: Item[] };

type Saving = "idle" | "saving" | "error";

export default function ReviewClient() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [index, setIndex] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<Saving>("idle");
  const [flash, setFlash] = useState<string>("");
  const [hideDone, setHideDone] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- load ----------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/factory");
      const json = await res.json();
      const withImages: Project[] = (json.projects ?? []).map((p: Project) => ({
        ...p,
        items: (p.items ?? [])
          .filter((i) => i.image_url)
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
      }));
      setProjects(withImages);
      const firstWithWork =
        withImages.find((p) => p.items.some((i) => i.stage === "image_generated")) ?? withImages[0];
      if (firstWithWork) setProjectId(firstWithWork.id);
    })().catch(() => setSaving("error"));
  }, []);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  const items = useMemo(() => {
    const all = project?.items ?? [];
    return hideDone ? all.filter((i) => i.stage !== "completed") : all;
  }, [project, hideDone]);

  const current = items[index];

  // Keep the index in range when the list changes (e.g. toggling hideDone).
  useEffect(() => {
    if (index > items.length - 1) setIndex(Math.max(0, items.length - 1));
  }, [items.length, index]);

  // The comment box is the always-on input; refocus whenever the ad changes so
  // you can start typing immediately without ever reaching for the mouse.
  useEffect(() => {
    inputRef.current?.focus();
  }, [index, projectId]);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(""), 1400);
  }, []);

  const patch = useCallback(
    async (body: Record<string, unknown>, nextStage: string, msg: string) => {
      if (!current) return;
      setSaving("saving");
      // Optimistic: update local state so the deck never feels laggy.
      setProjects((prev) =>
        prev.map((p) =>
          p.id !== projectId
            ? p
            : {
                ...p,
                items: p.items.map((i) =>
                  i.id === current.id
                    ? { ...i, stage: nextStage, revision_note: (body.revisionNote as string) ?? i.revision_note }
                    : i
                ),
              }
        )
      );
      try {
        const res = await fetch("/api/factory", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: current.id, ...body }),
        });
        if (!res.ok) throw new Error(await res.text());
        setSaving("idle");
        showFlash(msg);
      } catch {
        setSaving("error");
        showFlash("SAVE FAILED");
      }
    },
    [current, projectId, showFlash]
  );

  const advance = useCallback(() => {
    setNote("");
    setIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
  }, [items.length]);

  const approve = useCallback(async () => {
    await patch({ approve: true }, "completed", "APPROVED");
    advance();
  }, [patch, advance]);

  const sendNote = useCallback(async () => {
    const text = note.trim();
    if (!text) return;
    await patch({ revisionNote: text }, "revision", "NOTE SENT");
    advance();
  }, [note, patch, advance]);

  // ---- keys ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setNote("");
        setIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setNote("");
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Enter is the single action key: send if there's text, else approve.
        e.preventDefault();
        if (note.trim()) void sendNote();
        else void approve();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setNote("");
      }
      // Shift+Enter falls through to the textarea for a literal newline.
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [note, items.length, approve, sendNote]);

  const counts = useMemo(() => {
    const all = project?.items ?? [];
    return {
      total: all.length,
      done: all.filter((i) => i.stage === "completed").length,
      rev: all.filter((i) => i.stage === "revision").length,
      pending: all.filter((i) => i.stage === "image_generated").length,
    };
  }, [project]);

  return (
    <div className="rv-root">
      <header className="rv-bar">
        <select
          className="rv-select"
          value={projectId}
          onChange={(e) => {
            setProjectId(e.target.value);
            setIndex(0);
            setNote("");
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="rv-counts">
          <span className="rv-ok">{counts.done} approved</span>
          <span className="rv-rev">{counts.rev} revision</span>
          <span className="rv-pend">{counts.pending} pending</span>
        </div>

        <label className="rv-toggle">
          <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
          hide approved
        </label>

        <div className="rv-pos">
          {items.length ? index + 1 : 0} / {items.length}
        </div>
      </header>

      <main className="rv-stage">
        <button
          className="rv-nav rv-prev"
          onClick={() => {
            setNote("");
            setIndex((i) => Math.max(0, i - 1));
          }}
          aria-label="Previous"
        >
          ‹
        </button>

        {current ? (
          <figure className="rv-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="rv-img" src={current.image_url ?? ""} alt={current.label} />
            <figcaption className="rv-cap">
              <span className="rv-label">{current.label}</span>
              <span className={`rv-stage-tag rv-${current.stage}`}>{current.stage.replace("_", " ")}</span>
              {current.revision_note ? <span className="rv-oldnote">note: {current.revision_note}</span> : null}
            </figcaption>
          </figure>
        ) : (
          <div className="rv-empty">Nothing to review here.</div>
        )}

        <button
          className="rv-nav rv-next"
          onClick={() => {
            setNote("");
            setIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
          }}
          aria-label="Next"
        >
          ›
        </button>

        {flash ? <div className="rv-flash">{flash}</div> : null}
      </main>

      <footer className="rv-foot">
        <textarea
          ref={inputRef}
          className="rv-input"
          value={note}
          placeholder="Type a note and hit Enter to send it back for revision. Empty + Enter approves."
          onChange={(e) => setNote(e.target.value)}
          rows={1}
          autoFocus
        />
        <button className={`rv-act ${note.trim() ? "rv-act-send" : "rv-act-ok"}`} onClick={() => (note.trim() ? sendNote() : approve())}>
          {note.trim() ? "Send note ⏎" : "Approve ⏎"}
        </button>
        <span className={`rv-save rv-save-${saving}`}>
          {saving === "saving" ? "saving…" : saving === "error" ? "error" : "←/→ move · ⏎ act · esc clear"}
        </span>
      </footer>
    </div>
  );
}
