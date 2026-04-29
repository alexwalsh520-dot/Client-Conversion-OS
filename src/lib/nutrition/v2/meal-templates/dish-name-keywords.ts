/**
 * Phase B6a-pivot dish-name fix — shared keyword extraction + slug mapping.
 *
 * Used by both:
 *   - Hermetic Test 9 (static validator): parses each meal's dish_name into
 *     keywords and checks at least one `must_appear: true` ingredient maps
 *     to each non-flavor keyword via slugMatchesKeyword().
 *   - dish-name-audit script (Test 10 runtime probe): parses dish_name
 *     keywords and looks for the corresponding ingredient in solver output.
 *
 * Single source of truth so the static validator and the runtime probe
 * agree on what counts as a dish-name keyword.
 */

/**
 * Words that appear in dish names but are not specific ingredient names.
 * Cooking methods, vessels, descriptors, cuisine implications. The static
 * validator allows these to appear in a dish_name without requiring a
 * matching must_appear ingredient.
 */
export const FLAVOR_WORDS: ReadonlySet<string> = new Set([
  // Connectors / articles
  "and", "with", "the", "&", "of", "a", "an", "in", "on",
  // Vessels / forms
  "bowl", "plate", "parfait", "sandwich", "pasta", "salad",
  // Cooking methods / preparations
  "roasted", "seared", "buttered", "buttery", "smoky", "savory",
  "soft", "hard-boiled", "boiled", "cooked", "fried", "stir-fry",
  "stir", "fry", "sautéed", "grilled", "baked", "toasted",
  "primavera", "pilaf", "mash",
  // Implied flavorings (no dedicated slug; the dish title sets the vibe)
  "lemon", "garlic", "herb", "honey", "miso", "maple", "glazed",
  "vanilla", "cinnamon",
  // Cuisine descriptors
  "mediterranean", "tex-mex", "italian", "asian", "thai",
  // Macro/style descriptors that match generically rather than to a slug
  "power",
]);

/**
 * Slug → list of dish-name keywords that should be considered as
 * referencing this slug. Used to bridge the gap between machine-readable
 * slug names and natural-language dish-name words.
 *
 * Example: dish_name "Blueberry Almond Protein Oats" parses to keywords
 *   ["blueberry", "almond", "protein", "oats"]
 * and `blueberries_raw` should match "blueberry", `whey_protein_isolate`
 * should match "protein", etc.
 */
