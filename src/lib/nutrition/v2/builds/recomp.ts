/**
 * Build spec: RECOMP (body recomposition).
 *
 * Moderate deficit (-150 kcal) with high protein (1.10 g/lb) to preserve lean
 * mass while slowly dropping fat. Balanced tier 1 across macros; whey
 * concentrate sits in tier 2 per the blanket rule.
 *
 * Per-check confirmations (see self-check log in handoff report):
 *   [X] All slugs exist in the Supabase ingredients table
 *   [X] whey_protein_concentrate is in tier_2 (not tier_1)
 *   [X] Canonical slugs only: salsa, tomato_roma_raw, onion_yellow_raw,
 *       corn_kernels_cooked, broccoli_steamed
 *   [X] Every tier_3 entry has an explicit Tier3Tag
 *   [X] Hybrid ingredients tagged with HybridTagKind
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

const recomp: BuildSpec = {
  id: BuildType.RECOMP,
  label: "Recomp",
  description:
    "Moderate deficit (-150 kcal) with high protein (1.10 g/lb) to preserve " +
    "lean mass while dropping body fat slowly. Best for intermediate clients " +
    "with training experience.",

  kcal_offset_from_tdee: -150,
  protein_g_per_lb: 1.10,
  fat_pct_of_kcal: 0.30,
  rest_day_kcal_drop: -200,
  rest_day_protein_change: 0,
  rest_day_carbs_change: -50,
  rest_day_fat_change: 0,

  tier_1_protein_min_pct_of_anchored_slots: 0.70,
  tier_1_carb_min_pct_of_anchored_slots: 0.80,

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

  // ---- TIER 1: default pool ----
  tier_1: [
    // Lean proteins
    { slug: "chicken_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "chicken_thigh_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "turkey_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_turkey_cooked_93", role: MacroRole.PROTEIN },
    { slug: "ground_beef_cooked_90", role: MacroRole.PROTEIN },
    { slug: "beef_sirloin_cooked", role: MacroRole.PROTEIN },
    { slug: "beef_flank_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_tenderloin_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_loin_cooked", role: MacroRole.PROTEIN },
    // Eggs — whole eggs hybrid protein+fat
    { slug: "egg_whole_boiled", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_whole_raw", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "egg_white_raw", role: MacroRole.PROTEIN },
    { slug: "liquid_egg_whites", role: MacroRole.PROTEIN },
    // Seafood — salmon is hybrid protein+fat
    { slug: "salmon_atlantic_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "salmon_sockeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "tuna_canned_water", role: MacroRole.PROTEIN },
    { slug: "tuna_yellowfin_cooked", role: MacroRole.PROTEIN },
    { slug: "cod_cooked", role: MacroRole.PROTEIN },
    { slug: "tilapia_cooked", role: MacroRole.PROTEIN },
    { slug: "shrimp_cooked", role: MacroRole.PROTEIN },
    { slug: "trout_rainbow_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Plant proteins
    { slug: "tofu_firm", role: MacroRole.PROTEIN },
    { slug: "tofu_extra_firm", role: MacroRole.PROTEIN },
    { slug: "tempeh", role: MacroRole.PROTEIN },
    // Dairy (hybrid protein)
    { slug: "greek_yogurt_nonfat_plain", role: MacroRole.PROTEIN },
    { slug: "greek_yogurt_2_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cottage_cheese_low_fat", role: MacroRole.PROTEIN },
    { slug: "skyr_plain", role: MacroRole.PROTEIN },
    // Supplements
    { slug: "whey_protein_isolate", role: MacroRole.SUPPLEMENT },

    // Whole-food carbs
    { slug: "oats_rolled_dry", role: MacroRole.CARB },
    { slug: "oatmeal_cooked_water", role: MacroRole.CARB },
    { slug: "brown_rice_cooked", role: MacroRole.CARB },
    { slug: "quinoa_cooked", role: MacroRole.CARB },
    { slug: "sweet_potato_baked", role: MacroRole.CARB },
    { slug: "potato_red_boiled", role: MacroRole.CARB },
    { slug: "whole_wheat_pasta_cooked", role: MacroRole.CARB },
    { slug: "whole_wheat_bread", role: MacroRole.CARB },
    { slug: "sourdough_bread", role: MacroRole.CARB },
    { slug: "barley_cooked", role: MacroRole.CARB },
    { slug: "farro_cooked", role: MacroRole.CARB },
    // Legumes — hybrid protein+carb
    { slug: "black_beans_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "chickpeas_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "lentils_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },

    // Fruits
    { slug: "apple_raw", role: MacroRole.FRUIT },
    { slug: "banana_raw", role: MacroRole.FRUIT },
    { slug: "blueberries_raw", role: MacroRole.FRUIT },
    { slug: "strawberries_raw", role: MacroRole.FRUIT },
    { slug: "raspberries_raw", role: MacroRole.FRUIT },
    { slug: "orange_raw", role: MacroRole.FRUIT },
    { slug: "pear_raw", role: MacroRole.FRUIT },

    // Veggies (canonical slugs only)
    { slug: "broccoli_steamed", role: MacroRole.VEGGIE },
    { slug: "spinach_raw", role: MacroRole.VEGGIE },
    { slug: "spinach_cooked", role: MacroRole.VEGGIE },
    { slug: "kale_cooked", role: MacroRole.VEGGIE },
    { slug: "asparagus_cooked", role: MacroRole.VEGGIE },
    { slug: "brussels_sprouts_cooked", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_red_raw", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_green_raw", role: MacroRole.VEGGIE },
    { slug: "zucchini_raw", role: MacroRole.VEGGIE },
    { slug: "cauliflower_cooked", role: MacroRole.VEGGIE },
    { slug: "green_beans_cooked", role: MacroRole.VEGGIE },
    { slug: "carrots_raw", role: MacroRole.VEGGIE },
    { slug: "tomato_roma_raw", role: MacroRole.VEGGIE }, // canonical
    { slug: "cherry_tomatoes", role: MacroRole.VEGGIE },
    { slug: "cucumber_raw", role: MacroRole.VEGGIE },
    { slug: "romaine_lettuce", role: MacroRole.VEGGIE },
    { slug: "mixed_greens", role: MacroRole.VEGGIE },
    { slug: "onion_yellow_raw", role: MacroRole.VEGGIE }, // canonical

    // Healthy fats
    { slug: "olive_oil", role: MacroRole.FAT },
    { slug: "avocado_raw", role: MacroRole.FAT },
    { slug: "avocado_oil", role: MacroRole.FAT },
    { slug: "almonds_raw", role: MacroRole.FAT },
    { slug: "walnuts_raw", role: MacroRole.FAT },
    { slug: "chia_seeds", role: MacroRole.FAT },
    { slug: "flax_seeds", role: MacroRole.FAT },
    { slug: "pumpkin_seeds", role: MacroRole.FAT },

    // Condiments
    { slug: "salsa", role: MacroRole.CONDIMENT }, // canonical
    { slug: "dijon_mustard", role: MacroRole.CONDIMENT },
    { slug: "hot_sauce", role: MacroRole.CONDIMENT },
    { slug: "balsamic_vinegar", role: MacroRole.CONDIMENT },
    { slug: "apple_cider_vinegar", role: MacroRole.CONDIMENT },
    { slug: "soy_sauce_low_sodium", role: MacroRole.CONDIMENT },
  ],

  // ---- TIER 2: acceptable / moderate use ----
  tier_2: [
    // Blanket rule: whey concentrate always tier 2
    { slug: "whey_protein_concentrate", role: MacroRole.SUPPLEMENT },
    { slug: "casein_protein", role: MacroRole.SUPPLEMENT },
    { slug: "pea_protein_powder", role: MacroRole.SUPPLEMENT },
    // Fattier proteins
    { slug: "ground_beef_cooked_80", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "beef_ribeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "chicken_drumstick_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "chicken_wing_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "ground_chicken_cooked", role: MacroRole.PROTEIN },
    { slug: "turkey_thigh_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "ground_pork_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Refined grains — OK occasionally
    { slug: "white_rice_cooked", role: MacroRole.CARB },
    { slug: "basmati_rice_cooked", role: MacroRole.CARB },
    { slug: "jasmine_rice_cooked", role: MacroRole.CARB },
    { slug: "pasta_cooked", role: MacroRole.CARB },
    { slug: "potato_russet_baked", role: MacroRole.CARB },
    { slug: "white_bread", role: MacroRole.CARB },
    { slug: "bagel_plain", role: MacroRole.CARB },
    // Dairy with more fat
    { slug: "greek_yogurt_whole_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "cottage_cheese_full_fat", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "milk_2_percent", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "feta_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "mozzarella_cheese_part_skim", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "parmesan_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },
    // Higher-fat fats
    { slug: "butter_unsalted", role: MacroRole.FAT },
    { slug: "peanut_butter_smooth", role: MacroRole.FAT },
    { slug: "almond_butter", role: MacroRole.FAT },
    { slug: "cashews_raw", role: MacroRole.FAT },
    { slug: "pistachios_raw", role: MacroRole.FAT },
    // Sweet condiments / dressings
    { slug: "honey", role: MacroRole.CONDIMENT },
    { slug: "maple_syrup", role: MacroRole.CONDIMENT },
    { slug: "ketchup", role: MacroRole.CONDIMENT },
    { slug: "hummus", role: MacroRole.CONDIMENT, hybrid: HybridTagKind.CARB_FAT },
  ],

  // ---- TIER 3: excluded / soft-capped / flagged ----
  tier_3: [
    // Processed / cured proteins
    {
      slug: "bacon_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "High sodium + saturated fat; capped at 2 uses per week.",
    },
    {
      slug: "beef_jerky",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Very high sodium; capped at 2 uses per week.",
    },
    {
      slug: "italian_sausage_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Processed; high sodium.",
    },
    {
      slug: "ham_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Cured; high sodium.",
    },
    {
      slug: "beef_liver_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.FLAG_TO_COACH,
      coach_note:
        "Beef liver selected — confirm the client is comfortable with organ " +
        "meat. High in purines and vitamin A; avoid if gout or pregnancy.",
    },
    // High-sugar condiments
    {
      slug: "bbq_sauce",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "High added sugar.",
    },
    {
      slug: "ranch_dressing",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "High calorie-density; easy to overdo.",
    },
    {
      slug: "mayonnaise",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "OK in small amounts; measure carefully.",
    },
    // Sugars in isolation
    {
      slug: "white_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated added sugar — exclude from recomp.",
    },
    {
      slug: "brown_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated added sugar — exclude from recomp.",
    },
    {
      slug: "agave_syrup",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "High-fructose; no advantage over whole-food carbs.",
    },
    // Heavy cream
    {
      slug: "heavy_cream",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Very calorie-dense for a recomp deficit.",
    },
  ],

  // ---- FREQUENCY CAPS (variety / anchor protein repeat) ----
  frequency_caps: [
    {
      slug: "chicken_breast_cooked_skinless",
      max_per_week: 3,
      reason: "Prevent monotony; anchor-protein variety rule.",
    },
    {
      slug: "ground_beef_cooked_90",
      max_per_week: 3,
      reason: "Anchor-protein variety rule.",
    },
    {
      slug: "ground_turkey_cooked_93",
      max_per_week: 3,
      reason: "Anchor-protein variety rule.",
    },
    {
      slug: "salmon_atlantic_cooked",
      max_per_week: 2,
      reason: "Encourage fish rotation with other omega-3 sources.",
    },
    {
      slug: "salmon_sockeye_cooked",
      max_per_week: 2,
      reason: "Encourage fish rotation with other omega-3 sources.",
    },
  ],

  generator_prompt_notes: [
    "Recomp = high protein (1.10 g/lb), modest deficit. Never drop protein.",
    "Rotate anchor proteins; no single protein >2–3 uses per week.",
    "Prefer whole-food carbs (oats, rice, potatoes) over bread/pasta.",
    "Include 2–3 servings of vegetables in lunch and dinner.",
    "Fatty fish (salmon, trout) at least 1–2×/week for omega-3s.",
  ],

  coach_notes: [
    "Target: preserve lean mass, drop fat ~0.25–0.5 lb/week.",
    "If client hits a plateau, drop 100 kcal from carbs first, not protein.",
    "Whey concentrate is tier 2 — prefer isolate when budget allows.",
  ],
};

export default recomp;
