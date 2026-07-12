"use client";

// Buyers: one persona card per real premium buyer, each with 10 filmable video ideas
// reverse-engineered from that buyer's sales call + DM transcripts. Everyone visible at once.

import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import { VideoIdeaCard, type VideoIdea } from "./VideoIdeaCard";

export type BuyerIdeaSet = {
  name: string;
  keyword?: string | null;
  closeDate?: string | null;
  research: Record<string, unknown>;
  ideas: VideoIdea[];
};

const GREEN = "#8ce0ab", RED = "#e0794d";

function list(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}

function chip(t: string, color: string, key: string) {
  return (
    <span key={key} style={{ fontSize: 12, color, border: `1px solid ${color}44`, background: `${color}12`, borderRadius: 999, padding: "4px 10px" }}>{t}</span>
  );
}

function BuyerCard({ buyer }: { buyer: BuyerIdeaSet }) {
  const [open, setOpen] = useState(false);
  const r = buyer.research || {};
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 16.5, fontWeight: 700, color: "var(--text-primary)" }}>{buyer.name}</div>
        {buyer.keyword && <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>came in on &ldquo;{buyer.keyword}&rdquo;</span>}
      </div>
      {typeof r.summary === "string" && r.summary && (
        <p style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.65, margin: "0 0 10px" }}>{r.summary}</p>
      )}
      {typeof r.what_brought_them_in === "string" && r.what_brought_them_in && (
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
          <span style={{ fontWeight: 700, color: "var(--text-secondary)" }}>What was going on: </span>{r.what_brought_them_in}
        </p>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 }}>
        {list(r.pains).slice(0, 3).map((p, i) => chip(p, RED, `p${i}`))}
        {list(r.limiting_beliefs).slice(0, 2).map((p, i) => chip(p, "var(--accent)", `b${i}`))}
      </div>
      {list(r.their_words).length > 0 && (
        <div style={{ display: "grid", gap: 4, marginBottom: 14 }}>
          {list(r.their_words).slice(0, 2).map((w, i) => (
            <div key={i} style={{ fontSize: 12.5, color: GREEN, lineHeight: 1.5 }}>&ldquo;{w}&rdquo;</div>
          ))}
        </div>
      )}

      <button onClick={() => setOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderRadius: 10, border: "1px solid var(--border-primary)", background: "var(--bg-glass)", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--accent)" }}>{buyer.ideas.length} videos to make more of them</span>
        <span style={{ flex: 1 }} />
        <ChevronDown size={16} style={{ color: "var(--text-muted)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {buyer.ideas.map((idea, i) => <VideoIdeaCard key={i} idea={idea} index={i} />)}
        </div>
      )}
    </div>
  );
}

export default function BuyerIdeasView({ buyers }: { buyers: BuyerIdeaSet[] }) {
  if (!buyers.length) {
    return (
      <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 40, textAlign: "center" }}>
        <Users size={26} style={{ color: "var(--text-muted)", marginBottom: 10 }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>Buyer blueprints are being built</div>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
          Every buyer gets researched from their real sales call and DMs, then turned into 10 videos to attract more people like them. Check back soon.
        </p>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
        Real people who bought. Each one researched from their sales call and DMs, then reverse-engineered into 10 videos built to attract more people just like them.
      </p>
      {buyers.map((b, i) => <BuyerCard key={i} buyer={b} />)}
    </div>
  );
}
