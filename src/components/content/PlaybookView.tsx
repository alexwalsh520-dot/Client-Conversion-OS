"use client";

// The Playbook — the filming sheet, shared by the operator (/content) and creator (/p/content) views.
//
// Four things, in order: who you're talking to, the shift to make, the hooks to film, the topics to
// film them about. Everything the analysis produces behind these (the pulling-now/gap write-up, the
// why behind each shift, keep/stop lists, attraction/connection tags) still runs — it just isn't shown.
// A hook you can read in one glance gets filmed; a hook buried in a card doesn't.

import { useState } from "react";
import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook, PlaybookHook, PlaybookTopic } from "@/lib/buyer-dna/playbook";
import { H, Section, Empty, CopyButton, INK, BODY, MUTED, RULE } from "./creator-ui";

// The hook is the whole line. Tapping it reveals how to present it, and lets you take it with you.
function Hook({ n, hook }: { n: number; hook: PlaybookHook }) {
  const [open, setOpen] = useState(false);
  const text = [hook.hook || "", hook.present ? `Present: ${hook.present}` : ""].filter(Boolean).join("\n");
  return (
    <li style={{ borderTop: n === 1 ? "none" : `1px solid ${RULE}`, padding: "16px 0" }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", gap: 16, cursor: "pointer", alignItems: "baseline" }}
      >
        <span style={{ flexShrink: 0, width: 20, fontSize: 14, color: MUTED, fontVariantNumeric: "tabular-nums" }}>{n}</span>
        <span style={{ fontSize: 17, color: INK, lineHeight: 1.5 }}>{hook.hook}</span>
      </div>
      {open && (
        <div style={{ paddingLeft: 36, marginTop: 10 }}>
          {hook.present && <p style={{ fontSize: 15, color: BODY, lineHeight: 1.65, margin: "0 0 10px" }}>{hook.present}</p>}
          <CopyButton text={text} />
        </div>
      )}
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
  const moves = (Array.isArray(shiftBrief?.shifts) ? shiftBrief!.shifts : [])
    .map((s) => s?.move)
    .filter((m): m is string => Boolean(m))
    .slice(0, 3);

  return (
    <div>
      {buyerLine && (
        <Section first>
          <p style={{ fontSize: 21, color: INK, lineHeight: 1.5, margin: 0, fontWeight: 400 }}>{buyerLine}</p>
        </Section>
      )}

      <Section first={!buyerLine}>
        <H>The shift</H>
        {moves.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 14 }}>
            {moves.map((m, i) => (
              <li key={i} style={{ fontSize: 17, color: INK, lineHeight: 1.55 }}>{m}</li>
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
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 14 }}>
            {topics.map((t: PlaybookTopic, i: number) => (
              <li key={i} style={{ fontSize: 17, color: INK, lineHeight: 1.55 }}>{t.topic}</li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
      </Section>
    </div>
  );
}
