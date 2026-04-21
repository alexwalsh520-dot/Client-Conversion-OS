/**
 * Deterministic macro calculator from a meal plan structure.
 * Never uses AI. Only lookup × multiply × sum.
 */

import type { IngredientRow } from "./ingredient-filter";
import type { MacroTargets } from "./macro-calculator";

export interface IngredientQty {
  slug: string;
  grams: number;
}

export interface Meal {
  name: string;        // "Breakfast", "Snack 1", etc.
  time?: string;       // "7:30 AM"
  dishName?: string;   // "Tex-Mex Egg Scramble" — short dish name from Claude
  ingredients: IngredientQty[];
}

export interface DayPlan {
  day: number;         // 1-7
  meals: Meal[];
}

export interface MacroSummary {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Compute macros for a meal using the ingredient DB.
 */
export function computeMealMacros(
  meal: Meal,
  byslug: Map<string, IngredientRow>
): MacroSummary & { unknownSlugs: string[] } {
  let calories = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  const unknownSlugs: string[] = [];

  for (const ing of meal.ingredients) {
    const row = byslug.get(ing.slug);
    if (!row) {
      unknownSlugs.push(ing.slug);
      continue;
    }
    const factor = ing.grams / 100;
    calories += Number(row.calories_per_100g) * factor;
    proteinG += Number(row.protein_g_per_100g) * factor;
    carbsG += Number(row.carbs_g_per_100g) * factor;
    fatG += Number(row.fat_g_per_100g) * factor;
  }
  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG * 10) / 10,
    carbsG: Math.round(carbsG * 10) / 10,
    fatG: Math.round(fatG * 10) / 10,
    unknownSlugs,
  };
}

/**
 * Compute total day macros.
 */
export function computeDayMacros(
  day: DayPlan,
  byslug: Map<string, IngredientRow>
): MacroSummary & { unknownSlugs: string[] } {
  let calories = 0;
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;
  const unknownSlugs: string[] = [];

  for (const meal of day.meals) {
    const m = computeMealMacros(meal, byslug);
    calories += m.calories;
    proteinG += m.proteinG;
    carbsG += m.carbsG;
    fatG += m.fatG;
    unknownSlugs.push(...m.unknownSlugs);
  }
  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG * 10) / 10,
    carbsG: Math.round(carbsG * 10) / 10,
    fatG: Math.round(fatG * 10) / 10,
    unknownSlugs,
  };
}

/**
 * Validate plan against targets ±7%.
 */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
  dayMacros: MacroSummary[];
  unknownSlugs: string[];
  blockedFound: string[];
}

const TOLERANCE = 0.07;

export function validatePlan(
  days: DayPlan[],
  byslug: Map<string, IngredientRow>,
  targets: MacroTargets,
  blockedIngredientSlugs: Set<string>
): ValidationResult {
  const errors: string[] = [];
  const dayMacros: MacroSummary[] = [];
  const allUnknown: string[] = [];
  const blockedFound: string[] = [];

  if (days.length !== 7) {
    errors.push(`Expected 7 days, got ${days.length}`);
  }

  for (const day of days) {
    const m = computeDayMacros(day, byslug);
    dayMacros.push({
      calories: m.calories,
      proteinG: m.proteinG,
      carbsG: m.carbsG,
      fatG: m.fatG,
    });
    allUnknown.push(...m.unknownSlugs);

    // Check blocked ingredients
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) {
        if (blockedIngredientSlugs.has(ing.slug)) {
          blockedFound.push(`Day ${day.day}: ${ing.slug}`);
        }
      }
    }

    // Per-day tolerance check
    const calOff = Math.abs(m.calories - targets.calories) / targets.calories;
    const pOff = Math.abs(m.proteinG - targets.proteinG) / targets.proteinG;
    const fOff = Math.abs(m.fatG - targets.fatG) / targets.fatG;

    if (calOff > TOLERANCE) {
      errors.push(`Day ${day.day}: calories ${m.calories} off target ${targets.calories} by ${Math.round(calOff * 100)}%`);
    }
    if (pOff > TOLERANCE) {
      errors.push(`Day ${day.day}: protein ${m.proteinG}g off target ${targets.proteinG}g by ${Math.round(pOff * 100)}%`);
    }
    if (fOff > TOLERANCE) {
      errors.push(`Day ${day.day}: fat ${m.fatG}g off target ${targets.fatG}g by ${Math.round(fOff * 100)}%`);
    }
  }

  if (allUnknown.length > 0) {
    errors.push(`Unknown ingredient slugs: ${[...new Set(allUnknown)].join(", ")}`);
  }
  if (blockedFound.length > 0) {
    errors.push(`Blocked ingredients used: ${blockedFound.join("; ")}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    dayMacros,
    unknownSlugs: [...new Set(allUnknown)],
    blockedFound,
  };
}

/**
 * Consolidate ingredients across all 7 days into a grocery list.
 */
export interface GroceryItem {
  slug: string;
  name: string;
  category: string;
  totalGrams: number;
  totalOz: number;
}

export function buildGroceryList(
  days: DayPlan[],
  byslug: Map<string, IngredientRow>
): GroceryItem[] {
  const totals = new Map<string, number>();
  for (const day of days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) {
        totals.set(ing.slug, (totals.get(ing.slug) || 0) + ing.grams);
      }
    }
  }

  const items: GroceryItem[] = [];
  for (const [slug, grams] of totals) {
    const row = byslug.get(slug);
    if (!row) continue;
    items.push({
      slug,
      name: row.name,
      category: row.category,
      totalGrams: Math.round(grams),
      totalOz: Math.round((grams / 28.3495) * 10) / 10,
    });
  }

  // Sort by category, then name
  const categoryOrder = ["protein", "seafood", "dairy", "grain", "carb", "legume", "vegetable", "fruit", "fat", "condiment", "supplement", "beverage"];
  items.sort((a, b) => {
    const ai = categoryOrder.indexOf(a.category);
    const bi = categoryOrder.indexOf(b.category);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  return items;
}
