// 10 filmable video ideas per buyer (from their real call + DM transcripts) and 10 for the ICP
// as a whole. Every idea carries the full execution recipe: hook, environment, attire,
// expression, word choice, and why it attracts that buyer. A separate pass grades each idea
// against the current trend brief (what is working on social right now).

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import type { Icp } from "./icp";
import type { Research } from "./dossier";
import { gatherBuyerData, normName, type QualifiedBuyer } from "./core";
import { compactTrendBrief, type TrendBrief } from "./trends";

const MODEL = "claude-sonnet-4-6";

export type VideoIdea = {
  title?: string;
  format?: string;
  hook?: string;
  environment?: string;
  attire?: string;
  expression?: string;
  word_choice?: string;
  rationale?: string;
  grounded_in?: string;
};

const IDEA_SHAPE =
  '{"ideas":[{"title":"the idea in a few words","format":"the content format (talking head, day in the life, story time, tutorial, skit, b-roll voiceover...)","hook":"the exact spoken opening line, in the buyer\'s world","environment":"where and how to film it (location, framing, time of day)","attire":"what to wear and why it reads right to this buyer","expression":"delivery: energy, pace, facial expression, tone","word_choice":"specific words and phrases to say (mirror the buyer\'s language) and words to avoid","rationale":"why this attracts THIS kind of buyer","grounded_in":"the specific insight or quote this came from"}]}';

const BUYER_SYS =
  "You design ORGANIC short-form video ideas for a fitness creator, reverse-engineered from ONE real person who paid $1,200+ for coaching. You have their sales call transcript and DM conversation. Your job: 10 video ideas that would attract MORE PEOPLE LIKE THIS ONE. Every idea must be filmable this week, grounded in this buyer's real pains, beliefs, trigger moment, and exact words. Make the buyer type feel seen; never a generic fitness tip, never a hard call-out. Return STRICT JSON:\n" +
  IDEA_SHAPE +
  "\nExactly 10 ideas. No prose outside the JSON.";

const ICP_SYS =
  "You design ORGANIC short-form video ideas for a fitness creator, built from their Ideal Customer Profile (learned from everyone who paid $1,200+) and research briefs on those real buyers. Your job: 10 video ideas that attract MORE of that ideal buyer. Every idea must be filmable this week, grounded in the buyers' recurring pains, beliefs, triggers, and exact words. Make the ideal buyer feel seen; never a generic fitness tip. Return STRICT JSON:\n" +
  IDEA_SHAPE +
  "\nExactly 10 ideas. No prose outside the JSON.";

const GRADE_SYS =
  "You grade a fitness creator's UNFILMED video ideas against what is currently working on Instagram Reels and TikTok to attract premium coaching buyers. Be a tough, specific grader. High scores only for ideas that ride what is working right now; low scores for burned-out or algorithm-invisible formats. Return STRICT JSON:\n" +
  '{"grades":[{"i":0,"trend_score":0-100,"trend_take":"one or two sentences: why it does or does not fit the current moment, and the single adjustment that would make it land harder"}]}\n' +
  "One grade per idea, matched by index i. No prose outside the JSON.";

function parseIdeas(text: string): VideoIdea[] {
  const raw = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b < 0) return [];
  try {
    const p = JSON.parse(raw.slice(a, b + 1)) as { ideas?: VideoIdea[] };
    return Array.isArray(p.ideas) ? p.ideas : [];
  } catch {
    return [];
  }
}

function compactIcp(icp: Icp): string {
  const line = (label: string, v?: string[]) => (v && v.length ? `${label}: ${v.slice(0, 8).join("; ")}` : "");
  return [
    icp.one_line ? `Who: ${icp.one_line}` : "",
    icp.who_they_are || "",
    line("Pains", icp.top_pains),
    line("Beliefs", icp.limiting_beliefs),
    line("Wants", icp.desires),
    line("Triggers", icp.triggers),
    line("Their words", icp.language),
  ]
    .filter(Boolean)
    .join("\n");
}

