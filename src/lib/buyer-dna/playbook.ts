// The content playbook — the Playbook tab's weekly filming sheet (both operator + creator views).
// Everything is a TALKING-HEAD video, 30-90s, posted 3x/day, aimed at the one premium buyer: 20
// ready-to-film hooks (each with a short presentation note) plus topics that hit the ICP. Grounded in
// the locked ICP, the real buyer dossiers, the current trend brief, and the shift brief's gap.
// Refreshed weekly (and on ICP bump) by the video-ideas-pipeline cron, mirroring shift.ts.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import type { Icp } from "./icp";
import { extractJson, salvageObjects } from "./json";
import { compactTrendBrief, getCurrentTrendBrief } from "./trends";
import { getCurrentShiftBrief } from "./shift";
import type { Research } from "./dossier";

const MODEL = "claude-sonnet-4-6";

// Same hygiene lines used by video-ideas.ts / shift.ts, inlined so this lib is self-contained.
const JSON_HYGIENE =
  "\nDo not use double-quote characters inside JSON string values. Keep every string field to at most 2 sentences.";
const NO_DOLLARS =
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

export type PlaybookHook = { hook?: string; present?: string };
export type PlaybookTopic = { topic?: string; type?: string; why?: string };
export type Playbook = { hooks: PlaybookHook[]; topics: PlaybookTopic[] };

const SYS =
  "You write the weekly content playbook for a fitness creator. Everything is a TALKING-HEAD video, 30 to 90 seconds, filmed same-day, posted 3 times per day, aimed at ONE specific premium buyer. Two jobs: ATTRACTION (pulls more of that buyer in) and CONNECTION (makes the ones already watching trust the creator). Ground every hook in the buyers' real pains, beliefs, triggers, and exact words; make the buyer feel seen; never generic fitness content. Return STRICT JSON:\n" +
  '{"hooks":[{"hook":"the exact spoken opening line","present":"one short statement on how to show up: clothing, background, tonality"}],"topics":[{"topic":"the topic in a few words","type":"attraction|connection","why":"one sentence on why this hits the buyer"}]}\n' +
  "Exactly 20 hooks — each unique, spread across different pains/triggers/angles, no two alike — and 10 to 14 topics with a healthy mix of both types. No prose outside the JSON." +
  JSON_HYGIENE +
  NO_DOLLARS;

function compactIcp(icp: Icp | null): string {
  if (!icp) return "A premium online fitness coaching buyer who pays for 1:1 coaching.";
  const line = (label: string, v?: string[]) => (v && v.length ? `${label}: ${v.slice(0, 8).join("; ")}` : "");
  return [
    icp.one_line || "",
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

// Same digesting as generateIcpIdeas: one short line per qualifying buyer (trigger | pains | words).
async function buyerBriefs(sb: SupabaseClient, client: string): Promise<string> {
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
  return briefs.slice(0, 60).join("\n").slice(0, 40000);
}

export async function getCurrentPlaybook(sb: SupabaseClient, client: string) {
  const { data } = await sb
    .from("content_playbooks")
    .select("*")
    .eq("client_key", client)
    .order("version", { ascending: false })
    .limit(1);
  return data && data[0] ? (data[0] as { version: number; icp_version: number | null; trend_version: number | null; playbook: Playbook; generated_at: string }) : null;
}

function parse(text: string): Playbook {
  const p = extractJson<{ hooks?: PlaybookHook[]; topics?: PlaybookTopic[] }>(text);
  let hooks = p && Array.isArray(p.hooks) ? p.hooks : [];
  let topics = p && Array.isArray(p.topics) ? p.topics : [];
  // Broken JSON — recover the hook / topic objects individually (partial recovery is fine).
  if (hooks.length < 20) {
    const salvaged = salvageObjects<PlaybookHook>(text, ["hook"]);
    if (salvaged.length > hooks.length) hooks = salvaged;
  }
  if (topics.length < 10) {
    const salvaged = salvageObjects<PlaybookTopic>(text, ["topic"]);
    if (salvaged.length > topics.length) topics = salvaged;
  }
  return { hooks: hooks.filter((h) => h && h.hook), topics: topics.filter((t) => t && t.topic) };
}

// Generate + store a new playbook version for one creator.
export async function refreshPlaybook(
  sb: SupabaseClient,
  client: string,
  icp: Icp | null,
  icpVersion: number | null,
  anthropic: Anthropic,
  opts: { canProceed?: () => boolean } = {},
): Promise<{ ok: true; version: number; hooks: number; topics: number } | { ok: false; reason: string }> {
  const [briefs, trend, shift] = await Promise.all([
    buyerBriefs(sb, client),
    getCurrentTrendBrief(sb, client),
    getCurrentShiftBrief(sb, client),
  ]);

  const shiftAim = shift
    ? [
        shift.brief.gap ? `The gap to close: ${shift.brief.gap}` : "",
        Array.isArray(shift.brief.shifts) && shift.brief.shifts.length
          ? `Shifts the hooks should push toward:\n${shift.brief.shifts.map((s) => `- ${s.move}`).filter(Boolean).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const userMsg = [
    `THE BUYER (write everything for this one person):\n${compactIcp(icp)}`,
    briefs ? `REAL BUYER NOTES (patterns to mine for hooks):\n${briefs}` : "",
    trend ? `WHAT IS WORKING ON SOCIAL RIGHT NOW:\n${compactTrendBrief(trend.brief)}` : "",
    shiftAim ? `WHERE THIS CREATOR'S CONTENT NEEDS TO SHIFT:\n${shiftAim}` : "",
    "Return the playbook JSON: exactly 20 unique hooks (each with a present note) and 10 to 14 topics.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const genOnce = async (): Promise<Playbook> => {
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: SYS,
        messages: [{ role: "user", content: userMsg }],
      });
      logAiUsage({ feature: "buyer-dna-playbook", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      return parse(tb?.text || "");
    } catch {
      return { hooks: [], topics: [] };
    }
  };

  let result = await genOnce();
  // One retry if the hook set came back short, but only if the caller's time budget allows it.
  if (result.hooks.length < 20 && (opts.canProceed?.() ?? true)) {
    const retry = await genOnce();
    if (retry.hooks.length > result.hooks.length) result = retry;
  }
  if (result.hooks.length < 10) return { ok: false, reason: "Could not parse a usable playbook from the model." };

  const playbook: Playbook = { hooks: result.hooks.slice(0, 20), topics: result.topics.slice(0, 14) };

  const current = await getCurrentPlaybook(sb, client);
  const version = current ? Number(current.version) + 1 : 1;
  const { error } = await sb.from("content_playbooks").insert({
    client_key: client,
    version,
    icp_version: icpVersion,
    trend_version: trend?.version ?? null,
    playbook,
    model: MODEL,
    generated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true, version, hooks: playbook.hooks.length, topics: playbook.topics.length };
}
