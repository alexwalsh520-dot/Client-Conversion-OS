// The content playbook — the Playbook tab's weekly filming sheet (both operator + creator views).
// Everything is a TALKING-HEAD video, 30-90s, posted 3x/day, aimed at the one premium buyer: a ranked
// "what they're saying" tier list, then 20 ready-to-film hooks (each with a short presentation note),
// plus topics that hit the ICP. Grounded in the locked ICP, the real buyer dossiers, the current trend
// brief, the shift brief's gap, the verbatim call/DM quotes, the buyer-voice overview, and the ad
// messaging people actually respond to. Refreshed weekly (and on ICP bump) by the video-ideas-pipeline
// cron, mirroring shift.ts — one LLM call, so the tier list costs nothing extra.

import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAiUsage } from "@/lib/ai-usage";
import type { Icp } from "./icp";
import { extractJson, salvageObjects } from "./json";
import { compactTrendBrief, getCurrentTrendBrief } from "./trends";
import { getCurrentShiftBrief } from "./shift";
import { getCurrentVoice } from "./voice";
import { getMessagingDoc, messagingDocBlock } from "./messaging-doc";
import type { Research } from "./dossier";

const MODEL = "claude-sonnet-4-6";

// Same hygiene lines used by video-ideas.ts / shift.ts, inlined so this lib is self-contained.
const JSON_HYGIENE =
  "\nDo not use double-quote characters inside JSON string values. Keep every string field to at most 2 sentences.";
const NO_DOLLARS =
  "\nNever include specific dollar amounts; describe money situations qualitatively (e.g. 'deep in debt', 'tight monthly budget').";

export type PlaybookHook = { hook?: string; present?: string };
export type PlaybookTopic = { topic?: string; type?: string; why?: string };
// The ranked "what they're saying" tier list. Optional: playbook rows generated before this section
// existed simply have no `saying`, and the view hides it until the next weekly regen.
export type PlaybookSaying = { rank?: number; theme?: string; quotes?: string[]; how_common?: string; source?: string };
export type Playbook = {
  saying?: PlaybookSaying[];
  hooks: PlaybookHook[];
  topics: PlaybookTopic[];
  // Fields an EXTERNAL playbook (the content worker) may add. Internally-generated playbooks never set
  // these, so the view renders them only when present — old-shape versions are unaffected.
  origin?: string;
  actions?: (string | { move?: string; why?: string })[];
  buyer_language?: string[];
  filming_concepts?: (string | { concept?: string; why?: string })[];
};

const SYS =
  "You write the weekly content playbook for a fitness creator. Everything is a TALKING-HEAD video, 30 to 90 seconds, filmed same-day, posted 3 times per day, aimed at ONE specific premium buyer. Two jobs: ATTRACTION (pulls more of that buyer in) and CONNECTION (makes the ones already watching trust the creator). Ground every hook in the buyers' real pains, beliefs, triggers, and exact words; make the buyer feel seen; never generic fitness content.\n\n" +
  "FIRST, build the SAYING tier list: the most common things prospects and buyers are ACTUALLY saying, ranked by real recurrence — this is the exact pain language the creator makes content from. Rules:\n" +
  "- Rank by actual recurrence across the evidence below. The ad-response counts are HARD frequency evidence (real DM counts against real ad messaging) — weight them accordingly; the verbatim call/DM quotes and the buyer-voice overview carry the language itself.\n" +
  "- Exactly 10 items when the material honestly supports 10. Fewer is correct if it does not — NEVER pad, never invent a theme to reach a number.\n" +
  "- Every theme must be phrased in THEIR words, and carry 1-2 short verbatim quotes taken from the evidence (never invented).\n" +
  "- how_common is qualitative ('the overwhelming majority', 'about a third', 'a handful'). source names which evidence it came from: calls, dms, ads — whichever actually apply.\n\n" +
  "Return STRICT JSON:\n" +
  '{"saying":[{"rank":1,"theme":"what they keep saying, in their words","quotes":["short verbatim quote"],"how_common":"qualitative frequency","source":"calls / dms / ads"}],"hooks":[{"hook":"the exact spoken opening line","present":"one short statement on how to show up: clothing, background, tonality"}],"topics":[{"topic":"the topic in a few words","type":"attraction|connection","why":"one sentence on why this hits the buyer"}]}\n' +
  "Up to 10 ranked saying items (fewer only if honestly unsupported), exactly 20 hooks — each unique, spread across different pains/triggers/angles, no two alike — and 10 to 14 topics with a healthy mix of both types. No prose outside the JSON." +
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

