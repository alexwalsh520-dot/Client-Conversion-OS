// The "shift brief" — the analysis at the top of the creator's Playbook. Answers, in plain language:
// who is your content pulling in right now, who actually pays you, and how do you shift toward the
// buyer? Grounded in the creator's own recent scored posts vs their locked ICP. Refreshed weekly (and
// whenever the ICP advances) by the video-ideas-pipeline cron, mirroring trends.ts.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import type { Icp } from "./icp";
import { extractJson, salvageObjects } from "./json";

const MODEL = "claude-sonnet-4-6";

// Same hygiene lines used by video-ideas.ts, inlined here so this lib is self-contained.
const JSON_HYGIENE =
  "\nDo not use double-quote characters inside JSON string values. Keep every string field to at most 2 sentences.";
const NO_DOLLARS =
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

export type ShiftBrief = {
  pulling_now?: string;
  buyer?: string;
  gap?: string;
  shifts?: { move?: string; why?: string }[];
  keep?: string[];
  stop?: string[];
};

const SYS =
  "You analyze a fitness creator's recent posts against the profile of the people who ACTUALLY PAY them for 1:1 coaching, and tell the creator in plain language how to shift their content toward those buyers. You get the ideal buyer profile plus a sample of the creator's recent posts, each with an ICP-fit score (higher = closer to the paying buyer), the top reason it scored well and the top reason it scored poorly, and its view count. Speak in the second person ('your content...'). Be plain, direct, and encouraging — no jargon. Return STRICT JSON:\n" +
  '{"pulling_now":"2-3 plain sentences: who this content is attracting today","buyer":"1 sentence: who actually pays","gap":"2-3 sentences: the difference and why it costs them buyers","shifts":[{"move":"the concrete change to make","why":"why it pulls the buyer"}],"keep":["what is already working — keep doing it"],"stop":["what to stop"]}\n' +
  "3 to 5 shifts, 2 to 4 items each in keep and stop. Ground every point in the actual posts and the buyer profile. No prose outside the JSON." +
  JSON_HYGIENE +
  NO_DOLLARS;

function compactIcp(icp: Icp | null): string {
  if (!icp) return "A premium online fitness coaching buyer who pays for 1:1 coaching.";
  const line = (label: string, v?: string[]) => (v && v.length ? `${label}: ${v.slice(0, 8).join("; ")}` : "");
  return [
    icp.one_line || "",
    icp.who_they_are || "",
    line("Pains", icp.top_pains),
    line("Wants", icp.desires),
    line("Triggers", icp.triggers),
    line("Their words", icp.language),
  ]
    .filter(Boolean)
    .join("\n");
}

type ScoredPost = { id: string; caption: string; transcript: string; views: number; score: number; hit: string; miss: string };

// Build the post sample: join grades to content, then surface the gap by including both the
// highest-viewed posts (what is pulling attention) and the lowest ICP-scoring posts (off-target).
async function samplePosts(sb: SupabaseClient, client: string): Promise<ScoredPost[]> {
  const [{ data: grades }, { data: posts }] = await Promise.all([
    sb.from("content_grades").select("ig_media_id, score, hits, misses").eq("client_key", client),
    sb.from("creator_content").select("ig_media_id, caption, transcript, view_count").eq("client_key", client).order("taken_at", { ascending: false }).limit(500),
  ]);
  const gradeMap = new Map((grades || []).map((g) => [(g as { ig_media_id: string }).ig_media_id, g as { score: number; hits: string[]; misses: string[] }]));
  const scored: ScoredPost[] = ((posts || []) as { ig_media_id: string; caption: string | null; transcript: string | null; view_count: number | null }[])
    .map((p) => {
      const g = gradeMap.get(p.ig_media_id);
      if (!g || g.score == null) return null;
      return {
        id: p.ig_media_id,
        caption: (p.caption || "").replace(/\s+/g, " ").slice(0, 300),
        transcript: (p.transcript || "").replace(/\s+/g, " ").slice(0, 800),
        views: Number(p.view_count) || 0,
        score: Number(g.score),
        hit: Array.isArray(g.hits) && g.hits[0] ? String(g.hits[0]) : "",
        miss: Array.isArray(g.misses) && g.misses[0] ? String(g.misses[0]) : "",
      };
    })
    .filter((x): x is ScoredPost => x !== null);

  const byViews = [...scored].sort((a, b) => b.views - a.views).slice(0, 13);
  const byScore = [...scored].sort((a, b) => a.score - b.score).slice(0, 12);
  const seen = new Set<string>();
  const out: ScoredPost[] = [];
  for (const p of [...byViews, ...byScore]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    if (out.length >= 25) break;
  }
  return out;
}

