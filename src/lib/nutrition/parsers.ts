/**
 * Parsers for intake form free-text fields and nutritionist comments.
 *
 * All deterministic string matching — never AI.
 */

import type { GoalType, Sex, MacroOverrides } from "./macro-calculator";

/**
 * Parse the "Fitness Goal" free-text from intake form into a goal type.
 */
export function parseGoalFromText(text: string): GoalType {
  if (!text) return "maintain";
  const s = text.toLowerCase();

  const fatLossKeywords = [
    "lose fat", "lose body fat", "fat loss", "cut", "cutting",
    "lean", "leaner", "get lean", "more defined", "definition",
    "lose weight", "slim down", "shred", "drop weight",
    "reduce body fat", "tone",
  ];
  const muscleGainKeywords = [
    "build muscle", "gain muscle", "bulk", "bulking",
    "mass", "gain weight", "put on size", "add size",
    "hypertrophy", "bigger", "grow muscle",
  ];

  const fatLossHit = fatLossKeywords.some((k) => s.includes(k));
  const muscleGainHit = muscleGainKeywords.some((k) => s.includes(k));

  // Both mentioned → body recomposition (slight deficit, high protein)
  if (fatLossHit && muscleGainHit) return "recomp";
  if (fatLossHit) return "fat_loss";
  if (muscleGainHit) return "muscle_gain";
  return "maintain";
}

/**
 * Cross-check the text-derived goal against current vs goal bodyweight.
 * A client who types "lose fat" but whose goal weight is 10+ lbs heavier than
 * current needs a surplus, not a deficit — the numbers win over the language.
 *
 * Thresholds:
 *  - goal_weight > current + 10 lbs (~4.5 kg)  →  muscle_gain
 *  - goal_weight ≈ current (±5 lbs, ~2 kg)     →  keep text-derived goal; if text was
 *                                                 fat_loss but they don't want to lose
 *                                                 weight, treat as recomp
 *  - goal_weight < current - 5 lbs  →  fat_loss (even if text was ambiguous)
 *
 * Returns the original goal unchanged if no numeric cross-check is possible.
 */
export function reconcileGoalWithWeights(
  textGoal: GoalType,
  currentKg: number | null,
  goalKg: number | null
): { goal: GoalType; overrodeText: boolean; note?: string } {
  if (currentKg == null || goalKg == null || !isFinite(currentKg) || !isFinite(goalKg)) {
    return { goal: textGoal, overrodeText: false };
  }
  const diffKg = goalKg - currentKg;
  const absDiffLbs = Math.abs(diffKg) * 2.20462;

  // Client wants to gain 10+ lbs — that's a surplus job
  if (diffKg >= 4.5) {
    if (textGoal !== "muscle_gain") {
      return {
        goal: "muscle_gain",
        overrodeText: true,
        note: `Goal weight is ${absDiffLbs.toFixed(0)} lbs heavier than current — calorie SURPLUS applied despite "${textGoal}" text.`,
      };
    }
    return { goal: "muscle_gain", overrodeText: false };
  }

  // Client wants to lose 5+ lbs
  if (diffKg <= -2.3) {
    if (textGoal === "muscle_gain") {
      return {
        goal: "fat_loss",
        overrodeText: true,
        note: `Goal weight is ${absDiffLbs.toFixed(0)} lbs lighter than current — calorie DEFICIT applied despite "muscle_gain" text.`,
      };
    }
    // If text already says fat_loss or recomp, keep it
    return { goal: textGoal === "maintain" ? "fat_loss" : textGoal, overrodeText: textGoal === "maintain" };
  }

  // goal ≈ current (within ~5 lbs): client wants body recomp or maintenance
  // If text said fat_loss or muscle_gain but weight barely changes → recomp
  if (textGoal === "fat_loss" || textGoal === "muscle_gain") {
    return {
      goal: "recomp",
      overrodeText: true,
      note: `Goal weight is within ${absDiffLbs.toFixed(0)} lbs of current — treating as body recomposition.`,
    };
  }
  return { goal: textGoal, overrodeText: false };
}

