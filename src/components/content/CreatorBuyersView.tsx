"use client";

// Creator Buyers: an aggregate "buyer voice" overview across everyone who paid, then one card per real
// buyer — a two-line read + every hook built to attract more people like them (tap a hook for the full
// recipe). Hooks are the product. No scores, no badges, no colored chips.

import { Users } from "lucide-react";
import { CreatorIdeaCard, byTrendScoreDesc } from "./CreatorIdeaCard";
import type { BuyerIdeaSet } from "./BuyerIdeasView";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";

type BuyerVoiceView = BuyerVoice & { buyer_count?: number | null };

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

const sectionLabel = { fontSize: 10.5, fontWeight: 800 as const, letterSpacing: 0.9, textTransform: "uppercase" as const, color: "var(--text-muted)", marginBottom: 8 };

// The aggregate voice — plain typography, one accent color, no chips/badges.
function VoiceOverview({ voice }: { voice: BuyerVoiceView }) {
  const saying = (voice.saying || []).filter((s) => s && s.theme);
  const notSaying = (voice.not_saying || []).filter((s) => s && s.absence);
  const pains = (voice.top_pains || []).filter((p) => p && p.pain);
  const objections = (voice.top_objections || []).filter((o) => o && o.objection);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 24, display: "grid", gap: 20 }}>
      {/* 1. Synopsis */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--accent)" }}>What your buyers sound like</div>
        {voice.buyer_count ? <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>Based on {voice.buyer_count} buyers who paid</div> : null}
        {voice.synopsis && <p style={{ fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.7, margin: "10px 0 0" }}>{voice.synopsis}</p>}
      </div>

      {/* 2. What they keep saying */}
      {saying.length > 0 && (
        <div>
          <div style={sectionLabel}>What they keep saying</div>
          <div style={{ display: "grid", gap: 12 }}>
            {saying.map((s, i) => (
              <div key={i}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5 }}>{s.theme}</div>
                {s.example && <div style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 2, fontStyle: "italic" }}>&ldquo;{s.example}&rdquo;</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. What they're NOT saying */}
      {notSaying.length > 0 && (
        <div style={{ borderTop: "1px solid var(--border-primary)", paddingTop: 16 }}>
          <div style={sectionLabel}>What they&rsquo;re NOT saying</div>
          <div style={{ display: "grid", gap: 12 }}>
            {notSaying.map((n, i) => (
              <div key={i}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5 }}>{n.absence}</div>
                {n.meaning && <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginTop: 2 }}>{n.meaning}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Most common pains + objections, side by side on desktop */}
      {(pains.length > 0 || objections.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, borderTop: "1px solid var(--border-primary)", paddingTop: 16 }}>
          {pains.length > 0 && (
            <div>
              <div style={sectionLabel}>Most common pains</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 7 }}>
                {pains.map((p, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {p.pain}{p.how_common && <span style={{ color: "var(--text-muted)" }}> — {p.how_common}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {objections.length > 0 && (
            <div>
              <div style={sectionLabel}>Most common objections</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 7 }}>
                {objections.map((o, i) => (
                  <li key={i} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {o.objection}{o.how_common && <span style={{ color: "var(--text-muted)" }}> — {o.how_common}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VoiceEmpty() {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 28, textAlign: "center" }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", marginBottom: 5 }}>Your buyer voice is being built</div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
        Once enough buyers are researched, this shows the average of what they all keep saying, what they don&rsquo;t, and their most common pains and objections. Check back soon.
      </p>
    </div>
  );
}

export default function CreatorBuyersView({ buyers, buyerVoice }: { buyers: BuyerIdeaSet[]; buyerVoice: BuyerVoiceView | null }) {
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
    <div style={{ display: "grid", gap: 18 }}>
      {buyerVoice ? <VoiceOverview voice={buyerVoice} /> : <VoiceEmpty />}

      <div>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", margin: "6px 0 2px" }}>The people behind this</h2>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
          The real people who paid you. Under each one are hooks built to pull in more people just like them — tap a hook for the full filming recipe.
        </p>
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {buyers.map((b, i) => <BuyerCard key={i} buyer={b} />)}
      </div>
    </div>
  );
}
