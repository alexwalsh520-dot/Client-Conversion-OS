/**
 * Build spec: BULK (muscle gain, aggressive surplus).
 *
 * Substantial surplus (+400 kcal) with calorie-dense foods to hit elevated
 * targets without excess stomach volume. Protein ratio drops to 1.0 g/lb
 * because there's more food overall. Fat stays at 0.35 g/lb — which on a
 * surplus works out to ~30% fat of total calories.
 *
 * NOTE — Bulk-specific design choice:
 *   30% fat is INTENTIONAL. Carbs are the primary surplus vehicle because
 *   (a) they drive performance, (b) fat surplus beyond 30% provides poor
 *   cost/benefit for hypertrophy. Keep the fat ratio as-is; only scale
 *   protein+carbs to meet kcal target.
 *
 * Per-check confirmations:
 *   [X] All slugs exist in the Supabase ingredients table
 *   [X] whey_protein_concentrate is in tier_2 (not tier_1)
 *   [X] Canonical slugs only
 *   [X] 30% fat explanatory note present in coach_notes
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

const bulk: BuildSpec = {
  id: BuildType.BULK,
  label: "Bulk",
  description:
    "Aggressive muscle-gain surplus (+400 kcal). Protein at 1.0 g/lb, fat at " +
    "0.35 g/lb — carbs absorb the surplus. Density-biased solver picks " +
    "calorie-efficient foods so stomach volume stays manageable.",

  kcal_offset_from_tdee: +400,
  protein_g_per_lb: 1.00,
  fat_pct_of_kcal: 0.30,
  rest_day_kcal_drop: -100,
  rest_day_protein_change: 0,
  rest_day_carbs_change: -25,
  rest_day_fat_change: 0,

  tier_1_protein_min_pct_of_anchored_slots: 0.60,
  tier_1_carb_min_pct_of_anchored_slots: 0.70,

  default_distribution: DistributionTemplateId.ATHLETE_5_MEAL,
  allowed_distributions: [
    DistributionTemplateId.STANDARD_4_MEAL,
    DistributionTemplateId.ATHLETE_5_MEAL,
    DistributionTemplateId.BODYBUILDER_6_MEAL,
  ],
  per_day_variable_meals: false,
  default_solver_bias: SolverBias.DENSITY,

  tier_1: [
    // Proteins — prefer slightly fattier cuts for kcal density
    { slug: "ground_beef_cooked_80", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "ground_beef_cooked_90", role: MacroRole.PROTEIN },
    { slug: "beef_sirloin_cooked", role: MacroRole.PROTEIN },
    { slug: "beef_ribeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "beef_flank_cooked", role: MacroRole.PROTEIN },
    { slug: "chicken_thigh_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "chicken_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_chicken_cooked", role: MacroRole.PROTEIN },
    { slug: "turkey_thigh_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "ground_pork_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "pork_shoulder_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "pork_loin_cooked", role: MacroRole.PROTEIN },
    { slug: "lamb_chop_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "ground_lamb_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Whole eggs (big density wins)
    { slug: "egg_whole_boiled", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_whole_raw", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_yolk_raw", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    // Seafood (salmon especially)
    { slug: "salmon_atlantic_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "salmon_sockeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "tuna_yellowfin_cooked", role: MacroRole.PROTEIN },
    { slug: "tuna_canned_water", role: MacroRole.PROTEIN },
    { slug: "trout_rainbow_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Whey isolate (supplemental, tier 1)
    { slug: "whey_protein_isolate", role: MacroRole.SUPPLEMENT },

    // Calorie-dense carbs — surplus vehicle
    { slug: "white_rice_cooked", role: MacroRole.CARB },
    { slug: "jasmine_rice_cooked", role: MacroRole.CARB },
    { slug: "basmati_rice_cooked", role: MacroRole.CARB },
    { slug: "pasta_cooked", role: MacroRole.CARB },
    { slug: "egg_noodles_cooked", role: MacroRole.CARB },
    { slug: "rice_noodles_cooked", role: MacroRole.CARB },
    { slug: "potato_russet_baked", role: MacroRole.CARB },
    { slug: "sweet_potato_baked", role: MacroRole.CARB },
    { slug: "potato_mashed", role: MacroRole.CARB },
    { slug: "bagel_plain", role: MacroRole.CARB },
    { slug: "white_bread", role: MacroRole.CARB },
    { slug: "whole_wheat_bread", role: MacroRole.CARB },
    { slug: "english_muffin_whole_wheat", role: MacroRole.CARB },
    { slug: "tortilla_flour", role: MacroRole.CARB },
    { slug: "naan", role: MacroRole.CARB },
    { slug: "pita_whole_wheat", role: MacroRole.CARB },
    { slug: "oats_rolled_dry", role: MacroRole.CARB },
    { slug: "oatmeal_cooked_water", role: MacroRole.CARB },
    // Legumes
    { slug: "black_beans_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "lentils_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "chickpeas_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "kidney_beans_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },

    // Fruits (carb-density friends)
    { slug: "banana_raw", role: MacroRole.FRUIT },
    { slug: "mango_raw", role: MacroRole.FRUIT },
    { slug: "pineapple_raw", role: MacroRole.FRUIT },
    { slug: "grapes_raw", role: MacroRole.FRUIT },
    { slug: "dates_medjool", role: MacroRole.FRUIT, notes: "Great pre-workout carb." },
    { slug: "raisins", role: MacroRole.FRUIT },
    { slug: "figs_dried", role: MacroRole.FRUIT },
    { slug: "orange_raw", role: MacroRole.FRUIT },
    { slug: "apple_raw", role: MacroRole.FRUIT },
    { slug: "blueberries_raw", role: MacroRole.FRUIT },
    { slug: "strawberries_raw", role: MacroRole.FRUIT },

    // Dairy — full-fat versions (protein + fat)
    { slug: "milk_whole", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "milk_2_percent", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "greek_yogurt_whole_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "greek_yogurt_2_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cottage_cheese_full_fat", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cheddar_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "mozzarella_cheese_whole", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },

    // Calorie-dense fats
    { slug: "olive_oil", role: MacroRole.FAT },
    { slug: "avocado_raw", role: MacroRole.FAT },
    { slug: "avocado_oil", role: MacroRole.FAT },
    { slug: "peanut_butter_smooth", role: MacroRole.FAT },
    { slug: "almond_butter", role: MacroRole.FAT },
    { slug: "cashew_butter", role: MacroRole.FAT },
    { slug: "almonds_raw", role: MacroRole.FAT },
    { slug: "cashews_raw", role: MacroRole.FAT },
    { slug: "walnuts_raw", role: MacroRole.FAT },
    { slug: "pistachios_raw", role: MacroRole.FAT },
    { slug: "pecans_raw", role: MacroRole.FAT },
    { slug: "butter_unsalted", role: MacroRole.FAT },
    { slug: "ghee", role: MacroRole.FAT },

    // Veggies (canonical only)
    { slug: "broccoli_steamed", role: MacroRole.VEGGIE },
    { slug: "spinach_cooked", role: MacroRole.VEGGIE },
    { slug: "carrots_cooked", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_red_raw", role: MacroRole.VEGGIE },
    { slug: "tomato_roma_raw", role: MacroRole.VEGGIE },
    { slug: "onion_yellow_raw", role: MacroRole.VEGGIE },
    { slug: "mushroom_white_raw", role: MacroRole.VEGGIE },
    { slug: "zucchini_raw", role: MacroRole.VEGGIE },
    { slug: "corn_kernels_cooked", role: MacroRole.CARB }, // canonical
    { slug: "butternut_squash_cooked", role: MacroRole.CARB },

    // Condiments
    { slug: "salsa", role: MacroRole.CONDIMENT },
    { slug: "marinara_sauce", role: MacroRole.CONDIMENT },
    { slug: "bbq_sauce", role: MacroRole.CONDIMENT },
    { slug: "honey", role: MacroRole.CONDIMENT },
    { slug: "maple_syrup", role: MacroRole.CONDIMENT },
    { slug: "hummus", role: MacroRole.CONDIMENT, hybrid: HybridTagKind.CARB_FAT },
    { slug: "guacamole", role: MacroRole.FAT },
  ],

  tier_2: [
    { slug: "whey_protein_concentrate", role: MacroRole.SUPPLEMENT },
    { slug: "casein_protein", role: MacroRole.SUPPLEMENT },
    { slug: "pea_protein_powder", role: MacroRole.SUPPLEMENT },

    // Leaner proteins (less density but fine)
    { slug: "turkey_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_turkey_cooked_93", role: MacroRole.PROTEIN },
    { slug: "cod_cooked", role: MacroRole.PROTEIN },
    { slug: "tilapia_cooked", role: MacroRole.PROTEIN },

    // Whole grains (lower kcal density than refined — tier 2 for bulk)
    { slug: "brown_rice_cooked", role: MacroRole.CARB },
    { slug: "quinoa_cooked", role: MacroRole.CARB },
    { slug: "whole_wheat_pasta_cooked", role: MacroRole.CARB },
    { slug: "barley_cooked", role: MacroRole.CARB },
    { slug: "farro_cooked", role: MacroRole.CARB },

    // Sugary treats / dessert fats
    { slug: "chocolate_dark_70", role: MacroRole.FAT },
    { slug: "heavy_cream", role: MacroRole.FAT, notes: "Great for smoothies on bulk." },

    // Processed condiments (OK in Bulk)
    { slug: "ranch_dressing", role: MacroRole.CONDIMENT },
    { slug: "mayonnaise", role: MacroRole.FAT },
    { slug: "italian_dressing", role: MacroRole.CONDIMENT },
    { slug: "ketchup", role: MacroRole.CONDIMENT },
  ],

  tier_3: [
    // Processed proteins still capped even in bulk
    {
      slug: "bacon_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "Calorie-useful but cap for sodium/nitrate concerns.",
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
      notes: "Processed; cap sodium exposure.",
    },
    {
      slug: "ham_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Cured; high sodium.",
    },
    // Organ meats
    {
      slug: "beef_liver_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.FLAG_TO_COACH,
      coach_note: "Organ meat; confirm client comfort. High purines/vit A.",
    },
    // Isolated sugars — even in bulk, prefer whole-food carbs
    {
      slug: "white_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "Acceptable in baking / shakes; not as standalone ingredient.",
    },
    {
      slug: "brown_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "Same as white sugar.",
    },
    {
      slug: "agave_syrup",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "High-fructose; prefer honey / maple.",
    },
  ],

  frequency_caps: [
    {
      slug: "chicken_breast_cooked_skinless",
      max_per_week: 3,
      reason: "Anchor-protein variety.",
    },
    {
      slug: "ground_beef_cooked_80",
      max_per_week: 3,
      reason: "Variety + saturated-fat rotation.",
    },
    {
      slug: "salmon_atlantic_cooked",
      max_per_week: 2,
      reason: "Rotate omega-3 sources.",
    },
  ],

  generator_prompt_notes: [
    "Bulk = surplus. Protein at 1.0 g/lb (lower ratio because there's more food overall).",
    "Solver bias: DENSITY. Prefer calorie-efficient foods so stomach volume stays sane.",
    "Carbs are the surplus vehicle — whole and refined both OK in Bulk.",
    "Whole-milk dairy and full-fat cheese are tier 1 here — use them.",
    "Pre- and post-workout carb density matters: white rice, bagels, dates.",
  ],

  coach_notes: [
    "Expected rate: ~1 lb/week lean gain (faster = more fat).",
    "30% fat is INTENTIONAL. Carbs are the primary surplus vehicle. Do not cut fat first if the client stalls — add carbs.",
    "Rest-day kcal adjusted -100 to avoid over-feeding on off days.",
    "Watch waistline: +2–3 cm over 8 weeks is fine; faster = swap to lean-gain.",
  ],
};

export default bulk;