function rows(
  client: string,
  personKey: string | null,
  icpVersion: number | null,
  batchId: string,
  ideas: VideoIdea[],
) {
  return ideas.slice(0, 10).map((x, i) => ({
    client_key: client,
    person_key: personKey,
    icp_version: icpVersion,
    batch_id: batchId,
    sort_order: i,
    title: String(x.title || "").slice(0, 200),
    format: x.format ? String(x.format).slice(0, 120) : null,
    hook: x.hook ? String(x.hook).slice(0, 500) : null,
    environment: x.environment ? String(x.environment).slice(0, 500) : null,
    attire: x.attire ? String(x.attire).slice(0, 400) : null,
    expression: x.expression ? String(x.expression).slice(0, 400) : null,
    word_choice: x.word_choice ? String(x.word_choice).slice(0, 600) : null,
    rationale: x.rationale ? String(x.rationale).slice(0, 500) : null,
    grounded_in: x.grounded_in ? String(x.grounded_in).slice(0, 400) : null,
    model: MODEL,
    updated_at: new Date().toISOString(),
  }));
}

type DossierRow = {
  person_key: string;
  subscriber_id: string | null;
  display_name: string;
  close_date: string | null;
  first_keyword: string | null;
  research: Research;
};

// 10 ideas for ONE buyer, from their raw transcripts + dossier research. Replaces the buyer's set.
export async function generateBuyerIdeas(
  sb: SupabaseClient,
  client: string,
  dossier: DossierRow,
  icpVersion: number | null,
  anthropic: Anthropic,
): Promise<"built" | "error"> {
  // Re-pull the raw material so the ideas carry the buyer's actual voice, not just the summary.
  const buyer: QualifiedBuyer = {
    personKey: dossier.person_key,
    name: dossier.display_name,
    nn: normName(dossier.display_name),
    subscriberId: dossier.subscriber_id,
    amountCents: 0,
    closer: null,
    setter: null,
    closeDate: dossier.close_date,
    objection: null,
    callNotes: null,
  };
  const d = await gatherBuyerData(sb, client, buyer);
  const r = dossier.research || {};

  const parts: string[] = [`THE BUYER: ${dossier.display_name}`];
  if (r.summary) parts.push(`Who they are: ${r.summary}`);
  if (r.what_brought_them_in) parts.push(`What was going on when they reached out: ${r.what_brought_them_in}`);
  if (Array.isArray(r.pains) && r.pains.length) parts.push(`Pains: ${r.pains.join("; ")}`);
  if (Array.isArray(r.limiting_beliefs) && r.limiting_beliefs.length) parts.push(`Beliefs holding them back: ${r.limiting_beliefs.join("; ")}`);
  if (r.deciding_moment) parts.push(`What tipped them into buying: ${r.deciding_moment}`);
  if (Array.isArray(r.their_words) && r.their_words.length) parts.push(`Their exact words: ${r.their_words.map((w) => `"${w}"`).join(" ")}`);
  if (dossier.first_keyword) parts.push(`Came in on ad keyword: ${dossier.first_keyword}`);
  if (d.adOnImage) parts.push(`Words on the ad they responded to: ${d.adOnImage}`);
  if (d.callTranscript) parts.push(`\nSALES CALL TRANSCRIPT:\n${d.callTranscript.slice(0, 30000)}`);
  if (d.dmText) parts.push(`\nDM CONVERSATION:\n${d.dmText.slice(0, 10000)}`);

  let ideas: VideoIdea[] = [];
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: BUYER_SYS,
      messages: [{ role: "user", content: parts.join("\n") }],
    });
    logAiUsage({ feature: "buyer-dna-video-ideas", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    ideas = parseIdeas(tb?.text || "");
  } catch {
    return "error";
  }
  if (ideas.length < 5) return "error";

  const batchId = `${client}-${dossier.person_key}-${new Date().toISOString().slice(0, 10)}`;
  await sb.from("content_video_ideas").delete().eq("client_key", client).eq("person_key", dossier.person_key);
  const { error } = await sb.from("content_video_ideas").insert(rows(client, dossier.person_key, icpVersion, batchId, ideas));
  return error ? "error" : "built";
}

