"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";

/* ============================================================
 * "Ask Ahmad" — the MAS Coaching Brain tab.
 *
 * Phase 2: read-only. Shows the brain's identity/playbooks (from the committed
 * snapshot public/mas-brain-data.json) and a read-only view of the live mas_
 * tables (client notes, query log, MAS's review inbox, learning feed) via /api/mas.
 * The conversational query + write layers arrive in later phases.
 *
 * The animated brain is adapted from the CMO tab so the two read as siblings.
 * ============================================================ */

function readThemeDark(): boolean {
  try {
    let v = getComputedStyle(document.documentElement).getPropertyValue("--bg-card").trim();
    if (!v) v = getComputedStyle(document.body).backgroundColor;
    let r = 12, g = 12, b = 14;
    if (v.startsWith("#")) {
      const h = v.slice(1);
      const f = h.length === 3 ? h.split("").map((x) => x + x).join("") : h;
      r = parseInt(f.slice(0, 2), 16); g = parseInt(f.slice(2, 4), 16); b = parseInt(f.slice(4, 6), 16);
    } else {
      const m = v.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
      if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    }
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
  } catch { return true; }
}

type BP = { vx: number; vy: number; vz: number; a: number; b: number; s: number };
function AhmadBrain({ size = 132 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr; canvas.height = size * dpr; ctx.scale(dpr, dpr);

    const N = 460;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const tY = 0.18, tX = -0.42;
    const cYf = Math.cos(tY), sYf = Math.sin(tY), cXf = Math.cos(tX), sXf = Math.sin(tX);
    const pts: BP[] = [];
    for (let i = 0; i < N; i++) {
      const yy = 1 - (i / (N - 1)) * 2;
      const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
      const th = golden * i;
      let x = Math.cos(th) * rr, y = yy, z = Math.sin(th) * rr;
      x += Math.sign(x) * 0.15 * (1 - Math.abs(x));
      x *= 1.16; y *= 0.8; z *= 1.04;
      const bump = 1 + 0.1 * Math.sin(x * 6 + z * 3) * Math.cos(y * 5 + x * 2);
      x *= bump; y *= bump; z *= bump;
      const x2 = x * cYf - z * sYf, z2 = x * sYf + z * cYf;
      const y3 = y * cXf - z2 * sXf, z3 = y * sXf + z2 * cXf;
      pts.push({ vx: x2, vy: y3, vz: z3, a: Math.random() * 6.28, b: Math.random() * 6.28, s: 0.4 + Math.random() * 0.8 });
    }
    const edges: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      let n1 = -1, d1 = 1e9, n2 = -1, d2 = 1e9;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        const dx = pts[i].vx - pts[j].vx, dy = pts[i].vy - pts[j].vy, dz = pts[i].vz - pts[j].vz;
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd < d1) { d2 = d1; n2 = n1; d1 = dd; n1 = j; } else if (dd < d2) { d2 = dd; n2 = j; }
      }
      if (n1 > i) edges.push([i, n1]);
      if (n2 > i) edges.push([i, n2]);
    }

    let raf = 0;
    const start = performance.now();
    let frame = 0;
    let themeDark = readThemeDark();
    const sx = new Float32Array(N), sy = new Float32Array(N), sd = new Float32Array(N);
    const render = (now: number) => {
      const t = (now - start) / 1000;
      if ((frame++ % 30) === 0) themeDark = readThemeDark();
      ctx.clearRect(0, 0, size, size);
      const cx = size / 2, cy = size / 2, R = size * 0.36;
      const breathe = 1 + Math.sin(t * 0.5) * 0.025;
      const energy = 0.78;
      const lineRGB = themeDark ? "150,156,176" : "118,126,148";
      const lineMul = themeDark ? 1 : 1.5;

      for (let i = 0; i < N; i++) {
        const p = pts[i];
        const ox = (0.085 * Math.sin(t * 0.8 * p.s + p.a) + 0.05 * Math.sin(t * 1.45 + p.b)) * energy;
        const oy = (0.085 * Math.sin(t * 0.7 * p.s + p.b) + 0.05 * Math.cos(t * 1.25 + p.a)) * energy;
        const oz = (0.085 * Math.cos(t * 0.74 * p.s + p.a) + 0.05 * Math.sin(t * 1.55 + p.b)) * energy;
        sx[i] = cx + (p.vx + ox) * R * breathe;
        sy[i] = cy + (p.vy + oy) * R * breathe;
        sd[i] = (p.vz + oz + 1) / 2;
      }
      ctx.lineWidth = 0.5;
      for (let k = 0; k < edges.length; k++) {
        const i = edges[k][0], j = edges[k][1];
        const fl = 0.5 + 0.5 * Math.sin(t * 1.5 + k * 0.7);
        const al = (0.04 + 0.11 * fl) * (0.35 + 0.65 * ((sd[i] + sd[j]) / 2)) * lineMul;
        ctx.strokeStyle = `rgba(${lineRGB},${al})`;
        ctx.beginPath(); ctx.moveTo(sx[i], sy[i]); ctx.lineTo(sx[j], sy[j]); ctx.stroke();
      }
      for (let i = 0; i < N; i++) {
        const d = sd[i], r = 0.5 + d * 1.3;
        let cr: number, cg: number, cb: number, a: number;
        if (themeDark) { cr = Math.round(208 + d * 26); cg = Math.round(210 + d * 24); cb = Math.round(218 + d * 20); a = 0.2 + d * 0.55; }
        else { cr = Math.round(96 - d * 32); cg = Math.round(102 - d * 32); cb = Math.round(118 - d * 30); a = 0.32 + d * 0.5; }
        ctx.beginPath(); ctx.arc(sx[i], sy[i], r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`; ctx.fill();
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return <canvas ref={ref} style={{ width: size, height: size, display: "block" }} />;
}

// Minimal, safe markdown -> HTML for the identity/playbook body.
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(?<!\*)\*(?!\*)([^*]+)\*(?!\*)/g, "<em>$1</em>");
  const lines = String(md || "").split("\n");
  let html = ""; let i = 0; let list: string | null = null;
  const close = () => { if (list) { html += "</" + list + ">"; list = null; } };
  while (i < lines.length) {
    const ln = lines[i];
    if (/^\s*$/.test(ln)) { close(); i++; continue; }
    if (/^---+\s*$/.test(ln)) { close(); html += "<hr/>"; i++; continue; }
    const h = ln.match(/^(#{1,4})\s+(.*)$/);
    if (h) { close(); const lvl = h[1].length; html += "<h" + lvl + ">" + inline(h[2]) + "</h" + lvl + ">"; i++; continue; }
    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    if (ul) { if (list !== "ul") { close(); list = "ul"; html += "<ul>"; } html += "<li>" + inline(ul[1]) + "</li>"; i++; continue; }
    close(); html += "<p>" + inline(ln) + "</p>"; i++;
  }
  close();
  return html;
}

type BrainSnapshot = { updated?: string; brain?: { name?: string; tagline?: string; markdown?: string; description?: string; path?: string } };
type ReviewRow = { id: number; kind: string; situation_summary: string; status: string; urgent: boolean; created_at: string; brain_take?: string | null; uncertainty_reason?: string | null; mas_ruling?: string | null; asked_by?: string | null; client_id?: number | null };
type MasData = {
  notes: { id: number; client_id: number; category: string; note: string; importance: string; created_by: string; created_at: string }[];
  queries: { id: number; asked_by?: string; question: string; confidence?: string; created_at: string }[];
  review: ReviewRow[];
  learning: { id: number; content: string; approved: boolean; created_at: string }[];
};

type Section = "ask" | "brain" | "notes" | "queries" | "review" | "learning";
type ChatMsg = { role: "user" | "assistant"; content: string };

export default function AskAhmadTab() {
  const [snap, setSnap] = useState<BrainSnapshot | null>(null);
  const [data, setData] = useState<MasData>({ notes: [], queries: [], review: [], learning: [] });
  const [section, setSection] = useState<Section>("ask");

  // Chat (Phase 3, read-only query layer)
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chat, sending]);

  async function sendMessage() {
    const q = input.trim();
    if (!q || sending) return;
    setChatErr(null);
    const history = chat.slice(-8);
    const next = [...chat, { role: "user" as const, content: q }];
    setChat(next);
    setInput("");
    setSending(true);
    try {
      const res = await fetch("/api/mas/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error || "Ask Ahmad failed");
      setChat((c) => [...c, { role: "assistant", content: String(d.answer || "") }]);
      loadData(); // the brain may have logged the query, saved a note, or escalated

    } catch (e) {
      setChatErr(e instanceof Error ? e.message : "Something went wrong");
      setChat((c) => c.slice(0, -1)); // drop the unanswered user turn
      setInput(q);
    } finally {
      setSending(false);
    }
  }

  const { data: session } = useSession();
  const isAdmin = session?.user?.role === "admin";
  const [rulingDraft, setRulingDraft] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    if (!isAdmin) return; // the internal views + data are admin-only
    try {
      const d = await fetch("/api/mas", { cache: "no-store" }).then((r) => r.json());
      setData({
        notes: Array.isArray(d?.notes) ? d.notes : [],
        queries: Array.isArray(d?.queries) ? d.queries : [],
        review: Array.isArray(d?.review) ? d.review : [],
        learning: Array.isArray(d?.learning) ? d.learning : [],
      });
    } catch { /* leave previous data */ }
  }, [isAdmin]);

  useEffect(() => {
    let off = false;
    fetch("/mas-brain-data.json", { cache: "no-store" }).then((r) => r.json()).then((d) => { if (!off) setSnap(d); }).catch(() => {});
    loadData();
    return () => { off = true; };
  }, [loadData]);

  async function doAdmin(action: string, id: number, ruling?: string) {
    setBusyId(id);
    try {
      const res = await fetch("/api/mas/admin", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, ruling }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error || "Action failed"); }
      setRulingDraft((d) => { const n = { ...d }; delete n[id]; return n; });
      await loadData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const brainHtml = useMemo(() => mdToHtml(snap?.brain?.markdown || ""), [snap]);
  const pendingReview = data.review.filter((r) => r.status === "pending").length;

  const NAV: { key: Section; label: string; count?: number }[] = [
    { key: "ask", label: "Ask" },
    { key: "brain", label: "Brain" },
    { key: "notes", label: "Client Notes", count: data.notes.length },
    { key: "queries", label: "Questions", count: data.queries.length },
    { key: "review", label: "Review Inbox", count: pendingReview },
    { key: "learning", label: "Learning", count: data.learning.length },
  ];

  return (
    <div>
      {/* Brand header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div style={{ flex: "0 0 auto" }}><AhmadBrain size={120} /></div>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Ask Ahmad</h2>
          <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 2 }}>
            {snap?.brain?.tagline || "Handle it the way Ahmad would"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success, #3fb27f)", display: "inline-block" }} />
            coaching brain · grounded in Ahmad&apos;s SOPs · live
          </div>
        </div>
      </div>

      {/* Sub-nav (admin only; coaches get just the Ask chat) */}
      {isAdmin && (
      <div style={{ display: "flex", gap: 4, marginBottom: 18, flexWrap: "wrap" }}>
        {NAV.map((n) => (
          <button
            key={n.key}
            onClick={() => setSection(n.key)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8,
              border: "1px solid var(--border)", cursor: "pointer", fontSize: 12.5,
              fontWeight: section === n.key ? 600 : 400,
              background: section === n.key ? "var(--accent)" : "var(--bg-glass)",
              color: section === n.key ? "var(--bg-primary)" : "var(--text-secondary)",
            }}
          >
            {n.label}
            {typeof n.count === "number" && n.count > 0 && (
              <span style={{ fontSize: 11, padding: "0 6px", borderRadius: 10, background: section === n.key ? "rgba(0,0,0,0.15)" : "var(--border)", color: section === n.key ? "var(--bg-primary)" : "var(--text-secondary)" }}>{n.count}</span>
            )}
          </button>
        ))}
      </div>
      )}

      {/* Content */}
      <div style={{ background: "var(--bg-card, var(--bg-glass))", border: "1px solid var(--border)", borderRadius: 12, padding: 22 }}>
        {section === "ask" && (
          <div>
            <div style={{ minHeight: 220, maxHeight: 460, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, marginBottom: 14 }}>
              {chat.length === 0 && !sending && (
                <div style={{ textAlign: "center", padding: "28px 20px" }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>Ask Ahmad about a client situation</div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 480, margin: "0 auto 14px", lineHeight: 1.55 }}>
                    Describe what is going on and you will get Ahmad&apos;s take, grounded in his SOPs. For a specific client, mention their full name so the brain can pull their history.
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
                    {[
                      "A client wants to pause for a month, what do I tell them?",
                      "A client is asking for a refund and seems upset.",
                      "How do I handle a client who wants their macros changed?",
                    ].map((s) => (
                      <button key={s} onClick={() => setInput(s)} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer" }}>{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {chat.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  <div
                    className={m.role === "assistant" ? "ask-ahmad-md" : undefined}
                    style={{
                      maxWidth: "82%", padding: "10px 14px", borderRadius: 12, fontSize: 14, lineHeight: 1.55,
                      background: m.role === "user" ? "var(--accent)" : "var(--bg-glass)",
                      color: m.role === "user" ? "var(--bg-primary)" : "var(--text-primary)",
                      border: m.role === "assistant" ? "1px solid var(--border)" : "none",
                      whiteSpace: m.role === "user" ? "pre-wrap" : undefined,
                    }}
                    {...(m.role === "assistant" ? { dangerouslySetInnerHTML: { __html: mdToHtml(m.content) } } : { children: m.content })}
                  />
                </div>
              ))}
              {sending && (
                <div style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={{ padding: "10px 14px", borderRadius: 12, fontSize: 13, background: "var(--bg-glass)", color: "var(--text-secondary)", border: "1px solid var(--border)" }}>Ahmad is thinking…</div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            {chatErr && <div style={{ fontSize: 12.5, color: "var(--danger, #e0564f)", marginBottom: 8 }}>{chatErr}</div>}
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                placeholder="Describe the situation… (Enter to send, Shift+Enter for a new line)"
                rows={2}
                style={{ flex: 1, resize: "vertical", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 14, fontFamily: "inherit" }}
              />
              <button
                onClick={sendMessage}
                disabled={sending || !input.trim()}
                style={{ padding: "10px 18px", borderRadius: 10, border: "none", cursor: sending || !input.trim() ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600, background: "var(--accent)", color: "var(--bg-primary)", opacity: sending || !input.trim() ? 0.55 : 1, whiteSpace: "nowrap" }}
              >
                {sending ? "…" : "Ask"}
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 8 }}>
              Ahmad reads the SOPs and client history, saves important notes, and flags anything he is unsure about to your inbox.
            </div>
          </div>
        )}

        {section === "brain" && (
          snap?.brain?.markdown
            ? <div className="ask-ahmad-md" style={{ color: "var(--text-primary)", lineHeight: 1.6, fontSize: 14 }} dangerouslySetInnerHTML={{ __html: brainHtml }} />
            : <Empty title="Loading the brain…" body="Reading Ahmad's identity and playbooks." />
        )}

        {section === "notes" && (
          data.notes.length === 0
            ? <Empty title="No client notes yet" body="When the brain handles a client situation, important notes will appear here, tied to each client and stamped by who wrote them." />
            : <List rows={data.notes.map((n) => ({ id: n.id, top: `${cap(n.category)} · client #${n.client_id}`, body: n.note, foot: `${n.created_by} · ${fmt(n.created_at)}${n.importance === "high" ? " · important" : ""}` }))} />
        )}

        {section === "queries" && (
          data.queries.length === 0
            ? <Empty title="No questions logged yet" body="Every question a coach asks the brain gets logged here, so recurring situations become visible over time." />
            : <List rows={data.queries.map((q) => ({ id: q.id, top: q.asked_by || "coach", body: q.question, foot: `${q.confidence ? q.confidence + " confidence · " : ""}${fmt(q.created_at)}` }))} />
        )}

        {section === "review" && (() => {
          const pending = data.review.filter((r) => r.status === "pending");
          const resolved = data.review.filter((r) => r.status !== "pending");
          if (data.review.length === 0) {
            return <Empty title="Your inbox is clear" body="Situations the brain is unsure about will wait here for your ruling. Urgent ones also ping you on Slack. Your ruling becomes guidance the brain applies to similar situations on its own." />;
          }
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pending.map((r) => (
                <div key={r.id} style={{ border: `1px solid ${r.urgent ? "var(--danger, #e0564f)" : "var(--border)"}`, borderRadius: 10, padding: "12px 14px", background: "var(--bg-glass)" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: r.urgent ? "var(--danger, #e0564f)" : "var(--text-secondary)", marginBottom: 4 }}>
                    {cap(r.kind.replace(/_/g, " "))}{r.urgent ? " · URGENT" : ""}{r.client_id ? ` · client #${r.client_id}` : ""}{r.asked_by ? ` · ${r.asked_by}` : ""}
                  </div>
                  <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.situation_summary}</div>
                  {r.brain_take && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 6 }}><b>Brain&apos;s take:</b> {r.brain_take}</div>}
                  {r.uncertainty_reason && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}><b>Unsure because:</b> {r.uncertainty_reason}</div>}
                  <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 6 }}>{fmt(r.created_at)}</div>
                  {isAdmin && (
                    <div style={{ marginTop: 10 }}>
                      <textarea
                        value={rulingDraft[r.id] || ""}
                        onChange={(e) => setRulingDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                        placeholder="Your ruling — how should this be handled? (becomes guidance the brain reuses)"
                        rows={2}
                        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card, var(--bg-glass))", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit" }}
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button onClick={() => doAdmin("rule_review", r.id, rulingDraft[r.id])} disabled={busyId === r.id || !(rulingDraft[r.id] || "").trim()}
                          style={{ padding: "7px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: "var(--accent)", color: "var(--bg-primary)", opacity: busyId === r.id || !(rulingDraft[r.id] || "").trim() ? 0.55 : 1 }}>
                          {busyId === r.id ? "…" : "Save ruling"}
                        </button>
                        <button onClick={() => doAdmin("dismiss_review", r.id)} disabled={busyId === r.id}
                          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontSize: 12.5, background: "var(--bg-glass)", color: "var(--text-secondary)" }}>
                          Dismiss
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {resolved.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", margin: "8px 0" }}>Resolved</div>
                  {resolved.map((r) => (
                    <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 8, opacity: 0.7 }}>
                      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 3 }}>{cap(r.status)} · {fmt(r.created_at)}</div>
                      <div style={{ fontSize: 13.5, color: "var(--text-primary)" }}>{r.situation_summary}</div>
                      {r.mas_ruling && <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 4 }}><b>Your ruling:</b> {r.mas_ruling}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {section === "learning" && (
          data.learning.length === 0
            ? <Empty title="Nothing learned yet" body="Once you rule on a flagged situation, it becomes permanent guidance here and the brain applies it to similar situations on its own." />
            : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {data.learning.map((l) => (
                  <div key={l.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", background: "var(--bg-glass)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: l.approved ? "var(--success, #3fb27f)" : "var(--text-secondary)", marginBottom: 4 }}>{l.approved ? "Approved guidance" : "Proposed · awaiting your approval"}</div>
                    <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{l.content}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 6 }}>{fmt(l.created_at)}</div>
                    {isAdmin && !l.approved && (
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button onClick={() => doAdmin("approve_learning", l.id)} disabled={busyId === l.id}
                          style={{ padding: "6px 12px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, background: "var(--accent)", color: "var(--bg-primary)" }}>Approve</button>
                        <button onClick={() => doAdmin("reject_learning", l.id)} disabled={busyId === l.id}
                          style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", fontSize: 12.5, background: "var(--bg-glass)", color: "var(--text-secondary)" }}>Reject</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
        )}
      </div>

      <style>{`
        .ask-ahmad-md h1 { font-size: 19px; font-weight: 700; margin: 0 0 10px; }
        .ask-ahmad-md h2 { font-size: 16px; font-weight: 650; margin: 22px 0 8px; }
        .ask-ahmad-md h3 { font-size: 14px; font-weight: 600; margin: 16px 0 6px; }
        .ask-ahmad-md p { margin: 8px 0; }
        .ask-ahmad-md ul { margin: 8px 0; padding-left: 20px; }
        .ask-ahmad-md li { margin: 4px 0; }
        .ask-ahmad-md code { background: var(--bg-glass); padding: 1px 5px; border-radius: 4px; font-size: 13px; }
        .ask-ahmad-md hr { border: none; border-top: 1px solid var(--border); margin: 18px 0; }
        .ask-ahmad-md strong { color: var(--text-primary); }
      `}</style>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ textAlign: "center", padding: "36px 20px" }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", maxWidth: 460, margin: "0 auto", lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}

function List({ rows }: { rows: { id: number; top: string; body: string; foot: string }[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => (
        <div key={r.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", background: "var(--bg-glass)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>{r.top}</div>
          <div style={{ fontSize: 14, color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{r.body}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 6 }}>{r.foot}</div>
        </div>
      ))}
    </div>
  );
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function fmt(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
  catch { return iso; }
}
