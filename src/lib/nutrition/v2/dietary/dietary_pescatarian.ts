/**
 * Dietary style: PESCATARIAN.
 *
 * Excludes meat / poultry but allows seafood, eggs, and dairy.
 */

import { DietaryStyle, type DietaryRule } from "../types";

const dietary_pescatarian: DietaryRule = {
  kind: "dietary",
  style: DietaryStyle.PESCATARIAN,
  flag: DietaryStyle.PESCATARIAN,
  label: "Pescatarian",
  description:
    "No meat or poultry. Seafood, eggs, and dairy are allowed.",
  hard_exclude: [
    // Beef
    "beef_brisket_cooked",
    "beef_chuck_cooked",
    "beef_flank_cooked",
    "beef_jerky",
    "beef_liver_cooked",
    "beef_ribeye_cooked",
    "beef_sirloin_cooked",
    "beef_tenderloin_cooked",
    "ground_beef_cooked_80",
    "ground_beef_cooked_90",
    // Lamb
    "ground_lamb_cooked",
    "lamb_chop_cooked",
    // Pork
    "bacon_cooked",
    "ground_pork_cooked",
    "ham_cooked",
    "italian_sausage_cooked",
    "pork_loin_cooked",
    "pork_shoulder_cooked",
    "pork_tenderloin_cooked",
    // Poultry
    "chicken_breast_cooked_skinless",
    "chicken_drumstick_cooked_skinless",
    "chicken_thigh_cooked_skinless",
    "chicken_wing_cooked",
    "ground_chicken_cooked",
    "ground_turkey_cooked_93",
    "turkey_breast_cooked_skinless",
    "turkey_thigh_cooked",
    "duck_breast_cooked",
  ],
  preferred_swaps: [
    {
      from: "chicken_breast_cooked_skinless",
      to: "cod_cooked",
      reason: "Lean white-flesh fish swap.",
    },
    {
      from: "chicken_breast_cooked_skinless",
      to: "tilapia_cooked",
      reason: "Lean white-flesh fish swap.",
    },
    {
      from: "chicken_thigh_cooked_skinless",
      to: "salmon_atlantic_cooked",
      reason: "Hybrid protein+fat swap.",
    },
    {
      from: "ground_beef_cooked_90",
      to: "tuna_yellowfin_cooked",
      reason: "Lean red-meat-style seafood swap.",
    },
    {
      from: "beef_sirloin_cooked",
      to: "tuna_yellowfin_cooked",
      reason: "Steak-like seafood swap.",
    },
    {
      from: "bacon_cooked",
      to: "sardines_canned_oil",
      reason: "Salty umami protein swap (watch Na).",
    },
  ],
  cautions: [],
  generator_prompt_additions: [
    "Client is pescatarian. Exclude all meat and poultry.",
    "Fish, shellfish, eggs, and dairy are allowed.",
    "Include fatty fish (salmon, trout, sardines) 2–3×/week for complete omega-3 profile.",
  ],
};

export default dietary_pescatarian;
