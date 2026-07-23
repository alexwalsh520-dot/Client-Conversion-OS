// Daily Instagram text carousels for a fitness creator — ONE LLM call generates all 5 carousels for a
// creator for one day (~$0.15). Each carousel is one idea aimed at the ONE premium buyer, articulating
// that buyer's pain better than they can. Grounded in the locked ICP, the buyer-voice overview, and the
// real dossiers. The generate route never regenerates a day that already has its 5 rows.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import type { Icp } from "./icp";
import type { Research } from "./dossier";
import { getCurrentVoice, type BuyerVoice } from "./voice";
import { getCurrentPlaybook } from "./playbook";
import { getMessagingDoc, messagingDocBlock } from "./messaging-doc";
import { estimateWrappedLines, SLIDE_MAX_LINES } from "@/lib/content/carousel-render";
import { extractJson, salvageObjects } from "./json";

const MODEL = "claude-sonnet-4-6";

const JSON_HYGIENE =
  "\nDo not use double-quote characters inside JSON string values. Keep every string field to at most 2 sentences.";
const NO_DOLLARS =
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

export type CarouselSlide = { text?: string; blocks?: unknown[] };
export type Carousel = { topic?: string; slides: CarouselSlide[] };

// The copy only works if it reads like the creator typed it himself. Everything below the core brief
// exists to beat the house style out of the model: how a man actually talks, the tells that give AI
// away, and two real carousels of Matthew's as the register to match.
const VOICE =
  "\n\nVOICE — this must read like the creator typed it himself, not like an account posting to an audience:\n" +
  "- Write it the way it would be SPOKEN out loud. Contractions every time (I'm, don't, you've, that's, wasn't).\n" +
  "- Sentence fragments are good. One-word sentences are good.\n" +
  "- Vary length hard: some sentences 3 words, some 20. Never let a rhythm settle in.\n" +
  "- Plain words a 12-year-old knows. No corporate, coachy, or motivational vocabulary.\n" +
  "- First person, and specific: real moments, real counts of reps, months, mornings, years. Concrete beats clever every time. Never a dollar amount.\n" +
  "- It should sound like one man talking to one person he knows — not a brand addressing followers.\n" +
  "- Say the true thing plainly. No wordplay, no performing, no cleverness.";

const BANNED_TELLS =
  "\n\nBANNED — every one of these is an AI tell. Never use any of them, in any slide:\n" +
  "- Opening a sentence with the discourse marker 'Here's the thing,' or 'Here's the thing:' (a literal mid-sentence use, as in 'here's the thing you do next', is fine).\n" +
  "- The phrases: 'Let that sink in', 'Read that again', 'The truth is', 'game-changer', 'unlock', 'journey', 'dive in'.\n" +
  "- 'It's not about X, it's about Y' constructions.\n" +
  "- Perfectly parallel three-item lists.\n" +
  "- A rhetorical question immediately followed by its own answer.\n" +
  "- Chains of em-dashes.\n" +
  "- Ending every slide on a punchline. That rhythm is the biggest tell of all — let some slides just land flat and continue.\n" +
  "- Tidy summary endings that wrap everything up in a bow.";

// Real carousels from the creators. Reference for REGISTER only — never lift their content or lines.
const STYLE_REFERENCE =
  "\n\nSTYLE REFERENCE — two real openings from these creators. Match THIS register: plain sentences, real stakes, no cleverness. Do NOT reuse their content, their facts, or their lines; they are here only to show how these men actually talk. Each line below is its own slide:\n\n" +
  "TYSON STYLE:\n" +
  "As a Marine Sergeant, I spent 5 years training men.\n" +
  "I learned what it takes to build discipline that doesn't break.\n" +
  "And I saw **exactly** what happens when that structure disappears.\n" +
  "Here's the pattern I'm seeing everywhere now:\n\n" +
  "ANTWAN STYLE:\n" +
  "I learned how fast it can all be stripped away.\n" +
  "I watched my own father, one of the toughest men I knew, nearly break completely.\n" +
  "And in 2019, I lost my mom. She was 45. I'd spent my whole life around health, and I still couldn't save the person I loved most.\n" +
  "I signed her up for a gym the day before her stroke. One day too late.";