/**
 * Detects whether the client prefers quick-prep / crockpot meals based on free-text
 * fields like foods_avoid, daily_meals_description, can_cook.
 */
export function prefersQuickPrep(foodsAvoid: string, dailyMeals: string, canCook: string): boolean {
  const combined = `${foodsAvoid || ""} ${dailyMeals || ""} ${canCook || ""}`.toLowerCase();
  const hints = [
    "long time to cook", "long cook", "time in the kitchen", "in the kitchen the whole time",
    "crockpot", "crock pot", "slow cooker", "instant pot", "no time",
    "quick meals", "easy meals", "busy schedule", "busy", "meal prep",
    "one pot", "simple", "fast meals",
  ];
  return hints.some((h) => combined.includes(h));
}

/**
 * Detects a preference for spicy food from foods_enjoy free text.
 */
export function prefersSpicy(foodsEnjoy: string): boolean {
  const s = (foodsEnjoy || "").toLowerCase();
  const hints = ["spicy", "hot sauce", "sriracha", "jalapeño", "jalapeno", "chili", "chile", "hot food", "heat"];
  return hints.some((h) => s.includes(h));
}

/**
 * Detects a stimulant medication (e.g., methylphenidate, amphetamine) that may
 * suppress appetite — used to trigger a medication-aware nutrition tip.
 */
export function isOnAppetiteSuppressant(medications: string): boolean {
  const s = (medications || "").toLowerCase();
  const meds = [
    "methylphenidate", "ritalin", "concerta", "focalin",
    "adderall", "vyvanse", "dexedrine", "dextroamphetamine", "lisdexamfetamine",
    "strattera", "atomoxetine",
    "wellbutrin", "bupropion",
    "phentermine", "contrave", "saxenda", "ozempic", "wegovy", "mounjaro",
  ];
  return meds.some((m) => s.includes(m));
}

/**
 * Parse allergies and foods-to-avoid into a list of keywords to block.
 * Returns lowercase tokens to match against ingredient names/aliases.
 */
export function parseBlockedFoods(allergies: string, foodsAvoid: string): string[] {
  const blocked = new Set<string>();

  for (const src of [allergies, foodsAvoid]) {
    if (!src) continue;
    const s = src.toLowerCase();
    // Skip if explicitly "n/a" or "none"
    if (/^\s*(n\/?a|none|no|nothing|na)\s*$/.test(s.trim())) continue;

    // Split by commas / "and" / newlines / semicolons
    const tokens = s
      .split(/[,;\n]|\s+and\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && !/^(the|a|an|n\/?a|none|no|some|any|of)$/i.test(t));

    for (const t of tokens) {
      blocked.add(t);
    }
  }

  return Array.from(blocked);
}

/**
 * Parse preferred foods / protein preferences into a list of keywords.
 * These are used to rank/favor ingredients in the generation prompt.
 */
export function parsePreferredFoods(
  foodsEnjoy: string,
  proteinPreferences: string
): string[] {
  const preferred = new Set<string>();

  for (const src of [foodsEnjoy, proteinPreferences]) {
    if (!src) continue;
    const s = src.toLowerCase();
    if (/^\s*(n\/?a|none|nothing)\s*$/.test(s.trim())) continue;

    const tokens = s
      .split(/[,;\n]|\s+and\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && !/^(the|a|an|n\/?a|none|no|some|any|of|i|like|love|enjoy|eat)$/i.test(t));

    for (const t of tokens) {
      preferred.add(t);
    }
  }

  return Array.from(preferred);
}

/**
 * Parse a single comment for overrides (sex, weight, macro targets).
 * Returns everything that could be extracted from this comment.
 */
