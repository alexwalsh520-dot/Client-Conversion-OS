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
import { getMessagingDoc, messagingDocBlock, getGlobalFrameworkDoc, frameworkBlock, frameworkProhibitions, frameworkVoiceSection } from "./messaging-doc";
import {
  CAROUSELS_PER_DAY, MIN_SLIDES_PER_CAROUSEL, MAX_SLIDES_PER_CAROUSEL,
  MAX_SENTENCES_PER_SLIDE, MAX_WORDS_PER_SENTENCE,
} from "@/lib/content/carousel-config";
import { extractJson, salvageObjects } from "./json";
import { marketDirective } from "@/lib/content/market";

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
  "SLIDE LENGTH — write real, full sentences with room to breathe, NOT clipped fragments. Each slide is AT MOST 4 SENTENCES, written as short paragraphs separated by blank lines. A sentence can be as long as it naturally needs to be. The slide-1 hook is often just 1-2 sentences. Occasional **bold** on the words that matter. Final slide lands the takeaway and a soft invitation to follow or DM — never a hard pitch, never hashtags, never emojis. Infer the creator's register from the material below. Return STRICT JSON:\n" +
  '{"carousels":[{"topic":"a few words","slides":[{"text":"up to 4 full sentences, blank lines between paragraphs, **bold** allowed"}]}]}\n' +
  `Exactly ${CAROUSELS_PER_DAY} carousels; ${MIN_SLIDES_PER_CAROUSEL} to ${MAX_SLIDES_PER_CAROUSEL} slides each. No prose outside the JSON.`;

// When the house writing framework is installed, IT governs voice, structure, slide composition, CTA
// placement and angle selection — so the hardcoded versions of those rules are dropped rather than
// left to argue with it. All that stays here is the mechanical contract the API and renderer depend
// on: the JSON shape, the daily carousel count, the slide bounds, the sentence cap and no dollar figures.
const MECHANICAL_BASE =
  "You write Instagram text carousels for a fitness creator, in the creator's first-person voice. Follow the AUTHORITATIVE WRITING FRAMEWORK for everything about how to write: voice, hooks, slide structure, angles, and how a carousel ends. The rules below are the output contract and the sentence discipline that makes the copy readable on the canvas.\n" +
  "OUTPUT CONTRACT (non-negotiable):\n" +
  `- Exactly ${CAROUSELS_PER_DAY} carousels, each dismantling a DIFFERENT objection. Each carousel ${MIN_SLIDES_PER_CAROUSEL} to ${MAX_SLIDES_PER_CAROUSEL} slides.\n` +
  `- At most ${MAX_SENTENCES_PER_SLIDE} sentences per slide.\n` +
  "- Plain text only. No markdown, no ** bold markers, no emojis, no hashtags.\n" +
  "- Never include a specific dollar amount; describe money qualitatively.\n" +
  "\nSENTENCE DISCIPLINE — this is what stops the copy reading as a wall of run-on text:\n" +
  "- PUT EVERY SENTENCE ON ITS OWN LINE, with a blank line between them. One sentence, blank line, next sentence. Never run two sentences together in the same paragraph.\n" +
  `- Keep sentences short and punchy. Most under 12 words. NEVER more than ${MAX_WORDS_PER_SENTENCE} words.\n` +
  "- Do not chain clauses with commas to get around that. A comma splice is not a sentence break: if you are joining two thoughts with a comma or an 'and', write two sentences instead.\n" +
  "- Vary the rhythm. A short punch, then a slightly longer beat. Never three sentences of the same length in a row.\n" +
  "Return STRICT JSON and nothing else:\n" +
  '{"carousels":[{"topic":"a few words","objection":"the specific objection this carousel dismantles","source":"where that objection came from","slides":[{"text":"one sentence per line, blank line between them"}]}]}\n' +
  "\nDo not use double-quote characters inside JSON string values.";

