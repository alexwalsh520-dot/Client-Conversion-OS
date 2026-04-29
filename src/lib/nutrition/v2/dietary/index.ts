/**
 * Barrel export for all 4 dietary style rules.
 */

import { DietaryStyle, type DietaryRule } from "../types";

import dietary_omnivore from "./dietary_omnivore";
import dietary_pescatarian from "./dietary_pescatarian";
import dietary_vegetarian from "./dietary_vegetarian";
import dietary_vegan from "./dietary_vegan";

export const ALL_DIETARY_RULES: Record<DietaryStyle, DietaryRule> = {
  [DietaryStyle.OMNIVORE]: dietary_omnivore,
  [DietaryStyle.PESCATARIAN]: dietary_pescatarian,
  [DietaryStyle.VEGETARIAN]: dietary_vegetarian,
  [DietaryStyle.VEGAN]: dietary_vegan,
};

export function getDietaryRule(style: DietaryStyle): DietaryRule {
  return ALL_DIETARY_RULES[style];
}
