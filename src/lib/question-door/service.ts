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
//
// BRICK 2 adds a fourth: a RECEIPT. What the answer covered, what it left out,
// how fresh it was, which aliases were resolved, and how certain it is. The
// service assembles it around the template's result, so a template cannot
// forget to carry one and cannot talk its way out of a caveat.
//
// And every ask is now WRITTEN DOWN. A refusal goes to door_miss_log, which is
// the certification backlog; an answered ask goes to door_ask_log, which is the
// usage record. Both are fire-and-forget: a logging failure must never turn a
// good answer, or an honest refusal, into an error.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { getDataVersion } from "@/lib/ads-v2/db";
import { QUESTIONS, QUESTION_BY_KEY, QUESTION_KEYS } from "./registry";
import { activeRoster, assembleReceipt, coverageFor } from "./receipts";
import { asOfFor, quoteDefinitions, readFreshness } from "./sources";
import {
  BadParams,
  newAliasTrail,
  type AnswerExclusion,
  type CoverageBlock,
  type Db,
  type DoorAnswer,
  type DoorRefusal,
  type DoorResult,
  type TemplateContext,
} from "./types";

export interface AskInput {
  question_key: unknown;
  params?: Record<string, unknown>;
}

export interface AskOptions {
  db?: Db;
  now?: Date;
  clients?: readonly string[];
  /** Who is asking. Goes on the receipt and into both logs. */
  caller?: string;
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

function refusal(asked: string, reason: string): DoorRefusal {
  return {
    refused: true,
    asked,
    reason,
    nearest: nearestQuestions(asked),
    allowed_questions: [...QUESTION_KEYS],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// THE TWO LOGS. Fire and forget, always.
//
// A refusal that fails to log is still a refusal. An answer that fails to log
// is still an answer. Neither is ever allowed to become an error, because a
// bookkeeping problem must not cost a caller a correct response.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Write one row and never let it matter if it fails.
 *
 * The try/catch is around the CALL, not only the promise, and that is the
 * whole point. `db.from(table).insert(row)` can throw synchronously, and a
 * `.catch()` on the result never runs when the throw happens before a promise
 * exists. Attaching only a `.catch()` here would mean a bookkeeping problem
 * could turn a correct answer, or an honest refusal, into an error: the exact
 * outcome this logging is written to avoid.
 */
function logRow(db: Db, table: string, row: Record<string, unknown>): void {
  try {
    void Promise.resolve(db.from(table).insert(row)).catch(() => {});
  } catch {
    // Deliberately silent. Losing a log line is a cost worth paying; losing
    // the caller's answer to save a log line is not.
  }
}

function logMiss(db: Db, row: {
  asked: string;
  params: Record<string, unknown>;
  caller: string;
  reason: string;
  nearest: Array<{ question_key: string; description: string }>;
}): void {
  logRow(db, "door_miss_log", row);
}

function logAsk(db: Db, row: {
  question_key: string;
  params: Record<string, unknown>;
  caller: string;
  ok: boolean;
  ms: number;
}): void {
  logRow(db, "door_ask_log", row);
}

/** The whole locked list, for a caller that wants to know what it may ask. */
export function describeDoor(): Array<{
  question_key: string;
  description: string;
  params: string;
  sources: readonly string[];
  question_version: number;
}> {
  return QUESTIONS.map((q) => ({
    question_key: q.key,
    description: q.description,
    params: q.params,
    sources: q.sources,
    question_version: q.receipt.version,
  }));
}

/**
 * THE MISS BACKLOG. What callers keep asking that this door cannot answer.
 *
 * describeDoor says what the door CAN do. This says what it should learn to do
 * next, ordered by how often it has been asked, so "what do we certify next" is
 * a question with a stored answer rather than an opinion.
 */
export async function describeMisses(
  limit = 25,
  opts: { db?: Db } = {},
): Promise<{
  note: string;
  misses: Array<{
    asked: string;
    times_asked: number;
    callers: string[];
    last_asked_at: string;
    last_reason: string;
  }>;
}> {
  const db = opts.db ?? getServiceSupabase();
  const { data, error } = await db.rpc("door_miss_backlog", { p_limit: limit });
  if (error) throw new Error(`could not read the miss log: ${error.message}`);
  const misses = ((data || []) as Array<Record<string, unknown>>).map((r) => ({
    asked: String(r.asked ?? ""),
    times_asked: Number(r.times_asked) || 0,
    callers: (r.callers as string[]) || [],
    last_asked_at: String(r.last_asked_at ?? ""),
    last_reason: String(r.last_reason ?? ""),
  }));
  return {
    note:
      "Every question this door refused, grouped by what was asked and ordered by how often. This is the certification backlog: a question asked repeatedly is a question worth adding to the locked list, through a reviewed change, never through drift.",
    misses,
  };
}

/**
 * ASK. The only way through this door.
 */
export async function askQuestion(input: AskInput, opts: AskOptions = {}): Promise<DoorResult> {
  const started = Date.now();
  const caller = opts.caller?.trim() || "unknown";
  const db = opts.db ?? getServiceSupabase();
  const now = opts.now ?? new Date();
  const params = (input.params ?? {}) as Record<string, unknown>;

  const asked = typeof input?.question_key === "string" ? input.question_key.trim() : String(input?.question_key ?? "");

  const refuse = (a: string, reason: string): DoorRefusal => {
    const r = refusal(a, reason);
    logMiss(db, { asked: a, params, caller, reason, nearest: r.nearest });
    return r;
  };

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

  if (typeof params !== "object" || params === null || Array.isArray(params)) {
    return refuse(asked, "params must be an object of named values.");
  }

  // The roster comes from registry_entities since Brick 2. An explicit
  // clients option still wins, because the accuracy checks and the tests pass
  // their own and must stay deterministic.
  let rosterFallback = false;
  let clients: readonly string[];
  if (opts.clients) {
    clients = opts.clients;
  } else {
    const roster = await activeRoster(db, now);
    clients = roster.clients;
    rosterFallback = roster.usedFallback;
  }

  const ctx: TemplateContext = { db, clients, now, resolved: newAliasTrail() };

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

    const definitionKeys = result.definitionKeys ?? [];
    const [definitions, freshness] = await Promise.all([
      definitionKeys.length ? quoteDefinitions(ctx.db, definitionKeys) : Promise.resolve([]),
      readFreshness(ctx.db),
    ]);
    const asOf = result.asOf.length ? result.asOf : asOfFor(freshness, entry.freshnessSources);

    // ── The window this answer landed on ──────────────────────────────────
    // A template that works its own window out (yesterday_summary) reports it;
    // otherwise it comes from the checked parameters. Either way the receipt
    // states the real window rather than echoing what was asked for.
    const decl = entry.receipt;
    const used = result.usedParams;
    const windowFrom = result.window?.from ?? (typeof used.date_from === "string" ? used.date_from : null);
    const windowTo = result.window?.to ?? (typeof used.date_to === "string" ? used.date_to : null);
    const window =
      decl.windowKind && windowFrom && windowTo
        ? { from: windowFrom, to: windowTo, kind: decl.windowKind }
        : null;

    // ── Who this answer actually covers ───────────────────────────────────
    // One creator when the question named one, the whole roster when it said
    // "all" or is roster-wide by design. Both the coverage scope and the
    // caveat rules read this, so an answer about Tyson never carries Jake's
    // currency note and never counts Jake's cash.
    const subjects: readonly string[] = result.coverageClients ?? (
      typeof used.client === "string" && used.client !== "all" ? [used.client] : [...clients]
    );

    // ── Coverage: required on every money answer ──────────────────────────
    // The service reads it, not the template, so all money answers share one
    // tested implementation of the four signed buckets.
    let coverage: CoverageBlock | null = null;
    if (decl.money && window) {
      coverage = await coverageFor(ctx.db, subjects, window.from, window.to);
    }

    const dataVersion = decl.usesDataVersion ? await getDataVersion(ctx.db).catch(() => null) : null;

    const exclusions: AnswerExclusion[] = [
      ...(decl.exclusions ?? []),
      ...(result.exclusions ?? []),
    ];

    const receipt = await assembleReceipt({
      db: ctx.db,
      questionKey: entry.key,
      questionVersion: decl.version,
      caller,
      now,
      params: used,
      trail: ctx.resolved,
      window,
      dataVersion,
      freshness: asOf,
      coverage,
      clients: subjects,
      rosterFallback,
      exclusions,
      definitionKeys,
      // Whether this answer reports money, so the two money-only caveat rules
      // (sales lag, AUD conversion) do not fire on a trust answer that reports
      // no cash at all.
      money: decl.money,
      // The signed rules this answer applied: the ones the question standingly
      // leans on, plus any the RUN resolved (a ruleset's components are only
      // known once the ruleset has been loaded). Brick 2 declared these and
      // never read them; Brick 3 needs them on the receipt, because a verdict
      // that applies a signed threshold without naming it cannot be audited.
      registryDefinitions: [
        ...new Set([...(decl.definitionsCited ?? []), ...(result.registryDefinitionsCited ?? [])]),
      ],
      // A run that reached its own certainty wins over the declared one. Today
      // that is only Brick 3's `cannot_answer`, which a question must be able
      // to reach when a signed definition it applies is missing.
      certainty: result.certainty ?? decl.certainty ?? "machine_certain",
      note: result.note,
    });

    const answer: DoorAnswer = {
      question_key: entry.key,
      question: entry.description,
      params: used,
      answers: result.answers,
      definitions_quoted: definitions,
      as_of: asOf,
      sources: [...entry.sources],
      receipt,
    };
    if (result.note) answer.note = result.note;

    logAsk(db, { question_key: entry.key, params: used, caller, ok: true, ms: Date.now() - started });
    return answer;
  } catch (err) {
    // A question that IS on the list but could not be answered is written to
    // the ask log as a failure as well as to the miss log, so the usage record
    // is the complete picture of what the door was put through.
    logAsk(db, { question_key: entry.key, params, caller, ok: false, ms: Date.now() - started });
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
