/**
 * Medical rule: GOUT (hyperuricemia).
 *
 * Limits high-purine foods. Organ meat and certain seafood are the worst
 * offenders; beer is the worst beverage (not in DB). Moderate red meat.
 */

import { MedicalFlag, type MedicalRule } from "../types";

const medical_gout: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.GOUT,
  label: "Gout",
  description:
    "Elevated uric acid / gout. Excludes very-high-purine foods (organ " +
    "meat, some seafood) and caps moderate-purine proteins.",
  hard_exclude: [
    "beef_liver_cooked", // highest purine
    "sardines_canned_oil",
    "mussels_cooked",
  ],
  preferred_swaps: [
    {
      from: "beef_liver_cooked",
      to: "ground_beef_cooked_90",
      reason: "Standard beef is moderate-purine, not extreme.",
    },
    {
      from: "sardines_canned_oil",
      to: "salmon_atlantic_cooked",
      reason: "Salmon has ~half the purines of sardines.",
    },
    {
      from: "mussels_cooked",
      to: "shrimp_cooked",
      reason: "Shrimp is moderate-purine; mussels are very high.",
    },
    {
      from: "beef_ribeye_cooked",
      to: "chicken_breast_cooked_skinless",
      reason: "Lower-purine lean protein swap.",
    },
    {
      from: "ground_beef_cooked_80",
      to: "ground_turkey_cooked_93",
      reason: "Poultry has lower purine load than red meat.",
    },
  ],
  cautions: [
    "beef_brisket_cooked",
    "beef_chuck_cooked",
    "beef_flank_cooked",
    "beef_ribeye_cooked",
    "beef_sirloin_cooked",
    "beef_tenderloin_cooked",
    "ground_beef_cooked_80",
    "ground_beef_cooked_90",
    "ground_lamb_cooked",
    "lamb_chop_cooked",
    "italian_sausage_cooked",
    "bacon_cooked",
    "ham_cooked",
    "shrimp_cooked",
    "crab_cooked",
    "lobster_cooked",
    "scallops_cooked",
    "tuna_canned_water",
    "tuna_yellowfin_cooked",
    "anchovies", // not in DB — coach note
  ],
  block_generation_unless_acknowledged: false,
  generator_prompt_additions: [
    "Client has gout. Exclude organ meat, sardines, mussels.",
    "Cap red meat (beef, lamb) at 2–3 servings/week.",
    "Emphasize dairy (if tolerated) — dairy is protective against gout flares.",
    "Cherries (cherries_raw) are research-backed for gout management — use them in rotation.",
    "Pile vegetables + low-fat dairy + whole grains; these are associated with lower uric acid.",
  ],
};

export default medical_gout;