// 10 ideas for the ICP as a whole. Replaces the ICP-wide set (person_key null).
export async function generateIcpIdeas(
  sb: SupabaseClient,
  client: string,
  icp: Icp,
  icpVersion: number,
  anthropic: Anthropic,
): Promise<"built" | "error"> {
  const { data: dossiers } = await sb
    .from("buyer_dossiers")
    .select("display_name, research")
    .eq("client_key", client)
    .eq("qualifies_icp", true)
    .limit(300);

  const briefs = ((dossiers || []) as { display_name: string; research: Research }[])
    .map((doc) => {
      const r = doc.research || {};
      if (!r || !Object.keys(r).length) return "";
      const line = (v: unknown) => (Array.isArray(v) ? v.slice(0, 3).join("; ") : "");
      return [
        r.what_brought_them_in ? `trigger: ${r.what_brought_them_in}` : "",
        line(r.pains) ? `pains: ${line(r.pains)}` : "",
        line(r.their_words) ? `words: ${line(r.their_words)}` : "",
      ]
        .filter(Boolean)
        .join(" | ");
    })
    .filter(Boolean);

  let ideas: VideoIdea[] = [];
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: ICP_SYS,
      messages: [
        {
          role: "user",
          content: `IDEAL BUYER:\n${compactIcp(icp)}\n\nREAL BUYER NOTES:\n${briefs.slice(0, 60).join("\n").slice(0, 40000)}`,
        },
      ],
    });
    logAiUsage({ feature: "buyer-dna-icp-ideas", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    ideas = parseIdeas(tb?.text || "");
  } catch {
    return "error";
  }
  if (ideas.length < 5) return "error";

  const batchId = `${client}-icp-v${icpVersion}-${new Date().toISOString().slice(0, 10)}`;
  await sb.from("content_video_ideas").delete().eq("client_key", client).is("person_key", null);
  const { error } = await sb.from("content_video_ideas").insert(rows(client, null, icpVersion, batchId, ideas));
  return error ? "error" : "built";
}

// Grade one idea set (a buyer's 10 or the ICP 10) against the current trend brief. One LLM call
// per set; stamps trend_version so a set is graded once per brief.
export async function gradeIdeaSet(
  sb: SupabaseClient,
  client: string,
  personKey: string | null,
  trendBrief: TrendBrief,
  trendVersion: number,
  anthropic: Anthropic,
): Promise<"graded" | "empty" | "error"> {
  const q = sb
    .from("content_video_ideas")
    .select("id, title, format, hook, environment, expression")
    .eq("client_key", client)
    .order("sort_order", { ascending: true });
  const { data: ideas } = personKey ? await q.eq("person_key", personKey) : await q.is("person_key", null);
  if (!ideas || !ideas.length) return "empty";

  const listing = (ideas as { title: string; format: string | null; hook: string | null; environment: string | null; expression: string | null }[])
    .map((x, i) => `${i}. [${x.format || "?"}] ${x.title} — hook: "${x.hook || ""}" — filmed: ${x.environment || "?"} — delivery: ${x.expression || "?"}`)
    .join("\n");

  let grades: { i?: number; trend_score?: number; trend_take?: string }[] = [];
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: GRADE_SYS,
      messages: [
        {
          role: "user",
          content: `WHAT IS WORKING ON SOCIAL RIGHT NOW:\n${compactTrendBrief(trendBrief)}\n\nTHE IDEAS:\n${listing}`,
        },
      ],
    });
    logAiUsage({ feature: "buyer-dna-idea-grade", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    const raw = (tb?.text || "").replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if (a < 0 || b < 0) return "error";
    const p = JSON.parse(raw.slice(a, b + 1)) as { grades?: typeof grades };
    grades = Array.isArray(p.grades) ? p.grades : [];
  } catch {
    return "error";
  }
  if (!grades.length) return "error";

  for (const g of grades) {
    const idx = Number(g.i);
    const row = ideas[idx] as { id: number } | undefined;
    if (!row) continue;
    await sb
      .from("content_video_ideas")
      .update({
        trend_score: Math.max(0, Math.min(100, Math.round(Number(g.trend_score) || 0))),
        trend_take: g.trend_take ? String(g.trend_take).slice(0, 600) : null,
        trend_version: trendVersion,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
  }
  return "graded";
}
