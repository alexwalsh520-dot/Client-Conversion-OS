/**
 * Phase B3 — generateWeekPlan orchestrator.
 *
 * Sequentially walks through 7 days. For each day:
 *   1. Call pickSlotsForDay (may use 1–2 LLM calls internally on validation
 *      retry).
 *   2. Hand the slots to solveDay.
 *   3. If solver returns INFEASIBLE → re-prompt the picker with a solver
 *      feedback hint (1 more LLM call). Retry solver.
 *   4. If solver returns SUCCESS_WITH_DEGRADATION with anchor zeros
 *      → re-prompt picker with zeroed-anchor hint. Retry solver.
 *   5. Cap total LLM calls at 3 per day. If still failing, mark day failed
 *      and continue to the next day (don't bail the whole week — coach can
 *      adjust the failed day manually).
 *   6. Append the day's anchors to weeklyHistory before moving to day N+1.
 *
 * Returns WeekPlanSuccess (all 7 days succeeded) or WeekPlanFailure
 * (≥ 1 day failed) plus a GenerationDiagnostics object for observability.
 */

import { solveDay } from "../solver";
import type { SolveDayInput, SolveDayOutput } from "../solver";
import { isInfeasibilityError, isSolveDaySuccess } from "../solver";
import { appendDayToHistory, emptyWeeklyHistory } from "./build-prompt";
import { pickSlotsForDay } from "./pick-slots-for-day";
import {
  isPickError,
  type DayDiagnostics,
  type DayPick,
  type DayPickInput,
  type GenerationDiagnostics,
  type LLMClient,
  type PickError,
  type SolverFeedback,
  type WeekPlanInput,
  type WeekPlanOutput,
  type WeekPlanSuccess,
  type WeekPlanFailure,
} from "./types";

const MAX_LLM_CALLS_PER_DAY = 3;

export interface OrchestratorOptions {
  llmClient: LLMClient;
  /** Set of slugs in the DB. Validation cross-references. */
  knownSlugs: ReadonlySet<string>;
  /**
   * Optional hook fired BEFORE each day's picker invocation. Receives the
   * 1-based day number (1..7). Used by the B6a pipeline runner to update
   * the job row's current_step ("picking_meals_day_3_of_7") so the UI
   * sees fine-grained progress during the slow B3 phase.
   *
   * Errors thrown from this hook propagate up and abort generation —
   * the runner uses this for cooperative cancellation (throws if the
   * job has been marked cancelled in the DB).
   */
  onDayStart?: (dayNumber: number) => void | Promise<void>;
}

