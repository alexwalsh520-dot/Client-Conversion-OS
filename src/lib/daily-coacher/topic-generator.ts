// Daily Coacher: per-topic draft message generator.
//
// Inputs: clientId + topic key.
// Process: load persistent summary + intake + recent live messages + 1-3
// approved tips → Claude → return draft text the coach can paste into Everfit.
//
// Per-topic specifics (extra system-prompt instructions, tip-filtering tags
// derived from intake) live in src/lib/daily-coacher/topics/<key>.ts. The
// framework here is topic-agnostic; new topics just drop in a spec file and
// get registered in topics/registry.ts.
//
// Topics gate on tip approval: a topic with no approved tips in
// `tips_library` will refuse to generate (returns a clear error). This
// matches the agreed workflow — tips are reviewed before a topic ships.

import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";
import { gatherSummaryInputs, type SummaryInputs, type LiveMessage } from "./summary-inputs";
import { getTopic, type TopicKey } from "./topics";
import { getTopicSpec, type TopicSpec } from "./topics/registry";
import { stripDashes } from "./text-cleanup";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 1000;

/** How many tips to ask Claude to weave in per draft. */
const TIPS_PER_DRAFT = 2;

/** Pool size to draw weighted-random from. Larger pool = more variety
 *  across drafts; too large dilutes the most-relevant tips. */
const TIP_CANDIDATE_POOL = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TipRow {
  id: number;
  topic: string;
  tip_text: string;
  applies_to_tags: string[];
  weight: number;
}

export interface GenerateDraftResult {
  draft: string;
  topicKey: TopicKey;
  tipsUsed: TipRow[];
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

// ---------------------------------------------------------------------------
// Tip selection
// ---------------------------------------------------------------------------

/**
 * Fetch approved tips for a topic. Optionally filter to those whose
 * applies_to_tags intersect with `clientTags`. If filtering yields too few,
 * we widen by including untagged tips so we always have enough to draw from.
 */
async function fetchEligibleTips(
  topic: TopicKey,
  clientTags: string[]
): Promise<TipRow[]> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("tips_library")
    .select("id, topic, tip_text, applies_to_tags, weight")
    .eq("topic", topic)
    .eq("approved", true);
  if (error) {
    console.error(
      `[daily-coacher/topic-generator] Failed to fetch tips for ${topic}:`,
      error.message
    );
    return [];
  }

  const all = (data || []).map((row) => ({
    id: row.id as number,
    topic: row.topic as string,
    tip_text: row.tip_text as string,
    applies_to_tags: Array.isArray(row.applies_to_tags)
      ? (row.applies_to_tags as string[])
      : [],
    weight: (row.weight as number | null) ?? 1,
  }));

  if (clientTags.length === 0) return all;

  // Tag-matched tips first; fall back to all approved tips so we don't
  // starve the prompt when tags don't overlap with anything in the library.
  const tagged = all.filter((t) =>
    t.applies_to_tags.some((tag) => clientTags.includes(tag))
  );
  if (tagged.length >= TIPS_PER_DRAFT) return tagged;

  const untagged = all.filter((t) => t.applies_to_tags.length === 0);
  const merged = [...tagged, ...untagged];
  return merged.length >= TIPS_PER_DRAFT ? merged : all;
}

/**
 * Weighted-random pick of `count` tips from a pool. Higher `weight` = more
 * likely to be picked. Without replacement (no duplicate tip in one draft).
 */