// Verbatim voice of calls + DMs — the continuously-mined quotes, with their bucket + source so the
// model can tell a pain from an objection and a call from a DM.
async function vocQuotes(sb: SupabaseClient, client: string): Promise<string> {
  const { data } = await sb
    .from("content_voc")
    .select("bucket, quote, source")
    .eq("client_key", client)
    .order("sort_order", { ascending: true })
    .limit(300);
  const lines = ((data || []) as { bucket: string | null; quote: string | null; source: string | null }[])
    .map((r) => {
      const q = (r.quote || "").trim();
      // The miner writes a placeholder row when a creator has no verbatim data yet — never feed it in.
      if (!q || /^NO VERBATIM DATA/i.test(q)) return "";
      const tag = [r.bucket, r.source].filter(Boolean).join("/");
      return `- [${tag || "voc"}] ${q.replace(/\s+/g, " ").slice(0, 240)}`;
    })
    .filter(Boolean);
  return lines.join("\n").slice(0, 30000);
}

// PostgREST caps a response at 1000 rows regardless of .limit(), so a naive read of the keyword
// events returns an arbitrary slice and ranks the WRONG keywords (measured: a capped read put "edge"
// top at 449; the true counts over all 5,234 rows put "healthy" top at 687). Page explicitly.
async function allRows<T>(
  sb: SupabaseClient,
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null }> },
  max = 20000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += 1000) {
    const { data } = await build().range(from, from + 999);
    const got = data || [];
    out.push(...got);
    if (got.length < 1000) break;
  }
  return out;
}

