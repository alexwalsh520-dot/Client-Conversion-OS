// ─────────────────────────────────────────────────────────────────────────
// THE DOOR ITSELF.
//
// One function in, one shape out. A question is either on the locked list and
// answered by its one fixed template, or it is refused in writing with the
// nearest allowed question named. There is no third path: no free-form query,
// no "close enough", no improvising.
//
// Every answer that leaves this file carries three things, or it does not
// leave: the numbers, the quoted meaning of every metric it names, and a real
// as-of time read from the write timestamp of the rows underneath.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { QUESTIONS, QUESTION_BY_KEY, QUESTION_KEYS } from "./registry";
import { asOfFor, quoteDefinitions, readFreshness } from "./sources";
import { BadParams, type Db, type DoorAnswer, type DoorRefusal, type DoorResult, type TemplateContext } from "./types";

export interface AskInput {
  question_key: unknown;
  params?: Record<string, unknown>;
}

export interface AskOptions {
  db?: Db;
  now?: Date;
  clients?: readonly string[];
}

/**
 * Which allowed questions are nearest to what was asked. Deliberately simple
 * and deterministic: shared words in the key and the description, best first.
 * It suggests; it never substitutes one question for another.
 */
export function nearestQuestions(asked: string, limit = 3): Array<{ question_key: string; description: string }> {
  const words = asked
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  const scored = QUESTIONS.map((q) => {
    const hay = `${q.key} ${q.description}`.toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score += 1;
    // A caller that typed something close to a real key gets that key first.
    if (q.key.toLowerCase().includes(asked.toLowerCase().trim())) score += 5;
    if (asked.toLowerCase().trim().includes(q.key.toLowerCase())) score += 5;
    return { q, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((s) => ({ question_key: s.q.key, description: s.q.description }));
}

function refuse(asked: string, reason: string): DoorRefusal {
  return {
    refused: true,
    asked,
    reason,
    nearest: nearestQuestions(asked),
    allowed_questions: [...QUESTION_KEYS],
  };
}

/** The whole locked list, for a caller that wants to know what it may ask. */
export function describeDoor(): Array<{
  question_key: string;
  description: string;
  params: string;
  sources: readonly string[];
}> {
  return QUESTIONS.map((q) => ({
    question_key: q.key,
    description: q.description,
    params: q.params,
    sources: q.sources,
  }));
}

/**
 * ASK. The only way through this door.
 */
export async function askQuestion(input: AskInput, opts: AskOptions = {}): Promise<DoorResult> {
  const asked = typeof input?.question_key === "string" ? input.question_key.trim() : String(input?.question_key ?? "");
  if (!asked) {
    return refuse(
      "(nothing)",
      "No question was named. This door answers a fixed list of questions and nothing else; name one of them.",
    );
  }
  const entry = QUESTION_BY_KEY[asked];
  if (!entry) {
    return refuse(
      asked,
      `"${asked}" is not on the list of questions this door answers. Nothing was guessed at and no query was composed. Ask one of the allowed questions instead.`,
    );
  }

  const params = (input.params ?? {}) as Record<string, unknown>;
  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return refuse(asked, "params must be an object of named values.");
  }

  const ctx: TemplateContext = {
    db: opts.db ?? getServiceSupabase(),
    clients: opts.clients ?? [...ADSV2_SERVED_CLIENTS],
    now: opts.now ?? new Date(),
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Each template runs under its own wall-clock budget, the same discipline
    // the accuracy checks use: a template that hangs is abandoned rather than
    // left to block the caller.
    const result = await Promise.race([
      entry.run(ctx, params),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${entry.key} ran past its ${Math.round(entry.budgetMs / 1000)} second budget`)),
          entry.budgetMs,
        );
      }),
    ]);

    const [definitions, freshness] = await Promise.all([
      result.definitionKeys && result.definitionKeys.length
        ? quoteDefinitions(ctx.db, result.definitionKeys)
        : Promise.resolve([]),
      readFreshness(ctx.db),
    ]);

    const answer: DoorAnswer = {
      question_key: entry.key,
      question: entry.description,
      params: result.usedParams,
      answers: result.answers,
      definitions_quoted: definitions,
      as_of: result.asOf.length ? result.asOf : asOfFor(freshness, entry.freshnessSources),
      sources: [...entry.sources],
    };
    if (result.note) answer.note = result.note;
    return answer;
  } catch (err) {
    if (err instanceof BadParams) {
      return refuse(asked, err.message);
    }
    // A template that broke is reported as a refusal rather than as a number.
    // A wrong number is worse than no number, every time.
    return refuse(
      asked,
      `This question is on the list, but answering it failed, so no number is being returned: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
