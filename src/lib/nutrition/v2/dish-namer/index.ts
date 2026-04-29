/**
 * Phase B6a-pivot dish-namer — barrel.
 */

export { nameMeals } from "./name-meals";
export {
  AnthropicDishNamerClient,
  MockDishNamerClient,
} from "./anthropic-client";
export {
  filterSubjectIngredients,
  isSubjectEligible,
  type SubjectCandidate,
} from "./subject-filter";
export {
  SYSTEM_PROMPT,
  buildUserPrompt,
  DISH_NAMES_TOOL,
  type MealForPrompt,
} from "./prompt";
export { parseToolResponse, type ParseResult } from "./parse";
export type {
  NameMealsInput,
  NameMealsResult,
  DishNamerLLMClient,
  DishNamerLLMResponse,
} from "./types";
export {
  SUBJECT_THRESHOLDS_G,
  NEVER_SUBJECT_SLUGS,
  NEVER_SUBJECT_CATEGORIES,
} from "./types";
