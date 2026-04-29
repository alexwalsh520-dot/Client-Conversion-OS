/**
 * Allergy rule: SOY.
 *
 * Excludes all soybean-based foods. CRITICAL: `coconut_aminos` is the
 * soy-free SWAP for soy sauce — it must NEVER appear in the hard_exclude
 * list (per self-check requirement).
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_soy: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.SOY,
  label: "Soy allergy",
  description:
    "Excludes all soy-based foods and soy sauce. coconut_aminos is the " +
    "preferred soy-sauce replacement (soy-free by definition).",
  hard_exclude: [
    "edamame_cooked",
    "soy_milk_unsweetened",
    "soy_sauce",
    "soy_sauce_low_sodium",
    "tempeh",
    "tofu_extra_firm",
    "tofu_firm",
    // NOTE: coconut_aminos is NOT here — it is the SWAP target.
  ],
  preferred_swaps: [
    {
      from: "soy_sauce",
      to: "coconut_aminos", // THE canonical soy-free swap
      reason: "Soy-free, fermented coconut sap — similar umami profile.",
    },
    {
      from: "soy_sauce_low_sodium",
      to: "coconut_aminos",
      reason: "Soy-free, naturally lower sodium than soy sauce.",
    },
    {
      from: "tofu_firm",
      to: "chicken_breast_cooked_skinless",
      reason: "Animal protein swap for stir-fries / bowls.",
    },
    {
      from: "tempeh",
      to: "chicken_breast_cooked_skinless",
      reason: "Protein role replacement.",
    },
    {
      from: "edamame_cooked",
      to: "green_peas_cooked",
      reason: "Legume swap with similar protein profile.",
    },
    {
      from: "edamame_cooked",
      to: "chickpeas_cooked",
      reason: "Legume swap — soy-free.",
    },
    {
      from: "soy_milk_unsweetened",
      to: "almond_milk_unsweetened",
      reason: "Plant milk swap (check tree-nut allergy).",
    },
    {
      from: "soy_milk_unsweetened",
      to: "oat_milk_unsweetened",
      reason: "Plant milk swap — nut-free.",
    },
  ],
  cautions: [
    "worcestershire_sauce", // some brands contain soy
    "bbq_sauce",            // often contains soy
    "italian_dressing",     // check label
  ],
  generator_prompt_additions: [
    "Client has a soy allergy. Exclude tofu, tempeh, edamame, soy milk, soy sauce.",
    "coconut_aminos IS the canonical soy-sauce replacement — use it freely; it is soy-FREE by definition.",
    "Check BBQ / worcestershire / dressings for hidden soy.",
  ],
};

export default allergy_soy;
