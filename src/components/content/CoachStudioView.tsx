"use client";

import { useRef, useState } from "react";
import { Send, Loader2, ChevronDown, Sparkles } from "lucide-react";

type Icp = { one_line?: string; who_they_are?: string; top_pains?: string[]; desires?: string[]; triggers?: string[]; language?: string[] };
type Angle = { title: string; hook: string | null; rationale: string | null };
type Dossier = { name: string; keyword?: string | null; research: Record<string, unknown> };
type Msg = { role: "user" | "assistant"; content: string };

const STARTERS = ["What should I post this week?", "Score my idea before I film it", "Why did my last DRIFT post miss?", "Turn a buyer story into a hook"];

function list(v: unknown): string[] { return Array.isArray(v) ? (v as string[]) : []; }

function Drawer({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "15px 18px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)" }}>{title}</span>
        {count != null && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{count}</span>}
        <span style={{ flex: 1 }} />
        <ChevronDown size={17} style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && <div style={{ padding: "0 18px 18px" }}>{children}</div>}
    </div>
  );
}

export default function CoachStudioView({ data, creator, token }: { data: { icp: Icp | null; angles: Angle[]; dossiers: Dossier[]; voc: Record<string, string[]> }; creator: string; token?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [icpOpen, setIcpOpen] = useState(false);
  const [vocBucket, setVocBucket] = useState<string>(Object.keys(data.voc || {})[0] || "");
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...messages, { role: "user" as const, content: q }];
    setMessages(next); setInput(""); setBusy(true);
    try {
      const res = await fetch("/api/content/coach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(token ? { token, messages: next.slice(-12) } : { creator, messages: next.slice(-12) }) });
      const raw = await res.text();
      let reply = raw;
      try { const j = JSON.parse(raw); reply = j.reply || j.text || j.content || j.message || raw; } catch { /* plain text stream */ }
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
    } catch { setMessages((m) => [...m, { role: "assistant", content: "Something went wrong. Try again." }]); }
    finally { setBusy(false); requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" })); }
  };

  const icp = data.icp;
  const chip = (t: string, color = "var(--accent)") => (
    <span key={t} style={{ fontSize: 12, color, border: `1px solid ${color}44`, background: `${color}12`, borderRadius: 999, padding: "4px 10px" }}>{t}</span>
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Your buyer */}
      {icp && (
        <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: "var(--accent)", marginBottom: 8 }}>Your buyer</div>
          {icp.one_line && <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 12 }}>{icp.one_line}</div>}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {list(icp.top_pains).slice(0, 3).map((p) => chip(p, RED))}
            {list(icp.desires).slice(0, 2).map((p) => chip(p, GREEN))}
            {list(icp.triggers).slice(0, 2).map((p) => chip(p, "var(--accent)"))}
          </div>
          <button onClick={() => setIcpOpen((v) => !v)} style={{ marginTop: 12, background: "none", border: "none", color: "var(--text-muted)", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            {icpOpen ? "Hide the full picture" : "See the full picture"}
          </button>
          {icpOpen && (
            <div style={{ marginTop: 12, fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.7 }}>
              {icp.who_they_are && <p style={{ margin: "0 0 10px" }}>{icp.who_they_are}</p>}
              {list(icp.language).length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{list(icp.language).slice(0, 10).map((w) => chip(w, "var(--text-muted)"))}</div>}
            </div>
          )}
        </div>
      )}

      {/* Chat */}
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, display: "flex", flexDirection: "column", minHeight: 380 }}>
        <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
          {messages.length === 0 ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-primary)", fontSize: 15, fontWeight: 700, marginBottom: 4 }}><Sparkles size={16} style={{ color: "var(--accent)" }} /> Your content coach</div>
              <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 14px" }}>Grounded in who actually buys from you. Ask it anything about what to make next.</p>
              <div style={{ display: "grid", gap: 8 }}>
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} style={{ textAlign: "left", padding: "11px 14px", borderRadius: 10, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", fontSize: 13.5, cursor: "pointer" }}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "88%", background: m.role === "user" ? "var(--accent-soft)" : "var(--bg-glass)", border: "1px solid var(--border-primary)", borderRadius: 12, padding: "10px 14px", fontSize: 14, color: m.role === "user" ? "var(--text-primary)" : "var(--text-secondary)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.content}</div>
            ))
          )}
          {busy && <div style={{ alignSelf: "flex-start", color: "var(--text-muted)", fontSize: 13 }}><Loader2 size={14} className="spin" /> thinking...</div>}
          <div ref={endRef} />
        </div>
        <div style={{ borderTop: "1px solid var(--border-primary)", padding: 12, display: "flex", gap: 8 }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
            placeholder="Ask your coach..." rows={1} style={{ flex: 1, resize: "none", background: "var(--bg-glass)", border: "1px solid var(--border-primary)", borderRadius: 10, color: "var(--text-primary)", padding: "11px 14px", fontSize: 14, fontFamily: "inherit", lineHeight: 1.4 }} />
          <button onClick={() => send(input)} disabled={busy || !input.trim()} style={{ width: 44, borderRadius: 10, border: "none", background: "var(--accent)", color: "#1a1a1a", cursor: busy ? "default" : "pointer", display: "grid", placeItems: "center", opacity: !input.trim() ? 0.5 : 1 }}><Send size={17} /></button>
        </div>
      </div>

      {/* Evidence drawers */}
      <Drawer title="Content ideas" count={data.angles?.length || 0}>
        <div style={{ display: "grid", gap: 10 }}>
          {(data.angles || []).map((a, i) => (
            <div key={i} style={{ border: "1px solid var(--border-primary)", borderRadius: 10, padding: 14, borderLeft: "3px solid var(--accent)" }}>
              <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{a.title}</div>
              {a.hook && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 8 }}>&ldquo;{a.hook}&rdquo;</div>}
              <button onClick={() => send(`Help me turn this into a post I can film: ${a.hook || a.title}`)} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>Use this</button>
            </div>
          ))}
        </div>
      </Drawer>

      <Drawer title="People who bought" count={data.dossiers?.length || 0}>
        <div style={{ display: "grid", gap: 10 }}>
          {(data.dossiers || []).map((d, i) => {
            const r = d.research || {};
            return (
              <div key={i} style={{ border: "1px solid var(--border-primary)", borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{d.name}</div>
                {typeof r.summary === "string" && <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 8 }}>{r.summary}</div>}
                {list(r.their_words).length > 0 && (
                  <div style={{ display: "grid", gap: 4 }}>
                    {list(r.their_words).slice(0, 3).map((w, j) => <div key={j} style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>&ldquo;{w}&rdquo;</div>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Drawer>

      {Object.keys(data.voc || {}).length > 0 && (
        <Drawer title="In their words" count={Object.values(data.voc).reduce((s, a) => s + a.length, 0)}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {Object.keys(data.voc).map((b) => (
              <button key={b} onClick={() => setVocBucket(b)} style={{ fontSize: 12, fontWeight: 600, padding: "5px 11px", borderRadius: 999, border: `1px solid ${vocBucket === b ? "var(--accent)" : "var(--border-primary)"}`, background: vocBucket === b ? "var(--accent-soft)" : "transparent", color: vocBucket === b ? "var(--text-primary)" : "var(--text-muted)", cursor: "pointer", textTransform: "capitalize" }}>{b}</button>
            ))}
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {(data.voc[vocBucket] || []).map((q, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", border: "1px solid var(--border-primary)", borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, flex: 1 }}>{q}</span>
                <button onClick={() => send(`Turn this into a hook: "${q}"`)} style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>use</button>
              </div>
            ))}
          </div>
        </Drawer>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

const GREEN = "#8ce0ab", RED = "#e0794d";
