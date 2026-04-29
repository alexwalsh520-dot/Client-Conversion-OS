/**
 * Medical rule: HIGH BLOOD PRESSURE (HBP / hypertension).
 *
 * Primary effect: sodium cap dropped to 1800 mg/day (vs default 2300).
 * Most restrictions come from Na reduction — avoid cured meats, salted
 * snacks, and condiment bombs.
 */

import { BuildType, MedicalFlag, type MedicalRule } from "../types";

const medical_hbp: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.HBP,
  label: "High blood pressure",
  description:
    "Hypertension. Reduces sodium cap to 1800 mg/day and pushes the plan " +
    "toward DASH-style eating (fruits, vegetables, lean protein, whole grains).",
  hard_exclude: [],
  preferred_swaps: [
    {
      from: "soy_sauce",
      to: "soy_sauce_low_sodium",
      reason: "~60% less sodium per tbsp.",
    },
    {
      from: "soy_sauce_low_sodium",
      to: "coconut_aminos",
      reason: "Lowest-sodium umami option.",
    },
    {
      from: "butter_salted",
      to: "butter_unsalted",
      reason: "No added sodium.",
    },
    {
      from: "pickles_dill",
      to: "cucumber_raw",
      reason: "Fresh cucumber swap for salads/snacks.",
    },
    {
      from: "beef_jerky",
      to: "chicken_breast_cooked_skinless",
      reason: "Fresh lean protein vs cured.",
    },
    {
      from: "bacon_cooked",
      to: "chicken_breast_cooked_skinless",
      reason: "Lean protein swap.",
    },
    {
      from: "ham_cooked",
      to: "turkey_breast_cooked_skinless",
      reason: "Lean, lower-sodium protein.",
    },
    {
      from: "ketchup",
      to: "salsa",
      reason: "Salsa has much less Na per tbsp than ketchup.",
    },
    {
      from: "bbq_sauce",
      to: "salsa",
      reason: "Low-Na flavor alternative.",
    },
  ],
  cautions: [
    "bacon_cooked",
    "beef_jerky",
    "ham_cooked",
    "italian_sausage_cooked",
    "bbq_sauce",
    "ketchup",
    "ranch_dressing",
    "italian_dressing",
    "pickles_dill",
    "sauerkraut",
    "kimchi",
    "feta_cheese",
    "parmesan_cheese",
    "cheddar_cheese",
    "sardines_canned_oil",
    "tuna_canned_water",
    "worcestershire_sauce",
  ],
  block_generation_unless_acknowledged: false,
  sodium_cap_mg: 1800, // takes precedence over default 2300
  generator_prompt_additions: [
    "Client has high blood pressure. Hard sodium cap: 1800 mg/day.",
    "Actively avoid cured / processed meats, high-Na sauces, and salty snacks.",
    "Prefer coconut_aminos over soy sauce; unsalted butter; fresh cucumber over pickles.",
    "Bias toward DASH: vegetables every meal, potassium-rich (banana, leafy greens, sweet potato).",
  ],
};

export default medical_hbp;
