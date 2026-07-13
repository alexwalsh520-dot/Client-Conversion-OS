"use client";

// Creator-facing idea card. The HOOK is the star — shown prominently while collapsed; tap to expand
// the full filming recipe. No trend badge, no score, no format-color chips, no "right now on social"
// note — those are operator-only signals (grading still runs, it just silently orders these cards).

import { useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";
import type { VideoIdea } from "./VideoIdeaCard";

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

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>{value}</div>
    </div>
  );
}

export function CreatorIdeaCard({ idea }: { idea: VideoIdea }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(briefText(idea));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  const hook = idea.hook || idea.title || "";
  return (
    <div style={{ border: "1px solid var(--border-primary)", borderRadius: 12, background: "var(--bg-glass)", overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "13px 15px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ flex: 1, minWidth: 0 }}>
          {idea.title && <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, color: "var(--text-muted)", marginBottom: 3 }}>{idea.title}</span>}
          <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.5 }}>&ldquo;{hook}&rdquo;</span>
        </span>
        <ChevronDown size={16} style={{ color: "var(--text-muted)", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ padding: "0 15px 16px", display: "grid", gap: 13 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 13 }}>
            <Field label="Where to film" value={idea.environment} />
            <Field label="What to wear" value={idea.attire} />
            <Field label="Delivery" value={idea.expression} />
            <Field label="Word choice" value={idea.word_choice} />
          </div>
          <Field label="Why this pulls your buyer" value={idea.rationale} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy the brief"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Order ideas by the (hidden) trend score, highest first, ungraded last. Score is NEVER displayed.
export function byTrendScoreDesc(a: VideoIdea, b: VideoIdea): number {
  const s = (v?: number | null) => (v == null ? -1 : v);
  return s(b.trend_score) - s(a.trend_score);
}
