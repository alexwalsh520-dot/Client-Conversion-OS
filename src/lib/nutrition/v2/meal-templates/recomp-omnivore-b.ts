/**
 * Recomp / Omnivore — Variant B
 *
 * Alternate 3-meal Recomp omnivore — savory-leaning breakfasts,
 * Mediterranean-inspired lunches, varied protein rotation. Phase B6a-pivot
 * revision: breakfast slots now follow the post-Santiago variety +
 * composition rules.
 *
 *   • Whey isolate is the breakfast anchor 3 days/week (Wed, Sat, Sun).
 *   • Liquid egg whites is the breakfast anchor 1 day/week (Tue) — also
 *     in the supplement-anchor set; combined supplement-anchor count is 4.
 *   • The other 3 breakfast slots use a low-density whole-food anchor
 *     (cottage cheese, Greek yogurt, eggs) with whey_protein_isolate as
 *     a NON-ANCHOR secondary.
 *
 * Anchor counts (audit-aware):
 *   • whey_protein_isolate: 3× as anchor.
 *   • liquid_egg_whites:    1× as anchor.
 *     → Combined supplement anchor count = 4 (≤ 5 cap).
 *   • cottage_cheese_low:   1× as anchor.
 *   • greek_yogurt_nonfat:  1× as anchor.
 *   • egg_whole_boiled:     1× as anchor.
 *
 * Whey appears as non-anchor secondary on the 4 non-whey-anchor days
 * (Mon, Thu, Fri + Tue alongside liquid_egg_whites). Non-anchor uses
 * are uncapped.
 *
 * Lunches and dinners are unchanged — anchor rotation already respects
 * the 3×/week per-slug whole-food cap.
 *
 * `dish_name` on each meal is the AUTHORED FALLBACK shown to the client
 * if the LLM dish-namer (post-solve, see src/lib/nutrition/v2/dish-namer)
 * fails or returns a malformed response.
 */

import { BuildType, DietaryStyle, type MealTemplate } from "../types";