// The style exemplars are Tyson/Antwan's physique world — useful register cues for a creator without
// their own doc, but noise for one who has a messaging doc that already defines the register. So they
// are dropped entirely when a doc is present (the doc is the register), and kept register-only otherwise.
//
// hasPack: the house framework is installed. Without it, this returns exactly the pre-framework
// prompt, so a missing framework doc degrades to the old behaviour rather than to nothing.
function buildSys(hasDoc: boolean, hasPack: boolean, prohibitions: string[] = [], voiceRules = "", market = ""): string {
  if (hasPack) {
    // The framework's own voice rules are hoisted here from the stored document. They live in the
    // system prompt because that is where a rule actually changes the output — the same words buried
    // in the reference block below did not hold.
    const voice = voiceRules ? `\n\nTHE FRAMEWORK'S VOICE RULES (authoritative):\n${voiceRules}` : "";
    const absolutes = prohibitions.length
      ? "\n\nABSOLUTE PROHIBITIONS from the framework — these are not stylistic preferences, every one is checked:\n" +
        prohibitions.map((l) => `- ${l}`).join("\n")
      : "";
    return MECHANICAL_BASE + voice + absolutes + market + NO_DOLLARS;
  }
  return BASE + VOICE + BANNED_TELLS + (hasDoc ? "" : STYLE_REFERENCE) + JSON_HYGIENE + market + NO_DOLLARS;
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
  if (carousels.length < CAROUSELS_PER_DAY) {
    // Broken JSON — recover carousel objects individually (each has a slides array).
    const salvaged = salvageObjects<Carousel>(text, ["slides"]);
    if (salvaged.length > carousels.length) carousels = salvaged;
  }
  return carousels
    .map((c) => ({ topic: c.topic, slides: (Array.isArray(c.slides) ? c.slides : []).filter((s) => s && typeof s.text === "string" && s.text.trim()) }))
    .filter((c) => c.slides.length >= 3);
}

const MAX_SENTENCES = MAX_SENTENCES_PER_SLIDE;
// Slide ceiling — shared with the external API validator so both paths hold one contract.
const MAX_SLIDES = MAX_SLIDES_PER_CAROUSEL;
// Count sentences in a slide: terminators (. ! ?) that actually end a sentence. Ellipses and
// decimals shouldn't inflate the count, and a slide with no terminator is still one sentence.
function sentenceCount(text: string): number {
  const t = (text || "").replace(/\.\.\.+/g, ".").replace(/\b\d+\.\d+\b/g, "0");
  const matches = t.match(/[.!?]+(?=\s|$)/g);
  const n = matches ? matches.length : 0;
  return t.trim() ? Math.max(1, n) : 0;
}

