"use client";

// Creator Buyers: one card per real paying buyer — a two-line read on the person, then every hook
// built to attract more people like them, visible immediately (tap a hook for the full recipe).
// Hooks are the product here. No scores, no badges, no colored chips.

import { Users } from "lucide-react";
import { CreatorIdeaCard, byTrendScoreDesc } from "./CreatorIdeaCard";
import type { BuyerIdeaSet } from "./BuyerIdeasView";

function BuyerCard({ buyer }: { buyer: BuyerIdeaSet }) {
  const r = buyer.research || {};
  const summary = typeof r.summary === "string" ? r.summary : "";
  const trigger = typeof r.what_brought_them_in === "string" ? r.what_brought_them_in : "";
  const ideas = [...(buyer.ideas || [])].sort(byTrendScoreDesc);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--text-primary)" }}>{buyer.name}</div>
        {buyer.keyword && <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>came in on &ldquo;{buyer.keyword}&rdquo;</span>}
      </div>
      {summary && <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.65, margin: "0 0 8px" }}>{summary}</p>}
      {trigger && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 14px" }}>
          <span style={{ fontWeight: 700, color: "var(--text-secondary)" }}>What was going on: </span>{trigger}
        </p>
      )}
      {ideas.length > 0 && (
        <>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--accent)", marginBottom: 8 }}>Hooks to pull in more like {buyer.name.split(" ")[0]}</div>
          <div style={{ display: "grid", gap: 8 }}>
            {ideas.map((idea, i) => <CreatorIdeaCard key={i} idea={idea} />)}
          </div>
        </>
      )}
    </div>
  );
}

export default function CreatorBuyersView({ buyers }: { buyers: BuyerIdeaSet[] }) {
  if (!buyers.length) {
    return (
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 40, textAlign: "center" }}>
        <Users size={26} style={{ color: "var(--text-muted)", marginBottom: 10 }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Your buyer hooks are being built</div>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
          Every person who buys gets researched from their real conversations, then turned into hooks that pull in more people like them. Check back soon.
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
        The real people who paid you. Under each one are hooks built to pull in more people just like them — tap a hook for the full filming recipe.
      </p>
      {buyers.map((b, i) => <BuyerCard key={i} buyer={b} />)}
    </div>
  );
}
