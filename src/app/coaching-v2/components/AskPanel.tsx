"use client";

import { useEffect, useRef, useState } from "react";

type Turn = { role: "user" | "assistant"; content: string };

/** Ask Ahmad, the coaching brain. Same endpoint the Coaching tab uses. */
export default function AskPanel({ open, about, onClose }: { open: boolean; about: string | null; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50); }, [open]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [turns, busy]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...turns, { role: "user" as const, content: question }];
    setTurns(next); setQ(""); setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/mas/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history: turns.slice(-8) }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Ahmad's brain did not answer.");
      const answer: string = j.answer ?? j.reply ?? j.text ?? j.content ?? (typeof j === "string" ? j : JSON.stringify(j));
      setTurns([...next, { role: "assistant", content: answer }]);
    } catch (e) { setErr(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(false); }
  }

  return (
    <aside className={`h2-askp ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="hd">
        Ask Ahmad
        {about && <span className="h2-pill">{about}</span>}
        <button className="h2-btn s" style={{ marginLeft: "auto", border: "none", color: "var(--text-muted)" }} onClick={onClose}>Close</button>
      </div>
      <div className="msgs">
        {!turns.length && (
          <p className="h2-quiet" style={{ margin: 0 }}>
            Ask about a client or a situation. Ahmad&apos;s brain answers from the SOPs and the client record, and flags anything it is unsure about for Ahmad.
            {about ? <> This one starts with <b>{about}</b>, so name them in your question.</> : null}
          </p>
        )}
        {turns.map((t, i) => <div key={i} className={`msg ${t.role === "user" ? "me" : "ai"}`}>{t.content}</div>)}
        {busy && <div className="msg ai h2-m">Thinking…</div>}
        {err && <div className="msg ai h2-r">{err}</div>}
        <div ref={bottom} />
      </div>
      <form className="in" onSubmit={(e) => { e.preventDefault(); void send(q); }}>
        <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={about ? `Ask about ${about}` : "Ask about a client or a situation"} disabled={busy} />
      </form>
    </aside>
  );
}
