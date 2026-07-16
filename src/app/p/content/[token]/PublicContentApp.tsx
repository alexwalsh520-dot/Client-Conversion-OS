"use client";

import { useCallback, useEffect, useState } from "react";
import MyContentView, { type StudioPost } from "@/components/content/MyContentView";
import PlaybookView from "@/components/content/PlaybookView";
import CreatorBuyersView from "@/components/content/CreatorBuyersView";
import type { BuyerIdeaSet } from "@/components/content/BuyerIdeasView";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook } from "@/lib/buyer-dna/playbook";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";
import type { DateRange } from "@/components/content/CalendarRange";
import { Column, PAPER, INK, MUTED, RULE } from "@/components/content/creator-ui";

type Studio = {
  creator: string;
  icp: { one_line?: string | null } | null;
  posts: StudioPost[];
  buyerIdeas: BuyerIdeaSet[];
  buyerVoice: (BuyerVoice & { buyer_count?: number | null }) | null;
  shiftBrief: ShiftBrief | null;
  playbook: Playbook | null;
  scoreboard: { streak: number; avg30: number | null; prevAvg30: number | null; best: number | null; onTargetMonth: number; totalScored: number; totalPosts: number };
};

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date(to.getTime() - 89 * 86_400_000);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: f(from), to: f(to) };
}

export default function PublicContentApp({ token, name }: { token: string; name: string }) {
  const [page, setPage] = useState<"playbook" | "buyers" | "content">("playbook");
  const [data, setData] = useState<Studio | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>(defaultRange);

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

  const tabs = [["playbook", "Playbook"], ["buyers", "Buyers"], ["content", "My Content"]] as const;

  return (
    <main style={{ minHeight: "100vh", background: PAPER, padding: "40px 22px 100px" }}>
      <Column>
        <h1 style={{ fontSize: 17, fontWeight: 500, color: INK, margin: 0 }}>{name}</h1>

        <nav style={{ display: "flex", gap: 22, margin: "26px 0 0", paddingBottom: 22, borderBottom: `1px solid ${RULE}` }}>
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setPage(k)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 15, fontFamily: "inherit", color: page === k ? INK : MUTED, fontWeight: page === k ? 500 : 400 }}
            >
              {label}
            </button>
          ))}
        </nav>

        <div style={{ paddingTop: 44 }}>
          {loading || !data ? (
            <p style={{ color: MUTED, fontSize: 16, margin: 0 }}>Loading…</p>
          ) : page === "playbook" ? (
            <PlaybookView shiftBrief={data.shiftBrief} playbook={data.playbook} buyerLine={data.icp?.one_line} />
          ) : page === "buyers" ? (
            <CreatorBuyersView buyers={data.buyerIdeas || []} buyerVoice={data.buyerVoice} />
          ) : (
            <MyContentView data={{ posts: data.posts, scoreboard: data.scoreboard }} range={range} setRange={setRange} />
          )}
        </div>
      </Column>
    </main>
  );
}
