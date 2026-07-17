"use client";

// The Playbook — the filming sheet, shared by the operator (/content) and creator (/p/content) views.
//
// Top to bottom: what they're actually saying (ranked), who you're talking to, the shift to make, the
// hooks to film, the topics to film them about. The tier list leads because it's the raw material —
// the creator's own prospects' words, ranked by how often they really come up.

import { useState } from "react";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook, PlaybookHook, PlaybookTopic, PlaybookSaying } from "@/lib/buyer-dna/playbook";
import { H, Section, Empty, CopyButton, INK, BODY, MUTED, RULE, ACCENT } from "./creator-ui";

// The hook is the whole line. Tapping it reveals how to present it, and lets you take it with you.
function Hook({ n, hook }: { n: number; hook: PlaybookHook }) {
  const [open, setOpen] = useState(false);
  const text = [hook.hook || "", hook.present ? `Present: ${hook.present}` : ""].filter(Boolean).join("\n");
  return (
    <li style={{ borderTop: n === 1 ? "none" : `1px solid ${RULE}`, padding: "14px 0" }}>
      <div onClick={() => setOpen((v) => !v)} style={{ display: "flex", gap: 14, cursor: "pointer", alignItems: "baseline" }}>
        <span style={{ flexShrink: 0, width: 18, fontSize: 13, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{n}</span>
        <span style={{ fontSize: 16, color: INK, lineHeight: 1.55 }}>{hook.hook}</span>
      </div>
      {open && (
        <div style={{ paddingLeft: 32, marginTop: 9 }}>
          {hook.present && <p style={{ fontSize: 14, color: BODY, lineHeight: 1.65, margin: "0 0 8px" }}>{hook.present}</p>}
          <CopyButton text={text} />
        </div>
      )}
    </li>
  );
}

// One ranked thing they keep saying: the theme, their own words under it, then how often + from where.
function Saying({ item }: { item: PlaybookSaying }) {
  const quotes = (item.quotes || []).filter(Boolean);
  const meta = [item.how_common, item.source].filter(Boolean).join(" · ");
  return (
    <li style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
      <span style={{ flexShrink: 0, width: 20, fontSize: 13, fontWeight: 700, color: ACCENT, fontVariantNumeric: "tabular-nums" }}>{item.rank}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 16, color: INK, lineHeight: 1.5, fontWeight: 500 }}>{item.theme}</div>
        {quotes.map((q, i) => (
          <p key={i} style={{ fontSize: 14.5, color: BODY, lineHeight: 1.6, margin: "6px 0 0", paddingLeft: 12, borderLeft: `2px solid ${RULE}`, fontStyle: "italic" }}>
            &ldquo;{q}&rdquo;
          </p>
        ))}
        {meta && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>{meta}</div>}
      </div>
    </li>
  );
}

export default function PlaybookView({
  shiftBrief,
  playbook,
  buyerLine,
}: {
  shiftBrief: ShiftBrief | null;
  playbook: Playbook | null;
  buyerLine?: string | null;
}) {
  const hooks: PlaybookHook[] = playbook?.hooks || [];
  const topics: PlaybookTopic[] = playbook?.topics || [];
  // Playbooks generated before the tier list existed simply have no `saying` — hide the section
  // entirely until the next weekly regen rather than showing an empty shell.
  const saying: PlaybookSaying[] = (playbook?.saying || []).filter((s) => s && s.theme);
  const moves = (Array.isArray(shiftBrief?.shifts) ? shiftBrief!.shifts : [])
    .filter((s) => s && s.move)
    .slice(0, 3);

  return (
    <div>
      {saying.length > 0 && (
        <Section>
          <H>What they&rsquo;re saying</H>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 18 }}>
            {saying.map((s, i) => <Saying key={i} item={s} />)}
          </ol>
        </Section>
      )}

      {buyerLine && (
        <Section>
          <H>Your buyer</H>
          <p style={{ fontSize: 18, color: INK, lineHeight: 1.55, margin: 0 }}>{buyerLine}</p>
        </Section>
      )}

      <Section>
        <H>The shift</H>
        {moves.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 16 }}>
            {moves.map((m, i) => (
              <li key={i}>
                <div style={{ fontSize: 16.5, color: INK, lineHeight: 1.55 }}>{m.move}</div>
                {m.why && <div style={{ fontSize: 14, color: MUTED, lineHeight: 1.6, marginTop: 4 }}>{m.why}</div>}
              </li>
            ))}
          </ol>
        ) : (
          <Empty />
        )}
      </Section>

      <Section>
        <H>Hooks</H>
        {hooks.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {hooks.map((h, i) => <Hook key={i} n={i + 1} hook={h} />)}
          </ol>
        ) : (
          <Empty />
        )}
      </Section>

      <Section>
        <H>Topics</H>
        {topics.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 13 }}>
            {topics.map((t: PlaybookTopic, i: number) => (
              <li key={i} style={{ fontSize: 16, color: INK, lineHeight: 1.55 }}>{t.topic}</li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>
    </div>
  );
}
