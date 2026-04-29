/**
 * Phase B2 — per-slug gram bounds (min, max) for solver constraints.
 *
 * Strategy:
 *   1. Default to a category-based range (CATEGORY_DEFAULTS) keyed off the
 *      Supabase ingredients.category column.
 *   2. Apply per-slug OVERRIDES for cases where the category default is
 *      wrong (e.g. avocado_raw lives in DB's "fat" category but its sensible
 *      portion is fruit-sized; chocolate_dark_70 is "fat" but a condiment-
 *      sized portion).
 *
 * Bounds apply ONLY when the slug is included in a slot (y = 1). When
 * y = 0, the bounds are irrelevant and x = 0 by linkage.
 *
 * Spec source: B2 brief sections "Per-ingredient gram bounds" + special
 * cases I called out in pre-coding ambiguity surface.
 */

import type { GramBounds } from "./types";

// ----- Category-based defaults (from B2 brief) -----------------------------

/** Map from DB category → default (min, max) grams per slot. */
export const CATEGORY_DEFAULTS: Record<string, GramBounds> = {
  // Spec category: "Protein anchors"
  protein: { min: 60, max: 400 },
  seafood: { min: 60, max: 400 },
  legume: { min: 60, max: 400 }, // legumes default to protein anchor (per pre-code Q&A)

  // Spec category: "Grain/starch carbs"
  carb: { min: 30, max: 350 },
  grain: { min: 30, max: 350 },

  // Spec category: "Vegetables"
  vegetable: { min: 50, max: 400 },

  // Spec category: "Fats" — split per-slug below; default tilts to nut/seed range
  fat: { min: 10, max: 60 },

  // Spec category: "Fruits"
  fruit: { min: 50, max: 250 },

  // Spec category: "Dairy/protein supplements"
  dairy: { min: 20, max: 200 },
  supplement: { min: 20, max: 200 },

  // Spec category: "Condiments/sweeteners"
  condiment: { min: 0, max: 30 },

  // Beverages — broader; tighter caps for caffeinated below.
  beverage: { min: 0, max: 500 },
};

// ----- Per-slug overrides ---------------------------------------------------

/**
 * Slugs whose category default is wrong for portion sense.
 * Keys must exactly match the slug as stored in Supabase.
 */
