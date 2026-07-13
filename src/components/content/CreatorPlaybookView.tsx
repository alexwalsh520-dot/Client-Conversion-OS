"use client";

// Creator Playbook: the "shift brief" (who your content pulls in now vs who pays, and how to shift)
// on top, then the bottom-of-funnel idea set ordered by the hidden grade — hooks prominent, no scores,
// no badges, one accent color.

import { CreatorIdeaCard, byTrendScoreDesc } from "./CreatorIdeaCard";
import type { VideoIdea } from "./VideoIdeaCard";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 14, padding: 36, textAlign: "center" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>{title}</div>
      <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>{body}</p>
    </div>
  );
}

function Block({ label, text }: { label: string; text?: string }) {
  if (!text) return null;
  return (
    <div>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 5 }}>{label}</div>
      <p style={{ fontSize: 14.5, color: "var(--text-secondary)", lineHeight: 1.65, margin: 0 }}>{text}</p>
    </div>
  );
}

function ShiftCard({ brief }: { brief: ShiftBrief }) {
  const shifts = (Array.isArray(brief.shifts) ? brief.shifts : []).filter((s) => s && s.move);
  const keep = (Array.isArray(brief.keep) ? brief.keep : []).filter(Boolean);
  const stop = (Array.isArray(brief.stop) ? brief.stop : []).filter(Boolean);
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border-primary)", borderRadius: 16, padding: 24, display: "grid", gap: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", color: "var(--accent)" }}>Shift your content toward the buyer</div>
      <Block label="Who your content is pulling in" text={brief.pulling_now} />
      <Block label="Who actually buys" text={brief.buyer} />
      <Block label="The gap" text={brief.gap} />

      {shifts.length > 0 && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>The shifts to make</div>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {shifts.map((s, i) => (
              <li key={i} style={{ display: "flex", gap: 12 }}>
                <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, border: "1px solid var(--accent)", color: "var(--accent)", fontSize: 12.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.5 }}>{s.move}</span>
                  {s.why && <span style={{ display: "block", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 2 }}>{s.why}</span>}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {(keep.length > 0 || stop.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 18, borderTop: "1px solid var(--border-primary)", paddingTop: 16 }}>
          {keep.length > 0 && (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Keep doing</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                {keep.map((k, i) => <li key={i} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>{k}</li>)}
              </ul>
            </div>
          )}
          {stop.length > 0 && (
            <div>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.9, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>Stop doing</div>
              <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 6 }}>
                {stop.map((s, i) => <li key={i} style={{ fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>{s}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CreatorPlaybookView({ shiftBrief, ideas }: { shiftBrief: ShiftBrief | null; ideas: VideoIdea[] }) {
  const sorted = [...(ideas || [])].sort(byTrendScoreDesc);
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {shiftBrief ? (
        <ShiftCard brief={shiftBrief} />
      ) : (
        <Empty title="Your content analysis is being built" body="We look at what your recent posts are pulling in versus the people who actually buy, then show you how to shift. Check back soon." />
      )}

      {sorted.length ? (
        <div style={{ display: "grid", gap: 9 }}>
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", margin: "4px 0 2px" }}>Your bottom-of-funnel playbook</h2>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>Videos built from everyone who has paid you — ordered to pull in more of that buyer. Tap any hook for the full recipe.</p>
          </div>
          {sorted.map((idea, i) => <CreatorIdeaCard key={i} idea={idea} />)}
        </div>
      ) : (
        <Empty title="Your playbook is being built" body="Ten videos built from everyone who has bought, ordered to attract more of the same buyer. Check back soon." />
      )}
    </div>
  );
}
