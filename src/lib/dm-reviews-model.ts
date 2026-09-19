// Direct Anthropic transport for the nightly DM review. Every call here is a
// single synchronous Messages request — no chat-agent middleman, no run rows,
// no collector tick — so the whole brief finishes inside one cron invocation.
//
// Cost, rough, per night (Opus 5: $5 in / $25 out per MTok):
//   ~50 engaged conversations x ~40 messages x ~25 tokens  ~= 50k tokens of
//   threads, sent once across 8-12 setter batches, +~2k tokens of rubric per
//   batch  ~= 70-80k input tokens total ($0.40). Output: ~2k tokens per batch
//   (brief + per-conversation JSON) plus thinking ~= 30-50k tokens ($1.00).
//   Combine: ~15k in / ~2k out ($0.15). Order of $1.50-2.50 per night.
import Anthropic from "@anthropic-ai/sdk";

export const DM_MODEL = "claude-opus-5";
const ATTEMPTS = 3;
const GRADE_MAX_TOKENS = 24000; // brief body + one JSON entry per conversation; a 30-conversation batch
// ran past 8k on 2026-09-18 and the model stopped mid-object (every batch failed)
const COMBINE_MAX_TOKENS = 8000; // the day's brief
const MIN_ATTEMPT_MS = 20_000; // don't start an attempt that can't finish

/* ------------------------------- schema ---------------------------------- */

export type DmStage = "cold" | "engaged" | "qualified" | "link_sent" | "booked" | "dead";

export interface GradedConversation {
  lead: string;
  grade: number;
  stage: DmStage;
  biggest_miss: string | null;
  best_line: string | null;
  next_message: string | null;
}

export interface SetterGrading {
  brief_md: string;
  setter: string;
  grade: number;
  conversations: GradedConversation[];
  strengths: string[];
  fixes: string[];
  drill: string;
  flag_for_manager: string[];
}

const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] };

/** Structured-output schema for one setter batch. No numeric/string constraints
 *  (the API accepts only a JSON-schema subset); ranges are enforced in the prompt. */
export const SETTER_GRADING_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    brief_md: { type: "string", description: "The SETTER BRIEF body in Slack mrkdwn, exactly the structure requested, under 3,000 characters." },
    setter: { type: "string" },
    grade: { type: "integer", description: "0-100 for the setter's day." },
    conversations: {
      type: "array",
      description: "One entry per conversation, in the order given.",
      items: {
        type: "object",
        properties: {
          lead: { type: "string", description: "Lead name exactly as in the conversation header." },
          grade: { type: "integer", description: "0-100." },
          stage: { type: "string", enum: ["cold", "engaged", "qualified", "link_sent", "booked", "dead"] },
          biggest_miss: { ...nullableString, description: "One short sentence (under 20 words), or null." },
          best_line: { ...nullableString, description: "Verbatim setter line (under 120 characters), or null." },
          next_message: { ...nullableString, description: "The exact next message the setter should send (under 200 characters), or null if closed." },
        },
        required: ["lead", "grade", "stage", "biggest_miss", "best_line", "next_message"],
        additionalProperties: false,
      },
    },
    strengths: { type: "array", items: { type: "string" } },
    fixes: { type: "array", items: { type: "string" } },
    drill: { type: "string" },
    flag_for_manager: { type: "array", items: { type: "string" } },
  },
  required: ["brief_md", "setter", "grade", "conversations", "strengths", "fixes", "drill", "flag_for_manager"],
  additionalProperties: false,
};

/* ------------------------------ transport -------------------------------- */

/** A failure the caller should record and move past — retries are exhausted or pointless. */
export class DmModelError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "DmModelError";
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new DmModelError("ANTHROPIC_API_KEY is not set", false);
  // Retries are handled here (with a deadline), not by the SDK.
  return (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 }));
}

function isTransient(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.APIUserAbortError) return true;
  if (err instanceof Anthropic.APIError) return err.status === 408 || err.status === 409 || err.status === 529;
  return false;
}

function textOf(message: Anthropic.Message): string {
  return message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

/**
 * One streamed Messages request with our own retry/deadline loop: up to
 * ATTEMPTS tries on transient errors (429/5xx/529/connection/abort), linear
 * backoff, every attempt bounded by `deadline` (absolute ms). Streaming keeps
 * the ~80k-char grading inputs clear of request timeouts; `thinking` is
 * omitted (adaptive by default on this model) and no sampling params are sent.
 */
async function request(params: Anthropic.MessageStreamParams, deadline: number, label: string): Promise<Anthropic.Message> {
  const anthropic = getClient();
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const left = deadline - Date.now();
    if (left < MIN_ATTEMPT_MS) break;
    try {
      const message = await anthropic.messages
        .stream(params, { timeout: left, signal: AbortSignal.timeout(left) })
        .finalMessage();
      if (message.stop_reason !== "end_turn") {
        throw new DmModelError(`${label}: model stopped with ${message.stop_reason}`, false);
      }
      return message;
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err instanceof DmModelError ? err : new DmModelError(`${label}: ${err instanceof Error ? err.message : String(err)}`, false);
      console.error(`[dm-reviews] ${label} attempt ${attempt}/${ATTEMPTS} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
  const why = lastErr instanceof Error ? lastErr.message : lastErr ? String(lastErr) : "out of time before the first attempt";
  throw new DmModelError(`${label}: gave up after retries — ${why}`, true);
}

/** Grade one setter batch: the brief body plus one structured grade per conversation. */
export async function gradeSetterBatch(prompt: string, deadline: number, label: string): Promise<SetterGrading> {
  const message = await request({
    model: DM_MODEL,
    max_tokens: GRADE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
    output_config: { format: { type: "json_schema", schema: SETTER_GRADING_SCHEMA } },
  }, deadline, label);
  const text = textOf(message);
  if (!text) throw new DmModelError(`${label}: empty reply`, false);
  return JSON.parse(text) as SetterGrading;
}

/** Write the single combined DM BRIEF (plain Slack mrkdwn). */
export async function writeDmBrief(prompt: string, deadline: number): Promise<string> {
  const message = await request({
    model: DM_MODEL,
    max_tokens: COMBINE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  }, deadline, "dm-brief");
  const text = textOf(message);
  if (text.length < 120) throw new DmModelError("dm-brief: reply too short to be a DM brief", false);
  return text;
}

/* --------------------------------- pool ---------------------------------- */

/** Run `fn` over `items` with at most `limit` in flight; results keep item order,
 *  and one rejection never cancels the others. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
