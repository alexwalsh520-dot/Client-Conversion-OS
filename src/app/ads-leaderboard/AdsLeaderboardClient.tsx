"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Trophy, Plus, Copy, Check, Link2, ExternalLink, Eye } from "lucide-react";

interface AdMetrics {
  spend: number;
  spendToday: number;
  impressions: number;
  linkClicks: number;
  revenue: number | null;
  roas: number | null;
  lastDate: string | null;
  budget: string | null;
}

interface Entry {
  id: string;
  token: string;
  client_id: number | null;
  client_name: string | null;
  creator_key: string | null;
  contestant_name: string | null;
  contestant_email: string | null;
  status: string;
  step: number;
  intake: Record<string, string>;
  script: string | null;
  video_url: string | null;
  submitted_at: string | null;
  ad_id: string | null;
  ad_account_id: string | null;
  metrics: AdMetrics | null;
}

const CREATORS = ["tyson", "lucy", "keith", "antwan"];

const STATUS_LABEL: Record<string, string> = {
  draft: "Started",
  intake_done: "Answered questions",
  script_ready: "Has script",
  recording: "Recording",
  submitted: "Submitted",
  live: "Live",
};

const fmtMoney = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(n < 100 ? 2 : 0)}`;

export default function AdsLeaderboardClient() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ads-leaderboard/entries");
      const data = await res.json();
      if (res.ok) setEntries(data.entries || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createInvite = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/ads-leaderboard/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        await navigator.clipboard?.writeText(data.url).catch(() => {});
        await load();
      }
    } finally {
      setCreating(false);
    }
  }, [load]);

  // Leaderboard = launched ads with metrics, ranked by ROAS then spend.
  const ranked = useMemo(() => {
    return entries
      .filter((e) => e.metrics && (e.metrics.spend > 0 || e.video_url))
      .filter((e) => e.ad_id)
      .sort((a, b) => {
        const ar = a.metrics?.roas ?? -1;
        const br = b.metrics?.roas ?? -1;
        if (br !== ar) return br - ar;
        return (b.metrics?.spend ?? 0) - (a.metrics?.spend ?? 0);
      });
  }, [entries]);

  const submissions = useMemo(
    () => entries.filter((e) => e.status === "submitted" || e.status === "live"),
    [entries],
  );
  const inProgress = useMemo(
    () => entries.filter((e) => !["submitted", "live"].includes(e.status)),
    [entries],
  );

  const totalSpend = ranked.reduce((s, e) => s + (e.metrics?.spend ?? 0), 0);
  const totalRevenue = ranked.reduce((s, e) => s + (e.metrics?.revenue ?? 0), 0);
  const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Trophy size={24} style={{ color: "var(--accent)" }} /> Ads Leaderboard
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "6px 0 0", maxWidth: 560, lineHeight: 1.55 }}>
            Clients turn their coaching story into a video ad. We script it, launch it, and put real budget behind it —
            winners earn commission (up to $10k/mo). Create an invite link and send it to a client to start.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="/ads-leaderboard/board" target="_blank" rel="noopener noreferrer"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 16px", borderRadius: 10, border: "1px solid var(--border-primary)", background: "transparent", color: "var(--text-secondary)", fontWeight: 600, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap", textDecoration: "none" }}>
            <Eye size={16} /> Public leaderboard
          </a>
          <button onClick={createInvite} disabled={creating}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "11px 16px", borderRadius: 10, border: "none", background: "var(--accent)", color: "#1a1205", fontWeight: 700, fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" }}>
            <Plus size={16} /> {creating ? "Creating…" : "New invite link"}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginBottom: 28 }}>
        <Stat label="Live contest ads" value={String(ranked.length)} />
        <Stat label="Submissions" value={String(submissions.length)} />
        <Stat label="In progress" value={String(inProgress.length)} />
        <Stat label="Contest ad spend" value={fmtMoney(totalSpend)} />
        <Stat label="Blended ROAS" value={blendedRoas != null ? `${blendedRoas.toFixed(1)}x` : "—"} accent />
      </div>

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Loading…</p>
      ) : (
        <>
          {/* Leaderboard */}
          <SectionTitle>🏆 Leaderboard</SectionTitle>
          {ranked.length === 0 ? (
            <EmptyCard>
              No live contest ads yet. Once a submitted ad is launched on Meta and linked below, it appears here with
              its budget, spend, and ROAS — ranked best-first.
            </EmptyCard>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, marginBottom: 36 }}>
              {ranked.map((e, i) => (
                <LeaderCard key={e.id} entry={e} rank={i + 1} />
              ))}
            </div>
          )}

          {/* Submissions awaiting launch / linkage */}
          <SectionTitle>📥 Submissions</SectionTitle>
          {submissions.length === 0 ? (
            <EmptyCard>No submissions yet. Send an invite link to a client to get the first one in.</EmptyCard>
          ) : (
            <div style={{ display: "grid", gap: 12, marginBottom: 36 }}>
              {submissions.map((e) => (
                <SubmissionRow key={e.id} entry={e} onSaved={load} />
              ))}
            </div>
          )}

          {/* In-progress entries */}
          <SectionTitle>✍️ In progress</SectionTitle>
          {inProgress.length === 0 ? (
            <EmptyCard>No one is mid-flow right now.</EmptyCard>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {inProgress.map((e) => (
                <InProgressRow key={e.id} entry={e} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Leaderboard card ─────────────────────────────────────────────────────────
function LeaderCard({ entry, rank }: { entry: Entry; rank: number }) {
  const m = entry.metrics!;
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
  const who = entry.contestant_name || entry.client_name || "Contestant";
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "relative", aspectRatio: "9 / 12", background: "#000" }}>
        {entry.video_url ? (
          <video src={entry.video_url} controls playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 13 }}>No video</div>
        )}
        <div style={{ position: "absolute", top: 10, left: 10, fontSize: 22, filter: "drop-shadow(0 1px 2px rgba(0,0,0,.6))" }}>{medal}</div>
      </div>
      <div style={{ padding: "14px 14px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
          <strong style={{ fontSize: 15, color: "var(--text-primary)" }}>{who}</strong>
          {entry.creator_key && <CreatorBadge k={entry.creator_key} />}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Metric label="ROAS" value={m.roas != null ? `${m.roas.toFixed(1)}x` : "—"} highlight={m.roas != null && m.roas >= 3} />
          <Metric label="Budget / day" value={m.budget || "—"} />
          <Metric label="Spent today" value={m.spendToday > 0 ? fmtMoney(m.spendToday) : "—"} />
          <Metric label="Total spent" value={fmtMoney(m.spend)} />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: highlight ? "var(--success)" : "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

// ── Submission row (with link-to-live-ad form) ───────────────────────────────
function SubmissionRow({ entry, onSaved }: { entry: Entry; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [adId, setAdId] = useState(entry.ad_id || "");
  const [acct, setAcct] = useState(entry.ad_account_id || "");
  const [creator, setCreator] = useState(entry.creator_key || "");
  const [saving, setSaving] = useState(false);
  const who = entry.contestant_name || entry.client_name || "Contestant";

  const save = async () => {
    setSaving(true);
    try {
      await fetch("/api/ads-leaderboard/entries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id, ad_id: adId, ad_account_id: acct, creator_key: creator, status: adId ? "live" : "submitted" }),
      });
      setOpen(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {entry.video_url && (
          <video src={entry.video_url} muted playsInline preload="metadata" style={{ width: 54, height: 72, objectFit: "cover", borderRadius: 8, background: "#000", flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <strong style={{ fontSize: 14.5, color: "var(--text-primary)" }}>{who}</strong>
            {entry.creator_key && <CreatorBadge k={entry.creator_key} />}
            {entry.ad_id ? (
              <span style={{ fontSize: 11, color: "var(--success)", background: "var(--success-soft)", padding: "2px 8px", borderRadius: 99 }}>Linked & live</span>
            ) : (
              <span style={{ fontSize: 11, color: "var(--warning)", background: "var(--warning-soft)", padding: "2px 8px", borderRadius: 99 }}>Needs launch</span>
            )}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
            {entry.intake?.niche || "—"}{entry.intake?.keyword ? ` · DM "${entry.intake.keyword}"` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {entry.video_url && (
            <a href={entry.video_url} target="_blank" rel="noopener noreferrer" style={iconBtn}><ExternalLink size={15} /></a>
          )}
          <button onClick={() => setOpen((o) => !o)} style={{ ...iconBtn, display: "inline-flex", alignItems: "center", gap: 6, width: "auto", padding: "0 12px", fontSize: 13 }}>
            <Link2 size={14} /> {entry.ad_id ? "Edit link" : "Link live ad"}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-primary)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <SmallField label="Meta ad_id">
            <input value={adId} onChange={(e) => setAdId(e.target.value)} placeholder="e.g. 120210..." style={smallInput} />
          </SmallField>
          <SmallField label="Ad account id">
            <input value={acct} onChange={(e) => setAcct(e.target.value)} placeholder="act_..." style={smallInput} />
          </SmallField>
          <SmallField label="Creator">
            <select value={creator} onChange={(e) => setCreator(e.target.value)} style={smallInput}>
              <option value="">—</option>
              {CREATORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </SmallField>
          <button onClick={save} disabled={saving} style={{ padding: "9px 16px", borderRadius: 9, border: "none", background: "var(--accent)", color: "#1a1205", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

function InProgressRow({ entry }: { entry: Entry }) {
  const who = entry.contestant_name || entry.client_name || "Unnamed contestant";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--bg-glass)", border: "1px solid var(--border-primary)", borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>{who}</strong>
        <span style={{ fontSize: 12.5, color: "var(--text-muted)", marginLeft: 8 }}>{STATUS_LABEL[entry.status] || entry.status}</span>
      </div>
      <CopyLinkButton token={entry.token} />
    </div>
  );
}

function CopyLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = `${window.location.origin}/ads-leaderboard/compete/${token}`;
    await navigator.clipboard?.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button onClick={copy} style={{ ...iconBtn, display: "inline-flex", alignItems: "center", gap: 6, width: "auto", padding: "0 12px", fontSize: 12.5, flexShrink: 0 }}>
      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy link"}
    </button>
  );
}

// ── Small shared bits ────────────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: accent ? "var(--accent)" : "var(--text-primary)" }}>{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-secondary)", margin: "0 0 14px" }}>{children}</h2>;
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--bg-glass)", border: "1px dashed var(--border-primary)", borderRadius: 12, padding: "18px 20px", color: "var(--text-muted)", fontSize: 13.5, lineHeight: 1.6, marginBottom: 36 }}>
      {children}
    </div>
  );
}

function CreatorBadge({ k }: { k: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "var(--accent-soft)", padding: "2px 8px", borderRadius: 99, textTransform: "capitalize" }}>{k}</span>
  );
}

function SmallField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 9,
  border: "1px solid var(--border-primary)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  textDecoration: "none",
};

const smallInput: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid var(--border-primary)",
  background: "var(--bg-secondary)",
  color: "var(--text-primary)",
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