const BASE =
  "You write Instagram text carousels for a fitness creator, in the creator's first-person voice.\n" +
  "THE JOB: each carousel hyper-targets ONE specific pain or situation of ONE ideal client (the ICP), articulates that pain BETTER than they could say it themselves so they feel read, then gives real value on it. The 5 carousels are 5 DIFFERENT pains or situations of the SAME ICP — never 5 different audiences.\n" +
  "SLIDE 1 MUST DIRECTLY CALL OUT THE ICP: name exactly who this is for, by their identity or their situation, in their own language, so the right person stops because it is unmistakably about THEM (the shape of 'If you're 28 and still chasing the entry test everyone says you missed...' — speak straight to that person). A hook that could belong to any fitness account is WRONG: broad openers like 'Here's what nobody tells you about fitness' or 'The truth about getting in shape' are FORBIDDEN. Call out the person, then articulate their pain.\n" +
  "Each carousel takes a different angle: pain articulated, personal story, myth broken, pattern observed, hard truth.\n" +
  "KEEP SLIDES SHORT: at most ~20 words per slide, and no slide may exceed 4 short lines when it wraps. One thought per slide, punchy lines, deliberate line breaks are part of the writing. The slide-1 hook can be a single line. Occasional **bold** on the words that matter. Final slide lands the takeaway and a soft invitation to follow or DM — never a hard pitch, never hashtags, never emojis. Infer the creator's register from the material below. Return STRICT JSON:\n" +
  '{"carousels":[{"topic":"a few words","slides":[{"text":"one short thought, blank lines between paragraphs, **bold** allowed"}]}]}\n' +
  "Exactly 5 carousels; 7 to 8 slides each (never fewer than 6). No prose outside the JSON.";

// The style exemplars are Tyson/Antwan's physique world — useful register cues for a creator without
// their own doc, but noise for one who has a messaging doc that already defines the register. So they
// are dropped entirely when a doc is present (the doc is the register), and kept register-only otherwise.
function buildSys(hasDoc: boolean): string {
  return BASE + VOICE + BANNED_TELLS + (hasDoc ? "" : STYLE_REFERENCE) + JSON_HYGIENE + NO_DOLLARS;
}

function compactIcp(icp: Icp | null): string {
  if (!icp) return "A premium buyer who paid for 1:1 fitness coaching.";
  const line = (label: string, v?: string[]) => (v && v.length ? `${label}: ${v.slice(0, 8).join("; ")}` : "");
  return [
    icp.one_line || "",
    icp.who_they_are || "",
    line("Pains", icp.top_pains),
    line("Beliefs", icp.limiting_beliefs),
    line("Wants", icp.desires),
    line("Triggers", icp.triggers),
    line("Their words", icp.language),
  ].filter(Boolean).join("\n");
}

function compactVoice(v: BuyerVoice): string {
  const arr = (label: string, xs: string[] | undefined) => (xs && xs.length ? `${label}:\n${xs.map((x) => `- ${x}`).join("\n")}` : "");
  return [
    v.synopsis ? `Synopsis: ${v.synopsis}` : "",
    arr("What they keep saying", (v.saying || []).map((s) => [s.theme, s.example].filter(Boolean).join(" — "))),
    arr("What they do NOT say", (v.not_saying || []).map((s) => [s.absence, s.meaning].filter(Boolean).join(" — "))),
    arr("Most common pains", (v.top_pains || []).map((p) => p.pain).filter(Boolean) as string[]),
    arr("Most common objections", (v.top_objections || []).map((o) => o.objection).filter(Boolean) as string[]),
  ].filter(Boolean).join("\n\n");
}