// Split a slide's text so EVERY sentence sits on its own line with a blank line between. The model
// is told to write this way; this guarantees it, so the renderer always receives the airy format
// regardless of how the copy came back. Purely structural — no word is added, removed or reordered.
function sentencesOf(text: string): string[] {
  const out: string[] = [];
  for (const para of (text || "").split(/\n+/)) {
    const t = para.trim();
    if (!t) continue;
    // Break after . ! ? when followed by whitespace + a capital/quote/digit; keeps decimals and
    // common abbreviations intact.
    const parts = t
      .replace(/([.!?])\s+(?=["'“]?[A-Z0-9])/g, "$1\u0000")
      .split("\u0000")
      .map((x) => x.trim())
      .filter(Boolean);
    out.push(...parts);
  }
  return out;
}
function toSentencePerLine(text: string): string {
  return sentencesOf(text).join("\n\n");
}
function normalizeCarousels(cs: Carousel[]): Carousel[] {
  return cs.map((c) => ({
    ...c,
    slides: (c.slides || []).map((sl) => ({ ...sl, text: toSentencePerLine(sl.text || "") })),
  }));
}

// A sentence past the word cap reads as a run-on once it wraps on the canvas. Flagged for the one
// retry alongside the sentence-count and style checks; never rewritten in place.
function longSentences(carousels: Carousel[]): { c: number; s: number; words: number }[] {
  const out: { c: number; s: number; words: number }[] = [];
  carousels.forEach((car, ci) =>
    (car.slides || []).forEach((sl, si) => {
      let worst = 0;
      for (const sen of sentencesOf(sl.text || "")) {
        const n = sen.split(/\s+/).filter(Boolean).length;
        if (n > worst) worst = n;
      }
      if (worst > MAX_WORDS_PER_SENTENCE) out.push({ c: ci + 1, s: si + 1, words: worst });
    }),
  );
  return out;
}

// Slides carrying more than 4 sentences. Indices are 1-based (carousel #, slide #) for the retry.
function overLongSlides(carousels: Carousel[]): { c: number; s: number; sentences: number }[] {
  const out: { c: number; s: number; sentences: number }[] = [];
  carousels.forEach((car, ci) =>
    (car.slides || []).forEach((sl, si) => {
      const n = sentenceCount(sl.text || "");
      if (n > MAX_SENTENCES) out.push({ c: ci + 1, s: si + 1, sentences: n });
    }),
  );
  return out;
}

// The framework's absolute bans, checked mechanically so a violation triggers the same targeted
// retry the sentence cap does. Copy is never rewritten in place — an offending slide is named and
// regenerated, and anything that survives is reported rather than silently shipped.
// Checked mechanically so a violation triggers the same targeted retry the sentence cap does. The
// phrase list is supplied by the framework at runtime (frameworkProhibitions) — none of its
// vocabulary lives in this file. The em-dash check is punctuation, so it stands on its own.
function styleViolations(carousels: Carousel[], bannedTerms: string[] = []): { c: number; s: number; issue: string }[] {
  const out: { c: number; s: number; issue: string }[] = [];
  carousels.forEach((car, ci) =>
    (car.slides || []).forEach((sl, si) => {
      const text = sl.text || "";
      const low = text.toLowerCase();
      if (text.includes("—")) out.push({ c: ci + 1, s: si + 1, issue: "em dash" });
      const hit = bannedTerms.find((p) => low.includes(p));
      if (hit) out.push({ c: ci + 1, s: si + 1, issue: `banned phrase "${hit}"` });
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
): Promise<{ ok: true; carousels: Carousel[]; sentenceViolations: number; styleViolations: number } | { ok: false; reason: string }> {
  const [voiceRow, briefs, avoid, playbookRow, doc, pack] = await Promise.all([
    getCurrentVoice(sb, client),
    dossierBriefs(sb, client),
    recentToAvoid(sb, client, forDate),
    getCurrentPlaybook(sb, client),
    getMessagingDoc(sb, client),
    getGlobalFrameworkDoc(sb),
  ]);
  const hasDoc = !!doc;
  const docBlock = messagingDocBlock(doc); // "" for creators without a doc (e.g. Tyson) — no prompt change.
  const packBlock = frameworkBlock(pack); // "" when no framework installed — generator runs as before.
  // The framework's own absolute bans, read out of the stored doc: restated in the system prompt and
  // checked after parsing. Nothing framework-specific is hardcoded here.
  const { lines: packRules, terms: bannedTerms } = frameworkProhibitions(pack);
  const packVoice = frameworkVoiceSection(pack);
  const sys = buildSys(hasDoc, !!pack, packRules, packVoice, marketDirective(client)); // doc creators drop the Tyson/Antwan style exemplars entirely.

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
    // The house framework leads: it governs HOW to write. The creator's own material follows and
    // governs WHAT to write about (their niche, buyer, offer and language).
    packBlock,
    // Leads when there's no framework. For a creator with no buyer voice or dossiers yet, the doc +
    // ICP is the whole basis for the register and the pains — infer his voice from the doc's tone.
    docBlock,
    docBlock
      ? `GROUND EVERY CAROUSEL IN THE CREATOR'S DOCUMENT ABOVE${packBlock ? " (it governs the subject matter; the writing framework governs the craft)" : ", and take the creator's register from it"}. Each carousel must be unmistakably about THIS creator's specific niche, buyer and offer as the document describes them — the buyer's actual situation, the specific outcome they are working toward, and the exact pains and one-liners in the document.${packBlock ? "" : " Slide 1 must name that exact buyer by their identity or situation."} Do NOT default to generic fitness, physique, muscle-building, bulking, macros/calories or weight-loss content: if the document's positioning is not general fitness, none of that belongs here. Honour the document's own 'what to avoid' guidance. Mirror its phrasing; do not invent buyer quotes.`
      : "",
    `THE BUYER (write every carousel for this one person):\n${compactIcp(icp)}`,
    ranked
      ? `WHAT THEY ACTUALLY SAY, RANKED BY HOW OFTEN THEY SAY IT (anchor the carousels in the highest-ranked pains — the top of this list is what most of them are living):\n${ranked}`
      : "",
    voiceRow ? `HOW THIS BUYER TYPE ACTUALLY TALKS (the core material):\n${compactVoice(voiceRow.voice)}` : "",
    briefs ? `REAL BUYER NOTES:\n${briefs}` : "",
    avoid ? `DO NOT REPEAT these recent topics/openers:\n${avoid}` : "",
    packBlock
      ? `Now write today's carousels as the writing framework above directs, for this specific creator and buyer. Return the JSON: exactly ${CAROUSELS_PER_DAY} carousels, each on a DIFFERENT objection, ${MIN_SLIDES_PER_CAROUSEL} to ${MAX_SLIDES_PER_CAROUSEL} slides each. Every sentence on its own line with a blank line between. Short sentences, most under 12 words, none over ${MAX_WORDS_PER_SENTENCE}. Plain text, no dollar figures.`
      : `Return the carousels JSON: exactly ${CAROUSELS_PER_DAY} carousels, ${MIN_SLIDES_PER_CAROUSEL} to ${MAX_SLIDES_PER_CAROUSEL} slides each, each a different pain of the same ICP. Slide 1 of every carousel must call out the ICP directly. Put every sentence on its own line with a blank line between, and keep sentences under ${MAX_WORDS_PER_SENTENCE} words.`,
  ].filter(Boolean).join("\n\n");

  const genOnce = async (feedback?: string): Promise<Carousel[]> => {
    try {
      const content = feedback ? `${userMsg}\n\n${feedback}` : userMsg;
      const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 8000, system: sys, messages: [{ role: "user", content }] });
      logAiUsage({ feature: "buyer-dna-carousels", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      return normalizeCarousels(parse(tb?.text || ""));
    } catch {
      return [];
    }
  };

  let carousels = await genOnce();
  if (carousels.length < CAROUSELS_PER_DAY) {
    const retry = await genOnce();
    if (retry.length > carousels.length) carousels = retry;
  }
  if (carousels.length < CAROUSELS_PER_DAY) return { ok: false, reason: `Could not generate a full set of ${CAROUSELS_PER_DAY} carousels.` };

  // Enforce the ≤4-sentences-per-slide cap AND the framework's absolute style bans. If anything
  // breaks, one targeted retry naming the offenders; keep whichever set has fewer total violations.
  // We never rewrite copy in place — an offender is named and regenerated, and whatever survives is
  // reported rather than silently shipped.
  const score = (cs: Carousel[]) => overLongSlides(cs).length + styleViolations(cs, bannedTerms).length + longSentences(cs).length;
  let total = score(carousels);
  if (total) {
    const longNamed = overLongSlides(carousels).map((v) => `carousel ${v.c} slide ${v.s} (${v.sentences} sentences)`);
    const styleNamed = styleViolations(carousels, bannedTerms).map((v) => `carousel ${v.c} slide ${v.s} (${v.issue})`);
    const longNamedWords = longSentences(carousels).map((v) => `carousel ${v.c} slide ${v.s} (${v.words}-word sentence)`);
    const feedback = [
      longNamed.length
        ? `These slides run longer than ${MAX_SENTENCES} sentences: ${longNamed.join("; ")}. Rewrite them to at most ${MAX_SENTENCES} full sentences each, keeping real sentences with room to breathe (do NOT chop them into fragments). If a slide holds more than that, move the overflow into another slide (a carousel may run up to ${MAX_SLIDES} slides).`
        : "",
      styleNamed.length
        ? `These slides break the framework's absolute style rules: ${styleNamed.join("; ")}. Rewrite them without the em dash or banned phrase — restructure the sentence rather than swapping in a synonym.`
        : "",
      longNamedWords.length
        ? `These slides contain a sentence that is too long: ${longNamedWords.join("; ")}. Break each one into two or more short sentences, each on its own line. Do NOT join them back with a comma or an 'and'.`
        : "",
      "Keep every other slide as it is. Return the full corrected JSON.",
    ].filter(Boolean).join(" ");
    const retry = await genOnce(feedback);
    if (retry.length >= CAROUSELS_PER_DAY && score(retry) <= total) { carousels = retry; total = score(retry); }
  }

  // Normalize to exactly CAROUSELS_PER_DAY carousels, each clamped to the slide ceiling.
  const set = carousels.slice(0, CAROUSELS_PER_DAY).map((c) => ({ topic: c.topic || "", slides: c.slides.slice(0, MAX_SLIDES) }));
  const sentenceViolations = overLongSlides(set).length;
  const styleIssues = styleViolations(set, bannedTerms).length + longSentences(set).length;
  return { ok: true, carousels: set, sentenceViolations, styleViolations: styleIssues };
}
