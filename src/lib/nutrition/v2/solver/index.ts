/**
 * Phase B2 — solver barrel.
 */

export { solveDay } from "./solve-day";
export {
  computePerSlotTargets,
} from "./per-slot-targets";
export {
  getIngredientNutrition,
  _clearIngredientCache,
  _seedIngredientCache,
} from "./ingredient-data";
export { getGramBounds, CATEGORY_DEFAULTS, SLUG_OVERRIDES } from "./category-bounds";
export type {
  // Inputs
  SolveDayInput,
  SlotInput,
  SlotIngredientInput,
  // Outputs
  SolveDayOutput,
  SolveDaySuccess,
  InfeasibilityError,
  SlotResult,
  PerSlotActuals,
  DailyActuals,
  ZeroedSlug,
  FallbackLevel,
  PerSlotTargets,
  IngredientNutrition,
  GramBounds,
  // Type guards
} from "./types";
export {
  isSolveDaySuccess,
  isInfeasibilityError,
} from "./types";
