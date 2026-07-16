"use client";

// One idea, creator-facing: the hook is the line you read; tap it for the filming recipe. No trend
// badge, no score, no chips — grading still runs, it just silently orders these.

import { useState } from "react";
import type { VideoIdea } from "./VideoIdeaCard";
import { CopyButton, INK, BODY, MUTED, RULE } from "./creator-ui";

function briefText(idea: VideoIdea): string {
  return [
    `IDEA: ${idea.title || ""}`,
    idea.hook ? `Hook (say this first): "${idea.hook}"` : "",
    idea.environment ? `Where to film: ${idea.environment}` : "",
    idea.attire ? `What to wear: ${idea.attire}` : "",
    idea.expression ? `Delivery: ${idea.expression}` : "",
    idea.word_choice ? `Word choice: ${idea.word_choice}` : "",
    idea.rationale ? `Why it attracts your buyer: ${idea.rationale}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function Line({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <p style={{ fontSize: 15, color: BODY, lineHeight: 1.65, margin: 0 }}>
      <span style={{ color: MUTED }}>{label} </span>
      {value}
    </p>
  );
}

export function CreatorIdeaCard({ idea }: { idea: VideoIdea }) {
  const [open, setOpen] = useState(false);
  const hook = idea.hook || idea.title || "";
  return (
    <li style={{ borderTop: `1px solid ${RULE}`, padding: "14px 0" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }}>
        <span style={{ fontSize: 16, color: INK, lineHeight: 1.5 }}>{hook}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          <Line label="Where to film:" value={idea.environment} />
          <Line label="What to wear:" value={idea.attire} />
          <Line label="Delivery:" value={idea.expression} />
          <Line label="Word choice:" value={idea.word_choice} />
          <Line label="Why it works:" value={idea.rationale} />
          <div style={{ marginTop: 4 }}>
            <CopyButton text={briefText(idea)} label="Copy the brief" />
          </div>
        </div>
      )}
    </li>
  );
}

// Order ideas by the (hidden) trend score, highest first, ungraded last. Score is NEVER displayed.
export function byTrendScoreDesc(a: VideoIdea, b: VideoIdea): number {
  const s = (v?: number | null) => (v == null ? -1 : v);
  return s(b.trend_score) - s(a.trend_score);
}
