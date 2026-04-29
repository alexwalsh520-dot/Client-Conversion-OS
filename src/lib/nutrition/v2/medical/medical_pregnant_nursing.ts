/**
 * Medical rule: PREGNANCY or NURSING.
 *
 * Blocks generation unless the coach acknowledges. DISABLES the SHRED
 * build entirely (deficit is contraindicated in pregnancy/nursing).
 * Excludes high-mercury fish and raw/undercooked proteins.
 */

import { BuildType, MedicalFlag, type MedicalRule } from "../types";

const medical_pregnant_nursing: MedicalRule = {
  kind: "medical",
  flag: MedicalFlag.PREGNANT_NURSING,
  label: "Pregnant or nursing",
  description:
    "Pregnancy or breastfeeding. Requires coach acknowledgement, disables " +
    "the Shred build, and excludes high-mercury fish and raw/undercooked " +
    "proteins.",
  hard_exclude: [
    // High-mercury fish (FDA avoid-list)
    "tuna_yellowfin_cooked",
    // Raw egg (salmonella)
    "egg_whole_raw",
    "egg_white_raw",
    "egg_yolk_raw",
    "liquid_egg_whites", // unless pasteurized — flag instead? keep hard for safety default
    // Organ meat (vit A toxicity — teratogenic)
    "beef_liver_cooked",
  ],
  preferred_swaps: [
    {
      from: "tuna_yellowfin_cooked",
      to: "salmon_atlantic_cooked",
      reason: "Low-mercury fatty fish (safe 2–3×/week in pregnancy).",
    },
    {
      from: "egg_whole_raw",
      to: "egg_whole_boiled",
      reason: "Fully cooked = salmonella-safe.",
    },
    {
      from: "egg_white_raw",
      to: "egg_whole_boiled",
      reason: "Cooked eggs only.",
    },
    {
      from: "beef_liver_cooked",
      to: "chicken_thigh_cooked_skinless",
      reason: "Iron-rich swap without the vit A overload.",
    },
    {
      from: "coffee_brewed",
      to: "black_tea_brewed",
      reason: "Lower caffeine per cup; monitor total to <200 mg/day.",
    },
  ],
  cautions: [
    // Moderate-mercury fish — cap at 2 servings/week (coach oversight)
    "tuna_canned_water",
    // Soft cheeses (listeria risk if unpasteurized — assume pasteurized but flag)
    "feta_cheese",
    "goat_cheese",
    // Caffeine
    "coffee_brewed",
    "black_tea_brewed",
    "green_tea_brewed",
    // Cured meats (listeria)
    "ham_cooked",
    "bacon_cooked",
    "italian_sausage_cooked",
    "beef_jerky",
    // Raw sprouts not in DB; raw-salad sprouts / alfalfa flagged elsewhere
  ],
  block_generation_unless_acknowledged: true,
  acknowledgement_text:
    "Client is pregnant or nursing. Shred (deficit) is disabled. Confirm " +
    "the client's OB/GYN or midwife is aware of any coaching program and " +
    "that the plan is for healthy weight MAINTENANCE or lean gain during " +
    "this period. Tick to proceed.",
  build_lock: {
    disabled_builds: [BuildType.SHRED],
    reason: "Caloric deficit is contraindicated in pregnancy and lactation.",
  },
  generator_prompt_additions: [
    "Client is pregnant or nursing. Shred build is LOCKED (no deficit allowed).",
    "Exclude high-mercury fish (yellowfin tuna).",
    "Exclude raw eggs and raw/rare meat.",
    "Exclude beef liver (vitamin A toxicity risk).",
    "Limit caffeine to <200 mg/day total (≈2 cups brewed coffee).",
    "Pasteurized soft cheeses only — confirm labeling.",
    "Include folate-rich foods (leafy greens, lentils, fortified grains).",
  ],
};

export default medical_pregnant_nursing;