// What messaging people actually respond to: the top keywords by real dm_keyword count, each joined
// through the Meta insights bridge to the creative copy that earned those DMs. Hard frequency data.
async function adResponse(sb: SupabaseClient, client: string): Promise<string> {
  const events = await allRows<{ keyword_normalized: string | null }>(sb, () =>
    sb.from("ads_keyword_events").select("keyword_normalized").eq("client_key", client).eq("event_type", "dm_keyword"),
  );
  const counts = new Map<string, number>();
  for (const e of events) {
    const k = (e.keyword_normalized || "").trim().toLowerCase();
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (!top.length) return "";

  // Best ad per keyword = the one that spent the most behind it.
  const insights = await allRows<{ keyword_normalized: string | null; ad_id: string; spend_cents: number | null }>(sb, () =>
    sb.from("ads_meta_insights_daily").select("keyword_normalized, ad_id, spend_cents").eq("client_key", client),
  );
  const bestAd = new Map<string, { adId: string; spend: number }>();
  for (const r of insights) {
    const k = (r.keyword_normalized || "").trim().toLowerCase();
    if (!k || !r.ad_id) continue;
    const spend = Number(r.spend_cents) || 0;
    const cur = bestAd.get(k);
    if (!cur || spend > cur.spend) bestAd.set(k, { adId: r.ad_id, spend });
  }
  const adIds = top.map(([k]) => bestAd.get(k)?.adId).filter((v): v is string => Boolean(v));
  const copyByAd = new Map<string, { on_image_text: string | null; primary_text: string | null }>();
  if (adIds.length) {
    const { data } = await sb.from("ad_creative_copy").select("ad_id, on_image_text, primary_text").in("ad_id", adIds);
    for (const r of (data || []) as { ad_id: string; on_image_text: string | null; primary_text: string | null }[]) {
      copyByAd.set(r.ad_id, { on_image_text: r.on_image_text, primary_text: r.primary_text });
    }
  }

  const lines = top.map(([kw, n]) => {
    const adId = bestAd.get(kw)?.adId;
    const copy = adId ? copyByAd.get(adId) : undefined;
    const says = (copy?.on_image_text || "").replace(/\s+/g, " ").slice(0, 300);
    const cta = (copy?.primary_text || "").replace(/\s+/g, " ").slice(0, 120);
    return [`- "${kw}" — ${n} DMs`, says ? `ad says: ${says}` : "", cta ? `CTA: ${cta}` : ""].filter(Boolean).join(" | ");
  });
  return lines.join("\n").slice(0, 12000);
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
  const p = extractJson<{ saying?: PlaybookSaying[]; hooks?: PlaybookHook[]; topics?: PlaybookTopic[] }>(text);
  const saying = p && Array.isArray(p.saying) ? p.saying : [];
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
  return {
    saying: saying.filter((s) => s && s.theme),
    hooks: hooks.filter((h) => h && h.hook),
    topics: topics.filter((t) => t && t.topic),
  };
}

// Generate + store a new playbook version for one creator.
export async function refreshPlaybook(
  sb: SupabaseClient,
  client: string,
  icp: Icp | null,
  icpVersion: number | null,
  anthropic: Anthropic,
  opts: { canProceed?: () => boolean } = {},
): Promise<{ ok: true; version: number; saying: number; hooks: number; topics: number } | { ok: false; reason: string }> {
  const [briefs, trend, shift, voc, voice, ads, doc] = await Promise.all([
    buyerBriefs(sb, client),
    getCurrentTrendBrief(sb, client),
    getCurrentShiftBrief(sb, client),
    vocQuotes(sb, client),
    getCurrentVoice(sb, client),
    adResponse(sb, client),
    getMessagingDoc(sb, client),
  ]);
  const docBlock = messagingDocBlock(doc); // "" for creators without a doc (e.g. Tyson) — no prompt change.

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

  // The buyer-voice overview is the payer signal: what everyone who actually paid keeps saying.
  const voiceSummary = voice
    ? [
        voice.voice.synopsis ? `Synopsis: ${voice.voice.synopsis}` : "",
        (voice.voice.saying || []).length
          ? `Themes they repeat:\n${(voice.voice.saying || []).map((s) => `- ${[s.theme, s.example].filter(Boolean).join(" — ")}`).join("\n")}`
          : "",
        (voice.voice.top_pains || []).length
          ? `Most common pains:\n${(voice.voice.top_pains || []).map((p) => `- ${[p.pain, p.how_common].filter(Boolean).join(" — ")}`).join("\n")}`
          : "",
        (voice.voice.top_objections || []).length
          ? `Most common objections:\n${(voice.voice.top_objections || []).map((o) => `- ${[o.objection, o.how_common].filter(Boolean).join(" — ")}`).join("\n")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const userMsg = [
    // The messaging doc leads when present: it is the creator's own ground truth. For a creator
    // with no buyers/calls/DMs yet, this plus the ICP and trend brief is the whole basis — so the
    // saying tier list draws its themes and quotes FROM THE DOC, labelled source "messaging doc",
    // and never fabricates call/DM quotes that don't exist.
    docBlock,
    docBlock
      ? "Because this creator has no buyer calls, DMs or ad data yet, build the SAYING tier list from the messaging document above: each item's theme and quotes must come from that document (use its exact one-liners and pain phrasing), and set source to \"messaging doc\". Do NOT invent call or DM quotes. Ground every hook and topic in the document's pains and language."
      : "",
    `THE BUYER (write everything for this one person):\n${compactIcp(icp)}`,
    voc ? `VERBATIM VOICE FROM SALES CALLS + DMs (their exact words — quote from here):\n${voc}` : "",
    voiceSummary ? `WHAT EVERYONE WHO ACTUALLY PAID KEEPS SAYING (the payer signal):\n${voiceSummary}` : "",
    ads
      ? `AD MESSAGING PEOPLE ACTUALLY RESPOND TO (HARD frequency evidence — real DM counts against the copy that earned them):\n${ads}`
      : "",
    briefs ? `REAL BUYER NOTES (patterns to mine for hooks):\n${briefs}` : "",
    trend ? `WHAT IS WORKING ON SOCIAL RIGHT NOW:\n${compactTrendBrief(trend.brief)}` : "",
    shiftAim ? `WHERE THIS CREATOR'S CONTENT NEEDS TO SHIFT:\n${shiftAim}` : "",
    "Return the playbook JSON: the ranked saying tier list (up to 10, ranked by real recurrence, never padded), exactly 20 unique hooks (each with a present note), and 10 to 14 topics.",
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
      return { saying: [], hooks: [], topics: [] };
    }
  };

  let result = await genOnce();
  // One retry if the hook set came back short, but only if the caller's time budget allows it.
  if (result.hooks.length < 20 && (opts.canProceed?.() ?? true)) {
    const retry = await genOnce();
    if (retry.hooks.length > result.hooks.length) result = retry;
  }
  if (result.hooks.length < 10) return { ok: false, reason: "Could not parse a usable playbook from the model." };

  // Rank is authoritative from the model's ordering; renumber so the stored list is always 1..N.
  const saying = (result.saying || []).slice(0, 10).map((s, i) => ({ ...s, rank: i + 1 }));
  const playbook: Playbook = { saying, hooks: result.hooks.slice(0, 20), topics: result.topics.slice(0, 14) };

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
  return { ok: true, version, saying: playbook.saying?.length ?? 0, hooks: playbook.hooks.length, topics: playbook.topics.length };
}
