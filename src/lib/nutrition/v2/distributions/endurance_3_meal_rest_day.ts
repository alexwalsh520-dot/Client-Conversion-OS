/**
 * Meal distribution: Endurance 3-meal rest day.
 *
 * Use case: endurance clients on rest days. Three meals with the bulk of
 * calories / protein shifted later to support overnight recovery. Typically
 * paired with endurance_5_meal_training_day via per-day meal-count switching.
 *
 * No peri-workout slots → no bias overrides needed on rest days.
 *
 * Per-column sum verification (must each equal 100):
 *   protein: 25 + 35 + 40 = 100  ✓
 *   carbs:   30 + 35 + 35 = 100  ✓
 *   fat:     30 + 35 + 35 = 100  ✓
 */

import {
  DistributionTemplateId,
  MealSlotKind,
  type MealDistribution,
} from "../types";

const endurance_3_meal_rest_day: MealDistribution = {
  id: DistributionTemplateId.ENDURANCE_3_MEAL_REST_DAY,
  label: "Endurance — Rest Day (3 Meals)",
  description:
    "Rest-day eating for endurance clients. Three meals with calories and " +
    "protein shifted later to support overnight recovery.",
  meals_per_day: 3,
  day_kind: "rest",
  slots: [
    {
      index: 1,
      label: "Breakfast",
      kind: MealSlotKind.BREAKFAST,
      protein_pct: 25,
      carb_pct: 30,
      fat_pct: 30,
    },
    {
      index: 2,
      label: "Lunch",
      kind: MealSlotKind.LUNCH,
      protein_pct: 35,
      carb_pct: 35,
      fat_pct: 35,
    },
    {
      index: 3,
      label: "Dinner",
      kind: MealSlotKind.DINNER,
      protein_pct: 40,
      carb_pct: 35,
      fat_pct: 35,
    },
  ],
};

export default endurance_3_meal_rest_day;
