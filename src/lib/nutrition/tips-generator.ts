/**
 * Generate personalized + generic tips for the client's meal plan PDF.
 * Deterministic — rule-based from intake form data.
 */

export interface TipsContext {
  fitnessGoal: string;
  canCook: string;
  mealCount: string;
  medications: string;
  supplements: string;
  sleepHours: string;
  waterIntake: string;
  allergies: string;
  goal: "fat_loss" | "muscle_gain" | "maintain";
  proteinG: number;
  caloriesPerDay: number;
}

const GENERIC_TIPS = [
  "Weigh ingredients in grams where possible — volume estimates vary and throw off your totals.",
  "Cook proteins in bulk (2-3 days at a time) to save prep time and stay consistent on busy days.",
  "If you miss a meal, don't double up the next one — spread portions across your remaining meals.",
  "Track adherence, not perfection. Hitting 80-90% of the plan every week beats a perfect week followed by an off week.",
  "Fiber helps satiety and digestion. Aim to include vegetables or fruit in most meals.",
  "Train fasted or fed based on what works for you — what matters more is hitting your daily totals.",
  "Water intake matters: aim for ~35ml per kg bodyweight (roughly 3L/day for most people).",
  "Sleep recovery > any supplement. 7-9 hours is ideal for body composition goals.",
  "Alcohol provides 7 kcal/g and stalls progress on both fat loss and muscle gain. Minimize during the program.",
  "Meal timing flexibility: hit your daily totals. Eating windows can shift around your schedule.",
  "If hunger spikes, add more low-calorie vegetables or 1-2 tbsp of raw nuts — don't starve yourself.",
  "Protein at every meal (~25-40g) drives muscle retention better than backloading it all at dinner.",
];

/**
 * Build an ordered list of tips: 3-4 personalized + 5 generic.
 */
export function generateTips(ctx: TipsContext): string[] {
  const tips: string[] = [];

  // --- Personalized tips ---

  // Cooking/meal prep
  const canCookLower = (ctx.canCook || "").toLowerCase();
  if (canCookLower.includes("yes") || canCookLower.includes("can") || canCookLower.includes("sometimes")) {
    tips.push(
      "Since you mentioned you can cook, batch-prep your proteins (chicken, beef, fish) on Sunday and Wednesday. Portion them into containers — this makes weekday adherence almost automatic."
    );
  } else if (canCookLower.includes("no") || canCookLower.includes("limited")) {
    tips.push(
      "If full cooking isn't feasible, build meals around microwaveable rice packets, pre-cooked rotisserie chicken, and bagged salad greens. Grocery stores also carry pre-portioned grilled chicken."
    );
  }

  // Sleep
  const sleepLower = (ctx.sleepHours || "").toLowerCase();
  const sleepMatch = sleepLower.match(/(\d+)/);
  const sleepHrs = sleepMatch ? parseInt(sleepMatch[1], 10) : null;
  if (sleepHrs !== null && sleepHrs < 7) {
    tips.push(
      `You mentioned ~${sleepHrs} hours of sleep. Under 7 hours chronically blunts recovery, raises cortisol, and increases appetite. Prioritize getting to bed 30-60 min earlier over anything else in your plan.`
    );
  }

  // Hydration
  const waterLower = (ctx.waterIntake || "").toLowerCase();
  if (
    waterLower.includes("less than") ||
    waterLower.includes("not enough") ||
    waterLower.match(/^\s*\d+\s*(cup|oz)/) ||
    waterLower.includes("hardly") ||
    waterLower.includes("little")
  ) {
    tips.push(
      "Based on your intake, increase water — carry a 1L bottle and refill it 2-3 times per day. Dehydration often shows up as hunger and cravings."
    );
  }

  // Supplements
  const supplementsLower = (ctx.supplements || "").toLowerCase();
  if (
    supplementsLower &&
    !/^\s*(n\/?a|none|no)\s*$/.test(supplementsLower) &&
    (supplementsLower.includes("creatine") ||
      supplementsLower.includes("whey") ||
      supplementsLower.includes("protein") ||
      supplementsLower.includes("multi"))
  ) {
    const supplementTips: string[] = [];
    if (supplementsLower.includes("creatine")) {
      supplementTips.push("creatine daily (any time of day, with water)");
    }
    if (supplementsLower.includes("whey") || supplementsLower.includes("protein powder")) {
      supplementTips.push("whey post-workout or anytime you're short on protein");
    }
    if (supplementsLower.includes("multi")) {
      supplementTips.push("multivitamin with breakfast for absorption");
    }
    if (supplementTips.length > 0) {
      tips.push(`On your supplements: ${supplementTips.join("; ")}.`);
    }
  }

  // Allergies reminder
  const allergiesLower = (ctx.allergies || "").toLowerCase();
  if (allergiesLower && !/^\s*(n\/?a|none|no)\s*$/.test(allergiesLower)) {
    tips.push(
      `Your plan avoids your listed allergies/sensitivities. Always double-check packaged food labels — cross-contamination can happen in shared facilities.`
    );
  }

  // Protein target reminder
  if (ctx.proteinG > 150) {
    tips.push(
      `Your protein target (${ctx.proteinG}g/day) is on the higher side for muscle preservation. If you struggle to hit it, add Greek yogurt or a whey shake between meals — these are efficient protein vehicles.`
    );
  }

  // Goal-specific tip
  if (ctx.goal === "fat_loss") {
    tips.push(
      "Fat loss isn't linear — expect weekly fluctuations of ±1-2 lbs. Judge progress on 2-week trends, and weigh yourself first thing in the morning after the bathroom for consistency."
    );
  } else if (ctx.goal === "muscle_gain") {
    tips.push(
      "Muscle gain happens slowly — expect ~0.5-1 lb per month. If scale weight isn't moving up after 2-3 weeks, bump daily calories by 100-150."
    );
  }

  // Meal count
  const mealCountLower = (ctx.mealCount || "").toLowerCase();
  if (mealCountLower.includes("smaller") || mealCountLower.match(/[56]/)) {
    tips.push(
      "Smaller, more frequent meals work well for blood sugar and satiety. Keep portions consistent across meals rather than having one giant dinner."
    );
  }

  // --- Generic tips fill remaining slots up to 8 total ---
  const shuffled = [...GENERIC_TIPS].sort(() => Math.random() - 0.5);
  for (const g of shuffled) {
    if (tips.length >= 8) break;
    tips.push(g);
  }

  return tips.slice(0, 8);
}
