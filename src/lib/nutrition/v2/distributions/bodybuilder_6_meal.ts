/**
 * Meal distribution: Bodybuilder 6-meal day.
 *
 * Use case: high-volume bulk / contest-prep style eating with six feedings.
 * Each slot sits near 20g protein; evening slot is lighter to avoid
 * late-night overload.
 *
 * Per-column sum verification (must each equal 100):
 *   protein: 18 + 15 + 20 + 15 + 20 + 12 = 100  ✓
 *   carbs:   20 + 15 + 20 + 15 + 20 + 10 = 100  ✓
 *   fat:     20 + 10 + 20 + 15 + 25 + 10 = 100  ✓
 */

import {
  DistributionTemplateId,
  MealSlotKind,
  type MealDistribution,
} from "../types";

const bodybuilder_6_meal: MealDistribution = {
  id: DistributionTemplateId.BODYBUILDER_6_MEAL,
  label: "Bodybuilder 6 Meals",
  description:
    "Six feedings at ~20g protein each. Classic hypertrophy template; " +
    "evening feeding is lighter to avoid late-night digestion load.",
  meals_per_day: 6,
  day_kind: "any",
  slots: [
    {
      index: 1,
      label: "Breakfast",
      kind: MealSlotKind.BREAKFAST,
      protein_pct: 18,
      carb_pct: 20,
      fat_pct: 20,
    },
    {
      index: 2,
      label: "Mid-Morning",
      kind: MealSlotKind.SNACK,
      protein_pct: 15,
      carb_pct: 15,
      fat_pct: 10,
    },
    {
      index: 3,
      label: "Lunch",
      kind: MealSlotKind.LUNCH,
      protein_pct: 20,
      carb_pct: 20,
      fat_pct: 20,
    },
    {
      index: 4,
      label: "Mid-Afternoon",
      kind: MealSlotKind.SNACK,
      protein_pct: 15,
      carb_pct: 15,
      fat_pct: 15,
    },
    {
      index: 5,
      label: "Dinner",
      kind: MealSlotKind.DINNER,
      protein_pct: 20,
      carb_pct: 20,
      fat_pct: 25,
    },
    {
      index: 6,
      label: "Evening",
      kind: MealSlotKind.SNACK,
      protein_pct: 12,
      carb_pct: 10,
      fat_pct: 10,
    },
  ],
};

export default bodybuilder_6_meal;
