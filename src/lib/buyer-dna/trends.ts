// What is working on social RIGHT NOW to attract this creator's buyer type. Refreshed weekly
// via live web search (Anthropic server tool), so idea grading tracks the current moment, not
// the model's training data. Falls back to model knowledge if search is unavailable.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import type { Icp } from "./icp";
import { extractJson } from "./json";

const MODEL = "claude-sonnet-4-6";

export type TrendBrief = {
  summary?: string;
  formats?: { name?: string; why?: string; signal?: string }[];
  hooks?: string[];
  do?: string[];
  avoid?: string[];
};

const SYS =
  "You research what short-form content (Instagram Reels, TikTok) is CURRENTLY working for fitness coaches to attract a specific type of premium buyer. Use web search to find what is performing in the last 60-90 days: formats, hook styles, delivery styles, pacing. You care about what attracts BUYERS of high-ticket coaching, not what farms empty views. Return STRICT JSON:\n" +
  '{"summary":"2-3 sentences on what is working right now for this buyer type","formats":[{"name":"format in a few words","why":"why it works for this buyer right now","signal":"the evidence you saw"}],"hooks":["a hook STYLE that is landing right now"],"do":["specific things to do in content right now"],"avoid":["things that are burned out or repel this buyer"]}\n' +
  "5 to 8 formats, 4 to 8 items in the other lists. Specific and current, never generic evergreen advice. No prose outside the JSON." +
  "\nDo not use double-quote characters inside JSON string values. Keep every string field to at most 2 sentences." +
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

function parse(text: string): TrendBrief | null {
  return extractJson<TrendBrief>(text);
}

export async function getCurrentTrendBrief(sb: SupabaseClient, client: string) {
  const { data } = await sb
    .from("content_trend_briefs")
    .select("*")
    .eq("client_key", client)
    .order("version", { ascending: false })
    .limit(1);
  return data && data[0] ? (data[0] as { version: number; brief: TrendBrief; searched_at: string; searched: boolean }) : null;
}

export function compactTrendBrief(t: TrendBrief): string {
  const line = (label: string, v?: string[]) => (v && v.length ? `${label}: ${v.slice(0, 8).join("; ")}` : "");
  return [
    t.summary || "",
    (t.formats || [])
      .slice(0, 8)
      .map((f) => `- ${f.name}: ${f.why || ""}`)
      .join("\n"),
    line("Hook styles landing now", t.hooks),
    line("Do", t.do),
    line("Avoid", t.avoid),
  ]
    .filter(Boolean)
    .join("\n");
}

// Generate + store a new trend brief version for one creator. Grounded in the creator's ICP so
// the research targets THEIR buyer, not fitness content in general.
export async function refreshTrendBrief(
  sb: SupabaseClient,
  client: string,
  icp: Icp | null,
  anthropic: Anthropic,
): Promise<{ ok: true; version: number; searched: boolean } | { ok: false; reason: string }> {
  const buyerDigest = icp
    ? [
        icp.one_line || "",
        `Pains: ${(icp.top_pains || []).slice(0, 6).join("; ")}`,
        `Wants: ${(icp.desires || []).slice(0, 5).join("; ")}`,
        `Their words: ${(icp.language || []).slice(0, 8).join("; ")}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "A premium ($1,200+) online fitness coaching buyer.";

  const userMsg = `THE BUYER THIS CREATOR NEEDS TO ATTRACT:\n${buyerDigest}\n\nToday is ${new Date().toISOString().slice(0, 10)}. Research what is working on Instagram Reels and TikTok RIGHT NOW to attract this kind of person to a fitness coach, then return the JSON.`;

  // One generation attempt: live web search, falling back to model knowledge if the search tool is
  // unavailable on this key/org. Returns null text only if the API call itself throws.
  const gen = async (): Promise<{ text: string; searched: boolean } | null> => {
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 3000,
        system: SYS,
        // Server-side web search tool; the API runs the searches itself.
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 } as unknown as Anthropic.Tool],
        messages: [{ role: "user", content: userMsg }],
      });
      logAiUsage({ feature: "buyer-dna-trends", model: MODEL, usage: resp.usage });
      return {
        text: resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n"),
        searched: true,
      };
    } catch {
      try {
        const resp = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 3000,
          system: SYS.replace("Use web search to find", "From your knowledge, describe"),
          messages: [{ role: "user", content: userMsg }],
        });
        logAiUsage({ feature: "buyer-dna-trends", model: MODEL, usage: resp.usage });
        const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
        return { text: tb?.text || "", searched: false };
      } catch {
        return null;
      }
    }
  };

  let res = await gen();
  if (!res) return { ok: false, reason: "Trend research failed." };
  let brief = parse(res.text);
  // Retry the generation once if the model's JSON did not parse into a usable brief.
  if (!brief || !(brief.formats || []).length) {
    const retry = await gen();
    if (retry) {
      res = retry;
      brief = parse(retry.text);
    }
  }
  if (!brief || !(brief.formats || []).length) return { ok: false, reason: "Could not parse a trend brief from the model." };
  const searched = res.searched;

  const current = await getCurrentTrendBrief(sb, client);
  const version = current ? Number(current.version) + 1 : 1;
  const { error } = await sb.from("content_trend_briefs").insert({
    client_key: client,
    version,
    brief,
    searched,
    model: MODEL,
    searched_at: new Date().toISOString(),
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, version, searched };
}
