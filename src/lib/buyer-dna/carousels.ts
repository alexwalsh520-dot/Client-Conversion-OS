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
import { extractJson, salvageObjects } from "./json";

const MODEL = "claude-sonnet-4-6";

const JSON_HYGIENE =
  "\nDo not use double-quote characters inside JSON string values. Keep every string field to at most 2 sentences.";
const NO_DOLLARS =
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

export type CarouselSlide = { text?: string; blocks?: unknown[] };
export type Carousel = { topic?: string; slides: CarouselSlide[] };

const SYS =
  "You write Instagram text carousels for a fitness creator, in the creator's first-person voice. Each carousel is ONE idea aimed at ONE specific premium buyer, articulating that buyer's pain better than they can say it themselves — they should feel read. Slide 1 must stop the scroll on its own (credibility opener, pattern-interrupt, or the pain said perfectly). Slides build one thought each — short, punchy paragraphs, generous line breaks, occasional **bold** on the words that matter. Final slide lands the takeaway and a soft invitation to follow or DM — never a hard pitch, never hashtags, never emojis. The 5 carousels must EACH take a different angle: pain articulated, personal story, myth broken, pattern observed, hard truth. Infer the creator's register from the buyer material below. Return STRICT JSON:\n" +
  '{"carousels":[{"topic":"a few words","slides":[{"text":"paragraphs separated by blank lines, **bold** allowed"}]}]}\n' +
  "Exactly 5 carousels, 6 to 8 slides each. No prose outside the JSON." +
  JSON_HYGIENE +
  NO_DOLLARS;

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

// Topics + slide-1 texts from the creator's last 3 days, so the model does not repeat itself.
async function recentToAvoid(sb: SupabaseClient, client: string, forDate: string): Promise<string> {
  const from = new Date(`${forDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 3);
  const fromStr = from.toISOString().slice(0, 10);
  const { data } = await sb
    .from("content_carousels")
    .select("topic, slides")
    .eq("client_key", client)
    .gte("for_date", fromStr)
    .lt("for_date", forDate)
    .limit(30);
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

// One LLM call: generate the 5 carousels for one creator for one day. Does not touch the DB.
export async function generateCarouselSet(
  sb: SupabaseClient,
  client: string,
  forDate: string,
  icp: Icp | null,
  anthropic: Anthropic,
): Promise<{ ok: true; carousels: Carousel[] } | { ok: false; reason: string }> {
  const [voiceRow, briefs, avoid] = await Promise.all([
    getCurrentVoice(sb, client),
    dossierBriefs(sb, client),
    recentToAvoid(sb, client, forDate),
  ]);

  const userMsg = [
    `THE BUYER (write every carousel for this one person):\n${compactIcp(icp)}`,
    voiceRow ? `HOW THIS BUYER TYPE ACTUALLY TALKS (the core material):\n${compactVoice(voiceRow.voice)}` : "",
    briefs ? `REAL BUYER NOTES:\n${briefs}` : "",
    avoid ? `DO NOT REPEAT these recent topics/openers:\n${avoid}` : "",
    "Return the carousels JSON: exactly 5 carousels, each 6 to 8 slides, each a different angle.",
  ].filter(Boolean).join("\n\n");

  const genOnce = async (): Promise<Carousel[]> => {
    try {
      const resp = await anthropic.messages.create({ model: MODEL, max_tokens: 8000, system: SYS, messages: [{ role: "user", content: userMsg }] });
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

  // Normalize to exactly 5 carousels, each clamped to 6-8 slides.
  const set = carousels.slice(0, 5).map((c) => ({ topic: c.topic || "", slides: c.slides.slice(0, 8) }));
  return { ok: true, carousels: set };
}
