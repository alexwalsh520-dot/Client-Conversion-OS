"use client";

// Buyers — what everyone who paid sounds like, then the people themselves.
//
// The aggregate reads first: a synopsis, the sentences they keep saying, what hurts, what stops them.
// Below it every real buyer is one line; tap for the hooks built to pull in more like them, tap a hook
// for the recipe. The voice analysis also produces a "what they're NOT saying" read — useful to the
// team, noise to a creator holding a camera, so it isn't shown here.

import { useState } from "react";
import { CreatorIdeaCard, byTrendScoreDesc } from "./CreatorIdeaCard";
import type { BuyerIdeaSet } from "./BuyerIdeasView";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";
import { H, Section, Empty, INK, BODY, MUTED, RULE } from "./creator-ui";

type BuyerVoiceView = BuyerVoice & { buyer_count?: number | null };

function Buyer({ buyer }: { buyer: BuyerIdeaSet }) {
  const [open, setOpen] = useState(false);
  const r = buyer.research || {};
  const summary = typeof r.summary === "string" ? r.summary : "";
  const ideas = [...(buyer.ideas || [])].sort(byTrendScoreDesc);
  return (
    <li style={{ borderTop: `1px solid ${RULE}`, padding: "16px 0" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }}>
        <span style={{ fontSize: 17, color: INK, lineHeight: 1.5 }}>{buyer.name}</span>
        {summary && <span style={{ fontSize: 17, color: MUTED, lineHeight: 1.5 }}> — {summary}</span>}
      </div>
      {open && ideas.length > 0 && (
        <ul style={{ margin: "8px 0 0", padding: 0, listStyle: "none" }}>
          {ideas.map((idea, i) => <CreatorIdeaCard key={i} idea={idea} />)}
        </ul>
      )}
    </li>
  );
}

export default function CreatorBuyersView({ buyers, buyerVoice }: { buyers: BuyerIdeaSet[]; buyerVoice: BuyerVoiceView | null }) {
  const quotes = (buyerVoice?.saying || [])
    .map((s) => s?.example || s?.theme)
    .filter((q): q is string => Boolean(q))
    .slice(0, 4);
  const pains = (buyerVoice?.top_pains || []).filter((p) => p && p.pain).slice(0, 4);
  const objections = (buyerVoice?.top_objections || []).filter((o) => o && o.objection).slice(0, 3);

  return (
    <div>
      <Section first>
        {buyerVoice?.synopsis ? (
          <>
            <p style={{ fontSize: 21, color: INK, lineHeight: 1.5, margin: 0 }}>{buyerVoice.synopsis}</p>
            {buyerVoice.buyer_count ? (
              <p style={{ fontSize: 14, color: MUTED, margin: "12px 0 0" }}>from {buyerVoice.buyer_count} buyers</p>
            ) : null}
          </>
        ) : (
          <Empty />
        )}
      </Section>

      {quotes.length > 0 && (
        <Section>
          <H>What they say</H>
          <div style={{ display: "grid", gap: 16 }}>
            {quotes.map((q, i) => (
              <p key={i} style={{ fontSize: 17, color: INK, lineHeight: 1.6, margin: 0 }}>&ldquo;{q}&rdquo;</p>
            ))}
          </div>
        </Section>
      )}

      {pains.length > 0 && (
        <Section>
          <H>Pains</H>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {pains.map((p, i) => (
              <li key={i} style={{ fontSize: 16, color: BODY, lineHeight: 1.55 }}>
                {p.pain}
                {p.how_common && <span style={{ color: MUTED }}> — {p.how_common}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {objections.length > 0 && (
        <Section>
          <H>Objections</H>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {objections.map((o, i) => (
              <li key={i} style={{ fontSize: 16, color: BODY, lineHeight: 1.55 }}>
                {o.objection}
                {o.how_common && <span style={{ color: MUTED }}> — {o.how_common}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section>
        <H>The buyers</H>
        {buyers.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {buyers.map((b, i) => <Buyer key={i} buyer={b} />)}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>
    </div>
  );
}
