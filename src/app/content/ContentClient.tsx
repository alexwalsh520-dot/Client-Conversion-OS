"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, RefreshCw, Sparkles, Share2, Loader2, Check } from "lucide-react";
import ContentView from "@/components/content/ContentView";
import type { CreatorContent } from "@/lib/content-data";

const CREATORS = [
  { slug: "tyson", name: "Tyson" },
  { slug: "antwan", name: "Antwan" },
];

export default function ContentClient() {
  const [data, setData] = useState<Record<string, CreatorContent>>({});
  const [active, setActive] = useState("tyson");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/content", { cache: "no-store" });
      const json = await res.json();
      const map: Record<string, CreatorContent> = {};
      for (const c of json.creators || []) map[c.creator] = c;
      setData(map);
    } catch {
      /* surfaced via empty state */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  const ingest = async () => {
    setBusy("ingest");
    try {
      const res = await fetch(`/api/content/ingest?creator=${active}`, { method: "POST" });
      const j = await res.json();
      const r = (j.results || []).find((x: { creator: string }) => x.creator === active) || j.results?.[0];
      flash(r?.ok ? `Pulled ${r.pulled} posts for ${active}` : `Ingest issue: ${r?.error || j.error || "unknown"}`);
      await load();
    } catch (e) { flash(`Ingest failed: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };

  const generateIdeas = async () => {
    setBusy("ideas");
    try {
      const res = await fetch(`/api/content/ideas?creator=${active}`, { method: "POST" });
      const j = await res.json();
      flash(res.ok ? `Generated ${j.created} new ideas` : `Ideas: ${j.error || "failed"}`);
      await load();
    } catch (e) { flash(`Ideas failed: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };

  const shareLink = async () => {
    setBusy("share");
    try {
      const res = await fetch(`/api/content/share-link?creator=${active}`);
      const j = await res.json();
      if (j.url) { await navigator.clipboard.writeText(j.url).catch(() => {}); flash(`Public link copied: ${j.url}`); }
      else flash(`Share link: ${j.error || "failed"}`);
    } catch (e) { flash(`Share failed: ${e instanceof Error ? e.message : "error"}`); }
    finally { setBusy(null); }
  };

  const btn = (onClick: () => void, key: string, Icon: typeof RefreshCw, label: string) => (
    <button onClick={onClick} disabled={!!busy}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 14px", borderRadius: 10, border: "1px solid var(--border-hover)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 13, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy && busy !== key ? 0.5 : 1 }}>
      {busy === key ? <Loader2 size={15} className="spin" /> : <Icon size={15} />} {label}
    </button>
  );

  const current = data[active];

  return (
    <div style={{ padding: "28px 32px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <Film size={24} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Content</h1>
      </div>
      <p style={{ color: "var(--text-muted)", margin: "0 0 22px", fontSize: 14 }}>
        Tyson &amp; Antwan&apos;s content — what they post, what it says, and a buyer-driven idea bank. The upstream variable that feeds every funnel below it.
      </p>

      {/* Creator toggle + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
        <div style={{ display: "inline-flex", background: "var(--bg-glass)", borderRadius: 10, padding: 3, border: "1px solid var(--border-primary)" }}>
          {CREATORS.map((c) => (
            <button key={c.slug} onClick={() => setActive(c.slug)}
              style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 600,
                background: active === c.slug ? "var(--accent)" : "transparent", color: active === c.slug ? "#1a1a1a" : "var(--text-secondary)" }}>
              {c.name}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {btn(ingest, "ingest", RefreshCw, "Pull latest posts")}
        {btn(generateIdeas, "ideas", Sparkles, "Generate ideas")}
        {btn(shareLink, "share", Share2, "Share link")}
      </div>

      {toast && (
        <div className="glass" style={{ marginBottom: 18, padding: "10px 14px", borderRadius: 10, background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--text-primary)", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}>
          <Check size={15} style={{ color: "var(--accent)" }} /> {toast}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 40, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>
      ) : current ? (
        <ContentView data={current} />
      ) : (
        <div style={{ color: "var(--text-muted)", padding: 40 }}>No data.</div>
      )}

      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
