/**
 * Phase B6a-pivot — generateWeekPlanFromTemplate.
 *
 * Replaces the B3 LLM picker on the production critical path. No
 * Anthropic API calls. No retry budget. Substitution + solve, that's it.
 *
 * Returns the SAME WeekPlanSuccess / WeekPlanFailure shape as B3 so
 * downstream stages (audit, adapter, render) don't change.
 */

import { solveDay } from "../solver";
import type { SolveDayInput, SolveDayOutput, ZeroedSlug } from "../solver";
import { isInfeasibilityError, isSolveDaySuccess } from "../solver";
import type {
  BuildSpec,
  MealDistribution,
  MealTemplate,
  PlanComplexity,
} from "../types";
import type { MacroTargets } from "../../macro-calculator";
import type {
  DayDiagnostics,
  GenerationDiagnostics,
  WeekPlanFailure,
  WeekPlanOutput,
  WeekPlanSuccess,
} from "../picker";
import { adaptDayToPick } from "./adapt-day";
import type { SubstitutionLog } from "./types";

// ============================================================================
// Public input + entry point
// ============================================================================

export interface TemplateOrchestratorInput {
  template: MealTemplate;
  trainingTargets: MacroTargets;
  /** Required even when the build doesn't cycle — we just won't use it on
   *  non-Endurance templates. Caller passes B1's `targets.rest` regardless. */
  restTargets: MacroTargets;
  buildSpec: BuildSpec;
  /** Distribution for training-day macro percentages. */
  distribution: MealDistribution;
  /** Distribution for rest-day macro percentages (Endurance only). When
   *  absent, rest days reuse the training distribution. */
  restDistribution?: MealDistribution;
  hardExclude: ReadonlySet<string>;
  planComplexity: PlanComplexity;
}

export interface TemplateOrchestratorOptions {
  /** Optional progress hook (B6a pipeline updates job.current_step here). */
  onDayStart?: (dayNumber: number) => void | Promise<void>;
}