export const SLUG_OVERRIDES: Record<string, GramBounds> = {
  // ---- "fat" category — split between oils/butters and nuts/seeds ----
  // Oils and pure fats: 5–40g (Tbsp range)
  olive_oil: { min: 5, max: 40 },
  avocado_oil: { min: 5, max: 40 },
  canola_oil: { min: 5, max: 40 },
  vegetable_oil: { min: 5, max: 40 },
  sesame_oil: { min: 5, max: 30 },
  coconut_oil: { min: 5, max: 30 },
  mct_oil: { min: 5, max: 30 },
  butter_salted: { min: 5, max: 40 },
  butter_unsalted: { min: 5, max: 40 },
  ghee: { min: 5, max: 40 },
  heavy_cream: { min: 10, max: 60 },

  // Avocado is a fruit-sized portion despite living in DB's "fat" category
  avocado_raw: { min: 50, max: 200 },

  // Olives are condiment-ish
  olives_black: { min: 5, max: 40 },
  olives_green: { min: 5, max: 40 },

  // Hummus / guacamole — dip-sized portions
  guacamole: { min: 30, max: 150 },

  // Chocolate / cocoa — small servings
  chocolate_dark_70: { min: 5, max: 30 },

  // ---- nut/seed category — already 10-60g but tighten outliers ----
  // Brazil nuts: selenium toxicity above ~3 nuts/day (~10g). Hard upper.
  brazil_nuts: { min: 5, max: 15 },

  // Small seeds — lower min so solver can hit tight peri-workout fat targets
  // (e.g. endurance pre-workout slot wants ~5g fat; 10g chia = 3g fat is the
  // closest hit without dropping the slug entirely). Spec said 10-60g for
  // nuts/seeds; deviating to 5g min for these tiny seeds — non-controversial.
  chia_seeds: { min: 5, max: 60 },
  hemp_seeds: { min: 5, max: 60 },
  flax_seeds: { min: 5, max: 60 },

  // ---- "carb" / "grain" — tighten dry oats vs cooked ----
  // Dry oats are dense — 30g is plenty
  oats_rolled_dry: { min: 20, max: 100 },
  oats_steel_cut_dry: { min: 20, max: 100 },
  cornmeal_dry: { min: 20, max: 80 },

  // ---- "condiment" — sweeteners can go a bit higher when used in baking ----
  honey: { min: 0, max: 40 },
  maple_syrup: { min: 0, max: 40 },
  agave_syrup: { min: 0, max: 30 },
  white_sugar: { min: 0, max: 30 },
  brown_sugar: { min: 0, max: 30 },

  // Hummus — DB lists as condiment; portion is closer to dip-sized
  hummus: { min: 30, max: 150 },

  // ---- "supplement" — protein powders. Lowered min from 20g (one full
  // scoop) to 10g (half scoop) so the solver can use small amounts when a
  // slot's protein target is near a one-scoop boundary. Spec listed
  // dairy/supplement as 20-200g; deviating for protein powders only.
  whey_protein_isolate: { min: 10, max: 60 },
  whey_protein_concentrate: { min: 10, max: 60 },
  casein_protein: { min: 10, max: 60 },
  pea_protein_powder: { min: 10, max: 60 },
  nutritional_yeast: { min: 5, max: 30 },

  // ---- "beverage" — caffeinated tighter ----
  coffee_brewed: { min: 0, max: 480 }, // 16oz cap
  black_tea_brewed: { min: 0, max: 480 },
  green_tea_brewed: { min: 0, max: 480 },
  apple_juice: { min: 0, max: 240 }, // 8oz cap (high sugar)
  orange_juice: { min: 0, max: 240 },
  coconut_water: { min: 0, max: 480 },

  // ---- "vegetable" — herbs and aromatics are garnish-sized ----
  basil_fresh: { min: 1, max: 20 },
  cilantro_fresh: { min: 1, max: 20 },
  parsley_fresh: { min: 1, max: 20 },
  mint_fresh: { min: 1, max: 20 },
  garlic_raw: { min: 1, max: 20 },
  ginger_raw: { min: 1, max: 30 },
  jalapeno_raw: { min: 1, max: 30 },
  green_onion_raw: { min: 5, max: 50 },
  // Citrus zest/juice
  lemon_raw: { min: 5, max: 50 },
  lime_raw: { min: 5, max: 50 },

  // ---- "dairy" — small-portion items (cheese garnishes) ----
  feta_cheese: { min: 10, max: 60 },
  parmesan_cheese: { min: 5, max: 30 },
  goat_cheese: { min: 10, max: 60 },
  cream_cheese: { min: 10, max: 50 },
  sour_cream: { min: 10, max: 60 },
  half_and_half: { min: 10, max: 60 },

  // ---- "protein" — eggs are tiny, organ meat tighter ----
  egg_whole_boiled: { min: 50, max: 200 }, // ~1-4 large eggs
  egg_whole_raw: { min: 50, max: 200 },
  egg_white_raw: { min: 30, max: 200 },
  egg_yolk_raw: { min: 15, max: 100 },
  liquid_egg_whites: { min: 30, max: 250 },
  beef_jerky: { min: 20, max: 80 }, // dense + high Na
  beef_liver_cooked: { min: 50, max: 150 }, // organ meat moderation
  bacon_cooked: { min: 15, max: 80 }, // cured

  // ---- "seafood" — sardines + canned tuna come in small cans ----
  sardines_canned_oil: { min: 30, max: 150 },
  tuna_canned_water: { min: 60, max: 200 },
};

/**
 * Resolve gram bounds for a slug.
 * Throws if the slug has neither override nor known category — caller should
 * have validated against the ingredients table first.
 */
export function getGramBounds(
  slug: string,
  category: string,
): GramBounds {
  const override = SLUG_OVERRIDES[slug];
  if (override) return override;
  const def = CATEGORY_DEFAULTS[category];
  if (def) return def;
  throw new Error(
    `getGramBounds: no bounds known for slug=${slug} category=${category}`,
  );
}
