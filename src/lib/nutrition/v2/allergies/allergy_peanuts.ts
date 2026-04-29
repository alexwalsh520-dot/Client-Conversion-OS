/**
 * Allergy rule: PEANUTS.
 *
 * Peanuts are LEGUMES, not tree nuts. A peanut allergy does NOT imply a tree
 * nut allergy (and vice versa). Keep these checkboxes independent.
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_peanuts: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.PEANUTS,
  label: "Peanut allergy",
  description:
    "Excludes peanuts and peanut butter. Peanuts are legumes — tree nuts " +
    "(almonds, cashews, walnuts, etc.) are a separate flag.",
  hard_exclude: ["peanut_butter_smooth", "peanuts_raw"],
  preferred_swaps: [
    {
      from: "peanut_butter_smooth",
      to: "almond_butter",
      reason: "Tree-nut butter — confirm no tree nut allergy also.",
    },
    {
      from: "peanut_butter_smooth",
      to: "cashew_butter",
      reason: "Tree-nut butter — confirm no tree nut allergy also.",
    },
    {
      from: "peanut_butter_smooth",
      to: "sunflower_seeds",
      reason: "Seed-based — safe for both peanut and tree-nut allergies.",
    },
    {
      from: "peanut_butter_smooth",
      to: "tahini",
      reason: "Sesame seed paste — peanut + tree-nut safe (but check sesame allergy flag).",
    },
    {
      from: "peanuts_raw",
      to: "almonds_raw",
      reason: "Tree-nut swap if no tree-nut allergy.",
    },
    {
      from: "peanuts_raw",
      to: "pumpkin_seeds",
      reason: "Seed-based safe swap.",
    },
  ],
  cautions: [
    // Peanut oil is a common hidden source but not in our DB; still flag anyway
  ],
  generator_prompt_additions: [
    "Client has a peanut allergy. Exclude peanuts and peanut butter.",
    "Tree nuts (almonds, cashews, walnuts, pecans, pistachios, hazelnuts, pine_nuts, brazil_nuts, macadamia) are SEPARATE — only exclude if allergy_tree_nuts is also set.",
    "Safe seed alternatives: sunflower_seeds, pumpkin_seeds.",
  ],
};

export default allergy_peanuts;
