import { BuildType, DietaryStyle, MealTemplate } from '../types';

export const RECOMP_OMNIVORE_NO_NUTS_A: MealTemplate = {
  id: 'recomp_omnivore_no_nuts_a',
  build: BuildType.RECOMP,
  dietary: DietaryStyle.OMNIVORE,
  meals_per_day: 3,
  description: 'Recomp omnivore, tree-nut-allergy variant A. All almonds/walnuts/pecans/cashews/pistachios/hazelnuts/macadamia/pine nuts/brazil nuts and almond/cashew butters removed. Fat sources rotate across seeds (sunflower, pumpkin, chia, flax, hemp), seed butters (tahini), avocado, olive/avocado oil, and fat-dense anchors (salmon, eggs, ribeye, lamb). Slots follow Template A/B structural pattern: one anchor + one secondary (when needed) + one real-grain carb + one fat source. Tier-1 carb coverage maintained via oats, brown rice, quinoa, sweet potato, whole-wheat bread/pasta, farro, and red potato.',
  weekly_pattern: [
    {
      day_of_week: 'monday',
      meals: [
        {
          slot: 1,
          name: 'Breakfast',
          dish_name: 'Berry Sunflower Protein Oats',
          ingredients: [
            { slug: 'whey_protein_isolate', anchor: true, swap_chain: ['casein_protein', 'pea_protein_powder'] },
            { slug: 'oats_rolled_dry', anchor: false, swap_chain: ['oatmeal_cooked_water', 'quinoa_cooked'] },
            { slug: 'blueberries_raw', anchor: false, swap_chain: ['raspberries_raw', 'strawberries_raw'] },
            { slug: 'sunflower_seeds', anchor: false, swap_chain: ['pumpkin_seeds', 'chia_seeds'] }
          ]
        },
        {
          slot: 2,
          name: 'Lunch',
          dish_name: 'Lemon Herb Chicken & Rice',
          ingredients: [
            { slug: 'chicken_breast_cooked_skinless', anchor: true, swap_chain: ['turkey_breast_cooked_skinless', 'chicken_thigh_cooked_skinless'] },
            { slug: 'brown_rice_cooked', anchor: false, swap_chain: ['quinoa_cooked', 'farro_cooked'] },
            { slug: 'broccoli_raw', anchor: false, swap_chain: ['asparagus_cooked', 'green_beans_cooked'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'butter_unsalted'] }
          ]
        },
        {
          slot: 3,
          name: 'Dinner',
          dish_name: 'Salmon with Sweet Potato',
          ingredients: [
            { slug: 'salmon_atlantic_cooked', anchor: true, swap_chain: ['salmon_sockeye_cooked', 'trout_rainbow_cooked'] },
            { slug: 'sweet_potato_baked', anchor: false, swap_chain: ['potato_red_boiled', 'quinoa_cooked'] },
            { slug: 'spinach_raw', anchor: false, swap_chain: ['kale_cooked', 'asparagus_cooked'] },
            { slug: 'avocado_raw', anchor: false, swap_chain: ['avocado_oil', 'olive_oil'] }
          ]
        }
      ]
    },
    {
      day_of_week: 'tuesday',
      meals: [
        {
          slot: 1,
          name: 'Breakfast',
          dish_name: 'Greek Yogurt Berry Bowl',
          ingredients: [
            { slug: 'greek_yogurt_nonfat_plain', anchor: true, swap_chain: ['greek_yogurt_2_plain', 'skyr_plain'] },
            { slug: 'whey_protein_isolate', anchor: false, swap_chain: ['casein_protein', 'pea_protein_powder'] },
            { slug: 'strawberries_raw', anchor: false, swap_chain: ['blueberries_raw', 'raspberries_raw'] },
            { slug: 'chia_seeds', anchor: false, swap_chain: ['flax_seeds', 'hemp_seeds'] }
          ]
        },
        {
          slot: 2,
          name: 'Lunch',
          dish_name: 'Turkey Quinoa Power Plate',
          ingredients: [
            { slug: 'ground_turkey_cooked_93', anchor: true, swap_chain: ['ground_chicken_cooked', 'chicken_breast_cooked_skinless'] },
            { slug: 'quinoa_cooked', anchor: false, swap_chain: ['brown_rice_cooked', 'farro_cooked'] },
            { slug: 'bell_pepper_red_raw', anchor: false, swap_chain: ['zucchini_raw', 'tomato_raw'] },
            { slug: 'avocado_raw', anchor: false, swap_chain: ['olive_oil', 'avocado_oil'] }
          ]
        },
        {
          slot: 3,
          name: 'Dinner',
          dish_name: 'Sirloin & Roasted Potatoes',
          ingredients: [
            { slug: 'beef_sirloin_cooked', anchor: true, swap_chain: ['beef_tenderloin_cooked', 'pork_tenderloin_cooked'] },
            { slug: 'potato_red_boiled', anchor: false, swap_chain: ['sweet_potato_baked', 'quinoa_cooked'] },
            { slug: 'green_beans_cooked', anchor: false, swap_chain: ['asparagus_cooked', 'broccoli_raw'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'butter_unsalted'] }
          ]
        }
      ]
    },
    {
      day_of_week: 'wednesday',
      meals: [
        {
          slot: 1,
          name: 'Breakfast',
          dish_name: 'Veggie Scramble with Toast',
          ingredients: [
            { slug: 'egg_whole_boiled', anchor: true, swap_chain: ['egg_whole_raw', 'liquid_egg_whites'] },
            { slug: 'whey_protein_isolate', anchor: false, swap_chain: ['casein_protein', 'pea_protein_powder'] },
            { slug: 'whole_wheat_bread', anchor: false, swap_chain: ['sourdough_bread', 'oats_rolled_dry'] },
            { slug: 'bell_pepper_green_raw', anchor: false, swap_chain: ['mushroom_white_raw', 'tomato_raw'] }
          ]
        },
        {
          slot: 2,
          name: 'Lunch',
          dish_name: 'Pork Tenderloin Quinoa Bowl',
          ingredients: [
            { slug: 'pork_tenderloin_cooked', anchor: true, swap_chain: ['pork_loin_cooked', 'chicken_breast_cooked_skinless'] },
            { slug: 'quinoa_cooked', anchor: false, swap_chain: ['brown_rice_cooked', 'farro_cooked'] },
            { slug: 'cucumber_raw', anchor: false, swap_chain: ['mixed_greens', 'romaine_lettuce'] },
            { slug: 'avocado_raw', anchor: false, swap_chain: ['olive_oil', 'avocado_oil'] }
          ]
        },
        {
          slot: 3,
          name: 'Dinner',
          dish_name: 'Roasted Chicken with Farro',
          ingredients: [
            { slug: 'chicken_thigh_cooked_skinless', anchor: true, swap_chain: ['chicken_breast_cooked_skinless', 'turkey_breast_cooked_skinless'] },
            { slug: 'farro_cooked', anchor: false, swap_chain: ['brown_rice_cooked', 'quinoa_cooked'] },
            { slug: 'brussels_sprouts_cooked', anchor: false, swap_chain: ['asparagus_cooked', 'green_beans_cooked'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'butter_unsalted'] }
          ]
        }
      ]
    },
    {
      day_of_week: 'thursday',
      meals: [
        {
          slot: 1,
          name: 'Breakfast',
          dish_name: 'Cottage Cheese Peach Oats',
          ingredients: [
            { slug: 'cottage_cheese_low_fat', anchor: true, swap_chain: ['greek_yogurt_2_plain', 'skyr_plain'] },
            { slug: 'whey_protein_isolate', anchor: false, swap_chain: ['casein_protein', 'pea_protein_powder'] },
            { slug: 'oats_rolled_dry', anchor: false, swap_chain: ['oatmeal_cooked_water', 'quinoa_cooked'] },
            { slug: 'peach_raw', anchor: false, swap_chain: ['nectarine_raw', 'apricot_raw'] },
            { slug: 'flax_seeds', anchor: false, swap_chain: ['chia_seeds', 'hemp_seeds'] }
          ]
        },
        {
          slot: 2,
          name: 'Lunch',
          dish_name: 'Chicken Sweet Potato Bowl',
          ingredients: [
            { slug: 'chicken_thigh_cooked_skinless', anchor: true, swap_chain: ['chicken_breast_cooked_skinless', 'turkey_breast_cooked_skinless'] },
            { slug: 'sweet_potato_baked', anchor: false, swap_chain: ['brown_rice_cooked', 'quinoa_cooked'] },
            { slug: 'kale_cooked', anchor: false, swap_chain: ['asparagus_cooked', 'green_beans_cooked'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'tahini'] }
          ]
        },
        {
          slot: 3,
          name: 'Dinner',
          dish_name: 'Cod with Lemon Quinoa',
          ingredients: [
            { slug: 'cod_cooked', anchor: true, swap_chain: ['halibut_cooked', 'tilapia_cooked'] },
            { slug: 'quinoa_cooked', anchor: false, swap_chain: ['brown_rice_cooked', 'farro_cooked'] },
            { slug: 'zucchini_raw', anchor: false, swap_chain: ['yellow_squash_raw', 'asparagus_cooked'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'avocado_raw'] }
          ]
        }
      ]
    },
    {
      day_of_week: 'friday',
      meals: [
        {
          slot: 1,
          name: 'Breakfast',
          dish_name: 'Banana Hemp Overnight Oats',
          ingredients: [
            { slug: 'oats_rolled_dry', anchor: false, swap_chain: ['oatmeal_cooked_water', 'quinoa_cooked'] },
            { slug: 'whey_protein_isolate', anchor: true, swap_chain: ['casein_protein', 'pea_protein_powder'] },
            { slug: 'banana_raw', anchor: false, swap_chain: ['blueberries_raw', 'strawberries_raw'] },
            { slug: 'hemp_seeds', anchor: false, swap_chain: ['chia_seeds', 'flax_seeds'] }
          ]
        },
        {
          slot: 2,
          name: 'Lunch',
          dish_name: 'Mahi Mahi Rice Plate',
          ingredients: [
            { slug: 'mahi_mahi_cooked', anchor: true, swap_chain: ['tilapia_cooked', 'chicken_breast_cooked_skinless'] },
            { slug: 'brown_rice_cooked', anchor: false, swap_chain: ['quinoa_cooked', 'jasmine_rice_cooked'] },
            { slug: 'bell_pepper_red_raw', anchor: false, swap_chain: ['broccoli_raw', 'snow_peas_cooked'] },
            { slug: 'sesame_oil', anchor: false, swap_chain: ['avocado_oil', 'olive_oil'] }
          ]
        },
        {
          slot: 3,
          name: 'Dinner',
          dish_name: 'Ribeye with Mashed Potato',
          ingredients: [
            { slug: 'beef_ribeye_cooked', anchor: true, swap_chain: ['beef_sirloin_cooked', 'beef_tenderloin_cooked'] },
            { slug: 'potato_mashed', anchor: false, swap_chain: ['potato_red_boiled', 'sweet_potato_baked'] },
            { slug: 'asparagus_cooked', anchor: false, swap_chain: ['green_beans_cooked', 'broccoli_raw'] },
            { slug: 'butter_unsalted', anchor: false, swap_chain: ['olive_oil', 'avocado_oil'] }
          ]
        }
      ]
    },
    {
      day_of_week: 'saturday',
      meals: [
        {
          slot: 1,
          name: 'Breakfast',
          dish_name: 'Skyr Berry Seed Bowl',
          ingredients: [
            { slug: 'skyr_plain', anchor: true, swap_chain: ['greek_yogurt_nonfat_plain', 'greek_yogurt_2_plain'] },
            { slug: 'whey_protein_isolate', anchor: false, swap_chain: ['casein_protein', 'pea_protein_powder'] },
            { slug: 'raspberries_raw', anchor: false, swap_chain: ['blueberries_raw', 'blackberries_raw'] },
            { slug: 'pumpkin_seeds', anchor: false, swap_chain: ['sunflower_seeds', 'hemp_seeds'] }
          ]
        },
        {
          slot: 2,
          name: 'Lunch',
          dish_name: 'Turkey Avocado Wrap',
          ingredients: [
            { slug: 'turkey_breast_cooked_skinless', anchor: true, swap_chain: ['chicken_breast_cooked_skinless', 'ground_turkey_cooked_93'] },
            { slug: 'whole_wheat_bread', anchor: false, swap_chain: ['pita_whole_wheat', 'sourdough_bread'] },
            { slug: 'romaine_lettuce', anchor: false, swap_chain: ['mixed_greens', 'arugula_raw'] },
            { slug: 'avocado_raw', anchor: false, swap_chain: ['olive_oil', 'avocado_oil'] }
          ]
        },
        {
          slot: 3,
          name: 'Dinner',
          dish_name: 'Beef Bolognese over Pasta',
          ingredients: [
            { slug: 'ground_beef_cooked_90', anchor: true, swap_chain: ['ground_turkey_cooked_93', 'ground_chicken_cooked'] },
            { slug: 'whole_wheat_pasta_cooked', anchor: false, swap_chain: ['pasta_cooked', 'farro_cooked'] },
            { slug: 'tomato_raw', anchor: false, swap_chain: ['cherry_tomatoes', 'zucchini_raw'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'butter_unsalted'] }
          ]
        }
      ]
    },
    {
      day_of_week: 'sunday',
      meals: [
        {
          slot: 1,
          name: 'Breakfast',
          dish_name: 'Egg White Tahini Toast',
          ingredients: [
            { slug: 'liquid_egg_whites', anchor: true, swap_chain: ['egg_white_raw', 'egg_whole_boiled'] },
            { slug: 'whey_protein_isolate', anchor: false, swap_chain: ['casein_protein', 'pea_protein_powder'] },
            { slug: 'whole_wheat_bread', anchor: false, swap_chain: ['oats_rolled_dry', 'oatmeal_cooked_water'] },
            { slug: 'tahini', anchor: false, swap_chain: ['avocado_raw', 'olive_oil'] }
          ]
        },
        {
          slot: 2,
          name: 'Lunch',
          dish_name: 'Tilapia Quinoa Plate',
          ingredients: [
            { slug: 'tilapia_cooked', anchor: true, swap_chain: ['mahi_mahi_cooked', 'cod_cooked'] },
            { slug: 'quinoa_cooked', anchor: false, swap_chain: ['brown_rice_cooked', 'farro_cooked'] },
            { slug: 'cherry_tomatoes', anchor: false, swap_chain: ['cucumber_raw', 'mixed_greens'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'avocado_raw'] }
          ]
        },
        {
          slot: 3,
          name: 'Dinner',
          dish_name: 'Lamb Chops with Sweet Potato',
          ingredients: [
            { slug: 'lamb_chop_cooked', anchor: true, swap_chain: ['ground_lamb_cooked', 'beef_sirloin_cooked'] },
            { slug: 'sweet_potato_baked', anchor: false, swap_chain: ['potato_red_boiled', 'quinoa_cooked'] },
            { slug: 'mixed_greens', anchor: false, swap_chain: ['arugula_raw', 'spinach_raw'] },
            { slug: 'olive_oil', anchor: false, swap_chain: ['avocado_oil', 'butter_unsalted'] }
          ]
        }
      ]
    }
  ]
};
