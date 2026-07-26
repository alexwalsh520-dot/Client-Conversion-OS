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
import { marketDirective } from "@/lib/content/market";
import { compactTrendBrief, getCurrentTrendBrief } from "./trends";
import { getCurrentShiftBrief } from "./shift";
import { getCurrentVoice } from "./voice";
import { getMessagingDoc, messagingDocBlock, listGlobalFrameworkDocs, frameworkChannelBlock, frameworkHookRules } from "./messaging-doc";
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
  // Actions are 5 headline+detail pairs: the headline is a complete, self-sufficient statement
  // (always shown in full), the detail is the explanation behind the dropdown. Older playbooks stored
  // plain strings or {move,why}; the view renders those as headline-only rows until the next regen.
  actions?: (string | { move?: string; why?: string; headline?: string; detail?: string })[];
  // RULING B: the ranked tier list lives HERE now — one section doing both jobs. Ordered by real
  // recurrence, each item carrying the verbatim quotes, how common it is, and where it came from.
  // Older playbooks stored plain strings; the view renders those as theme-only rows.
  buyer_language?: (string | PlaybookSaying)[];
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

// When the house writing framework is installed it prescribes the playbook's shape (four sections)
// and how each one is written, so the hardcoded tier-list/topics brief above is replaced by the
// mechanical contract plus the framework itself. PlaybookView already renders these four.
const MECHANICAL_SYS =
  "You write the content playbook for a fitness creator. Follow the AUTHORITATIVE WRITING FRAMEWORK in the user message for what each section is and how to write it. The rules below are only the output contract.\n" +
  "OUTPUT CONTRACT (non-negotiable):\n" +
  "- Plain text only. No markdown, no ** bold markers, no emojis.\n" +
  "- Never include a specific dollar amount; describe money qualitatively.\n" +
  "- Ground everything in the evidence supplied below. Never invent a quote or a buyer phrase.\n" +
  "- Write every section in proper sentence case with correct grammar and punctuation. Not lowercase fragments, not title case.\n" +
  "- BUYER LANGUAGE is a RANKED tier list of what prospects and buyers are ACTUALLY saying, ordered by how often they say it. Up to 10 items, and fewer is correct when the evidence honestly supports fewer — never pad, never invent a theme to reach a number. Each item carries: theme, phrased in THEIR words; 1-2 short verbatim quotes lifted from the evidence below (never invented); how_common as a qualitative frequency (\'the overwhelming majority\', \'about a third\', \'a handful\'); and source naming which evidence it came from (calls, dms, ads, messaging doc).\n" +
  "- ACTIONS: exactly 5. Each is a headline plus a detail. Each action is ONE DISCRETE DELIVERABLE the creator can complete this week: a production verb, a concrete artifact, and a count. \'Post one video that...\', \'Film one clip that...\', \'Record one narrated...\'. The HEADLINE is that statement, roughly 10 words or fewer, complete and grammatical on its own. The DETAIL is the in-depth explanation: what to do, why it attracts this specific buyer, and how to execute it.\n" +
  "- A STANDING RULE OR POLICY IS NOT AN ACTION. \'Always name the career path first\', \'end every Reel with a keyword\', \'replace all aesthetic content\' are ongoing style rules, not things that get finished. If that material matters, put it in a filming concept instead, or leave it out.\n" +
  "Return STRICT JSON and nothing else:\n" +
  '{"hooks":["a phrase or question a buyer actually said"],"buyer_language":[{"rank":1,"theme":"what they keep saying, in their words","quotes":["short verbatim quote"],"how_common":"qualitative frequency","source":"calls / dms / ads / messaging doc"}],"actions":[{"headline":"Post one video that does X.","detail":"What to do, why it pulls this buyer, and how to execute."}],"filming_concepts":[{"concept":"what to film","why":"which objection it addresses and what it signals"}]}\n' +
  "\nDo not use double-quote characters inside JSON string values." +
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

