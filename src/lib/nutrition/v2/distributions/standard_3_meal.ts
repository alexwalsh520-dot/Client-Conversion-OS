/**
 * Meal distribution: Standard 3-meal day.
 *
 * Use case: default template for most general-population clients. Three
 * balanced meals, no snacks. Suitable for Recomp, Maintain, Bulk, Lean Gain,
 * and Shred at lower kcal targets where snacking is not needed.
 *
 * Per-column sum verification (must each equal 100):
 *   protein: 25 + 35 + 40 = 100  ✓
 *   carbs:   25 + 35 + 40 = 100  ✓
 *   fat:     20 + 35 + 45 = 100  ✓
 */

import {
  DistributionTemplateId,
  MealSlotKind,
  type MealDistribution,
} from "../types";

const standard_3_meal: MealDistribution = {
  id: DistributionTemplateId.STANDARD_3_MEAL,
  label: "Standard 3 Meals",
  description:
    "Breakfast, lunch, dinner. Balanced across the day with dinner slightly " +
    "protein- and fat-heavier to support satiety overnight.",
  meals_per_day: 3,
  day_kind: "any",
  slots: [
    {
      index: 1,
      label: "Breakfast",
      kind: MealSlotKind.BREAKFAST,
      protein_pct: 25,
      carb_pct: 25,
      fat_pct: 20,
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
      carb_pct: 40,
      fat_pct: 45,
    },
  ],
};

export default standard_3_meal;
