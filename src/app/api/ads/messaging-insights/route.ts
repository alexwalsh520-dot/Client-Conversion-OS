import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-20250514";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — insights move with the data, not the minute.
const MIN_SPEND_FOR_RELIABLE = 100; // mirror MIN_SPEND_FOR_RELIABLE_ROAS — don't draw lessons from noise.
// Bump when the prompt changes so cached insights regenerate against the new
// rules instead of serving an answer written under the old ones.
const PROMPT_VERSION = "v2-cmo-evidence";

// The software's job here: connect what each ad SAYS to what it DID (spend,
// revenue, ROAS, new clients) and explain it in plain English — but every claim
// must be defensible to a skeptical CMO: backed by the real dollars, the ad
// count and the ROAS, with the actual words quoted. It must ground every claim
// in the numbers we hand it; it is told NOT to invent figures.
const SYSTEM_PROMPT = `You analyze ad-creative performance for a coaching business. Your reader is the founder — smart but not technical — and he may put your words in front of a CMO, so every statement must be defensible straight from the data and never invented.

You receive a list of ads. For each: the exact WORDS on the ad (its hook/message), ad spend ($), revenue collected ($), ROAS (revenue ÷ spend), and new clients. Ads marked reliable:true have enough spend ($100+) to draw conclusions from; reliable:false ads are "too early to tell".

Your job: tie the MESSAGING to the MONEY. Name the angle/wording that wins and the one that loses — and back each with the real numbers and a direct quote.

HARD RULES:
- Use ONLY the numbers provided. NEVER invent, estimate, or wildly round a figure.
- Every claim about winning/losing messaging MUST cite: the dollars behind it (combined spend of the ads it covers), HOW MANY ads, and their ROAS — and quote the actual words. Example shape: 'The 3 ads that open with a question ("...") returned 4.1× on $2,300 spent.'
- Draw firm lessons ONLY from reliable:true ads. If only low-spend ads exist, say it's too early and set confidence "low".
- Be specific, never generic. "Curiosity hooks work" is useless. "<exact phrase> returned <X>× on $<Y> across <N> ads" is the bar.
- Plain, direct English. Short sentences. No marketing jargon. No percentages unless they're in the data.
- If there isn't enough data to say something real, say so honestly rather than reaching.

Return ONLY valid JSON, no markdown:
{
  "headline": "<one sentence: the single most useful, number-backed messaging insight right now>",
  "winning_message": "<the angle/wording making money — name the dollars, the ad count and the ROAS, and quote the words. empty string if genuinely unclear>",
  "losing_message": "<the angle/wording wasting money — same: dollars, ad count, ROAS, quoted words. empty string if unclear>",
  "takeaways": ["<2-4 concrete, number-bearing actions he can take this week>"],
  "confidence": "high" | "medium" | "low"
}`;

type AdInput = {
  adId?: unknown;
  adName?: unknown;
  clientKey?: unknown;
  adSpend?: unknown;
  collectedRevenue?: unknown;
  collectedRoi?: unknown;
  newClients?: unknown;
  roasReliable?: unknown;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const adsRaw: AdInput[] = Array.isArray(body.ads) ? body.ads : [];
    const scope = typeof body.scope === "string" && body.scope.trim() ? body.scope.trim() : "all";

    const supabase = getServiceSupabase();

    // Pull the read copy straight from the store (the single source of truth),
    // so the moment the backfill has read an ad its words feed the analysis —
    // no dependence on what the (possibly stale) client passed in.
    const incoming = adsRaw
      .map((a) => ({
        adId: typeof a.adId === "string" ? a.adId.trim() : "",
        adName: typeof a.adName === "string" ? a.adName : "",
        clientKey: typeof a.clientKey === "string" ? a.clientKey : "",
        spend: Math.round(num(a.adSpend)),
        revenue: Math.round(num(a.collectedRevenue)),
        roas: Math.round(num(a.collectedRoi) * 10) / 10,
        clients: Math.round(num(a.newClients)),
        reliable:
          typeof a.roasReliable === "boolean" ? a.roasReliable : num(a.adSpend) >= MIN_SPEND_FOR_RELIABLE,
      }))
      .filter((a) => a.adId);

    const copyByAd = new Map<string, string>();
    const ids = incoming.map((a) => a.adId);
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data } = await supabase
        .from("ad_creative_copy")
        .select("ad_id,on_image_text")
        .in("ad_id", chunk);
      (data || []).forEach((r: { ad_id: string; on_image_text: string | null }) => {
        copyByAd.set(r.ad_id, r.on_image_text || "");
      });
    }

    // Keep only ads whose image actually has words read off it.
    const ads = incoming
      .map((a) => ({
        adName: a.adName,
        clientKey: a.clientKey,
        words: (copyByAd.get(a.adId) || "").trim(),
        spend: a.spend,
        revenue: a.revenue,
        roas: a.roas,
        clients: a.clients,
        reliable: a.reliable,
      }))
      .filter((a) => a.words);

    const reliableCount = ads.filter((a) => a.reliable).length;

    if (ads.length === 0) {
      return NextResponse.json({
        status: "not_ready",
        reason: copyByAd.size === 0 ? "no_copy_yet" : "no_text_ads",
        insight: null,
      });
    }
    const inputsHash = createHash("sha1")
      .update(PROMPT_VERSION + "|" + JSON.stringify(ads.map((a) => [a.words, a.spend, a.revenue, a.clients])))
      .digest("hex");

    // Cache: same inputs within the TTL → return the stored insight.
    const { data: cached } = await supabase
      .from("ad_messaging_insights")
      .select("inputs_hash,payload,created_at")
      .eq("scope", scope)
      .maybeSingle();

    if (
      cached &&
      cached.inputs_hash === inputsHash &&
      cached.created_at &&
      Date.now() - new Date(cached.created_at).getTime() < CACHE_TTL_MS
    ) {
      return NextResponse.json({ status: "ok", cached: true, insight: cached.payload });
    }

    const userPayload = {
      note: "reliable:true means enough spend to trust. Only draw firm lessons from those.",
      ads,
    };

    const response = new Anthropic();
    const ai = await response.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Here are the ads with their words and results. ${reliableCount} of ${ads.length} have enough spend to trust.\n\n${JSON.stringify(
            userPayload
          )}\n\nReturn the JSON insight.`,
        },
      ],
    });

    const textContent = ai.content.find((c) => c.type === "text");
    let insight: unknown = null;
    if (textContent && textContent.type === "text") {
      let jsonStr = textContent.text.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      try {
        insight = JSON.parse(jsonStr);
      } catch {
        insight = { headline: jsonStr.slice(0, 200), takeaways: [], confidence: "low" };
      }
    }

    await supabase
      .from("ad_messaging_insights")
      .upsert(
        { scope, inputs_hash: inputsHash, payload: insight, model: MODEL },
        { onConflict: "scope" }
      );

    return NextResponse.json({ status: "ok", cached: false, insight, reliableCount, total: ads.length });
  } catch (error: unknown) {
    console.error("Messaging insights error:", error);
    const message = error instanceof Error ? error.message : "Insights failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
