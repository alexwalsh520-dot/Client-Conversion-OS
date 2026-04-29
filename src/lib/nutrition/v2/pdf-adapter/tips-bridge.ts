/**
 * Phase B5 — tips bridge.
 *
 * Translates v2 structured flags (BuildType, MedicalFlag[], AllergyFlag[],
 * DietaryStyle) into the legacy tips-generator's TipsContext shape and
 * the legacy medical.ts MedicalFlags boolean shape. The legacy modules
 * are NOT modified.
 *
 * The bridge merges two sources of medical signal:
 *   1. Legacy free-text detection (intake's allergies + medications fields)
 *      run through detectMedicalFlags() — captures medication-specific
 *      detection (ACE inhibitors, GLP-1s, statins, etc.) that v2's
 *      structured flags don't carry.
 *   2. v2 structured medical flags (HBP / DIABETES_T2 / KIDNEY etc.)
 *      OR-merged on top so explicit coach selections override anything
 *      free-text might have missed.
 *
 * Mapping rationale (v2 MedicalFlag → legacy MedicalFlags boolean):
 *   HBP             → hasHypertension
 *   DIABETES_T2     → hasDiabetes
 *   KIDNEY          → hasKidneyIssues
 *   IBS / GOUT /    → no legacy field; flag has no legacy tip. Acceptable —
 *   REFLUX / PCOS /   v2's structured flag drives ingredient exclusion at
 *   PREGNANT_NURSING  the v2/medical/ rule layer; missing from PDF tips
 *                     is a known gap to fill in a polish pass after pilot.
 *
 *   AllergyFlag.GLUTEN              → hasCeliacOrGluten
 *   AllergyFlag.INTOLERANCE_LACTOSE → hasLactoseIntolerance
 */

import { detectMedicalFlags, medicalTips, type MedicalFlags, type MedicalTip } from "../../medical";
import { mapBuildTypeToLegacyGoal } from "../macro-calculator-v2";
import { generateTips, type Tip, type TipsContext } from "../../tips-generator";
import { isOnAppetiteSuppressant } from "../../parsers";
import type { MacroTargets } from "../../macro-calculator";
import {
  AllergyFlag,
  BuildType,
  MedicalFlag,
} from "../types";
import type { IntakeSnapshot } from "./types";

// ============================================================================
// MedicalFlags bridge
// ============================================================================

export function buildLegacyMedicalFlags(intake: IntakeSnapshot): MedicalFlags {
  // Step 1: legacy free-text detection — captures medication-specific signal.
  const flags = detectMedicalFlags(
    intake.allergies || "",
    intake.medications || "",
  );

  // Step 2: OR-merge v2 structured medical flags on top.
  if (intake.medical_flags.includes(MedicalFlag.HBP)) {
    flags.hasHypertension = true;
  }
  if (intake.medical_flags.includes(MedicalFlag.DIABETES_T2)) {
    flags.hasDiabetes = true;
  }
  if (intake.medical_flags.includes(MedicalFlag.KIDNEY)) {
    flags.hasKidneyIssues = true;
  }
  // (IBS/GOUT/REFLUX/PCOS/PREGNANT_NURSING have no legacy mapping — see
  //  module docstring for rationale.)

  // Step 3: OR-merge v2 structured allergy/intolerance flags.
  if (intake.allergy_flags.includes(AllergyFlag.GLUTEN)) {
    flags.hasCeliacOrGluten = true;
  }
  if (intake.allergy_flags.includes(AllergyFlag.INTOLERANCE_LACTOSE)) {
    flags.hasLactoseIntolerance = true;
  }

  // Step 4: stimulant flag — v2 surfaces this directly, legacy detected
  // via medication keywords. OR them.
  if (intake.on_stimulant) {
    flags.onStimulantADHD = true;
  }

  return flags;
}

// ============================================================================
// Tips builder (calls legacy generators unchanged)
// ============================================================================

export interface BuildTipsArgs {
  intake: IntakeSnapshot;
  targets: MacroTargets;
  /** Top protein names from the week's grocery list (display strings). */
  topProteins: string[];
  /** Top grain names from the week's grocery list (display strings). */
  topGrains: string[];
}

/**
 * Build the full tips array for the PDF using the legacy generator
 * unchanged. Medical-condition tips are injected just before the final
 * "Be Consistent" tip — same pattern as route.ts:1865-1870.
 */
export function buildTips(args: BuildTipsArgs): Tip[] {
  const { intake, targets, topProteins, topGrains } = args;

  const flags = buildLegacyMedicalFlags(intake);
  const legacyGoal = mapBuildTypeToLegacyGoal(intake.build_type) as TipsContext["goal"];

  const ctx: TipsContext = {
    fitnessGoal: intake.fitness_goal,
    canCook: intake.can_cook,
    mealCount: intake.meal_count,
    medications: intake.medications,
    supplements: intake.supplements,
    sleepHours: intake.sleep_hours,
    waterIntake: intake.water_intake,
    allergies: intake.allergies,
    goal: legacyGoal,
    proteinG: targets.proteinG,
    caloriesPerDay: targets.calories,
    onAppetiteSuppressant:
      intake.on_stimulant || isOnAppetiteSuppressant(intake.medications || ""),
    topProteins,
    topGrains,
    hasHypertension: flags.hasHypertension,
    hasKidneyIssues: flags.hasKidneyIssues,
  };

  const tips = generateTips(ctx);

  // Inject medical tips just before the final "Be Consistent" tip
  // (last entry from generateTips, per legacy convention).
  const medTips: MedicalTip[] = medicalTips(flags);
  if (medTips.length > 0) {
    const finalTip = tips.pop();
    tips.push(...medTips);
    if (finalTip) tips.push(finalTip);
  }

  return tips;
}

// Re-export for tests
export { mapBuildTypeToLegacyGoal };
export type { TipsContext, Tip, MedicalFlags };

// silence unused-import lint when BuildType isn't read directly
void BuildType;
