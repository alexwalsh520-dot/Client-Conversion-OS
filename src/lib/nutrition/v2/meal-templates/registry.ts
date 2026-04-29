/**
 * Phase B6a-pivot — template registry.
 *
 * Single source of truth for all available meal templates. Adding a new
 * template means importing it here and appending to ALL_TEMPLATES; no
 * loader code changes needed.
 *
 * Templates are GROUPED at lookup time by (build, dietary). Variant
 * selection within a group is delegated to the loader.
 */

import type { BuildType, DietaryStyle, MealTemplate } from "../types";
import RECOMP_OMNIVORE_A from "./recomp-omnivore-a";
import RECOMP_OMNIVORE_B from "./recomp-omnivore-b";
import { RECOMP_OMNIVORE_NO_NUTS_A } from "./recomp-omnivore-no-nuts-a";

export const ALL_TEMPLATES: ReadonlyArray<MealTemplate> = [
  RECOMP_OMNIVORE_A,
  RECOMP_OMNIVORE_B,
  RECOMP_OMNIVORE_NO_NUTS_A,
];

/** Helper: find every template matching a (build, dietary) pair. */
export function templatesForCombination(
  build: BuildType,
  dietary: DietaryStyle,
): MealTemplate[] {
  return ALL_TEMPLATES.filter(
    (t) => t.build === build && t.dietary === dietary,
  );
}

/**
 * List which (build × dietary) pairs have at least one template authored.
 * Used by the POST endpoint's early-reject path to give the coach a clear
 * "available combinations" list when their selection lacks a template.
 */
export function listAvailableCombinations(): Array<{
  build: BuildType;
  dietary: DietaryStyle;
  template_count: number;
}> {
  const counts = new Map<string, { build: BuildType; dietary: DietaryStyle; count: number }>();
  for (const t of ALL_TEMPLATES) {
    const key = `${t.build}__${t.dietary}`;
    const entry = counts.get(key);
    if (entry) {
      entry.count += 1;
    } else {
      counts.set(key, { build: t.build, dietary: t.dietary, count: 1 });
    }
  }
  return Array.from(counts.values()).map((c) => ({
    build: c.build,
    dietary: c.dietary,
    template_count: c.count,
  }));
}

/** Find a template by id. Returns undefined if absent. */
export function templateById(id: string): MealTemplate | undefined {
  return ALL_TEMPLATES.find((t) => t.id === id);
}