export async function generateWeekPlan(
  input: WeekPlanInput,
  opts: OrchestratorOptions,
): Promise<WeekPlanOutput> {
  const startTime = Date.now();
  const dayKinds: ReadonlyArray<"training" | "rest"> =
    input.dayKinds ??
    (Array.from({ length: 7 }, () => "training") as ReadonlyArray<"training" | "rest">);

  if (dayKinds.length !== 7) {
    throw new Error(
      `generateWeekPlan: dayKinds must be length 7; got ${dayKinds.length}`,
    );
  }

  let history = emptyWeeklyHistory();
  const dayResults: WeekPlanSuccess["days"] = [];
  const failedDays: number[] = [];
  const failureRecords: WeekPlanFailure["days"] = [];
  const perDayDiag: DayDiagnostics[] = [];
  let totalLlmCalls = 0;

  for (let i = 0; i < 7; i++) {
    const dayNumber = i + 1;
    const dayKind = dayKinds[i];
    const targets = dayKind === "training" ? input.trainingTargets : input.restTargets;
    const distribution = dayKind === "rest" && input.restDistribution
      ? input.restDistribution
      : input.distribution;

    // B6a hook: fire onDayStart before this day's LLM work begins so the
    // pipeline runner can update job.current_step and check for cancellation.
    if (opts.onDayStart) {
      await opts.onDayStart(dayNumber);
    }

    const dayStart = Date.now();
    const dayResult = await runOneDay({
      dayNumber,
      dayKind,
      targets,
      buildSpec: input.buildSpec,
      distribution,
      hardExclude: input.hardExclude,
      planComplexity: input.planComplexity,
      weeklyHistory: history,
      llmClient: opts.llmClient,
      knownSlugs: opts.knownSlugs,
    });

    const wallClockMs = Date.now() - dayStart;
    totalLlmCalls += dayResult.llmCallsUsed;

    perDayDiag.push({
      day_number: dayNumber,
      day_kind: dayKind,
      llm_calls_used: dayResult.llmCallsUsed,
      anchor_reprompt_fired: dayResult.anchorRepromptFired,
      infeasibility_reprompt_fired: dayResult.infeasibilityRepromptFired,
      solver_status: dayResult.solverStatus,
      total_wall_clock_ms: wallClockMs,
      solver_fallback_level: dayResult.solverFallbackLevel,
      zeroed_slugs: dayResult.zeroedSlugs,
    });

    if (dayResult.kind === "success") {
      dayResults.push({
        day: dayNumber,
        day_kind: dayKind,
        pick: dayResult.pick,
        solve: dayResult.solve,
        targets,
        distribution,
      });
      history = appendDayToHistory(history, dayResult.pick);
    } else {
      failedDays.push(dayNumber);
      failureRecords.push({
        day: dayNumber,
        day_kind: dayKind,
        pick: dayResult.pick,
        solve: dayResult.solve,
        pickError: dayResult.pickError,
      });
      // Even on failure, advance history if we got a pick out — variety
      // tracking should reflect what was attempted, not punt.
      if (dayResult.pick) {
        history = appendDayToHistory(history, dayResult.pick);
      }
    }
  }

  const diagnostics: GenerationDiagnostics = {
    per_day: perDayDiag,
    total_llm_calls: totalLlmCalls,
    total_wall_clock_ms: Date.now() - startTime,
    days_with_reprompts: perDayDiag.filter(
      (d) => d.anchor_reprompt_fired || d.infeasibility_reprompt_fired,
    ).length,
    days_with_solver_fallback: perDayDiag.filter(
      (d) => d.solver_fallback_level !== undefined && d.solver_fallback_level > 10,
    ).length,
    days_infeasible: perDayDiag.filter((d) => d.solver_status === "INFEASIBLE").length,
  };

  if (failedDays.length === 0) {
    return {
      status: "SUCCESS",
      days: dayResults,
      diagnostics,
    };
  }

  return {
    status: "FAILURE",
    reason: `${failedDays.length} day(s) could not be generated within the 3-LLM-call budget: ${failedDays.join(", ")}`,
    failed_days: failedDays,
    days: [
      ...dayResults.map((d) => ({
        day: d.day,
        day_kind: d.day_kind,
        pick: d.pick,
        solve: d.solve as SolveDayOutput,
      })),
      ...failureRecords,
    ].sort((a, b) => a.day - b.day),
    diagnostics,
  };
}

// ============================================================================
// Per-day state machine
// ============================================================================

interface RunOneDayArgs {
  dayNumber: number;
  dayKind: "training" | "rest";
  targets: WeekPlanInput["trainingTargets"];
  buildSpec: WeekPlanInput["buildSpec"];
  distribution: WeekPlanInput["distribution"];
  hardExclude: WeekPlanInput["hardExclude"];
  planComplexity: WeekPlanInput["planComplexity"];
  weeklyHistory: ReturnType<typeof emptyWeeklyHistory>;
  llmClient: LLMClient;
  knownSlugs: ReadonlySet<string>;
}

interface RunOneDaySuccess {
  kind: "success";
  pick: DayPick;
  solve: import("../solver").SolveDaySuccess;
  llmCallsUsed: number;
  anchorRepromptFired: boolean;
  infeasibilityRepromptFired: boolean;
  solverStatus: "SUCCESS" | "SUCCESS_WITH_DEGRADATION";
  solverFallbackLevel?: 10 | 15 | 20;
  zeroedSlugs: import("../solver").ZeroedSlug[];
}

