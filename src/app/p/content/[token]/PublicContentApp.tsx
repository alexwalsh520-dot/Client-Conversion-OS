"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, LayoutGrid, TrendingUp, Sparkles, Users, Clapperboard } from "lucide-react";
import MyContentView, { type StudioPost } from "@/components/content/MyContentView";
import TrendsView from "@/components/content/TrendsView";
import CoachStudioView from "@/components/content/CoachStudioView";
import BuyerIdeasView, { type BuyerIdeaSet } from "@/components/content/BuyerIdeasView";
import IcpIdeasView, { type TrendBriefView } from "@/components/content/IcpIdeasView";
import type { VideoIdea } from "@/components/content/VideoIdeaCard";
import type { DateRange } from "@/components/content/CalendarRange";

type Studio = {
  creator: string;
  icp: Record<string, unknown> | null;
  posts: StudioPost[];
  snapshots: { date: string; followers: number }[];
  angles: { title: string; hook: string | null; rationale: string | null }[];
  dossiers: { name: string; keyword?: string | null; research: Record<string, unknown> }[];
  buyerIdeas: BuyerIdeaSet[];
  icpIdeas: VideoIdea[];
  trendBrief: TrendBriefView | null;
  voc: Record<string, string[]>;
  scoreboard: { streak: number; avg30: number | null; prevAvg30: number | null; best: number | null; onTargetMonth: number; totalScored: number; totalPosts: number };
};

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 89 * 86_400_000);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: f(from), to: f(to) };
}

export default function PublicContentApp({ token, name }: { token: string; name: string }) {
  const [page, setPage] = useState<"content" | "trends" | "buyers" | "playbook" | "coach">("content");
  const [data, setData] = useState<Studio | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(defaultRange);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await fetch(`/api/content/studio?token=${token}`, { cache: "no-store" }); setData(await res.json()); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  const tabs = [["content", "My Content", LayoutGrid], ["trends", "Trends", TrendingUp], ["buyers", "Buyers", Users], ["playbook", "Playbook", Clapperboard], ["coach", "Coach", Sparkles]] as const;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg, #09090b)", padding: "22px 18px 60px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent, #c9a96e)" }}>Content Studio</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary, #fff)", margin: "3px 0 0" }}>{name}</h1>
        </div>
        <div style={{ display: "inline-flex", gap: 4, background: "var(--bg-glass)", borderRadius: 12, padding: 4, border: "1px solid var(--border-primary)", marginBottom: 22 }}>
          {tabs.map(([k, label, Icon]) => (
            <button key={k} onClick={() => setPage(k)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 700, background: page === k ? "var(--bg-card)" : "transparent", color: page === k ? "var(--accent)" : "var(--text-muted)" }}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        {loading || !data ? (
          <div style={{ color: "var(--text-muted)", padding: 50, textAlign: "center" }}><Loader2 className="spin" /> Loading...</div>
        ) : page === "content" ? (
          <MyContentView data={{ posts: data.posts, scoreboard: data.scoreboard }} range={range} setRange={setRange} />
        ) : page === "trends" ? (
          <TrendsView posts={data.posts} snapshots={data.snapshots} range={range} />
        ) : page === "buyers" ? (
          <BuyerIdeasView buyers={data.buyerIdeas || []} />
        ) : page === "playbook" ? (
          <IcpIdeasView icp={data.icp} ideas={data.icpIdeas || []} trend={data.trendBrief} />
        ) : (
          <CoachStudioView data={{ icp: data.icp, angles: data.angles, dossiers: data.dossiers, voc: data.voc }} creator={data.creator} token={token} />
        )}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </main>
  );
}
