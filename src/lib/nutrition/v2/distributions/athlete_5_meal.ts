/**
 * Meal distribution: Athlete 5-meal day.
 *
 * Use case: higher-volume training days for strength / hypertrophy clients.
 * Two snack slots spread macros more evenly — supports more frequent protein
 * feeding (~20–35g protein per slot) and better gym energy.
 *
 * Per-column sum verification (must each equal 100):
 *   protein: 20 + 15 + 25 + 15 + 25 = 100  ✓
 *   carbs:   20 + 15 + 30 + 15 + 20 = 100  ✓
 *   fat:     20 + 10 + 25 + 15 + 30 = 100  ✓
 */

import {
  DistributionTemplateId,
  MealSlotKind,
  type MealDistribution,
} from "../types";

const athlete_5_meal: MealDistribution = {
  id: DistributionTemplateId.ATHLETE_5_MEAL,
  label: "Athlete 5 Meals",
  description:
    "Breakfast, mid-morning snack, lunch, afternoon snack, dinner. Five " +
    "evenly-distributed feedings for high-volume training / recovery.",
  meals_per_day: 5,
  day_kind: "any",
  slots: [
    {
      index: 1,
      label: "Breakfast",
      kind: MealSlotKind.BREAKFAST,
      protein_pct: 20,
      carb_pct: 20,
      fat_pct: 20,
    },
    {
      index: 2,
      label: "Mid-Morning Snack",
      kind: MealSlotKind.SNACK,
      protein_pct: 15,
      carb_pct: 15,
      fat_pct: 10,
    },
    {
      index: 3,
      label: "Lunch",
      kind: MealSlotKind.LUNCH,
      protein_pct: 25,
      carb_pct: 30,
      fat_pct: 25,
    },
    {
      index: 4,
      label: "Afternoon Snack",
      kind: MealSlotKind.SNACK,
      protein_pct: 15,
      carb_pct: 15,
      fat_pct: 15,
    },
    {
      index: 5,
      label: "Dinner",
      kind: MealSlotKind.DINNER,
      protein_pct: 25,
      carb_pct: 20,
      fat_pct: 30,
    },
  ],
};

export default athlete_5_meal;
