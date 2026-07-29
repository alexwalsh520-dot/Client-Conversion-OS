// ─────────────────────────────────────────────────────────────────────────
// THE QUESTION DOOR (Build 4) — shared shapes.
//
// This folder is the ONE front door every AI uses to ask about the money.
// A question is either on the locked list in registry.ts, in which case it is
// answered by exactly one fixed template that reads stored rows, or it is
// refused in writing. No AI ever composes SQL through this door.
//
// Nothing here writes a money number. Every template is read-only toward the
// money system; it reads saved answers, stamped facts, the change log, the
// merged ads/people tables, the definitions registry and the accuracy rows.
// ─────────────────────────────────────────────────────────────────────────

import type { getServiceSupabase } from "@/lib/supabase";

export type Db = ReturnType<typeof getServiceSupabase>;

/** One metric's stored meaning, quoted verbatim from warehouse.definitions. */
export interface QuotedDefinition {
  key: string;
  label: string;
  /** The plain-English sentence, exactly as stored. Never paraphrased. */
  meaning: string;
  /** Where the number comes from, exactly as stored. */
  source: string;
  format: string;
  is_calculated: boolean;
}

/**
 * How fresh one underlying source is, from a real stored timestamp. Never a
 * guess and never "now": every entry names the row whose write time it read.
 */
export interface AsOf {
  /** The stored place this timestamp came from, e.g. "warehouse.answers". */
  source: string;
  /** The real write time of the newest row this answer depends on, or null
   *  when the source legitimately holds no rows for these parameters. */
  last_written_at: string | null;
  /** Plain-English note, e.g. "the saved answer for this window". */
  note: string;
}

/** A successful answer. Carries the numbers, the meanings, and the freshness. */
export interface DoorAnswer {
  question_key: string;
  /** What this question is, in plain words, from the registry. */
  question: string;
  /** The parameters actually used, after checking (never the raw input). */
  params: Record<string, unknown>;
  /** The answer body. Its shape is fixed per question and documented there. */
  answers: unknown;
  /** Every metric named in this answer, with its stored meaning quoted. */
  definitions_quoted: QuotedDefinition[];
  /** How fresh each underlying source is. */
  as_of: AsOf[];
  /** The stored places this answer was read from. */
  sources: string[];
  /** Present only when the question's own answer needs a standing caveat,
   *  e.g. kill_scale_inputs saying the verdict is not the service's to give. */
  note?: string;
}

/**
 * An honest refusal. A question that is not on the list is never guessed at:
 * the door says what was asked, that it is not allowed, and which allowed
 * question is nearest.
 */
export interface DoorRefusal {
  refused: true;
  /** What the caller asked for, echoed back. */
  asked: string;
  /** Why it was refused, in plain words. */
  reason: string;
  /** The nearest allowed questions, best first. Can be empty. */
  nearest: Array<{ question_key: string; description: string }>;
  /** The whole locked list, so the caller can correct itself in one step. */
  allowed_questions: string[];
}

export type DoorResult = DoorAnswer | DoorRefusal;

export function isRefusal(r: DoorResult): r is DoorRefusal {
  return (r as DoorRefusal).refused === true;
}

/** Thrown by a template when its parameters are wrong. The door turns this
 *  into a refusal rather than letting a half-understood question through. */
export class BadParams extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadParams";
  }
}

export interface TemplateContext {
  db: Db;
  /** The creators v2 serves, read from the engine's roster, never hardcoded. */
  clients: readonly string[];
  now: Date;
}

/** One entry on the locked list. The template is the ONLY way this question is
 *  ever answered; there is no second path and no free-form fallback. */
export interface QuestionEntry {
  key: string;
  /** What this question answers, in plain words, for a non-technical reader. */
  description: string;
  /** The parameters it takes, described in plain words for the caller. */
  params: string;
  /** The stored places its template reads. Shown on every answer. */
  sources: readonly string[];
  /** Which stored sources its as-of timestamps come from. */
  freshnessSources: readonly string[];
  /** Wall-clock budget. A template that hangs is abandoned, never left to
   *  block the caller. */
  budgetMs: number;
  run(ctx: TemplateContext, params: Record<string, unknown>): Promise<{
    answers: unknown;
    definitionKeys?: readonly string[];
    asOf: AsOf[];
    usedParams: Record<string, unknown>;
    note?: string;
  }>;
}
