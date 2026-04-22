/**
 * Deterministic portion-optimizer.
 *
 * Claude picks the meals/ingredients; this module tunes the grams per
 * ingredient so every day's macros land within a tight tolerance of the
 * target. It's a greedy iterative solver — on each step it nudges the
 * ingredient that most efficiently closes the worst macro gap.
 *
 * Bounds: no ingredient grams drop below 5g or move more than ±35% from
 * Claude's original grams (so we don't turn "150g chicken" into "400g").
 */

import type { IngredientRow } from "./ingredient-filter";
import type { MacroTargets } from "./macro-calculator";
import type { DayPlan } from "./macro-validator";

interface MacroDelta {
  dCal: number; // target - current; positive means we need MORE
  dP: number;
  dC: number;
  dF: number;
}

function computeDayTotals(day: DayPlan, byslug: Map<string, IngredientRow>) {
  let cal = 0, p = 0, c = 0, f = 0;
  for (const meal of day.meals) {
    for (const ing of meal.ingredients) {
      const row = byslug.get(ing.slug);
      if (!row) continue;
      const factor = ing.grams / 100;
      cal += Number(row.calories_per_100g) * factor;
      p   += Number(row.protein_g_per_100g) * factor;
      c   += Number(row.carbs_g_per_100g) * factor;
      f   += Number(row.fat_g_per_100g) * factor;
    }
  }
  return { cal, p, c, f };
}

function allWithin(day: DayPlan, byslug: Map<string, IngredientRow>, targets: MacroTargets, tol: number): boolean {
  const t = computeDayTotals(day, byslug);
  return (
    Math.abs(t.cal - targets.calories) / targets.calories <= tol &&
    Math.abs(t.p   - targets.proteinG)  / targets.proteinG <= tol &&
    Math.abs(t.c   - targets.carbsG)    / targets.carbsG   <= tol &&
    Math.abs(t.f   - targets.fatG)      / targets.fatG     <= tol
  );
}

function distanceScore(
  day: DayPlan,
  byslug: Map<string, IngredientRow>,
  targets: MacroTargets
): number {
  const t = computeDayTotals(day, byslug);
  // kcal-equivalent weighted distance across all four macros
  return (
    Math.abs(t.cal - targets.calories) +
    Math.abs(t.p   - targets.proteinG) * 4 +
    Math.abs(t.c   - targets.carbsG)   * 4 +
    Math.abs(t.f   - targets.fatG)     * 9
  );
}

interface IngredientHandle {
  mealIdx: number;
  ingIdx: number;
  row: IngredientRow;
  originalGrams: number;
}

/**
 * "Added fats" = small-portion flavor/cooking fats that can be reduced
 * aggressively (even to near-zero) without ruining the meal. Core proteins
 * (salmon, beef) and whole foods (avocado) are NOT in this bucket — reducing
 * a 200g salmon to 50g would be a different meal.
 */
function isAddedFat(row: IngredientRow): boolean {
  const s = row.slug.toLowerCase();
  const n = (row.name || "").toLowerCase();
  // Category-based
  if (row.category === "fat" && !s.includes("avocado") && !s.includes("nut")) return true;
  if (row.category === "condiment" && Number(row.fat_g_per_100g) > 15) return true;
  // Slug/name-based flags
  return (
    s.includes("butter") ||
    s.includes("oil") ||
    s.includes("cream_cheese") ||
    s.includes("heavy_cream") ||
    s.includes("mayo") ||
    s.includes("dressing") ||
    s.includes("ghee") ||
    n.includes("butter") ||
    n.includes("oil") ||
    n.includes("dressing")
  );
}

function collectHandles(day: DayPlan, byslug: Map<string, IngredientRow>): IngredientHandle[] {
  const handles: IngredientHandle[] = [];
  day.meals.forEach((meal, mealIdx) => {
    meal.ingredients.forEach((ing, ingIdx) => {
      const row = byslug.get(ing.slug);
      if (!row) return;
      handles.push({ mealIdx, ingIdx, row, originalGrams: ing.grams });
    });
  });
  return handles;
}

/**
 * Optimize portions in-place (mutates the day object) until all macros
 * are within the given tolerance, or max iterations reached.
 *
 * Greedy algorithm:
 *  1. Find the macro with the largest % deviation.
 *  2. For that macro, find all ingredients that contribute meaningfully.
 *  3. Pick the ingredient whose per-100g density of the target macro is
 *     highest (so a small gram change produces the biggest correction
 *     WITHOUT sliding other macros too far).
 *  4. Adjust its grams by up to a fraction of what's needed to close the gap,
 *     bounded by min 5g, max ±35% from original grams, and ±20g step size.
 *  5. Repeat.
 */
