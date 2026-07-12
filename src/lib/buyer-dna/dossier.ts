// Build a research dossier on ONE buyer from their call + DMs + the ad that brought them in.
// One LLM call per buyer -> structured research. Upserts buyer_dossiers on (client_key, person_key).

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import { gatherBuyerData, type QualifiedBuyer } from "./core";

const MODEL = "claude-sonnet-4-6";

const SYS =
  "You are researching ONE person who PAID for a fitness coaching program, using their real sales call transcript and their DM conversation. Find what actually made this person buy, in THEIR terms, so the coach can make content that attracts more people like them. Use only what the material supports. Never invent. Return STRICT JSON:\n" +
  '{"summary":"2-3 plain sentences on who they are and why they bought","what_brought_them_in":"the trigger or what was going on in their life when they reached out","pains":["specific pain in their words"],"limiting_beliefs":["a belief that was holding them back"],"objections":["what made them hesitate before buying"],"deciding_moment":"what tipped them into buying","their_words":["short verbatim quotes worth mirroring in content"]}\n' +
  "3 to 6 items max per list. If something is genuinely not in the material, use an empty array or a short 'unclear'. No prose outside the JSON." +
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

export type Research = {
  summary?: string;
  what_brought_them_in?: string;
  pains?: string[];
  limiting_beliefs?: string[];
  objections?: string[];
  deciding_moment?: string;
  their_words?: string[];
};

function parseJson(text: string): Research | null {
  const raw = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try {
    return JSON.parse(raw.slice(a, b + 1)) as Research;
  } catch {
    return null;
  }
}

// Returns "built" if a dossier was written, "thin" if there was not enough material, "error" on failure.
export async function buildDossier(
  sb: SupabaseClient,
  client: string,
  buyer: QualifiedBuyer,
  anthropic: Anthropic,
  thresholdCents: number,
): Promise<"built" | "thin" | "error"> {
  const d = await gatherBuyerData(sb, client, buyer);

  // Need at least a call transcript or a real DM thread to research a person.
  const hasCall = (d.callTranscript || "").length > 400;
  const hasDms = (d.dmText || "").length > 200;
  if (!hasCall && !hasDms) {
    // Still record the buyer with empty research so we do not re-check them every run.
    await sb.from("buyer_dossiers").upsert(
      {
        client_key: client,
        person_key: buyer.personKey,
        subscriber_id: buyer.subscriberId,
        display_name: buyer.name,
        close_date: buyer.closeDate,
        amount_cents: buyer.amountCents,
        closer: buyer.closer,
        setter: buyer.setter,
        first_keyword: d.firstKeyword,
        ad_id: d.adId,
        ad_on_image_text: d.adOnImage,
        ad_primary_text: d.adPrimary,
        data_completeness: d.completeness,
        research: {},
        model: null,
        qualifies_icp: buyer.amountCents >= thresholdCents,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_key,person_key" },
    );
    return "thin";
  }

  const parts: string[] = [
    `BUYER: ${buyer.name} (paid $${Math.round(buyer.amountCents / 100)})`,
  ];
  if (d.firstKeyword) parts.push(`Came in on ad keyword: ${d.firstKeyword}`);
  if (d.adOnImage) parts.push(`Words on the ad they responded to: ${d.adOnImage}`);
  if (d.adPrimary) parts.push(`Ad caption: ${String(d.adPrimary).slice(0, 600)}`);
  if (buyer.objection) parts.push(`Objection logged by setter: ${buyer.objection}`);
  if (hasCall) parts.push(`\nSALES CALL TRANSCRIPT:\n${(d.callTranscript || "").slice(0, 55000)}`);
  if (hasDms) parts.push(`\nDM CONVERSATION:\n${(d.dmText || "").slice(0, 18000)}`);

  let research: Research | null = null;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: SYS,
      messages: [{ role: "user", content: parts.join("\n") }],
    });
    logAiUsage({ feature: "buyer-dna-dossier", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    research = parseJson(tb?.text || "");
  } catch {
    return "error";
  }
  if (!research) return "error";

  await sb.from("buyer_dossiers").upsert(
    {
      client_key: client,
      person_key: buyer.personKey,
      subscriber_id: buyer.subscriberId,
      display_name: buyer.name,
      close_date: buyer.closeDate,
      amount_cents: buyer.amountCents,
      closer: buyer.closer,
      setter: buyer.setter,
      first_keyword: d.firstKeyword,
      ad_id: d.adId,
      ad_on_image_text: d.adOnImage,
      ad_primary_text: d.adPrimary,
      data_completeness: d.completeness,
      research,
      source_ids: { call: d.callTitle || null, dm_count: d.dmCount },
      model: MODEL,
      qualifies_icp: buyer.amountCents >= thresholdCents,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_key,person_key" },
  );
  return "built";
}
