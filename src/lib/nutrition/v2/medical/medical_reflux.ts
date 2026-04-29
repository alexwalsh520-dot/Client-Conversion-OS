/**
 * Medical rule: ACID REFLUX / GERD.
 *
 * Excludes common trigger foods: acidic (tomato, citrus), spicy, high-fat,
 * caffeinated, chocolate.
 */

import { MedicalFlag, type MedicalRule } from "../types";

const medical_reflux: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.REFLUX,
  label: "Acid reflux / GERD",
  description:
    "Excludes common reflux triggers: acidic foods, spicy, caffeinated, " +
    "chocolate, and high-fat meals that delay gastric emptying.",
  hard_exclude: [
    // Citrus (acid)
    "lemon_raw",
    "lime_raw",
    "orange_raw",
    "grapefruit_raw",
    "orange_juice",
    // Tomato (acid)
    "tomato_roma_raw",
    "cherry_tomatoes",
    "marinara_sauce",
    "salsa",      // tomato + often spicy
    "ketchup",
    // Spicy
    "jalapeno_raw",
    "hot_sauce",
    // Chocolate / caffeine concentrators
    "chocolate_dark_70",
    "cocoa_powder_unsweetened",
    // Vinegars (acid)
    "apple_cider_vinegar",
    "balsamic_vinegar",
    "rice_vinegar",
  ],
  preferred_swaps: [
    {
      from: "orange_raw",
      to: "banana_raw",
      reason: "Alkaline fruit; gentle on reflux.",
    },
    {
      from: "orange_juice",
      to: "apple_juice",
      reason: "Lower-acid juice (though still limit volume).",
    },
    {
      from: "tomato_roma_raw",
      to: "cucumber_raw",
      reason: "Alkaline salad base.",
    },
    {
      from: "marinara_sauce",
      to: "pesto", // non-tomato pasta sauce (check nut allergies)
      reason: "Tomato-free pasta sauce.",
    },
    {
      from: "salsa",
      to: "guacamole",
      reason: "Avocado-based dip, no tomato / spice.",
    },
    {
      from: "chocolate_dark_70",
      to: "blueberries_raw",
      reason: "Low-acid sweet fix.",
    },
    {
      from: "coffee_brewed",
      to: "green_tea_brewed",
      reason: "Less acidic than coffee; still monitor caffeine.",
    },
  ],
  cautions: [
    "coffee_brewed",
    "black_tea_brewed",
    "green_tea_brewed",
    "bbq_sauce",      // tomato-based
    "italian_dressing", // acid + oil
    "ranch_dressing",
    "peppermint tea", // not in DB but classic trigger
    "bacon_cooked",
    "italian_sausage_cooked",
    "ground_beef_cooked_80", // high-fat
    "heavy_cream",
    // Citrus-y fruits that are still sometimes OK
    "pineapple_raw",
  ],
  block_generation_unless_acknowledged: false,
  generator_prompt_additions: [
    "Client has acid reflux / GERD. Exclude citrus, tomato products, spicy, chocolate, cocoa, vinegars.",
    "Cap caffeine; prefer green tea over coffee.",
    "Avoid large meals late in the evening — last meal at least 3hrs before bed.",
    "Avoid very high-fat single meals; fat delays gastric emptying and worsens reflux.",
  ],
};

export default medical_reflux;
