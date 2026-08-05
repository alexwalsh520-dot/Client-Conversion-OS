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

// ─────────────────────────────────────────────────────────────────────────
// THE RECEIPT (Brick 2). Contract version 2.
//
// Every answer now carries its own proof. The point is stated once, here:
// THE READER MUST NEVER HAVE TO TRUST THE AI THAT CARRIED THE ANSWER, ONLY
// THE SYSTEM THAT COMPUTED IT.
//
// The concrete failure this kills: an AI reported "100% attribution coverage"
// because its hand-written query silently excluded 26 unassigned wins worth
// $31,395. A receipt makes that impossible to say by accident, because the
// answer itself states what it covered and what it left out.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The four SIGNED certainty buckets (registry_definitions: certainty_buckets
 * v1, coverage v1), computed by door_coverage_block() and nowhere else, so a
 * bucket cannot mean one thing in one answer and something else in another.
 */
export interface CoverageBlock {
  window_wins_total: number;
  window_cash_usd_cents_total: number;
  buckets: {
    ad: { wins: number; cash_usd_cents: number };
    organic: { wins: number; cash_usd_cents: number };
    misc_chat: { wins: number; cash_usd_cents: number };
    awaiting_review: { wins: number; cash_usd_cents: number };
  };
  /** (ad + organic + misc_chat) / total, 0 to 100, one decimal. */
  classified_pct_wins: number;
  classified_pct_cash: number;
  /** One plain sentence naming the gap and anything unusual about it. */
  note: string;
}

/** One source that is older than its operational threshold. */
export interface StaleSource {
  source: string;
  last_written_at: string | null;
  threshold_hours: number;
  note: string;
}

/** Something this answer does NOT include, said out loud with its size. */
export interface AnswerExclusion {
  what: string;
  count: number;
  cash_usd_cents?: number;
  why: string;
}

export interface AnswerReceipt {
  contract_version: 2;
  question_key: string;
  /** Bumped when a question's MEANING changes, never for a wording tweak. */
  question_version: number;
  asked_at: string;
  /** Who asked: "utari", "mcp", "app", "accuracy", "test", or unknown. */
  caller: string;
  /** The parameters AFTER registry resolution, e.g. {client: "jake"} even
   *  when the caller said "jake_divljak". */
  params_as_resolved: Record<string, unknown>;
  /** Empty when the input was already canonical. */
  aliases_resolved: Array<{ given: string; resolved_to: string }>;
  window: { from: string; to: string; kind: string } | null;
  /** The v2 data version the answer was read at, when it depends on v2 facts. */
  data_version: number | null;
  freshness: AsOf[];
  /** Empty when every source is inside its threshold. */
  stale: StaleSource[];
  /** REQUIRED on money answers. Null only where no sale row is touched. */
  coverage: CoverageBlock | null;
  exclusions: AnswerExclusion[];
  /** Auto-generated from the signed definitions. Never hand-written per call. */
  caveats: string[];
  certainty: "machine_certain" | "human_resolved_included" | "directional" | "cannot_answer";
  definitions_cited: Array<{
    registry: "warehouse.definitions" | "registry_definitions";
    name: string;
    version?: number;
  }>;
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
   *  e.g. kill_scale_inputs saying the verdict is not the service's to give.
   *  Kept for backward compatibility: standing notes ALSO appear in
   *  receipt.caveats, but no existing caller loses the field it reads. */
  note?: string;
  /** Brick 2. The proof that travels with the numbers. */
  receipt: AnswerReceipt;
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
  /**
   * Brick 2. Every alias the registry resolved during THIS ask, recorded as it
   * happens so the receipt can show the caller what its input became. Shared
   * by reference with the service; the templates only append to it.
   */
  resolved: AliasTrail;
}

/**
 * A per-ask record of registry resolutions, with a cache so the same alias
 * costs one round trip no matter how many parameters mention it.
 */
export interface AliasTrail {
  /** given -> canonical, in the order they were resolved. */
  entries: Array<{ given: string; resolved_to: string }>;
  /** lowercased given -> canonical or null (null = looked up, found nothing). */
  cache: Map<string, string | null>;
}

export function newAliasTrail(): AliasTrail {
  return { entries: [], cache: new Map() };
}

/** What a question needs in its receipt, declared once per question. */
export interface ReceiptDeclaration {
  /** Bumped only when the question's MEANING changes. */
  version: number;
  /**
   * What kind of window this question answers over, for the receipt. Null for
   * a question that has no window at all (define, data_health, person_lookup).
   */
  windowKind: string | null;
  /**
   * TRUE when the answer reports money that traces to adsv2_sale_facts. A
   * money answer MUST carry a coverage block; the service enforces it rather
   * than trusting each template to remember.
   */
  money: boolean;
  /** Whether this answer's numbers move with the v2 data version. */
  usesDataVersion: boolean;
  /** What this answer does not include, stated up front and honestly. */
  exclusions?: readonly AnswerExclusion[];
  /** Signed definitions this question always leans on. */
  definitionsCited?: readonly string[];
  certainty?: AnswerReceipt["certainty"];
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
  /** Brick 2. What this question's receipt must carry. */
  receipt: ReceiptDeclaration;
  run(ctx: TemplateContext, params: Record<string, unknown>): Promise<{
    answers: unknown;
    definitionKeys?: readonly string[];
    asOf: AsOf[];
    usedParams: Record<string, unknown>;
    note?: string;
    /** The window this answer actually landed on, when the template works it
     *  out rather than being handed it (yesterday_summary). */
    window?: { from: string; to: string } | null;
    /** The clients the coverage block should be scoped to. Defaults to the
     *  active roster when the template does not say. */
    coverageClients?: readonly string[];
    /** Anything this particular run left out, on top of the standing list. */
    exclusions?: readonly AnswerExclusion[];
  }>;
}