export async function getCurrentShiftBrief(sb: SupabaseClient, client: string) {
  const { data } = await sb
    .from("content_shift_briefs")
    .select("*")
    .eq("client_key", client)
    .order("version", { ascending: false })
    .limit(1);
  return data && data[0] ? (data[0] as { version: number; icp_version: number | null; brief: ShiftBrief; generated_at: string }) : null;
}

function parse(text: string): ShiftBrief | null {
  const p = extractJson<ShiftBrief>(text);
  if (p && Array.isArray(p.shifts) && p.shifts.length) return p;
  // Broken JSON — recover the shift objects at least, wrap them so the rest degrades gracefully.
  const shifts = salvageObjects<{ move?: string; why?: string }>(text, ["move", "why"]);
  if (shifts.length) return { ...(p || {}), shifts };
  return p && (p.pulling_now || p.gap) ? p : null;
}

// Generate + store a new shift brief version for one creator, grounded in their ICP + recent posts.
export async function refreshShiftBrief(
  sb: SupabaseClient,
  client: string,
  icp: Icp | null,
  icpVersion: number | null,
  anthropic: Anthropic,
): Promise<{ ok: true; version: number } | { ok: false; reason: string }> {
  const posts = await samplePosts(sb, client);
  if (!posts.length) return { ok: false, reason: "No scored posts yet to analyze." };

  const postLines = posts
    .map((p, i) => `${i + 1}. [ICP fit ${p.score}] [${p.views} views]${p.hit ? ` HIT: ${p.hit}` : ""}${p.miss ? ` | MISS: ${p.miss}` : ""}\n   caption: ${p.caption || "(none)"}${p.transcript ? `\n   said: ${p.transcript}` : ""}`)
    .join("\n");
  const userMsg = `WHO ACTUALLY PAYS (ideal buyer):\n${compactIcp(icp)}\n\nTHIS CREATOR'S RECENT POSTS (ICP fit 0-100, higher = closer to the paying buyer):\n${postLines}\n\nReturn the shift brief JSON.`;

  const gen = async (): Promise<string | null> => {
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2500,
        system: SYS,
        messages: [{ role: "user", content: userMsg }],
      });
      logAiUsage({ feature: "buyer-dna-shift", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      return tb?.text || "";
    } catch {
      return null;
    }
  };

  let text = await gen();
  if (text === null) return { ok: false, reason: "Shift analysis failed." };
  let brief = parse(text);
  // Retry the generation once if the model's JSON did not parse into a usable brief.
  if (!brief || !(brief.shifts || []).length) {
    const retry = await gen();
    if (retry !== null) { text = retry; brief = parse(retry); }
  }
  if (!brief || !(brief.shifts || []).length) return { ok: false, reason: "Could not parse a shift brief from the model." };

  const current = await getCurrentShiftBrief(sb, client);
  const version = current ? Number(current.version) + 1 : 1;
  const { error } = await sb.from("content_shift_briefs").insert({
    client_key: client,
    version,
    icp_version: icpVersion,
    brief,
    model: MODEL,
    generated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, version };
}