function pickWeightedRandom(pool: TipRow[], count: number): TipRow[] {
  const remaining = [...pool];
  const picked: TipRow[] = [];
  while (picked.length < count && remaining.length > 0) {
    const totalWeight = remaining.reduce((s, t) => s + Math.max(1, t.weight), 0);
    let r = Math.random() * totalWeight;
    let chosenIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      r -= Math.max(1, remaining[i].weight);
      if (r <= 0) {
        chosenIdx = i;
        break;
      }
    }
    picked.push(remaining[chosenIdx]);
    remaining.splice(chosenIdx, 1);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const BASE_SYSTEM_PROMPT = `You are drafting a message for a fitness coach to send to their client. Output ONLY the message text. No preamble, no closing remarks, no signatures, no meta-commentary, no "here's a draft." The coach will copy-paste your output directly into Everfit.

VOICE AND FORMAT (strict):
1. Conversational, warm, direct. Sound like a coach who knows this client well, not a corporate help desk.
2. 2-5 sentences. Long enough to land the point; short enough to read in 5 seconds. Length should match the topic's natural weight: quick check-ins are short, harder conversations get a bit more.
3. Address the client by their first name in the opening 1-2 sentences when natural. Don't shoehorn it.
4. Use the client's own framing where you can. If their summary mentions they "want discipline with eating," echo that language. Builds trust that you've been listening.
5. End with a question or a clear next action when appropriate. Not every message needs one; celebrations and acknowledgments don't.

HARD RULES (do not violate):
1. NEVER include specific numeric macros, calorie counts, or weight measurements (no "175g protein", no "2,400 cal", no "down 12 lbs"). Talk in qualitative terms only.
2. NEVER reference Everfit, training program details, scheduled workouts, or anything you weren't told in the inputs. The summary is your only source of truth about this client.
3. NEVER fabricate. If a tip references something the client hasn't mentioned (e.g., a specific allergy), don't apply that tip; pick a different angle.
4. NEVER use em-dashes (U+2014, the long dash) or en-dashes (U+2013) anywhere in your output. Use commas, periods, parentheses, or restructure the sentence. This is a hard formatting rule because em-dashes signal AI-generated text and erode the "from a real coach" feel.
5. Weave the provided TIPS naturally. Don't quote them verbatim, don't list them. They're guidance, not boilerplate.
6. Don't sign off with "Coach" or use signature lines. The coach's name will appear in Everfit automatically.`;

function buildSystemPrompt(spec: TopicSpec): string {
  return `${BASE_SYSTEM_PROMPT}\n\n${spec.systemPromptAddendum}`;
}

function fmtRecentMessages(msgs: LiveMessage[]): string {
  if (msgs.length === 0) return "  (none)";
  return msgs
    .map((m) => `  [${m.role}] ${m.message.trim()}`)
    .join("\n");
}

function buildUserPrompt(args: {
  inputs: SummaryInputs;
  topicLabel: string;
  tips: TipRow[];
}): string {
  const { inputs, topicLabel, tips } = args;
  const summary = inputs.client.daily_coacher_summary || "(no summary on file)";
  const messages = inputs.liveMessages; // already chronological

  const tipsBlock =
    tips.length > 0
      ? tips.map((t, i) => `  ${i + 1}. ${t.tip_text}`).join("\n")
      : "  (no tips supplied; fall back to general best practices for this topic)";

  return `<client_summary>
${summary}
</client_summary>

<recent_exchanges>
${fmtRecentMessages(messages)}
</recent_exchanges>

<topic>${topicLabel}</topic>

<tips_to_weave_in>
${tipsBlock}
</tips_to_weave_in>

Draft the message now. Output only the message text.`;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  return key;
}

export class TopicNotReadyError extends Error {
  constructor(public topicKey: TopicKey, public reason: string) {
    super(`Topic ${topicKey} not ready: ${reason}`);
  }
}

/**
 * Generate a draft message for a client + topic. Throws TopicNotReadyError
 * when the topic doesn't have a spec file or has no approved tips —
 * caller should surface this clearly to the coach (e.g., "this topic is
 * still being prepared").
 */
export async function generateTopicDraft(
  clientId: number,
  topicKey: TopicKey
): Promise<GenerateDraftResult> {
  const spec = getTopicSpec(topicKey);
  if (!spec) {
    throw new TopicNotReadyError(
      topicKey,
      "no per-topic spec yet (the topic hasn't been wired in)"
    );
  }

  const inputs = await gatherSummaryInputs(clientId);
  if (!inputs) throw new Error(`Client ${clientId} not found`);

  // Per-topic tag derivation from intake (e.g., "vegetarian", "fat_loss").
  const clientTags = spec.deriveClientTags(inputs);

  const eligibleTips = await fetchEligibleTips(topicKey, clientTags);
  if (eligibleTips.length === 0) {
    throw new TopicNotReadyError(
      topicKey,
      "no approved tips in tips_library for this topic yet"
    );
  }

  // Take a candidate pool, then weighted-random pick to weave into the draft.
  const pool = eligibleTips.slice(0, TIP_CANDIDATE_POOL);
  const tipsUsed = pickWeightedRandom(pool, TIPS_PER_DRAFT);

  const topicLabel = getTopic(topicKey).label;
  const systemPrompt = buildSystemPrompt(spec);
  const userPrompt = buildUserPrompt({ inputs, topicLabel, tips: tipsUsed });

  const anthropic = new Anthropic({ apiKey: getApiKey() });
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Claude returned no text block for ${topicKey} draft`);
  }

  return {
    draft: stripDashes(textBlock.text),
    topicKey,
    tipsUsed,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}
