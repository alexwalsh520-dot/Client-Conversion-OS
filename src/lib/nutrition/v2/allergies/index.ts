/**
 * Barrel export for all 10 allergies + 1 intolerance (lactose).
 *
 * intolerance_lactose is included here (rather than in medical/) because
 * it sits alongside allergies in the UI as an independent checkbox.
 */

import { AllergyFlag, type AllergyRule } from "../types";

import allergy_dairy from "./allergy_dairy";
import allergy_eggs from "./allergy_eggs";
import allergy_fish from "./allergy_fish";
import allergy_gluten from "./allergy_gluten";
import allergy_peanuts from "./allergy_peanuts";
import allergy_sesame from "./allergy_sesame";
import allergy_shellfish from "./allergy_shellfish";
import allergy_soy from "./allergy_soy";
import allergy_sulfites from "./allergy_sulfites";
import allergy_tree_nuts from "./allergy_tree_nuts";
import intolerance_lactose from "./intolerance_lactose";

export const ALL_ALLERGY_RULES: Record<AllergyFlag, AllergyRule> = {
  [AllergyFlag.DAIRY]: allergy_dairy,
  [AllergyFlag.EGGS]: allergy_eggs,
  [AllergyFlag.FISH]: allergy_fish,
  [AllergyFlag.GLUTEN]: allergy_gluten,
  [AllergyFlag.PEANUTS]: allergy_peanuts,
  [AllergyFlag.SESAME]: allergy_sesame,
  [AllergyFlag.SHELLFISH]: allergy_shellfish,
  [AllergyFlag.SOY]: allergy_soy,
  [AllergyFlag.SULFITES]: allergy_sulfites,
  [AllergyFlag.TREE_NUTS]: allergy_tree_nuts,
  [AllergyFlag.INTOLERANCE_LACTOSE]: intolerance_lactose,
};

export function getAllergyRule(flag: AllergyFlag): AllergyRule {
  return ALL_ALLERGY_RULES[flag];
}
