/**
 * Phase B6a-pivot dish-namer — subject filter.
 *
 * Filters a slot's solved ingredients down to the ones eligible to
 * appear as subjects in a dish name. Applied before the prompt is
 * built so the LLM only sees "main ingredients" — not 5g of olive
 * oil that exists for fat balance, not 1g of cilantro garnish.
 *
 * Rules (per spec §9):
 *   • Proteins / seafood / dairy / supplements / legumes — always
 *     subject-eligible (role-defining; an anchor at any portion is
 *     a subject).
 *   • Grains / carbs / fruits / vegetables — eligible if grams ≥ 30g.
 *   • Nuts / seeds / nut butters / avocado / butter (fat category) —
 *     eligible if grams ≥ 10g.
 *   • Oils — never subject-eligible (cooking medium).
 *   • Condiments / beverages — never subject-eligible.
 *   • Specific aromatic/herb slugs — never subject-eligible (jalapeno,
 *     garlic, mint, basil, lemon, lime — even at high portions these
 *     read as flavoring not subject).
 */

import {
  NEVER_SUBJECT_CATEGORIES,
  NEVER_SUBJECT_SLUGS,
  SUBJECT_THRESHOLDS_G,
} from "./types";

export interface SubjectCandidate {
  slug: string;
  display_name: string;
  grams: number;
  category: string;
}

/**
 * Filter a slot's ingredients to only those eligible to appear as
 * subjects in the meal's dish name. Sorted by grams descending so the
 * LLM sees the largest-portion ingredients first (used as a salience
 * hint via the prompt's "list order = priority" rule).
 */
export function filterSubjectIngredients(
  candidates: SubjectCandidate[],
): SubjectCandidate[] {
  const eligible = candidates.filter((ing) => isSubjectEligible(ing));
  // Sort by grams descending — biggest portions first. The LLM sees
  // this ordering and prioritises leading with high-portion ingredients.
  return eligible.slice().sort((a, b) => b.grams - a.grams);
}

export function isSubjectEligible(ing: SubjectCandidate): boolean {
  if (NEVER_SUBJECT_SLUGS.has(ing.slug)) return false;
  if (NEVER_SUBJECT_CATEGORIES.has(ing.category)) return false;
  // Grams must be > 0 (zeroed ingredients aren't on the plate).
  if (ing.grams <= 0) return false;

  const threshold = SUBJECT_THRESHOLDS_G[ing.category];
  if (threshold === undefined) {
    // Categories not in the threshold map are "always include":
    //   protein, seafood, supplement, dairy, legume
    return true;
  }
  return ing.grams >= threshold;
}