interface RunOneDayFailure {
  kind: "failure";
  pick?: DayPick;
  solve?: SolveDayOutput;
  pickError?: PickError;
  llmCallsUsed: number;
  anchorRepromptFired: boolean;
  infeasibilityRepromptFired: boolean;
  solverStatus: "SUCCESS" | "SUCCESS_WITH_DEGRADATION" | "INFEASIBLE";
  solverFallbackLevel?: 10 | 15 | 20;
  zeroedSlugs: import("../solver").ZeroedSlug[];
}

type RunOneDayResult = RunOneDaySuccess | RunOneDayFailure;

async function runOneDay(args: RunOneDayArgs): Promise<RunOneDayResult> {
  let llmCallsUsed = 0;
  let anchorRepromptFired = false;
  let infeasibilityRepromptFired = false;
  let lastPick: DayPick | undefined;
  let lastSolve: SolveDayOutput | undefined;
  let lastPickError: PickError | undefined;
  let solverFeedback: SolverFeedback | undefined;

  while (llmCallsUsed < MAX_LLM_CALLS_PER_DAY) {
    const remainingBudget = MAX_LLM_CALLS_PER_DAY - llmCallsUsed;
    if (remainingBudget < 1) break;

    const pickInput: DayPickInput = {
      day_number: args.dayNumber,
      day_kind: args.dayKind,
      targets: args.targets,
      buildSpec: args.buildSpec,
      distribution: args.distribution,
      hardExclude: args.hardExclude,
      planComplexity: args.planComplexity,
      weeklyHistory: args.weeklyHistory,
      solverFeedback,
    };

    // Cap the picker's internal call budget to whatever this day has left.
    // remainingBudget is at least 1 here (loop guard); if it's exactly 1,
    // pass maxLlmCalls=1 so the picker skips its validation retry and
    // returns a PickError instead of overrunning.
    const pickerMaxCalls: 1 | 2 = remainingBudget >= 2 ? 2 : 1;
    const pickResult = await pickSlotsForDay(pickInput, {
      llmClient: args.llmClient,
      knownSlugs: args.knownSlugs,
      maxLlmCalls: pickerMaxCalls,
    });

    if (isPickError(pickResult)) {
      llmCallsUsed += pickResult.llm_calls_used;
      lastPickError = pickResult;
      // PickError means LLM returned garbage twice in a row — no value
      // re-prompting. Bail.
      return {
        kind: "failure",
        pick: lastPick,
        solve: lastSolve,
        pickError: lastPickError,
        llmCallsUsed,
        anchorRepromptFired,
        infeasibilityRepromptFired,
        solverStatus: lastSolve && isSolveDaySuccess(lastSolve)
          ? lastSolve.status
          : "INFEASIBLE",
        solverFallbackLevel: lastSolve && isSolveDaySuccess(lastSolve)
          ? lastSolve.diagnostics.fallback_level
          : undefined,
        zeroedSlugs: lastSolve && isSolveDaySuccess(lastSolve)
          ? lastSolve.diagnostics.zeroed_slugs
          : [],
      };
    }

    llmCallsUsed += pickResult.llm_calls_used;
    lastPick = pickResult;

    // ----- Hand to solver -----
    const solverInput: SolveDayInput = {
      targets: args.targets,
      buildSpec: args.buildSpec,
      distribution: args.distribution,
      slots: pickResult.slots.map((s) => ({
        index: s.index,
        ingredients: s.ingredients.map((i) => ({
          slug: i.slug,
          isAnchor: i.isAnchor,
        })),
      })),
      hardExclude: args.hardExclude,
      bias: args.buildSpec.default_solver_bias,
      planComplexity: args.planComplexity,
    };
    const solveResult = await solveDay(solverInput);
    lastSolve = solveResult;

    // ----- Decide next step -----
    if (isInfeasibilityError(solveResult)) {
      // Re-prompt with infeasibility hint, if budget allows.
      if (llmCallsUsed >= MAX_LLM_CALLS_PER_DAY) {
        // Out of budget; bail.
        return {
          kind: "failure",
          pick: lastPick,
          solve: lastSolve,
          llmCallsUsed,
          anchorRepromptFired,
          infeasibilityRepromptFired,
          solverStatus: "INFEASIBLE",
          zeroedSlugs: [],
        };
      }
      infeasibilityRepromptFired = true;
      solverFeedback = {
        kind: "infeasibility",
        message: `Solver reported INFEASIBLE: ${solveResult.binding_constraint}. Recommendations: ${solveResult.recommendations.join("; ")}`,
        affected_slots: solveResult.solver_diagnostics.slot_index !== null
          ? [{
              slot_index: solveResult.solver_diagnostics.slot_index,
              issue: solveResult.solver_diagnostics.failed_constraint,
            }]
          : undefined,
      };
      continue;
    }

    if (!isSolveDaySuccess(solveResult)) {
      // Defensive: shouldn't happen, but handle gracefully.
      return {
        kind: "failure",
        pick: lastPick,
        solve: lastSolve,
        llmCallsUsed,
        anchorRepromptFired,
        infeasibilityRepromptFired,
        solverStatus: "INFEASIBLE",
        zeroedSlugs: [],
      };
    }

    // ----- Solver succeeded — check anchor degradation -----
    const anchorZeros = solveResult.diagnostics.zeroed_slugs.filter((z) => z.anchor);
    if (anchorZeros.length === 0) {
      return {
        kind: "success",
        pick: lastPick,
        solve: solveResult,
        llmCallsUsed,
        anchorRepromptFired,
        infeasibilityRepromptFired,
        solverStatus: solveResult.status,
        solverFallbackLevel: solveResult.diagnostics.fallback_level,
        zeroedSlugs: solveResult.diagnostics.zeroed_slugs,
      };
    }

    // Anchor zeros — re-prompt if budget allows, otherwise accept the
    // degraded result (it's still a feasible plan).
    if (llmCallsUsed >= MAX_LLM_CALLS_PER_DAY) {
      // Accept the degraded plan; budget exhausted.
      return {
        kind: "success",
        pick: lastPick,
        solve: solveResult,
        llmCallsUsed,
        anchorRepromptFired,
        infeasibilityRepromptFired,
        solverStatus: solveResult.status,
        solverFallbackLevel: solveResult.diagnostics.fallback_level,
        zeroedSlugs: solveResult.diagnostics.zeroed_slugs,
      };
    }
    anchorRepromptFired = true;
    solverFeedback = {
      kind: "anchor_degradation",
      message: `Solver zeroed ${anchorZeros.length} anchor protein(s). The chosen anchor(s) didn't fit the macro budget. Pick different anchors for the affected slots.`,
      affected_slots: anchorZeros.map((z) => ({
        slot_index: z.slot_index,
        issue: "anchor zeroed by solver — couldn't fit macro target",
        zeroed_anchor: z.slug,
      })),
    };
  }

  // Should be unreachable — every loop iteration returns or breaks early.
  // Defensive fall-through:
  return {
    kind: "failure",
    pick: lastPick,
    solve: lastSolve,
    pickError: lastPickError,
    llmCallsUsed,
    anchorRepromptFired,
    infeasibilityRepromptFired,
    solverStatus:
      lastSolve && isSolveDaySuccess(lastSolve)
        ? lastSolve.status
        : "INFEASIBLE",
    solverFallbackLevel:
      lastSolve && isSolveDaySuccess(lastSolve)
        ? lastSolve.diagnostics.fallback_level
        : undefined,
    zeroedSlugs:
      lastSolve && isSolveDaySuccess(lastSolve)
        ? lastSolve.diagnostics.zeroed_slugs
        : [],
  };
}
