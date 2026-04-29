/**
 * Meal distribution: Endurance 5-meal training day.
 *
 * Use case: endurance clients on training days. Pre-workout slot biases
 * volume (light, easy-digest). Post-workout slot biases density (fast carbs
 * + protein). Other slots keep standard bias.
 *
 * This is the ONLY build (Endurance) that allows per-day variable meal
 * counts (paired with endurance_3_meal_rest_day). PDF renderer must support
 * per-day meal count — see Q4 resolution.
 *
 * Per-column sum verification (must each equal 100):
 *   protein: 20 + 10 + 25 + 25 + 20 = 100  ✓
 *   carbs:   15 + 20 + 30 + 20 + 15 = 100  ✓
 *   fat:     25 +  5 + 10 + 30 + 30 = 100  ✓
 */

import {
  DistributionTemplateId,
  MealSlotKind,
  SolverBias,
  type MealDistribution,
} from "../types";

const endurance_5_meal_training_day: MealDistribution = {
  id: DistributionTemplateId.ENDURANCE_5_MEAL_TRAINING_DAY,
  label: "Endurance — Training Day (5 Meals)",
  description:
    "Breakfast, pre-workout (volume-light), post-workout (density-biased), " +
    "midday meal, dinner. Peri-workout slots prioritize digestibility and " +
    "fast recovery carbs.",
  meals_per_day: 5,
  day_kind: "training",
  slots: [
    {
      index: 1,
      label: "Breakfast",
      kind: MealSlotKind.BREAKFAST,
      protein_pct: 20,
      carb_pct: 15,
      fat_pct: 25,
    },
    {
      index: 2,
      label: "Pre-Workout",
      kind: MealSlotKind.PRE_WORKOUT,
      protein_pct: 10,
      carb_pct: 20,
      fat_pct: 5,
      bias: SolverBias.VOLUME, // light, easy-digest, low-fat for gut comfort
    },
    {
      index: 3,
      label: "Post-Workout",
      kind: MealSlotKind.POST_WORKOUT,
      protein_pct: 25,
      carb_pct: 30,
      fat_pct: 10,
      bias: SolverBias.DENSITY, // fast carbs + protein, fat kept low
    },
    {
      index: 4,
      label: "Midday Meal",
      kind: MealSlotKind.LUNCH,
      protein_pct: 25,
      carb_pct: 20,
      fat_pct: 30,
    },
    {
      index: 5,
      label: "Dinner",
      kind: MealSlotKind.DINNER,
      protein_pct: 20,
      carb_pct: 15,
      fat_pct: 30,
    },
  ],
};

export default endurance_5_meal_training_day;
