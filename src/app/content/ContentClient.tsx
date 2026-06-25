"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, RefreshCw, Share2, Loader2, Check, BarChart3, Sparkles, FileAudio } from "lucide-react";
import AnalyticsView from "@/components/content/AnalyticsView";
import CoachView from "@/components/content/CoachView";
import type { CreatorContent } from "@/lib/content-data";

const CREATORS = [{ slug: "tyson", name: "Tyson" }, { slug: "antwan", name: "Antwan" }];

export default function ContentClient() {
  const [data, setData] = useState<Record<string, CreatorContent>>({});
  const [active, setActive] = useState("antwan");
  const [mode, setMode] = useState<"analytics" | "coach">("analytics");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/content", { cache: "no-store" });
      const json = await res.json();
      const map: Record<string, CreatorContent> = {};
      for (const c of json.creators || []) map[c.creator] = c;
      setData(map);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 5000); };

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { flash(await fn()); await load(); }
    catch (e) { flash(`Error: ${e instanceof Error ? e.message : "failed"}`); }
    finally { setBusy(null); }
  };

  const ingest = () => run("ingest", async () => {
    const j = await (await fetch(`/api/content/ingest?creator=${active}`, { method: "POST" })).json();
    const r = (j.results || []).find((x: { creator: string }) => x.creator === active) || j.results?.[0];
    return r?.ok ? `Pulled ${r.pulled} posts for ${active}` : `Ingest: ${r?.error || j.error || "issue"}`;
  });
  const transcribe = () => run("transcribe", async () => {
    const j = await (await fetch(`/api/content/transcribe?creator=${active}`, { method: "POST" })).json();
    return j.reason === "no_key" ? j.message : j.ok ? `Transcribed ${j.transcribed} (failed ${j.failed}). ${j.note || ""}` : `Transcribe: ${j.error || "issue"}`;
  });
  const regenVoc = () => run("voc", async () => {
    const j = await (await fetch(`/api/content/mine?creator=${active}`, { method: "POST" })).json();
    if (!j.ok) return `Mine: ${j.error || "issue"}`;
    return `Mined ${j.mined} sources (+${j.quotes_added} quotes). ${j.remaining ? `${j.remaining} left — click again.` : "All calls + DMs mined."}`;
  });
  const shareLink = () => run("share", async () => {
    const j = await (await fetch(`/api/content/share-link?creator=${active}`)).json();
    if (j.url) { await navigator.clipboard.writeText(j.url).catch(() => {}); return `Public link copied: ${j.url}`; }
    return `Share: ${j.error || "issue"}`;
  });

  const actionBtn = (key: string, fn: () => void, Icon: typeof RefreshCw, label: string) => (
    <button onClick={fn} disabled={!!busy}
      style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "8px 13px", borderRadius: 10, border: "1px solid var(--border-hover)", background: "var(--bg-glass)", color: "var(--text-primary)", fontSize: 12.5, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy && busy !== key ? 0.45 : 1 }}>
      {busy === key ? <Loader2 size={14} className="spin" /> : <Icon size={14} />} {label}
    </button>
  );

  const current = data[active];

  return (
    <div style={{ padding: "26px 30px", maxWidth: 1320, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 4 }}>
        <Film size={23} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 25, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Content</h1>
      </div>
      <p style={{ color: "var(--text-muted)", margin: "0 0 20px", fontSize: 13.5 }}>
        Turn {current?.name || "the creator"}&apos;s content into a flywheel — see what performs, hear who&apos;s actually showing up, and shape new reels that pull in better buyers to retarget.
      </p>

      {/* Creator toggle + mode switch + actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "inline-flex", background: "var(--bg-glass)", borderRadius: 10, padding: 3, border: "1px solid var(--border-primary)" }}>
          {CREATORS.map((c) => (
            <button key={c.slug} onClick={() => setActive(c.slug)}
              style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: active === c.slug ? "var(--accent)" : "transparent", color: active === c.slug ? "#1a1a1a" : "var(--text-secondary)" }}>{c.name}</button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {mode === "analytics" && actionBtn("ingest", ingest, RefreshCw, "Pull latest posts")}
        {mode === "analytics" && actionBtn("transcribe", transcribe, FileAudio, "Transcribe reels")}
        {actionBtn("share", shareLink, Share2, "Share link")}
      </div>

      {/* Mode switch — the two surfaces */}
      <div style={{ display: "inline-flex", gap: 4, background: "var(--bg-glass)", borderRadius: 12, padding: 4, border: "1px solid var(--border-primary)", marginBottom: 22 }}>
        {([["analytics", "Analytics", BarChart3], ["coach", "Coach", Sparkles]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setMode(k)}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 20px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700, background: mode === k ? "var(--bg-card)" : "transparent", color: mode === k ? "var(--accent)" : "var(--text-muted)", boxShadow: mode === k ? "0 1px 0 var(--border-hover)" : "none" }}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {toast && (
        <div className="glass" style={{ marginBottom: 18, padding: "10px 14px", borderRadius: 10, background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--text-primary)", fontSize: 13, display: "flex", gap: 8, alignItems: "center", wordBreak: "break-all" }}>
          <Check size={15} style={{ color: "var(--accent)", flexShrink: 0 }} /> {toast}
        </div>
      )}

      {loading ? (
        <div style={{ color: "var(--text-muted)", padding: 50, textAlign: "center" }}><Loader2 className="spin" /> Loading…</div>
      ) : !current ? (
        <div style={{ color: "var(--text-muted)", padding: 40 }}>No data.</div>
      ) : mode === "analytics" ? (
        <AnalyticsView data={current} />
      ) : (
        <CoachView data={current} creator={active} onRegen={regenVoc} regenBusy={busy === "voc"} />
      )}

      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
