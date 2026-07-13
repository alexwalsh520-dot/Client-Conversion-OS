"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Film, Loader2, LayoutGrid, TrendingUp, Sparkles, Settings, Users, Clapperboard } from "lucide-react";
import MyContentView, { type StudioPost } from "@/components/content/MyContentView";
import TrendsView from "@/components/content/TrendsView";
import CoachStudioView from "@/components/content/CoachStudioView";
import BuyerIdeasView, { type BuyerIdeaSet } from "@/components/content/BuyerIdeasView";
import { type TrendBriefView } from "@/components/content/IcpIdeasView";
import PlaybookView from "@/components/content/PlaybookView";
import type { VideoIdea } from "@/components/content/VideoIdeaCard";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook } from "@/lib/buyer-dna/playbook";
import ShareSettings from "@/components/content/ShareSettings";
import type { DateRange } from "@/components/content/CalendarRange";

const CREATORS = [{ slug: "tyson", name: "Tyson" }, { slug: "antwan", name: "Antwan" }];

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
  shiftBrief: ShiftBrief | null;
  playbook: Playbook | null;
  voc: Record<string, string[]>;
  scoreboard: { streak: number; avg30: number | null; prevAvg30: number | null; best: number | null; onTargetMonth: number; totalScored: number; totalPosts: number };
};

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 89 * 86_400_000);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: f(from), to: f(to) };
}

export default function ContentClient() {
  const [active, setActive] = useState("tyson");
  const [page, setPage] = useState<"content" | "trends" | "buyers" | "playbook" | "coach">("content");
  const [data, setData] = useState<Studio | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async (creator: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/studio?creator=${creator}`, { cache: "no-store" });
      setData(await res.json());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(active); }, [active, load]);

  const tabs = useMemo(() => ([
    ["content", "My Content", LayoutGrid],
    ["trends", "Trends", TrendingUp],
    ["buyers", "Buyers", Users],
    ["playbook", "Playbook", Clapperboard],
    ["coach", "Coach", Sparkles],
  ] as const), []);

  return (
    <div style={{ padding: "26px 30px", maxWidth: 1120, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 4 }}>
        <Film size={23} style={{ color: "var(--accent)" }} />
        <h1 style={{ fontSize: 25, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>Content</h1>
        <span style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", background: "var(--bg-glass)", borderRadius: 10, padding: 3, border: "1px solid var(--border-primary)" }}>
          {CREATORS.map((c) => (
            <button key={c.slug} onClick={() => setActive(c.slug)} style={{ padding: "7px 16px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, background: active === c.slug ? "var(--accent)" : "transparent", color: active === c.slug ? "#1a1a1a" : "var(--text-secondary)" }}>{c.name}</button>
          ))}
        </div>
        <button onClick={() => setSettingsOpen(true)} title="Share links" style={{ width: 38, height: 38, borderRadius: 10, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", color: "var(--text-secondary)", cursor: "pointer", display: "grid", placeItems: "center" }}><Settings size={17} /></button>
      </div>
      <p style={{ color: "var(--text-muted)", margin: "0 0 20px", fontSize: 13.5 }}>See which content pulls the people who actually buy, and make more of it.</p>

      <div style={{ display: "inline-flex", gap: 4, background: "var(--bg-glass)", borderRadius: 12, padding: 4, border: "1px solid var(--border-primary)", marginBottom: 22 }}>
        {tabs.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setPage(k)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 18px", borderRadius: 9, border: "none", cursor: "pointer", fontSize: 13.5, fontWeight: 700, background: page === k ? "var(--bg-card)" : "transparent", color: page === k ? "var(--accent)" : "var(--text-muted)" }}>
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
        <PlaybookView shiftBrief={data.shiftBrief} playbook={data.playbook} />
      ) : (
        <CoachStudioView data={{ icp: data.icp, angles: data.angles, dossiers: data.dossiers, voc: data.voc }} creator={active} />
      )}

      {settingsOpen && <ShareSettings creators={CREATORS} onClose={() => setSettingsOpen(false)} />}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
