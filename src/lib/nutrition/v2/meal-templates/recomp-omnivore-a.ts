/**
 * Recomp / Omnivore — Variant A
 *
 * Standard 3-meal Recomp omnivore. Phase B6a-pivot revision: breakfast
 * slots now follow the post-Santiago variety + composition rules.
 *
 *   • Whey isolate is the breakfast anchor 3 days/week (Mon, Wed, Fri).
 *   • The other 4 breakfast slots use a low-density whole-food anchor
 *     (eggs, Greek yogurt, cottage cheese) with whey_protein_isolate as
 *     a NON-ANCHOR secondary to absorb the residual protein gap. This
 *     prevents the joint-macro infeasibility we saw in Santiago's run
 *     where supporting bread/oats/nuts overshot the breakfast carb/fat
 *     bands while reaching for the protein target.
 *
 * Anchor counts (audit-aware):
 *   • whey_protein_isolate: 3× as anchor (combined supplement cap 5).
 *   • egg_whole_boiled:     2× as anchor (whole-food cap 3).
 *   • greek_yogurt_nonfat:  1× as anchor.
 *   • cottage_cheese_low:   1× as anchor.
 *
 * Whey appears as non-anchor secondary on the other 4 breakfasts (Tue,
 * Thu, Sat, Sun). Non-anchor uses are uncapped.
 *
 * Lunches and dinners are unchanged — anchor rotation already respects
 * the new 3×/week per-slug whole-food cap.
 *
 * `dish_name` on each meal is the AUTHORED FALLBACK shown to the client
 * if the LLM dish-namer (post-solve, see src/lib/nutrition/v2/dish-namer)
 * fails or returns a malformed response. The LLM is the primary source
 * for dish names so they always reflect what the solver actually
 * rendered on the plate.
 */

import { BuildType, DietaryStyle, type MealTemplate } from "../types";

