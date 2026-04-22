/**
 * Filter and rank DB ingredients based on client allergies and preferences.
 * Uses keyword matching against ingredient name + aliases.
 */

export interface IngredientRow {
  id: number;
  slug: string;
  name: string;
  aliases: string[];
  category: string;
  calories_per_100g: number;
  protein_g_per_100g: number;
  carbs_g_per_100g: number;
  fat_g_per_100g: number;
  // Populated from Supabase; kept optional for backwards compatibility
  // with callers that construct an IngredientRow by hand.
  sodium_mg_per_100g?: number | null;
}

/**
 * Returns true if the ingredient matches ANY of the blocked tokens.
 * Match is done against lowercased slug + name + aliases.
 */
export function isBlocked(ingredient: IngredientRow, blocked: string[]): boolean {
  if (!blocked.length) return false;

  const searchHaystack = [
    ingredient.slug,
    ingredient.name,
    ...(ingredient.aliases || []),
  ]
    .join(" ")
    .toLowerCase();

  for (const token of blocked) {
    const t = token.trim().toLowerCase();
    if (!t || t.length < 2) continue;

    // Multi-word tokens / underscored slugs → substring match (covers compounds).
    if (t.includes(" ") || t.includes("_")) {
      if (searchHaystack.includes(t)) return true;
      continue;
    }

    // Short tokens (2-4 chars like "oat", "soy") use word boundaries so we
    // don't match "coat" → "oat" or "soybean" → "soy" in a benign word.
    if (t.length <= 4) {
      const wordBoundary = new RegExp(`\\b${escapeRegex(t)}\\b`);
      if (wordBoundary.test(searchHaystack)) return true;
      continue;
    }

    // Longer tokens (5+) use substring match so "peanut" catches "peanuts",
    // "peanut butter", "peanut oil" — critical for allergy safety.
    if (searchHaystack.includes(t)) return true;
  }
  return false;
}

/**
 * Returns a preference score (higher = more preferred).
 * 0 = no match, 1+ = matches preferences.
 */
export function preferenceScore(ingredient: IngredientRow, preferred: string[]): number {
  if (!preferred.length) return 0;
  const searchHaystack = [
    ingredient.slug,
    ingredient.name,
    ...(ingredient.aliases || []),
  ]
    .join(" ")
    .toLowerCase();

  let score = 0;
  for (const token of preferred) {
    const t = token.trim().toLowerCase();
    if (!t || t.length < 2) continue;

    if (searchHaystack.includes(t)) score += 1;
  }
  return score;
}

/**
 * Filter ingredients by blocks, rank by preferences.
 * Returns sorted list with preferred items first.
 */
export function filterAndRankIngredients(
  ingredients: IngredientRow[],
  blocked: string[],
  preferred: string[]
): IngredientRow[] {
  const filtered = ingredients.filter((ing) => !isBlocked(ing, blocked));
  const scored = filtered.map((ing) => ({
    ing,
    score: preferenceScore(ing, preferred),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.ing);
}

/**
 * Pick a DIVERSIFIED allowed-ingredient set for the Claude prompt.
 *
 * Plain `ranked.slice(0, N)` pushes out entire categories (vegetables,
 * condiments, spices) when the preference keywords strongly match one category
 * (e.g., "Chicken, Beef, Fish, Eggs, Dairy" fills the top 80 with proteins).
 *
 * This function guarantees a minimum presence from each category before
 * filling remaining slots with top-ranked items.
 */
export function pickDiverseAllowed(
  ranked: IngredientRow[],
  opts: { size?: number; extraRequiredSlugs?: string[] } = {}
): IngredientRow[] {
  const size = opts.size ?? 100;
  const extraRequiredSlugs = new Set(opts.extraRequiredSlugs ?? []);

  // Minimum presence targets — ensures every meal type has viable options
  const minPerCategory: Record<string, number> = {
    protein: 12,
    seafood: 4,
    vegetable: 14, // generous, lunches/dinners need real variety
    fruit: 5,
    grain: 6,
    carb: 6,
    dairy: 6,
    condiment: 8, // salsa, hot sauce, mustard, soy sauce, etc.
    fat: 4,
    legume: 3,
    beverage: 2,
    supplement: 2,
  };

  const byCategory = new Map<string, IngredientRow[]>();
  for (const ing of ranked) {
    if (!byCategory.has(ing.category)) byCategory.set(ing.category, []);
    byCategory.get(ing.category)!.push(ing);
  }

  const chosen = new Map<string, IngredientRow>();

  // 0. Always include explicitly required slugs (e.g., spicy items for spicy clients)
  for (const ing of ranked) {
    if (extraRequiredSlugs.has(ing.slug)) chosen.set(ing.slug, ing);
  }

  // 1. Fill per-category minimums using the ranked order within each category
  for (const [cat, min] of Object.entries(minPerCategory)) {
    const list = byCategory.get(cat) || [];
    for (const ing of list.slice(0, min)) {
      chosen.set(ing.slug, ing);
      if (chosen.size >= size) break;
    }
    if (chosen.size >= size) break;
  }

  // 2. Fill remaining slots with the global top-ranked list
  for (const ing of ranked) {
    if (chosen.size >= size) break;
    chosen.set(ing.slug, ing);
  }

  return Array.from(chosen.values());
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
