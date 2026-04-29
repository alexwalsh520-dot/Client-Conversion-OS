/**
 * Phase B1 — v2 macro calculator.
 *
 * EXTENDS the legacy calculateMacros() (does NOT replace it). The legacy
 * function in ../macro-calculator.ts continues to work for the existing
 * generator. This module adds:
 *
 *   1. BuildType-driven inputs (recomp / shred / bulk / lean_gain / endurance / maintain)
 *      reading kcal_offset_from_tdee, rest_day_kcal_drop, protein_g_per_lb,
 *      and fat_pct_of_kcal from src/lib/nutrition/v2/builds/<id>.ts.
 *
 *   2. MedicalFlag[]-driven inputs (instead of the legacy boolean medical
 *      object), reading sodium_cap_mg and protein_cap_per_lb from
 *      src/lib/nutrition/v2/medical/<flag>.ts. Precedence rule: lowest cap
 *      wins across all active flags + the stimulant flag + defaults.
 *
 *   3. Returns BOTH a training-day and a rest-day MacroTargets object
 *      (per Q1 resolution). Rest-day calories = training calories +
 *      build.rest_day_kcal_drop. Protein and fat stay constant in grams
 *      (rest_day_protein_change = 0, rest_day_fat_change = 0). Carbs
 *      absorb the entire kcal drop.
 *
 * BMR (Mifflin-St Jeor) and TDEE math are duplicated inline so this module
 * never has to mutate the legacy file. Activity factor table mirrors
 * legacy values exactly.
 *
 * Diabetes T2 macro reshape replaces the build's fat_pct_of_kcal with 40%
 * (per Section 8 spec). Protein stays at the build's protein_g_per_lb;
 * carbs land at ~35% of kcal as the natural remainder.
 *
 * Out of scope for B1:
 *   - LLM slot picker
 *   - MILP solver
 *   - PDF rendering changes
 *   - Plan persistence to nutrition_meal_plans (the v2 columns won't be
 *     written until a generator wraps this function)
 *
 * No imports from the legacy macro-calculator beyond the *types* we share
 * (Sex, ActivityLevel, MacroTargets, MacroOverrides) — keeps coupling 1-way.
 */

import type {
  ActivityLevel,
  MacroOverrides,
  MacroTargets,
  Sex,
} from "../macro-calculator";
import { ALL_BUILDS } from "./builds";
import { ALL_MEDICAL_RULES } from "./medical";
import { BuildType, MedicalFlag, type BuildSpec } from "./types";

// ============================================================================
// Constants — mirror legacy macro-calculator exactly so any drift is obvious.
// ============================================================================

const LB_PER_KG = 2.20462;

const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};

const DEFAULT_ACTIVITY: ActivityLevel = "moderate";

const DEFAULT_SODIUM_CAP_MG = 2300;
const STIMULANT_SODIUM_CAP_MG = 2000;

// ============================================================================
// Inputs / outputs
// ============================================================================

export interface MacroInputsV2 {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  buildType: BuildType;
  activityLevel?: ActivityLevel;
  /**
   * Medical conditions (from v2/medical). Order doesn't matter — the
   * calculator applies all of them and uses the strictest cap on any
   * dimension (sodium, protein).
   */
  medicalFlags?: MedicalFlag[];
  /**
   * Stimulant medication flag. Distinct from medical CONDITIONS — sits on
   * its own because the side-effect (sodium target tightening) is
   * pharmacology-driven, not condition-driven.
   */
  onStimulant?: boolean;
}

export interface MacroOverridesByDayKind {
  training?: MacroOverrides;
  rest?: MacroOverrides;
}

