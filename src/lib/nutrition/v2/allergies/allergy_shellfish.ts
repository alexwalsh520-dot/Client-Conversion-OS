/**
 * Allergy rule: SHELLFISH.
 *
 * Crustacean + mollusk allergy. Separate from finfish. Many shellfish
 * allergies are cross-reactive across crustaceans (shrimp, crab, lobster)
 * but mollusks (mussels, scallops) can sometimes be tolerated —
 * conservative default: exclude all.
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_shellfish: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.SHELLFISH,
  label: "Shellfish allergy",
  description:
    "Excludes all shellfish: crab, lobster, mussels, scallops, shrimp. " +
    "Separate from finfish allergy (allergy_fish).",
  hard_exclude: [
    "crab_cooked",
    "lobster_cooked",
    "mussels_cooked",
    "scallops_cooked",
    "shrimp_cooked",
  ],
  preferred_swaps: [
    {
      from: "shrimp_cooked",
      to: "chicken_breast_cooked_skinless",
      reason: "Lean protein swap for stir-fries / salads.",
    },
    {
      from: "shrimp_cooked",
      to: "cod_cooked",
      reason: "White-fleshed fish swap (confirm no finfish allergy).",
    },
    {
      from: "crab_cooked",
      to: "tuna_canned_water",
      reason: "Canned-tuna role in salads (confirm no finfish allergy).",
    },
    {
      from: "scallops_cooked",
      to: "halibut_cooked",
      reason: "Lean white fish swap (confirm no finfish allergy).",
    },
  ],
  cautions: [],
  generator_prompt_additions: [
    "Client has a shellfish allergy — no shrimp, crab, lobster, mussels, scallops.",
    "Finfish is a SEPARATE flag — salmon / tuna / cod etc. are OK unless allergy_fish is also set.",
  ],
};

export default allergy_shellfish;
