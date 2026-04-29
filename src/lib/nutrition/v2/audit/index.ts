/**
 * Phase B4 — audit barrel.
 */

export { auditWeekPlan } from "./audit-week-plan";
export {
  classifySlotAnchors,
  computeSlotMacroSum,
  findHighestProteinIngredient,
  findHighestCarbIngredient,
  PROTEIN_ANCHORED_SLOT_MIN_G,
  CARB_ANCHORED_SLOT_MIN_G,
} from "./anchor-detection";
export type {
  AuditResult,
  AuditError,
  AuditAction,
  AuditCheckKind,
  ClientProfile,
} from "./types";
