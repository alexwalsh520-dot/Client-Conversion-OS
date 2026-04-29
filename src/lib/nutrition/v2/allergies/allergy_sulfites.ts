/**
 * Allergy rule: SULFITES.
 *
 * Sulfites preserve dried fruits, pickled items, and some vinegars. Most
 * clients report symptoms (asthma, headaches) rather than true IgE allergy.
 * Hard-exclude the obvious offenders; flag common-but-variable items.
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_sulfites: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.SULFITES,
  label: "Sulfite sensitivity",
  description:
    "Sulfites are preservatives found in dried fruits, pickled foods, and " +
    "some vinegars. Symptoms range from mild (headache) to severe (asthma).",
  hard_exclude: [
    "dried_cranberries", // nearly always sulfited
    "raisins",           // commonly sulfited (look for unsulfured)
    "prunes_dried",      // commonly sulfited
    "figs_dried",
    "dates_medjool",     // can be sulfited; err on the side of exclusion
  ],
  preferred_swaps: [
    {
      from: "raisins",
      to: "blueberries_raw",
      reason: "Fresh fruit swap — sulfite-free.",
    },
    {
      from: "raisins",
      to: "grapes_raw",
      reason: "Fresh-fruit form of raisins.",
    },
    {
      from: "dried_cranberries",
      to: "cherries_raw",
      reason: "Fresh tart-fruit swap.",
    },
    {
      from: "prunes_dried",
      to: "plum_raw",
      reason: "Fresh plum is the unsulfited form.",
    },
    {
      from: "dates_medjool",
      to: "banana_raw",
      reason: "Natural sweetness + quick carbs without sulfites.",
    },
    {
      from: "balsamic_vinegar",
      to: "apple_cider_vinegar",
      reason: "Typically sulfite-free; check label.",
    },
  ],
  cautions: [
    "balsamic_vinegar",    // often contains sulfites
    "rice_vinegar",        // variable
    "pickles_dill",        // often contain sulfites
    "sauerkraut",          // check label
  ],
  generator_prompt_additions: [
    "Client has sulfite sensitivity. Exclude dried fruits unless labeled 'no sulfur / unsulfured'.",
    "Flag balsamic vinegar and pickled items — swap to apple cider vinegar where possible.",
    "Prefer fresh fruit over dried.",
  ],
};

export default allergy_sulfites;
