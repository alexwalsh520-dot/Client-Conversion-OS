/**
 * Medical rule: TYPE 2 DIABETES.
 *
 * Low-GI emphasis, carb distribution across meals, exclude isolated sugars.
 * The macro split adjustment (carbs→35% / fat→40%) is handled in the
 * extended calculateMacros() function (Q1), not here. This rule handles
 * ingredient-level restrictions and swaps.
 */

import { MedicalFlag, type MedicalRule } from "../types";

const medical_diabetes_t2: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.DIABETES_T2,
  label: "Type 2 diabetes",
  description:
    "Excludes isolated sugars and steers carbs toward low-GI / high-fiber " +
    "whole foods. Macro split is adjusted upstream by calculateMacros().",
  hard_exclude: [
    "white_sugar",
    "brown_sugar",
    "agave_syrup",
    "apple_juice",   // glycemic shock
    "orange_juice",  // same
  ],
  preferred_swaps: [
    {
      from: "white_rice_cooked",
      to: "brown_rice_cooked",
      reason: "Lower GI, more fiber.",
    },
    {
      from: "jasmine_rice_cooked",
      to: "quinoa_cooked",
      reason: "Lower GI, complete protein bonus.",
    },
    {
      from: "basmati_rice_cooked",
      to: "quinoa_cooked",
      reason: "Lower GI.",
    },
    {
      from: "pasta_cooked",
      to: "whole_wheat_pasta_cooked",
      reason: "Higher fiber, lower glycemic response.",
    },
    {
      from: "white_bread",
      to: "whole_wheat_bread",
      reason: "More fiber.",
    },
    {
      from: "bagel_plain",
      to: "english_muffin_whole_wheat",
      reason: "Lower carb load per serving.",
    },
    {
      from: "potato_mashed",
      to: "sweet_potato_baked",
      reason: "Lower GI and higher fiber.",
    },
    {
      from: "potato_russet_baked",
      to: "sweet_potato_baked",
      reason: "Lower GI.",
    },
    {
      from: "honey",
      to: "cocoa_powder_unsweetened",
      reason: "Sweet-flavor profile without sugar spike.",
    },
    {
      from: "maple_syrup",
      to: "cinnamon", // not in DB — keep as coach note
      reason: "Flavor swap (coach-suggested; not a DB ingredient).",
    },
    {
      from: "banana_raw",
      to: "strawberries_raw",
      reason: "Lower-carb berry swap when carb budget is tight.",
    },
    {
      from: "dates_medjool",
      to: "blueberries_raw",
      reason: "Dates are glycemic; fresh berries are the low-GI alternative.",
    },
    {
      from: "apple_juice",
      to: "apple_raw",
      reason: "Whole fruit has fiber + slower glucose rise.",
    },
    {
      from: "orange_juice",
      to: "orange_raw",
      reason: "Whole fruit has fiber + slower glucose rise.",
    },
  ],
  cautions: [
    "raisins",
    "dates_medjool",
    "dried_cranberries",
    "figs_dried",
    "prunes_dried",
    "grapes_raw",
    "mango_raw",
    "pineapple_raw",
    "watermelon_raw",
    "coconut_water",
    "bbq_sauce",
    "ketchup",
    "marinara_sauce", // many brands add sugar
  ],
  block_generation_unless_acknowledged: false,
  generator_prompt_additions: [
    "Client has Type 2 diabetes. Exclude isolated sugars (white/brown sugar, agave, fruit juice).",
    "Prefer whole grains, whole fruits, high-fiber carbs.",
    "Pair carbs with protein + fat at every meal to blunt glucose rise.",
    "Dried fruit is a glycemic bomb — swap to fresh berries where possible.",
  ],
};

export default medical_diabetes_t2;
