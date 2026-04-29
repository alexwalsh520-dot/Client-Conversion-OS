/**
 * Allergy rule: GLUTEN (includes celiac and wheat allergy).
 *
 * Excludes wheat, barley, rye, and seitan (pure gluten). Oats are in the
 * "cautions" category because cross-contamination is common; flag to coach
 * to recommend certified GF oats.
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_gluten: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.GLUTEN,
  label: "Gluten intolerance / celiac / wheat allergy",
  description:
    "Excludes wheat, barley, seitan. Oats are flagged as a caution due to " +
    "cross-contamination risk — use certified gluten-free oats only.",
  hard_exclude: [
    // Wheat breads
    "bagel_plain",
    "english_muffin_whole_wheat",
    "naan",
    "pita_whole_wheat",
    "sourdough_bread",
    "tortilla_flour",
    "white_bread",
    "whole_wheat_bread",
    // Wheat pasta
    "pasta_cooked",
    "whole_wheat_pasta_cooked",
    "egg_noodles_cooked",  // typically wheat-based
    "couscous_cooked",      // wheat
    // Barley (gluten grain)
    "barley_cooked",
    // Pure gluten
    "seitan",
  ],
  preferred_swaps: [
    {
      from: "pasta_cooked",
      to: "rice_noodles_cooked",
      reason: "Gluten-free noodle swap.",
    },
    {
      from: "whole_wheat_pasta_cooked",
      to: "rice_noodles_cooked",
      reason: "Gluten-free noodle swap.",
    },
    {
      from: "whole_wheat_bread",
      to: "tortilla_corn",
      reason: "Corn tortilla is naturally gluten-free.",
    },
    {
      from: "whole_wheat_bread",
      to: "potato_red_boiled",
      reason: "Whole-food carb swap with no gluten.",
    },
    {
      from: "bagel_plain",
      to: "oatmeal_cooked_water",
      reason: "Breakfast carb swap (use certified GF oats).",
    },
    {
      from: "couscous_cooked",
      to: "quinoa_cooked",
      reason: "Similar texture, naturally gluten-free.",
    },
    {
      from: "barley_cooked",
      to: "brown_rice_cooked",
      reason: "Whole-grain swap.",
    },
    {
      from: "seitan",
      to: "tofu_extra_firm",
      reason: "Plant protein swap; no gluten.",
    },
  ],
  cautions: [
    "oats_rolled_dry",       // cross-contamination risk — use certified GF
    "oats_steel_cut_dry",
    "oatmeal_cooked_water",
    "worcestershire_sauce",  // malt vinegar base, often contains gluten
    "soy_sauce",             // wheat-based — swap to coconut_aminos
    "soy_sauce_low_sodium",
    "bbq_sauce",             // some contain malt / wheat
  ],
  generator_prompt_additions: [
    "Client has gluten intolerance / celiac / wheat allergy. Exclude wheat, barley, seitan entirely.",
    "Oats must be certified gluten-free — call that out in the coach note.",
    "Soy sauce contains wheat — swap to coconut_aminos.",
    "Check worcestershire / BBQ sauce labels for hidden gluten.",
  ],
};

export default allergy_gluten;
