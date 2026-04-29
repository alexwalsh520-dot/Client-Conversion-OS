/**
 * Medical rule: PCOS (Polycystic Ovary Syndrome).
 *
 * Insulin-resistance-adjacent: prefer low-GI carbs, anti-inflammatory foods,
 * reduce isolated sugars. Similar in spirit to Type 2 diabetes but without
 * the macro-split adjustment.
 */

import { MedicalFlag, type MedicalRule } from "../types";

const medical_pcos: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.PCOS,
  label: "PCOS",
  description:
    "PCOS — improve insulin sensitivity via low-GI carbs, " +
    "anti-inflammatory fats, and adequate protein. Exclude isolated sugars " +
    "and highly refined carbs.",
  hard_exclude: [
    "white_sugar",
    "brown_sugar",
    "agave_syrup",
    "apple_juice",
    "orange_juice",
  ],
  preferred_swaps: [
    {
      from: "white_rice_cooked",
      to: "quinoa_cooked",
      reason: "Lower GI; complete protein bonus.",
    },
    {
      from: "jasmine_rice_cooked",
      to: "brown_rice_cooked",
      reason: "Lower GI; more fiber.",
    },
    {
      from: "pasta_cooked",
      to: "whole_wheat_pasta_cooked",
      reason: "Higher fiber lowers GI.",
    },
    {
      from: "white_bread",
      to: "sourdough_bread",
      reason: "Fermentation lowers GI.",
    },
    {
      from: "bagel_plain",
      to: "oatmeal_cooked_water",
      reason: "Slow carb, high fiber, better insulin response.",
    },
    {
      from: "honey",
      to: "cinnamon", // not in DB but the standard PCOS swap
      reason: "Cinnamon may improve insulin sensitivity (coach note).",
    },
    {
      from: "banana_raw",
      to: "blueberries_raw",
      reason: "Lower-GI berry.",
    },
    {
      from: "mango_raw",
      to: "strawberries_raw",
      reason: "Lower-GI berry.",
    },
  ],
  cautions: [
    // Dairy — evidence is mixed; some PCOS clients respond better to reduced dairy
    "milk_whole",
    "milk_2_percent",
    "milk_skim",
    // Refined carbs
    "white_rice_cooked",
    "jasmine_rice_cooked",
    "basmati_rice_cooked",
    "pasta_cooked",
    "white_bread",
    "bagel_plain",
    "potato_mashed",
    "raisins",
    "dates_medjool",
    "mango_raw",
    "pineapple_raw",
  ],
  block_generation_unless_acknowledged: false,
  generator_prompt_additions: [
    "Client has PCOS. Prefer low-GI, high-fiber whole grains.",
    "Include anti-inflammatory fats: fatty fish (salmon), walnuts, chia, flax, olive oil.",
    "Pair carbs with protein + fat to blunt glucose response.",
    "Exclude isolated sugars.",
    "Dairy evidence is mixed — flag to coach if client reports skin / cycle correlations.",
  ],
};

export default medical_pcos;
