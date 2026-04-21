/**
 * Generate the "Nutrition Tips & Guidelines" section.
 * Structured as [{ title, body }] to match the sample layout.
 * Bodies are personalized from the intake form where relevant.
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

export interface Tip {
  title: string;
  body: string;
}

/**
 * Personalized + consistent 10-tip list, mirroring the sample PDF layout.
 */
export function generateTips(ctx: TipsContext): Tip[] {
  const tips: Tip[] = [];

  // 1. Hydration — personalized if water intake looks low
  const waterLower = (ctx.waterIntake || "").toLowerCase();
  const lowWater =
    waterLower.includes("less than") ||
    waterLower.includes("not enough") ||
    waterLower.includes("hardly") ||
    waterLower.includes("little") ||
    /^\s*\d+\s*(cup|oz)/.test(waterLower);
  tips.push({
    title: "Stay Hydrated",
    body: lowWater
      ? "Your intake form suggests water intake is on the low side. Aim for at least 3-4 liters per day and more on training days. Carry a water bottle and refill it 3-4 times throughout the day."
      : "Drink at least 3-4 liters of water daily. Increase intake on training days or in hot weather. Carry a water bottle and aim to finish it 3-4 times throughout the day.",
  });

  // 2. Meal timing around training
  tips.push({
    title: "Meal Timing Around Training",
    body: "Have a meal with both protein and carbs 1.5-2 hours before your workout. After training, eat a protein-rich meal within 60 minutes to maximize recovery.",
  });

  // 3. Prep in batches — phrased differently based on canCook
  const canCookLower = (ctx.canCook || "").toLowerCase();
  const cannotCook = canCookLower.includes("no") || canCookLower.includes("limited") || canCookLower.includes("can't");
  tips.push({
    title: "Prep in Batches",
    body: cannotCook
      ? "If full cooking isn't feasible for you, lean on microwaveable rice packets, pre-cooked rotisserie chicken, and bagged salad greens. Even one batch-prep session on Sunday cuts weekday stress dramatically."
      : "Cook proteins (chicken, beef, eggs) and grains (rice, quinoa) in bulk on Sundays and Wednesdays. Store in portioned containers — this saves time and keeps you on track during busy days.",
  });

  // 4. Weighing food
  tips.push({
    title: "Weigh Your Food",
    body: "Use a kitchen scale for at least the first 2-3 weeks. Most people underestimate portions by 20-40%. Once you can eyeball portions accurately, you can rely on estimation.",
  });

  // 5. Don't skip meals
  tips.push({
    title: "Don't Skip Meals",
    body: "Each meal is designed to hit a specific macro split. Skipping one throws off your daily totals and can lead to overeating later. If you're short on time, even a quick version of the meal is better than nothing.",
  });

  // 6. Listen to your body
  tips.push({
    title: "Listen to Your Body",
    body: "If you're consistently feeling sluggish, overly hungry, or bloated, note it down and bring it up at your next check-in. Small adjustments to food choices or timing can make a big difference.",
  });

  // 7. Grocery shopping tips
  tips.push({
    title: "Grocery Shopping Tips",
    body: "Shop the perimeter of the store first — produce, meats, dairy. Use the consolidated grocery list in this plan to stay focused. Buy frozen vegetables as a backup for weeks when fresh ones go bad.",
  });

  // 8. Supplements — personalized based on supplements listed
  const supplementsLower = (ctx.supplements || "").toLowerCase();
  const hasSupplements =
    supplementsLower &&
    !/^\s*(n\/?a|none|no)\s*$/.test(supplementsLower) &&
    (supplementsLower.includes("creatine") ||
      supplementsLower.includes("whey") ||
      supplementsLower.includes("protein") ||
      supplementsLower.includes("multi"));
  if (hasSupplements) {
    const pieces: string[] = [];
    if (supplementsLower.includes("whey") || supplementsLower.includes("protein powder")) {
      pieces.push("whey around training for convenient protein");
    }
    if (supplementsLower.includes("creatine")) {
      pieces.push("creatine any time of day, 5g daily with water");
    }
    if (supplementsLower.includes("multi")) {
      pieces.push("multivitamin with your largest meal for best absorption");
    }
    tips.push({
      title: "Supplements",
      body: `Based on what you listed: ${pieces.join("; ")}. Consistency matters more than timing with most supplements.`,
    });
  } else {
    tips.push({
      title: "Supplements (If Applicable)",
      body: "If you're using whey protein, creatine, or a multivitamin, take them consistently. Whey around training, creatine any time of day (5g daily), and multivitamin with your largest meal for best absorption.",
    });
  }

  // 9. Sleep — personalized if sleep is low
  const sleepLower = (ctx.sleepHours || "").toLowerCase();
  const sleepMatch = sleepLower.match(/(\d+)/);
  const sleepHrs = sleepMatch ? parseInt(sleepMatch[1], 10) : null;
  tips.push({
    title: "Sleep & Recovery",
    body:
      sleepHrs !== null && sleepHrs < 7
        ? `You mentioned ~${sleepHrs} hours of sleep. Chronic sleep under 7 hours blunts recovery, raises cortisol, and increases appetite. Prioritize getting to bed 30-60 minutes earlier — it does more for body composition than any supplement.`
        : "Aim for 7-9 hours of sleep per night. Poor sleep increases hunger hormones and reduces protein synthesis. Your nutrition plan works best when paired with adequate rest.",
  });

  // 10. Be consistent
  tips.push({
    title: "Be Consistent, Not Perfect",
    body:
      ctx.goal === "fat_loss"
        ? "Fat loss isn't linear — expect ±1-2 lb weekly fluctuations. Hitting your targets 85-90% of the time is what produces results. Focus on the 2-week trend, not individual days."
        : ctx.goal === "muscle_gain"
        ? "Muscle gain is slow — plan on ~0.5-1 lb per month. Hitting targets 85-90% of the time is plenty. If scale weight isn't moving after 2-3 weeks, bump calories by 100-150."
        : "Hitting your targets 85-90% of the time will get results. One off-plan meal won't ruin progress — but a pattern of skipping will. Focus on the weekly average, not each individual day.",
  });

  return tips;
}
