/**
 * Phase B6a-pivot — template loader with deterministic variant rotation.
 *
 * Selection rule: stable alphabetical order by `id`, then index by
 * `(planVersion - 1) mod count`. For Recomp/Omnivore (variants A and B):
 *
 *   v1 → A   v2 → B   v3 → A   v4 → B   ...
 *
 * Generalizes to any number of variants per (build, dietary) pair.
 *
 * Throws TemplateNotAvailableError when no template exists for the pair.
 * The runner catches and surfaces this as an early-reject 400 from the
 * POST endpoint (no job queued).
 */

import type { BuildType, DietaryStyle, MealTemplate } from "../types";
import {
  listAvailableCombinations,
  templatesForCombination,
} from "./registry";
import { TemplateNotAvailableError } from "./types";

export interface LoadMealTemplateArgs {
  build: BuildType;
  dietary: DietaryStyle;
  /** 1-based plan version (computed by runPipeline). v1 → first variant. */
  plan_version: number;
}

export function loadMealTemplate(args: LoadMealTemplateArgs): MealTemplate {
  const { build, dietary, plan_version } = args;
  const candidates = templatesForCombination(build, dietary);
  if (candidates.length === 0) {
    throw new TemplateNotAvailableError(
      build,
      dietary,
      listAvailableCombinations(),
    );
  }
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  // Plan versions start at 1; first version → index 0.
  // (n - 1 + count) % count guards against pathological 0 / negative inputs.
  const idx = ((plan_version - 1) + sorted.length) % sorted.length;
  return sorted[Math.max(0, idx)];
}

/**
 * Test helper: returns variant id without throwing on missing combination.
 * Returns null when no template exists. Useful for the POST endpoint's
 * early-reject probe ("can we generate?") without exception handling.
 */
export function probeMealTemplate(args: LoadMealTemplateArgs): string | null {
  const candidates = templatesForCombination(args.build, args.dietary);
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  const idx = ((args.plan_version - 1) + sorted.length) % sorted.length;
  return sorted[Math.max(0, idx)].id;
}
