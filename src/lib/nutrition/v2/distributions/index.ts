/**
 * Barrel export for all 7 meal distribution templates.
 */

import { DistributionTemplateId, type MealDistribution } from "../types";

import standard_3_meal from "./standard_3_meal";
import lunch_centered_3_meal from "./lunch_centered_3_meal";
import standard_4_meal from "./standard_4_meal";
import athlete_5_meal from "./athlete_5_meal";
import bodybuilder_6_meal from "./bodybuilder_6_meal";
import endurance_5_meal_training_day from "./endurance_5_meal_training_day";
import endurance_3_meal_rest_day from "./endurance_3_meal_rest_day";

export const ALL_DISTRIBUTIONS: Record<DistributionTemplateId, MealDistribution> = {
  [DistributionTemplateId.STANDARD_3_MEAL]: standard_3_meal,
  [DistributionTemplateId.LUNCH_CENTERED_3_MEAL]: lunch_centered_3_meal,
  [DistributionTemplateId.STANDARD_4_MEAL]: standard_4_meal,
  [DistributionTemplateId.ATHLETE_5_MEAL]: athlete_5_meal,
  [DistributionTemplateId.BODYBUILDER_6_MEAL]: bodybuilder_6_meal,
  [DistributionTemplateId.ENDURANCE_5_MEAL_TRAINING_DAY]: endurance_5_meal_training_day,
  [DistributionTemplateId.ENDURANCE_3_MEAL_REST_DAY]: endurance_3_meal_rest_day,
};

export function getDistribution(id: DistributionTemplateId): MealDistribution {
  return ALL_DISTRIBUTIONS[id];
}
