/**
 * Phase B6a-pivot — meal-templates barrel.
 *
 * Production critical path imports `generateWeekPlanFromTemplate` and
 * `loadMealTemplate` from here. The B3 LLM picker module
 * (src/lib/nutrition/v2/picker/) is no longer referenced from
 * run-pipeline.ts; the type guards (isWeekPlanSuccess) are re-exported
 * here so callers don't need to import from picker at all.
 */

export { generateWeekPlanFromTemplate } from "./orchestrate";
export type {
  TemplateOrchestratorInput,
  TemplateOrchestratorOptions,
} from "./orchestrate";
export { loadMealTemplate, probeMealTemplate } from "./loader";
export {
  ALL_TEMPLATES,
  templatesForCombination,
  listAvailableCombinations,
  templateById,
} from "./registry";
export { substituteIngredient } from "./substitute";
export { adaptDayToPick } from "./adapt-day";
export {
  TemplateNotAvailableError,
} from "./types";
export type {
  SubstitutionResult,
  SubstitutionLog,
  AdaptDayResult,
} from "./types";

// Re-export the WeekPlanOutput type guards from picker so consumers
// don't need to import from picker directly. The picker module remains
// in the repo as the future "creative variety mode."
export { isWeekPlanSuccess } from "../picker";
export type {
  WeekPlanSuccess,
  WeekPlanFailure,
  WeekPlanOutput,
  GenerationDiagnostics,
  DayDiagnostics,
} from "../picker";
