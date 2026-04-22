/**
 * SINGLE SOURCE OF TRUTH for macro target calculation.
 *
 * Every downstream consumer (PDF cover page, day-level validator,
 * portion optimizer, solver feedback messages) reads the same MacroTargets
 * object — there is no duplicate logic anywhere else in the codebase.
 *
 * Pipeline:
 *   1. BMR via Mifflin-St Jeor (1990).
 *   2. TDEE = BMR × activity factor.
 *   3. Goal offset → target calories.
 *   4. Per-goal protein and fat per-lb bodyweight → gram targets.
 *   5. Carbs = (calories - protein×4 - fat×9) / 4   (exact balance).
 *   6. Medical modifiers (Diabetes shifts carbs→35%, fat→40%; Kidney caps protein).
 *   7. Comment overrides from nutritionist notes (applied last).
 *
 * Changing any macro target requires changing only this file.
 */

export type Sex = "male" | "female";
export type GoalType = "fat_loss" | "muscle_gain" | "maintain" | "recomp" | "endurance";
export type ActivityLevel = "sedentary" | "light" | "moderate" | "high" | "very_high";

export interface MacroInputs {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  goal: GoalType;
  activityLevel?: ActivityLevel;
  // Medical flags that modify macros at the target stage
  medical?: {
    hasHypertension?: boolean;
    hasDiabetes?: boolean;           // shifts carbs→35%, fat→40% of calories
    hasKidneyIssues?: boolean;       // caps protein at 0.6 g/lb
    onStimulant?: boolean;           // soft sodium pref 2,000 mg (stimulants raise BP)
  };
}

export interface MacroOverrides {
  caloriesDelta?: number;
  caloriesAbsolute?: number;
  proteinG?: number;
  fatG?: number;
  fatPct?: number;
  carbsG?: number;
}

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  bmr: number;
  tdee: number;
  activityFactor: number;
  goal: GoalType;
  proteinPerKg: number;
  proteinPerLb: number;
  sodiumCapMg: number;
  notes: string[];
}

// ----- constants -----
const LB_PER_KG = 2.20462;
const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  high: 1.725,
  very_high: 1.9,
};
const DEFAULT_ACTIVITY: ActivityLevel = "moderate";

// Goal-specific formulas — per the approved spec.
// Protein and fat are grams per POUND of bodyweight.
const GOAL_FORMULAS: Record<
  GoalType,
  { kcalOffset: number; proteinPerLb: number; fatPerLb: number; label: string }
> = {
  fat_loss:    { kcalOffset: -500, proteinPerLb: 1.1,  fatPerLb: 0.35, label: "Fat Loss" },
  muscle_gain: { kcalOffset: +300, proteinPerLb: 1.0,  fatPerLb: 0.35, label: "Muscle Gain" },
  recomp:      { kcalOffset: -150, proteinPerLb: 1.15, fatPerLb: 0.35, label: "Body Recomposition" },
  maintain:    { kcalOffset: 0,    proteinPerLb: 0.9,  fatPerLb: 0.35, label: "Maintenance" },
  endurance:   { kcalOffset: +250, proteinPerLb: 0.8,  fatPerLb: 0.30, label: "Endurance" },
};

