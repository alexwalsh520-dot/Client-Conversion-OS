/**
 * Allergy rule: SESAME.
 *
 * Excludes sesame seeds, sesame oil, tahini, and hummus (traditionally
 * contains tahini).
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_sesame: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.SESAME,
  label: "Sesame allergy",
  description:
    "Excludes sesame seeds, sesame oil, tahini, and hummus (contains tahini).",
  hard_exclude: [
    "sesame_oil",
    "sesame_seeds",
    "tahini",
    "hummus", // traditional hummus contains tahini
  ],
  preferred_swaps: [
    {
      from: "sesame_oil",
      to: "avocado_oil",
      reason: "High smoke-point oil swap.",
    },
    {
      from: "sesame_oil",
      to: "olive_oil",
      reason: "Standard oil swap for dressings / low-heat cooking.",
    },
    {
      from: "tahini",
      to: "almond_butter",
      reason: "Similar creamy nut/seed paste role (check tree-nut allergy).",
    },
    {
      from: "tahini",
      to: "cashew_butter",
      reason: "Creamy dressing base (check tree-nut allergy).",
    },
    {
      from: "tahini",
      to: "sunflower_seeds",
      reason: "Blend sunflower seeds with olive oil + lemon for a tahini-like dressing.",
    },
    {
      from: "hummus",
      to: "guacamole",
      reason: "Creamy dip swap.",
    },
    {
      from: "hummus",
      to: "chickpeas_cooked",
      reason: "Use chickpeas without tahini, blended with olive oil + lemon.",
    },
    {
      from: "sesame_seeds",
      to: "pumpkin_seeds",
      reason: "Seed topping swap.",
    },
  ],
  cautions: [
    "bagel_plain", // some bagels have sesame topping
    "white_bread", // some breads have sesame seeds
  ],
  generator_prompt_additions: [
    "Client has a sesame allergy. Exclude sesame oil, seeds, tahini, and hummus (contains tahini).",
    "Check bagel / bread toppings — request plain-top versions.",
    "Asian cuisines often use sesame oil — swap to avocado or olive.",
  ],
};

export default allergy_sesame;
