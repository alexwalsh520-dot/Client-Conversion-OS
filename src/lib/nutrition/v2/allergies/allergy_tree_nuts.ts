/**
 * Allergy rule: TREE NUTS.
 *
 * Excludes all tree nuts and tree-nut butters. CRITICAL (per self-check):
 *   - pesto is in the hard_exclude list (contains pine nuts — a tree nut in
 *     most allergen guidance, even though botanically it's a seed).
 */

import { AllergyFlag, type AllergyRule } from "../types";

const allergy_tree_nuts: AllergyRule = {
  kind: "allergy",
  flag: AllergyFlag.TREE_NUTS,
  label: "Tree nut allergy",
  description:
    "Excludes all tree nuts (almonds, cashews, walnuts, pecans, pistachios, " +
    "hazelnuts, macadamia, brazil, pine nuts) and tree-nut butters / milks / " +
    "products like pesto. Peanuts are legumes — covered by allergy_peanuts.",
  hard_exclude: [
    // Tree nuts
    "almonds_raw",
    "brazil_nuts",
    "cashews_raw",
    "hazelnuts_raw",
    "macadamia_raw",
    "pecans_raw",
    "pistachios_raw",
    "pine_nuts", // classified as tree-nut allergen per spec
    "walnuts_raw",
    // Tree-nut butters
    "almond_butter",
    "cashew_butter",
    // Tree-nut milks
    "almond_milk_unsweetened",
    "coconut_milk_unsweetened", // coconut is classified as tree-nut by FDA
    // Tree-nut-containing foods
    "pesto", // contains pine nuts per self-check
  ],
  preferred_swaps: [
    {
      from: "almonds_raw",
      to: "pumpkin_seeds",
      reason: "Seed-based, nut-free crunchy swap.",
    },
    {
      from: "almonds_raw",
      to: "sunflower_seeds",
      reason: "Seed-based swap.",
    },
    {
      from: "walnuts_raw",
      to: "pumpkin_seeds",
      reason: "Seed-based swap; add flax / chia for omega-3.",
    },
    {
      from: "almond_butter",
      to: "peanut_butter_smooth",
      reason: "Peanut is a legume — OK unless allergy_peanuts is also set.",
    },
    {
      from: "almond_butter",
      to: "tahini",
      reason: "Seed-based creamy spread (check sesame allergy).",
    },
    {
      from: "almond_milk_unsweetened",
      to: "soy_milk_unsweetened",
      reason: "Non-nut plant milk.",
    },
    {
      from: "almond_milk_unsweetened",
      to: "oat_milk_unsweetened",
      reason: "Nut-free plant milk.",
    },
    {
      from: "coconut_milk_unsweetened",
      to: "oat_milk_unsweetened",
      reason: "Coconut classified as tree-nut; oat milk is a safe swap.",
    },
    {
      from: "pesto",
      to: "marinara_sauce",
      reason: "Simple pasta sauce swap; check label for nut additions.",
    },
    {
      from: "pesto",
      to: "hummus",
      reason: "Creamy sauce alternative (check sesame allergy).",
    },
  ],
  cautions: [
    "chocolate_dark_70", // often produced on shared lines with tree nuts
    "granola",           // not in DB but worth the coach note
  ],
  generator_prompt_additions: [
    "Client has tree-nut allergy. Exclude ALL tree nuts, tree-nut butters, and tree-nut milks.",
    "pesto IS excluded — it contains pine nuts.",
    "coconut (milk, oil) is classified as tree-nut by FDA — exclude coconut products.",
    "Peanuts are legumes — OK unless allergy_peanuts is also set.",
    "Safe seed swaps: pumpkin, sunflower, chia, flax, hemp, sesame (check sesame flag).",
  ],
};

export default allergy_tree_nuts;