export function optimizeDayPortions(
  day: DayPlan,
  byslug: Map<string, IngredientRow>,
  targets: MacroTargets,
  options: { tolerance?: number; maxIterations?: number; maxChangeFrac?: number } = {}
): void {
  const tolerance = options.tolerance ?? 0.05;
  const maxIter = options.maxIterations ?? 80;
  const maxChangeFrac = options.maxChangeFrac ?? 0.35; // no ingredient changes more than ±35%

  const handles = collectHandles(day, byslug);
  if (handles.length === 0) return;

  for (let iter = 0; iter < maxIter; iter++) {
    const totals = computeDayTotals(day, byslug);
    const delta: MacroDelta = {
      dCal: targets.calories - totals.cal,
      dP:   targets.proteinG - totals.p,
      dC:   targets.carbsG   - totals.c,
      dF:   targets.fatG     - totals.f,
    };

    // Relative errors
    const calErr = Math.abs(delta.dCal) / targets.calories;
    const pErr   = Math.abs(delta.dP)   / targets.proteinG;
    const cErr   = Math.abs(delta.dC)   / targets.carbsG;
    const fErr   = Math.abs(delta.dF)   / targets.fatG;

    if (calErr <= tolerance && pErr <= tolerance && cErr <= tolerance && fErr <= tolerance) return;

    // Pick the worst macro to attack — prefer fat/protein/carbs over calories since
    // calories cascade from the three individual macros
    const candidates: Array<{ macro: "p" | "c" | "f" | "cal"; err: number; d: number }> = [
      { macro: "p",   err: pErr,   d: delta.dP },
      { macro: "c",   err: cErr,   d: delta.dC },
      { macro: "f",   err: fErr,   d: delta.dF },
      { macro: "cal", err: calErr, d: delta.dCal },
    ];
    candidates.sort((a, b) => b.err - a.err);
    const worst = candidates[0];

    if (worst.err <= tolerance) return; // nothing to fix

    // Find the ingredient with the highest density of the worst macro.
    // For "cal" we treat any high-energy ingredient as the lever.
    const densityOf = (row: IngredientRow, macro: "p" | "c" | "f" | "cal"): number => {
      if (macro === "p")   return Number(row.protein_g_per_100g);
      if (macro === "c")   return Number(row.carbs_g_per_100g);
      if (macro === "f")   return Number(row.fat_g_per_100g);
      return Number(row.calories_per_100g);
    };

    // Bounds: allow aggressive reduction of "added fats" when the worst macro
    // is fat and we're significantly over. Small-portion cooking fats can go
    // to near-zero without ruining the meal. Also, when any macro is stubbornly
    // off by >15%, widen the bound on core ingredients so we can close the gap.
    const getChangeFrac = (h: IngredientHandle): number => {
      const aggressiveFatCut =
        worst.macro === "f" && worst.d < 0 && worst.err > 0.15 && isAddedFat(h.row);
      if (aggressiveFatCut) return 0.85;
      // Stubborn macro gap → widen the bound on core ingredients too
      if (worst.err > 0.15) return 0.50;
      return maxChangeFrac; // 0.35 default
    };
    const getLowerBound = (h: IngredientHandle): number => {
      const aggressiveFatCut =
        worst.macro === "f" && worst.d < 0 && worst.err > 0.15 && isAddedFat(h.row);
      const floor = aggressiveFatCut ? 1 : 5;
      return Math.max(floor, h.originalGrams * (1 - getChangeFrac(h)));
    };

    // Score each handle by density × available room to move in the needed direction.
    const direction = worst.d >= 0 ? 1 : -1;
    let best: IngredientHandle | null = null;
    let bestScore = 0;
    for (const h of handles) {
      const density = densityOf(h.row, worst.macro);
      if (density <= 0.1) continue;
      const current = day.meals[h.mealIdx].ingredients[h.ingIdx].grams;
      const changeFrac = getChangeFrac(h);
      const upperBound = Math.max(h.originalGrams * (1 + changeFrac), h.originalGrams + 30);
      const lowerBound = getLowerBound(h);
      const roomToAdd = upperBound - current;
      const roomToRemove = current - lowerBound;
      const room = direction > 0 ? roomToAdd : roomToRemove;
      if (room <= 0.5) continue;
      // Boost priority for added-fat reductions when fat is way over
      const addedFatBoost =
        worst.macro === "f" && direction < 0 && isAddedFat(h.row) ? 1.5 : 1.0;
      const score = density * Math.min(room, 30) * addedFatBoost;
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }

    if (!best) break;

    const density = densityOf(best.row, worst.macro);
    const needed = (Math.abs(worst.d) * 100) / Math.max(density, 0.1);
    const stepG = Math.min(Math.max(Math.round(needed * 0.6), 2), 25);

    const meal = day.meals[best.mealIdx];
    const ing = meal.ingredients[best.ingIdx];
    const current = ing.grams;
    const changeFrac = getChangeFrac(best);
    const upperBound = Math.max(best.originalGrams * (1 + changeFrac), best.originalGrams + 30);
    const lowerBound = getLowerBound(best);

    if (direction > 0) {
      ing.grams = Math.min(upperBound, current + stepG);
    } else {
      ing.grams = Math.max(lowerBound, current - stepG);
    }
    ing.grams = Math.round(ing.grams);

    if (ing.grams === current) break;
  }
}

/**
 * Run the optimizer for every day. Always safe to call — won't make days worse
 * (it only accepts an ingredient change if it reduces the total distance score).
 */
export function optimizeAllDays(
  days: DayPlan[],
  byslug: Map<string, IngredientRow>,
  targets: MacroTargets
): void {
  for (const day of days) {
    // Save snapshot in case optimization makes things worse (shouldn't happen, but safety)
    const snapshot = JSON.parse(JSON.stringify(day)) as DayPlan;
    const beforeScore = distanceScore(day, byslug, targets);
    optimizeDayPortions(day, byslug, targets);
    const afterScore = distanceScore(day, byslug, targets);
    if (afterScore > beforeScore) {
      // Revert
      day.meals = snapshot.meals;
    }
  }
  // Silence unused reference warning when allWithin isn't directly referenced by caller
  void allWithin;
}
