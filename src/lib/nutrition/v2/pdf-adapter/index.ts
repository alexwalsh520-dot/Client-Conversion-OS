/**
 * Phase B5 — pdf-adapter barrel.
 */

export { weekPlanToPdfInput } from "./week-plan-to-pdf";
export { aggregateGrocery, topByCategoryGrams } from "./grocery-aggregator";
export {
  formatAmount,
  computeIngredientMacros,
  lookupDisplayMeta,
} from "./ingredient-display";
export { buildTips, buildLegacyMedicalFlags } from "./tips-bridge";
export { buildClientInfo, buildTimelineNote, goalLabelForBuild } from "./client-info";
export { AdapterError } from "./types";
export type {
  IntakeSnapshot,
  AdapterOptions,
  PdfInput,
  PdfClient,
  PdfDay,
  PdfMeal,
  PdfIngredient,
  PdfGroceryItem,
  PdfTip,
} from "./types";
export type { IngredientDisplayMeta } from "./ingredient-display";