async function dossierBriefs(sb: SupabaseClient, client: string): Promise<string> {
  const { data } = await sb
    .from("buyer_dossiers")
    .select("research")
    .eq("client_key", client)
    .eq("qualifies_icp", true)
    .order("close_date", { ascending: false })
    .limit(120);
  const briefs = ((data || []) as { research: Research }[])
    .map((doc) => {
      const r = doc.research || {};
      if (!r || !Object.keys(r).length) return "";
      const line = (label: string, v: unknown) => (Array.isArray(v) && v.length ? `${label}: ${v.slice(0, 3).join("; ")}` : "");
      return [line("pains", r.pains), line("beliefs", r.limiting_beliefs), line("words", r.their_words)].filter(Boolean).join(" | ");
    })
    .filter(Boolean);
  return briefs.slice(0, 40).join("\n").slice(0, 24000);
}

// Topics + slide-1 texts from the creator's last 14 days (newest first, capped), so the model does
// not repeat itself over a fortnight.
async function recentToAvoid(sb: SupabaseClient, client: string, forDate: string): Promise<string> {
  const from = new Date(`${forDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 14);
  const fromStr = from.toISOString().slice(0, 10);
  const { data } = await sb
    .from("content_carousels")
    .select("topic, slides")
    .eq("client_key", client)
    .gte("for_date", fromStr)
    .lt("for_date", forDate)
    .order("for_date", { ascending: false })
    .order("slot", { ascending: false })
    .limit(80);
  const items = ((data || []) as { topic: string | null; slides: CarouselSlide[] }[]).map((r) => {
    const s1 = Array.isArray(r.slides) && r.slides[0] && typeof r.slides[0].text === "string" ? r.slides[0].text.replace(/\s+/g, " ").slice(0, 120) : "";
    return [r.topic ? `topic: ${r.topic}` : "", s1 ? `opener: ${s1}` : ""].filter(Boolean).join(" | ");
  }).filter(Boolean);
  return items.join("\n");
}

function parse(text: string): Carousel[] {
  const p = extractJson<{ carousels?: Carousel[] }>(text);
  let carousels = p && Array.isArray(p.carousels) ? p.carousels : [];
  if (carousels.length < 5) {
    // Broken JSON — recover carousel objects individually (each has a slides array).
    const salvaged = salvageObjects<Carousel>(text, ["slides"]);
    if (salvaged.length > carousels.length) carousels = salvaged;
  }
  return carousels
    .map((c) => ({ topic: c.topic, slides: (Array.isArray(c.slides) ? c.slides : []).filter((s) => s && typeof s.text === "string" && s.text.trim()) }))
    .filter((c) => c.slides.length >= 3);
}

// Slides whose text renders to more than SLIDE_MAX_LINES lines at the renderer's real body metrics.
// Indices are 1-based (carousel #, slide #) for a readable retry message.
function overLongSlides(carousels: Carousel[]): { c: number; s: number; lines: number }[] {
  const out: { c: number; s: number; lines: number }[] = [];
  carousels.forEach((car, ci) =>
    (car.slides || []).forEach((sl, si) => {
      const n = estimateWrappedLines(sl.text || "");
      if (n > SLIDE_MAX_LINES) out.push({ c: ci + 1, s: si + 1, lines: n });
    }),
  );
  return out;
}

// One LLM call: generate the 5 carousels for one creator for one day. Does not touch the DB.
export async function generateCarouselSet(
  sb: SupabaseClient,
  client: string,
  forDate: string,
  icp: Icp | null,
  anthropic: Anthropic,
): Promise<{ ok: true; carousels: Carousel[]; lineViolations: number } | { ok: false; reason: string }> {
  const [voiceRow, briefs, avoid, playbookRow, doc] = await Promise.all([
    getCurrentVoice(sb, client),
    dossierBriefs(sb, client),
    recentToAvoid(sb, client, forDate),
    getCurrentPlaybook(sb, client),
    getMessagingDoc(sb, client),
  ]);
  const hasDoc = !!doc;
  const docBlock = messagingDocBlock(doc); // "" for creators without a doc (e.g. Tyson) — no prompt change.
  const sys = buildSys(hasDoc); // doc creators drop the Tyson/Antwan style exemplars entirely.

  // The playbook's ranked tier list is the best evidence we have of what people actually voice, and
  // in what proportion — so the carousels aim at the top of it rather than at whatever reads well.
  const ranked = (playbookRow?.playbook?.saying || [])
    .filter((s) => s && s.theme)
    .map((s) => {
      const quote = (s.quotes || []).find(Boolean);
      return `${s.rank}. ${s.theme}${quote ? ` — they say it like: ${quote}` : ""}`;
    })
    .join("\n");

  const userMsg = [
    // Leads when present. For a creator with no buyer voice or dossiers yet, the doc + ICP is the
    // whole basis for the register and the pains — infer his voice from the document's tone.
    docBlock,
    docBlock
      ? "GROUND EVERY CAROUSEL IN THE DOCUMENT ABOVE, and take the creator's register from it. Each carousel must be unmistakably about THIS creator's specific niche, buyer and offer as the document describes them — the buyer's actual situation, the specific outcome they are working toward, and the exact pains and one-liners in the document. Slide 1 must name that exact buyer by their identity or situation. Do NOT default to generic fitness, physique, muscle-building, bulking, macros/calories or weight-loss content: if the document's positioning is not general fitness, none of that belongs here. Honour the document's own 'what to avoid' guidance. Mirror its phrasing; do not invent buyer quotes."
      : "",
    `THE BUYER (write every carousel for this one person):\n${compactIcp(icp)}`,
    ranked
      ? `WHAT THEY ACTUALLY SAY, RANKED BY HOW OFTEN THEY SAY IT (anchor the carousels in the highest-ranked pains — the top of this list is what most of them are living):\n${ranked}`
      : "",
    voiceRow ? `HOW THIS BUYER TYPE ACTUALLY TALKS (the core material):\n${compactVoice(voiceRow.voice)}` : "",
    briefs ? `REAL BUYER NOTES:\n${briefs}` : "",
    avoid ? `DO NOT REPEAT these recent topics/openers:\n${avoid}` : "",
    "Return the carousels JSON: exactly 5 carousels, 7 to 8 short slides each, each a different pain of the same ICP. Slide 1 of every carousel must call out the ICP directly. Keep every slide to at most 4 short lines.",
  ].filter(Boolean).join("\n\n");

  const genOnce = async (feedback?: string): Promise<Carousel[]> => {
    try {
      const content = feedback ? `${userMsg}\n\n${feedback}` : userMsg;
      const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 8000, system: sys, messages: [{ role: "user", content }] });
      logAiUsage({ feature: "buyer-dna-carousels", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      return parse(tb?.text || "");
    } catch {
      return [];
    }
  };

  let carousels = await genOnce();
  if (carousels.length < 5) {
    const retry = await genOnce();
    if (retry.length > carousels.length) carousels = retry;
  }
  if (carousels.length < 5) return { ok: false, reason: "Could not generate a full set of 5 carousels." };

  // Enforce the ≤4-rendered-lines rule against the renderer's real metrics. If any slide overruns,
  // one targeted retry naming the offenders; keep whichever set has fewer violations. We never
  // truncate copy — an over-long slide is reported, not silently cut.
  let violations = overLongSlides(carousels);
  if (violations.length) {
    const named = violations.map((v) => `carousel ${v.c} slide ${v.s} (${v.lines} lines)`).join("; ");
    const retry = await genOnce(
      `Some slides render longer than the ${SLIDE_MAX_LINES}-line limit: ${named}. Rewrite ONLY those slides to at most ${SLIDE_MAX_LINES} short lines (≤ ~20 words), one thought each. Return the full corrected JSON.`,
    );
    if (retry.length >= 5) {
      const rv = overLongSlides(retry);
      if (rv.length <= violations.length) { carousels = retry; violations = rv; }
    }
  }

  // Normalize to exactly 5 carousels, each clamped to 8 slides max.
  const set = carousels.slice(0, 5).map((c) => ({ topic: c.topic || "", slides: c.slides.slice(0, 8) }));
  const lineViolations = overLongSlides(set).length;
  return { ok: true, carousels: set, lineViolations };
}
