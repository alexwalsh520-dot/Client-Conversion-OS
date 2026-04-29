/**
 * Build spec: LEAN GAIN (slow, controlled surplus).
 *
 * Modest surplus (+200 kcal) with protein at 1.05 g/lb. Sits between Recomp
 * and Bulk — aimed at clients who want to add muscle with minimal fat gain.
 *
 * Per-check confirmations:
 *   [X] All slugs exist in the Supabase ingredients table
 *   [X] whey_protein_concentrate is in tier_2 (not tier_1)
 *   [X] Canonical slugs only
 *   [X] pine_nuts, brazil_nuts, hazelnuts_raw are ALL in tier_3 (not tier_2)
 *       — per the "Lean Gain specifically" self-check requirement.
 */

import {
  BuildType,
  DistributionTemplateId,
  HybridTagKind,
  MacroRole,
  SolverBias,
  Tier3Tag,
  type BuildSpec,
} from "../types";

const lean_gain: BuildSpec = {
  id: BuildType.LEAN_GAIN,
  label: "Lean Gain",
  description:
    "Slow controlled surplus (+200 kcal) with protein at 1.05 g/lb. For " +
    "clients who want to add muscle with minimal fat gain — sits between " +
    "Recomp and Bulk.",

  kcal_offset_from_tdee: +200,
  protein_g_per_lb: 1.05,
  fat_pct_of_kcal: 0.28,
  rest_day_kcal_drop: -150,
  rest_day_protein_change: 0,
  rest_day_carbs_change: -38,
  rest_day_fat_change: 0,

  tier_1_protein_min_pct_of_anchored_slots: 0.70,
  tier_1_carb_min_pct_of_anchored_slots: 0.75,

  default_distribution: DistributionTemplateId.STANDARD_4_MEAL,
  allowed_distributions: [
    DistributionTemplateId.STANDARD_3_MEAL,
    DistributionTemplateId.LUNCH_CENTERED_3_MEAL,
    DistributionTemplateId.STANDARD_4_MEAL,
    DistributionTemplateId.ATHLETE_5_MEAL,
    DistributionTemplateId.BODYBUILDER_6_MEAL,
  ],
  per_day_variable_meals: false,
  default_solver_bias: SolverBias.NEUTRAL,

  tier_1: [
    // Proteins — moderate-fat to lean
    { slug: "chicken_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "chicken_thigh_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "turkey_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_turkey_cooked_93", role: MacroRole.PROTEIN },
    { slug: "ground_beef_cooked_90", role: MacroRole.PROTEIN },
    { slug: "beef_sirloin_cooked", role: MacroRole.PROTEIN },
    { slug: "beef_flank_cooked", role: MacroRole.PROTEIN },
    { slug: "beef_tenderloin_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_tenderloin_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_loin_cooked", role: MacroRole.PROTEIN },
    // Eggs (hybrid)
    { slug: "egg_whole_boiled", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_whole_raw", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_white_raw", role: MacroRole.PROTEIN },
    { slug: "liquid_egg_whites", role: MacroRole.PROTEIN },
    // Fish
    { slug: "salmon_atlantic_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "salmon_sockeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cod_cooked", role: MacroRole.PROTEIN },
    { slug: "tuna_canned_water", role: MacroRole.PROTEIN },
    { slug: "tuna_yellowfin_cooked", role: MacroRole.PROTEIN },
    { slug: "tilapia_cooked", role: MacroRole.PROTEIN },
    { slug: "halibut_cooked", role: MacroRole.PROTEIN },
    { slug: "shrimp_cooked", role: MacroRole.PROTEIN },
    { slug: "trout_rainbow_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Plant
    { slug: "tofu_firm", role: MacroRole.PROTEIN },
    { slug: "tofu_extra_firm", role: MacroRole.PROTEIN },
    { slug: "tempeh", role: MacroRole.PROTEIN },
    { slug: "edamame_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_CARB },
    // Dairy
    { slug: "greek_yogurt_2_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "greek_yogurt_nonfat_plain", role: MacroRole.PROTEIN },
    { slug: "cottage_cheese_low_fat", role: MacroRole.PROTEIN },
    { slug: "skyr_plain", role: MacroRole.PROTEIN },
    { slug: "milk_2_percent", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Supplement
    { slug: "whey_protein_isolate", role: MacroRole.SUPPLEMENT },

    // Carbs — mix of whole and denser
    { slug: "oats_rolled_dry", role: MacroRole.CARB },
    { slug: "oatmeal_cooked_water", role: MacroRole.CARB },
    { slug: "oats_steel_cut_dry", role: MacroRole.CARB },
    { slug: "brown_rice_cooked", role: MacroRole.CARB },
    { slug: "basmati_rice_cooked", role: MacroRole.CARB },
    { slug: "jasmine_rice_cooked", role: MacroRole.CARB },
    { slug: "white_rice_cooked", role: MacroRole.CARB },
    { slug: "quinoa_cooked", role: MacroRole.CARB },
    { slug: "sweet_potato_baked", role: MacroRole.CARB },
    { slug: "potato_russet_baked", role: MacroRole.CARB },
    { slug: "potato_red_boiled", role: MacroRole.CARB },
    { slug: "whole_wheat_pasta_cooked", role: MacroRole.CARB },
    { slug: "pasta_cooked", role: MacroRole.CARB },
    { slug: "whole_wheat_bread", role: MacroRole.CARB },
    { slug: "sourdough_bread", role: MacroRole.CARB },
    { slug: "english_muffin_whole_wheat", role: MacroRole.CARB },
    // Legumes
    { slug: "black_beans_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "lentils_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "chickpeas_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },

    // Fruits
    { slug: "banana_raw", role: MacroRole.FRUIT },
    { slug: "apple_raw", role: MacroRole.FRUIT },
    { slug: "blueberries_raw", role: MacroRole.FRUIT },
    { slug: "strawberries_raw", role: MacroRole.FRUIT },
    { slug: "raspberries_raw", role: MacroRole.FRUIT },
    { slug: "orange_raw", role: MacroRole.FRUIT },
    { slug: "pineapple_raw", role: MacroRole.FRUIT },
    { slug: "mango_raw", role: MacroRole.FRUIT },
    { slug: "grapes_raw", role: MacroRole.FRUIT },
    { slug: "pear_raw", role: MacroRole.FRUIT },

    // Veggies (canonical slugs)
    { slug: "broccoli_steamed", role: MacroRole.VEGGIE },
    { slug: "spinach_raw", role: MacroRole.VEGGIE },
    { slug: "spinach_cooked", role: MacroRole.VEGGIE },
    { slug: "kale_cooked", role: MacroRole.VEGGIE },
    { slug: "asparagus_cooked", role: MacroRole.VEGGIE },
    { slug: "brussels_sprouts_cooked", role: MacroRole.VEGGIE },
    { slug: "green_beans_cooked", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_red_raw", role: MacroRole.VEGGIE },
    { slug: "carrots_cooked", role: MacroRole.VEGGIE },
    { slug: "cauliflower_cooked", role: MacroRole.VEGGIE },
    { slug: "zucchini_raw", role: MacroRole.VEGGIE },
    { slug: "tomato_roma_raw", role: MacroRole.VEGGIE },
    { slug: "cherry_tomatoes", role: MacroRole.VEGGIE },
    { slug: "onion_yellow_raw", role: MacroRole.VEGGIE },
    { slug: "mushroom_white_raw", role: MacroRole.VEGGIE },
    { slug: "corn_kernels_cooked", role: MacroRole.CARB },

    // Fats — standard workhorses
    { slug: "olive_oil", role: MacroRole.FAT },
    { slug: "avocado_raw", role: MacroRole.FAT },
    { slug: "avocado_oil", role: MacroRole.FAT },
    { slug: "almonds_raw", role: MacroRole.FAT },
    { slug: "walnuts_raw", role: MacroRole.FAT },
    { slug: "pecans_raw", role: MacroRole.FAT },
    { slug: "chia_seeds", role: MacroRole.FAT },
    { slug: "flax_seeds", role: MacroRole.FAT },
    { slug: "hemp_seeds", role: MacroRole.FAT },
    { slug: "pumpkin_seeds", role: MacroRole.FAT },
    { slug: "sunflower_seeds", role: MacroRole.FAT },
    { slug: "peanut_butter_smooth", role: MacroRole.FAT },
    { slug: "almond_butter", role: MacroRole.FAT },

    // Condiments
    { slug: "salsa", role: MacroRole.CONDIMENT },
    { slug: "marinara_sauce", role: MacroRole.CONDIMENT },
    { slug: "hot_sauce", role: MacroRole.CONDIMENT },
    { slug: "dijon_mustard", role: MacroRole.CONDIMENT },
    { slug: "balsamic_vinegar", role: MacroRole.CONDIMENT },
    { slug: "apple_cider_vinegar", role: MacroRole.CONDIMENT },
    { slug: "soy_sauce_low_sodium", role: MacroRole.CONDIMENT },
    { slug: "hummus", role: MacroRole.CONDIMENT, hybrid: HybridTagKind.CARB_FAT },
  ],

  tier_2: [
    // Blanket rule
    { slug: "whey_protein_concentrate", role: MacroRole.SUPPLEMENT },
    { slug: "casein_protein", role: MacroRole.SUPPLEMENT },
    { slug: "pea_protein_powder", role: MacroRole.SUPPLEMENT },

    // Fattier proteins
    { slug: "ground_beef_cooked_80", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "beef_ribeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "chicken_drumstick_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_pork_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "turkey_thigh_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "lamb_chop_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Refined carbs (tier 2 for lean gain)
    { slug: "bagel_plain", role: MacroRole.CARB },
    { slug: "white_bread", role: MacroRole.CARB },
    { slug: "tortilla_flour", role: MacroRole.CARB },
    // Full-fat dairy / cheese
    { slug: "greek_yogurt_whole_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cottage_cheese_full_fat", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "milk_whole", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cheddar_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "mozzarella_cheese_part_skim", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "feta_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "parmesan_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    // Sweet condiments
    { slug: "honey", role: MacroRole.CONDIMENT },
    { slug: "maple_syrup", role: MacroRole.CONDIMENT },
    { slug: "dates_medjool", role: MacroRole.FRUIT },
    { slug: "raisins", role: MacroRole.FRUIT },
    // Extra nut options
    { slug: "cashews_raw", role: MacroRole.FAT },
    { slug: "pistachios_raw", role: MacroRole.FAT },
    { slug: "cashew_butter", role: MacroRole.FAT },
    { slug: "butter_unsalted", role: MacroRole.FAT },
    { slug: "ghee", role: MacroRole.FAT },
  ],

  tier_3: [
    // LEAN-GAIN-SPECIFIC TIER 3 FATS (per self-check rule)
    {
      slug: "pine_nuts",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes:
        "Very calorie-dense and expensive; easy to overshoot fat budget. " +
        "Tier 3 in Lean Gain per spec.",
    },
    {
      slug: "brazil_nuts",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes:
        "Selenium toxicity risk above ~3 nuts/day. Tier 3 in Lean Gain per spec.",
    },
    {
      slug: "hazelnuts_raw",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Less optimal vs almonds/walnuts. Tier 3 in Lean Gain per spec.",
    },
    // Standard processed-protein caps
    {
      slug: "bacon_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Sodium + saturated fat; cap at 2×/week.",
    },
    {
      slug: "beef_jerky",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "High sodium.",
    },
    {
      slug: "italian_sausage_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Processed; cap sodium.",
    },
    {
      slug: "ham_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Cured; high sodium.",
    },
    // Isolated sugars
    {
      slug: "white_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated sugar; prefer whole-food carbs.",
    },
    {
      slug: "brown_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated sugar; prefer whole-food carbs.",
    },
    {
      slug: "agave_syrup",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "High-fructose; prefer honey/maple for sweet.",
    },
    // Organ meat
    {
      slug: "beef_liver_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.FLAG_TO_COACH,
      coach_note: "Organ meat; confirm client comfort. High purines/vit A.",
    },
    // Heavy cream — OK for bulk but soft-capped here
    {
      slug: "heavy_cream",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "Calorie-dense; OK in moderation for lean gain.",
    },
  ],

  frequency_caps: [
    {
      slug: "chicken_breast_cooked_skinless",
      max_per_week: 3,
      reason: "Anchor-protein variety.",
    },
    {
      slug: "ground_beef_cooked_90",
      max_per_week: 3,
      reason: "Anchor-protein variety.",
    },
    {
      slug: "salmon_atlantic_cooked",
      max_per_week: 2,
      reason: "Rotate omega-3 sources.",
    },
    {
      slug: "salmon_sockeye_cooked",
      max_per_week: 2,
      reason: "Rotate omega-3 sources.",
    },
  ],

  generator_prompt_notes: [
    "Lean Gain = modest surplus, protein at 1.05 g/lb.",
    "Prefer whole-food carbs; refined carbs are tier 2 (OK occasionally).",
    "pine_nuts, brazil_nuts, hazelnuts are tier 3 — prefer almonds, walnuts, pecans.",
    "Target: slow lean mass accumulation without notable fat gain.",
  ],

  coach_notes: [
    "Expected rate: ~0.25–0.5 lb/week gain. Slower than Bulk; goal is minimal fat.",
    "If client stalls, add 100 kcal from carbs. Do not touch fat.",
    "If waist circumference rises > 1 cm/month, trim 100 kcal back down.",
    "Pine nuts, brazil nuts, hazelnuts are Lean-Gain-specific tier 3 — not because unhealthy, but because their calorie density makes fat-budget management harder for this build.",
  ],
};

export default lean_gain;
