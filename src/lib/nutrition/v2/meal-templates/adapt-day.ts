/**
 * Phase B6a-pivot — convert one MealTemplateDay into a DayPick the
 * solver can consume. Walks every ingredient through substituteIngredient.
 *
 * On success: returns ok=true with the DayPick + a substitution log
 * (zero entries when no swaps were needed; populated entries when one
 * or more ingredients had to walk their swap_chain).
 *
 * On failure (any single ingredient's swap_chain exhausted): returns
 * ok=false with a PickError carrying the swap_chain_exhausted violation
 * kind. The orchestrator turns this into the day's WeekPlanFailure entry.
 */

import type { MealTemplateDay } from "../types";
import type { DayPick, PickError, PickViolation } from "../picker";
import { substituteIngredient } from "./substitute";
import type { AdaptDayResult, SubstitutionLog } from "./types";

export interface AdaptDayArgs {
  day: MealTemplateDay;
  /** 1-based day number (1..7) — needed because MealTemplateDay only has weekday name. */
  day_number: number;
  /** Hard-excluded slugs from merged allergy/medical/dietary rules. */
  hard_exclude: ReadonlySet<string>;
}

export function adaptDayToPick(args: AdaptDayArgs): AdaptDayResult {
  const { day, day_number, hard_exclude } = args;
  const dayKind = day.day_kind ?? "training";

  const slots: DayPick["slots"] = [];
  const substitutions: SubstitutionLog[] = [];
  const violations: PickViolation[] = [];

  for (const meal of day.meals) {
    const resolvedIngredients: DayPick["slots"][number]["ingredients"] = [];

    for (let i = 0; i < meal.ingredients.length; i++) {
      const ing = meal.ingredients[i];
      const sub = substituteIngredient(ing, hard_exclude);

      if (sub.kind === "exhausted") {
        violations.push({
          kind: "swap_chain_exhausted",
          slot_index: meal.slot,
          slug: ing.slug,
          message:
            `Slot ${meal.slot} (${meal.name}) ingredient ${i} ("${ing.slug}", ` +
            `${ing.anchor ? "anchor" : "non-anchor"}): swap_chain exhausted. ` +
            `Walked [${sub.walked.join(", ")}], all hard-excluded.`,
        });
        continue;
      }

      resolvedIngredients.push({
        slug: sub.resolved_slug,
        isAnchor: ing.anchor,
      });

      if (sub.was_substituted && sub.swap_path) {
        substitutions.push({
          slot_index: meal.slot,
          ingredient_index: i,
          primary_slug: ing.slug,
          resolved_slug: sub.resolved_slug,
          swap_path: sub.swap_path,
        });
      }
    }

    slots.push({
      index: meal.slot,
      ingredients: resolvedIngredients,
    });
  }

  if (violations.length > 0) {
    const pick_error: PickError = {
      type: "PICK_ERROR",
      reason:
        `Template substitution exhausted on day ${day_number} (${day.day_of_week}): ` +
        `${violations.length} ingredient(s) had no viable swap_chain candidate.`,
      day_number,
      violations,
      llm_calls_used: 0,
    };
    return { ok: false, pick_error };
  }

  return {
    ok: true,
    day_pick: {
      day: day_number,
      day_kind: dayKind,
      slots,
      llm_calls_used: 0,
      retried: false,
    },
    substitutions,
  };
}
