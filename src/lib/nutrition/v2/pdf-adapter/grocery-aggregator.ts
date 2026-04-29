/**
 * Phase B5 — grocery list aggregator.
 *
 * Walks WeekPlanSuccess.days[i].solve.slots[j].ingredients[k] and sums
 * grams per slug across the entire week. Returns PdfGroceryItem[] in
 * insertion order (deterministic — first appearance in the plan ordering).
 * The renderer's grocery page applies its own category sorting downstream.
 *
 * Mirrors the legacy aggregation in route.ts:1808-1824 but operates on
 * the v2 SolveDaySuccess shape instead of the legacy day.meals shape.
 */

import type { PdfGroceryItem, WeekPlanSuccess } from "./types";
import {
  formatAmount,
  lookupDisplayMeta,
  type IngredientDisplayMeta,
} from "./ingredient-display";

interface AggEntry {
  slug: string;
  grams: number;
  name: string;
  category: string;
}

export function aggregateGrocery(
  plan: WeekPlanSuccess,
  meta: ReadonlyMap<string, IngredientDisplayMeta>,
): PdfGroceryItem[] {
  const map = new Map<string, AggEntry>();

  for (const day of plan.days) {
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        // Solver already filters out zeroed ingredients (grams = 0); this
        // is defense-in-depth in case an upstream ever emits a 0g entry.
        if (ing.grams <= 0) continue;
        const existing = map.get(ing.slug);
        if (existing) {
          existing.grams += ing.grams;
        } else {
          const display = lookupDisplayMeta(ing.slug, meta);
          map.set(ing.slug, {
            slug: ing.slug,
            grams: ing.grams,
            name: display.name,
            category: display.category,
          });
        }
      }
    }
  }

  return Array.from(map.values()).map((entry) => ({
    name: entry.name,
    amount: formatAmount(entry.grams, entry.category),
    category: entry.category,
  }));
}

/**
 * Helper: extract the top N proteins / grains by weekly gram volume.
 * Used by the tips bridge to populate `topProteins` / `topGrains` fields
 * on the legacy TipsContext for the batch-prep tip.
 *
 * Mirrors route.ts:1829-1842 logic.
 */
export function topByCategoryGrams(
  groceryItems: ReadonlyArray<PdfGroceryItem>,
  categories: ReadonlyArray<string>,
  topN: number,
): string[] {
  const matching = groceryItems.filter((item) =>
    categories.includes(item.category),
  );
  // Parse leading numeric portion of the amount string. Same trick legacy uses.
  const grams = (s: string) => parseFloat(s) || 0;
  matching.sort((a, b) => grams(b.amount) - grams(a.amount));
  return matching.slice(0, topN).map((m) => m.name);
}
