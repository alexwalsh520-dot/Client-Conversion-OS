/**
 * Macro verifier — implementation.
 *
 * Walks each day of the plan, recomputes daily macro totals from
 * `WeekPlanSuccess.days[i].solve.slots[j].ingredients[k].grams` × the
 * per-ingredient per-100g nutrition data, and compares against the
 * day's targets.
 *
 * The plan's `solve.diagnostics.daily` already carries the same
 * computed values (set by the generator's WeekPlanSuccess wrapper),
 * but we recompute here as a defensive cross-check.
 */

import { getIngredientNutrition } from "../solver/ingredient-data";
import type {
  DayDiagnostic,
  VerifyMacrosInput,
  VerifyMacrosResult,
} from "./types";

const DEFAULT_TOLERANCE = 0.15;
/**
 * High-calorie builds (lean_gain, bulk, endurance with large kcal targets)
 * have a structurally harder time hitting daily macro precision because
 * total grams across the plan are larger and per-meal portions push the
 * ceiling of slug min-max ranges. We loosen tolerance for these clients
 * rather than block plans that are directionally correct.
 *
 * Threshold: training_kcal_target ≥ 2900.
 * Loosened tolerance: ±25% per macro (vs ±15% default).
 *
 * Same BLOCK threshold applies to both: ≥4/7 days off → BLOCK in caller.
 */
const HIGH_KCAL_THRESHOLD = 2900;
const HIGH_KCAL_TOLERANCE = 0.25;

export async function verifyMacros(
  input: VerifyMacrosInput,
): Promise<VerifyMacrosResult> {
  // Resolution order:
  //   1. Explicit input.tolerance_pct (test override) wins.
  //   2. Otherwise, auto-loosen for high-kcal builds.
  //   3. Otherwise, the default ±15%.
  const tol =
    input.tolerance_pct ??
    (input.targets.training.calories >= HIGH_KCAL_THRESHOLD
      ? HIGH_KCAL_TOLERANCE
      : DEFAULT_TOLERANCE);

  // Pre-fetch nutrition for all slugs in the plan.
  const allSlugs = new Set<string>();
  for (const day of input.plan.days) {
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) allSlugs.add(ing.slug);
    }
  }
  const nutritionMap = await getIngredientNutrition(Array.from(allSlugs));

  const day_diagnostics: DayDiagnostic[] = [];
  let failedDays = 0;
  const retryFragments: string[] = [];

  for (const day of input.plan.days) {
    const targets =
      day.day_kind === "rest" ? input.targets.rest : input.targets.training;

    let actualKcal = 0;
    let actualP = 0;
    let actualC = 0;
    let actualF = 0;
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        const nut = nutritionMap.get(ing.slug);
        if (!nut) continue;
        actualP += (ing.grams * nut.protein_g_per_100g) / 100;
        actualC += (ing.grams * nut.carbs_g_per_100g) / 100;
        actualF += (ing.grams * nut.fat_g_per_100g) / 100;
      }
    }
    actualKcal = actualP * 4 + actualC * 4 + actualF * 9;

    const kcalDrift = pctDrift(actualKcal, targets.calories);
    const pDrift = pctDrift(actualP, targets.proteinG);
    const cDrift = pctDrift(actualC, targets.carbsG);
    const fDrift = pctDrift(actualF, targets.fatG);

    const failReasons: string[] = [];
    if (Math.abs(kcalDrift) > tol)
      failReasons.push(
        `kcal ${pctSign(kcalDrift)} off (${Math.round(actualKcal)} vs ${targets.calories})`,
      );
    if (Math.abs(pDrift) > tol)
      failReasons.push(
        `protein ${pctSign(pDrift)} off (${round1(actualP)}g vs ${targets.proteinG}g)`,
      );
    if (Math.abs(cDrift) > tol)
      failReasons.push(
        `carbs ${pctSign(cDrift)} off (${round1(actualC)}g vs ${targets.carbsG}g)`,
      );
    if (Math.abs(fDrift) > tol)
      failReasons.push(
        `fat ${pctSign(fDrift)} off (${round1(actualF)}g vs ${targets.fatG}g)`,
      );

    const pass = failReasons.length === 0;
    if (!pass) {
      failedDays += 1;
      retryFragments.push(`Day ${day.day} (${day.day_kind}): ${failReasons.join("; ")}`);
    }

    day_diagnostics.push({
      day_number: day.day,
      day_kind: day.day_kind,
      kcal_actual: round1(actualKcal),
      kcal_target: targets.calories,
      kcal_drift_pct: round1(kcalDrift * 100),
      protein_actual_g: round1(actualP),
      protein_target_g: targets.proteinG,
      protein_drift_pct: round1(pDrift * 100),
      carbs_actual_g: round1(actualC),
      carbs_target_g: targets.carbsG,
      carbs_drift_pct: round1(cDrift * 100),
      fat_actual_g: round1(actualF),
      fat_target_g: targets.fatG,
      fat_drift_pct: round1(fDrift * 100),
      pass,
      fail_reasons: failReasons,
    });
  }

  const retry_hint = retryFragments.length
    ? `Macro verification failed on ${retryFragments.length} day(s). Adjust portions to bring each day within ±${Math.round(tol * 100)}% of all daily macro targets:\n${retryFragments.join("\n")}\nDirectional guidance: when a macro is + (too high), reduce portions of slugs that contribute that macro. When − (too low), increase those portions or substitute denser slugs. Recompute totals before submitting.`
    : "";

  return {
    pass: failedDays === 0,
    day_diagnostics,
    failed_days: failedDays,
    retry_hint,
  };
}

function pctDrift(actual: number, target: number): number {
  if (target === 0) return 0;
  return actual / target - 1;
}

function pctSign(pct: number): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${Math.round(pct * 100)}%`;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