export const RECOMP_OMNIVORE_A: MealTemplate = {
  id: "recomp_omnivore_a",
  build: BuildType.RECOMP,
  dietary: DietaryStyle.OMNIVORE,
  meals_per_day: 3,
  description:
    "Standard 3-meal Recomp omnivore — chicken/rice/fish baseline with whole-food variety; breakfasts pair low-density anchors with whey secondary",
  weekly_pattern: [
    {
      day_of_week: "monday",
      meals: [
        {
          slot: 1,
          name: "Breakfast",
          dish_name: "Blueberry Almond Protein Oats",
          ingredients: [
            { slug: "whey_protein_isolate", anchor: true, swap_chain: ["casein_protein", "pea_protein_powder", "greek_yogurt_nonfat_plain"] },
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oats_steel_cut_dry", "oatmeal_cooked_water"] },
            { slug: "blueberries_raw", anchor: false, swap_chain: ["raspberries_raw", "strawberries_raw"] },
            { slug: "almonds_raw", anchor: false, swap_chain: ["walnuts_raw", "sunflower_seeds"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Lemon Herb Chicken & Rice",
          ingredients: [
            { slug: "chicken_breast_cooked_skinless", anchor: true, swap_chain: ["turkey_breast_cooked_skinless", "ground_turkey_cooked_93", "tofu_extra_firm"] },
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "basmati_rice_cooked"] },
            { slug: "broccoli_steamed", anchor: false, swap_chain: ["green_beans_cooked", "asparagus_cooked"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Salmon with Roasted Sweet Potato",
          ingredients: [
            { slug: "salmon_atlantic_cooked", anchor: true, swap_chain: ["salmon_sockeye_cooked", "cod_cooked", "tofu_extra_firm"] },
            { slug: "sweet_potato_baked", anchor: false, swap_chain: ["potato_russet_baked", "quinoa_cooked"] },
            { slug: "spinach_cooked", anchor: false, swap_chain: ["kale_raw", "broccoli_steamed"] },
            { slug: "avocado_raw", anchor: false, swap_chain: ["olive_oil", "walnuts_raw"] },
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
          dish_name: "Avocado Toast with Soft Eggs",
          ingredients: [
            { slug: "egg_whole_boiled", anchor: true, swap_chain: ["liquid_egg_whites", "greek_yogurt_nonfat_plain"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "liquid_egg_whites"] },
            { slug: "whole_wheat_bread", anchor: false, swap_chain: ["sourdough_bread", "oats_rolled_dry"] },
            { slug: "avocado_raw", anchor: false, swap_chain: ["olive_oil", "almond_butter"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Smoky Beef & Pepper Rice",
          ingredients: [
            { slug: "ground_beef_cooked_90", anchor: true, swap_chain: ["ground_turkey_cooked_93", "chicken_breast_cooked_skinless"] },
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "basmati_rice_cooked"] },
            { slug: "bell_pepper_red_raw", anchor: false, swap_chain: ["zucchini_raw", "mushroom_white_raw"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Seared Cod with Quinoa Pilaf",
          ingredients: [
            { slug: "cod_cooked", anchor: true, swap_chain: ["tilapia_cooked", "mahi_mahi_cooked", "tofu_extra_firm"] },
            { slug: "quinoa_cooked", anchor: false, swap_chain: ["brown_rice_cooked", "sweet_potato_baked"] },
            { slug: "asparagus_cooked", anchor: false, swap_chain: ["broccoli_steamed", "green_beans_cooked"] },
            { slug: "walnuts_raw", anchor: false, swap_chain: ["almonds_raw", "pumpkin_seeds"] },
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
          dish_name: "Strawberry Chia Protein Oats",
          ingredients: [
            { slug: "whey_protein_isolate", anchor: true, swap_chain: ["casein_protein", "pea_protein_powder", "greek_yogurt_nonfat_plain"] },
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oatmeal_cooked_water", "whole_wheat_bread"] },
            { slug: "strawberries_raw", anchor: false, swap_chain: ["raspberries_raw", "blueberries_raw"] },
            { slug: "chia_seeds", anchor: false, swap_chain: ["flax_seeds", "hemp_seeds"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Turkey & Sweet Potato Plate",
          ingredients: [
            { slug: "turkey_breast_cooked_skinless", anchor: true, swap_chain: ["chicken_breast_cooked_skinless", "ground_turkey_cooked_93", "tofu_extra_firm"] },
            { slug: "sweet_potato_baked", anchor: false, swap_chain: ["potato_russet_baked", "quinoa_cooked"] },
            { slug: "green_beans_cooked", anchor: false, swap_chain: ["broccoli_steamed", "asparagus_cooked"] },
            { slug: "almond_butter", anchor: false, swap_chain: ["peanut_butter_smooth", "olive_oil"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Shrimp Zucchini Pasta",
          ingredients: [
            { slug: "shrimp_cooked", anchor: true, swap_chain: ["scallops_cooked", "cod_cooked", "tofu_extra_firm"] },
            { slug: "whole_wheat_pasta_cooked", anchor: false, swap_chain: ["quinoa_cooked", "brown_rice_cooked"] },
            { slug: "zucchini_raw", anchor: false, swap_chain: ["bell_pepper_red_raw", "mushroom_white_raw"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
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
          dish_name: "Raspberry Almond Yogurt Parfait",
          ingredients: [
            { slug: "greek_yogurt_nonfat_plain", anchor: true, swap_chain: ["greek_yogurt_2_plain", "cottage_cheese_low_fat", "whey_protein_isolate"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "liquid_egg_whites"] },
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oats_steel_cut_dry", "oatmeal_cooked_water"] },
            { slug: "raspberries_raw", anchor: false, swap_chain: ["blueberries_raw", "strawberries_raw"] },
            // Fat source — required because the anchor (Greek yogurt) and other
            // supports are all near-zero fat; without this the slot can't reach
            // the breakfast fat lower band even at ±20%. See diagnostic notes.
            { slug: "almonds_raw", anchor: false, swap_chain: ["walnuts_raw", "pumpkin_seeds"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Chicken with Spinach Rice",
          ingredients: [
            { slug: "chicken_breast_cooked_skinless", anchor: true, swap_chain: ["turkey_breast_cooked_skinless", "ground_turkey_cooked_93", "tofu_extra_firm"] },
            // Tier-1 carb anchor (brown_rice is tier_1; basmati/jasmine are tier_2).
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "whole_wheat_pasta_cooked"] },
            { slug: "spinach_cooked", anchor: false, swap_chain: ["kale_raw", "broccoli_steamed"] },
            { slug: "avocado_oil", anchor: false, swap_chain: ["olive_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Sirloin Steak with Buttered Potatoes",
          ingredients: [
            { slug: "beef_sirloin_cooked", anchor: true, swap_chain: ["beef_tenderloin_cooked", "beef_flank_cooked", "chicken_breast_cooked_skinless"] },
            // Tier-1 carb anchor (potato_red is tier_1; potato_russet is tier_2).
            { slug: "potato_red_boiled", anchor: false, swap_chain: ["sweet_potato_baked", "potato_russet_baked"] },
            { slug: "mushroom_white_raw", anchor: false, swap_chain: ["zucchini_raw", "asparagus_cooked"] },
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
          dish_name: "Peanut Butter Banana Oatmeal",
          ingredients: [
            { slug: "whey_protein_isolate", anchor: true, swap_chain: ["casein_protein", "pea_protein_powder", "greek_yogurt_nonfat_plain"] },
            { slug: "oatmeal_cooked_water", anchor: false, swap_chain: ["oats_rolled_dry", "oats_steel_cut_dry"] },
            { slug: "banana_raw", anchor: false, swap_chain: ["apple_raw", "mango_raw"] },
            { slug: "peanut_butter_smooth", anchor: false, swap_chain: ["almond_butter", "walnuts_raw"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Tuna Cucumber Sandwich",
          ingredients: [
            { slug: "tuna_canned_water", anchor: true, swap_chain: ["tuna_yellowfin_cooked", "chicken_breast_cooked_skinless", "tofu_extra_firm"] },
            { slug: "whole_wheat_bread", anchor: false, swap_chain: ["sourdough_bread", "whole_wheat_pasta_cooked"] },
            { slug: "cucumber_raw", anchor: false, swap_chain: ["bell_pepper_red_raw", "zucchini_raw"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "avocado_raw"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Pork Tenderloin & Quinoa",
          ingredients: [
            { slug: "pork_tenderloin_cooked", anchor: true, swap_chain: ["chicken_breast_cooked_skinless", "turkey_breast_cooked_skinless", "tofu_extra_firm"] },
            { slug: "quinoa_cooked", anchor: false, swap_chain: ["brown_rice_cooked", "sweet_potato_baked"] },
            { slug: "broccoli_steamed", anchor: false, swap_chain: ["green_beans_cooked", "asparagus_cooked"] },
            { slug: "pumpkin_seeds", anchor: false, swap_chain: ["sunflower_seeds", "almonds_raw"] },
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
          dish_name: "Hard-Boiled Egg Avocado Toast",
          ingredients: [
            { slug: "egg_whole_boiled", anchor: true, swap_chain: ["liquid_egg_whites", "greek_yogurt_nonfat_plain"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "liquid_egg_whites"] },
            // whole_wheat_bread (~410mg Na/100g) chosen over sourdough (~520mg)
            // to keep Sat under the daily sodium cap × 1.15.
            { slug: "whole_wheat_bread", anchor: false, swap_chain: ["sourdough_bread", "oats_rolled_dry"] },
            { slug: "avocado_raw", anchor: false, swap_chain: ["olive_oil", "almond_butter"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Turkey Pepper Stir-Fry",
          ingredients: [
            { slug: "ground_turkey_cooked_93", anchor: true, swap_chain: ["ground_beef_cooked_90", "chicken_breast_cooked_skinless", "tofu_extra_firm"] },
            { slug: "brown_rice_cooked", anchor: false, swap_chain: ["quinoa_cooked", "basmati_rice_cooked"] },
            { slug: "bell_pepper_red_raw", anchor: false, swap_chain: ["zucchini_raw", "broccoli_steamed"] },
            { slug: "avocado_raw", anchor: false, swap_chain: ["olive_oil", "avocado_oil"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Tilapia with Roasted Potatoes",
          ingredients: [
            { slug: "tilapia_cooked", anchor: true, swap_chain: ["cod_cooked", "mahi_mahi_cooked", "tofu_extra_firm"] },
            { slug: "potato_red_boiled", anchor: false, swap_chain: ["potato_russet_baked", "sweet_potato_baked"] },
            { slug: "asparagus_cooked", anchor: false, swap_chain: ["green_beans_cooked", "broccoli_steamed"] },
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
          dish_name: "Apple Chia Cottage Cheese Parfait",
          ingredients: [
            { slug: "cottage_cheese_low_fat", anchor: true, swap_chain: ["greek_yogurt_nonfat_plain", "greek_yogurt_2_plain", "whey_protein_isolate"] },
            { slug: "whey_protein_isolate", anchor: false, swap_chain: ["casein_protein", "pea_protein_powder", "liquid_egg_whites"] },
            { slug: "oats_rolled_dry", anchor: false, swap_chain: ["oats_steel_cut_dry", "oatmeal_cooked_water"] },
            { slug: "apple_raw", anchor: false, swap_chain: ["banana_raw", "orange_raw"] },
            // Fat source — anchor (cottage cheese) and other supports are all
            // near-zero fat. Chia at 5–60g range gives the solver fine-grained
            // fat headroom (10g chia ≈ 3g F, 35g ≈ 10.8g F) without the
            // overshoot risk of nuts at high grams.
            { slug: "chia_seeds", anchor: false, swap_chain: ["flax_seeds", "hemp_seeds"] },
          ],
        },
        {
          slot: 2,
          name: "Lunch",
          dish_name: "Roasted Chicken Thigh & Sweet Potato",
          ingredients: [
            { slug: "chicken_thigh_cooked_skinless", anchor: true, swap_chain: ["chicken_breast_cooked_skinless", "turkey_breast_cooked_skinless", "tofu_extra_firm"] },
            { slug: "sweet_potato_baked", anchor: false, swap_chain: ["potato_russet_baked", "quinoa_cooked"] },
            { slug: "kale_raw", anchor: false, swap_chain: ["spinach_cooked", "broccoli_steamed"] },
            { slug: "olive_oil", anchor: false, swap_chain: ["avocado_oil", "butter_unsalted"] },
          ],
        },
        {
          slot: 3,
          name: "Dinner",
          dish_name: "Buttery Seared Scallops",
          ingredients: [
            { slug: "scallops_cooked", anchor: true, swap_chain: ["shrimp_cooked", "cod_cooked", "tofu_extra_firm"] },
            // Tier-1 carb anchor (quinoa is tier_1; basmati/jasmine are tier_2).
            { slug: "quinoa_cooked", anchor: false, swap_chain: ["brown_rice_cooked", "basmati_rice_cooked"] },
            { slug: "green_beans_cooked", anchor: false, swap_chain: ["asparagus_cooked", "broccoli_steamed"] },
            { slug: "butter_unsalted", anchor: false, swap_chain: ["olive_oil", "avocado_oil"] },
          ],
        },
      ],
    },
  ],
};

export default RECOMP_OMNIVORE_A;
