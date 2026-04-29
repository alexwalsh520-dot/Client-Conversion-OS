/**
 * Phase B6b prep — fabricated test client profiles for template
 * verification.
 *
 * Used by `scripts/nutrition-v2-template-a-diagnostic.ts --all-test-clients`
 * to stress-test new templates against the macro-target spectrum
 * before merging. Heights are inferred from typical BMI ranges for
 * each weight + activity context; tweak in this file if better data
 * emerges.
 *
 * The 4 profiles bracket the macro spectrum:
 *   • Lean — small targets; tight per-slot bands; per-slug minimum
 *     ingredient floors may push small-budget slots to overshoot.
 *   • Avg  — Santiago-adjacent baseline; the templates were tuned
 *     against this.
 *   • Heavy — large targets; big per-slot budgets; ingredient maxes
 *     may undershoot.
 *   • Endurance — high activity factor → very large targets, tested
 *     against future Endurance-build templates (ENDURANCE_5_MEAL_*
 *     distributions). When run against a non-Endurance template
 *     (e.g. recomp_omnivore_a), it's a high-target stress test.
 */

import type { ActivityLevel } from "../macro-calculator";
import {
  BuildType,
  DistributionTemplateId,
  type AllergyFlag,
  type MedicalFlag,
} from "./types";

// ----------------------------------------------------------------------------
// TestClientProfile shape
// ----------------------------------------------------------------------------

/**
 * Fabricated client profile — enough fields for `calculateMacrosForBuild`
 * to compute training + rest targets. Skips the Supabase intake-loader
 * path entirely (this is a hermetic test fixture).
 */
export interface TestClientProfile {
  /** Stable identifier used in logs + matrix output. */
  id: string;
  /** Short display label. */
  label: string;
  sex: "male" | "female";
  weightKg: number;
  heightCm: number;
  age: number;
  activityLevel: ActivityLevel;
  medicalFlags: MedicalFlag[];
  allergyFlags: AllergyFlag[];
  onStimulant: boolean;
}

export const TEST_CLIENTS: ReadonlyArray<TestClientProfile> = [
  {
    id: "TestClient_Lean",
    label: "Lean (60kg F sedentary)",
    sex: "female",
    weightKg: 60,
    heightCm: 165,
    age: 25,
    activityLevel: "sedentary",
    medicalFlags: [],
    allergyFlags: [],
    onStimulant: false,
  },
  {
    id: "TestClient_Avg",
    label: "Avg (75kg M moderate)",
    sex: "male",
    weightKg: 75,
    heightCm: 175,
    age: 30,
    activityLevel: "moderate",
    medicalFlags: [],
    allergyFlags: [],
    onStimulant: false,
  },
  {
    id: "TestClient_Heavy",
    label: "Heavy (110kg M very_high)",
    sex: "male",
    weightKg: 110,
    heightCm: 188,
    age: 28,
    activityLevel: "very_high",
    medicalFlags: [],
    allergyFlags: [],
    onStimulant: false,
  },
  {
    id: "TestClient_Endurance",
    label: "Endurance (70kg M very_high)",
    sex: "male",
    weightKg: 70,
    heightCm: 178,
    age: 35,
    activityLevel: "very_high",
    medicalFlags: [],
    allergyFlags: [],
    onStimulant: false,
  },
];

// ----------------------------------------------------------------------------
// Build → distribution mapping (mirrors run-pipeline.ts; duplicated here
// so the diagnostic doesn't need to import from production critical path)
// ----------------------------------------------------------------------------

export const BUILD_TO_TRAINING_DISTRIBUTION: Record<BuildType, DistributionTemplateId> = {
  recomp: DistributionTemplateId.STANDARD_3_MEAL,
  shred: DistributionTemplateId.STANDARD_3_MEAL,
  maintain: DistributionTemplateId.STANDARD_3_MEAL,
  lean_gain: DistributionTemplateId.STANDARD_4_MEAL,
  bulk: DistributionTemplateId.ATHLETE_5_MEAL,
  endurance: DistributionTemplateId.ENDURANCE_5_MEAL_TRAINING_DAY,
};

export const BUILD_TO_REST_DISTRIBUTION: Partial<Record<BuildType, DistributionTemplateId>> = {
  endurance: DistributionTemplateId.ENDURANCE_3_MEAL_REST_DAY,
};

// ----------------------------------------------------------------------------
// Sodium thresholds for the Q5 pre-check
// ----------------------------------------------------------------------------

/** Default sodium cap (no medical flags, no stimulant). */
export const SODIUM_DEFAULT_BASE_MG = 2300;
/** Audit ceiling = base × 1.15. */
export const SODIUM_DEFAULT_CEILING_MG = SODIUM_DEFAULT_BASE_MG * 1.15; // 2645
/** Days at this many mg are "close to the ceiling" — warn-level. */
export const SODIUM_WARN_THRESHOLD_MG = SODIUM_DEFAULT_BASE_MG; // 2300
