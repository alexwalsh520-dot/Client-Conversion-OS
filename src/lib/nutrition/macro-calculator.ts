/**
 * Deterministic macro target calculator.
 *
 * Uses:
 *  - Mifflin-St Jeor (1990) for BMR (gold standard, used by ACSM)
 *  - Activity factor 1.55 (moderately active, clients are training 3-5x/week)
 *  - ISSN 2017 position stand for protein recommendations
 *  - ACSM minimum 20% fat (we use 25% for satiety)
 *
 * No AI is involved in macro calculation — only the code in this file.
 */

export type Sex = "male" | "female";
export type GoalType = "fat_loss" | "muscle_gain" | "maintain" | "recomp";

export interface MacroInputs {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  goal: GoalType;
}

export interface MacroOverrides {
  // Explicit target adjustments from comments
  caloriesDelta?: number;        // +200 / -300 added to final calories
  caloriesAbsolute?: number;     // Hard override "2500 kcal"
  proteinG?: number;              // Hard override in grams
  fatG?: number;
  fatPct?: number;                // 25% → 0.25
  carbsG?: number;
}

export interface MacroTargets {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  // Breakdown for transparency
  bmr: number;
  tdee: number;
  activityFactor: number;
  goal: GoalType;
  proteinPerKg: number;
  notes: string[];
}

const ACTIVITY_FACTOR = 1.55; // Moderately active (clients train 3-5x/week per program)

/**
 * Mifflin-St Jeor BMR formula (1990).
 */
function calculateBMR(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === "male" ? base + 5 : base - 161;
}

/**
 * Caloric target based on goal.
 * - Fat loss: -20% of TDEE
 * - Muscle gain: +10% of TDEE
 * - Recomp (build + lose fat simultaneously): -10% (slight deficit; gains are possible
 *   for intermediate trainees at a small deficit with high protein)
 * - Maintain: 0
 */
function calculateGoalCalories(tdee: number, goal: GoalType): number {
  switch (goal) {
    case "fat_loss":
      return tdee * 0.80;
    case "muscle_gain":
      return tdee * 1.10;
    case "recomp":
      return tdee * 0.90;
    case "maintain":
    default:
      return tdee;
  }
}

/**
 * Protein grams based on bodyweight and goal.
 * Per ISSN 2017 position stand.
 */
function calculateProtein(weightKg: number, goal: GoalType): { grams: number; perKg: number } {
  let perKg: number;
  switch (goal) {
    case "fat_loss":
    case "recomp":
      perKg = 2.2; // Higher in deficit to preserve lean mass (recomp behaves like a cut)
      break;
    case "muscle_gain":
      perKg = 1.8; // Sufficient for hypertrophy in surplus
      break;
    case "maintain":
    default:
      perKg = 1.6; // General health/performance
      break;
  }
  return { grams: Math.round(weightKg * perKg), perKg };
}

/**
 * Main calculator. Applies overrides from comments AFTER calculating defaults.
 */
export function calculateMacros(
  inputs: MacroInputs,
  overrides: MacroOverrides = {}
): MacroTargets {
  const notes: string[] = [];

  // Step 1: BMR (Mifflin-St Jeor)
  const bmr = calculateBMR(inputs.sex, inputs.weightKg, inputs.heightCm, inputs.age);

  // Step 2: TDEE
  const tdee = bmr * ACTIVITY_FACTOR;

  // Step 3: Caloric target
  let calories = calculateGoalCalories(tdee, inputs.goal);

  if (overrides.caloriesAbsolute !== undefined) {
    calories = overrides.caloriesAbsolute;
    notes.push(`Calories overridden from comment: ${overrides.caloriesAbsolute} kcal`);
  } else if (overrides.caloriesDelta !== undefined) {
    calories += overrides.caloriesDelta;
    const sign = overrides.caloriesDelta >= 0 ? "+" : "";
    notes.push(`Calories adjusted from comment: ${sign}${overrides.caloriesDelta} kcal`);
  }

  // Step 4: Protein (can be overridden)
  let proteinG: number;
  let proteinPerKg: number;
  if (overrides.proteinG !== undefined) {
    proteinG = overrides.proteinG;
    proteinPerKg = proteinG / inputs.weightKg;
    notes.push(`Protein overridden from comment: ${proteinG}g`);
  } else {
    const p = calculateProtein(inputs.weightKg, inputs.goal);
    proteinG = p.grams;
    proteinPerKg = p.perKg;
  }

  // Step 5: Fat
  let fatG: number;
  if (overrides.fatG !== undefined) {
    fatG = overrides.fatG;
    notes.push(`Fat overridden from comment: ${fatG}g`);
  } else if (overrides.fatPct !== undefined) {
    fatG = Math.round((calories * overrides.fatPct) / 9);
    notes.push(`Fat set from comment: ${Math.round(overrides.fatPct * 100)}% of calories`);
  } else {
    fatG = Math.round((calories * 0.25) / 9); // default 25% of calories
  }

  // Step 6: Carbs (remainder, unless overridden)
  let carbsG: number;
  if (overrides.carbsG !== undefined) {
    carbsG = overrides.carbsG;
    notes.push(`Carbs overridden from comment: ${carbsG}g`);
    // Recalculate calories to match if carbs are hard-set
    const recalcCalories = proteinG * 4 + carbsG * 4 + fatG * 9;
    if (Math.abs(recalcCalories - calories) > 50) {
      notes.push(`Note: carbs override changes total calories to ~${recalcCalories} kcal`);
    }
  } else {
    const proteinCals = proteinG * 4;
    const fatCals = fatG * 9;
    const carbCals = Math.max(calories - proteinCals - fatCals, 0);
    carbsG = Math.round(carbCals / 4);
  }

  return {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    activityFactor: ACTIVITY_FACTOR,
    goal: inputs.goal,
    proteinPerKg: Math.round(proteinPerKg * 10) / 10,
    notes,
  };
}

/**
 * Convert height string (e.g. "5'10", "70", "5 ft 10 in") to cm.
 * Falls back to null if unparseable.
 */
export function parseHeightToCm(heightStr: string): number | null {
  if (!heightStr) return null;
  const s = heightStr.trim().toLowerCase();

  // Try "5'10"", "5 10", "5ft10in"
  const ftInMatch = s.match(/(\d+)\s*(?:'|ft|feet|ft\.)\s*(\d+)?/);
  if (ftInMatch) {
    const ft = parseInt(ftInMatch[1], 10);
    const inches = ftInMatch[2] ? parseInt(ftInMatch[2], 10) : 0;
    return Math.round((ft * 12 + inches) * 2.54);
  }

  // Try just a number (inches)
  const numMatch = s.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) {
    const n = parseFloat(numMatch[1]);
    // If > 100 assume cm; if between 48-84 assume inches
    if (n > 100) return Math.round(n);
    if (n >= 48 && n <= 84) return Math.round(n * 2.54);
  }

  return null;
}

/**
 * Convert weight string (e.g. "180", "180 lbs", "82 kg") to kg.
 */
export function parseWeightToKg(weightStr: string): number | null {
  if (!weightStr) return null;
  const s = weightStr.trim().toLowerCase();

  if (s.includes("kg")) {
    const n = parseFloat(s.replace(/[^\d.]/g, ""));
    return isNaN(n) ? null : n;
  }

  // Default to lbs
  const n = parseFloat(s.replace(/[^\d.]/g, ""));
  if (isNaN(n)) return null;
  return Math.round(n * 0.453592 * 10) / 10;
}
