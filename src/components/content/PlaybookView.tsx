"use client";

// The Playbook filming sheet — shared by the operator (/content) and creator (/p/content) views.
// Top to bottom: the shift-brief overview, then 20 ready-to-film talking-head hooks (each with a
// presentation note + copy button), then topics that hit the buyer. No badges, scores, or grade colors
// — the Attraction/Connection tags are type labels, not grades. Var-driven, so it reads in light + dark.

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook, PlaybookHook, PlaybookTopic } from "@/lib/buyer-dna/playbook";

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

// The shift-brief overview card (ported from CreatorPlaybookView).
function ShiftOverview({ brief }: { brief: ShiftBrief }) {
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

function HookCard({ n, hook }: { n: number; hook: PlaybookHook }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = [hook.hook || "", hook.present ? `Present: ${hook.present}` : ""].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, border: "1px solid var(--border-primary)", borderRadius: 12, background: "var(--bg-glass)", padding: "13px 15px" }}>
      <span style={{ flexShrink: 0, width: 22, fontSize: 12, fontWeight: 800, color: "var(--text-muted)", textAlign: "right", paddingTop: 2 }}>{n}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", lineHeight: 1.5 }}>&ldquo;{hook.hook}&rdquo;</div>
        {hook.present && <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 4 }}>{hook.present}</div>}
      </div>
      <button onClick={copy} title="Copy hook + note" style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, border: "1px solid var(--border-primary)", background: "none", color: copied ? "var(--accent)" : "var(--text-muted)", cursor: "pointer" }}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function TypeTag({ type }: { type?: string }) {
  const connection = (type || "").toLowerCase() === "connection";
  const label = connection ? "Connection" : "Attraction";
  const style = connection
    ? { color: "var(--text-muted)", border: "1px solid var(--border-primary)", background: "var(--bg-glass)" }
    : { color: "var(--accent)", border: "1px solid var(--accent)44", background: "var(--accent-soft)" };
  return (
    <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: 0.7, textTransform: "uppercase", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap", ...style }}>{label}</span>
  );
}

export default function PlaybookView({ shiftBrief, playbook }: { shiftBrief: ShiftBrief | null; playbook: Playbook | null }) {
  const hooks: PlaybookHook[] = playbook?.hooks || [];
  const topics: PlaybookTopic[] = playbook?.topics || [];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {shiftBrief ? (
        <ShiftOverview brief={shiftBrief} />
      ) : (
        <Empty title="Your content analysis is being built" body="We look at what your recent posts are pulling in versus the people who actually buy, then show you how to shift. Check back soon." />
      )}

      {hooks.length ? (
        <div style={{ display: "grid", gap: 9 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 0.4, color: "var(--text-muted)" }}>Talking head · 30–90 seconds · 3 a day</div>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 2px" }}>{hooks.length} hooks ready to film</h2>
          {hooks.map((h, i) => <HookCard key={i} n={i + 1} hook={h} />)}
        </div>
      ) : (
        <Empty title="Your hooks are being built" body="Twenty ready-to-film talking-head hooks aimed at the buyer who pays, each with a note on how to show up. Check back soon." />
      )}

      {topics.length > 0 && (
        <div style={{ display: "grid", gap: 9 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, color: "var(--text-primary)", margin: "4px 0 2px" }}>Topics that hit your buyer</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {topics.map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, border: "1px solid var(--border-primary)", borderRadius: 12, background: "var(--bg-glass)", padding: "12px 15px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)", lineHeight: 1.45 }}>{t.topic}</div>
                  {t.why && <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 3 }}>{t.why}</div>}
                </div>
                <TypeTag type={t.type} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