export async function generateWeekPlanFromTemplate(
  input: TemplateOrchestratorInput,
  opts: TemplateOrchestratorOptions = {},
): Promise<WeekPlanOutput> {
  const startTime = Date.now();
  const { template } = input;

  if (template.weekly_pattern.length !== 7) {
    throw new Error(
      `generateWeekPlanFromTemplate: template "${template.id}" has ${template.weekly_pattern.length} days; expected 7.`,
    );
  }

  const dayResults: WeekPlanSuccess["days"] = [];
  const failedDays: number[] = [];
  const failureRecords: WeekPlanFailure["days"] = [];
  const perDayDiag: DayDiagnostics[] = [];
  const allSubstitutions: Array<{ day_number: number; substitutions: SubstitutionLog[] }> = [];

  for (let i = 0; i < 7; i++) {
    const dayNumber = i + 1;
    const templateDay = template.weekly_pattern[i];
    const dayKind = templateDay.day_kind ?? "training";

    if (opts.onDayStart) {
      await opts.onDayStart(dayNumber);
    }

    const dayStart = Date.now();

    // ---- Step 1: substitute via swap_chains ----
    const adapted = adaptDayToPick({
      day: templateDay,
      day_number: dayNumber,
      hard_exclude: input.hardExclude,
    });

    if (!adapted.ok) {
      // Substitution failure — record day as failed and continue to next.
      failedDays.push(dayNumber);
      failureRecords.push({
        day: dayNumber,
        day_kind: dayKind,
        pickError: adapted.pick_error,
      });
      perDayDiag.push({
        day_number: dayNumber,
        day_kind: dayKind,
        llm_calls_used: 0,
        anchor_reprompt_fired: false,
        infeasibility_reprompt_fired: false,
        solver_status: "INFEASIBLE",
        total_wall_clock_ms: Date.now() - dayStart,
        zeroed_slugs: [],
      });
      continue;
    }

    if (adapted.substitutions.length > 0) {
      allSubstitutions.push({ day_number: dayNumber, substitutions: adapted.substitutions });
    }

    // ---- Step 2: solve macros ----
    const dayTargets = dayKind === "training" ? input.trainingTargets : input.restTargets;
    const dayDistribution =
      dayKind === "rest" && input.restDistribution
        ? input.restDistribution
        : input.distribution;

    const solverInput: SolveDayInput = {
      targets: dayTargets,
      buildSpec: input.buildSpec,
      distribution: dayDistribution,
      slots: adapted.day_pick.slots.map((s) => ({
        index: s.index,
        ingredients: s.ingredients.map((ing) => ({
          slug: ing.slug,
          isAnchor: ing.isAnchor,
        })),
      })),
      hardExclude: input.hardExclude,
      bias: input.buildSpec.default_solver_bias,
      planComplexity: input.planComplexity,
    };
    const solveResult: SolveDayOutput = await solveDay(solverInput);

    if (isInfeasibilityError(solveResult)) {
      failedDays.push(dayNumber);
      failureRecords.push({
        day: dayNumber,
        day_kind: dayKind,
        pick: adapted.day_pick,
        solve: solveResult,
      });
      perDayDiag.push({
        day_number: dayNumber,
        day_kind: dayKind,
        llm_calls_used: 0,
        anchor_reprompt_fired: false,
        infeasibility_reprompt_fired: false,
        solver_status: "INFEASIBLE",
        total_wall_clock_ms: Date.now() - dayStart,
        zeroed_slugs: [],
      });
      continue;
    }

    if (!isSolveDaySuccess(solveResult)) {
      // defensive
      failedDays.push(dayNumber);
      failureRecords.push({
        day: dayNumber,
        day_kind: dayKind,
        pick: adapted.day_pick,
        solve: solveResult,
      });
      perDayDiag.push({
        day_number: dayNumber,
        day_kind: dayKind,
        llm_calls_used: 0,
        anchor_reprompt_fired: false,
        infeasibility_reprompt_fired: false,
        solver_status: "INFEASIBLE",
        total_wall_clock_ms: Date.now() - dayStart,
        zeroed_slugs: [],
      });
      continue;
    }

    const zeroedSlugs: ZeroedSlug[] = solveResult.diagnostics.zeroed_slugs ?? [];

    // Build per-slot dish-name map from the template (slot.index → dish_name)
    // for the PDF adapter to read downstream. Static per-day metadata —
    // doesn't depend on the solver's output.
    const slotDishNames: Record<number, string> = {};
    for (const meal of templateDay.meals) {
      slotDishNames[meal.slot] = meal.dish_name;
    }

    dayResults.push({
      day: dayNumber,
      day_kind: dayKind,
      pick: adapted.day_pick,
      solve: solveResult,
      targets: dayTargets,
      distribution: dayDistribution,
      template_meta: { slot_dish_names: slotDishNames },
    });
    perDayDiag.push({
      day_number: dayNumber,
      day_kind: dayKind,
      llm_calls_used: 0,
      anchor_reprompt_fired: false,
      infeasibility_reprompt_fired: false,
      solver_status: solveResult.status,
      total_wall_clock_ms: Date.now() - dayStart,
      solver_fallback_level: solveResult.diagnostics.fallback_level,
      zeroed_slugs: zeroedSlugs,
    });
  }

  const diagnostics: GenerationDiagnostics & {
    template_id: string;
    template_substitutions: typeof allSubstitutions;
  } = {
    per_day: perDayDiag,
    total_llm_calls: 0,
    total_wall_clock_ms: Date.now() - startTime,
    days_with_reprompts: 0,
    days_with_solver_fallback: perDayDiag.filter(
      (d) => d.solver_fallback_level !== undefined && d.solver_fallback_level > 10,
    ).length,
    days_infeasible: perDayDiag.filter((d) => d.solver_status === "INFEASIBLE").length,
    template_id: template.id,
    template_substitutions: allSubstitutions,
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
    reason: `${failedDays.length} day(s) failed substitution or solve from template "${template.id}": ${failedDays.join(", ")}`,
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
