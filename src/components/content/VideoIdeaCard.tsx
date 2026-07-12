"use client";

// Shared card for one filmable video idea (used by the Buyers and Playbook views).
// Collapsed: title + format + trend badge. Expanded: the full execution recipe.

import { useState } from "react";
import { ChevronDown, Copy, Check } from "lucide-react";

export type VideoIdea = {
  sort_order?: number;
  title?: string | null;
  format?: string | null;
  hook?: string | null;
  environment?: string | null;
  attire?: string | null;
  expression?: string | null;
  word_choice?: string | null;
  rationale?: string | null;
  grounded_in?: string | null;
  trend_score?: number | null;
  trend_take?: string | null;
};

const GREEN = "#8ce0ab", RED = "#e0794d";

export function trendLabel(score: number): { label: string; color: string } {
  if (score >= 75) return { label: "RIDING THE WAVE", color: GREEN };
  if (score >= 50) return { label: "SOLID", color: "var(--accent)" };
  return { label: "AGAINST THE GRAIN", color: RED };
}

export function TrendBadge({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const t = trendLabel(score);
  return (
    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.6, color: t.color, border: `1px solid ${t.color}55`, background: `${t.color}14`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      {score} · {t.label}
    </span>
  );
}

function briefText(idea: VideoIdea): string {
  return [
    `IDEA: ${idea.title || ""}`,
    idea.format ? `Format: ${idea.format}` : "",
    idea.hook ? `Hook (say this first): "${idea.hook}"` : "",
    idea.environment ? `Where to film: ${idea.environment}` : "",
    idea.attire ? `What to wear: ${idea.attire}` : "",
    idea.expression ? `Delivery: ${idea.expression}` : "",
    idea.word_choice ? `Word choice: ${idea.word_choice}` : "",
    idea.rationale ? `Why it attracts your buyer: ${idea.rationale}` : "",
    idea.trend_take ? `Right now: ${idea.trend_take}` : "",
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

export function VideoIdeaCard({ idea, index }: { idea: VideoIdea; index: number }) {
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

  return (
    <div style={{ border: "1px solid var(--border-primary)", borderRadius: 12, background: "var(--bg-glass)", overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "13px 15px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text-muted)", width: 20 }}>{index + 1}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.4 }}>{idea.title}</span>
          {idea.format && <span style={{ fontSize: 11.5, color: "var(--text-muted)", textTransform: "capitalize" }}>{idea.format}</span>}
        </span>
        <TrendBadge score={idea.trend_score} />
        <ChevronDown size={16} style={{ color: "var(--text-muted)", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div style={{ padding: "0 15px 16px", display: "grid", gap: 13 }}>
          {idea.hook && (
            <div style={{ borderLeft: "3px solid var(--accent)", padding: "8px 12px", background: "var(--bg-card)", borderRadius: 8 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--accent)", marginBottom: 4 }}>Open with</div>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.55 }}>&ldquo;{idea.hook}&rdquo;</div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 13 }}>
            <Field label="Where to film" value={idea.environment} />
            <Field label="What to wear" value={idea.attire} />
            <Field label="Delivery" value={idea.expression} />
            <Field label="Word choice" value={idea.word_choice} />
          </div>
          <Field label="Why this pulls your buyer" value={idea.rationale} />
          {idea.trend_take && (
            <div style={{ border: "1px solid var(--border-primary)", borderRadius: 8, padding: "9px 12px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>Right now on social</div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{idea.trend_take}</div>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={copy} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "var(--accent)", background: "none", border: "1px solid var(--accent)", borderRadius: 999, padding: "5px 12px", cursor: "pointer" }}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy the brief"}
            </button>
            {idea.grounded_in && <span style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>From: {idea.grounded_in}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