export const SLUG_KEYWORDS: Record<string, string[]> = {
  // Berries / fruits
  blueberries_raw: ["blueberry", "blueberries"],
  raspberries_raw: ["raspberry", "raspberries"],
  strawberries_raw: ["strawberry", "strawberries"],
  blackberries_raw: ["blackberry", "blackberries"],
  apple_raw: ["apple"],
  banana_raw: ["banana"],
  orange_raw: ["orange"],
  pineapple_raw: ["pineapple"],
  mango_raw: ["mango"],
  pear_raw: ["pear"],
  peach_raw: ["peach"],
  grapefruit_raw: ["grapefruit"],
  cherries_raw: ["cherry", "cherries"],
  watermelon_raw: ["watermelon"],
  cantaloupe_raw: ["cantaloupe", "melon"],
  kiwi_raw: ["kiwi"],
  papaya_raw: ["papaya"],
  apricot_raw: ["apricot"],
  nectarine_raw: ["nectarine"],
  plum_raw: ["plum"],
  // Nuts / seeds
  almonds_raw: ["almond", "almonds"],
  walnuts_raw: ["walnut", "walnuts"],
  pecans_raw: ["pecan"],
  cashews_raw: ["cashew"],
  pistachios_raw: ["pistachio"],
  hazelnuts_raw: ["hazelnut"],
  brazil_nuts: ["brazil"],
  peanuts_raw: ["peanut"],
  pumpkin_seeds: ["pumpkin"],
  sunflower_seeds: ["sunflower"],
  sesame_seeds: ["sesame"],
  hemp_seeds: ["hemp"],
  chia_seeds: ["chia"],
  flax_seeds: ["flax"],
  // Nut butters
  almond_butter: ["almond", "butter"],
  peanut_butter_smooth: ["peanut", "butter"],
  cashew_butter: ["cashew", "butter"],
  tahini: ["tahini"],
  // Eggs
  egg_whole_boiled: ["egg", "eggs"],
  egg_whole_raw: ["egg", "eggs"],
  liquid_egg_whites: ["egg", "eggs", "white", "whites"],
  egg_white_raw: ["egg", "eggs", "white", "whites"],
  egg_yolk_raw: ["yolk"],
  // Supplements
  whey_protein_isolate: ["whey", "protein"],
  whey_protein_concentrate: ["whey", "protein"],
  casein_protein: ["casein", "protein"],
  pea_protein_powder: ["pea", "protein"],
  // Dairy
  cottage_cheese_low_fat: ["cottage", "cheese"],
  cottage_cheese_full_fat: ["cottage", "cheese"],
  greek_yogurt_nonfat_plain: ["yogurt", "greek"],
  greek_yogurt_2_plain: ["yogurt", "greek"],
  greek_yogurt_whole_plain: ["yogurt", "greek"],
  regular_yogurt_plain: ["yogurt"],
  skyr_plain: ["skyr", "yogurt"],
  ricotta_cheese_part_skim: ["ricotta"],
  feta_cheese: ["feta"],
  cheddar_cheese: ["cheddar"],
  mozzarella_cheese_part_skim: ["mozzarella"],
  mozzarella_cheese_whole: ["mozzarella"],
  parmesan_cheese: ["parmesan"],
  goat_cheese: ["goat"],
  swiss_cheese: ["swiss"],
  cream_cheese: ["cream"],
  // Grains / oats
  oats_rolled_dry: ["oat", "oats"],
  oats_steel_cut_dry: ["oat", "oats", "steel-cut"],
  oatmeal_cooked_water: ["oatmeal"],
  brown_rice_cooked: ["rice", "brown"],
  jasmine_rice_cooked: ["rice"],
  basmati_rice_cooked: ["rice", "basmati"],
  white_rice_cooked: ["rice"],
  wild_rice_cooked: ["rice"],
  quinoa_cooked: ["quinoa"],
  barley_cooked: ["barley"],
  farro_cooked: ["farro"],
  buckwheat_cooked: ["buckwheat"],
  millet_cooked: ["millet"],
  couscous_cooked: ["couscous"],
  grits_cooked: ["grits"],
  cornmeal_dry: ["cornmeal"],
  // Breads / pasta / starchy carbs
  whole_wheat_bread: ["toast", "bread"],
  sourdough_bread: ["sourdough", "toast", "bread"],
  white_bread: ["toast", "bread"],
  bagel_plain: ["bagel"],
  english_muffin_whole_wheat: ["muffin"],
  naan: ["naan"],
  pita_whole_wheat: ["pita"],
  whole_wheat_pasta_cooked: ["pasta"],
  pasta_cooked: ["pasta"],
  egg_noodles_cooked: ["noodle"],
  rice_noodles_cooked: ["noodle"],
  tortilla_corn: ["tortilla"],
  tortilla_flour: ["tortilla"],
  cassava_boiled: ["cassava"],
  yam_boiled: ["yam"],
  potato_red_boiled: ["potato", "potatoes", "red"],
  potato_russet_baked: ["potato", "potatoes"],
  potato_mashed: ["potato", "potatoes", "mashed"],
  sweet_potato_baked: ["sweet", "potato", "potatoes"],
  // Legumes
  black_beans_cooked: ["bean", "black"],
  chickpeas_cooked: ["chickpea"],
  green_peas_cooked: ["pea", "peas"],
  kidney_beans_cooked: ["bean", "kidney"],
  lentils_cooked: ["lentil"],
  lima_beans_cooked: ["lima", "bean"],
  navy_beans_cooked: ["navy", "bean"],
  pinto_beans_cooked: ["pinto", "bean"],
  split_peas_cooked: ["split", "pea"],
  edamame_cooked: ["edamame"],
  // Avocados / oils / butters
  avocado_raw: ["avocado"],
  avocado_oil: ["avocado"],
  olive_oil: [],
  butter_unsalted: ["butter", "buttery", "buttered"],
  butter_salted: ["butter"],
  ghee: ["ghee"],
  guacamole: ["guacamole", "avocado"],
  // Proteins (whole-food)
  chicken_breast_cooked_skinless: ["chicken"],
  chicken_thigh_cooked_skinless: ["chicken", "thigh"],
  chicken_drumstick_cooked_skinless: ["chicken", "drumstick"],
  chicken_wing_cooked: ["chicken", "wing"],
  ground_chicken_cooked: ["chicken"],
  turkey_breast_cooked_skinless: ["turkey"],
  turkey_thigh_cooked: ["turkey"],
  ground_turkey_cooked_93: ["turkey"],
  ground_beef_cooked_80: ["beef"],
  ground_beef_cooked_90: ["beef"],
  beef_chuck_cooked: ["beef", "chuck"],
  beef_brisket_cooked: ["beef", "brisket"],
  beef_flank_cooked: ["flank", "beef", "steak"],
  beef_ribeye_cooked: ["ribeye", "beef"],
  beef_sirloin_cooked: ["sirloin", "beef", "steak"],
  beef_tenderloin_cooked: ["tenderloin", "beef"],
  beef_jerky: ["jerky"],
  beef_liver_cooked: ["liver"],
  ground_pork_cooked: ["pork"],
  ground_lamb_cooked: ["lamb"],
  pork_loin_cooked: ["pork", "loin"],
  pork_shoulder_cooked: ["pork", "shoulder"],
  pork_tenderloin_cooked: ["pork", "tenderloin"],
  lamb_chop_cooked: ["lamb", "chop"],
  duck_breast_cooked: ["duck"],
  bacon_cooked: ["bacon"],
  ham_cooked: ["ham"],
  italian_sausage_cooked: ["sausage"],
  // Plant proteins
  tofu_extra_firm: ["tofu"],
  tofu_firm: ["tofu"],
  tempeh: ["tempeh"],
  seitan: ["seitan"],
  // Seafood
  cod_cooked: ["cod"],
  tilapia_cooked: ["tilapia"],
  halibut_cooked: ["halibut"],
  mahi_mahi_cooked: ["mahi"],
  salmon_atlantic_cooked: ["salmon"],
  salmon_sockeye_cooked: ["salmon"],
  trout_rainbow_cooked: ["trout"],
  tuna_canned_water: ["tuna"],
  tuna_yellowfin_cooked: ["tuna"],
  shrimp_cooked: ["shrimp"],
  scallops_cooked: ["scallops", "scallop"],
  crab_cooked: ["crab"],
  lobster_cooked: ["lobster"],
  mussels_cooked: ["mussel"],
  sardines_canned_oil: ["sardine"],
  // Vegetables
  broccoli_steamed: ["broccoli"],
  broccoli_raw: ["broccoli"],
  spinach_cooked: ["spinach"],
  spinach_raw: ["spinach"],
  kale_raw: ["kale"],
  kale_cooked: ["kale"],
  asparagus_cooked: ["asparagus"],
  green_beans_cooked: ["bean", "beans", "green"],
  cauliflower_cooked: ["cauliflower"],
  brussels_sprouts_cooked: ["brussels"],
  bell_pepper_red_raw: ["pepper", "peppers"],
  bell_pepper_green_raw: ["pepper"],
  bell_pepper_yellow_raw: ["pepper"],
  zucchini_raw: ["zucchini"],
  yellow_squash_raw: ["squash"],
  butternut_squash_cooked: ["squash", "butternut"],
  spaghetti_squash_cooked: ["squash", "spaghetti"],
  cucumber_raw: ["cucumber"],
  carrots_raw: ["carrot"],
  carrots_cooked: ["carrot"],
  tomato_raw: ["tomato"],
  tomato_red_raw: ["tomato"],
  tomato_roma_raw: ["tomato"],
  cherry_tomatoes: ["tomato"],
  mushroom_white_raw: ["mushroom"],
  mushroom_portobello_raw: ["mushroom", "portobello"],
  romaine_lettuce: ["romaine", "lettuce"],
  iceberg_lettuce: ["iceberg", "lettuce"],
  arugula_raw: ["arugula"],
  mixed_greens: ["greens"],
  bok_choy_raw: ["bok"],
  cabbage_raw: ["cabbage"],
  cabbage_cooked: ["cabbage"],
  beets_cooked: ["beet"],
  artichoke_cooked: ["artichoke"],
  eggplant_cooked: ["eggplant"],
  okra_cooked: ["okra"],
  snow_peas_cooked: ["pea", "snow"],
  collard_greens_cooked: ["collard"],
  swiss_chard_cooked: ["chard"],
  turnip_cooked: ["turnip"],
  leeks_cooked: ["leek"],
  corn_cooked: ["corn"],
  corn_kernels_cooked: ["corn"],
  // Beverages (typically not in dish names but listed for completeness)
  apple_juice: ["apple", "juice"],
  orange_juice: ["orange", "juice"],
  coconut_water: ["coconut"],
  // Condiments / dressings (rarely named in dish; mostly empty mapping)
  honey: [],
  maple_syrup: [],
  hummus: ["hummus"],
  pesto: ["pesto"],
  ketchup: [],
  mayonnaise: [],
  salsa: ["salsa"],
};

/**
 * Tokenise a dish name into normalized lowercase keywords, dropping any
 * word in FLAVOR_WORDS. Returns the list of "real ingredient" keywords
 * that should each map to at least one must_appear ingredient.
 */
export function dishNameKeywords(dishName: string): string[] {
  return dishName
    .toLowerCase()
    .replace(/[&·,]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim().replace(/^-+|-+$/g, ""))
    .filter((w) => w.length > 0 && !FLAVOR_WORDS.has(w));
}

/**
 * True if the slug is associated with the given keyword via SLUG_KEYWORDS,
 * or via direct substring match on the slug itself as a fallback.
 */
export function slugMatchesKeyword(slug: string, keyword: string): boolean {
  const kws = SLUG_KEYWORDS[slug];
  if (kws) {
    for (const k of kws) {
      if (k === keyword || k.includes(keyword) || keyword.includes(k)) {
        return true;
      }
    }
    // Slug has an explicit keyword list but the queried keyword isn't on it —
    // do NOT fall through to slug-substring matching, because we're saying
    // explicitly "this slug is associated with these keywords only".
    return false;
  }
  // No explicit mapping — substring match on the slug as a last-resort.
  return slug.toLowerCase().includes(keyword);
}
