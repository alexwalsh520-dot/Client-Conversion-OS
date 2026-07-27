"use client";

// Public reviewer view for ONE Factory project. Grid of the ads, click to open
// full size, arrow keys to move, and (if the link allows it) a note box that
// sends feedback straight back into the Factory.

import { useCallback, useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  label: string;
  copy_text: string | null;
  image_url: string | null;
  stage: string;
  revision_note: string | null;
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
  const [sent, setSent] = useState<Record<string, string>>({});

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

  const send = useCallback(async () => {
    if (!current) return;
    const text = note.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/public/factory/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: current.id, note: text }),
      });
      if (!res.ok) throw new Error();
      setSent((s) => ({ ...s, [current.id]: text }));
      setNote("");
      say("Sent to Alex");
      setOpen((i) => (i !== null && i < items.length - 1 ? i + 1 : i));
    } catch {
      say("Could not send");
    }
  }, [current, note, token, items.length, say]);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
      else if (e.key === "ArrowRight") setOpen((i) => (i !== null && i < items.length - 1 ? i + 1 : i));
      else if (e.key === "ArrowLeft") setOpen((i) => (i !== null && i > 0 ? i - 1 : i));
      else if (e.key === "Enter" && note.trim()) {
        e.preventDefault();
        void send();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items.length, note, send]);

  const noted = useMemo(
    () => items.filter((i) => sent[i.id] || (i.stage === "revision" && i.revision_note)).length,
    [items, sent]
  );

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
            {canComment ? " · click any ad to leave a note" : " · view only"}
            {noted ? ` · ${noted} with notes` : ""}
          </p>
        </div>
      </header>

      <div className="pf-grid">
        {items.map((it, i) => (
          <button key={it.id} className="pf-card" onClick={() => setOpen(i)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.image_url ?? ""} alt={it.label} loading="lazy" />
            <span className="pf-card-label">{it.label}</span>
            {(sent[it.id] || (it.stage === "revision" && it.revision_note)) && (
              <span className="pf-card-flag">note</span>
            )}
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
                      placeholder="What should change? Press Enter to send."
                      onChange={(e) => setNote(e.target.value)}
                    />
                    <button className="pf-send" onClick={send} disabled={!note.trim()}>
                      Send
                    </button>
                  </div>
                  {sent[current.id] && <p className="pf-sent">Your note: {sent[current.id]}</p>}
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
