"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudioPost } from "@/components/content/MyContentView";
import PlaybookView from "@/components/content/PlaybookView";
import CreatorBuyersView from "@/components/content/CreatorBuyersView";
import CalendarView from "@/components/content/CalendarView";
import CarouselsView from "@/components/content/CarouselsView";
import type { BuyerIdeaSet } from "@/components/content/BuyerIdeasView";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook } from "@/lib/buyer-dna/playbook";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";
import { Column, PAPER, MUTED, PageHeader, Tabs } from "@/components/content/creator-ui";

type Studio = {
  creator: string;
  icp: {
    one_line?: string | null;
    top_pains?: string[];
    desires?: string[];
    triggers?: string[];
    language?: string[];
    disqualifiers?: string[];
  } | null;
  posts: StudioPost[];
  buyerIdeas: BuyerIdeaSet[];
  buyerVoice: (BuyerVoice & { buyer_count?: number | null }) | null;
  shiftBrief: ShiftBrief | null;
  playbook: Playbook | null;
  scoreboard: { streak: number; avg30: number | null; prevAvg30: number | null; best: number | null; onTargetMonth: number; totalScored: number; totalPosts: number };
};

export default function PublicContentApp({ token, name }: { token: string; name: string }) {
  const [page, setPage] = useState<"playbook" | "buyers" | "calendar" | "carousels">("calendar");
  const [data, setData] = useState<Studio | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await fetch(`/api/content/studio?token=${token}`, { cache: "no-store" }); setData(await res.json()); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { load(); }, [load]);

  // Force light theme on this creator page (belt-and-suspenders alongside the pre-paint script in
  // page.tsx). Only sets the class; never writes localStorage, so the operator app is unaffected.
  useEffect(() => {
    const c = document.documentElement.classList;
    c.remove("dark");
    c.add("light");
  }, []);

  const tabs = [["calendar", "Calendar"], ["carousels", "Carousels"], ["playbook", "Playbook"], ["buyers", "Buyers"]] as const;

  return (
    <main style={{ minHeight: "100vh", background: PAPER, padding: "32px 18px 100px" }}>
      <Column>
        <PageHeader title={name} />
        <Tabs tabs={tabs} active={page} onPick={setPage} />

        {loading || !data ? (
          <p style={{ color: MUTED, fontSize: 16, margin: 0 }}>Loading…</p>
        ) : page === "carousels" ? (
          // Read + use, not manage: the same swipe-through viewer and the same downloads the operator
          // has, with no editor and no generate. The token decides whose carousels these are.
          <CarouselsView creator={data.creator} mode="creator" token={token} />
        ) : page === "playbook" ? (
          <PlaybookView shiftBrief={data.shiftBrief} playbook={data.playbook} buyerLine={data.icp?.one_line} icp={data.icp} buyerVoice={data.buyerVoice} />
        ) : page === "buyers" ? (
          <CreatorBuyersView buyers={data.buyerIdeas || []} buyerVoice={data.buyerVoice} />
        ) : (
          // The creator's own checklist. The token decides whose calendar this is — the component
          // never sends a creator key, so this page can only ever read/write its own.
          <CalendarView creator={data.creator} mode="creator" token={token} />
        )}
      </Column>
    </main>
  );
}
