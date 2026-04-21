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

    // Exact word match using word boundaries where possible,
    // or substring match for multi-word tokens.
    if (t.includes(" ") || t.includes("_")) {
      if (searchHaystack.includes(t)) return true;
    } else {
      const wordBoundary = new RegExp(`\\b${escapeRegex(t)}\\b`);
      if (wordBoundary.test(searchHaystack)) return true;
    }
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
