"use client";

import { useEffect, useState, useCallback, type CSSProperties } from "react";
import { CREATORS } from "@/lib/creators";

type OK = { id: number; client_key: string; keyword_normalized: string; keyword_display?: string; note?: string | null };

const selectStyle: CSSProperties = { background: "var(--bg-secondary)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text-primary)", fontSize: 13, fontFamily: "inherit" };
const inputStyle: CSSProperties = { ...selectStyle, flex: 1, minWidth: 160 };
const chipStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(201,169,110,.1)", border: "1px solid rgba(201,169,110,.3)", color: "#d8b673", borderRadius: 7, padding: "4px 6px 4px 10px", fontSize: 12.5, fontWeight: 600, letterSpacing: ".02em" };
const chipX: CSSProperties = { background: "transparent", border: "none", color: "#d8b673", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px", opacity: 0.7 };

export default function OrganicKeywordsPanel() {
  const [items, setItems] = useState<OK[]>([]);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<string>(CREATORS[0]?.key || "tyson");
  const [keyword, setKeyword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/organic-keywords", { cache: "no-store" });
      const d = await r.json();
      setItems(Array.isArray(d?.keywords) ? d.keywords : []);
    } catch {
      setError("Couldn't load organic keywords.");
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function add() {
    const kw = keyword.trim();
    if (!kw || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/organic-keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client, keyword: kw }) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error || "Couldn't add that keyword.");
      } else {
        setKeyword("");
        await load();
      }
    } catch {
      setError("Couldn't add that keyword.");
    }
    setBusy(false);
  }

  async function remove(id: number) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/organic-keywords", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d?.error || "Couldn't remove that keyword.");
      } else {
        await load();
      }
    } catch {
      setError("Couldn't remove that keyword.");
    }
    setBusy(false);
  }

  return (
    <div className="glass-static" style={{ padding: 20, marginBottom: 20, borderLeft: "3px solid var(--accent)" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>Organic keywords</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
        Words people DM that are <b>not</b> from an ad (e.g. Tyson&apos;s <b>LOCKED</b>, Lucy&apos;s <b>COACH</b>). The system auto-classifies these as organic so setters never have to attribute them by hand. An ad always wins while a paid ad with that word is live &mdash; a word only counts organic when no such ad is running.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={client} onChange={(e) => setClient(e.target.value)} style={selectStyle}>
          {CREATORS.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
        </select>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder="keyword (e.g. LOCKED)"
          style={inputStyle}
        />
        <button onClick={add} disabled={busy || !keyword.trim()} className="btn-secondary" style={{ whiteSpace: "nowrap" }}>Add</button>
      </div>
      {error && <div style={{ fontSize: 12, color: "#e06a6a", marginBottom: 10 }}>{error}</div>}
      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading&hellip;</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {CREATORS.map((c) => {
            const words = items.filter((i) => i.client_key === c.key);
            return (
              <div key={c.key}>
                <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".07em", color: "var(--text-muted)", marginBottom: 6 }}>{c.name}</div>
                {words.length === 0 ? (
                  <div style={{ fontSize: 12.5, color: "var(--text-muted)", opacity: 0.7 }}>No organic keywords yet.</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                    {words.map((w) => (
                      <span key={w.id} style={chipStyle}>
                        {w.keyword_display || w.keyword_normalized}
                        <button onClick={() => remove(w.id)} disabled={busy} style={chipX} aria-label="remove">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
