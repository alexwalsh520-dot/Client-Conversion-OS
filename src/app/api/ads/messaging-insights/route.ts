import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";
import { logAiUsage } from "@/lib/ai-usage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-sonnet-4-20250514";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — insights move with the data, not the minute.
const MIN_SPEND_FOR_RELIABLE = 100; // mirror MIN_SPEND_FOR_RELIABLE_ROAS — don't draw lessons from noise.
// Bump when the prompt changes so cached insights regenerate against the new
// rules instead of serving an answer written under the old ones.
const PROMPT_VERSION = "v3-copy-only-no-contradict";
// Two ads count as "the same copy" when ≥85% of their words overlap. The same
// message often runs more than once (a relaunch, or a near-twin like "Spring"
// vs "Summer"); blending those into one entry is what stops the brief from
// calling the same words both winning and losing.
const SAME_COPY_THRESHOLD = 0.85;

// The software's job here: connect what each ad SAYS to what it DID (spend,
// revenue, ROAS, new clients) and explain it in plain English — but every claim
// must be defensible to a skeptical CMO: backed by the real dollars, the ad
// count and the ROAS, with the actual words quoted. It must ground every claim
// in the numbers we hand it; it is told NOT to invent figures.
const SYSTEM_PROMPT = `You are a copywriter analyzing ad COPY for a coaching business. Your reader is the founder — smart but not technical — and he uses your read to write his next ads. Every statement must be defensible straight from the data and never invented.

You receive a list of ads. For each: the exact WORDS on the ad (its hook/message), ad spend ($), revenue collected ($), ROAS (revenue ÷ spend), and new clients. Ads marked reliable:true have enough spend ($100+) to draw conclusions from; reliable:false ads are "too early to tell".

Your job is NARROW: tie the WORDS to the MONEY. Name the wording/angle that wins and the one that loses — and back each with the real numbers and a direct quote. You are ONLY a copywriter. You speak ONLY about copy: the words, the hook, the angle, the offer framing, the structure of the message.

STAY IN YOUR LANE — never mention or speculate about anything that is NOT the copy itself:
- NO targeting, audience, lookalikes, interests, placements, age, or location.
- NO campaign names, ad sets, budgets, bidding, timing, relaunches, or which creator ran it.
- NO funnel, DM-setting, or booking-process commentary.
If two ads have different results but the same words, that difference was NOT caused by the copy — so it is none of your business. Say nothing about why; just don't draw a copy lesson from it.

NEVER CONTRADICT YOURSELF:
- The input has already been collapsed so each distinct MESSAGE appears once, with its blended return. Treat every entry as a separate message.
- If two entries read as essentially the same words (a near-identical hook), DO NOT call one winning and the other losing. Same words cannot be both. If their results disagree, the copy is not the deciding factor — leave that copy out of both the winning and losing read entirely.
- Only call a message "losing" when its words are genuinely DIFFERENT from your winning ones. Winning vs losing must be a real contrast in wording, not the same line under different conditions.

HARD RULES:
- Use ONLY the numbers provided. NEVER invent, estimate, or wildly round a figure.
- Every claim about winning/losing copy MUST cite: the dollars behind it, HOW MANY ads, and the ROAS — and quote the actual words. Example shape: 'The 3 ads that open with a question ("...") returned 4.1× on $2,300 spent.'
- Draw firm lessons ONLY from reliable:true ads. If only low-spend ads exist, say it's too early and set confidence "low".
- Be specific, never generic. "Curiosity hooks work" is useless. "<exact phrase> returned <X>× on $<Y> across <N> ads" is the bar.
- Plain, direct English. Short sentences. No marketing jargon. No percentages unless they're in the data.
- If there isn't enough genuinely-different copy to contrast, leave losing_message empty rather than reaching for a false contrast.

Return ONLY valid JSON, no markdown:
{
  "headline": "<one sentence: the single most useful, number-backed COPY insight right now>",
  "winning_message": "<the wording/angle making money — name the dollars, the ad count and the ROAS, and quote the words. empty string if genuinely unclear>",
  "losing_message": "<DIFFERENT wording that wastes money — same: dollars, ad count, ROAS, quoted words. empty string if there is no genuinely-different losing copy to contrast>",
  "takeaways": ["<2-4 concrete, number-bearing copy actions he can take this week — about wording only>"],
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

type AdRow = {
  adName: string;
  clientKey: string;
  words: string;
  spend: number;
  revenue: number;
  roas: number;
  clients: number;
  reliable: boolean;
};

function copyTokenSet(words: string): Set<string> {
  return new Set(
    String(words || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
  );
}
function copyJaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  a.forEach((t) => {
    if (b.has(t)) inter++;
  });
  const uni = a.size + b.size - inter;
  return uni > 0 ? inter / uni : 0;
}

// Collapse essentially-identical copy (relaunches, near-twins) into ONE entry,
// blending real spend/revenue. The AI then sees each distinct MESSAGE once and
// physically cannot label the same words both winning and losing.
function clusterCopy(rows: AdRow[]): AdRow[] {
  const clusters: { toks: Set<string>; items: AdRow[] }[] = [];
  for (const r of rows) {
    const toks = copyTokenSet(r.words);
    let host = clusters.find((c) => copyJaccard(toks, c.toks) >= SAME_COPY_THRESHOLD);
    if (!host) {
      host = { toks, items: [] };
      clusters.push(host);
    }
    host.items.push(r);
  }
  return clusters.map((c) => {
    const items = c.items;
    const spend = items.reduce((s, a) => s + a.spend, 0);
    const revenue = items.reduce((s, a) => s + a.revenue, 0);
    const clients = items.reduce((s, a) => s + a.clients, 0);
    const lead = [...items].sort((a, b) => b.spend - a.spend)[0];
    const longest = items.reduce((m, a) => (a.words.length > m.length ? a.words : m), "");
    const names = Array.from(new Set(items.map((a) => a.adName).filter(Boolean)));
    return {
      adName: items.length > 1 ? `${names.length || items.length} ads · same copy` : lead.adName,
      clientKey: lead.clientKey,
      words: longest || lead.words,
      spend,
      revenue,
      roas: spend > 0 ? Math.round((revenue / spend) * 10) / 10 : 0,
      clients,
      reliable: items.some((a) => a.reliable),
    };
  });
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

    // Keep only ads whose image actually has words read off it, then collapse
    // essentially-identical copy into one message so the AI never contradicts
    // itself across two runs of the same words.
    const withCopy = incoming
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
    const ads = clusterCopy(withCopy);

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

    // Track spend against the AI budget. Fire-and-forget; never blocks/breaks.
    logAiUsage({ feature: "ads-messaging-insights", model: MODEL, usage: ai.usage });

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
