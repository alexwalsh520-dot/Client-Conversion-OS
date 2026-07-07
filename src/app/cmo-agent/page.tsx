"use client";

// CMO Agent — your daily marketing brief. The agent proposes money moves; you react with a
// comment + a preset. That logs your real directive for a Claude session to execute with full
// context. Nothing fires on its own. Factory-style human-in-the-loop.

import { useCallback, useEffect, useState } from "react";

const GOLD = "#c9a96e", INK = "#09090b", PANEL = "#111114", LINE = "#26262b", DIM = "#8a8a94", TEXT = "#e7e7ea";
const KIND: Record<string, { label: string; color: string; bg: string }> = {
  scale: { label: "SCALE", color: "#8ce0ab", bg: "#14311f" },
  kill: { label: "KILL", color: "#e0794d", bg: "#331616" },
  watch: { label: "WATCH", color: "#e4c66a", bg: "#332a12" },
  make_variations: { label: "MAKE", color: "#7aa2f7", bg: "#16233a" },
  reopen: { label: "LATE $", color: "#c9a96e", bg: "#2a2412" },
  launch: { label: "LAUNCH", color: "#7aa2f7", bg: "#16233a" },
  write_copy: { label: "WRITE", color: "#7aa2f7", bg: "#16233a" },
};

type Item = {
  id: string; creator: string; kind: string; target: string | null; title: string;
  detail: string | null; suggestion: string | null; evidence: Record<string, unknown> | null;
  rule: string | null; status: string; alex_comment: string | null; alex_directive: string | null;
};

const MONO: React.CSSProperties = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" };
type WinCell = { spend: number; roas: number; ltgp: number; closed: number };