export interface CommentDirectives {
  sexOverride?: Sex;
  weightKgOverride?: number;
  macroOverrides: MacroOverrides;
}

export function parseCommentDirectives(comment: string): CommentDirectives {
  const result: CommentDirectives = { macroOverrides: {} };
  if (!comment) return result;
  const s = comment.toLowerCase();

  // --- Sex ---
  if (/\b(this is a|client is|she is|shes|she's|they are)?\s*(female|woman|girl)\b/.test(s)) {
    result.sexOverride = "female";
  } else if (/\b(this is a|client is|he is|hes|he's)?\s*(male|man|guy)\b/.test(s) && !s.includes("female")) {
    result.sexOverride = "male";
  }

  // --- Weight override ---
  // Patterns: "new weight: 160 lbs", "current weight 160", "weight is now 72 kg", "160 lbs now", "now weighs 160"
  const weightMatch =
    s.match(/(?:new weight|current weight|weight is now|weight\s*:|now weighs|client is now|updated weight)[^\d]{0,10}(\d+(?:\.\d+)?)\s*(lbs?|kgs?|pounds?|kilograms?)?/) ||
    s.match(/(\d+(?:\.\d+)?)\s*(lbs?|pounds?)\s*now\b/) ||
    s.match(/\bnew\s*bw[^\d]{0,5}(\d+(?:\.\d+)?)\s*(lbs?|kgs?)?/);
  if (weightMatch) {
    const n = parseFloat(weightMatch[1]);
    const unit = (weightMatch[2] || "lbs").toLowerCase();
    if (!isNaN(n)) {
      if (unit.startsWith("kg")) {
        result.weightKgOverride = n;
      } else {
        result.weightKgOverride = Math.round(n * 0.453592 * 10) / 10;
      }
    }
  }

  // --- Calorie delta (e.g. "+200 kcal", "add 200 kcal", "more 200 cal") ---
  const calDeltaMatch =
    s.match(/([+-]\s*\d+)\s*(?:kcal|cal|calories)/) ||
    s.match(/\b(?:add|increase|more|bump up)\s+(\d+)\s*(?:kcal|cal|calories)/) ||
    s.match(/\b(?:reduce|drop|decrease|less|cut)\s+(?:by\s+)?(\d+)\s*(?:kcal|cal|calories)/);
  if (calDeltaMatch) {
    const raw = calDeltaMatch[1].replace(/\s/g, "");
    const n = parseInt(raw, 10);
    if (!isNaN(n)) {
      if (/reduce|drop|decrease|less|cut/.test(s)) {
        result.macroOverrides.caloriesDelta = -Math.abs(n);
      } else if (raw.startsWith("-")) {
        result.macroOverrides.caloriesDelta = n;
      } else {
        result.macroOverrides.caloriesDelta = Math.abs(n);
      }
    }
  }

  // --- Calorie absolute ("set calories to 2500", "2500 kcal target") ---
  const calAbsMatch =
    s.match(/(?:set|target|daily)\s+(?:calories?|kcal)\s+(?:to|=|at)?\s*(\d{3,5})/) ||
    s.match(/(\d{3,5})\s*(?:kcal|calories?)\s*(?:target|daily|per day)/);
  if (calAbsMatch) {
    const n = parseInt(calAbsMatch[1], 10);
    if (!isNaN(n) && n >= 800 && n <= 6000) {
      result.macroOverrides.caloriesAbsolute = n;
    }
  }

  // --- Protein grams ---
  const proteinMatch =
    s.match(/\bprotein\s*[:=]?\s*(\d+)\s*g?\b/) ||
    s.match(/(\d+)\s*g?\s*protein\b/) ||
    s.match(/\bbump\s+protein\s+to\s+(\d+)/);
  if (proteinMatch) {
    const n = parseInt(proteinMatch[1], 10);
    if (!isNaN(n) && n >= 40 && n <= 400) {
      result.macroOverrides.proteinG = n;
    }
  }

  // --- Fat ---
  const fatPctMatch = s.match(/\bfat\s*[:=]?\s*(\d+)\s*%/);
  if (fatPctMatch) {
    const n = parseInt(fatPctMatch[1], 10);
    if (!isNaN(n) && n >= 10 && n <= 50) {
      result.macroOverrides.fatPct = n / 100;
    }
  } else {
    const fatGMatch = s.match(/\bfat\s*[:=]?\s*(\d+)\s*g\b/) || s.match(/(\d+)\s*g\s*fat\b/);
    if (fatGMatch) {
      const n = parseInt(fatGMatch[1], 10);
      if (!isNaN(n) && n >= 20 && n <= 200) {
        result.macroOverrides.fatG = n;
      }
    }
  }

  // --- Carbs ---
  const carbMatch =
    s.match(/\bcarbs?\s*[:=]?\s*(\d+)\s*g?\b/) ||
    s.match(/(\d+)\s*g\s*carbs?\b/);
  if (carbMatch) {
    const n = parseInt(carbMatch[1], 10);
    if (!isNaN(n) && n >= 20 && n <= 700) {
      result.macroOverrides.carbsG = n;
    }
  }

  return result;
}

/**
 * Merge multiple comments (newest first) into a single set of directives.
 * Newest wins for any given field.
 */
export function mergeCommentDirectives(
  comments: { comment: string; createdAt?: string }[]
): CommentDirectives {
  // Sort newest first
  const sorted = [...comments].sort((a, b) => {
    if (!a.createdAt || !b.createdAt) return 0;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const merged: CommentDirectives = { macroOverrides: {} };

  for (const c of sorted) {
    const d = parseCommentDirectives(c.comment);
    if (d.sexOverride && !merged.sexOverride) merged.sexOverride = d.sexOverride;
    if (d.weightKgOverride !== undefined && merged.weightKgOverride === undefined) {
      merged.weightKgOverride = d.weightKgOverride;
    }
    if (d.macroOverrides.caloriesAbsolute !== undefined && merged.macroOverrides.caloriesAbsolute === undefined) {
      merged.macroOverrides.caloriesAbsolute = d.macroOverrides.caloriesAbsolute;
    }
    if (d.macroOverrides.caloriesDelta !== undefined && merged.macroOverrides.caloriesDelta === undefined) {
      merged.macroOverrides.caloriesDelta = d.macroOverrides.caloriesDelta;
    }
    if (d.macroOverrides.proteinG !== undefined && merged.macroOverrides.proteinG === undefined) {
      merged.macroOverrides.proteinG = d.macroOverrides.proteinG;
    }
    if (d.macroOverrides.fatG !== undefined && merged.macroOverrides.fatG === undefined) {
      merged.macroOverrides.fatG = d.macroOverrides.fatG;
    }
    if (d.macroOverrides.fatPct !== undefined && merged.macroOverrides.fatPct === undefined) {
      merged.macroOverrides.fatPct = d.macroOverrides.fatPct;
    }
    if (d.macroOverrides.carbsG !== undefined && merged.macroOverrides.carbsG === undefined) {
      merged.macroOverrides.carbsG = d.macroOverrides.carbsG;
    }
  }

  return merged;
}

/**
 * Parse "How Many Meals Do You Prefer?" to an integer.
 */
export function parseMealCount(mealCountStr: string): number {
  if (!mealCountStr) return 3;
  const s = mealCountStr.toLowerCase();

  // Look for specific numbers first
  const numMatch = s.match(/(\d+)/);
  if (numMatch) {
    const n = parseInt(numMatch[1], 10);
    if (n >= 2 && n <= 8) return n;
  }

  if (s.includes("smaller") || s.includes("5+") || s.includes("5 +")) return 5;
  if (s.includes("bigger") || s.includes("3")) return 3;
  return 3;
}
