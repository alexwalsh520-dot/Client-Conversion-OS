"use client";

// CMO Agent. Your daily marketing brief, built for the eye. Each card answers four questions
// in one glance (what's the verdict, what justifies it, which way it's trending, is it alive)
// with the full proof one tap away. The agent proposes; you comment + pick a preset; that logs
// your directive for a Claude session to execute. Nothing fires on its own.

import { useCallback, useEffect, useState } from "react";

const BG = "#09090b", CARD = "#111114", INSET = "#0d0d10", LINE = "#26262b", TEXT = "#e7e7ea", DIM = "#9a9aa4", BODY = "#c9c9d0", GOLD = "#c9a96e";

const KIND: Record<string, { color: string; bg: string; icon: string; label: string }> = {
  scale: { color: "#8ce0ab", bg: "#14311f", icon: "▲", label: "SCALE" },
  kill: { color: "#e0794d", bg: "#331616", icon: "■", label: "KILL" },
  watch: { color: "#e4c66a", bg: "#332a12", icon: "●", label: "WATCH" },
  make_variations: { color: "#7aa2f7", bg: "#16233a", icon: "✚", label: "MAKE" },
};
const kindMeta = (k: string) => KIND[k] ?? { color: DIM, bg: "#1c1c20", icon: "◆", label: k.toUpperCase() };
const ltgpColor = (v: number | null | undefined) => (Number(v) >= 3 ? "#8ce0ab" : Number(v) >= 2 ? "#e4c66a" : "#e0794d");

type WinCell = { spend: number; roas: number; ltgp: number; closed: number };
type Ev = {
  running?: boolean; spendLast3d?: number; lastSpend?: string | null;
  windows?: { d7: WinCell | null; d14: WinCell | null; d30: WinCell | null };
  funnel14d?: { dms: number; costPerDm: number | null; booked: number; taken: number; closed: number } | null;
  allTimeCloses?: number | null;
};
type Item = {
  id: string; creator: string; kind: string; target: string | null; title: string;
  detail: string | null; suggestion: string | null; evidence: Ev | null; rule: string | null;
  status: string; alex_comment: string | null; alex_directive: string | null;
};

