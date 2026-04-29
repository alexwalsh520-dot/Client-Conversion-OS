/**
 * Phase B2 — per-slot macro target derivation.
 *
 * Given daily MacroTargets (from B1) and a MealDistribution template,
 * compute the protein/carbs/fat target for each slot.
 *
 * Math: slot_target_macro = daily_macro × slot.percent / 100
 *
 * No rounding — these targets are floats fed into the solver's tolerance
 * bands. Calories are computed from the macros (4P + 9F + 4C) for
 * downstream display; not used as a solver constraint per Q3 resolution.
 */

import type { MacroTargets } from "../../macro-calculator";
import type { MealDistribution } from "../types";
import type { PerSlotTargets } from "./types";

export function computePerSlotTargets(
  daily: MacroTargets,
  distribution: MealDistribution,
): PerSlotTargets[] {
  return distribution.slots.map((slot) => {
    const protein_g = (daily.proteinG * slot.protein_pct) / 100;
    const carbs_g = (daily.carbsG * slot.carb_pct) / 100;
    const fat_g = (daily.fatG * slot.fat_pct) / 100;
    return {
      index: slot.index,
      protein_g,
      carbs_g,
      fat_g,
      calories: protein_g * 4 + carbs_g * 4 + fat_g * 9,
    };
  });
}
