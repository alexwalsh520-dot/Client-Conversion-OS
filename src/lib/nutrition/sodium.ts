/**
 * Sodium estimator.
 *
 * PRIMARY SOURCE: `row.sodium_mg_per_100g` from Supabase — populated
 * 279/279 from the USDA FoodData Central backfill. Any row with a
 * non-null DB value wins.
 *
 * FALLBACK: the hardcoded SODIUM_BY_SLUG / SODIUM_BY_CATEGORY lookup
 * below, kept for backwards compatibility if/when a new ingredient is
 * added that hasn't been synced yet. Under normal operation the fallback
 * path should not fire.
 */

import type { IngredientRow } from "./ingredient-filter";

// Explicit overrides — these dominate the daily sodium budget when used
const SODIUM_BY_SLUG: Record<string, number> = {
  // Dairy and cheese
  butter_salted: 643,
  butter_unsalted: 11,
  butter: 643, // default to salted if unspecified
  cheese_cheddar: 621,
  cheese_mozzarella: 627,
  cheese_mozzarella_part_skim: 627,
  cheese_parmesan: 1804,
  cheese_feta: 1116,
  cheese_swiss: 187,
  cheese_provolone: 876,
  cottage_cheese: 364,
  cottage_cheese_low_fat: 330,
  cream_cheese: 321,
  cream_cheese_light: 312,
  ricotta: 84,
  greek_yogurt: 36,
  greek_yogurt_plain: 36,
  milk_skim: 42,
  milk_2pct: 44,
  whole_milk: 44,
  // Processed / cured meats
  bacon_cooked: 1717,
  bacon: 1717,
  turkey_bacon: 1940,
  ham_cooked: 1203,
  sausage_cooked: 827,
  hot_dog: 1090,
  pepperoni: 1761,
  salami: 2260,
  deli_turkey: 1050,
  deli_chicken: 945,
  turkey_breast_deli: 1050,
  // Fresh meats / seafood baseline
  chicken_breast_cooked_skinless: 77,
  chicken_breast_roasted: 77,
  chicken_thigh_cooked_skinless: 85,
  chicken_drumstick_cooked_skinless: 87,
  ground_chicken_cooked: 80,
  ground_turkey_cooked_93: 77,
  turkey_breast_cooked_skinless: 60,
  beef_sirloin_cooked: 58,
  beef_tenderloin_cooked: 53,
  beef_ribeye_cooked: 56,
  ground_beef_cooked_90: 68,
  ground_beef_cooked_93: 68,
  ground_beef_cooked_80: 70,
  pork_tenderloin_cooked: 52,
  pork_loin_cooked: 51,
  salmon_atlantic_cooked: 50,
  salmon_cooked: 50,
  tuna_canned_water: 247,
  cod_cooked: 78,
  shrimp_cooked: 706, // naturally high
  eggs_whole_cooked: 124,
  eggs_whole: 124,
  egg_whites_cooked: 166,
  // Sauces and condiments — the big offenders
  soy_sauce: 5493,
  soy_sauce_low_sodium: 2860,
  marinara: 530,
  marinara_low_sugar: 530,
  ranch_dressing: 1047,
  italian_dressing: 820,
  balsamic_vinaigrette: 627,
  caesar_dressing: 1035,
  ketchup: 907,
  mustard: 1135,
  mayo: 635,
  hot_sauce: 2124,
  salsa: 420,
  bbq_sauce: 792,
  sriracha: 2124,
  teriyaki_sauce: 3835,
  // Breads / tortillas / starches (processed)
  tortilla_flour: 600,
  flour_tortilla: 600,
  tortilla_corn: 45,
  whole_wheat_bread: 455,
  sourdough: 546,
  white_bread: 491,
  english_muffin: 525,
  whole_wheat_english_muffin: 525,
  bagel: 440,
  whole_wheat_pita: 522,
  rice_cakes: 32,
  crackers: 700,
  // Pasta / rice — low
  white_rice_cooked: 1,
  brown_rice_cooked: 4,
  basmati_rice_cooked: 1,
  jasmine_rice_cooked: 1,
  pasta_cooked: 6,
  whole_wheat_pasta_cooked: 6,
  // Oils and fats — effectively zero
  olive_oil: 2,
  coconut_oil: 0,
  sesame_oil: 0,
  avocado_oil: 0,
  canola_oil: 0,
  // Fresh fruits and vegetables
  broccoli_raw: 33,
  broccoli_cooked: 41,
  spinach_raw: 79,
  spinach_cooked: 70,
  kale_raw: 38,
  asparagus_cooked: 14,
  asparagus_raw: 2,
  mixed_greens: 28,
  romaine_lettuce: 8,
  iceberg_lettuce: 10,
  cabbage_raw: 18,
  bell_pepper_red_raw: 4,
  bell_pepper_green_raw: 3,
  bell_pepper_yellow_raw: 2,
  tomato_raw: 5,
  cherry_tomatoes: 5,
  cucumber_raw: 2,
  onion_raw: 4,
  red_onion_raw: 4,
  green_onion_raw: 16,
  mushroom_raw: 5,
  carrot_raw: 69,
  zucchini_raw: 8,
  potato_baked: 10,
  sweet_potato_baked: 72,
  mashed_potato: 316,
  roasted_potatoes: 12,
  red_potato_baked: 12,
  corn_cooked: 1,
  green_beans_cooked: 6,
  brussels_sprouts_cooked: 25,
  // Legumes
  black_beans_cooked: 1,
  pinto_beans_cooked: 1,
  kidney_beans_cooked: 2,
  chickpeas_cooked: 7,
  lentils_cooked: 2,
  refried_beans: 480,
  hummus: 379,
  // Fruits
  banana: 1,
  apple_medium: 1,
  apple: 1,
  strawberries: 1,
  blueberries: 1,
  blackberries: 1,
  raspberries: 1,
  pineapple: 1,
  mango: 1,
  grapes: 2,
  watermelon: 1,
  orange: 0,
  avocado_raw: 7,
  // Nuts / seeds
  almonds: 1,
  walnuts: 2,
  peanut_butter: 486,
  peanut_butter_natural: 15,
  peanuts: 18,
  cashews: 12,
  chia_seeds: 16,
  // Grains / breakfast
  oatmeal_cooked: 6,
  oatmeal_dry: 6,
  rolled_oats: 6,
  whey_protein: 240,
  whey_protein_powder: 240,
  protein_bar: 250,
  granola: 294,
  // Misc beverages
  black_coffee: 4,
  orange_juice: 1,
  green_tea: 1,
};

