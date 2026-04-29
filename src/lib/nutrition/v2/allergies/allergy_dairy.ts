/**
 * Allergy rule: DAIRY (true milk-protein allergy — IgE-mediated).
 *
 * Excludes ALL dairy regardless of lactose content, including whey & casein
 * protein powders. This is distinct from `intolerance_lactose`, which allows
 * aged cheese / butter / whey isolate.
 *
 * Per self-check: dairy is split into TWO separate flags:
 *   - allergy_dairy (this file) — true milk-protein allergy
 *   - intolerance_lactose      — lactose intolerance only
 * Independent checkboxes in the UI; a client can set one, both, or neither.
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_dairy: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.DAIRY,
  label: "Dairy allergy (milk protein)",
  description:
    "True IgE-mediated milk-protein allergy. Excludes all dairy including " +
    "whey and casein protein powders.",
  hard_exclude: [
    // Liquid dairy
    "milk_skim",
    "milk_2_percent",
    "milk_whole",
    "half_and_half",
    "heavy_cream",
    "sour_cream",
    "cream_cheese",
    // Cheeses
    "cheddar_cheese",
    "feta_cheese",
    "goat_cheese",
    "mozzarella_cheese_part_skim",
    "mozzarella_cheese_whole",
    "parmesan_cheese",
    "ricotta_cheese_part_skim",
    "swiss_cheese",
    // Yogurts
    "greek_yogurt_nonfat_plain",
    "greek_yogurt_2_plain",
    "greek_yogurt_whole_plain",
    "regular_yogurt_plain",
    "skyr_plain",
    // Cottage cheese
    "cottage_cheese_full_fat",
    "cottage_cheese_low_fat",
    // Butters / fats
    "butter_salted",
    "butter_unsalted",
    "ghee",
    // Protein powders
    "whey_protein_concentrate",
    "whey_protein_isolate",
    "casein_protein",
  ],
  preferred_swaps: [
    {
      from: "milk_whole",
      to: "almond_milk_unsweetened",
      reason: "Non-dairy, similar consistency for coffee / cereal.",
    },
    {
      from: "milk_2_percent",
      to: "soy_milk_unsweetened",
      reason: "Closest protein-per-cup match among plant milks.",
    },
    {
      from: "greek_yogurt_2_plain",
      to: "tofu_firm",
      reason: "Tofu-based protein swap for breakfast / snacks.",
    },
    {
      from: "whey_protein_isolate",
      to: "pea_protein_powder",
      reason: "Plant-based protein supplement.",
    },
    {
      from: "whey_protein_concentrate",
      to: "pea_protein_powder",
      reason: "Plant-based protein supplement.",
    },
    {
      from: "cottage_cheese_low_fat",
      to: "tofu_firm",
      reason: "Similar protein role; pair with salsa or herbs.",
    },
    {
      from: "cheddar_cheese",
      to: "nutritional_yeast",
      reason: "Cheese-like flavor without dairy protein.",
    },
    {
      from: "butter_unsalted",
      to: "olive_oil",
      reason: "Cooking fat swap.",
    },
    {
      from: "heavy_cream",
      to: "coconut_milk_unsweetened",
      reason: "Creamy texture for sauces / smoothies.",
    },
  ],
  cautions: [
    // Remind coach to verify these are truly dairy-free
    "pesto",               // most commercial pesto contains parmesan
    "ranch_dressing",      // buttermilk + sour cream
    "italian_dressing",    // often contains parmesan
    "marinara_sauce",      // check for added cream / cheese
    "potato_mashed",       // typical recipes include butter + milk
  ],
  generator_prompt_additions: [
    "Client has a TRUE dairy allergy (milk protein). Do not use ANY dairy, including whey / casein powders.",
    "Use plant protein powders (pea, soy if not also allergic) and plant milks (almond, soy, oat, coconut).",
    "Watch for hidden dairy in sauces: pesto, ranch, italian dressing, marinara all commonly contain dairy.",
  ],
};

export default allergy_dairy;
