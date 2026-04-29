/**
 * Build spec: SHRED (aggressive fat loss).
 *
 * Aggressive deficit (-350 kcal) with the highest protein ratio (1.15 g/lb)
 * and tightest fat (0.30 g/lb). Solver biases toward high-volume-per-kcal
 * foods to preserve satiety during the cut.
 *
 * Per-check confirmations:
 *   [X] All slugs exist in the Supabase ingredients table
 *   [X] whey_protein_concentrate is in tier_2 (not tier_1)
 *   [X] Canonical slugs only
 *   [X] Every tier_3 entry has an explicit Tier3Tag
 *   [X] High-cal condiments hard-excluded; dense fats soft-capped
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

const shred: BuildSpec = {
  id: BuildType.SHRED,
  label: "Shred",
  description:
    "Aggressive fat-loss deficit (-350 kcal) with maximal protein to preserve " +
    "muscle. Volume-biased solver picks high-fiber, high-water-content foods " +
    "to keep the client full on fewer calories.",

  kcal_offset_from_tdee: -350,
  protein_g_per_lb: 1.15,
  fat_pct_of_kcal: 0.25,
  rest_day_kcal_drop: -300,
  rest_day_protein_change: 0,
  rest_day_carbs_change: -75,
  rest_day_fat_change: 0,

  tier_1_protein_min_pct_of_anchored_slots: 0.80,
  tier_1_carb_min_pct_of_anchored_slots: 0.80,

  default_distribution: DistributionTemplateId.STANDARD_4_MEAL,
  allowed_distributions: [
    DistributionTemplateId.STANDARD_3_MEAL,
    DistributionTemplateId.STANDARD_4_MEAL,
    DistributionTemplateId.ATHLETE_5_MEAL,
    DistributionTemplateId.BODYBUILDER_6_MEAL,
  ],
  per_day_variable_meals: false,
  default_solver_bias: SolverBias.VOLUME,

  tier_1: [
    // Leanest proteins
    { slug: "chicken_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "turkey_breast_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "ground_turkey_cooked_93", role: MacroRole.PROTEIN },
    { slug: "ground_beef_cooked_90", role: MacroRole.PROTEIN },
    { slug: "beef_sirloin_cooked", role: MacroRole.PROTEIN },
    { slug: "beef_flank_cooked", role: MacroRole.PROTEIN },
    { slug: "beef_tenderloin_cooked", role: MacroRole.PROTEIN },
    { slug: "pork_tenderloin_cooked", role: MacroRole.PROTEIN },
    { slug: "egg_white_raw", role: MacroRole.PROTEIN },
    { slug: "liquid_egg_whites", role: MacroRole.PROTEIN },
    { slug: "egg_whole_boiled", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Very lean seafood
    { slug: "cod_cooked", role: MacroRole.PROTEIN },
    { slug: "tilapia_cooked", role: MacroRole.PROTEIN },
    { slug: "halibut_cooked", role: MacroRole.PROTEIN },
    { slug: "mahi_mahi_cooked", role: MacroRole.PROTEIN },
    { slug: "shrimp_cooked", role: MacroRole.PROTEIN },
    { slug: "scallops_cooked", role: MacroRole.PROTEIN },
    { slug: "tuna_canned_water", role: MacroRole.PROTEIN },
    { slug: "tuna_yellowfin_cooked", role: MacroRole.PROTEIN },
    // Fatty fish (omega-3 value outweighs fat cost)
    { slug: "salmon_atlantic_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "salmon_sockeye_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "trout_rainbow_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    // Plant proteins
    { slug: "tofu_extra_firm", role: MacroRole.PROTEIN },
    { slug: "tofu_firm", role: MacroRole.PROTEIN },
    { slug: "tempeh", role: MacroRole.PROTEIN },
    // Low-fat dairy
    { slug: "greek_yogurt_nonfat_plain", role: MacroRole.PROTEIN },
    { slug: "cottage_cheese_low_fat", role: MacroRole.PROTEIN },
    { slug: "skyr_plain", role: MacroRole.PROTEIN },
    { slug: "whey_protein_isolate", role: MacroRole.SUPPLEMENT },

    // Fibrous / volume carbs
    { slug: "oats_rolled_dry", role: MacroRole.CARB },
    { slug: "oatmeal_cooked_water", role: MacroRole.CARB },
    { slug: "oats_steel_cut_dry", role: MacroRole.CARB },
    { slug: "sweet_potato_baked", role: MacroRole.CARB },
    { slug: "potato_red_boiled", role: MacroRole.CARB },
    { slug: "potato_russet_baked", role: MacroRole.CARB },
    { slug: "quinoa_cooked", role: MacroRole.CARB },
    { slug: "brown_rice_cooked", role: MacroRole.CARB },
    { slug: "whole_wheat_pasta_cooked", role: MacroRole.CARB },
    { slug: "whole_wheat_bread", role: MacroRole.CARB },
    // Legumes (protein+fiber combo great for satiety)
    { slug: "black_beans_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "lentils_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "chickpeas_cooked", role: MacroRole.CARB, hybrid: HybridTagKind.PROTEIN_CARB },
    { slug: "edamame_cooked", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_CARB },

    // Low-cal / high-volume fruits
    { slug: "strawberries_raw", role: MacroRole.FRUIT },
    { slug: "blueberries_raw", role: MacroRole.FRUIT },
    { slug: "raspberries_raw", role: MacroRole.FRUIT },
    { slug: "blackberries_raw", role: MacroRole.FRUIT },
    { slug: "watermelon_raw", role: MacroRole.FRUIT },
    { slug: "apple_raw", role: MacroRole.FRUIT },
    { slug: "grapefruit_raw", role: MacroRole.FRUIT },
    { slug: "orange_raw", role: MacroRole.FRUIT },
    { slug: "kiwi_raw", role: MacroRole.FRUIT },
    { slug: "cantaloupe_raw", role: MacroRole.FRUIT },

    // Vegetables (huge variety for volume — the Shred solver leans heavy here)
    { slug: "broccoli_steamed", role: MacroRole.VEGGIE },
    { slug: "broccoli_raw", role: MacroRole.VEGGIE, notes: "Raw salad slots only." },
    { slug: "spinach_raw", role: MacroRole.VEGGIE },
    { slug: "spinach_cooked", role: MacroRole.VEGGIE },
    { slug: "kale_raw", role: MacroRole.VEGGIE },
    { slug: "kale_cooked", role: MacroRole.VEGGIE },
    { slug: "arugula_raw", role: MacroRole.VEGGIE },
    { slug: "romaine_lettuce", role: MacroRole.VEGGIE },
    { slug: "mixed_greens", role: MacroRole.VEGGIE },
    { slug: "iceberg_lettuce", role: MacroRole.VEGGIE },
    { slug: "asparagus_cooked", role: MacroRole.VEGGIE },
    { slug: "brussels_sprouts_cooked", role: MacroRole.VEGGIE },
    { slug: "cauliflower_cooked", role: MacroRole.VEGGIE },
    { slug: "cabbage_cooked", role: MacroRole.VEGGIE },
    { slug: "cabbage_raw", role: MacroRole.VEGGIE },
    { slug: "bok_choy_raw", role: MacroRole.VEGGIE },
    { slug: "green_beans_cooked", role: MacroRole.VEGGIE },
    { slug: "snow_peas_cooked", role: MacroRole.VEGGIE },
    { slug: "zucchini_raw", role: MacroRole.VEGGIE },
    { slug: "yellow_squash_raw", role: MacroRole.VEGGIE },
    { slug: "cucumber_raw", role: MacroRole.VEGGIE },
    { slug: "celery_raw", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_red_raw", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_yellow_raw", role: MacroRole.VEGGIE },
    { slug: "bell_pepper_green_raw", role: MacroRole.VEGGIE },
    { slug: "tomato_roma_raw", role: MacroRole.VEGGIE }, // canonical
    { slug: "cherry_tomatoes", role: MacroRole.VEGGIE },
    { slug: "onion_yellow_raw", role: MacroRole.VEGGIE }, // canonical
    { slug: "red_onion_raw", role: MacroRole.VEGGIE },
    { slug: "mushroom_white_raw", role: MacroRole.VEGGIE },
    { slug: "radish_raw", role: MacroRole.VEGGIE },
    { slug: "carrots_raw", role: MacroRole.VEGGIE },
    { slug: "spaghetti_squash_cooked", role: MacroRole.VEGGIE },
    { slug: "eggplant_cooked", role: MacroRole.VEGGIE },

    // Lean fats (measured portions)
    { slug: "olive_oil", role: MacroRole.FAT },
    { slug: "avocado_raw", role: MacroRole.FAT },
    { slug: "chia_seeds", role: MacroRole.FAT },
    { slug: "flax_seeds", role: MacroRole.FAT },
    { slug: "almonds_raw", role: MacroRole.FAT },
    { slug: "walnuts_raw", role: MacroRole.FAT },

    // Free-ish condiments (flavor without calorie cost)
    { slug: "salsa", role: MacroRole.CONDIMENT }, // canonical
    { slug: "hot_sauce", role: MacroRole.CONDIMENT },
    { slug: "dijon_mustard", role: MacroRole.CONDIMENT },
    { slug: "apple_cider_vinegar", role: MacroRole.CONDIMENT },
    { slug: "balsamic_vinegar", role: MacroRole.CONDIMENT },
    { slug: "rice_vinegar", role: MacroRole.CONDIMENT },
    { slug: "soy_sauce_low_sodium", role: MacroRole.CONDIMENT },
    { slug: "lemon_raw", role: MacroRole.CONDIMENT },
    { slug: "lime_raw", role: MacroRole.CONDIMENT },
    // Herbs
    { slug: "basil_fresh", role: MacroRole.VEGGIE },
    { slug: "cilantro_fresh", role: MacroRole.VEGGIE },
    { slug: "parsley_fresh", role: MacroRole.VEGGIE },
    { slug: "mint_fresh", role: MacroRole.VEGGIE },
    { slug: "garlic_raw", role: MacroRole.VEGGIE },
    { slug: "ginger_raw", role: MacroRole.VEGGIE },
    { slug: "jalapeno_raw", role: MacroRole.VEGGIE },
  ],

  tier_2: [
    { slug: "whey_protein_concentrate", role: MacroRole.SUPPLEMENT },
    { slug: "casein_protein", role: MacroRole.SUPPLEMENT },
    { slug: "pea_protein_powder", role: MacroRole.SUPPLEMENT },

    // Moderate-fat proteins
    { slug: "chicken_thigh_cooked_skinless", role: MacroRole.PROTEIN },
    { slug: "pork_loin_cooked", role: MacroRole.PROTEIN },
    { slug: "greek_yogurt_2_plain", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },

    // Refined grains — use sparingly
    { slug: "white_rice_cooked", role: MacroRole.CARB },
    { slug: "basmati_rice_cooked", role: MacroRole.CARB },
    { slug: "jasmine_rice_cooked", role: MacroRole.CARB },
    { slug: "pasta_cooked", role: MacroRole.CARB },

    // Higher-calorie fruits (measure carefully)
    { slug: "banana_raw", role: MacroRole.FRUIT },
    { slug: "mango_raw", role: MacroRole.FRUIT },
    { slug: "grapes_raw", role: MacroRole.FRUIT },
    { slug: "pineapple_raw", role: MacroRole.FRUIT },
    { slug: "pear_raw", role: MacroRole.FRUIT },

    // Measured nut butters (very calorie-dense)
    { slug: "peanut_butter_smooth", role: MacroRole.FAT },
    { slug: "almond_butter", role: MacroRole.FAT },

    // Low-fat cheese
    { slug: "mozzarella_cheese_part_skim", role: MacroRole.PROTEIN, hybrid: HybridTagKind.PROTEIN_FAT },
    { slug: "feta_cheese", role: MacroRole.FAT, hybrid: HybridTagKind.PROTEIN_FAT },

    // Fermented veggies (Na cost, but good for gut / satiety)
    { slug: "kimchi", role: MacroRole.VEGGIE },
    { slug: "sauerkraut", role: MacroRole.VEGGIE },
    { slug: "pickles_dill", role: MacroRole.VEGGIE },
  ],

  tier_3: [
    // Hard-excluded high-cal condiments
    {
      slug: "mayonnaise",
      role: MacroRole.FAT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Calorie-dense fat with low volume return; use mustard / salsa instead.",
    },
    {
      slug: "ranch_dressing",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Too calorie-dense for a Shred target.",
    },
    {
      slug: "italian_dressing",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Use vinegars + olive oil measured separately.",
    },
    {
      slug: "bbq_sauce",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "High sugar.",
    },
    {
      slug: "ketchup",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 3,
      notes: "1–2 tbsp measured OK; easy to overdo.",
    },
    {
      slug: "agave_syrup",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated sugar.",
    },
    {
      slug: "maple_syrup",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated sugar.",
    },
    {
      slug: "honey",
      role: MacroRole.CONDIMENT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated sugar.",
    },
    {
      slug: "white_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated sugar.",
    },
    {
      slug: "brown_sugar",
      role: MacroRole.CARB,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Isolated sugar.",
    },
    // Cured / processed proteins
    {
      slug: "bacon_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Too calorie/sodium-dense for the deficit.",
    },
    {
      slug: "italian_sausage_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Calorie/sodium dense.",
    },
    {
      slug: "beef_jerky",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 1,
      notes: "High sodium; 1×/week max.",
    },
    // Dense fats capped
    {
      slug: "heavy_cream",
      role: MacroRole.FAT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Excessive kcal density for Shred.",
    },
    {
      slug: "butter_salted",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Measured only.",
    },
    {
      slug: "butter_unsalted",
      role: MacroRole.FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "Measured only.",
    },
    // Dried fruits — sugar bombs
    {
      slug: "raisins",
      role: MacroRole.FRUIT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Sugar-dense; pick fresh fruit.",
    },
    {
      slug: "dates_medjool",
      role: MacroRole.FRUIT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Sugar-dense; pick fresh fruit.",
    },
    {
      slug: "figs_dried",
      role: MacroRole.FRUIT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Sugar-dense; pick fresh fruit.",
    },
    {
      slug: "dried_cranberries",
      role: MacroRole.FRUIT,
      tag: Tier3Tag.HARD_EXCLUDE,
      notes: "Added sugar + dense.",
    },
    {
      slug: "prunes_dried",
      role: MacroRole.FRUIT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 2,
      notes: "OK 1–2×/week for fiber; measure carefully.",
    },
    // Fatty beef
    {
      slug: "ground_beef_cooked_80",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 1,
      notes: "Prefer 90% lean for Shred.",
    },
    {
      slug: "beef_ribeye_cooked",
      role: MacroRole.PROTEIN,
      hybrid: HybridTagKind.PROTEIN_FAT,
      tag: Tier3Tag.SOFT_EXCLUDE,
      frequency_cap: 1,
      notes: "Very fatty cut; 1×/week max.",
    },
    // Beef liver — flag
    {
      slug: "beef_liver_cooked",
      role: MacroRole.PROTEIN,
      tag: Tier3Tag.FLAG_TO_COACH,
      coach_note: "Organ meat: confirm client comfort. High purine, high vit A.",
    },
  ],

  frequency_caps: [
    {
      slug: "chicken_breast_cooked_skinless",
      max_per_week: 3,
      reason: "Anchor-protein variety.",
    },
    {
      slug: "ground_turkey_cooked_93",
      max_per_week: 3,
      reason: "Anchor-protein variety.",
    },
    {
      slug: "tuna_canned_water",
      max_per_week: 3,
      reason: "Mercury rotation.",
    },
  ],

  generator_prompt_notes: [
    "Shred = aggressive deficit. Protein is non-negotiable — hit 1.15 g/lb every day.",
    "Solver bias: VOLUME. Prefer high-fiber / high-water foods to preserve satiety.",
    "Exclude isolated sugars (honey, maple, agave, white/brown sugar) entirely.",
    "Fats tight at 0.30 g/lb — use measured nuts / oils only.",
    "Include fibrous veggies in 3 of every 4 slots where possible.",
  ],

  coach_notes: [
    "Expected rate: 0.75–1.5 lb/week. Stall at 2+ weeks → drop 100 kcal from carbs.",
    "Watch for training performance drop-off; if lifts tank > 15%, consider a diet break.",
    "Sodium still matters — don't pair Shred with a high-Na condiment profile.",
  ],
};

export default shred;
