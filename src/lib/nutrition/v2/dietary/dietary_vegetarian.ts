/**
 * Dietary style: VEGETARIAN (lacto-ovo).
 *
 * Excludes all meat, poultry, and seafood. Eggs and dairy are allowed.
 */

import { DietaryStyle, type DietaryRule } from "../types";

const dietary_vegetarian: DietaryRule = {
  kind: "dietary",
  style: DietaryStyle.VEGETARIAN,
  flag: DietaryStyle.VEGETARIAN,
  label: "Vegetarian (lacto-ovo)",
  description:
    "No meat, poultry, or seafood. Eggs and dairy are allowed.",
  hard_exclude: [
    // Beef
    "beef_brisket_cooked",
    "beef_chuck_cooked",
    "beef_flank_cooked",
    "beef_jerky",
    "beef_liver_cooked",
    "beef_ribeye_cooked",
    "beef_sirloin_cooked",
    "beef_tenderloin_cooked",
    "ground_beef_cooked_80",
    "ground_beef_cooked_90",
    // Lamb
    "ground_lamb_cooked",
    "lamb_chop_cooked",
    // Pork
    "bacon_cooked",
    "ground_pork_cooked",
    "ham_cooked",
    "italian_sausage_cooked",
    "pork_loin_cooked",
    "pork_shoulder_cooked",
    "pork_tenderloin_cooked",
    // Poultry
    "chicken_breast_cooked_skinless",
    "chicken_drumstick_cooked_skinless",
    "chicken_thigh_cooked_skinless",
    "chicken_wing_cooked",
    "ground_chicken_cooked",
    "ground_turkey_cooked_93",
    "turkey_breast_cooked_skinless",
    "turkey_thigh_cooked",
    "duck_breast_cooked",
    // Seafood
    "cod_cooked",
    "crab_cooked",
    "halibut_cooked",
    "lobster_cooked",
    "mahi_mahi_cooked",
    "mussels_cooked",
    "salmon_atlantic_cooked",
    "salmon_sockeye_cooked",
    "sardines_canned_oil",
    "scallops_cooked",
    "shrimp_cooked",
    "tilapia_cooked",
    "trout_rainbow_cooked",
    "tuna_canned_water",
    "tuna_yellowfin_cooked",
  ],
  preferred_swaps: [
    {
      from: "chicken_breast_cooked_skinless",
      to: "tofu_extra_firm",
      reason: "Lean plant protein.",
    },
    {
      from: "chicken_thigh_cooked_skinless",
      to: "tempeh",
      reason: "Higher-fat plant protein analog.",
    },
    {
      from: "ground_beef_cooked_90",
      to: "lentils_cooked",
      reason: "Ground meat analog for chili / bolognese (hybrid protein+carb).",
    },
    {
      from: "ground_turkey_cooked_93",
      to: "tempeh",
      reason: "Similar crumble texture.",
    },
    {
      from: "salmon_atlantic_cooked",
      to: "walnuts_raw",
      reason: "Plant omega-3 (ALA) source; also add chia/flax for coverage.",
    },
    {
      from: "tuna_canned_water",
      to: "chickpeas_cooked",
      reason: "Chickpea salad is a classic tuna-salad swap.",
    },
  ],
  cautions: [],
  generator_prompt_additions: [
    "Client is lacto-ovo vegetarian. Exclude all meat, poultry, and seafood.",
    "Eggs, dairy, whey / casein / pea / soy protein powders all OK (unless other flags set).",
    "Plan at least 2 complete-protein slots per day (egg + dairy combos, or soy-based).",
    "Include walnuts, chia, flax for plant omega-3 coverage.",
    "B12 supplementation recommended (not a food swap, a coach note).",
  ],
};

export default dietary_vegetarian;
