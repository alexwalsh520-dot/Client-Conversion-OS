// Grade ONE post against the creator's current locked ICP. Does it speak to and attract THAT buyer?
// Upserts content_grades on (client_key, ig_media_id, icp_version) so a post is graded once per ICP.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import type { Icp } from "./icp";

const MODEL = "claude-sonnet-4-6";

const SYS =
  "You grade ONE piece of a fitness creator's content against their Ideal Customer Profile. The only question: does this post speak to and attract THAT specific buyer? Score 0 to 100 for fit. Be a tough, specific grader, not a cheerleader. Return STRICT JSON:\n" +
  '{"score":0-100,"band":"on target|partial|off","hits":["what it does that lands for this buyer"],"misses":["what it misses, or who it wrongly attracts instead"],"feedback":"2-3 plain sentences on how to make it hit this buyer harder","verdict":"one short line"}\n' +
  "No prose outside the JSON.";

export type Grade = {
  score: number;
  band: string;
  hits: string[];
  misses: string[];
  feedback: string;
  verdict: string;
};

function compactIcp(icp: Icp): string {
  const line = (label: string, v?: string[]) => (v && v.length ? `${label}: ${v.slice(0, 8).join("; ")}` : "");
  return [
    icp.one_line ? `Who: ${icp.one_line}` : "",
    icp.who_they_are || "",
    line("Pains", icp.top_pains),
    line("Beliefs", icp.limiting_beliefs),
    line("Wants", icp.desires),
    line("Objections", icp.objections),
    line("Words", icp.language),
    line("Not this buyer if", icp.disqualifiers),
  ]
    .filter(Boolean)
    .join("\n");
}

function parse(text: string): Grade | null {
  const raw = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try {
    const g = JSON.parse(raw.slice(a, b + 1)) as Partial<Grade>;
    return {
      score: Math.max(0, Math.min(100, Math.round(Number(g.score) || 0))),
      band: String(g.band || "").toLowerCase() || "off",
      hits: Array.isArray(g.hits) ? g.hits.map(String) : [],
      misses: Array.isArray(g.misses) ? g.misses.map(String) : [],
      feedback: String(g.feedback || ""),
      verdict: String(g.verdict || ""),
    };
  } catch {
    return null;
  }
}

export async function gradePost(
  sb: SupabaseClient,
  client: string,
  post: { ig_media_id: string; caption: string | null; transcript: string | null },
  icp: Icp,
  icpVersion: number,
  anthropic: Anthropic,
): Promise<"graded" | "error"> {
  const body = [
    `IDEAL BUYER:\n${compactIcp(icp)}`,
    `\nPOST CAPTION:\n${(post.caption || "").slice(0, 3000)}`,
    post.transcript ? `\nPOST TRANSCRIPT (what is said in the video):\n${post.transcript.slice(0, 12000)}` : "",
  ].join("\n");

  let grade: Grade | null = null;
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: SYS,
      messages: [{ role: "user", content: body }],
    });
    logAiUsage({ feature: "buyer-dna-grade", model: MODEL, usage: resp.usage });
    const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
    grade = parse(tb?.text || "");
  } catch {
    return "error";
  }
  if (!grade) return "error";

  await sb.from("content_grades").upsert(
    {
      client_key: client,
      ig_media_id: post.ig_media_id,
      icp_version: icpVersion,
      score: grade.score,
      band: grade.band,
      hits: grade.hits,
      misses: grade.misses,
      feedback: grade.feedback,
      verdict: grade.verdict,
      model: MODEL,
      graded_at: new Date().toISOString(),
    },
    { onConflict: "client_key,ig_media_id,icp_version" },
  );
  return "graded";
}
