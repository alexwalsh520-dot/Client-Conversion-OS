"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Copy, ExternalLink, RotateCw, Check, Loader2 } from "lucide-react";

type Link = { token: string; url: string } | null;

export default function ShareSettings({ creators, onClose }: { creators: { slug: string; name: string }[]; onClose: () => void }) {
  const [links, setLinks] = useState<Record<string, Link>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch("/api/content/share-manage", { cache: "no-store" }); const j = await r.json(); setLinks(j.links || {}); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (creator: string, action: "mint" | "rotate" | "revoke") => {
    setBusy(creator);
    try {
      const r = await fetch("/api/content/share-manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, creator }) });
      const j = await r.json();
      setLinks((prev) => ({ ...prev, [creator]: j.link ?? null }));
    } finally { setBusy(null); }
  };

  const copy = (creator: string, url: string) => { navigator.clipboard.writeText(url).catch(() => {}); setCopied(creator); setTimeout(() => setCopied(null), 1600); };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(0,0,0,.6)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "8vh 16px", overflowY: "auto" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 520, background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 22 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>Creator access links</div>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "var(--bg-glass)", color: "var(--text-muted)", cursor: "pointer", display: "grid", placeItems: "center" }}><X size={16} /></button>
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 18px", lineHeight: 1.6 }}>Send each creator their link. It opens the full app on their phone, no login, no CCOS sidebar. Rotate a link any time to kill the old one.</p>

        {loading ? (
          <div style={{ color: "var(--text-muted)", padding: 24, textAlign: "center" }}><Loader2 size={16} className="spin" /></div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {creators.map((c) => {
              const link = links[c.slug];
              return (
                <div key={c.slug} style={{ border: "1px solid var(--border-primary)", borderRadius: 12, padding: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{c.name}</div>
                    <span style={{ flex: 1 }} />
                    {link && <span style={{ fontSize: 11, color: "#8ce0ab" }}>live</span>}
                  </div>
                  {link ? (
                    <>
                      <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} style={{ width: "100%", background: "var(--bg-glass)", border: "1px solid var(--border-primary)", borderRadius: 8, padding: "9px 11px", color: "var(--text-secondary)", fontSize: 12, fontFamily: "monospace", marginBottom: 10 }} />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button onClick={() => copy(c.slug, link.url)} style={btn(true)}>{copied === c.slug ? <Check size={13} /> : <Copy size={13} />} {copied === c.slug ? "Copied" : "Copy"}</button>
                        <a href={link.url} target="_blank" rel="noreferrer" style={{ ...btn(false), textDecoration: "none" }}><ExternalLink size={13} /> Open</a>
                        <button onClick={() => act(c.slug, "rotate")} disabled={busy === c.slug} style={btn(false)}>{busy === c.slug ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />} Rotate</button>
                        <button onClick={() => act(c.slug, "revoke")} disabled={busy === c.slug} style={{ ...btn(false), color: "#e0794d" }}>Revoke</button>
                      </div>
                    </>
                  ) : (
                    <button onClick={() => act(c.slug, "mint")} disabled={busy === c.slug} style={btn(true)}>{busy === c.slug ? <Loader2 size={13} className="spin" /> : null} Create link</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return { display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 8, border: primary ? "none" : "1px solid var(--border-primary)", background: primary ? "var(--accent)" : "var(--bg-glass)", color: primary ? "#1a1a1a" : "var(--text-secondary)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" };
}
