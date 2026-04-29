/**
 * Meal distribution: Lunch-centered 3-meal day.
 *
 * Use case: clients with larger mid-day meals (European / Mediterranean
 * eating pattern, or clients whose lunch is their social / family meal).
 * Smaller breakfast + dinner bookending a substantial lunch.
 *
 * Per-column sum verification (must each equal 100):
 *   protein: 20 + 45 + 35 = 100  ✓
 *   carbs:   25 + 45 + 30 = 100  ✓
 *   fat:     20 + 45 + 35 = 100  ✓
 */

import {
  DistributionTemplateId,
  MealSlotKind,
  type MealDistribution,
} from "../types";

const lunch_centered_3_meal: MealDistribution = {
  id: DistributionTemplateId.LUNCH_CENTERED_3_MEAL,
  label: "Lunch-Centered 3 Meals",
  description:
    "Light breakfast, substantial lunch, moderate dinner. Useful for " +
    "clients whose schedule concentrates eating around midday.",
  meals_per_day: 3,
  day_kind: "any",
  slots: [
    {
      index: 1,
      label: "Breakfast",
      kind: MealSlotKind.BREAKFAST,
      protein_pct: 20,
      carb_pct: 25,
      fat_pct: 20,
    },
    {
      index: 2,
      label: "Lunch",
      kind: MealSlotKind.LUNCH,
      protein_pct: 45,
      carb_pct: 45,
      fat_pct: 45,
    },
    {
      index: 3,
      label: "Dinner",
      kind: MealSlotKind.DINNER,
      protein_pct: 35,
      carb_pct: 30,
      fat_pct: 35,
    },
  ],
};

export default lunch_centered_3_meal;