export const RECOMP_OMNIVORE_B: MealTemplate = {
  id: "recomp_omnivore_b",
  build: BuildType.RECOMP,
  dietary: DietaryStyle.OMNIVORE,
  meals_per_day: 3,
  description:
    "Alternate 3-meal Recomp omnivore — savory-leaning breakfasts with whey supplementation, Mediterranean lunches, varied protein rotation",
  weekly_pattern: [
    {
      day_of_week: "monday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Pineapple Walnut Cottage Bowl",
          ingredients: [
            { slug: "cottage_cheese_low_fat", anchor: true, swap_chain: ["greek_yogurt_nonfat_plain", "greek_yogurt_2_plain", "whey_protein_isolate"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "liquid_egg_whites"] },
            // Carb source — pineapple alone caps at ~32g C even at max grams,
            // not enough to clear the slot's ~58g lower band. Oats supply
            // ~50–69g C in normal portions, leaving the solver headroom.
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oats_steel_cut_dry", "oatmeal_cooked_water"] },
            { slug: "pineapple_raw", anchor: false, swap_chain: ["mango_raw", "strawberries_raw"] },
            { slug: "walnuts_raw", anchor: false, swap_chain: ["almonds_raw", "pumpkin_seeds"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Mediterranean Turkey Sandwich",
          ingredients: [
            { slug: "turkey_breast_cooked_skinless", anchor: true, swap_chain: ["chicken_breast_cooked_skinless", "ground_turkey_cooked_93", "tofu_extra_firm"] },
            { slug: "sourdough_bread", anchor: false, swap_chain: ["whole_wheat_bread", "whole_wheat_pasta_cooked"] },
            { slug: "kale_raw", anchor: false, swap_chain: ["spinach_cooked", "broccoli_steamed"] },
            { slug: "avocado_raw", anchor: false, swap_chain: ["olive_oil", "almond_butter"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Lemon Tilapia with Brown Rice",
          ingredients: [
            { slug: "tilapia_cooked", anchor: true, swap_chain: ["cod_cooked", "mahi_mahi_cooked", "tofu_extra_firm"] },
            // Tier-1 carb anchor.
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "basmati_rice_cooked"] },
            { slug: "zucchini_raw", anchor: false, swap_chain: ["bell_pepper_red_raw", "mushroom_white_raw"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
      ],
    },
    {
      day_of_week: "tuesday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Egg White Avocado Toast",
          ingredients: [
            { slug: "liquid_egg_whites", anchor: true, swap_chain: ["egg_white_raw", "egg_whole_boiled", "whey_protein_isolate"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "egg_white_raw"] },
            { slug: "sourdough_bread", anchor: false, swap_chain: ["whole_wheat_bread", "oats_rolled_dry"] },
            { slug: "avocado_raw", anchor: false, swap_chain: ["olive_oil", "avocado_oil"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Roasted Chicken & Red Potatoes",
          ingredients: [
            { slug: "chicken_thigh_cooked_skinless", anchor: true, swap_chain: ["chicken_breast_cooked_skinless", "turkey_breast_cooked_skinless", "tofu_extra_firm"] },
            { slug: "potato_red_boiled", anchor: false, swap_chain: ["potato_russet_baked", "sweet_potato_baked"] },
            { slug: "green_beans_cooked", anchor: false, swap_chain: ["asparagus_cooked", "broccoli_steamed"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Mahi Mahi Quinoa Plate",
          ingredients: [
            { slug: "mahi_mahi_cooked", anchor: true, swap_chain: ["cod_cooked", "tilapia_cooked", "tofu_extra_firm"] },
            { slug: "quinoa_cooked", anchor: false, swap_chain: ["basmati_rice_cooked", "brown_rice_cooked"] },
            { slug: "mushroom_white_raw", anchor: false, swap_chain: ["zucchini_raw", "bell_pepper_red_raw"] },
            { slug: "sunflower_seeds", anchor: false, swap_chain: ["pumpkin_seeds", "almonds_raw"] },
          ],
        },
      ],
    },
    {
      day_of_week: "wednesday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Almond Butter Banana Oats",
          ingredients: [
            { slug: "whey_protein_isolate", anchor: true, swap_chain: ["casein_protein", "pea_protein_powder", "greek_yogurt_nonfat_plain"] },
            // Tier-1 carb anchor (oats_rolled is tier_1; oats_steel_cut is unrostered).
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oatmeal_cooked_water", "whole_wheat_bread"] },
            { slug: "banana_raw", anchor: false, swap_chain: ["apple_raw", "mango_raw"] },
            { slug: "almond_butter", anchor: false, swap_chain: ["peanut_butter_smooth", "walnuts_raw"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Flank Steak with Pepper Rice",
          ingredients: [
            { slug: "beef_flank_cooked", anchor: true, swap_chain: ["beef_sirloin_cooked", "beef_tenderloin_cooked", "chicken_breast_cooked_skinless"] },
            // Tier-1 carb anchor.
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "basmati_rice_cooked"] },
            { slug: "bell_pepper_red_raw", anchor: false, swap_chain: ["zucchini_raw", "mushroom_white_raw"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Seared Tuna with Sweet Potato",
          ingredients: [
            { slug: "tuna_yellowfin_cooked", anchor: true, swap_chain: ["tuna_canned_water", "salmon_sockeye_cooked", "tofu_extra_firm"] },
            { slug: "sweet_potato_baked", anchor: false, swap_chain: ["potato_russet_baked", "quinoa_cooked"] },
            { slug: "cucumber_raw", anchor: false, swap_chain: ["bell_pepper_red_raw", "kale_raw"] },
            { slug: "avocado_raw", anchor: false, swap_chain: ["olive_oil", "walnuts_raw"] },
          ],
        },
      ],
    },
    {
      day_of_week: "thursday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Mango Chia Yogurt Parfait",
          ingredients: [
            { slug: "greek_yogurt_nonfat_plain", anchor: true, swap_chain: ["greek_yogurt_2_plain", "cottage_cheese_low_fat", "whey_protein_isolate"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "liquid_egg_whites"] },
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oats_steel_cut_dry", "oatmeal_cooked_water"] },
            { slug: "mango_raw", anchor: false, swap_chain: ["pineapple_raw", "orange_raw"] },
            // Fat source — anchor (yogurt) and supports are all near-zero fat.
            // Chia at 5–60g range gives fine-grained fat control without the
            // overshoot risk of nuts.
            { slug: "chia_seeds", anchor: false, swap_chain: ["flax_seeds", "hemp_seeds"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Chicken Pasta Primavera",
          ingredients: [
            { slug: "chicken_breast_cooked_skinless", anchor: true, swap_chain: ["turkey_breast_cooked_skinless", "ground_turkey_cooked_93", "tofu_extra_firm"] },
            { slug: "whole_wheat_pasta_cooked", anchor: false, swap_chain: ["quinoa_cooked", "whole_wheat_bread"] },
            { slug: "zucchini_raw", anchor: false, swap_chain: ["mushroom_white_raw", "bell_pepper_red_raw"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Buttered Salmon & Potatoes",
          ingredients: [
            { slug: "salmon_sockeye_cooked", anchor: true, swap_chain: ["salmon_atlantic_cooked", "cod_cooked", "tofu_extra_firm"] },
            // Tier-1 carb anchor.
            { slug: "potato_red_boiled", anchor: false, swap_chain: ["sweet_potato_baked", "potato_russet_baked"] },
            { slug: "asparagus_cooked", anchor: false, swap_chain: ["green_beans_cooked", "broccoli_steamed"] },
            { slug: "butter_unsalted", anchor: false, swap_chain: ["olive_oil", "avocado_oil"] },
          ],
        },
      ],
    },
    {
      day_of_week: "friday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Savory Mushroom Egg Toast",
          ingredients: [
            { slug: "egg_whole_boiled", anchor: true, swap_chain: ["liquid_egg_whites", "greek_yogurt_nonfat_plain"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "liquid_egg_whites"] },
            { slug: "sourdough_bread", anchor: false, swap_chain: ["whole_wheat_bread", "oats_rolled_dry"] },
            { slug: "mushroom_white_raw", anchor: false, swap_chain: ["spinach_cooked", "zucchini_raw"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Beef & Broccoli Rice",
          ingredients: [
            { slug: "ground_beef_cooked_90", anchor: true, swap_chain: ["ground_turkey_cooked_93", "beef_sirloin_cooked", "chicken_breast_cooked_skinless"] },
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "basmati_rice_cooked"] },
            { slug: "broccoli_steamed", anchor: false, swap_chain: ["green_beans_cooked", "asparagus_cooked"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Halibut with Kale & Quinoa",
          ingredients: [
            { slug: "halibut_cooked", anchor: true, swap_chain: ["cod_cooked", "mahi_mahi_cooked", "tofu_extra_firm"] },
            { slug: "quinoa_cooked", anchor: false, swap_chain: ["basmati_rice_cooked", "brown_rice_cooked"] },
            { slug: "kale_raw", anchor: false, swap_chain: ["spinach_cooked", "asparagus_cooked"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "avocado_raw"] },
          ],
        },
      ],
    },
    {
      day_of_week: "saturday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Peanut Butter Apple Oatmeal",
          ingredients: [
            { slug: "whey_protein_isolate", anchor: true, swap_chain: ["casein_protein", "pea_protein_powder", "greek_yogurt_nonfat_plain"] },
            { slug: "oatmeal_cooked_water", anchor: false, swap_chain: ["oats_rolled_dry", "oats_steel_cut_dry"] },
            { slug: "apple_raw", anchor: false, swap_chain: ["banana_raw", "orange_raw"] },
            { slug: "peanut_butter_smooth", anchor: false, swap_chain: ["almond_butter", "walnuts_raw"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Chicken with Asparagus & Sweet Potato",
          ingredients: [
            { slug: "chicken_breast_cooked_skinless", anchor: true, swap_chain: ["turkey_breast_cooked_skinless", "ground_turkey_cooked_93", "tofu_extra_firm"] },
            { slug: "sweet_potato_baked", anchor: false, swap_chain: ["potato_red_boiled", "quinoa_cooked"] },
            // asparagus (14 mg Na/100g) chosen over spinach_cooked (306 mg) to
            // keep Sat under the daily sodium cap × 1.15 — Sat dinner already
            // has high-Na shrimp (395 mg) so the lunch can't stack two more
            // high-Na ingredients (sweet_potato is 246 mg).
            { slug: "asparagus_cooked", anchor: false, swap_chain: ["green_beans_cooked", "kale_raw"] },
            { slug: "pumpkin_seeds", anchor: false, swap_chain: ["sunflower_seeds", "almonds_raw"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Mediterranean Shrimp Pasta",
          ingredients: [
            { slug: "shrimp_cooked", anchor: true, swap_chain: ["scallops_cooked", "cod_cooked", "tofu_extra_firm"] },
            { slug: "whole_wheat_pasta_cooked", anchor: false, swap_chain: ["quinoa_cooked", "brown_rice_cooked"] },
            { slug: "cucumber_raw", anchor: false, swap_chain: ["bell_pepper_red_raw", "zucchini_raw"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
      ],
    },
    {
      day_of_week: "sunday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Blueberry Hemp Protein Oats",
          ingredients: [
            { slug: "whey_protein_isolate", anchor: true, swap_chain: ["casein_protein", "pea_protein_powder", "greek_yogurt_nonfat_plain"] },
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oats_steel_cut_dry", "oatmeal_cooked_water"] },
            { slug: "blueberries_raw", anchor: false, swap_chain: ["raspberries_raw", "strawberries_raw"] },
            { slug: "hemp_seeds", anchor: false, swap_chain: ["chia_seeds", "flax_seeds"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Pork Tenderloin with Rice & Green Beans",
          ingredients: [
            { slug: "pork_tenderloin_cooked", anchor: true, swap_chain: ["chicken_breast_cooked_skinless", "turkey_breast_cooked_skinless", "tofu_extra_firm"] },
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "basmati_rice_cooked"] },
            { slug: "green_beans_cooked", anchor: false, swap_chain: ["asparagus_cooked", "broccoli_steamed"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Beef Tenderloin & Sweet Potato",
          ingredients: [
            { slug: "beef_tenderloin_cooked", anchor: true, swap_chain: ["beef_sirloin_cooked", "beef_flank_cooked", "chicken_breast_cooked_skinless"] },
            { slug: "sweet_potato_baked", anchor: false, swap_chain: ["potato_russet_baked", "quinoa_cooked"] },
            { slug: "asparagus_cooked", anchor: false, swap_chain: ["broccoli_steamed", "kale_raw"] },
            { slug: "butter_unsalted", anchor: false, swap_chain: ["olive_oil", "avocado_oil"] },
          ],
        },
      ],
    },
  ],
};

export default RECOMP_OMNIVORE_B;