function mifflinStJeor(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

/**
 * THE function. Every caller uses this.
 */
export function calculateMacros(
  inputs: MacroInputs,
  overrides: MacroOverrides = {}
): MacroTargets {
  const notes: string[] = [];
  const weightLb = inputs.weightKg * LB_PER_KG;

  // 1. BMR
  const bmr = mifflinStJeor(inputs.sex, inputs.weightKg, inputs.heightCm, inputs.age);

  // 2. TDEE
  const activityLevel = inputs.activityLevel ?? DEFAULT_ACTIVITY;
  const activityFactor = ACTIVITY_FACTORS[activityLevel];
  const tdee = bmr * activityFactor;

  // 3. Goal calories
  const formula = GOAL_FORMULAS[inputs.goal];
  let calories = tdee + formula.kcalOffset;

  // 4. Protein + fat per g/lb, then carbs as the remainder (exact balance)
  let proteinG = Math.round(weightLb * formula.proteinPerLb);
  let fatG = Math.round(weightLb * formula.fatPerLb);

  // 5. Medical modifiers BEFORE comment overrides
  if (inputs.medical?.hasKidneyIssues) {
    const kidneyCapG = Math.round(weightLb * 0.6);
    if (proteinG > kidneyCapG) {
      proteinG = kidneyCapG;
      notes.push(
        `Protein capped at ${kidneyCapG}g (0.6 g/lb) due to kidney issues — overrides the ${formula.label} default.`
      );
    }
  }

  if (inputs.medical?.hasDiabetes) {
    // Shift macro split: carbs down to ~35% of kcal, fat up to ~40%.
    // Protein stays at the goal's g/lb; calories re-derive to keep the split consistent.
    const carbKcal = calories * 0.35;
    const fatKcal = calories * 0.40;
    const newCarbG = Math.round(carbKcal / 4);
    const newFatG = Math.round(fatKcal / 9);
    // Protein is still proteinG; total kcal remains `calories`.
    // If protein*4 + newFat*9 + newCarb*4 differs from calories by >50 kcal,
    // trim carbs to restore balance.
    const recalc = proteinG * 4 + newFatG * 9 + newCarbG * 4;
    const diff = calories - recalc;
    fatG = newFatG;
    const carbsG_diabetic = newCarbG + Math.round(diff / 4);
    notes.push(`Diabetic macro split applied: ~35% carbs / ~40% fat. Distribute carbs evenly across meals and prefer low-glycemic sources.`);
    // Temporarily stash carbs; balance below will recalc if no overrides hit.
    const target: MacroTargets = {
      calories: Math.round(calories),
      proteinG,
      carbsG: carbsG_diabetic,
      fatG,
      bmr: Math.round(bmr),
      tdee: Math.round(tdee),
      activityFactor,
      goal: inputs.goal,
      proteinPerKg: Math.round((proteinG / inputs.weightKg) * 10) / 10,
      proteinPerLb: Math.round((proteinG / weightLb) * 100) / 100,
      sodiumCapMg: inputs.medical?.hasHypertension ? 1800 : inputs.medical?.onStimulant ? 2000 : 2300,
      notes,
    };
    return applyOverrides(target, overrides);
  }

  // 6. Apply comment overrides (calories first, then protein, then fat)
  // Non-diabetic path: carbs are pure remainder.
  const target: MacroTargets = {
    calories: Math.round(calories),
    proteinG,
    // Placeholder: we compute carbs in applyOverrides after all macros settled.
    carbsG: 0,
    fatG,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    activityFactor,
    goal: inputs.goal,
    proteinPerKg: Math.round((proteinG / inputs.weightKg) * 10) / 10,
    proteinPerLb: Math.round((proteinG / weightLb) * 100) / 100,
    sodiumCapMg: inputs.medical?.hasHypertension ? 1800 : inputs.medical?.onStimulant ? 2000 : 2300,
    notes,
  };
  return applyOverrides(target, overrides);
}

/**
 * Apply comment-driven overrides on top of the goal- and medical-derived targets,
 * then balance carbs so the macro gram totals multiply out to the stated kcal.
 */
function applyOverrides(t: MacroTargets, overrides: MacroOverrides): MacroTargets {
  const notes = [...t.notes];

  if (overrides.caloriesAbsolute !== undefined) {
    t.calories = overrides.caloriesAbsolute;
    notes.push(`Calories overridden: ${overrides.caloriesAbsolute} kcal.`);
  } else if (overrides.caloriesDelta !== undefined) {
    t.calories += overrides.caloriesDelta;
    const sign = overrides.caloriesDelta >= 0 ? "+" : "";
    notes.push(`Calories adjusted: ${sign}${overrides.caloriesDelta} kcal.`);
  }

  if (overrides.proteinG !== undefined) {
    t.proteinG = overrides.proteinG;
    notes.push(`Protein overridden: ${t.proteinG}g.`);
  }

  if (overrides.fatG !== undefined) {
    t.fatG = overrides.fatG;
    notes.push(`Fat overridden: ${t.fatG}g.`);
  } else if (overrides.fatPct !== undefined) {
    t.fatG = Math.round((t.calories * overrides.fatPct) / 9);
    notes.push(`Fat set from comment: ${Math.round(overrides.fatPct * 100)}% of calories.`);
  }

  if (overrides.carbsG !== undefined) {
    t.carbsG = overrides.carbsG;
    notes.push(`Carbs overridden: ${t.carbsG}g.`);
  } else {
    // Balance: carbs fill the remaining kcal
    const proteinKcal = t.proteinG * 4;
    const fatKcal = t.fatG * 9;
    t.carbsG = Math.max(0, Math.round((t.calories - proteinKcal - fatKcal) / 4));
  }

  return {
    ...t,
    notes,
  };
}

/**
 * Map common intake phrases to ActivityLevel. Falls back to moderate.
 */
/**
 * Parse activity-level from intake. Critical: all tokens use word boundaries
 * so substrings inside unrelated words don't false-match.
 * Brandon bug 2026-04-23: "be proud of how I look" matched bare /pro/
 * and pushed activity to very_high (1.9×), producing 3296 kcal for a
 * 182 lb recomp target instead of the correct 2661 kcal.
 */
export function parseActivityLevel(raw: string): ActivityLevel {
  const s = (raw || "").toLowerCase();
  if (/\b(sedentary|desk job)\b|no exercise|no training/.test(s)) return "sedentary";
  if (/\blight\b|1-2\s*(times|x)\s*\/?\s*week|1-2 workouts/.test(s)) return "light";
  if (/\b(very high|very active|athlete|pro athlete|elite|twice a day|two a day|2x\/day|high volume)\b/.test(s)) return "very_high";
  if (/\b(high(?:\s+activity)?|intense|intensive|5-6 (?:days|times)|6 days|6x\s*\/?\s*week|daily training)\b/.test(s)) return "high";
  return "moderate";
}

/**
 * Human-readable label for the current goal. Used on the PDF cover.
 */
export function goalLabelFor(goal: GoalType): string {
  return GOAL_FORMULAS[goal].label;
}

// ============================================================================
// Height / weight parsers (unchanged from prior version)
// ============================================================================

export function parseHeightToCm(heightStr: string): number | null {
  if (!heightStr) return null;
  const s = heightStr.trim().toLowerCase();
  const ftInMatch = s.match(/(\d+)\s*(?:'|ft|feet|ft\.)\s*(\d+)?/);
  if (ftInMatch) {
    const ft = parseInt(ftInMatch[1], 10);
    const inches = ftInMatch[2] ? parseInt(ftInMatch[2], 10) : 0;
    return Math.round((ft * 12 + inches) * 2.54);
  }
  const numMatch = s.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const n = parseFloat(numMatch[1]);
    if (n > 100) return Math.round(n);
    if (n >= 48 && n <= 84) return Math.round(n * 2.54);
  }
  return null;
}

export function parseWeightToKg(weightStr: string): number | null {
  if (!weightStr) return null;
  const s = weightStr.trim().toLowerCase();
  if (s.includes("kg")) {
    const n = parseFloat(s.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  }
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  if (isNaN(n)) return null;
  return Math.round(n * 0.453592 * 10) / 10;
}
