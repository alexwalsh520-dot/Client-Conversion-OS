"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, LayoutGrid, Users, Clapperboard } from "lucide-react";
import MyContentView, { type StudioPost } from "@/components/content/MyContentView";
import PlaybookView from "@/components/content/PlaybookView";
import CreatorBuyersView from "@/components/content/CreatorBuyersView";
import type { BuyerIdeaSet } from "@/components/content/BuyerIdeasView";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook } from "@/lib/buyer-dna/playbook";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";
import type { DateRange } from "@/components/content/CalendarRange";

type Studio = {
  creator: string;
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

  const tabs = [["playbook", "Playbook", Clapperboard], ["buyers", "Buyers", Users], ["content", "My Content", LayoutGrid]] as const;

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg, #f6f6f4)", padding: "22px 18px 60px" }}>
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--accent, #a9823f)" }}>Content Studio</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary, #18181b)", margin: "3px 0 0" }}>{name}</h1>
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
        ) : page === "playbook" ? (
          <PlaybookView shiftBrief={data.shiftBrief} playbook={data.playbook} />
        ) : page === "buyers" ? (
          <CreatorBuyersView buyers={data.buyerIdeas || []} buyerVoice={data.buyerVoice} />
        ) : (
          <MyContentView data={{ posts: data.posts, scoreboard: data.scoreboard }} range={range} setRange={setRange} />
        )}
      </div>
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </main>
  );
}
