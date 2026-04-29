/**
 * Phase B6a-pivot — substitution logic.
 *
 * For one ingredient slot, walks [primary, ...swap_chain] and picks the
 * first slug not in the client's hardExclude set. Anchor flag is preserved
 * across substitution — if salmon is the anchor and it's hard-excluded,
 * the next non-excluded slug in the chain becomes the anchor for that
 * slot.
 *
 * If every slug is excluded, returns kind="exhausted" with diagnostics
 * the orchestrator surfaces as a structured PickError (per the
 * swap_chain_exhausted PickViolation kind).
 */

import type { MealTemplateIngredient } from "../types";
import type { SubstitutionResult } from "./types";

export function substituteIngredient(
  ingredient: MealTemplateIngredient,
  hardExclude: ReadonlySet<string>,
): SubstitutionResult {
  const candidates: string[] = [ingredient.slug, ...ingredient.swap_chain];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!hardExclude.has(candidate)) {
      const wasSubstituted = i > 0;
      return {
        kind: "ok",
        resolved_slug: candidate,
        was_substituted: wasSubstituted,
        swap_path: wasSubstituted ? candidates.slice(0, i + 1) : undefined,
      };
    }
  }
  return {
    kind: "exhausted",
    walked: candidates,
    excluded: candidates.filter((c) => hardExclude.has(c)),
  };
}
