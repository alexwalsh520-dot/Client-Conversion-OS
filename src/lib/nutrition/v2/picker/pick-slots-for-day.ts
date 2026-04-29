/**
 * Phase B3 — pickSlotsForDay.
 *
 * Pure LLM-and-validate. Owns one internal validation retry. Does NOT call
 * solveDay. Returns DayPick (slots only) or PickError.
 *
 * Lifecycle:
 *   1. Build system + user prompts
 *   2. Call LLM (call 1)
 *   3. Parse JSON, validate against context
 *   4. If valid → return DayPick
 *   5. If invalid → build retry user message with violations + raw response
 *   6. Call LLM again (call 2) with the retry message appended as continuation
 *   7. Parse + validate
 *   8. If valid → return DayPick
 *   9. If still invalid → return PickError with the second-attempt violations
 *
 * The orchestrator handles cross-day budget (max 3 LLM calls per day) by
 * calling pickSlotsForDay multiple times with `solverFeedback` populated.
 * Each pickSlotsForDay invocation may use 1–2 LLM calls internally.
 */

import { computePerSlotTargets } from "../solver";
import {
  buildSystemPrompt,
  buildUserPrompt,
  buildValidationRetryMessage,
} from "./build-prompt";
import { parsePickResponse, validatePick } from "./validate-pick";
import type {
  DayPick,
  DayPickInput,
  LLMClient,
  PickError,
  PickResult,
  PickViolation,
} from "./types";

export interface PickOptions {
  llmClient: LLMClient;
  /** Set of slugs that exist in the DB. Validation cross-references this. */
  knownSlugs: ReadonlySet<string>;
  /**
   * Maximum LLM calls this invocation may use. Defaults to 2 (one initial
   * + optional validation retry). Pass 1 from the orchestrator when the
   * day's call budget is nearly exhausted — the picker will skip its
   * retry and return a PickError on validation failure.
   */
  maxLlmCalls?: 1 | 2;
}

export async function pickSlotsForDay(
  input: DayPickInput,
  opts: PickOptions,
): Promise<PickResult> {
  const { llmClient, knownSlugs } = opts;
  const maxCalls = opts.maxLlmCalls ?? 2;

  const system = buildSystemPrompt();
  const perSlotTargets = computePerSlotTargets(input.targets, input.distribution);
  const initialUser = buildUserPrompt({ input, perSlotTargets });

  // ----- Attempt 1 ----------------------------------------------------------
  const raw1 = await llmClient.complete({
    system,
    user: initialUser,
    label: `pick-day-${input.day_number}-attempt-1`,
  });

  const parse1 = parsePickResponse(raw1);
  let violations1: PickViolation[];
  if (parse1.ok) {
    violations1 = validatePick(parse1.parsed, {
      distribution: input.distribution,
      hardExclude: input.hardExclude,
      planComplexity: input.planComplexity,
      knownSlugs,
    });
    if (violations1.length === 0) {
      return finalizeDayPick(input, parse1.parsed, 1, false);
    }
  } else {
    violations1 = parse1.violations;
  }

  // If the orchestrator told us we can only spend 1 call, return PickError
  // now rather than burning a second call we don't have budget for.
  if (maxCalls < 2) {
    return finalizeError(input, violations1, 1);
  }

  // ----- Attempt 2 (retry with consolidated violation feedback) -------------
  const retryMessage = buildValidationRetryMessage(violations1, raw1);
  // Compose a single user prompt that includes original context + retry feedback
  const retryUser = `${initialUser}\n\n${retryMessage}`;

  const raw2 = await llmClient.complete({
    system,
    user: retryUser,
    label: `pick-day-${input.day_number}-attempt-2`,
  });

  const parse2 = parsePickResponse(raw2);
  if (parse2.ok) {
    const violations2 = validatePick(parse2.parsed, {
      distribution: input.distribution,
      hardExclude: input.hardExclude,
      planComplexity: input.planComplexity,
      knownSlugs,
    });
    if (violations2.length === 0) {
      return finalizeDayPick(input, parse2.parsed, 2, true);
    }
    return finalizeError(input, violations2, 2);
  }
  return finalizeError(input, parse2.violations, 2);
}

// ============================================================================
// Helpers
// ============================================================================

function finalizeDayPick(
  input: DayPickInput,
  parsed: { day: number; slots: DayPick["slots"] },
  llmCallsUsed: 1 | 2,
  retried: boolean,
): DayPick {
  // Trust the LLM's day field if present, but always overwrite with the
  // input's day_number to be safe — the orchestrator owns canonical day
  // numbering.
  return {
    day: input.day_number,
    day_kind: input.day_kind,
    slots: parsed.slots,
    llm_calls_used: llmCallsUsed,
    retried,
  };
}

function finalizeError(
  input: DayPickInput,
  violations: PickViolation[],
  llmCallsUsed: number,
): PickError {
  const summary = summarizeViolations(violations);
  return {
    type: "PICK_ERROR",
    reason: `Picker validation failed after ${llmCallsUsed} LLM call(s): ${summary}`,
    day_number: input.day_number,
    violations,
    llm_calls_used: llmCallsUsed,
  };
}

function summarizeViolations(violations: PickViolation[]): string {
  const counts = new Map<string, number>();
  for (const v of violations) {
    counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([kind, n]) => `${n} ${kind}`)
    .join(", ");
}
