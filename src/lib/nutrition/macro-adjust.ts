/**
 * Macro adjustment + redistribution helpers.
 *
 * Pure function module — no I/O. Takes the macro-calculator's TDEE-based
 * output and applies our population-calibrated downward adjustment, OR
 * accepts a coach-locked kcal override. In both cases it re-derives the
 * P/C/F split preserving:
 *   1. Protein anchor: bodyweight-driven protein grams from the calculator
 *      stay fixed (non-negotiable safety floor).
 *   2. Fat / carb ratio: whatever ratio the calculator chose for the goal
 *      type is preserved across the new total.
 *
 * Used by both the live-preview /macros endpoint and the /copy-prompt
 * endpoint that emits the final prompt the coach pastes into Claude.ai.
 *
 * Calculator stays untouched — the sales-team's v1 generate-plan route
 * uses calculateMacros directly and shouldn't see this adjustment.
 */

import type { MacroTargets } from "./macro-calculator";

/**
 * Subtracted from the calculator's TDEE-based kcal output before producing
 * the suggested target. Empirically the calculator runs hot for our
 * population (clients tend to be desk workers who self-report higher
 * activity than they actually have); 400 kcal off lands more in line with
 * actual maintenance.
 */
export const KCAL_DOWNWARD_ADJUSTMENT = 400;

/**
 * Floor applied to the auto-suggestion so an already-low calculator output
 * (small, sedentary clients) doesn't go clinically dangerous. Coach can
 * override below this value but the UI surfaces a warning at the editor.
 */
export const KCAL_FLOOR = 1200;

export interface AdjustedTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumCapMg: number;
  notes: string[];
  /** "auto" = our -400 default; "override" = coach picked the kcal value. */
  source: "auto" | "override";
  /** What the macro calculator originally produced (pre-adjustment). */
  rawCalculatorKcal: number;
  /** True when the auto-suggestion was clamped to the 1200 floor. */
  flooredAt1200: boolean;
}

export interface AdjustMacrosOptions {
  /** When set, replaces our -400 default. Coach-driven via the lock UI. */
  overrideKcal?: number;
}

/**
 * Convenience: just the suggested kcal target (calc - 400, floored at 1200).
 * Used when the UI only needs the number for display, not the full split.
 */
export function suggestedKcal(raw: MacroTargets): number {
  return Math.max(KCAL_FLOOR, Math.round(raw.calories) - KCAL_DOWNWARD_ADJUSTMENT);
}

export function adjustMacros(
  raw: MacroTargets,
  options: AdjustMacrosOptions = {},
): AdjustedTargets {
  const rawCalculatorKcal = Math.round(raw.calories);

  let targetKcal: number;
  let flooredAt1200 = false;
  if (options.overrideKcal != null && Number.isFinite(options.overrideKcal)) {
    targetKcal = Math.round(options.overrideKcal);
  } else {
    const subtracted = rawCalculatorKcal - KCAL_DOWNWARD_ADJUSTMENT;
    if (subtracted < KCAL_FLOOR) {
      targetKcal = KCAL_FLOOR;
      flooredAt1200 = true;
    } else {
      targetKcal = subtracted;
    }
  }

  const proteinG = raw.proteinG;
  const proteinKcal = proteinG * 4;

  // Carb/fat ratio comes from whatever the calculator chose for this goal.
  // If for some reason the calculator's non-protein share is zero or
  // negative (degenerate case), fall back to a balanced 50/50 split.
  const oldRemaining = raw.calories - proteinKcal;
  const oldFatRatio = oldRemaining > 0 ? (raw.fatG * 9) / oldRemaining : 0.5;

  const remaining = Math.max(0, targetKcal - proteinKcal);
  const fatKcal = Math.round(remaining * oldFatRatio);
  const fatG = Math.max(0, Math.round(fatKcal / 9));
  const carbsG = Math.max(0, Math.round((remaining - fatG * 9) / 4));

  return {
    calories: targetKcal,
    proteinG,
    carbsG,
    fatG,
    sodiumCapMg: raw.sodiumCapMg,
    notes: [...(raw.notes ?? [])],
    source: options.overrideKcal != null ? "override" : "auto",
    rawCalculatorKcal,
    flooredAt1200,
  };
}