export interface MacroTargetsByDayKind {
  training: MacroTargets;
  rest: MacroTargets;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Compute training-day and rest-day MacroTargets for the given build type.
 *
 * The shape of each MacroTargets object is identical to what the legacy
 * calculateMacros() returns, so downstream PDF and validator code can
 * consume either output without branching on which calculator produced it.
 */
export function calculateMacrosForBuild(
  inputs: MacroInputsV2,
  overrides: MacroOverridesByDayKind = {},
): MacroTargetsByDayKind {
  const build = ALL_BUILDS[inputs.buildType];
  if (!build) {
    throw new Error(`Unknown buildType: ${String(inputs.buildType)}`);
  }

  // Resolve medical caps once — both day-kinds share them.
  const caps = resolveMedicalCaps(inputs.medicalFlags ?? [], inputs.onStimulant ?? false);

  const trainingTargets = computeOneDay({
    inputs,
    build,
    dayKind: "training",
    medicalCaps: caps,
    overrides: overrides.training ?? {},
  });

  const restTargets = computeOneDay({
    inputs,
    build,
    dayKind: "rest",
    medicalCaps: caps,
    overrides: overrides.rest ?? {},
  });

  return { training: trainingTargets, rest: restTargets };
}

/**
 * Convenience: get just the training-day target. Most callers only need
 * this when the build doesn't differentiate by day-kind.
 */
export function calculateTrainingTargets(
  inputs: MacroInputsV2,
  overrides: MacroOverrides = {},
): MacroTargets {
  return calculateMacrosForBuild(inputs, { training: overrides }).training;
}

// ============================================================================
// Internals
// ============================================================================

interface MedicalCaps {
  /** Strictest sodium cap from any active medical flag + stimulant + default. */
  sodiumCapMg: number;
  /** Strictest protein g/lb cap, or `null` if no medical rule restricts protein. */
  proteinCapPerLb: number | null;
  /** Whether to apply the diabetes-T2 carb/fat reshape (35% / 40%). */
  applyDiabetesReshape: boolean;
}

function resolveMedicalCaps(
  medicalFlags: readonly MedicalFlag[],
  onStimulant: boolean,
): MedicalCaps {
  // Sodium: take the minimum across all active rules (and stimulant + default).
  const sodiumCandidates: number[] = [DEFAULT_SODIUM_CAP_MG];
  if (onStimulant) sodiumCandidates.push(STIMULANT_SODIUM_CAP_MG);

  // Protein: take the minimum across rules that restrict protein.
  const proteinCapCandidates: number[] = [];

  let applyDiabetesReshape = false;

  for (const flag of medicalFlags) {
    const rule = ALL_MEDICAL_RULES[flag];
    if (!rule) continue;
    if (typeof rule.sodium_cap_mg === "number") {
      sodiumCandidates.push(rule.sodium_cap_mg);
    }
    if (typeof rule.protein_cap_per_lb === "number") {
      proteinCapCandidates.push(rule.protein_cap_per_lb);
    }
    if (flag === MedicalFlag.DIABETES_T2) {
      applyDiabetesReshape = true;
    }
  }

  return {
    sodiumCapMg: Math.min(...sodiumCandidates),
    proteinCapPerLb:
      proteinCapCandidates.length > 0 ? Math.min(...proteinCapCandidates) : null,
    applyDiabetesReshape,
  };
}

interface ComputeArgs {
  inputs: MacroInputsV2;
  build: BuildSpec;
  dayKind: "training" | "rest";
  medicalCaps: MedicalCaps;
  overrides: MacroOverrides;
}

function computeOneDay(args: ComputeArgs): MacroTargets {
  const { inputs, build, dayKind, medicalCaps, overrides } = args;
  const notes: string[] = [];

  const weightLb = inputs.weightKg * LB_PER_KG;

  // 1. BMR (Mifflin-St Jeor 1990) — duplicated inline so this module
  //    never has to mutate the legacy file.
  const bmrBase =
    10 * inputs.weightKg + 6.25 * inputs.heightCm - 5 * inputs.age;
  const bmr = inputs.sex === "male" ? bmrBase + 5 : bmrBase - 161;

  // 2. TDEE
  const activityLevel = inputs.activityLevel ?? DEFAULT_ACTIVITY;
  const activityFactor = ACTIVITY_FACTORS[activityLevel];
  const tdee = bmr * activityFactor;

  // 3. Calories
  //    trainingCalories = TDEE + build.kcal_offset_from_tdee
  //    For training days:  calories = trainingCalories
  //    For rest days:      calories = trainingCalories + build.rest_day_kcal_drop
  //
  //    These stay UNROUNDED through the carb-balance step so the rest-day
  //    carb drop matches Section 8 to the gram. Final calories field is
  //    rounded inside applyOverridesV2.
  const trainingCalories = tdee + build.kcal_offset_from_tdee;
  const calories =
    trainingCalories + (dayKind === "rest" ? build.rest_day_kcal_drop : 0);

  // 4. Protein — same on training + rest days (rest_day_protein_change = 0).
  let proteinG = Math.round(weightLb * build.protein_g_per_lb);

  // 5. Medical protein cap applied BEFORE comment overrides.
  if (medicalCaps.proteinCapPerLb !== null) {
    const cappedProtein = Math.round(weightLb * medicalCaps.proteinCapPerLb);
    if (proteinG > cappedProtein) {
      const before = proteinG;
      proteinG = cappedProtein;
      notes.push(
        `Protein capped at ${cappedProtein}g (${medicalCaps.proteinCapPerLb} g/lb) ` +
          `due to medical flag — overrides ${build.label} default of ${before}g.`,
      );
    }
  }

  // 6. Fat — anchored to TRAINING-day calories so rest_day_fat_change = 0
  //    (the rest-day kcal drop is absorbed entirely by carbs).
  //
  //    Diabetes-T2 reshape replaces the build's fat_pct_of_kcal with 40%.
  //    Carbs naturally land near 35% as the kcal remainder once protein
  //    (build's g/lb, ≈ 22–26% of kcal) and fat (40%) are taken out.
  const effectiveFatPct = medicalCaps.applyDiabetesReshape
    ? 0.40
    : build.fat_pct_of_kcal;
  const fatG = Math.round((trainingCalories * effectiveFatPct) / 9);

  if (medicalCaps.applyDiabetesReshape) {
    notes.push(
      `Diabetic macro split applied: ~35% carbs / ~40% fat. Distribute carbs evenly across meals and prefer low-glycemic sources.`,
    );
  }

  // 7. Build the target with UNROUNDED calories so applyOverridesV2 can
  //    balance carbs precisely. Final calories field is rounded at the end.
  const targetUnrounded: MacroTargets = {
    calories, // unrounded for now
    proteinG,
    carbsG: 0, // filled below by applyOverridesV2 if no carb override
    fatG,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    activityFactor,
    // legacy MacroTargets carries `goal: GoalType` — map BuildType → the
    // closest legacy GoalType so downstream code that switches on `goal`
    // (PDF cover labels, validator hints) stays compatible. SHIM only.
    goal: mapBuildTypeToLegacyGoal(inputs.buildType),
    proteinPerKg: round1(proteinG / inputs.weightKg),
    proteinPerLb: round2(proteinG / weightLb),
    sodiumCapMg: medicalCaps.sodiumCapMg,
    notes,
  };

  const withOverrides = applyOverridesV2(targetUnrounded, overrides);

  // 8. Round calories to integer for the final result.
  return {
    ...withOverrides,
    calories: Math.round(withOverrides.calories),
  };
}

/**
 * Apply comment overrides on top of build-derived targets, then balance
 * carbs so protein*4 + fat*9 + carbs*4 ≈ calories.
 *
 * Mirror of legacy applyOverrides() — duplicated inline rather than
 * imported so we don't have to widen the legacy module's exports.
 */
function applyOverridesV2(t: MacroTargets, overrides: MacroOverrides): MacroTargets {
  const notes = [...t.notes];

  let calories = t.calories;
  let proteinG = t.proteinG;
  let fatG = t.fatG;
  let carbsG = t.carbsG;

  if (overrides.caloriesAbsolute !== undefined) {
    calories = overrides.caloriesAbsolute;
    notes.push(`Calories overridden: ${calories} kcal.`);
  } else if (overrides.caloriesDelta !== undefined) {
    calories += overrides.caloriesDelta;
    const sign = overrides.caloriesDelta >= 0 ? "+" : "";
    notes.push(`Calories adjusted: ${sign}${overrides.caloriesDelta} kcal.`);
  }

  if (overrides.proteinG !== undefined) {
    proteinG = overrides.proteinG;
    notes.push(`Protein overridden: ${proteinG}g.`);
  }

  if (overrides.fatG !== undefined) {
    fatG = overrides.fatG;
    notes.push(`Fat overridden: ${fatG}g.`);
  } else if (overrides.fatPct !== undefined) {
    fatG = Math.round((calories * overrides.fatPct) / 9);
    notes.push(`Fat set from comment: ${Math.round(overrides.fatPct * 100)}% of calories.`);
  }

  if (overrides.carbsG !== undefined) {
    carbsG = overrides.carbsG;
    notes.push(`Carbs overridden: ${carbsG}g.`);
  } else {
    // Carbs balance: fill remaining kcal after protein + fat.
    const proteinKcal = proteinG * 4;
    const fatKcal = fatG * 9;
    carbsG = Math.max(0, Math.round((calories - proteinKcal - fatKcal) / 4));
  }

  return {
    ...t,
    calories,
    proteinG,
    carbsG,
    fatG,
    notes,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Bridge for downstream code that still switches on the legacy `goal` field.
 * The mapping below is a label/UX shim — it does NOT affect macros (those
 * are computed from the v2 BuildSpec). When we retire the legacy path
 * entirely, this can be deleted.
 */
export function mapBuildTypeToLegacyGoal(
  buildType: BuildType,
): MacroTargets["goal"] {
  switch (buildType) {
    case BuildType.RECOMP:
      return "recomp";
    case BuildType.SHRED:
      return "fat_loss"; // legacy enum — closest match
    case BuildType.BULK:
      return "muscle_gain"; // legacy enum — closest match
    case BuildType.LEAN_GAIN:
      return "muscle_gain"; // legacy doesn't distinguish; closest match
    case BuildType.ENDURANCE:
      return "endurance";
    case BuildType.MAINTAIN:
      return "maintain";
  }
  // Exhaustiveness — if a new BuildType is added without a case here, the
  // assignment to `never` becomes a TS compile error and forces an update.
  const _exhaustive: never = buildType;
  throw new Error(`Unhandled BuildType: ${String(_exhaustive)}`);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
