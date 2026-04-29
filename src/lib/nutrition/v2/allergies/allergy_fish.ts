/**
 * Allergy rule: FISH (finfish only).
 *
 * Excludes all finfish. SHELLFISH IS A SEPARATE FLAG — a client can be
 * allergic to finfish but tolerate shellfish (and vice versa). Do not merge.
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_fish: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.FISH,
  label: "Fish allergy (finfish)",
  description:
    "Excludes all finfish. Shellfish is a separate flag (allergy_shellfish); " +
    "many fish-allergic clients tolerate shellfish.",
  hard_exclude: [
    "cod_cooked",
    "halibut_cooked",
    "mahi_mahi_cooked",
    "salmon_atlantic_cooked",
    "salmon_sockeye_cooked",
    "sardines_canned_oil",
    "tilapia_cooked",
    "trout_rainbow_cooked",
    "tuna_canned_water",
    "tuna_yellowfin_cooked",
  ],
  preferred_swaps: [
    {
      from: "salmon_atlantic_cooked",
      to: "chicken_thigh_cooked_skinless",
      reason: "Similar protein + fat profile (hybrid protein+fat).",
    },
    {
      from: "salmon_sockeye_cooked",
      to: "chicken_thigh_cooked_skinless",
      reason: "Similar protein + fat profile.",
    },
    {
      from: "cod_cooked",
      to: "chicken_breast_cooked_skinless",
      reason: "Lean white protein swap.",
    },
    {
      from: "tilapia_cooked",
      to: "chicken_breast_cooked_skinless",
      reason: "Lean white protein swap.",
    },
    {
      from: "tuna_canned_water",
      to: "chicken_breast_cooked_skinless",
      reason: "Canned-tuna role filled by canned or shredded chicken.",
    },
    {
      from: "salmon_atlantic_cooked",
      to: "chia_seeds",
      reason: "Plant omega-3 source; pair with walnuts for ALA boost.",
    },
  ],
  cautions: [
    "worcestershire_sauce", // contains anchovies — check label
  ],
  generator_prompt_additions: [
    "Client has a finfish allergy — no salmon, tuna, cod, tilapia, halibut, trout, mahi, sardines.",
    "Shellfish (shrimp, crab, lobster, scallops, mussels) is a SEPARATE flag — only exclude if allergy_shellfish is also set.",
    "Replace fatty fish with chicken thigh + walnuts/chia for omega-3 load.",
    "Check worcestershire sauce labels — it contains anchovies.",
  ],
};

export default allergy_fish;
