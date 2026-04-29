/**
 * Phase B3 — picker barrel.
 */

export { pickSlotsForDay } from "./pick-slots-for-day";
export { generateWeekPlan } from "./orchestrator";
export {
  buildSystemPrompt,
  buildUserPrompt,
  buildValidationRetryMessage,
  emptyWeeklyHistory,
  appendDayToHistory,
} from "./build-prompt";
export {
  parsePickResponse,
  validatePick,
} from "./validate-pick";
export {
  AnthropicLLMClient,
  MockLLMClient,
} from "./llm-client";
export type {
  // Picker
  DayPickInput,
  DayPick,
  PickError,
  PickResult,
  PickViolation,
  PickedSlot,
  PickedIngredient,
  SolverFeedback,
  WeeklyHistory,
  LLMClient,
  // Orchestrator
  WeekPlanInput,
  WeekPlanOutput,
  WeekPlanSuccess,
  WeekPlanFailure,
  GenerationDiagnostics,
  DayDiagnostics,
} from "./types";
export { isPickError, isWeekPlanSuccess } from "./types";