// Framework-shaped playbook: the four sections the house framework prescribes. Strings are kept as
// strings (the view normalizes both shapes), and empty sections simply don't render.
function parseFramework(text: string): Playbook {
  const p = extractJson<{
    hooks?: unknown[]; buyer_language?: unknown[]; actions?: unknown[];
    filming_concepts?: { concept?: string; why?: string }[];
  }>(text);
  const strs = (v: unknown[] | undefined): string[] =>
    (Array.isArray(v) ? v : []).map((x) => (typeof x === "string" ? x : String((x as { hook?: string })?.hook ?? ""))).filter(Boolean);
  // Buyer language arrives as ranked objects; a bare string still lands as a theme-only item so an
  // older-shaped response is never dropped on the floor.
  let rawLang: unknown[] = Array.isArray(p?.buyer_language) ? p!.buyer_language! : [];
  if (!rawLang.length) rawLang = salvageObjects<PlaybookSaying>(text, ["theme"]);
  const buyerLanguage: PlaybookSaying[] = rawLang
    .map((x) => {
      if (typeof x === "string") return { theme: x } as PlaybookSaying;
      const o = (x || {}) as PlaybookSaying;
      return { theme: o.theme, quotes: (o.quotes || []).filter(Boolean), how_common: o.how_common, source: o.source };
    })
    .filter((x) => x.theme);
  let concepts = Array.isArray(p?.filming_concepts) ? p!.filming_concepts! : [];
  if (!concepts.length) concepts = salvageObjects<{ concept?: string; why?: string }>(text, ["concept"]);
  // Actions arrive as {headline, detail}; tolerate a bare string or the older {move,why} shape.
  const rawActions = Array.isArray(p?.actions) ? p!.actions! : [];
  const actions = rawActions
    .map((a) => {
      if (typeof a === "string") return { headline: a, detail: "" };
      const o = a as { headline?: string; detail?: string; move?: string; why?: string };
      return { headline: o.headline || o.move || "", detail: o.detail || o.why || "" };
    })
    .filter((a) => a.headline);
  return {
    hooks: strs(p?.hooks).map((h) => ({ hook: h })),
    topics: [],
    buyer_language: buyerLanguage,
    actions,
    filming_concepts: concepts.filter((c) => c && (c.concept || c.why)),
  };
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

// RULING/CHANGE: an action is a thing that gets FINISHED, not a policy that runs forever. A headline
// has to name a production verb, an artifact and a count. Anything shaped like a standing rule is
// named back to the model for the one retry rather than shipped as an action.
const ACTION_VERB = /^(post|film|record|shoot|publish|write|script|make|produce|build|create|launch|send|cut|upload)\b/i;
const ACTION_COUNT = /\b(one|two|three|four|five|a single|\d+)\b/i;
const STANDING_RULE = /^(always|never|every|each|start every|end every|stop|replace all|keep|use)\b/i;

function nonCountableActions(actions: { headline?: string }[]): string[] {
  return actions
    .map((a) => (a.headline || "").trim())
    .filter((h) => h && (STANDING_RULE.test(h) || !ACTION_VERB.test(h) || !ACTION_COUNT.test(h)));
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
  const [briefs, trend, shift, voc, voice, ads, doc, pack] = await Promise.all([
    buyerBriefs(sb, client),
    getCurrentTrendBrief(sb, client),
    getCurrentShiftBrief(sb, client),
    vocQuotes(sb, client),
    getCurrentVoice(sb, client),
    adResponse(sb, client),
    getMessagingDoc(sb, client),
    listGlobalFrameworkDocs(sb),
  ]);
  const packBlock = frameworkChannelBlock(pack); // "" when no framework — the generator runs as before.
  // The hook guide governs the playbook's hooks section too; hoisted into the system prompt.
  const hookRules = frameworkHookRules(pack.find((d) => (d.title || "").toLowerCase().includes("hook")) || null);
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
    // The house framework leads: it defines the sections and the craft. The creator's own material
    // follows and supplies the substance.
    packBlock,
    // The messaging doc leads when there's no framework: it is the creator's own ground truth. For a
    // creator with no buyers/calls/DMs yet, this plus the ICP and trend brief is the whole basis — so
    // the saying tier list draws its themes and quotes FROM THE DOC, labelled source "messaging doc",
    // and never fabricates call/DM quotes that don't exist.
    docBlock,
    docBlock
      ? packBlock
        ? "Where this creator has no buyer calls, DMs or ad data yet, draw the buyer language and hooks from the messaging document above rather than inventing them — use its exact one-liners and pain phrasing. Never fabricate a call or DM quote."
        : "Because this creator has no buyer calls, DMs or ad data yet, build the SAYING tier list from the messaging document above: each item's theme and quotes must come from that document (use its exact one-liners and pain phrasing), and set source to \"messaging doc\". Do NOT invent call or DM quotes. Ground every hook and topic in the document's pains and language."
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
    packBlock
      ? "Now write today's playbook as the writing framework above directs, grounded in this creator's evidence. Return the JSON with the four sections."
      : "Return the playbook JSON: the ranked saying tier list (up to 10, ranked by real recurrence, never padded), exactly 20 unique hooks (each with a present note), and 10 to 14 topics.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const genOnce = async (feedback?: string): Promise<Playbook> => {
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: (packBlock ? MECHANICAL_SYS : SYS) + (hookRules ? `\n\nHOOK RULES — these govern the hooks section and OUTRANK the general pack on anything hook-shaped:\n${hookRules}` : "") + marketDirective(client),
        messages: [{ role: "user", content: feedback ? `${userMsg}\n\n${feedback}` : userMsg }],
      });
      logAiUsage({ feature: "buyer-dna-playbook", model: MODEL, usage: resp.usage });
      const tb = resp.content.find((b) => b.type === "text") as { text: string } | undefined;
      return packBlock ? parseFramework(tb?.text || "") : parse(tb?.text || "");
    } catch {
      return { saying: [], hooks: [], topics: [] };
    }
  };

  // Framework playbooks don't have a fixed hook count (the framework asks for the hooks the day's
  // research actually surfaced), so the "short hook set" retry only applies to the legacy shape.
  const minHooks = packBlock ? 1 : 20;
  let result = await genOnce();
  if (result.hooks.length < minHooks && (opts.canProceed?.() ?? true)) {
    const retry = await genOnce();
    if (retry.hooks.length > result.hooks.length) result = retry;
  }
  // A framework playbook is usable as soon as any section came back; the legacy shape needs its
  // hook set to have survived parsing.
  const usable = packBlock
    ? result.hooks.length > 0 || (result.buyer_language?.length ?? 0) > 0 || (result.actions?.length ?? 0) > 0 || (result.filming_concepts?.length ?? 0) > 0
    : result.hooks.length >= 10;
  if (!usable) return { ok: false, reason: "Could not parse a usable playbook from the model." };

  // Actions that read as standing policy rather than a deliverable buy exactly one retry, with the
  // offenders named. Whatever comes back is kept only if it is actually better.
  if (packBlock && (opts.canProceed?.() ?? true)) {
    const offenders = nonCountableActions((result.actions || []) as { headline?: string }[]);
    if (offenders.length) {
      const retry = await genOnce(
        `These actions are standing rules or policies, not deliverables the creator can finish this week: ${offenders.map((h) => `"${h}"`).join("; ")}. ` +
        "Replace each one with a discrete deliverable — a production verb, a concrete artifact and a count, in the shape 'Post one video that...' or 'Film one clip that...'. " +
        "If the underlying point is a standing style rule, move it into a filming concept instead of forcing it into actions. Keep the other sections as they are and return the full JSON.",
      );
      const better = nonCountableActions((retry.actions || []) as { headline?: string }[]);
      if ((retry.actions?.length ?? 0) >= 5 && better.length < offenders.length) result = retry;
    }
  }

  // Rank is authoritative from the model's ordering; renumber so the stored list is always 1..N.
  const saying = (result.saying || []).slice(0, 10).map((s, i) => ({ ...s, rank: i + 1 }));
  const playbook: Playbook = packBlock
    ? {
        origin: "framework",
        hooks: result.hooks.slice(0, 30),
        topics: [],
        // Rank is authoritative from the model's ordering; renumber so the stored list is always 1..N.
        buyer_language: (result.buyer_language || [])
          .slice(0, 10)
          .map((x, i) => (typeof x === "string" ? { rank: i + 1, theme: x } : { ...x, rank: i + 1 })),
        actions: (result.actions || []).slice(0, 5),
        filming_concepts: (result.filming_concepts || []).slice(0, 12),
      }
    : { saying, hooks: result.hooks.slice(0, 20), topics: result.topics.slice(0, 14) };

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
