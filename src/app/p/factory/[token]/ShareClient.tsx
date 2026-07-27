"use client";

// Public reviewer view for ONE Factory project.
//
// This is the CLIENT layer. Marking an ad good or asking for a change records
// the reviewer's verdict only — it never approves anything in the Factory and
// never moves an item's stage. Alex sees the verdict and still decides. The
// reviewer likewise never sees Alex's internal approvals, only his own marks.

import { useCallback, useEffect, useMemo, useState } from "react";

// Deliberately no `stage` / `revision_note`: this page shows the reviewer's OWN
// verdict only. Alex's approvals are internal and must not leak here.
type Item = {
  id: string;
  label: string;
  copy_text: string | null;
  image_url: string | null;
  client_verdict: "approved" | "change" | null;
  client_note: string | null;
};

export default function ShareClient({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [canComment, setCanComment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dead, setDead] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [flash, setFlash] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/factory/${token}`, { cache: "no-store" });
      if (!res.ok) {
        setDead(true);
        return;
      }
      const j = await res.json();
      setName(j.project?.name ?? "");
      setItems(j.items ?? []);
      setCanComment(!!j.canComment);
    } catch {
      setDead(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const current = open !== null ? items[open] : null;

  useEffect(() => {
    setNote("");
  }, [open]);

  const say = useCallback((m: string) => {
    setFlash(m);
    window.setTimeout(() => setFlash(""), 1600);
  }, []);

  // One action, same as the internal review flow: an empty box approves the ad
  // as-is, text sends it back as a note. Either way we advance.
  const act = useCallback(async () => {
    if (!current) return;
    const text = note.trim();
    const approving = !text;
    try {
      const res = await fetch(`/api/public/factory/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          approving ? { itemId: current.id, approve: true } : { itemId: current.id, note: text }
        ),
      });
      if (!res.ok) throw new Error();
      const id = current.id;
      setItems((list) =>
        list.map((it) =>
          it.id === id
            ? {
                ...it,
                client_verdict: approving ? "approved" : "change",
                client_note: approving ? null : text,
              }
            : it
        )
      );
      setNote("");
      say(approving ? "Marked good" : "Sent to Alex");
      setOpen((i) => (i !== null && i < items.length - 1 ? i + 1 : i));
    } catch {
      say("Could not save");
    }
  }, [current, note, token, items.length, say]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") setOpen((i) => (i !== null && i < items.length - 1 ? i + 1 : i));
      else if (e.key === "ArrowLeft") setOpen((i) => (i !== null && i > 0 ? i - 1 : i));
      else if (e.key === "Enter" && canComment) {
        e.preventDefault();
        void act();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items.length, act, canComment]);

  const noted = useMemo(() => items.filter((i) => i.client_verdict === "change").length, [items]);
  const approved = useMemo(() => items.filter((i) => i.client_verdict === "approved").length, [items]);

  if (loading) return <div className="pf-msg">Loading…</div>;
  if (dead)
    return (
      <div className="pf-msg">
        <h1>Link not available</h1>
        <p>This share link is no longer active.</p>
      </div>
    );

  return (
    <div className="pf-wrap">
      <header className="pf-head">
        <div>
          <h1 className="pf-title">{name}</h1>
          <p className="pf-sub">
            {items.length} ad{items.length === 1 ? "" : "s"}
            {canComment ? " · click one, then Enter if it looks good, or type a change" : " · view only"}
            {approved ? ` · ${approved} marked good` : ""}
            {noted ? ` · ${noted} with changes` : ""}
          </p>
        </div>
      </header>

      <div className="pf-grid">
        {items.map((it, i) => (
          <button key={it.id} className="pf-card" onClick={() => setOpen(i)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.image_url ?? ""} alt={it.label} loading="lazy" />
            <span className="pf-card-label">{it.label}</span>
            {it.client_verdict === "change" ? (
              <span className="pf-card-flag">change</span>
            ) : it.client_verdict === "approved" ? (
              <span className="pf-card-ok">good</span>
            ) : null}
          </button>
        ))}
      </div>

      {current && (
        <div className="pf-lb" onClick={() => setOpen(null)}>
          <button className="pf-close" onClick={() => setOpen(null)} aria-label="Close">
            ✕
          </button>
          {open !== null && open > 0 && (
            <button
              className="pf-nav pf-prev"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((i) => (i !== null && i > 0 ? i - 1 : i));
              }}
              aria-label="Previous"
            >
              ‹
            </button>
          )}

          <div className="pf-stage" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pf-lb-img" src={current.image_url ?? ""} alt={current.label} />
            <div className="pf-tools">
              <div className="pf-meta">
                <span className="pf-label">{current.label}</span>
                <span className="pf-pos">
                  {(open ?? 0) + 1} / {items.length}
                </span>
              </div>
              {canComment ? (
                <>
                  <div className="pf-row">
                    <input
                      className="pf-input"
                      value={note}
                      autoFocus
                      placeholder="Looks good? Just hit Enter. Or type what should change."
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <button
                      className={note.trim() ? "pf-send" : "pf-approve"}
                      onClick={act}
                      title={note.trim() ? "Send this change request" : "Mark this ad as good"}
                    >
                      {note.trim() ? "Send" : "Looks good"}
                    </button>
                  </div>
                  {current.client_verdict === "change" && current.client_note ? (
                    <p className="pf-sent">You asked for: {current.client_note}</p>
                  ) : current.client_verdict === "approved" ? (
                    <p className="pf-okline">You marked this good</p>
                  ) : null}
                </>
              ) : null}
            </div>
          </div>

          {open !== null && open < items.length - 1 && (
            <button
              className="pf-nav pf-next"
              onClick={(e) => {
                e.stopPropagation();
                setOpen((i) => (i !== null && i < items.length - 1 ? i + 1 : i));
              }}
              aria-label="Next"
            >
              ›
            </button>
          )}
        </div>
      )}

      {flash && <div className="pf-flash">{flash}</div>}
    </div>
  );
}
