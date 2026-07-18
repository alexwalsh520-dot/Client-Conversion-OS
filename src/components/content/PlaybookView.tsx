"use client";

// The Playbook — the filming sheet, shared by the operator (/content) and creator (/p/content) views.
//
// It reads as a table of contents you open where you're working, not a document you scroll: every
// section is a list of one-line rows, and detail only appears when you click a row. Order: what
// they're saying → your buyer → actions → hooks → topics.
//
// Display only. Everything here is selected and arranged from what the pipeline already generates.

import type { ShiftBrief } from "@/lib/buyer-dna/shift";
import type { Playbook, PlaybookHook, PlaybookTopic, PlaybookSaying } from "@/lib/buyer-dna/playbook";
import type { BuyerVoice } from "@/lib/buyer-dna/voice";
import { H, Section, Empty, CopyButton, Row, SubLabel, INK, BODY, MUTED, RULE, MEASURE } from "./creator-ui";

type IcpView = {
  one_line?: string | null;
  who_they_are?: string | null;
  top_pains?: string[];
  desires?: string[];
  triggers?: string[];
  language?: string[];
  disqualifiers?: string[];
};

const list = (xs?: string[] | null) => (xs || []).filter(Boolean);

function Bullets({ items }: { items: string[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
      {items.map((x, i) => (
        <li key={i} style={{ fontSize: 14.5, color: BODY, lineHeight: 1.6 }}>{x}</li>
      ))}
    </ul>
  );
}

function Group({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <SubLabel>{label}</SubLabel>
      <Bullets items={items} />
    </div>
  );
}

// Everything worth knowing about the buyer that a creator would actually use, pulled from the ICP and
// the buyer-voice overview the pipeline already produces — no new fields, just selected and arranged.
// Returns null when there is genuinely nothing to show, so the caller can drop the row entirely.
function moreOnBuyer(icp: IcpView | null, voice: BuyerVoice | null): React.ReactNode {
  const voicePains = (voice?.top_pains || [])
    .filter((p) => p && p.pain)
    .map((p) => [p.pain, p.how_common].filter(Boolean).join(" — "));
  const painItems = voicePains.length ? voicePains : list(icp?.top_pains);
  const overTheLine = [...list(icp?.triggers), ...list(icp?.desires)];
  const language = list(icp?.language);
  const disq = list(icp?.disqualifiers);
  if (!painItems.length && !overTheLine.length && !language.length && !disq.length) return null;
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <Group label="Their most common pains" items={painItems} />
      <Group label="What gets them over the line" items={overTheLine} />
      {language.length > 0 && (
        <div>
          <SubLabel>Their exact words — use these</SubLabel>
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
            {language.map((x, i) => (
              <li key={i} style={{ fontSize: 14.5, color: BODY, lineHeight: 1.6, fontStyle: "italic" }}>&ldquo;{x}&rdquo;</li>
            ))}
          </ul>
        </div>
      )}
      <Group label="Not your buyer if" items={disq} />
    </div>
  );
}

export default function PlaybookView({
  shiftBrief,
  playbook,
  buyerLine,
  icp,
  buyerVoice,
}: {
  shiftBrief: ShiftBrief | null;
  playbook: Playbook | null;
  buyerLine?: string | null;
  icp?: IcpView | null;
  buyerVoice?: BuyerVoice | null;
}) {
  const hooks: PlaybookHook[] = playbook?.hooks || [];
  const topics: PlaybookTopic[] = playbook?.topics || [];
  // Playbooks generated before the tier list existed simply have no `saying` — hide the section
  // entirely until the next weekly regen rather than showing an empty shell.
  const saying: PlaybookSaying[] = (playbook?.saying || []).filter((s) => s && s.theme);
  const moves = (Array.isArray(shiftBrief?.shifts) ? shiftBrief!.shifts : []).filter((s) => s && s.move).slice(0, 3);
  const more = moreOnBuyer(icp || null, buyerVoice || null);

  return (
    <div>
      {saying.length > 0 && (
        <Section>
          <H>What they&rsquo;re saying</H>
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {saying.map((s, i) => (
              <Row
                key={i}
                lead={s.rank}
                summary={s.theme}
                detail={
                  <div style={{ display: "grid", gap: 10 }}>
                    {(s.quotes || []).filter(Boolean).map((q, qi) => (
                      <p key={qi} style={{ fontSize: 14.5, color: BODY, lineHeight: 1.6, margin: 0, paddingLeft: 12, borderLeft: `2px solid ${RULE}`, fontStyle: "italic" }}>
                        &ldquo;{q}&rdquo;
                      </p>
                    ))}
                    {(s.how_common || s.source) && (
                      <div style={{ fontSize: 12.5, color: MUTED }}>{[s.how_common, s.source].filter(Boolean).join(" · ")}</div>
                    )}
                  </div>
                }
              />
            ))}
          </ol>
        </Section>
      )}

      {buyerLine && (
        <Section>
          <H>Your buyer</H>
          <p style={{ fontSize: 17, color: INK, lineHeight: 1.6, margin: 0, maxWidth: MEASURE }}>{buyerLine}</p>
          {more && (
            <ul style={{ margin: "14px 0 0", padding: 0, listStyle: "none" }}>
              <Row summary={<span style={{ fontSize: 13, fontWeight: 600, color: BODY }}>More on your buyer</span>} detail={more} />
            </ul>
          )}
        </Section>
      )}

      <Section>
        <H>Actions to attract more ICP</H>
        {moves.length ? (
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {moves.map((m, i) => (
              <Row
                key={i}
                summary={m.move}
                truncate
                detail={m.why ? <p style={{ fontSize: 14.5, color: BODY, lineHeight: 1.65, margin: 0 }}>{m.why}</p> : undefined}
              />
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
            {hooks.map((h, i) => (
              <Row
                key={i}
                lead={i + 1}
                summary={h.hook}
                truncate
                detail={
                  <div>
                    {h.present && <p style={{ fontSize: 14.5, color: BODY, lineHeight: 1.65, margin: "0 0 8px" }}>{h.present}</p>}
                    <CopyButton text={[h.hook || "", h.present ? `Present: ${h.present}` : ""].filter(Boolean).join("\n")} />
                  </div>
                }
              />
            ))}
          </ol>
        ) : (
          <Empty />
        )}
      </Section>

      <Section>
        <H>Topics</H>
        {topics.length ? (
          <div className="ccos-2col">
            {topics.map((t: PlaybookTopic, i: number) => (
              <div key={i} style={{ fontSize: 15, color: INK, lineHeight: 1.5 }}>{t.topic}</div>
            ))}
          </div>
        ) : (
          <Empty />
        )}
      </Section>
    </div>
  );
}
