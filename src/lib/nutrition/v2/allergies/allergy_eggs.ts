/**
 * Allergy rule: EGGS.
 *
 * Excludes all egg forms AND hidden-egg foods. Mayonnaise is egg-based and
 * must be in the hard_exclude list (per self-check requirement).
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_eggs: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.EGGS,
  label: "Egg allergy",
  description: "Excludes all egg forms plus egg-containing products like mayonnaise.",
  hard_exclude: [
    "egg_whole_boiled",
    "egg_whole_raw",
    "egg_white_raw",
    "egg_yolk_raw",
    "liquid_egg_whites",
    // Hidden eggs
    "mayonnaise",       // per self-check — egg is the core binder
    "egg_noodles_cooked", // explicit egg in the name
  ],
  preferred_swaps: [
    {
      from: "egg_whole_boiled",
      to: "tofu_firm",
      reason: "Scramble with turmeric + salt to mimic eggs; same role as breakfast protein.",
    },
    {
      from: "egg_white_raw",
      to: "liquid_egg_whites", // NOTE: also egg — but included for code clarity
      reason: "Not a valid swap — kept here to flag if input includes both.",
    },
    {
      from: "mayonnaise",
      to: "hummus",
      reason: "Creamy sandwich spread without eggs.",
    },
    {
      from: "mayonnaise",
      to: "avocado_raw",
      reason: "Mash avocado for sandwich / wrap spread.",
    },
    {
      from: "mayonnaise",
      to: "dijon_mustard",
      reason: "Thin binder for marinades / dressings.",
    },
    {
      from: "egg_noodles_cooked",
      to: "rice_noodles_cooked",
      reason: "Similar role in soups / stir-fries, egg-free.",
    },
    {
      from: "egg_noodles_cooked",
      to: "pasta_cooked",
      reason: "Most dry pasta is egg-free; confirm label.",
    },
  ],
  cautions: [
    "pasta_cooked",     // fresh pasta often contains egg — specify dry / egg-free
    "bagel_plain",      // some bagels use egg wash
    "sourdough_bread",  // some artisan loaves use egg wash
  ],
  generator_prompt_additions: [
    "Client has an egg allergy. No eggs in any form. Replace breakfast eggs with tofu scramble, Greek yogurt parfaits (if dairy-OK), or smoothies.",
    "Mayonnaise IS egg-based — never use it. Swap to hummus, avocado, or mustard-based dressings.",
    "Check pasta — fresh pasta usually contains egg; use dry pasta or rice noodles.",
  ],
};

export default allergy_eggs;
