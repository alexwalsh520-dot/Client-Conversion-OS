"use client";

import { useCallback, useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { ACTIVE_CREATORS } from "@/lib/creators";
import type { StudioPost } from "@/components/content/MyContentView";
import CreatorBuyersView from "@/components/content/CreatorBuyersView";
import type { BuyerIdeaSet } from "@/components/content/BuyerIdeasView";
import PlaybookView from "@/components/content/PlaybookView";
import CarouselsView from "@/components/content/CarouselsView";
import CalendarView from "@/components/content/CalendarView";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook } from "@/lib/buyer-dna/playbook";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";
import ShareSettings from "@/components/content/ShareSettings";
import { Column, PAPER, INK, MUTED, PageHeader, Tabs } from "@/components/content/creator-ui";

const CREATORS = ACTIVE_CREATORS.map((c) => ({ slug: c.key, name: c.name }));

// The operator /content view is the creator view — identical components, same white content area — plus
// three operator-only pieces of chrome: the creator toggle, the share-settings gear, and a fourth
// "Carousels" tab the creators never see. Trends and Coach were removed from the operator surface (the
// component files stay in the tree, just unused). The studio payload is money-redacted for everyone now,
// so this shared screen is safe.
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

export default function ContentClient() {
  const [active, setActive] = useState("tyson");
  const [page, setPage] = useState<"playbook" | "buyers" | "carousels" | "calendar">("calendar");
  const [data, setData] = useState<Studio | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async (creator: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/content/studio?creator=${creator}`, { cache: "no-store" });
      setData(await res.json());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(active); }, [active, load]);

  const tabs = [["calendar", "Calendar"], ["carousels", "Carousels"], ["playbook", "Playbook"], ["buyers", "Buyers"]] as const;

  const toggleBtn = (activeState: boolean): React.CSSProperties => ({
    background: "none", border: "none", padding: "2px 0", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
    color: activeState ? INK : MUTED, fontWeight: activeState ? 500 : 400,
  });

  const creatorName = CREATORS.find((c) => c.slug === active)?.name || "";

  return (
    <main style={{ minHeight: "100vh", background: PAPER, padding: "32px 18px 100px" }}>
      <Column>
        <PageHeader
          title={creatorName}
          right={
            <div style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
              {/* operator-only: which creator */}
              {CREATORS.map((c) => (
                <button key={c.slug} onClick={() => setActive(c.slug)} style={toggleBtn(active === c.slug)}>{c.name}</button>
              ))}
              {/* operator-only: share links */}
              <button onClick={() => setSettingsOpen(true)} title="Share links" aria-label="Share links" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: MUTED, display: "grid", placeItems: "center" }}>
                <Settings size={17} />
              </button>
            </div>
          }
        />
        <Tabs tabs={tabs} active={page} onPick={setPage} />

        {/* Calendar loads its own data, so it renders without waiting on the studio payload. */}
        {page === "calendar" ? (
          <CalendarView creator={active} />
        ) : loading || !data ? (
          <p style={{ color: MUTED, fontSize: 16, margin: 0 }}>Loading…</p>
        ) : page === "playbook" ? (
          <PlaybookView shiftBrief={data.shiftBrief} playbook={data.playbook} buyerLine={data.icp?.one_line} icp={data.icp} buyerVoice={data.buyerVoice} />
        ) : page === "buyers" ? (
          <CreatorBuyersView buyers={data.buyerIdeas || []} buyerVoice={data.buyerVoice} />
        ) : (
          <CarouselsView creator={active} />
        )}
      </Column>

      {settingsOpen && (
        <div style={{ colorScheme: "light" }}>
          <ShareSettings creators={CREATORS} onClose={() => setSettingsOpen(false)} />
        </div>
      )}
      <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </main>
  );
}
