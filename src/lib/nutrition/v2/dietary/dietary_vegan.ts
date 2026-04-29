/**
 * Dietary style: VEGAN.
 *
 * Excludes all animal products: meat, poultry, seafood, eggs, dairy, honey.
 * Plant protein sources become the core of the tier_1 pool.
 */

import { DietaryStyle, type DietaryRule } from "../types";

const dietary_vegan: DietaryRule = {
  kind: "dietary",
  style: DietaryStyle.VEGAN,
  flag: DietaryStyle.VEGAN,
  label: "Vegan",
  description:
    "No animal products. Excludes meat, poultry, seafood, eggs, dairy, " +
    "whey/casein, and honey.",
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
    // Eggs
    "egg_whole_boiled",
    "egg_whole_raw",
    "egg_white_raw",
    "egg_yolk_raw",
    "liquid_egg_whites",
    "egg_noodles_cooked",
    "mayonnaise",
    // Dairy
    "milk_skim",
    "milk_2_percent",
    "milk_whole",
    "half_and_half",
    "heavy_cream",
    "sour_cream",
    "cream_cheese",
    "cheddar_cheese",
    "feta_cheese",
    "goat_cheese",
    "mozzarella_cheese_part_skim",
    "mozzarella_cheese_whole",
    "parmesan_cheese",
    "ricotta_cheese_part_skim",
    "swiss_cheese",
    "greek_yogurt_nonfat_plain",
    "greek_yogurt_2_plain",
    "greek_yogurt_whole_plain",
    "regular_yogurt_plain",
    "skyr_plain",
    "cottage_cheese_full_fat",
    "cottage_cheese_low_fat",
    "butter_salted",
    "butter_unsalted",
    "ghee",
    "whey_protein_concentrate",
    "whey_protein_isolate",
    "casein_protein",
    // Animal-derived condiments
    "honey",
    "pesto", // traditional pesto contains parmesan
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
      reason: "Fattier plant protein.",
    },
    {
      from: "ground_beef_cooked_90",
      to: "lentils_cooked",
      reason: "Hybrid protein+carb; great for chili / tacos.",
    },
    {
      from: "egg_whole_boiled",
      to: "tofu_firm",
      reason: "Scramble with turmeric + kala namak for eggy flavor.",
    },
    {
      from: "greek_yogurt_2_plain",
      to: "tofu_firm",
      reason: "Blended silken/firm tofu is the closest yogurt-texture analog (use firm here).",
    },
    {
      from: "whey_protein_isolate",
      to: "pea_protein_powder",
      reason: "Plant protein powder.",
    },
    {
      from: "whey_protein_concentrate",
      to: "pea_protein_powder",
      reason: "Plant protein powder.",
    },
    {
      from: "milk_2_percent",
      to: "soy_milk_unsweetened",
      reason: "Highest-protein plant milk.",
    },
    {
      from: "milk_whole",
      to: "oat_milk_unsweetened",
      reason: "Creamy texture without soy.",
    },
    {
      from: "butter_unsalted",
      to: "olive_oil",
      reason: "Cooking fat swap.",
    },
    {
      from: "heavy_cream",
      to: "coconut_milk_unsweetened",
      reason: "Creamy base for sauces / smoothies.",
    },
    {
      from: "mayonnaise",
      to: "hummus",
      reason: "Creamy spread swap.",
    },
    {
      from: "honey",
      to: "maple_syrup",
      reason: "Plant-based sweetener swap.",
    },
    {
      from: "pesto",
      to: "marinara_sauce",
      reason: "Vegan pasta sauce alternative.",
    },
  ],
  cautions: [
    // Foods often hidden-animal
    "worcestershire_sauce", // anchovies
    "bbq_sauce",            // some brands contain honey
    "ranch_dressing",       // dairy
    "italian_dressing",     // often contains parmesan
    "marinara_sauce",       // some brands add cheese
    "bagel_plain",          // some bagels use egg wash
    "sourdough_bread",      // some artisan loaves use egg wash
  ],
  generator_prompt_additions: [
    "Client is vegan. Exclude ALL animal products.",
    "Plant protein sources: tofu, tempeh, seitan (unless gluten flag), lentils, black beans, chickpeas, edamame (unless soy flag), pea protein.",
    "Pair incomplete proteins: rice + beans, hummus + whole-grain pita, quinoa + tofu.",
    "Include walnuts / chia / flax daily for omega-3 (ALA).",
    "B12, iodine, iron monitoring recommended — supplement notes for coach.",
    "Replace honey with maple syrup; replace pesto with marinara.",
    "Check worcestershire (anchovies), ranch (dairy), italian dressing (parmesan) for hidden animal products.",
  ],
};

export default dietary_vegan;