// Category-based defaults when we don't have a slug entry.
// Tuned toward realistic average sodium for fresh unprocessed foods.
const SODIUM_BY_CATEGORY: Record<string, number> = {
  protein: 65, // fresh meat baseline
  seafood: 75,
  vegetable: 20,
  fruit: 3,
  dairy: 80,
  grain: 5,
  carb: 250, // processed carbs average (bread, tortilla)
  fat: 5,
  condiment: 400,
  legume: 5,
  beverage: 5,
  supplement: 100,
};

export function estimateSodiumMgPer100g(row: IngredientRow): number {
  // Prefer the DB-sourced USDA value when present
  if (row.sodium_mg_per_100g !== null && row.sodium_mg_per_100g !== undefined) {
    return Number(row.sodium_mg_per_100g);
  }
  // Exact slug override first (fallback path)
  if (row.slug in SODIUM_BY_SLUG) return SODIUM_BY_SLUG[row.slug];
  // Partial slug match for common patterns
  const s = row.slug.toLowerCase();
  const n = (row.name || "").toLowerCase();
  if (s.includes("salted") && s.includes("butter")) return 643;
  if (s.includes("unsalted") && s.includes("butter")) return 11;
  if (s.includes("butter") || n.includes("butter")) return 643;
  if (s.includes("cheese") || n.includes("cheese")) return 600;
  if (s.includes("bacon") || n.includes("bacon")) return 1700;
  if (s.includes("sausage") || n.includes("sausage")) return 800;
  if (s.includes("ham") || n.includes("ham")) return 1200;
  if (s.includes("tortilla") && (s.includes("flour") || n.includes("flour"))) return 600;
  if (s.includes("sourdough") || n.includes("sourdough")) return 546;
  if (s.includes("rice") && s.includes("cooked")) return 3;
  if (s.includes("pasta") && s.includes("cooked")) return 6;
  if (s.includes("soy_sauce") || n.includes("soy sauce")) return 5500;
  if (s.includes("dressing") || n.includes("dressing")) return 900;
  if (s.includes("marinara") || n.includes("marinara")) return 500;
  // Fallback to category
  return SODIUM_BY_CATEGORY[row.category] ?? 50;
}

/**
 * Compute total sodium (mg) for a day given ingredient rows and gram amounts.
 */
export function computeDailySodium(
  day: { meals: { ingredients: { slug: string; grams: number }[] }[] },
  byslug: Map<string, IngredientRow>
): number {
  let total = 0;
  for (const meal of day.meals) {
    for (const ing of meal.ingredients) {
      const row = byslug.get(ing.slug);
      if (!row) continue;
      total += estimateSodiumMgPer100g(row) * (ing.grams / 100);
    }
  }
  return Math.round(total);
}

/**
 * Returns the list of unique ingredient slugs referenced in the plan whose
 * DB row has null sodium_mg_per_100g. Used by the validator: any plan
 * referencing unknown-sodium ingredients cannot be validated for HBP
 * safety and must be blocked from shipping.
 *
 * Slugs that don't resolve to a DB row at all (typo/unsynced) are ALSO
 * returned — from a safety standpoint "unknown" is the same as "null".
 */
export function findIngredientsWithNullSodium(
  plan: { meals: { ingredients: { slug: string }[] }[] }[],
  byslug: Map<string, IngredientRow>
): string[] {
  const unknown = new Set<string>();
  for (const day of plan) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) {
        const row = byslug.get(ing.slug);
        if (!row) {
          unknown.add(ing.slug);
          continue;
        }
        if (row.sodium_mg_per_100g === null || row.sodium_mg_per_100g === undefined) {
          unknown.add(ing.slug);
        }
      }
    }
  }
  return Array.from(unknown).sort();
}

/**
 * Recommended daily sodium cap based on medical flags.
 *  - AHA recommends < 1500 mg/day for hypertensive patients
 *  - FDA general guidance is < 2300 mg/day
 *  - We use 2000 mg/day as the default target (more conservative)
 */
export function dailySodiumTargetMg(hasHypertension: boolean): number {
  return hasHypertension ? 1500 : 2000;
}
