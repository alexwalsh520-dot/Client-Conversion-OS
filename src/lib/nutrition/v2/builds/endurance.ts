/**
 * Build spec: ENDURANCE (aerobic-dominant training).
 *
 * Carb-forward spec designed for runners, cyclists, triathletes. Protein
 * lower (0.85 g/lb), fat tighter (0.30 g/lb), carbs fill the rest. Training
 * days +250 kcal, rest days -500 kcal vs training — built-in cycling.
 *
 * UNIQUE TO THIS BUILD:
 *   - per_day_variable_meals = true (only endurance uses both
 *     endurance_5_meal_training_day and endurance_3_meal_rest_day).
 *   - PDF renderer must support per-day meal count (Q4 resolution).
 *
 * Per-check confirmations:
 *   [X] All slugs exist in the Supabase ingredients table
 *   [X] whey_protein_concentrate is in tier_2 (not tier_1)
 *   [X] Canonical slugs only
 *   [X] per_day_variable_meals = true (the only build where this is true)
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

const endurance: BuildSpec = {
  id: BuildType.ENDURANCE,
  label: "Endurance",
  description:
    "Aerobic-dominant athletes (runners, cyclists, triathletes). Higher " +
    "carb share, moderate protein (0.85 g/lb), tight fat (0.30 g/lb). " +
    "Training-day +250 kcal, rest-day -500 kcal vs training day.",

  kcal_offset_from_tdee: +250,
  protein_g_per_lb: 0.85,
  fat_pct_of_kcal: 0.25,
  rest_day_kcal_drop: -500,
  rest_day_protein_change: 0,
  rest_day_carbs_change: -125,
  rest_day_fat_change: 0,

  tier_1_protein_min_pct_of_anchored_slots: 0.75,
  tier_1_carb_min_pct_of_anchored_slots: 0.80,

  default_distribution: DistributionTemplateId.ENDURANCE_5_MEAL_TRAINING_DAY,
  // Endurance is the only build that permits BOTH the training-day and
  // rest-day endurance templates — the generator switches per day.
  allowed_distributions: [
    DistributionTemplateId.ENDURANCE_5_MEAL_TRAINING_DAY,
    DistributionTemplateId.ENDURANCE_3_MEAL_REST_DAY,
    // Fallbacks if the coach disables per-day switching:
    DistributionTemplateId.STANDARD_4_MEAL,
    DistributionTemplateId.ATHLETE_5_MEAL,
  ],
  per_day_variable_meals: true, // ONLY endurance
  default_solver_bias: SolverBias.NEUTRAL,

  tier_1: [
    // Lean-to-moderate proteins
    { slug: "chicken_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "chicken_thigh_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "turkey_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_turkey_cooked_93", role: MacroRole.PROTEIN },
    { slug: "ground_beef_cooked_90", role: MacroRole.PROTEIN },
    { slug: "beef_sirloin_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_tenderloin_cooked", role: MacroRole.PROTEIN },
    // Eggs
    { slug: "egg_whole_boiled", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_white_raw", role: MacroRole.PROTEIN },
    { slug: "liquid_egg_whites", role: MacroRole.PROTEIN },
    // Fish — omega-3 anti-inflammatory important for endurance
    { slug: "salmon_atlantic_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "salmon_sockeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "trout_rainbow_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "tuna_canned_water", role: MacroRole.PROTEIN },
    { slug: "cod_cooked", role: MacroRole.PROTEIN },
    { slug: "tilapia_cooked", role: MacroRole.PROTEIN },
    { slug: "shrimp_cooked", role: MacroRole.PROTEIN },
    { slug: "scallops_cooked", role: MacroRole.PROTEIN },
    // Plant
    { slug: "tofu_firm", role: MacroRole.PROTEIN },
    { slug: "tempeh", role: MacroRole.PROTEIN },
    { slug: "edamame_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_CARB },
    // Dairy
    { slug: "greek_yogurt_nonfat_plain", role: MacroRole.PROTEIN },
    { slug: "greek_yogurt_2_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "skyr_plain", role: MacroRole.PROTEIN },
    { slug: "cottage_cheese_low_fat", role: MacroRole.PROTEIN },
    { slug: "milk_skim", role: MacroRole.PROTEIN },
    { slug: "milk_2_percent", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Supplement (isolate tier 1 — fast post-workout)
    { slug: "whey_protein_isolate", role: MacroRole.SUPPLEMENT },

    // CARBS — the star of Endurance. Fast + slow.
    { slug: "white_rice_cooked", role: MacroRole.CARB },
    { slug: "jasmine_rice_cooked", role: MacroRole.CARB },
    { slug: "basmati_rice_cooked", role: MacroRole.CARB },
    { slug: "brown_rice_cooked", role: MacroRole.CARB },
    { slug: "pasta_cooked", role: MacroRole.CARB },
    { slug: "whole_wheat_pasta_cooked", role: MacroRole.CARB },
    { slug: "rice_noodles_cooked", role: MacroRole.CARB },
    { slug: "egg_noodles_cooked", role: MacroRole.CARB },
    { slug: "potato_russet_baked", role: MacroRole.CARB },
    { slug: "potato_red_boiled", role: MacroRole.CARB },
    { slug: "potato_mashed", role: MacroRole.CARB },
    { slug: "sweet_potato_baked", role: MacroRole.CARB },
    { slug: "yam_boiled", role: MacroRole.CARB },
    { slug: "cassava_boiled", role: MacroRole.CARB },
    { slug: "oats_rolled_dry", role: MacroRole.CARB },
    { slug: "oatmeal_cooked_water", role: MacroRole.CARB },
    { slug: "oats_steel_cut_dry", role: MacroRole.CARB },
    { slug: "quinoa_cooked", role: MacroRole.CARB },
    { slug: "white_bread", role: MacroRole.CARB },
    { slug: "whole_wheat_bread", role: MacroRole.CARB },
    { slug: "sourdough_bread", role: MacroRole.CARB },
    { slug: "bagel_plain", role: MacroRole.CARB },
    { slug: "english_muffin_whole_wheat", role: MacroRole.CARB },
    { slug: "tortilla_corn", role: MacroRole.CARB },
    { slug: "tortilla_flour", role: MacroRole.CARB },
    { slug: "pita_whole_wheat", role: MacroRole.CARB },
    { slug: "naan", role: MacroRole.CARB },
    // Legumes
    { slug: "lentils_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "chickpeas_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "black_beans_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },

    // High-carb fruits (endurance loves these)
    { slug: "banana_raw", role: MacroRole.FRUIT, notes: "Classic pre-workout carb." },
    { slug: "dates_medjool", role: MacroRole.FRUIT, notes: "Fast fuel — pre/intra workout." },
    { slug: "raisins", role: MacroRole.FRUIT },
    { slug: "mango_raw", role: MacroRole.FRUIT },
    { slug: "pineapple_raw", role: MacroRole.FRUIT },
    { slug: "grapes_raw", role: MacroRole.FRUIT },
    { slug: "watermelon_raw", role: MacroRole.FRUIT },
    { slug: "orange_raw", role: MacroRole.FRUIT },
    { slug: "apple_raw", role: MacroRole.FRUIT },
    { slug: "blueberries_raw", role: MacroRole.FRUIT },
    { slug: "strawberries_raw", role: MacroRole.FRUIT },
    { slug: "cherries_raw", role: MacroRole.FRUIT, notes: "Tart cherry aids recovery." },
    { slug: "pomegranate_raw", role: MacroRole.FRUIT },

    // Electrolyte / hydration
    { slug: "coconut_water", role: MacroRole.BEVERAGE, notes: "Natural electrolytes." },
    { slug: "apple_juice", role: MacroRole.BEVERAGE, notes: "Intra-workout fuel." },
    { slug: "orange_juice", role: MacroRole.BEVERAGE, notes: "Vit C + fast carbs." },

    // Veggies (endurance still needs vitamins)
    { slug: "broccoli_steamed", role: MacroRole.VEGGIE },
    { slug: "spinach_cooked", role: MacroRole.VEGGIE },
    { slug: "spinach_raw", role: MacroRole.VEGGIE },
    { slug: "kale_cooked", role: MacroRole.VEGGIE },
    { slug: "carrots_cooked", role: MacroRole.VEGGIE },
    { slug: "carrots_raw", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_red_raw", role: MacroRole.VEGGIE },
    { slug: "tomato_roma_raw", role: MacroRole.VEGGIE },
    { slug: "cherry_tomatoes", role: MacroRole.VEGGIE },
    { slug: "onion_yellow_raw", role: MacroRole.VEGGIE },
    { slug: "zucchini_raw", role: MacroRole.VEGGIE },
    { slug: "cucumber_raw", role: MacroRole.VEGGIE },
    { slug: "romaine_lettuce", role: MacroRole.VEGGIE },
    { slug: "beets_cooked", role: MacroRole.VEGGIE, notes: "Nitrate — endurance performance." },
    { slug: "corn_kernels_cooked", role: MacroRole.CARB }, // canonical

    // Moderate fats (kept tight; avocado + olive oil workhorses)
    { slug: "olive_oil", role: MacroRole.FAT },
    { slug: "avocado_raw", role: MacroRole.FAT },
    { slug: "almonds_raw", role: MacroRole.FAT },
    { slug: "walnuts_raw", role: MacroRole.FAT },
    { slug: "chia_seeds", role: MacroRole.FAT },
    { slug: "flax_seeds", role: MacroRole.FAT },
    { slug: "hemp_seeds", role: MacroRole.FAT },
    { slug: "peanut_butter_smooth", role: MacroRole.FAT },

    // Condiments
    { slug: "honey", role: MacroRole.CONDIMENT, notes: "Pre/post-workout fast carb." },
    { slug: "maple_syrup", role: MacroRole.CONDIMENT, notes: "Pre/post-workout fast carb." },
    { slug: "salsa", role: MacroRole.CONDIMENT },
    { slug: "soy_sauce_low_sodium", role: MacroRole.CONDIMENT },
    { slug: "dijon_mustard", role: MacroRole.CONDIMENT },
    { slug: "balsamic_vinegar", role: MacroRole.CONDIMENT },
    { slug: "marinara_sauce", role: MacroRole.CONDIMENT },
  ],

  tier_2: [
    { slug: "whey_protein_concentrate", role: MacroRole.SUPPLEMENT },
    { slug: "casein_protein", role: MacroRole.SUPPLEMENT },
    { slug: "pea_protein_powder", role: MacroRole.SUPPLEMENT },

    // Fattier proteins (fat budget is tight for endurance)
    { slug: "ground_beef_cooked_80", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "beef_ribeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "chicken_drumstick_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_pork_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "turkey_thigh_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Fatty dairy (OK in moderation)
    { slug: "cheddar_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "mozzarella_cheese_part_skim", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "parmesan_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "milk_whole", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Dried fruits — useful but dense
    { slug: "figs_dried", role: MacroRole.FRUIT },
    { slug: "prunes_dried", role: MacroRole.FRUIT },
    { slug: "dried_cranberries", role: MacroRole.FRUIT },
    // Extra fats
    { slug: "cashews_raw", role: MacroRole.FAT },
    { slug: "pistachios_raw", role: MacroRole.FAT },
    { slug: "almond_butter", role: MacroRole.FAT },
    { slug: "cashew_butter", role: MacroRole.FAT },
    { slug: "butter_unsalted", role: MacroRole.FAT },
    { slug: "ghee", role: MacroRole.FAT },
    // Sugar in isolation — useful for intra-workout fuel
    { slug: "white_sugar", role: MacroRole.CARB, notes: "OK intra-workout; not for regular meals." },
    { slug: "brown_sugar", role: MacroRole.CARB },
    { slug: "agave_syrup", role: MacroRole.CONDIMENT },
  ],

  tier_3: [
    // Heavy-fat / slow-digesting foods bad for pre-workout
    {
      slug: "heavy_cream",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Too fat-dense; slows digestion pre-training.",
    },
    {
      slug: "mayonnaise",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Calorie-dense with low micronutrient return.",
    },
    {
      slug: "ranch_dressing",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
    },
    // Cured / processed proteins
    {
      slug: "bacon_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Sodium + slow digestion.",
    },
    {
      slug: "beef_jerky",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Very high sodium.",
    },
    {
      slug: "italian_sausage_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
    },
    // Flags
    {
      slug: "beef_liver_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.FLAG_TO_COACH,
      coach_note: "Organ meat; confirm client comfort. High purines.",
    },
    // High-fiber legumes mid-training can cause GI distress
    {
      slug: "kidney_beans_cooked",
      role: MacroRole.CARB,
      hybrid: HybridTagKind.PROTEIN_CARB,
      tag: Tier3Tag.FLAG_TO_COACH,
      coach_note: "High-fiber legumes near workout window can cause GI distress for some runners. Keep them >3hr from training.",
    },
  ],

  frequency_caps: [
    {
      slug: "chicken_breast_cooked_skinless",
      max_per_week: 3,
      reason: "Anchor-protein variety.",
    },
    {
      slug: "salmon_atlantic_cooked",
      max_per_week: 2,
      reason: "Rotate omega-3 sources.",
    },
    {
      slug: "tuna_canned_water",
      max_per_week: 3,
      reason: "Mercury rotation.",
    },
  ],

  generator_prompt_notes: [
    "Endurance = carb-forward. Carbs fill the calorie target after protein (0.85 g/lb) and fat (0.30 g/lb).",
    "TRAINING DAYS use endurance_5_meal_training_day with pre/post-workout slots.",
    "REST DAYS use endurance_3_meal_rest_day with standard meals.",
    "Pre-workout slot: volume-biased, low-fat, easy-digest (banana, rice, toast + jam).",
    "Post-workout slot: density-biased, fast carb + protein (rice + chicken, dates + whey).",
    "Avoid high-fiber legumes within 3hrs of training.",
  ],

  coach_notes: [
    "Endurance is the ONLY build that uses per-day variable meal counts (training 5, rest 3). PDF renderer must support this.",
    "Rest-day kcal is -300 vs training — this builds in carb cycling.",
    "Beet/nitrate boost and tart cherry for recovery are science-backed — keep them in the rotation.",
    "Watch iron + B12 in lower-protein plans; consider bloodwork every 6 months for heavy-volume clients.",
  ],
};

export default endurance;