const num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };
const chip = (color: string, bg: string): React.CSSProperties => ({ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", padding: "3px 10px", borderRadius: 999, background: bg, color });

function heroOf(ev: Ev): { value: number | null; label: string; closed: number | null } {
  const w = ev.windows;
  if (!w) return { value: null, label: "LTGP:CAC", closed: null };
  if (w.d14) return { value: w.d14.ltgp, label: "LTGP:CAC · 14d", closed: w.d14.closed };
  if (w.d7) return { value: w.d7.ltgp, label: "LTGP:CAC · 7d", closed: w.d7.closed };
  if (w.d30) return { value: w.d30.ltgp, label: "LTGP:CAC · 30d", closed: w.d30.closed };
  return { value: null, label: "LTGP:CAC", closed: null };
}

function TrendBars({ w }: { w: Ev["windows"] }) {
  if (!w) return null;
  const bars: [string, WinCell | null][] = [["7 days", w.d7], ["14 days", w.d14], ["30 days", w.d30]];
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
      {bars.map(([lbl, c]) => {
        const v = c ? c.ltgp : null;
        const h = v == null ? 8 : Math.max(8, (Math.min(v, 4) / 4) * 52);
        const on = lbl === "14 days";
        return (
          <div key={lbl} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: v == null ? DIM : ltgpColor(v), ...num }}>{v == null ? "n/a" : `${v.toFixed(1)}x`}</span>
            <div style={{ width: 24, height: h, borderRadius: 4, background: v == null ? LINE : ltgpColor(v), opacity: on ? 1 : 0.5 }} />
            <span style={{ fontSize: 10.5, color: on ? TEXT : DIM, fontWeight: on ? 700 : 400 }}>{lbl}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function CmoAgentPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/cmo-agent/items").then((x) => x.json()).catch(() => null);
    if (r?.ok) { setItems(r.items); setDate(r.date); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const runToday = async () => { setRunning(true); await fetch("/api/cmo-agent/run", { method: "POST" }).catch(() => null); await load(); setRunning(false); };
  const direct = async (id: string, directive: string) => {
    await fetch("/api/cmo-agent/items", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, directive, comment: drafts[id] || "" }) }).catch(() => null);
    await load();
  };

  const toDecide = items.filter((i) => i.status === "proposed");
  const decided = items.filter((i) => i.status !== "proposed");

  const page: React.CSSProperties = { background: BG, color: TEXT, minHeight: "100vh", padding: "36px 20px 100px", fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" };
  const shell: React.CSSProperties = { maxWidth: 720, margin: "0 auto" };
  const runBtn: React.CSSProperties = { fontSize: 13, fontWeight: 700, borderRadius: 8, padding: "9px 16px", cursor: "pointer", background: GOLD, color: "#111", border: "none" };

  return (
    <div style={page}><div style={shell}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "2px", color: DIM, textTransform: "uppercase" }}>CCOS</div>
          <h1 style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 4px" }}>CMO Agent</h1>
          <div style={{ fontSize: 14, color: DIM, lineHeight: 1.6, maxWidth: 460 }}>Decide each move. Your call gets logged, a Claude session executes it.</div>
        </div>
        <button onClick={runToday} disabled={running} style={{ ...runBtn, opacity: running ? 0.6 : 1 }}>{running ? "Thinking…" : "↻ Run today's brief"}</button>
      </div>

      {loading ? (
        <p style={{ color: DIM, marginTop: 32 }}>Loading…</p>
      ) : items.length === 0 ? (
        <div style={{ marginTop: 32, background: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>Nothing to decide today.</div>
          <div style={{ fontSize: 14, color: DIM, margin: "8px 0 18px" }}>Run the brief to have the agent read the numbers and lay out your moves.</div>
          <button onClick={runToday} disabled={running} style={{ ...runBtn, opacity: running ? 0.6 : 1 }}>{running ? "Thinking…" : "↻ Run today's brief"}</button>
        </div>
      ) : (
        <>
          {toDecide.length > 0 && <div style={{ fontSize: 15, fontWeight: 700, marginTop: 32, marginBottom: 4 }}>{toDecide.length} to decide</div>}
          {toDecide.map((i) => {
            const k = kindMeta(i.kind);
            const ev = i.evidence || {};
            const hero = heroOf(ev);
            const isOpen = !!open[i.id];
            return (
              <div key={i.id} style={{ background: CARD, border: `1px solid ${LINE}`, borderLeft: `3px solid ${k.color}`, borderRadius: 14, padding: 24, marginTop: 16 }}>
                {/* Row 1: chips + live */}
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={chip(k.color, k.bg)}>{k.icon} {k.label}</span>
                  <span style={{ ...chip(GOLD, "transparent"), border: `1px solid rgba(201,169,110,0.35)` }}>{i.creator}</span>
                  <span style={{ flex: 1 }} />
                  {ev.running !== undefined && (
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: ev.running ? "#8ce0ab" : DIM, ...num }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: ev.running ? "#8ce0ab" : "#5a5a62" }} />
                      {ev.running ? `$${ev.spendLast3d ?? 0} in 3d` : `stopped${ev.lastSpend ? ` · last ${ev.lastSpend}` : ""}`}
                    </span>
                  )}
                </div>

                {/* Row 2: hero + trend + closed */}
                {(hero.value != null || ev.windows) && (
                  <div style={{ display: "flex", gap: 24, alignItems: "flex-end", marginTop: 16 }}>
                    {hero.value != null && (
                      <div>
                        <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: ltgpColor(hero.value), ...num }}>{hero.value.toFixed(1)}x</div>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: DIM, marginTop: 4 }}>{hero.label}</div>
                      </div>
                    )}
                    {ev.windows && <TrendBars w={ev.windows} />}
                    {hero.closed != null && (
                      <span style={{ ...num, fontSize: 12, padding: "4px 10px", borderRadius: 999, border: `1px solid ${LINE}`, color: hero.closed > 0 ? TEXT : DIM, marginBottom: 2 }}>{hero.closed} {hero.closed === 1 ? "client" : "clients"} in 14 days</span>
                    )}
                  </div>
                )}

                {/* Row 3-4: title + detail */}
                <div style={{ fontSize: 18, fontWeight: 700, marginTop: 16, maxWidth: "56ch" }}>{i.title}</div>
                {i.detail && (
                  <div style={{ fontSize: 15, lineHeight: 1.7, color: BODY, marginTop: 8, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i.detail}</div>
                )}

                {/* Row 5: expander */}
                <div style={{ marginTop: 16 }}>
                  <button onClick={() => setOpen((o) => ({ ...o, [i.id]: !o[i.id] }))} style={{ fontSize: 13, fontWeight: 600, color: DIM, background: "none", border: "none", padding: "8px 0", cursor: "pointer" }}>
                    {isOpen ? "Hide the numbers ▾" : "Show the numbers ▸"}
                  </button>
                  {isOpen && <Numbers ev={ev} rule={i.rule} />}
                </div>

                {/* Row 6: action */}
                <textarea
                  value={drafts[i.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))}
                  placeholder={i.suggestion ? `Suggested: ${i.suggestion}` : "Your call. Say what you want done."}
                  style={{ width: "100%", minHeight: 52, marginTop: 16, background: INSET, border: `1px solid ${LINE}`, borderRadius: 10, color: TEXT, padding: "12px 14px", fontSize: 15, fontFamily: "inherit", lineHeight: 1.5, resize: "vertical" }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                  <button onClick={() => direct(i.id, "approve")} style={{ fontSize: 14, fontWeight: 700, padding: "10px 18px", borderRadius: 9, background: "#14311f", border: "1px solid #2e6b4a", color: "#8ce0ab", cursor: "pointer" }}>✓ Do it as suggested</button>
                  <button onClick={() => direct(i.id, "adjust")} style={{ fontSize: 13, fontWeight: 600, padding: "9px 14px", borderRadius: 9, background: "#17171b", border: `1px solid ${LINE}`, color: TEXT, cursor: "pointer" }}>✎ Do this instead</button>
                  <button onClick={() => direct(i.id, "hold")} style={{ fontSize: 13, fontWeight: 600, padding: "9px 14px", borderRadius: 9, background: "transparent", border: "1px solid transparent", color: DIM, cursor: "pointer" }}>⏸ Hold</button>
                  <button onClick={() => direct(i.id, "dismiss")} style={{ fontSize: 13, fontWeight: 600, padding: "9px 14px", borderRadius: 9, background: "transparent", border: "1px solid transparent", color: DIM, cursor: "pointer" }}>✕ Dismiss</button>
                </div>
              </div>
            );
          })}

          {decided.length > 0 && (
            <>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 32, marginBottom: 4 }}>{decided.length} decided</div>
              {decided.map((i) => {
                const k = kindMeta(i.kind);
                const dir = i.alex_directive || i.status;
                const dchip: Record<string, [string, string]> = { approve: ["approved", "#8ce0ab"], adjust: ["adjusted", GOLD], hold: ["held", DIM], dismiss: ["dismissed", DIM], dismissed: ["dismissed", DIM] };
                const [dlabel, dcolor] = dchip[dir] ?? [dir, DIM];
                return (
                  <div key={i.id} style={{ background: INSET, borderLeft: `3px solid ${k.color}88`, borderRadius: 10, padding: "14px 18px", marginTop: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{i.title}</span>
                      <span style={{ ...chip(dcolor, "transparent"), border: `1px solid ${LINE}` }}>{dlabel}</span>
                      <button onClick={() => direct(i.id, "reopen")} style={{ fontSize: 12, color: DIM, background: "none", border: "none", textDecoration: "underline", cursor: "pointer" }}>reopen</button>
                    </div>
                    {i.alex_comment && <div style={{ fontSize: 13, color: BODY, marginTop: 5 }}>&quot;{i.alex_comment}&quot;</div>}
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      <p style={{ fontSize: 12, color: DIM, marginTop: 34, borderTop: `1px solid ${LINE}`, paddingTop: 16 }}>
        Money numbers come from the canonical Ads attribution. The agent proposes, you decide, a CMO Agent session executes your logged directives.
      </p>
    </div></div>
  );
}

function Numbers({ ev, rule }: { ev: Ev; rule: string | null }) {
  const w = ev.windows;
  const rows: [string, WinCell][] = w
    ? ([["7d", w.d7], ["14d", w.d14], ["30d", w.d30]] as [string, WinCell | null][]).filter((r): r is [string, WinCell] => !!r[1])
    : [];
  const f = ev.funnel14d;
  const cell: React.CSSProperties = { padding: "8px 10px", fontSize: 13, fontWeight: 600, color: BODY, fontVariantNumeric: "tabular-nums", textAlign: "right" };
  const head: React.CSSProperties = { padding: "4px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: DIM, textAlign: "right" };
  return (
    <div style={{ background: INSET, border: `1px solid ${LINE}`, borderRadius: 10, padding: 16, marginTop: 8 }}>
      {ev.running !== undefined && (
        <div style={{ fontSize: 13, color: BODY }}>
          {ev.running ? `Still running. $${ev.spendLast3d ?? 0} spent in the last 3 days.` : `Stopped. Last spend ${ev.lastSpend ?? "unknown"}.`}
        </div>
      )}
      {rows.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 12 }}>
          <thead><tr>
            <th style={{ ...head, textAlign: "left" }}>window</th><th style={head}>spend</th><th style={head}>ROAS</th><th style={head}>LTGP:CAC</th><th style={head}>clients</th>
          </tr></thead>
          <tbody>{rows.map(([lbl, c]) => (
            <tr key={lbl} style={{ borderTop: `1px solid ${LINE}` }}>
              <td style={{ ...cell, textAlign: "left", color: TEXT }}>{lbl}</td>
              <td style={cell}>${c.spend}</td>
              <td style={cell}>{c.roas}x</td>
              <td style={{ ...cell, color: ltgpColor(c.ltgp), fontWeight: 700 }}>{c.ltgp}x</td>
              <td style={cell}>{c.closed}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {f && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: DIM, marginBottom: 8 }}>Where the last 14 days went</div>
          <div style={{ display: "grid", gap: 6 }}>
            {[
              { n: f.dms, l: `people DM'd${f.costPerDm != null ? ` (about $${f.costPerDm} per DM)` : ""}` },
              { n: f.booked, l: "booked a call" },
              { n: f.taken, l: "showed up to the call" },
              { n: f.closed, l: "became clients" },
            ].map((s) => (
              <div key={s.l} style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 16, fontWeight: 700, minWidth: 34, fontVariantNumeric: "tabular-nums" }}>{s.n}</span>
                <span style={{ fontSize: 13.5, color: BODY }}>{s.l}</span>
              </div>
            ))}
          </div>
          {ev.allTimeCloses != null && (
            <div style={{ fontSize: 12.5, color: BODY, marginTop: 12 }}>
              All time, this ad has made <b style={{ color: TEXT }}>{ev.allTimeCloses}</b> {ev.allTimeCloses === 1 ? "client" : "clients"}.
            </div>
          )}
        </div>
      )}
      {rule && <div style={{ fontSize: 12, color: DIM, marginTop: 14 }}>Rule: {rule}</div>}
    </div>
  );
}
