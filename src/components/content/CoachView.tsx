"use client";

import { useRef, useState } from "react";
import { Sparkles, Send, Loader2, Users } from "lucide-react";
import type { CreatorContent } from "@/lib/content-data";

const BUCKETS: { key: string; label: string; hint: string }[] = [
  { key: "avatar", label: "Who's showing up", hint: "the actual person in the DMs / on calls" },
  { key: "pain", label: "Pain points", hint: "what hurts, in their words" },
  { key: "objection", label: "Objections", hint: "what stops them buying" },
  { key: "desire", label: "Desires", hint: "what they actually want" },
  { key: "lead_quality", label: "Lead-quality signals", hint: "strong buyers vs tire-kickers" },
];

interface Msg { role: "user" | "assistant"; content: string }

// Minimal, safe markdown -> HTML so **bold**, *italics*, lists and headers render in the chat.
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
  const lines = String(md || "").split("\n");
  let html = ""; let list: string | null = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const ln of lines) {
    if (/^\s*$/.test(ln)) { close(); continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { close(); const l = h[1].length; html += `<h${l} style="margin:8px 0 4px;font-size:14px;font-weight:700">${inline(h[2])}</h${l}>`; continue; }
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ol) { if (list !== "ol") { close(); list = "ol"; html += '<ol style="margin:4px 0 4px 18px">'; } html += `<li>${inline(ol[1])}</li>`; continue; }
    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (list !== "ul") { close(); list = "ul"; html += '<ul style="margin:4px 0 4px 18px">'; } html += `<li>${inline(ul[1])}</li>`; continue; }
    close(); html += `<p style="margin:6px 0">${inline(ln)}</p>`;
  }
  close();
  return html;
}

export default function CoachView({ data, creator }: { data: CreatorContent; creator: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const byBucket = (k: string) => data.voc.filter((q) => q.bucket === k);
  const metrics = (data.audience?.metrics || null) as { strong_signals?: string[]; weak_signals?: string[] } | null;

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, content: text }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/content/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creator, messages: next }) });
      const j = await res.json();
      setMessages([...next, { role: "assistant", content: j.reply || j.error || "(no response)" }]);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : "failed"}` }]);
    } finally {
      setBusy(false);
      setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }), 50);
    }
  };

  const starters = [
    "Give me 3 reel ideas that would pull in more of the people who actually buy.",
    "What pain point are we under-using in content right now?",
    "Why are my leads low quality, and what content would fix that?",
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1fr)", gap: 22, alignItems: "start" }}>
      {/* LEFT: Voice of customer */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-muted)" }}>Voice of the customer</h3>

        {/* Audience read */}
        <div className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <Users size={15} style={{ color: "var(--accent)" }} />
            <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 14 }}>Who we&apos;re actually attracting</span>
          </div>
          {data.audience?.summary
            ? <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.55 }}>{data.audience.summary}</p>
            : <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13 }}>Building automatically as {data.name}&apos;s calls + DMs come in.</p>}
          {metrics && (metrics.strong_signals?.length || metrics.weak_signals?.length) ? (
            <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
              {!!metrics.strong_signals?.length && <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#37d67a", marginBottom: 4 }}>STRONG SIGNALS</div>
                {metrics.strong_signals.slice(0, 5).map((s, i) => <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)" }}>• {s}</div>)}
              </div>}
              {!!metrics.weak_signals?.length && <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#ff5a5a", marginBottom: 4 }}>WEAK SIGNALS</div>
                {metrics.weak_signals.slice(0, 5).map((s, i) => <div key={i} style={{ fontSize: 12, color: "var(--text-secondary)" }}>• {s}</div>)}
              </div>}
            </div>
          ) : null}
        </div>

        {/* Quote buckets */}
        {BUCKETS.map((b) => {
          const qs = byBucket(b.key);
          if (!qs.length) return null;
          return (
            <div key={b.key}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 14 }}>{b.label}</span>
                <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{b.hint}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {qs.map((q) => (
                  <div key={q.id} className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderLeft: "2px solid var(--accent)", borderRadius: 10, padding: "10px 13px" }}>
                    <div style={{ fontSize: 13.5, color: "var(--text-primary)", fontStyle: "italic", lineHeight: 1.5 }}>“{q.quote}”</div>
                    {q.attribution && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>— {q.attribution}{q.source ? ` · ${q.source}` : ""}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {data.voc.length === 0 && (
          <div className="glass" style={{ background: "var(--bg-card)", border: "1px dashed var(--border-hover)", borderRadius: 12, padding: 18, color: "var(--text-secondary)", fontSize: 13 }}>
            Filling in automatically as {data.name}&apos;s calls + DMs come in — pain, objections, desires, and who&apos;s showing up, in their words.
          </div>
        )}
      </div>

      {/* RIGHT: Coach chat */}
      <div className="glass" style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, display: "flex", flexDirection: "column", height: "min(74vh, 720px)", position: "sticky", top: 20 }}>
        <div style={{ padding: "14px 16px", borderBottom: "1px solid var(--border-primary)", display: "flex", alignItems: "center", gap: 8 }}>
          <Sparkles size={16} style={{ color: "var(--accent)" }} />
          <span style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 14 }}>Content coach</span>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>knows {data.name}&apos;s content + buyers</span>
        </div>
        <div ref={scroller} style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {messages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, margin: "auto 0" }}>
              <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", margin: "0 0 6px" }}>
                Brainstorm reels that pull in better buyers. It already knows {data.name}&apos;s content and what buyers say — it sharpens ideas, never scripts.
              </p>
              {starters.map((s, i) => (
                <button key={i} onClick={() => setInput(s)} style={{ textAlign: "left", fontSize: 12.5, color: "var(--text-secondary)", background: "var(--bg-glass)", border: "1px solid var(--border-primary)", borderRadius: 10, padding: "9px 12px", cursor: "pointer" }}>{s}</button>
              ))}
            </div>
          ) : messages.map((m, i) => (
            <div key={i}
              style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", background: m.role === "user" ? "var(--accent)" : "var(--bg-glass)", color: m.role === "user" ? "#1a1a1a" : "var(--text-primary)", border: m.role === "user" ? "none" : "1px solid var(--border-primary)", borderRadius: 12, padding: "10px 13px", fontSize: 13.5, lineHeight: 1.5, ...(m.role === "user" ? { whiteSpace: "pre-wrap" as const } : {}) }}
              {...(m.role === "assistant" ? { dangerouslySetInnerHTML: { __html: mdToHtml(m.content) } } : { children: m.content })}
            />
          ))}
          {busy && <div style={{ alignSelf: "flex-start", color: "var(--text-muted)", fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={14} className="spin" /> thinking…</div>}
        </div>
        <div style={{ padding: 12, borderTop: "1px solid var(--border-primary)", display: "flex", gap: 8 }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Ask the coach about ${data.name}'s content…`} rows={1}
            style={{ flex: 1, resize: "none", background: "var(--bg-glass)", border: "1px solid var(--border-primary)", borderRadius: 10, padding: "10px 12px", color: "var(--text-primary)", fontSize: 13.5, fontFamily: "inherit", outline: "none", maxHeight: 120 }} />
          <button onClick={send} disabled={busy || !input.trim()} style={{ background: "var(--accent)", border: "none", borderRadius: 10, padding: "0 14px", cursor: busy ? "default" : "pointer", color: "#1a1a1a", opacity: busy || !input.trim() ? 0.5 : 1 }}><Send size={16} /></button>
        </div>
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
