/**
 * Build spec: MAINTAIN (healthy sustainable eating, no kcal offset).
 *
 * Zero kcal offset (eat at TDEE). Protein 1.0 g/lb, fat 0.35 g/lb. Balanced
 * carbs. Designed for clients at goal weight who want a sustainable plan
 * that preserves lean mass without pushing surplus or deficit.
 *
 * Per-check confirmations:
 *   [X] All slugs exist in the Supabase ingredients table
 *   [X] whey_protein_concentrate is in tier_2 (not tier_1)
 *   [X] Canonical slugs only
 *   [X] Every tier_3 entry has an explicit Tier3Tag
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

const maintain: BuildSpec = {
  id: BuildType.MAINTAIN,
  label: "Maintain",
  description:
    "Eat at TDEE. Balanced protein (1.0 g/lb), moderate fat (0.35 g/lb), " +
    "balanced carbs. For clients at goal weight who want a sustainable " +
    "long-term plan.",

  kcal_offset_from_tdee: 0,
  protein_g_per_lb: 1.00,
  fat_pct_of_kcal: 0.30,
  rest_day_kcal_drop: -150,
  rest_day_protein_change: 0,
  rest_day_carbs_change: -38,
  rest_day_fat_change: 0,

  tier_1_protein_min_pct_of_anchored_slots: 0.70,
  tier_1_carb_min_pct_of_anchored_slots: 0.75,

  default_distribution: DistributionTemplateId.STANDARD_3_MEAL,
  allowed_distributions: [
    DistributionTemplateId.STANDARD_3_MEAL,
    DistributionTemplateId.LUNCH_CENTERED_3_MEAL,
    DistributionTemplateId.STANDARD_4_MEAL,
    DistributionTemplateId.ATHLETE_5_MEAL,
  ],
  per_day_variable_meals: false,
  default_solver_bias: SolverBias.NEUTRAL,

  tier_1: [
    // Balanced protein selection
    { slug: "chicken_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "chicken_thigh_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "turkey_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_turkey_cooked_93", role: MacroRole.PROTEIN },
    { slug: "ground_beef_cooked_90", role: MacroRole.PROTEIN },
    { slug: "beef_sirloin_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_tenderloin_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_loin_cooked", role: MacroRole.PROTEIN },
    { slug: "egg_whole_boiled", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_whole_raw", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_white_raw", role: MacroRole.PROTEIN },
    { slug: "salmon_atlantic_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "salmon_sockeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cod_cooked", role: MacroRole.PROTEIN },
    { slug: "tilapia_cooked", role: MacroRole.PROTEIN },
    { slug: "tuna_canned_water", role: MacroRole.PROTEIN },
    { slug: "shrimp_cooked", role: MacroRole.PROTEIN },
    { slug: "trout_rainbow_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "tofu_firm", role: MacroRole.PROTEIN },
    { slug: "tempeh", role: MacroRole.PROTEIN },
    { slug: "greek_yogurt_2_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "greek_yogurt_nonfat_plain", role: MacroRole.PROTEIN },
    { slug: "cottage_cheese_low_fat", role: MacroRole.PROTEIN },
    { slug: "skyr_plain", role: MacroRole.PROTEIN },
    { slug: "whey_protein_isolate", role: MacroRole.SUPPLEMENT },

    // Balanced carbs
    { slug: "oats_rolled_dry", role: MacroRole.CARB },
    { slug: "oatmeal_cooked_water", role: MacroRole.CARB },
    { slug: "brown_rice_cooked", role: MacroRole.CARB },
    { slug: "basmati_rice_cooked", role: MacroRole.CARB },
    { slug: "jasmine_rice_cooked", role: MacroRole.CARB },
    { slug: "quinoa_cooked", role: MacroRole.CARB },
    { slug: "sweet_potato_baked", role: MacroRole.CARB },
    { slug: "potato_red_boiled", role: MacroRole.CARB },
    { slug: "potato_russet_baked", role: MacroRole.CARB },
    { slug: "whole_wheat_pasta_cooked", role: MacroRole.CARB },
    { slug: "whole_wheat_bread", role: MacroRole.CARB },
    { slug: "sourdough_bread", role: MacroRole.CARB },
    { slug: "pita_whole_wheat", role: MacroRole.CARB },
    { slug: "english_muffin_whole_wheat", role: MacroRole.CARB },
    { slug: "black_beans_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "lentils_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "chickpeas_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },

    // Fruits
    { slug: "apple_raw", role: MacroRole.FRUIT },
    { slug: "banana_raw", role: MacroRole.FRUIT },
    { slug: "blueberries_raw", role: MacroRole.FRUIT },
    { slug: "strawberries_raw", role: MacroRole.FRUIT },
    { slug: "raspberries_raw", role: MacroRole.FRUIT },
    { slug: "orange_raw", role: MacroRole.FRUIT },
    { slug: "pear_raw", role: MacroRole.FRUIT },
    { slug: "grapes_raw", role: MacroRole.FRUIT },
    { slug: "pineapple_raw", role: MacroRole.FRUIT },
    { slug: "mango_raw", role: MacroRole.FRUIT },

    // Veggies (canonical)
    { slug: "broccoli_steamed", role: MacroRole.VEGGIE },
    { slug: "spinach_cooked", role: MacroRole.VEGGIE },
    { slug: "spinach_raw", role: MacroRole.VEGGIE },
    { slug: "kale_cooked", role: MacroRole.VEGGIE },
    { slug: "asparagus_cooked", role: MacroRole.VEGGIE },
    { slug: "brussels_sprouts_cooked", role: MacroRole.VEGGIE },
    { slug: "green_beans_cooked", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_red_raw", role: MacroRole.VEGGIE },
    { slug: "zucchini_raw", role: MacroRole.VEGGIE },
    { slug: "cauliflower_cooked", role: MacroRole.VEGGIE },
    { slug: "carrots_cooked", role: MacroRole.VEGGIE },
    { slug: "tomato_roma_raw", role: MacroRole.VEGGIE },
    { slug: "onion_yellow_raw", role: MacroRole.VEGGIE },
    { slug: "romaine_lettuce", role: MacroRole.VEGGIE },
    { slug: "mixed_greens", role: MacroRole.VEGGIE },
    { slug: "cucumber_raw", role: MacroRole.VEGGIE },

    // Fats
    { slug: "olive_oil", role: MacroRole.FAT },
    { slug: "avocado_raw", role: MacroRole.FAT },
    { slug: "avocado_oil", role: MacroRole.FAT },
    { slug: "almonds_raw", role: MacroRole.FAT },
    { slug: "walnuts_raw", role: MacroRole.FAT },
    { slug: "pecans_raw", role: MacroRole.FAT },
    { slug: "chia_seeds", role: MacroRole.FAT },
    { slug: "flax_seeds", role: MacroRole.FAT },
    { slug: "hemp_seeds", role: MacroRole.FAT },
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
    { slug: "whey_protein_concentrate", role: MacroRole.SUPPLEMENT },
    { slug: "casein_protein", role: MacroRole.SUPPLEMENT },
    { slug: "pea_protein_powder", role: MacroRole.SUPPLEMENT },

    { slug: "ground_beef_cooked_80", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "beef_ribeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "chicken_drumstick_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_chicken_cooked", role: MacroRole.PROTEIN },
    { slug: "turkey_thigh_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "ground_pork_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },

    // Refined carbs
    { slug: "white_rice_cooked", role: MacroRole.CARB },
    { slug: "pasta_cooked", role: MacroRole.CARB },
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
    { slug: "ketchup", role: MacroRole.CONDIMENT },
    { slug: "bbq_sauce", role: MacroRole.CONDIMENT },

    // Extra nut options
    { slug: "cashews_raw", role: MacroRole.FAT },
    { slug: "pistachios_raw", role: MacroRole.FAT },
    { slug: "cashew_butter", role: MacroRole.FAT },
    { slug: "butter_unsalted", role: MacroRole.FAT },
    { slug: "ghee", role: MacroRole.FAT },

    // Dried fruits
    { slug: "raisins", role: MacroRole.FRUIT },
    { slug: "dates_medjool", role: MacroRole.FRUIT },
    { slug: "dried_cranberries", role: MacroRole.FRUIT },
    { slug: "figs_dried", role: MacroRole.FRUIT },
  ],

  tier_3: [
    // Cured proteins
    {
      slug: "bacon_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Sodium + sat fat; cap at 2×/week.",
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
    // Organ meat
    {
      slug: "beef_liver_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.FLAG_TO_COACH,
      coach_note: "Organ meat; confirm client comfort. High purines/vit A.",
    },
    // Isolated sugars
    {
      slug: "white_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "Use sparingly in baking/drinks; not as standalone.",
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
      notes: "Prefer honey / maple.",
    },
    // High-cal condiments
    {
      slug: "mayonnaise",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "OK measured.",
    },
    {
      slug: "ranch_dressing",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "Measured serving only.",
    },
    {
      slug: "heavy_cream",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "OK in coffee / sauces — measured.",
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
  ],

  generator_prompt_notes: [
    "Maintain = eat at TDEE, no offset. Balanced across all macros.",
    "Both whole and refined carbs OK; prefer whole ~70% of the time.",
    "Weekly check-in: if weight drifts >1 kg in either direction over 2 weeks, recalibrate.",
  ],

  coach_notes: [
    "Default maintenance build: client is at goal, wants sustainability.",
    "Watch for drift both up and down; client may need nudge to a different build after 4–6 weeks if goals change.",
  ],
};

export default maintain;
