/**
 * Curated seed list of ingredients to pull from USDA FoodData Central.
 *
 * Each entry has:
 * - slug: unique identifier used internally (snake_case)
 * - search: what we search for on USDA
 * - displayName: clean name shown in the app
 * - category: one of protein, carb, fat, vegetable, fruit, dairy, condiment, supplement, beverage
 *
 * Only Foundation Foods and SR Legacy results are accepted.
 */

export interface IngredientSeed {
  slug: string;
  search: string;
  displayName: string;
  category: "protein" | "carb" | "fat" | "vegetable" | "fruit" | "dairy" | "condiment" | "supplement" | "beverage" | "legume" | "grain" | "seafood";
  aliases?: string[];
}

export const INGREDIENT_SEEDS: IngredientSeed[] = [
  // ---- PROTEINS: Poultry ----
  { slug: "chicken_breast_cooked_skinless", search: "chicken breast roasted", displayName: "Chicken breast, cooked, skinless", category: "protein", aliases: ["chicken breast", "grilled chicken", "baked chicken breast"] },
  { slug: "chicken_thigh_cooked_skinless", search: "chicken thigh roasted skinless", displayName: "Chicken thigh, cooked, skinless", category: "protein", aliases: ["chicken thigh"] },
  { slug: "chicken_drumstick_cooked_skinless", search: "chicken drumstick roasted skinless", displayName: "Chicken drumstick, cooked, skinless", category: "protein" },
  { slug: "chicken_wing_cooked", search: "chicken wing roasted", displayName: "Chicken wing, cooked", category: "protein" },
  { slug: "ground_chicken_cooked", search: "ground chicken cooked", displayName: "Ground chicken, cooked", category: "protein", aliases: ["ground chicken"] },
  { slug: "turkey_breast_cooked_skinless", search: "turkey breast roasted skinless", displayName: "Turkey breast, cooked, skinless", category: "protein", aliases: ["turkey breast"] },
  { slug: "ground_turkey_cooked_93", search: "ground turkey cooked 93% lean", displayName: "Ground turkey, cooked, 93% lean", category: "protein", aliases: ["ground turkey"] },
  { slug: "turkey_thigh_cooked", search: "turkey thigh roasted", displayName: "Turkey thigh, cooked", category: "protein" },
  { slug: "duck_breast_cooked", search: "duck breast roasted", displayName: "Duck breast, cooked", category: "protein" },

  // ---- PROTEINS: Beef ----
  { slug: "beef_sirloin_cooked", search: "beef top sirloin broiled", displayName: "Beef sirloin, cooked", category: "protein", aliases: ["sirloin steak", "steak"] },
  { slug: "beef_tenderloin_cooked", search: "beef tenderloin broiled", displayName: "Beef tenderloin, cooked", category: "protein", aliases: ["filet mignon"] },
  { slug: "beef_ribeye_cooked", search: "beef ribeye broiled", displayName: "Beef ribeye, cooked", category: "protein", aliases: ["ribeye steak"] },
  { slug: "beef_flank_cooked", search: "beef flank steak broiled", displayName: "Beef flank, cooked", category: "protein", aliases: ["flank steak"] },
  { slug: "ground_beef_cooked_90", search: "ground beef 90% lean cooked", displayName: "Ground beef, cooked, 90% lean", category: "protein", aliases: ["ground beef", "lean ground beef"] },
  { slug: "ground_beef_cooked_80", search: "ground beef 80% lean cooked", displayName: "Ground beef, cooked, 80% lean", category: "protein" },
  { slug: "beef_brisket_cooked", search: "beef brisket cooked", displayName: "Beef brisket, cooked", category: "protein" },
  { slug: "beef_chuck_cooked", search: "beef chuck roast cooked", displayName: "Beef chuck, cooked", category: "protein" },
  { slug: "beef_liver_cooked", search: "beef liver cooked", displayName: "Beef liver, cooked", category: "protein" },
  { slug: "beef_jerky", search: "beef jerky", displayName: "Beef jerky", category: "protein" },

  // ---- PROTEINS: Pork ----
  { slug: "pork_tenderloin_cooked", search: "pork tenderloin roasted", displayName: "Pork tenderloin, cooked", category: "protein" },
  { slug: "pork_loin_cooked", search: "pork loin roasted", displayName: "Pork loin, cooked", category: "protein", aliases: ["pork chop"] },
  { slug: "pork_shoulder_cooked", search: "pork shoulder roasted", displayName: "Pork shoulder, cooked", category: "protein", aliases: ["pulled pork"] },
  { slug: "bacon_cooked", search: "bacon pan fried", displayName: "Bacon, cooked", category: "protein", aliases: ["bacon"] },
  { slug: "ham_cooked", search: "ham cured roasted", displayName: "Ham, cooked", category: "protein" },
  { slug: "ground_pork_cooked", search: "ground pork cooked", displayName: "Ground pork, cooked", category: "protein" },
  { slug: "italian_sausage_cooked", search: "italian sausage cooked", displayName: "Italian sausage, cooked", category: "protein" },

  // ---- PROTEINS: Lamb ----
  { slug: "lamb_chop_cooked", search: "lamb loin chop broiled", displayName: "Lamb chop, cooked", category: "protein" },
  { slug: "ground_lamb_cooked", search: "ground lamb cooked", displayName: "Ground lamb, cooked", category: "protein" },

  // ---- PROTEINS: Eggs ----
  { slug: "egg_whole_raw", search: "egg whole raw fresh", displayName: "Egg, whole, raw", category: "protein", aliases: ["egg", "whole egg"] },
  { slug: "egg_white_raw", search: "egg white raw fresh", displayName: "Egg white, raw", category: "protein", aliases: ["egg whites"] },
  { slug: "egg_yolk_raw", search: "egg yolk raw fresh", displayName: "Egg yolk, raw", category: "protein" },
  { slug: "egg_whole_boiled", search: "egg whole boiled", displayName: "Egg, whole, hard-boiled", category: "protein" },
  { slug: "liquid_egg_whites", search: "egg white dried", displayName: "Egg whites, liquid", category: "protein", aliases: ["liquid egg whites"] },

  // ---- PROTEINS: Seafood ----
  { slug: "salmon_atlantic_cooked", search: "salmon atlantic cooked", displayName: "Salmon, Atlantic, cooked", category: "seafood", aliases: ["salmon", "grilled salmon"] },
  { slug: "salmon_sockeye_cooked", search: "salmon sockeye cooked", displayName: "Salmon, sockeye, cooked", category: "seafood" },
  { slug: "tuna_yellowfin_cooked", search: "tuna yellowfin cooked", displayName: "Tuna, yellowfin, cooked", category: "seafood", aliases: ["tuna steak"] },
  { slug: "tuna_canned_water", search: "tuna canned in water", displayName: "Tuna, canned in water", category: "seafood", aliases: ["canned tuna"] },
  { slug: "cod_cooked", search: "cod atlantic cooked", displayName: "Cod, cooked", category: "seafood" },
  { slug: "tilapia_cooked", search: "tilapia cooked", displayName: "Tilapia, cooked", category: "seafood" },
  { slug: "halibut_cooked", search: "halibut cooked", displayName: "Halibut, cooked", category: "seafood" },
  { slug: "mahi_mahi_cooked", search: "fish dolphinfish cooked", displayName: "Mahi-mahi, cooked", category: "seafood" },
  { slug: "trout_rainbow_cooked", search: "trout rainbow cooked", displayName: "Rainbow trout, cooked", category: "seafood" },
  { slug: "sardines_canned_oil", search: "sardines atlantic canned in oil", displayName: "Sardines, canned in oil", category: "seafood" },
  { slug: "shrimp_cooked", search: "shrimp cooked moist heat", displayName: "Shrimp, cooked", category: "seafood", aliases: ["shrimp"] },
  { slug: "scallops_cooked", search: "scallops cooked", displayName: "Scallops, cooked", category: "seafood" },
  { slug: "lobster_cooked", search: "lobster northern cooked", displayName: "Lobster, cooked", category: "seafood" },
  { slug: "crab_cooked", search: "crab alaska king cooked", displayName: "Crab, cooked", category: "seafood" },
  { slug: "mussels_cooked", search: "mussels blue cooked", displayName: "Mussels, cooked", category: "seafood" },

  // ---- PROTEINS: Plant-based ----
  { slug: "tofu_firm", search: "tofu firm raw", displayName: "Tofu, firm", category: "protein", aliases: ["tofu"] },
  { slug: "tofu_extra_firm", search: "tofu extra firm", displayName: "Tofu, extra firm", category: "protein" },
  { slug: "tempeh", search: "tempeh", displayName: "Tempeh", category: "protein" },
  { slug: "edamame_cooked", search: "edamame frozen prepared", displayName: "Edamame, cooked", category: "protein", aliases: ["edamame"] },
  { slug: "seitan", search: "wheat gluten", displayName: "Seitan (wheat gluten)", category: "protein" },

  // ---- DAIRY: Cheese ----
  { slug: "cheddar_cheese", search: "cheese cheddar", displayName: "Cheddar cheese", category: "dairy", aliases: ["cheddar"] },
  { slug: "mozzarella_cheese_part_skim", search: "cheese mozzarella part skim", displayName: "Mozzarella cheese, part-skim", category: "dairy", aliases: ["mozzarella"] },
  { slug: "mozzarella_cheese_whole", search: "cheese mozzarella whole milk", displayName: "Mozzarella cheese, whole milk", category: "dairy" },
  { slug: "parmesan_cheese", search: "cheese parmesan grated", displayName: "Parmesan cheese", category: "dairy", aliases: ["parmesan"] },
  { slug: "feta_cheese", search: "cheese feta", displayName: "Feta cheese", category: "dairy", aliases: ["feta"] },
  { slug: "swiss_cheese", search: "cheese swiss", displayName: "Swiss cheese", category: "dairy" },
  { slug: "goat_cheese", search: "cheese goat soft", displayName: "Goat cheese", category: "dairy" },
  { slug: "cream_cheese", search: "cream cheese", displayName: "Cream cheese", category: "dairy" },
  { slug: "cottage_cheese_low_fat", search: "cottage cheese lowfat 1%", displayName: "Cottage cheese, low-fat", category: "dairy", aliases: ["cottage cheese"] },
  { slug: "cottage_cheese_full_fat", search: "cottage cheese creamed", displayName: "Cottage cheese, full-fat", category: "dairy" },
  { slug: "ricotta_cheese_part_skim", search: "cheese ricotta part skim", displayName: "Ricotta cheese, part-skim", category: "dairy" },

  // ---- DAIRY: Yogurt & Milk ----
  { slug: "greek_yogurt_nonfat_plain", search: "yogurt greek plain nonfat", displayName: "Greek yogurt, non-fat, plain", category: "dairy", aliases: ["greek yogurt", "nonfat greek yogurt"] },
  { slug: "greek_yogurt_2_plain", search: "yogurt greek plain lowfat", displayName: "Greek yogurt, 2% plain", category: "dairy" },
  { slug: "greek_yogurt_whole_plain", search: "yogurt greek plain whole milk", displayName: "Greek yogurt, whole milk, plain", category: "dairy" },
  { slug: "regular_yogurt_plain", search: "yogurt plain whole milk", displayName: "Yogurt, plain, whole milk", category: "dairy" },
  { slug: "skyr_plain", search: "yogurt icelandic plain", displayName: "Skyr, plain", category: "dairy" },
  { slug: "milk_whole", search: "milk whole 3.25% milkfat", displayName: "Whole milk", category: "dairy", aliases: ["milk"] },
  { slug: "milk_2_percent", search: "milk 2% lowfat", displayName: "2% milk", category: "dairy" },
  { slug: "milk_skim", search: "milk nonfat fluid", displayName: "Skim milk", category: "dairy", aliases: ["nonfat milk", "fat free milk"] },
  { slug: "almond_milk_unsweetened", search: "almond milk unsweetened", displayName: "Almond milk, unsweetened", category: "dairy", aliases: ["almond milk"] },
  { slug: "soy_milk_unsweetened", search: "soy milk unsweetened", displayName: "Soy milk, unsweetened", category: "dairy" },
  { slug: "oat_milk_unsweetened", search: "oat milk unsweetened", displayName: "Oat milk, unsweetened", category: "dairy" },
  { slug: "coconut_milk_unsweetened", search: "coconut milk unsweetened", displayName: "Coconut milk, unsweetened", category: "dairy" },

  // ---- DAIRY: Butter & Cream ----
  { slug: "butter_salted", search: "butter salted", displayName: "Butter, salted", category: "fat", aliases: ["butter"] },
  { slug: "butter_unsalted", search: "butter unsalted", displayName: "Butter, unsalted", category: "fat" },
  { slug: "heavy_cream", search: "cream heavy whipping", displayName: "Heavy cream", category: "fat" },
  { slug: "half_and_half", search: "cream half and half", displayName: "Half and half", category: "dairy" },
  { slug: "sour_cream", search: "sour cream cultured", displayName: "Sour cream", category: "dairy" },

  // ---- GRAINS & CARBS ----
  { slug: "white_rice_cooked", search: "rice white long grain cooked", displayName: "White rice, cooked", category: "grain", aliases: ["white rice", "rice"] },
  { slug: "brown_rice_cooked", search: "rice brown long grain cooked", displayName: "Brown rice, cooked", category: "grain", aliases: ["brown rice"] },
  { slug: "jasmine_rice_cooked", search: "rice white jasmine cooked", displayName: "Jasmine rice, cooked", category: "grain" },
  { slug: "basmati_rice_cooked", search: "rice white basmati cooked", displayName: "Basmati rice, cooked", category: "grain" },
  { slug: "wild_rice_cooked", search: "wild rice cooked", displayName: "Wild rice, cooked", category: "grain" },
  { slug: "quinoa_cooked", search: "quinoa cooked", displayName: "Quinoa, cooked", category: "grain", aliases: ["quinoa"] },
  { slug: "couscous_cooked", search: "couscous cooked", displayName: "Couscous, cooked", category: "grain" },
  { slug: "farro_cooked", search: "wheat spelt cooked", displayName: "Farro, cooked", category: "grain" },
  { slug: "oats_rolled_dry", search: "oats rolled dry", displayName: "Rolled oats, dry", category: "grain", aliases: ["oats", "rolled oats"] },
  { slug: "oats_steel_cut_dry", search: "oats steel cut dry", displayName: "Steel-cut oats, dry", category: "grain" },
  { slug: "oatmeal_cooked_water", search: "oatmeal cooked with water", displayName: "Oatmeal, cooked with water", category: "grain" },
  { slug: "cornmeal_dry", search: "cornmeal whole grain yellow", displayName: "Cornmeal, dry", category: "grain" },
  { slug: "grits_cooked", search: "hominy grits cooked water", displayName: "Grits, cooked", category: "grain" },
  { slug: "barley_cooked", search: "barley pearled cooked", displayName: "Barley, cooked", category: "grain" },
  { slug: "buckwheat_cooked", search: "buckwheat groats roasted cooked", displayName: "Buckwheat, cooked", category: "grain" },
  { slug: "millet_cooked", search: "millet cooked", displayName: "Millet, cooked", category: "grain" },

  // ---- PASTA & BREAD ----
  { slug: "pasta_cooked", search: "pasta cooked enriched", displayName: "Pasta, cooked", category: "carb", aliases: ["pasta", "spaghetti"] },
  { slug: "whole_wheat_pasta_cooked", search: "pasta whole wheat cooked", displayName: "Whole wheat pasta, cooked", category: "carb" },
  { slug: "rice_noodles_cooked", search: "rice noodles cooked", displayName: "Rice noodles, cooked", category: "carb" },
  { slug: "egg_noodles_cooked", search: "noodles egg cooked enriched", displayName: "Egg noodles, cooked", category: "carb" },
  { slug: "whole_wheat_bread", search: "bread whole wheat commercially prepared", displayName: "Whole wheat bread", category: "carb", aliases: ["whole wheat bread"] },
  { slug: "white_bread", search: "bread white commercially prepared", displayName: "White bread", category: "carb" },
  { slug: "sourdough_bread", search: "bread french or sourdough", displayName: "Sourdough bread", category: "carb" },
  { slug: "bagel_plain", search: "bagel plain enriched", displayName: "Bagel, plain", category: "carb" },
  { slug: "english_muffin_whole_wheat", search: "english muffin whole wheat", displayName: "English muffin, whole wheat", category: "carb" },
  { slug: "tortilla_flour", search: "tortilla flour", displayName: "Flour tortilla", category: "carb" },
  { slug: "tortilla_corn", search: "tortilla corn", displayName: "Corn tortilla", category: "carb" },
  { slug: "pita_whole_wheat", search: "pita whole wheat", displayName: "Whole wheat pita", category: "carb" },
  { slug: "naan", search: "naan flat bread", displayName: "Naan", category: "carb" },

  // ---- POTATOES & TUBERS ----
  { slug: "potato_russet_baked", search: "potato russet baked flesh skin", displayName: "Russet potato, baked", category: "carb", aliases: ["potato", "baked potato"] },
  { slug: "potato_red_boiled", search: "potato red boiled skin", displayName: "Red potato, boiled", category: "carb" },
  { slug: "sweet_potato_baked", search: "sweet potato baked skin", displayName: "Sweet potato, baked", category: "carb", aliases: ["sweet potato"] },
  { slug: "yam_boiled", search: "yam cooked boiled", displayName: "Yam, boiled", category: "carb" },
  { slug: "cassava_boiled", search: "cassava raw", displayName: "Cassava", category: "carb" },
  { slug: "potato_mashed", search: "potato mashed prepared from fresh milk butter", displayName: "Mashed potato", category: "carb" },

  // ---- LEGUMES ----
  { slug: "black_beans_cooked", search: "beans black mature cooked", displayName: "Black beans, cooked", category: "legume", aliases: ["black beans"] },
  { slug: "kidney_beans_cooked", search: "beans kidney red mature cooked", displayName: "Kidney beans, cooked", category: "legume" },
  { slug: "pinto_beans_cooked", search: "beans pinto mature cooked", displayName: "Pinto beans, cooked", category: "legume" },
  { slug: "navy_beans_cooked", search: "beans navy mature cooked", displayName: "Navy beans, cooked", category: "legume" },
  { slug: "chickpeas_cooked", search: "chickpeas mature cooked", displayName: "Chickpeas, cooked", category: "legume", aliases: ["chickpeas", "garbanzo beans"] },
  { slug: "lentils_cooked", search: "lentils mature cooked", displayName: "Lentils, cooked", category: "legume", aliases: ["lentils"] },
  { slug: "green_peas_cooked", search: "peas green cooked boiled", displayName: "Green peas, cooked", category: "legume" },
  { slug: "split_peas_cooked", search: "peas split mature cooked", displayName: "Split peas, cooked", category: "legume" },
  { slug: "lima_beans_cooked", search: "lima beans large mature cooked", displayName: "Lima beans, cooked", category: "legume" },

  // ---- VEGETABLES ----
  { slug: "broccoli_steamed", search: "broccoli cooked boiled", displayName: "Broccoli, steamed", category: "vegetable", aliases: ["broccoli"] },
  { slug: "broccoli_raw", search: "broccoli raw", displayName: "Broccoli, raw", category: "vegetable" },
  { slug: "cauliflower_cooked", search: "cauliflower cooked boiled", displayName: "Cauliflower, cooked", category: "vegetable", aliases: ["cauliflower"] },
  { slug: "brussels_sprouts_cooked", search: "brussels sprouts cooked boiled", displayName: "Brussels sprouts, cooked", category: "vegetable" },
  { slug: "asparagus_cooked", search: "asparagus cooked boiled", displayName: "Asparagus, cooked", category: "vegetable" },
  { slug: "green_beans_cooked", search: "beans snap green cooked boiled", displayName: "Green beans, cooked", category: "vegetable" },
  { slug: "spinach_raw", search: "spinach raw", displayName: "Spinach, raw", category: "vegetable", aliases: ["spinach"] },
  { slug: "spinach_cooked", search: "spinach cooked boiled", displayName: "Spinach, cooked", category: "vegetable" },
  { slug: "kale_raw", search: "kale raw", displayName: "Kale, raw", category: "vegetable", aliases: ["kale"] },
  { slug: "kale_cooked", search: "kale cooked boiled", displayName: "Kale, cooked", category: "vegetable" },
  { slug: "romaine_lettuce", search: "lettuce cos romaine raw", displayName: "Romaine lettuce", category: "vegetable" },
  { slug: "iceberg_lettuce", search: "lettuce iceberg raw", displayName: "Iceberg lettuce", category: "vegetable" },
  { slug: "arugula_raw", search: "arugula raw", displayName: "Arugula, raw", category: "vegetable" },
  { slug: "mixed_greens", search: "lettuce mixed greens raw", displayName: "Mixed greens", category: "vegetable" },
  { slug: "cabbage_raw", search: "cabbage raw", displayName: "Cabbage, raw", category: "vegetable" },
  { slug: "cabbage_cooked", search: "cabbage cooked boiled", displayName: "Cabbage, cooked", category: "vegetable" },
  { slug: "carrots_raw", search: "carrots raw", displayName: "Carrots, raw", category: "vegetable", aliases: ["carrots"] },
  { slug: "carrots_cooked", search: "carrots cooked boiled", displayName: "Carrots, cooked", category: "vegetable" },
  { slug: "celery_raw", search: "celery raw", displayName: "Celery, raw", category: "vegetable" },
  { slug: "cucumber_raw", search: "cucumber with peel raw", displayName: "Cucumber", category: "vegetable" },
  { slug: "bell_pepper_red_raw", search: "peppers sweet red raw", displayName: "Red bell pepper", category: "vegetable", aliases: ["red pepper"] },
  { slug: "bell_pepper_green_raw", search: "peppers sweet green raw", displayName: "Green bell pepper", category: "vegetable" },
  { slug: "bell_pepper_yellow_raw", search: "peppers sweet yellow raw", displayName: "Yellow bell pepper", category: "vegetable" },
  { slug: "tomato_raw", search: "tomatoes red ripe raw", displayName: "Tomato, raw", category: "vegetable", aliases: ["tomato"] },
  { slug: "cherry_tomatoes", search: "tomatoes red ripe cherry raw", displayName: "Cherry tomatoes", category: "vegetable" },
  { slug: "onion_raw", search: "onions raw", displayName: "Onion, raw", category: "vegetable", aliases: ["onion"] },
  { slug: "red_onion_raw", search: "onions red raw", displayName: "Red onion", category: "vegetable" },
  { slug: "green_onion_raw", search: "onions spring green raw", displayName: "Green onions", category: "vegetable", aliases: ["scallions"] },
  { slug: "garlic_raw", search: "garlic raw", displayName: "Garlic, raw", category: "vegetable", aliases: ["garlic"] },
  { slug: "ginger_raw", search: "ginger root raw", displayName: "Ginger, raw", category: "vegetable" },
  { slug: "mushroom_white_raw", search: "mushrooms white raw", displayName: "White mushrooms", category: "vegetable", aliases: ["mushrooms"] },
  { slug: "mushroom_portobello_raw", search: "mushrooms portabella raw", displayName: "Portobello mushrooms", category: "vegetable" },
  { slug: "zucchini_raw", search: "zucchini squash raw", displayName: "Zucchini", category: "vegetable" },
  { slug: "yellow_squash_raw", search: "squash summer yellow raw", displayName: "Yellow squash", category: "vegetable" },
  { slug: "butternut_squash_cooked", search: "squash winter butternut cooked baked", displayName: "Butternut squash, cooked", category: "vegetable" },
  { slug: "spaghetti_squash_cooked", search: "squash winter spaghetti cooked boiled", displayName: "Spaghetti squash, cooked", category: "vegetable" },
  { slug: "eggplant_cooked", search: "eggplant cooked boiled", displayName: "Eggplant, cooked", category: "vegetable" },
  { slug: "corn_cooked", search: "corn sweet yellow cooked boiled", displayName: "Corn, cooked", category: "vegetable" },
  { slug: "beets_cooked", search: "beets cooked boiled", displayName: "Beets, cooked", category: "vegetable" },
  { slug: "radish_raw", search: "radishes raw", displayName: "Radish, raw", category: "vegetable" },
  { slug: "turnip_cooked", search: "turnips cooked boiled", displayName: "Turnip, cooked", category: "vegetable" },
  { slug: "swiss_chard_cooked", search: "chard swiss cooked boiled", displayName: "Swiss chard, cooked", category: "vegetable" },
  { slug: "collard_greens_cooked", search: "collards cooked boiled", displayName: "Collard greens, cooked", category: "vegetable" },
  { slug: "okra_cooked", search: "okra cooked boiled", displayName: "Okra, cooked", category: "vegetable" },
  { slug: "artichoke_cooked", search: "artichokes globe cooked boiled", displayName: "Artichoke, cooked", category: "vegetable" },
  { slug: "leeks_cooked", search: "leeks cooked boiled", displayName: "Leeks, cooked", category: "vegetable" },
  { slug: "jalapeno_raw", search: "peppers jalapeno raw", displayName: "Jalapeño pepper", category: "vegetable" },
  { slug: "bok_choy_raw", search: "cabbage chinese pak choi raw", displayName: "Bok choy", category: "vegetable" },
  { slug: "snow_peas_cooked", search: "peas edible podded cooked boiled", displayName: "Snow peas, cooked", category: "vegetable" },

  // ---- FRUITS ----
  { slug: "apple_raw", search: "apples raw with skin", displayName: "Apple, raw", category: "fruit", aliases: ["apple"] },
  { slug: "banana_raw", search: "bananas raw", displayName: "Banana", category: "fruit", aliases: ["banana"] },
  { slug: "orange_raw", search: "oranges raw navels", displayName: "Orange", category: "fruit" },
  { slug: "grapefruit_raw", search: "grapefruit raw pink red", displayName: "Grapefruit", category: "fruit" },
  { slug: "lemon_raw", search: "lemons raw without peel", displayName: "Lemon", category: "fruit" },
  { slug: "lime_raw", search: "limes raw", displayName: "Lime", category: "fruit" },
  { slug: "strawberries_raw", search: "strawberries raw", displayName: "Strawberries", category: "fruit" },
  { slug: "blueberries_raw", search: "blueberries raw", displayName: "Blueberries", category: "fruit" },
  { slug: "raspberries_raw", search: "raspberries raw", displayName: "Raspberries", category: "fruit" },
  { slug: "blackberries_raw", search: "blackberries raw", displayName: "Blackberries", category: "fruit" },
  { slug: "grapes_raw", search: "grapes red or green raw", displayName: "Grapes", category: "fruit" },
  { slug: "pineapple_raw", search: "pineapple raw all varieties", displayName: "Pineapple", category: "fruit" },
  { slug: "mango_raw", search: "mangos raw", displayName: "Mango", category: "fruit" },
  { slug: "watermelon_raw", search: "watermelon raw", displayName: "Watermelon", category: "fruit" },
  { slug: "cantaloupe_raw", search: "melons cantaloupe raw", displayName: "Cantaloupe", category: "fruit" },
  { slug: "honeydew_raw", search: "melons honeydew raw", displayName: "Honeydew", category: "fruit" },
  { slug: "peach_raw", search: "peaches raw", displayName: "Peach", category: "fruit" },
  { slug: "pear_raw", search: "pears raw", displayName: "Pear", category: "fruit" },
  { slug: "plum_raw", search: "plums raw", displayName: "Plum", category: "fruit" },
  { slug: "cherries_raw", search: "cherries sweet raw", displayName: "Cherries, sweet, raw", category: "fruit" },
  { slug: "kiwi_raw", search: "kiwifruit green raw", displayName: "Kiwi", category: "fruit" },
  { slug: "avocado_raw", search: "avocados raw all commercial varieties", displayName: "Avocado", category: "fat", aliases: ["avocado"] },
  { slug: "pomegranate_raw", search: "pomegranates raw", displayName: "Pomegranate", category: "fruit" },
  { slug: "apricot_raw", search: "apricots raw", displayName: "Apricot", category: "fruit" },
  { slug: "nectarine_raw", search: "nectarines raw", displayName: "Nectarine", category: "fruit" },
  { slug: "papaya_raw", search: "papayas raw", displayName: "Papaya", category: "fruit" },
  { slug: "dates_medjool", search: "dates medjool", displayName: "Medjool dates", category: "fruit" },
  { slug: "raisins", search: "raisins seedless", displayName: "Raisins", category: "fruit" },
  { slug: "dried_cranberries", search: "cranberries dried sweetened", displayName: "Dried cranberries", category: "fruit" },
  { slug: "figs_dried", search: "figs dried uncooked", displayName: "Dried figs", category: "fruit" },
  { slug: "prunes_dried", search: "plums dried prunes uncooked", displayName: "Prunes", category: "fruit" },

  // ---- NUTS & SEEDS ----
  { slug: "almonds_raw", search: "almonds raw", displayName: "Almonds, raw", category: "fat", aliases: ["almonds"] },
  { slug: "walnuts_raw", search: "nuts walnuts english", displayName: "Walnuts", category: "fat", aliases: ["walnuts"] },
  { slug: "cashews_raw", search: "nuts cashew nuts raw", displayName: "Cashews, raw", category: "fat", aliases: ["cashews"] },
  { slug: "pistachios_raw", search: "nuts pistachio nuts raw", displayName: "Pistachios, raw", category: "fat" },
  { slug: "pecans_raw", search: "nuts pecans", displayName: "Pecans", category: "fat" },
  { slug: "brazil_nuts", search: "nuts brazilnuts dried", displayName: "Brazil nuts", category: "fat" },
  { slug: "macadamia_raw", search: "nuts macadamia nuts raw", displayName: "Macadamia nuts", category: "fat" },
  { slug: "hazelnuts_raw", search: "nuts hazelnuts or filberts", displayName: "Hazelnuts", category: "fat" },
  { slug: "peanuts_raw", search: "peanuts all types raw", displayName: "Peanuts, raw", category: "fat", aliases: ["peanuts"] },
  { slug: "pine_nuts", search: "nuts pine nuts dried", displayName: "Pine nuts", category: "fat" },
  { slug: "chia_seeds", search: "seeds chia seeds dried", displayName: "Chia seeds", category: "fat" },
  { slug: "flax_seeds", search: "seeds flaxseed", displayName: "Flax seeds", category: "fat" },
  { slug: "hemp_seeds", search: "seeds hemp seed hulled", displayName: "Hemp seeds", category: "fat" },
  { slug: "pumpkin_seeds", search: "seeds pumpkin squash kernels dried", displayName: "Pumpkin seeds", category: "fat" },
  { slug: "sunflower_seeds", search: "seeds sunflower seed kernels dried", displayName: "Sunflower seeds", category: "fat" },
  { slug: "sesame_seeds", search: "seeds sesame seeds whole dried", displayName: "Sesame seeds", category: "fat" },
  { slug: "peanut_butter_smooth", search: "peanut butter smooth style", displayName: "Peanut butter, smooth", category: "fat", aliases: ["peanut butter"] },
  { slug: "almond_butter", search: "almond butter plain without salt added", displayName: "Almond butter", category: "fat" },
  { slug: "cashew_butter", search: "cashew butter plain without salt added", displayName: "Cashew butter", category: "fat" },
  { slug: "tahini", search: "seeds sesame butter tahini", displayName: "Tahini", category: "fat" },

  // ---- OILS & FATS ----
  { slug: "olive_oil", search: "oil olive salad or cooking", displayName: "Olive oil", category: "fat", aliases: ["olive oil", "extra virgin olive oil"] },
  { slug: "avocado_oil", search: "oil avocado", displayName: "Avocado oil", category: "fat" },
  { slug: "coconut_oil", search: "oil coconut", displayName: "Coconut oil", category: "fat" },
  { slug: "canola_oil", search: "oil canola", displayName: "Canola oil", category: "fat" },
  { slug: "vegetable_oil", search: "oil vegetable soybean salad or cooking", displayName: "Vegetable oil", category: "fat" },
  { slug: "sesame_oil", search: "oil sesame salad or cooking", displayName: "Sesame oil", category: "fat" },
  { slug: "mct_oil", search: "oil coconut", displayName: "MCT oil", category: "fat" },
  { slug: "ghee", search: "butter oil anhydrous", displayName: "Ghee", category: "fat" },

  // ---- CONDIMENTS & SAUCES ----
  { slug: "soy_sauce", search: "soy sauce made from soy and wheat shoyu", displayName: "Soy sauce", category: "condiment" },
  { slug: "soy_sauce_low_sodium", search: "soy sauce reduced sodium", displayName: "Low-sodium soy sauce", category: "condiment" },
  { slug: "balsamic_vinegar", search: "vinegar balsamic", displayName: "Balsamic vinegar", category: "condiment" },
  { slug: "apple_cider_vinegar", search: "vinegar cider", displayName: "Apple cider vinegar", category: "condiment" },
  { slug: "rice_vinegar", search: "vinegar red wine", displayName: "Rice vinegar", category: "condiment" },
  { slug: "dijon_mustard", search: "mustard prepared yellow", displayName: "Mustard", category: "condiment", aliases: ["mustard", "dijon mustard"] },
  { slug: "ketchup", search: "catsup", displayName: "Ketchup", category: "condiment" },
  { slug: "mayonnaise", search: "mayonnaise dressing no cholesterol", displayName: "Mayonnaise", category: "condiment", aliases: ["mayo"] },
  { slug: "hot_sauce", search: "sauce hot chile sriracha", displayName: "Hot sauce", category: "condiment", aliases: ["sriracha"] },
  { slug: "salsa", search: "sauce salsa ready to serve", displayName: "Salsa", category: "condiment" },
  { slug: "marinara_sauce", search: "tomato products canned sauce", displayName: "Marinara sauce", category: "condiment", aliases: ["pasta sauce", "tomato sauce"] },
  { slug: "pesto", search: "sauce pesto commercial", displayName: "Pesto", category: "condiment" },
  { slug: "bbq_sauce", search: "barbecue sauce", displayName: "BBQ sauce", category: "condiment" },
  { slug: "worcestershire_sauce", search: "sauce worcestershire", displayName: "Worcestershire sauce", category: "condiment" },
  { slug: "coconut_aminos", search: "coconut aminos", displayName: "Coconut aminos", category: "condiment" },
  { slug: "hummus", search: "hummus commercial", displayName: "Hummus", category: "condiment" },
  { slug: "guacamole", search: "avocados raw all commercial varieties", displayName: "Guacamole", category: "fat" },
  { slug: "ranch_dressing", search: "salad dressing ranch dressing regular", displayName: "Ranch dressing", category: "condiment" },
  { slug: "italian_dressing", search: "salad dressing italian dressing commercial", displayName: "Italian dressing", category: "condiment" },

  // ---- SWEETENERS ----
  { slug: "honey", search: "honey", displayName: "Honey", category: "condiment" },
  { slug: "maple_syrup", search: "syrups maple", displayName: "Maple syrup", category: "condiment" },
  { slug: "agave_syrup", search: "syrups agave", displayName: "Agave syrup", category: "condiment" },
  { slug: "white_sugar", search: "sugars granulated", displayName: "White sugar", category: "condiment", aliases: ["sugar"] },
  { slug: "brown_sugar", search: "sugars brown", displayName: "Brown sugar", category: "condiment" },

  // ---- HERBS & SPICES (zero cal, included for completeness) ----
  { slug: "basil_fresh", search: "basil fresh", displayName: "Basil, fresh", category: "vegetable" },
  { slug: "cilantro_fresh", search: "coriander leaves raw", displayName: "Cilantro, fresh", category: "vegetable" },
  { slug: "parsley_fresh", search: "parsley fresh", displayName: "Parsley, fresh", category: "vegetable" },
  { slug: "mint_fresh", search: "peppermint fresh", displayName: "Mint, fresh", category: "vegetable" },

  // ---- PROTEIN POWDERS & SUPPLEMENTS ----
  { slug: "whey_protein_isolate", search: "whey protein powder isolate", displayName: "Whey protein isolate", category: "supplement", aliases: ["whey protein"] },
  { slug: "whey_protein_concentrate", search: "whey protein powder", displayName: "Whey protein concentrate", category: "supplement" },
  { slug: "casein_protein", search: "casein protein powder", displayName: "Casein protein", category: "supplement" },
  { slug: "pea_protein_powder", search: "pea protein isolate", displayName: "Pea protein powder", category: "supplement" },

  // ---- BEVERAGES ----
  { slug: "coffee_brewed", search: "coffee brewed prepared with tap water", displayName: "Coffee, brewed", category: "beverage" },
  { slug: "green_tea_brewed", search: "tea green brewed", displayName: "Green tea", category: "beverage" },
  { slug: "black_tea_brewed", search: "tea black brewed prepared with tap water", displayName: "Black tea", category: "beverage" },
  { slug: "orange_juice", search: "orange juice raw", displayName: "Orange juice", category: "beverage" },
  { slug: "apple_juice", search: "apple juice canned", displayName: "Apple juice", category: "beverage" },
  { slug: "coconut_water", search: "nuts coconut water", displayName: "Coconut water", category: "beverage" },

  // ---- OTHER ----
  { slug: "olives_black", search: "olives ripe canned small-extra large", displayName: "Black olives", category: "fat" },
  { slug: "olives_green", search: "olives pickled canned or bottled green", displayName: "Green olives", category: "fat" },
  { slug: "pickles_dill", search: "pickles cucumber dill", displayName: "Dill pickles", category: "vegetable" },
  { slug: "sauerkraut", search: "sauerkraut canned", displayName: "Sauerkraut", category: "vegetable" },
  { slug: "kimchi", search: "kimchi cabbage korean", displayName: "Kimchi", category: "vegetable" },
  { slug: "nutritional_yeast", search: "leavening agents yeast bakers active dry", displayName: "Nutritional yeast", category: "supplement" },
  { slug: "chocolate_dark_70", search: "chocolate dark 70-85% cacao solids", displayName: "Dark chocolate, 70%", category: "fat" },
  { slug: "cocoa_powder_unsweetened", search: "cocoa dry powder unsweetened", displayName: "Cocoa powder, unsweetened", category: "condiment" },
];

export function getIngredientSeeds(): IngredientSeed[] {
  return INGREDIENT_SEEDS;
}
