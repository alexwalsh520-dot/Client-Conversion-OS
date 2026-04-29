/**
 * Medical rule: KIDNEY ISSUES (CKD / impaired renal function).
 *
 * Blocks generation unless the coach acknowledges the risk. Caps protein
 * at 0.6 g/lb and limits Na, K, and phosphorus-rich foods.
 */

import { MedicalFlag, type MedicalRule } from "../types";

const medical_kidney: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.KIDNEY,
  label: "Kidney issues (CKD)",
  description:
    "Chronic kidney disease / impaired renal function. Blocks generation " +
    "until the coach acknowledges the risk. Caps protein and limits Na, " +
    "potassium, and phosphorus.",
  hard_exclude: [
    // Very high phosphorus
    "beef_liver_cooked",
    "sardines_canned_oil",
    // Very high potassium / Na combined
    "beef_jerky",
    "bacon_cooked",
    "italian_sausage_cooked",
    "ham_cooked",
  ],
  preferred_swaps: [
    {
      from: "banana_raw",       // high K
      to: "apple_raw",
      reason: "Lower potassium fruit.",
    },
    {
      from: "potato_russet_baked", // high K
      to: "white_rice_cooked",
      reason: "Lower-K carb; soak/boil potatoes if used at all.",
    },
    {
      from: "potato_red_boiled",
      to: "white_rice_cooked",
      reason: "Rice is lower K than potato.",
    },
    {
      from: "sweet_potato_baked",
      to: "white_rice_cooked",
      reason: "Lower-K carb.",
    },
    {
      from: "spinach_cooked",   // concentrated K + oxalate
      to: "iceberg_lettuce",
      reason: "Lower-K leafy swap.",
    },
    {
      from: "tomato_roma_raw",  // high K
      to: "cucumber_raw",
      reason: "Low-K refresh.",
    },
    {
      from: "avocado_raw",      // very high K
      to: "olive_oil",
      reason: "Fat-only swap without the potassium load.",
    },
    {
      from: "whey_protein_concentrate",
      to: "egg_white_raw",
      reason: "Whole-food protein; skip the phosphate-rich powder.",
    },
  ],
  cautions: [
    // Potassium-heavy foods kept as flags
    "banana_raw",
    "orange_raw",
    "orange_juice",
    "mango_raw",
    "cantaloupe_raw",
    "honeydew_raw",
    "watermelon_raw",
    "coconut_water",
    "potato_russet_baked",
    "potato_red_boiled",
    "potato_mashed",
    "sweet_potato_baked",
    "spinach_cooked",
    "spinach_raw",
    "beets_cooked",
    "tomato_roma_raw",
    "cherry_tomatoes",
    "avocado_raw",
    // Phosphorus-heavy
    "milk_whole",
    "milk_2_percent",
    "milk_skim",
    "cheddar_cheese",
    "parmesan_cheese",
    "whey_protein_concentrate",
    "whey_protein_isolate",
    "pea_protein_powder",
    "casein_protein",
    // Sodium
    "soy_sauce",
    "soy_sauce_low_sodium",
    "pickles_dill",
    "sauerkraut",
  ],
  block_generation_unless_acknowledged: true,
  acknowledgement_text:
    "Client has kidney issues. Generating a plan without physician " +
    "guidance carries real risk. Confirm you've reviewed the client's " +
    "latest labs (eGFR, K, P, BUN, creatinine) and that a renal dietitian " +
    "is in the loop. Tick to acknowledge and proceed.",
  sodium_cap_mg: 2000,
  protein_cap_per_lb: 0.6,
  generator_prompt_additions: [
    "Client has kidney disease. HARD CAPS: protein 0.6 g/lb, sodium 2000 mg/day.",
    "Avoid high-potassium foods (banana, orange, tomato, potato, spinach, avocado).",
    "Avoid high-phosphorus foods (dairy, protein powders, organ meat, sardines).",
    "Coach must acknowledge — this is a physician-collaborative plan.",
  ],
};

export default medical_kidney;
