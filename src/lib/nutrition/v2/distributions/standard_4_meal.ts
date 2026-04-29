/**
 * Meal distribution: Standard 4-meal day.
 *
 * Use case: breakfast, lunch, afternoon snack, dinner. Default for clients
 * with moderate hunger / longer gaps between lunch and dinner. Snack absorbs
 * ~10–15% of daily macros.
 *
 * Per-column sum verification (must each equal 100):
 *   protein: 25 + 30 + 10 + 35 = 100  ✓
 *   carbs:   25 + 30 + 15 + 30 = 100  ✓
 *   fat:     25 + 30 + 10 + 35 = 100  ✓
 */

import {
  DistributionTemplateId,
  MealSlotKind,
  type MealDistribution,
} from "../types";

const standard_4_meal: MealDistribution = {
  id: DistributionTemplateId.STANDARD_4_MEAL,
  label: "Standard 4 Meals",
  description:
    "Breakfast, lunch, afternoon snack, dinner. Snack absorbs ~10–15% of " +
    "daily macros to keep mid-afternoon energy up.",
  meals_per_day: 4,
  day_kind: "any",
  slots: [
    {
      index: 1,
      label: "Breakfast",
      kind: MealSlotKind.BREAKFAST,
      protein_pct: 25,
      carb_pct: 25,
      fat_pct: 25,
    },
    {
      index: 2,
      label: "Lunch",
      kind: MealSlotKind.LUNCH,
      protein_pct: 30,
      carb_pct: 30,
      fat_pct: 30,
    },
    {
      index: 3,
      label: "Snack",
      kind: MealSlotKind.SNACK,
      protein_pct: 10,
      carb_pct: 15,
      fat_pct: 10,
    },
    {
      index: 4,
      label: "Dinner",
      kind: MealSlotKind.DINNER,
      protein_pct: 35,
      carb_pct: 30,
      fat_pct: 35,
    },
  ],
};

export default standard_4_meal;
