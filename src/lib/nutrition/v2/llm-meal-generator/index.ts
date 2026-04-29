/**
 * LLM meal generator — barrel.
 */

export {
  generatePlan,
  generatePlanBatch,
  wrapAsWeekPlanSuccess,
} from "./generate-plan";
export type { BatchAttempt, WrapArgs } from "./generate-plan";
export {
  AnthropicMealGeneratorClient,
  MockMealGeneratorClient,
} from "./anthropic-client";
export {
  buildSlugList,
  _clearSlugListCache,
} from "./slug-list";
export {
  SYSTEM_PROMPT,
  SUBMIT_PLAN_TOOL,
  buildUserPrompt,
} from "./prompt";
export { parseSubmitPlanResponse } from "./parse";
export type {
  ClientProfile,
  GeneratePlanInput,
  GeneratePlanResult,
  MealGeneratorLLMClient,
  MealGeneratorLLMResponse,
  RawDay,
  RawIngredient,
  RawMeal,
  RawPlan,
} from "./types";
