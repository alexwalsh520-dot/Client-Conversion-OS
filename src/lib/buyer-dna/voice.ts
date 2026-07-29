// The "buyer voice" — the aggregate overview at the top of the creator's Buyers tab. Synthesizes the
// collective voice across everyone who paid: what they keep saying, what they notably don't, the most
// common pains + objections, and a synopsis. Grounded ONLY in the real buyer dossiers (never fabricated
// from the ICP alone). Refreshed weekly (and on ICP bump) by the video-ideas-pipeline cron.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import { marketDirective } from "@/lib/content/market";
import type { Icp } from "./icp";
import type { Research } from "./dossier";
import { extractJson, salvageObjects } from "./json";
import { audienceLockLine } from "@/lib/creators";

const MODEL = "claude-sonnet-4-6";

// Same hygiene lines used by video-ideas.ts / shift.ts, inlined so this lib is self-contained.
const JSON_HYGIENE =
  "\nDo not use double-quote characters inside JSON string values. Keep every string field to at most 2 sentences.";
const NO_DOLLARS =
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

// Below this many researched buyers we refuse rather than fabricate an "average" from too few people.
const MIN_BUYERS = 5;

export type BuyerVoice = {
  synopsis?: string;
  saying?: { theme?: string; example?: string }[];
  not_saying?: { absence?: string; meaning?: string }[];
  top_pains?: { pain?: string; how_common?: string }[];
  top_objections?: { objection?: string; how_common?: string }[];
};

const SYS =
  "You are synthesizing the collective voice of every person who paid $1,200+ for this fitness creator's coaching, from research briefs on each real buyer. Report only patterns the briefs support; frequency claims must reflect actual recurrence across the briefs, stated qualitatively ('over half', 'about a third', 'a handful'). The NOT-saying section is what you would expect this type of buyer to talk about but which barely appears — and what that absence means for content. Return STRICT JSON:\n" +
  '{"synopsis":"3-5 plain sentences: the core of what this buyer type says and wants","saying":[{"theme":"what they keep saying","example":"a short representative quote or paraphrase in their words"}],"not_saying":[{"absence":"what they notably do not say","meaning":"one sentence on what that tells the creator"}],"top_pains":[{"pain":"the pain in a few words","how_common":"qualitative frequency"}],"top_objections":[{"objection":"the objection in a few words","how_common":"qualitative frequency"}]}\n' +
  "4 to 6 saying, 3 to 5 not_saying, 4 to 6 top_pains (most common first), 3 to 5 top_objections (most common first). No prose outside the JSON." +
  JSON_HYGIENE +
  NO_DOLLARS;

// Richer per-buyer digest than the other generators: their_words matters most for voice.
async function voiceBriefs(sb: SupabaseClient, client: string): Promise<{ briefs: string; count: number }> {
  const { data: dossiers } = await sb
    .from("buyer_dossiers")
    .select("research")
    .eq("client_key", client)
    .eq("qualifies_icp", true)
    .limit(300);
  const rich = ((dossiers || []) as { research: Research }[])
    .map((doc) => {
      const r = doc.research || {};
      if (!r || !Object.keys(r).length) return "";
      const line = (label: string, v: unknown) => (Array.isArray(v) && v.length ? `${label}: ${v.slice(0, 4).join("; ")}` : "");
      return [
        r.what_brought_them_in ? `trigger: ${r.what_brought_them_in}` : "",
        line("pains", r.pains),
        line("objections", r.objections),
        line("beliefs", r.limiting_beliefs),
        line("words", r.their_words),
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .filter(Boolean);
  return { briefs: rich.slice(0, 60).join("\n").slice(0, 40000), count: rich.length };
}

export async function getCurrentVoice(sb: SupabaseClient, client: string) {
  const { data } = await sb
    .from("content_buyer_voice")
    .select("*")
    .eq("client_key", client)
    .order("version", { ascending: false })
    .limit(1);
  return data && data[0] ? (data[0] as { version: number; icp_version: number | null; buyer_count: number | null; voice: BuyerVoice; generated_at: string }) : null;
}

function parse(text: string): BuyerVoice | null {
  const p = extractJson<BuyerVoice>(text);
  if (p && p.synopsis && Array.isArray(p.saying) && p.saying.length) return p;
  // Broken JSON — recover each section's objects individually and keep whatever the synopsis was.
  const saying = p && Array.isArray(p.saying) && p.saying.length ? p.saying : salvageObjects<{ theme?: string; example?: string }>(text, ["theme"]);
  if (!(p?.synopsis) && !saying.length) return null;
  return {
    synopsis: p?.synopsis,
    saying,
    not_saying: p && Array.isArray(p.not_saying) && p.not_saying.length ? p.not_saying : salvageObjects<{ absence?: string; meaning?: string }>(text, ["absence"]),
    top_pains: p && Array.isArray(p.top_pains) && p.top_pains.length ? p.top_pains : salvageObjects<{ pain?: string; how_common?: string }>(text, ["pain", "how_common"]),
    top_objections: p && Array.isArray(p.top_objections) && p.top_objections.length ? p.top_objections : salvageObjects<{ objection?: string; how_common?: string }>(text, ["objection", "how_common"]),
  };
}

const usable = (v: BuyerVoice | null): v is BuyerVoice => !!v && !!v.synopsis && Array.isArray(v.saying) && v.saying.length > 0;

// Generate + store a new buyer-voice version for one creator, grounded in the real buyer dossiers.
export async function refreshVoice(
  sb: SupabaseClient,
  client: string,
  icp: Icp | null,
  icpVersion: number | null,
  anthropic: Anthropic,
): Promise<{ ok: true; version: number; buyer_count: number } | { ok: false; reason: string }> {
  const { briefs, count } = await voiceBriefs(sb, client);
  // Never fabricate a collective voice from too few real buyers (or from the ICP alone).
  if (count < MIN_BUYERS) return { ok: false, reason: `Not enough researched buyers yet to synthesize a voice (${count} so far; need at least ${MIN_BUYERS}).` };

  const anchor = icp?.one_line || "A premium buyer who paid for 1:1 fitness coaching.";
  const userMsg = `THE IDEAL BUYER (anchor):\n${anchor}\n\nRESEARCH BRIEFS ON ${count} REAL BUYERS WHO PAID:\n${briefs}\n\nReturn the buyer-voice JSON. Every frequency claim must reflect the actual recurrence across these ${count} briefs.`;

  const gen = async (): Promise<string | null> => {
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: audienceLockLine(client) + SYS + marketDirective(client),
        messages: [{ role: "user", content: userMsg }],
      });
      logAiUsage({ feature: "buyer-dna-voice", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      return tb?.text || "";
    } catch {
      return null;
    }
  };

  let text = await gen();
  if (text === null) return { ok: false, reason: "Buyer-voice synthesis failed." };
  let voice = parse(text);
  if (!usable(voice)) {
    const retry = await gen();
    if (retry !== null) { text = retry; voice = parse(retry); }
  }
  if (!usable(voice)) return { ok: false, reason: "Could not parse a usable buyer voice from the model." };

  const current = await getCurrentVoice(sb, client);
  const version = current ? Number(current.version) + 1 : 1;
  const { error } = await sb.from("content_buyer_voice").insert({
    client_key: client,
    version,
    icp_version: icpVersion,
    buyer_count: count,
    voice,
    model: MODEL,
    generated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, version, buyer_count: count };
}