// The proof panel — spend + ROAS + LTGP:CAC across windows, running status, and the funnel.
// This is what lets Alex trust a verdict without opening Meta.
function Proof({ ev }: { ev: Record<string, unknown> }) {
  const w = (ev.windows as Record<string, WinCell | null> | undefined) || {};
  const rows: [string, WinCell][] = (["d7", "d14", "d30"] as const)
    .map((k) => [k.replace("d", "") + "d", w[k]] as [string, WinCell | null])
    .filter((r): r is [string, WinCell] => !!r[1]);
  const f = ev.funnel14d as { dms: number; costPerDm: number | null; booked: number; taken: number; closed: number } | null;
  const running = ev.running as boolean | undefined;
  if (rows.length === 0 && running === undefined) return null;
  const ltgpColor = (v: number) => (v >= 3 ? "#8ce0ab" : v >= 2 ? "#e4c66a" : "#e0794d");
  return (
    <div style={{ background: "#0d0d10", border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 12px", marginTop: 4 }}>
      {running !== undefined && (
        <div style={{ ...MONO, fontSize: 12, marginBottom: rows.length ? 8 : 0, color: running ? "#8ce0ab" : DIM }}>
          {running ? `● Running — $${String(ev.spendLast3d ?? 0)} spent in the last 3 days` : `○ Stopped — last spend ${String(ev.lastSpend ?? "unknown")}`}
        </div>
      )}
      {rows.length > 0 && (
        <table style={{ ...MONO, borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
          <thead><tr style={{ color: DIM }}>
            <th style={{ textAlign: "left", padding: "2px 8px" }}>window</th>
            <th style={{ textAlign: "right", padding: "2px 8px" }}>spend</th>
            <th style={{ textAlign: "right", padding: "2px 8px" }}>ROAS</th>
            <th style={{ textAlign: "right", padding: "2px 8px" }}>LTGP:CAC</th>
            <th style={{ textAlign: "right", padding: "2px 8px" }}>closed</th>
          </tr></thead>
          <tbody>{rows.map(([lbl, x]) => (
            <tr key={lbl} style={{ borderTop: `1px solid ${LINE}` }}>
              <td style={{ padding: "3px 8px", color: TEXT }}>{lbl}</td>
              <td style={{ padding: "3px 8px", textAlign: "right", color: DIM }}>${x.spend}</td>
              <td style={{ padding: "3px 8px", textAlign: "right", color: DIM }}>{x.roas}×</td>
              <td style={{ padding: "3px 8px", textAlign: "right", color: ltgpColor(x.ltgp), fontWeight: 700 }}>{x.ltgp}×</td>
              <td style={{ padding: "3px 8px", textAlign: "right", color: DIM }}>{x.closed}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      {f && (
        <div style={{ ...MONO, fontSize: 11.5, color: DIM, marginTop: 8 }}>
          funnel 14d: {f.dms} DMs{f.costPerDm != null ? ` ($${f.costPerDm}/DM)` : ""} → {f.booked} booked → {f.taken} taken → {f.closed} closed
          {ev.allTimeCloses != null && <span> · {String(ev.allTimeCloses)} closed all-time</span>}
        </div>
      )}
    </div>
  );
}

export default function CmoAgentPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/cmo-agent/items").then((x) => x.json()).catch(() => null);
    if (r?.ok) { setItems(r.items); setDate(r.date); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const runToday = async () => {
    setRunning(true);
    await fetch("/api/cmo-agent/run", { method: "POST" }).catch(() => null);
    await load();
    setRunning(false);
  };

  const direct = async (id: string, directive: string) => {
    await fetch("/api/cmo-agent/items", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, directive, comment: drafts[id] || "" }),
    }).catch(() => null);
    await load();
  };

  const open = items.filter((i) => i.status === "proposed");
  const done = items.filter((i) => i.status !== "proposed");

  const wrap: React.CSSProperties = { background: INK, color: TEXT, minHeight: "100vh", padding: "34px 22px 90px", fontFamily: "'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif" };
  const shell: React.CSSProperties = { maxWidth: 860, margin: "0 auto" };
  const btn: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, borderRadius: 7, padding: "7px 13px", cursor: "pointer", border: `1px solid ${LINE}`, background: "#17171b", color: TEXT, marginRight: 8, marginTop: 8 };

  return (
    <div style={wrap}><div style={shell}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 2, color: DIM, textTransform: "uppercase" }}>CCOS</div>
          <h1 style={{ fontSize: 28, margin: "4px 0 2px", fontWeight: 800 }}>CMO Agent</h1>
          <div style={{ color: DIM, fontSize: 13.5 }}>Your marketing moves for {date || "today"}. Comment + pick a button — your call gets logged, then a Claude session executes it. Nothing fires on its own.</div>
        </div>
        <button onClick={runToday} disabled={running} style={{ ...btn, background: GOLD, color: "#111", borderColor: GOLD, marginTop: 0 }}>
          {running ? "Thinking…" : "↻ Run today's brief"}
        </button>
      </div>

      {loading ? (
        <p style={{ color: DIM, marginTop: 30 }}>Loading…</p>
      ) : open.length === 0 && done.length === 0 ? (
        <div style={{ marginTop: 30, background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 22, color: DIM }}>
          No brief yet for today. Hit <b style={{ color: GOLD }}>Run today's brief</b> to have the agent read the numbers and propose your moves.
        </div>
      ) : (
        <>
          <div style={{ marginTop: 22, color: DIM, fontSize: 12.5, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>
            {open.length} to decide
          </div>
          {open.map((i) => {
            const k = KIND[i.kind] ?? { label: i.kind.toUpperCase(), color: DIM, bg: "#1c1c20" };
            const ev = i.evidence || {};
            return (
              <div key={i.id} style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: "16px 18px", marginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 7 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 9px", borderRadius: 999, background: k.bg, color: k.color }}>{k.label}</span>
                  <span style={{ fontSize: 11, color: GOLD, textTransform: "uppercase", letterSpacing: 1 }}>{i.creator}</span>
                  <b style={{ fontSize: 15.5 }}>{i.title}</b>
                </div>
                {i.detail && <div style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 10 }}>{i.detail}</div>}
                <Proof ev={ev} />
                {i.rule && <div style={{ fontSize: 11.5, color: DIM, fontStyle: "italic", margin: "10px 0 0" }}>rule: {i.rule}</div>}

                <textarea
                  value={drafts[i.id] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [i.id]: e.target.value }))}
                  placeholder={i.suggestion ? `Suggested: ${i.suggestion}  —  or say what you actually want…` : "Your call — say what you want the agent to do…"}
                  style={{ width: "100%", minHeight: 46, background: "#0d0d10", border: `1px solid ${LINE}`, borderRadius: 8, color: TEXT, padding: "9px 11px", fontSize: 13.5, fontFamily: "inherit", resize: "vertical" }}
                />
                <div>
                  <button onClick={() => direct(i.id, "approve")} style={{ ...btn, background: "#14311f", borderColor: "#2e6b4a", color: "#8ce0ab" }}>✓ Do it as suggested</button>
                  <button onClick={() => direct(i.id, "adjust")} style={btn}>✎ Do this instead (see my note)</button>
                  <button onClick={() => direct(i.id, "hold")} style={btn}>⏸ Hold</button>
                  <button onClick={() => direct(i.id, "dismiss")} style={{ ...btn, color: DIM }}>✕ Dismiss</button>
                </div>
              </div>
            );
          })}

          {done.length > 0 && (
            <>
              <div style={{ marginTop: 30, color: DIM, fontSize: 12.5, letterSpacing: 1, textTransform: "uppercase", fontWeight: 700 }}>
                {done.length} decided
              </div>
              {done.map((i) => (
                <div key={i.id} style={{ background: "#0d0d10", border: `1px solid ${LINE}`, borderRadius: 10, padding: "12px 15px", marginTop: 10, opacity: 0.85 }}>
                  <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: GOLD, textTransform: "uppercase" }}>{i.creator}</span>
                    <b style={{ fontSize: 14 }}>{i.title}</b>
                    <span style={{ fontSize: 11, fontWeight: 700, color: i.status === "dismissed" ? DIM : "#8ce0ab" }}>
                      → {i.alex_directive || i.status}
                    </span>
                    <button onClick={() => direct(i.id, "reopen")} style={{ background: "none", border: "none", color: DIM, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>reopen</button>
                  </div>
                  {i.alex_comment && <div style={{ fontSize: 13, color: TEXT, marginTop: 5 }}>“{i.alex_comment}”</div>}
                </div>
              ))}
            </>
          )}
        </>
      )}

      <p style={{ marginTop: 34, color: DIM, fontSize: 12, fontFamily: "ui-monospace, monospace", borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
        Money numbers come from the canonical Ads attribution. The agent proposes; you decide; a CMO Agent session executes your logged directives.
      </p>
    </div></div>
  );
}
