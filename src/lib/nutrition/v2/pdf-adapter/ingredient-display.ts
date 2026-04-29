/**
 * Phase B5 — ingredient display helpers.
 *
 * Solver outputs `{slug, grams}`. The PDF renderer expects
 * `{name (display), amount (formatted string), category, calories, ...}`.
 * This module bridges that gap using ONLY the in-memory ingredient cache
 * (B2 / B4 share the same Map). No DB calls.
 *
 * Display name source:
 *   The cache populated by `getIngredientNutrition` only stores nutrition
 *   columns + category, NOT the human-readable `name` column. This module
 *   exposes a separate `getIngredientDisplayMeta` that the caller pre-warms
 *   from the same query, returning a Map<slug, {name, category}> for the
 *   adapter to consume. If a slug isn't in the supplied map, AdapterError
 *   is thrown rather than silently using the slug as the display name —
 *   the renderer should never see a `chicken_breast_cooked_skinless` label.
 */

import type { IngredientNutrition } from "../solver";
import { AdapterError } from "./types";

// ============================================================================
// Display meta (slug → { name, category })
// ============================================================================

export interface IngredientDisplayMeta {
  /** Display name, e.g. "Chicken Breast (Skinless, Cooked)". */
  name: string;
  /** DB category, e.g. "protein" / "grain" / "fat". */
  category: string;
}

/**
 * Lookup helper. Throws AdapterError("missing_ingredient") if the slug
 * isn't in the supplied map — caller is expected to pre-warm display
 * data for every slug appearing in the plan.
 */
export function lookupDisplayMeta(
  slug: string,
  meta: ReadonlyMap<string, IngredientDisplayMeta>,
): IngredientDisplayMeta {
  const hit = meta.get(slug);
  if (!hit) {
    throw new AdapterError(
      "missing_ingredient",
      `pdf-adapter: ingredient '${slug}' has no display meta. ` +
        `Caller must pre-warm display names for every slug in the plan ` +
        `(see getDisplayMetaForSlugs).`,
    );
  }
  return hit;
}

// ============================================================================
// Amount formatter (mirrors legacy route.ts:166 amountLabel)
// ============================================================================

/**
 * Format a gram amount as a display string like "180g" or "20ml".
 * Liquids/sauces ≤ 30g render as ml. Solids always render as g.
 *
 * This logic is duplicated from route.ts (legacy `amountLabel`) to keep
 * the adapter independent of route-handler internals. Same heuristic.
 */
export function formatAmount(grams: number, category: string): string {
  if (
    (category === "beverage" || category === "fat" || category === "condiment") &&
    grams <= 30
  ) {
    return `${Math.round(grams)}ml`;
  }
  return `${Math.round(grams)}g`;
}

// ============================================================================
// Per-ingredient macro contribution
// ============================================================================

export interface IngredientMacros {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Compute macro contribution for `grams` of an ingredient using the
 * cached nutrition data. Pure arithmetic.
 */
export function computeIngredientMacros(
  grams: number,
  nutrition: IngredientNutrition,
): IngredientMacros {
  const f = grams / 100;
  return {
    calories: nutrition.calories_per_100g * f,
    proteinG: nutrition.protein_g_per_100g * f,
    carbsG: nutrition.carbs_g_per_100g * f,
    fatG: nutrition.fat_g_per_100g * f,
  };
}
