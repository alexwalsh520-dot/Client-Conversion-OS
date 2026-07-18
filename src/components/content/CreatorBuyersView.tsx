"use client";

// Buyers — what everyone who paid sounds like, then the people themselves.
//
// The aggregate reads first: a synopsis, the sentences they keep saying, what hurts, what stops them,
// and the telling absence — what you'd expect this buyer to talk about but which barely comes up.
// Below it every real buyer is one line; tap for the hooks built to pull in more like them, tap a hook
// for the recipe.

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { CreatorIdeaCard, byTrendScoreDesc } from "./CreatorIdeaCard";
import type { BuyerIdeaSet } from "./BuyerIdeasView";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";
import { H, Section, SubLabel, Empty, INK, BODY, MUTED, RULE, ACCENT } from "./creator-ui";

type BuyerVoiceView = BuyerVoice & { buyer_count?: number | null };

// One buyer. Collapsed it's a single line; a right-aligned count + chevron makes it obvious there's
// more to open. Opening reveals the content ideas built to reach more people like them — set off with
// an accent rule, an inset, and a header so the revealed block reads as this buyer's detail, not a
// second flat list bleeding into the next name.
function Buyer({ buyer }: { buyer: BuyerIdeaSet }) {
  const [open, setOpen] = useState(false);
  const r = buyer.research || {};
  const summary = typeof r.summary === "string" ? r.summary : "";
  const ideas = [...(buyer.ideas || [])].sort(byTrendScoreDesc);
  const expandable = ideas.length > 0;
  const first = buyer.name.split(" ")[0];
  return (
    <li style={{ borderTop: `1px solid ${RULE}` }}>
      <div
        onClick={() => expandable && setOpen((v) => !v)}
        style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 0", cursor: expandable ? "pointer" : "default" }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 17, color: INK, lineHeight: 1.5, fontWeight: 600 }}>{buyer.name}</span>
          {summary && <span style={{ fontSize: 17, color: MUTED, lineHeight: 1.5 }}> — {summary}</span>}
        </div>
        {expandable && (
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, fontSize: 12.5, fontWeight: 700, color: open ? ACCENT : MUTED, whiteSpace: "nowrap" }}>
            {ideas.length} {ideas.length === 1 ? "idea" : "ideas"}
            <ChevronDown size={15} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
          </span>
        )}
      </div>
      {open && expandable && (
        <div style={{ margin: "2px 0 18px", paddingLeft: 16, borderLeft: `2px solid ${ACCENT}` }}>
          <SubLabel>Ideas to reach more like {first}</SubLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {ideas.map((idea, i) => <CreatorIdeaCard key={i} idea={idea} />)}
          </ul>
        </div>
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
  const notSaying = (buyerVoice?.not_saying || []).filter((n) => n && n.absence);

  return (
    <div>
      <Section>
        <H>Your buyers</H>
        {buyerVoice?.synopsis ? (
          <>
            <p style={{ fontSize: 18, color: INK, lineHeight: 1.6, margin: 0 }}>{buyerVoice.synopsis}</p>
            {buyerVoice.buyer_count ? (
              <p style={{ fontSize: 13.5, color: MUTED, margin: "12px 0 0" }}>from {buyerVoice.buyer_count} buyers</p>
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

      {notSaying.length > 0 && (
        <Section>
          <H>What they&rsquo;re not saying</H>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 14 }}>
            {notSaying.map((n, i) => (
              <li key={i}>
                <div style={{ fontSize: 16, color: INK, lineHeight: 1.55 }}>{n.absence}</div>
                {n.meaning && <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.6, marginTop: 3 }}>{n.meaning}</div>}
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
