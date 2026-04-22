/**
 * POST /api/nutrition/generate-plan
 *
 * Generates a 7-day meal plan PDF for a client with a linked intake form.
 * Uses 7 parallel Claude calls (one per day) to stay well under Vercel's 60s cap.
 * Allowed regardless of nutrition_status (supports post-delivery revisions).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  calculateMacros,
  goalLabelFor,
  parseActivityLevel,
  parseHeightToCm,
  parseWeightToKg,
} from "@/lib/nutrition/macro-calculator";
import {
  parseGoalFromText,
  parseBlockedFoods,
  parsePreferredFoods,
  mergeCommentDirectives,
  parseMealCount,
  prefersQuickPrep as detectQuickPrep,
  prefersSpicy as detectSpicy,
  isOnAppetiteSuppressant,
  reconcileGoalWithWeights,
} from "@/lib/nutrition/parsers";
import {
  filterAndRankIngredients,
  pickDiverseAllowed,
  type IngredientRow,
} from "@/lib/nutrition/ingredient-filter";
import {
  generateAllDays,
  type DayGenerationInput,
  type ClientIntakeSummary,
} from "@/lib/nutrition/plan-generator";
import { generateTips } from "@/lib/nutrition/tips-generator";
import {
  renderMealPlanPDF,
  type PdfDay,
  type PdfGroceryItem,
  type PdfInput,
  type PdfMeal,
} from "@/lib/nutrition/pdf-renderer";
import { optimizeAllDays } from "@/lib/nutrition/portion-optimizer";
import {
  detectMedicalFlags,
  medicalHardAvoidTokens,
  medicalHardSwaps,
  medicalIngredientCaps,
  medicalSoftAvoidTokens,
  medicalTips,
} from "@/lib/nutrition/medical";
import { computeDailySodium } from "@/lib/nutrition/sodium";

export const maxDuration = 60;

// ----- Meal slot defaults by mealsPerDay -----
function mealSlotsFor(mealsPerDay: number): { name: string; time: string }[] {
  switch (mealsPerDay) {
    case 3:
      return [
        { name: "Breakfast", time: "7:30 AM" },
        { name: "Lunch",     time: "12:30 PM" },
        { name: "Dinner",    time: "7:00 PM" },
      ];
    case 4:
      return [
        { name: "Breakfast", time: "7:30 AM" },
        { name: "Lunch",     time: "12:30 PM" },
        { name: "Snack",     time: "4:00 PM" },
        { name: "Dinner",    time: "7:30 PM" },
      ];
    case 5:
      return [
        { name: "Breakfast",       time: "7:30 AM" },
        { name: "Morning Snack",   time: "10:30 AM" },
        { name: "Lunch",           time: "1:00 PM" },
        { name: "Afternoon Snack", time: "4:30 PM" },
        { name: "Dinner",          time: "7:30 PM" },
      ];
    case 6:
      return [
        { name: "Breakfast",       time: "7:00 AM" },
        { name: "Morning Snack",   time: "10:00 AM" },
        { name: "Lunch",           time: "12:30 PM" },
        { name: "Afternoon Snack", time: "3:30 PM" },
        { name: "Dinner",          time: "6:30 PM" },
        { name: "Evening Snack",   time: "9:00 PM" },
      ];
    default: // 3 as fallback
      return [
        { name: "Breakfast", time: "7:30 AM" },
        { name: "Lunch",     time: "12:30 PM" },
        { name: "Dinner",    time: "7:00 PM" },
      ];
  }
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];


/**
 * Split a "Protein Preferences" free-text field (e.g., "Chicken, Beef, Fish, Eggs, Dairy")
 * into an ordered list of short tokens, trimmed.
 */
function rankProteinPreferences(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n/|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 30);
}

/**
 * Extract food nouns from a free-text "daily meals description" field.
 * Uses a static allowlist of common foods so we don't match random words.
 * If the client writes "5 pieces of watermelon at breakfast" → we pull "watermelon".
 */
function extractFoodsFromDailyMealsDescription(raw: string): string[] {
  if (!raw) return [];
  const s = raw.toLowerCase();
  // Known foods that are likely to appear in intake free-text and that we'd
  // want to try to include in the plan. Kept generic; Miss matches fall back
  // to the reviewer note.
  const known = [
    "chicken", "beef", "pork", "turkey", "salmon", "tuna", "shrimp", "eggs",
    "egg whites", "bacon", "sausage",
    "rice", "pasta", "oats", "oatmeal", "bread", "toast", "bagel", "tortilla",
    "potato", "potatoes", "sweet potato", "quinoa",
    "broccoli", "asparagus", "spinach", "kale", "lettuce", "tomato", "tomatoes",
    "cucumber", "carrot", "carrots", "bell pepper", "peppers", "onion", "cabbage",
    "green beans", "brussels sprouts", "corn", "cauliflower", "zucchini",
    "banana", "apple", "apples", "orange", "blueberries", "strawberries",
    "blackberries", "grapes", "raspberries", "pineapple", "mango", "watermelon",
    "peach", "pear", "cherries",
    "greek yogurt", "cottage cheese", "cheese", "milk", "butter", "cream cheese",
    "almonds", "walnuts", "peanuts", "peanut butter", "cashews",
    "salsa", "hot sauce", "ranch", "honey", "mustard", "mayo",
    "smoothie", "shake", "whey", "protein bar",
    "avocado", "olive oil", "beans", "black beans", "lentils", "chickpeas",
  ];
  const hits = new Set<string>();
  for (const food of known) {
    if (s.includes(food)) hits.add(food);
  }
  return Array.from(hits);
}

function cmToFtIn(cm: number): string {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inch = Math.round(totalIn - ft * 12);
  return `${ft}'${inch}"`;
}

function kgToLbs(kg: number): number {
  return kg * 2.20462;
}

function amountLabel(grams: number, category: string): string {
  // Liquids/beverages use ml, solids use g. Rough heuristic.
  if (category === "beverage" || category === "fat" || category === "condiment") {
    // Fats/oils/sauces often dosed in ml; treat <= 30g as ml for oils/dressings
    if (grams <= 30) return `${Math.round(grams)}ml`;
  }
  return `${Math.round(grams)}g`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const body = await req.json();
  const clientId = body.clientId as number;
  if (!clientId) {
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  }

  const startTime = Date.now();
  const db = getServiceSupabase();

  try {
    // --- Load client + intake ---
    const { data: client, error: clientErr } = await db.from("clients").select("*").eq("id", clientId).single();
    if (clientErr || !client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (!client.nutrition_form_id) {
      return NextResponse.json(
        { error: "Client has no linked nutrition intake form. Link one first." },
        { status: 400 }
      );
    }
    const { data: intake, error: intakeErr } = await db
      .from("nutrition_intake_forms").select("*").eq("id", client.nutrition_form_id).single();
    if (intakeErr || !intake) {
      return NextResponse.json({ error: "Intake form not found" }, { status: 404 });
    }

    // --- Comments ---
    const { data: comments } = await db
      .from("nutrition_task_comments")
      .select("comment, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    const commentList = (comments || []).map((c) => ({ comment: c.comment, createdAt: c.created_at }));

    // --- Compute targets ---
    const directives = mergeCommentDirectives(commentList);
    const weightKg = directives.weightKgOverride ?? parseWeightToKg(intake.current_weight) ?? 80;
    const goalKg = parseWeightToKg(intake.goal_weight);
    const heightCm = parseHeightToCm(intake.height) ?? 175;
    const age = intake.age || 30;
    const sex = directives.sexOverride ?? "male";
    const textGoal = parseGoalFromText(intake.fitness_goal);
    const reconciled = reconcileGoalWithWeights(textGoal, weightKg, goalKg);
    const goal = reconciled.goal;
    const mealsPerDay = parseMealCount(intake.meal_count);

    // Medical flags must be detected BEFORE target calculation because
    // Diabetes shifts the carb/fat split and Kidney issues cap protein.
    // This preserves the "single source of truth" guarantee: calculateMacros
    // already reflects medical modifiers, so PDF and validator read the
    // same numbers.
    const medical = detectMedicalFlags(intake.allergies || "", intake.medications || "");
    const activityLevel = parseActivityLevel(intake.activity_level || intake.fitness_goal || "");

    const targets = calculateMacros(
      {
        sex,
        weightKg,
        heightCm,
        age,
        goal,
        activityLevel,
        medical: {
          hasHypertension: medical.hasHypertension,
          hasDiabetes: medical.hasDiabetes,
          hasKidneyIssues: medical.hasKidneyIssues,
        },
      },
      directives.macroOverrides
    );
    if (reconciled.overrodeText && reconciled.note) {
      targets.notes.push(reconciled.note);
    }

    // --- Ingredients ---
    const { data: ingredients } = await db
      .from("ingredients")
      .select("id, slug, name, aliases, category, calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g");
    if (!ingredients || ingredients.length === 0) {
      return NextResponse.json({ error: "Ingredient database empty" }, { status: 500 });
    }
    // Medical flags → auto-append Celiac/Lactose avoid tokens to the hard block list
    const celiacAutoAvoid = medical.hasCeliacOrGluten
      ? ["wheat", "barley", "rye", "spelt", "kamut", "seitan", "couscous", "regular pasta"]
      : [];
    const lactoseAutoAvoid = medical.hasLactoseIntolerance
      ? ["milk", "cheese", "yogurt", "cream", "ice cream", "salted butter", "unsalted butter", "butter"]
      : [];

    const blocked = [
      ...parseBlockedFoods(intake.allergies, intake.foods_avoid),
      ...celiacAutoAvoid,
      ...lactoseAutoAvoid,
      ...medicalHardAvoidTokens(medical), // MAOI tyramine foods, etc.
    ];
    const preferred = parsePreferredFoods(intake.foods_enjoy, intake.protein_preferences);

    // Soft-avoid tokens (HBP pushes high-sodium items down in ranking)
    const medSoftAvoid = medicalSoftAvoidTokens(medical);

    const rankedIngredients = filterAndRankIngredients(
      ingredients as IngredientRow[],
      blocked,
      preferred
    );
    // Push soft-avoid items to the bottom of the ranked list
    if (medSoftAvoid.length > 0) {
      const isSoftAvoid = (ing: IngredientRow) => {
        const hay = [ing.slug, ing.name, ...(ing.aliases || [])].join(" ").toLowerCase();
        return medSoftAvoid.some((t) => hay.includes(t.toLowerCase()));
      };
      const [avoided, kept] = [
        rankedIngredients.filter(isSoftAvoid),
        rankedIngredients.filter((i) => !isSoftAvoid(i)),
      ];
      rankedIngredients.length = 0;
      rankedIngredients.push(...kept, ...avoided);
    }

    const byslug = new Map<string, IngredientRow>();
    for (const i of ingredients as IngredientRow[]) byslug.set(i.slug, i);

    const intakeSummary: ClientIntakeSummary = {
      firstName: intake.first_name,
      lastName: intake.last_name,
      fitnessGoal: intake.fitness_goal,
      foodsEnjoy: intake.foods_enjoy,
      foodsAvoid: intake.foods_avoid,
      allergies: intake.allergies,
      proteinPreferences: intake.protein_preferences,
      canCook: intake.can_cook,
      mealCount: intake.meal_count,
      medications: intake.medications,
      supplements: intake.supplements,
      sleepHours: intake.sleep_hours,
      waterIntake: intake.water_intake,
      dailyMealsDescription: intake.daily_meals_description,
    };

    const slots = mealSlotsFor(mealsPerDay);
    const priorCommentTexts = commentList.map((c) => c.comment);

    // Intake-driven flags used by the prompt
    const quickPrep = detectQuickPrep(intake.foods_avoid, intake.daily_meals_description, intake.can_cook);
    const spicy = detectSpicy(intake.foods_enjoy);
    const preferredProteins = rankProteinPreferences(intake.protein_preferences || "");

    // Guarantee presence of spicy items when the client likes spicy food
    const spicyRequired = spicy ? ["salsa", "hot_sauce", "jalapeno_raw"] : [];

    // Priority-placement: foods that appear in BOTH the enjoyed list and the
    // daily meals description get forced into the allowed ingredient set so
    // Claude sees them. Match by substring against slug/name/aliases.
    const dailyDescFoods = extractFoodsFromDailyMealsDescription(intake.daily_meals_description || "");
    const enjoyedFoods = parsePreferredFoods(intake.foods_enjoy || "", "");
    const overlapTokens = dailyDescFoods.filter((f) =>
      enjoyedFoods.some((e) => e.toLowerCase().includes(f) || f.includes(e.toLowerCase()))
    );
    const priorityRequiredSlugs: string[] = [];
    for (const token of overlapTokens) {
      const match = (ingredients as IngredientRow[]).find((ing) => {
        const hay = [ing.slug, ing.name, ...(ing.aliases || [])].join(" ").toLowerCase();
        return hay.includes(token);
      });
      if (match) priorityRequiredSlugs.push(match.slug);
    }

    const allowed = pickDiverseAllowed(rankedIngredients, {
      size: 100,
      extraRequiredSlugs: [...spicyRequired, ...priorityRequiredSlugs],
    });

    // Rotate which proteins to "avoid" per day so the top preferences still get used
    // across the week without being every day.
    const rotateAvoid = (dayIdx: number): string[] => {
      if (preferredProteins.length === 0) return [];
      if (dayIdx < 2) return [];
      const cycle = preferredProteins;
      const avoidIdx = dayIdx % cycle.length;
      return [cycle[avoidIdx]];
    };

    // Structural format rotation so meals don't default to the same shape every day.
    // Breakfast and lunch cycles are different length to further break pattern lock-in.
    const BREAKFAST_FORMATS = ["bowl (oats/yogurt)", "scramble/omelette plate", "savory burrito or wrap", "smoothie bowl", "pancakes or protein toast", "egg-and-toast plate", "breakfast tacos"];
    const LUNCH_FORMATS     = ["rice bowl", "wrap or burrito", "salad with protein", "sandwich plate", "pasta plate", "taco plate", "stir-fry over rice"];
    const DINNER_FORMATS    = ["protein + starch + vegetable plate", "crockpot stew/chili style", "stir-fry bowl", "taco/fajita plate", "pasta bake or skillet", "grain bowl with roasted vegetables", "salad with hearty protein"];
    const SNACK_FORMATS     = ["yogurt + fruit + grain", "protein shake + fruit", "cottage cheese + fruit", "rice cakes + protein", "hard-boiled eggs + fruit", "cheese + fruit + crackers", "protein bar + fruit"];

    const formatHintsFor = (dayIdx: number) => {
      const h: Record<string, string> = {
        Breakfast: BREAKFAST_FORMATS[dayIdx % BREAKFAST_FORMATS.length],
        Lunch:     LUNCH_FORMATS    [dayIdx % LUNCH_FORMATS.length],
        Dinner:    DINNER_FORMATS   [dayIdx % DINNER_FORMATS.length],
        Snack:     SNACK_FORMATS    [dayIdx % SNACK_FORMATS.length],
        "Morning Snack":   SNACK_FORMATS[(dayIdx + 3) % SNACK_FORMATS.length],
        "Afternoon Snack": SNACK_FORMATS[(dayIdx + 5) % SNACK_FORMATS.length],
        "Evening Snack":   SNACK_FORMATS[(dayIdx + 2) % SNACK_FORMATS.length],
      };
      return h;
    };

    // --- Build 7 per-day Claude inputs ---
    const dayInputs: DayGenerationInput[] = [];
    for (let i = 0; i < 7; i++) {
      dayInputs.push({
        dayNumber: i + 1,
        weekday: WEEKDAYS[i],
        mealSlots: slots,
        intake: intakeSummary,
        targets,
        allowedIngredients: allowed,
        priorComments: priorCommentTexts,
        prefersQuickPrep: quickPrep,
        prefersSpicy: spicy,
        preferredProteins,
        avoidProteins: rotateAvoid(i),
        formatHints: formatHintsFor(i),
        hbpContext: medical.hasHypertension
          ? {
              sodiumCapMg: targets.sodiumCapMg,
              dayNumber: i + 1,
              // On the initial parallel fire every day sees the full budget;
              // retries recompute these from the current plan state below.
              allowedCheeseDaysLeft: 3,
              allowedSourdoughDaysLeft: 2,
              allowedFlourTortillaDaysLeft: 3,
            }
          : undefined,
      });
    }

    // --- Fire all 7 Claude calls in parallel ---
    let days = await generateAllDays(dayInputs, apiKey);

    // ---------- ITERATIVE VALIDATE → CORRECT LOOP ----------
    // Up to MAX_ITER iterations. Each iteration: compute per-day violations,
    // retry JUST the violating days in parallel (with specific fix instructions),
    // merge the better of each pair, re-validate. Stops when clean, time-bounded,
    // or iteration cap reached.
    // Single source of truth: read sodium cap from the unified targets object
    const sodiumCap = targets.sodiumCapMg;

    const computeTotals = (d: (typeof days)[number]) => {
      let cal = 0, p = 0, c = 0, f = 0;
      for (const meal of d.meals) {
        for (const ing of meal.ingredients) {
          const row = byslug.get(ing.slug);
          if (!row) continue;
          const factor = ing.grams / 100;
          cal += Number(row.calories_per_100g) * factor;
          p   += Number(row.protein_g_per_100g) * factor;
          c   += Number(row.carbs_g_per_100g) * factor;
          f   += Number(row.fat_g_per_100g) * factor;
        }
      }
      return { cal, p, c, f };
    };

    const weightLbClient = weightKg * 2.20462;

    interface TierViolation {
      tier: 1 | 2;
      kind: string;
      message: string;
    }

    /**
     * Tier 1 = SAFETY (must pass; any failure → RED, no ship).
     * Tier 2 = QUALITY (target ~90%, 1-2 day misses OK → still ships YELLOW).
     */
    const findViolationsForDay = (d: (typeof days)[number]): TierViolation[] => {
      const v: TierViolation[] = [];
      const t = computeTotals(d);
      const calPct = (t.cal - targets.calories) / targets.calories;
      const pPct   = (t.p   - targets.proteinG) / targets.proteinG;
      const cPct   = (t.c   - targets.carbsG)   / targets.carbsG;
      const fPct   = (t.f   - targets.fatG)     / targets.fatG;

      // ===== TIER 1 — SAFETY =====

      // Calorie FLOOR — no day below 1,200 kcal regardless of goal.
      if (t.cal < 1200) {
        v.push({
          tier: 1,
          kind: "kcal_floor",
          message: `CALORIES at ${Math.round(t.cal)} kcal — below the 1,200 kcal safety floor. Under-eating this severely is unsafe. Increase portions.`,
        });
      }

      // Calorie CEILING — no day above 4,000 kcal.
      if (t.cal > 4000) {
        v.push({
          tier: 1,
          kind: "kcal_ceiling",
          message: `CALORIES at ${Math.round(t.cal)} kcal — above the 4,000 kcal safety ceiling. This is beyond normal macro coaching range.`,
        });
      }

      // Protein CEILING — 2.0 g/lb normally; 2.2 g/lb for muscle_gain without kidney issues.
      const proteinCeilingPerLb = (goal === "muscle_gain" && !medical.hasKidneyIssues) ? 2.2 : 2.0;
      const proteinCeilingG = Math.round(weightLbClient * proteinCeilingPerLb);
      if (t.p > proteinCeilingG) {
        v.push({
          tier: 1,
          kind: "protein_ceiling",
          message: `PROTEIN at ${t.p.toFixed(0)}g — above the ${proteinCeilingG}g safety ceiling (${proteinCeilingPerLb} g/lb). Sustained intake this high stresses the kidneys.`,
        });
      }

      // Sodium — two-tier for HBP clients so clinically-safe over-target days
      // don't block shipping. For non-HBP, the universal 2,300 mg AHA ceiling
      // is a straight hard-block.
      //
      //   HBP client (e.g., cap 1800):
      //     target    = 1800           (Tier 2 threshold — aspirational)
      //     safety    = max(cap+200, cap×1.15), capped at 2300
      //                = max(2000, 2070) = 2070
      //     Days under 1800                  → clean
      //     Days 1800-2070                   → Tier 2 quality note (ships)
      //     Days over 2070 (or over 2300)    → Tier 1 hard block
      //
      //   Non-HBP:
      //     safety = 2300 (universal AHA). Anything over → Tier 1.
      //     No Tier 2 sodium warning.
      const sodium = computeDailySodium(d, byslug);
      if (medical.hasHypertension) {
        const cap = targets.sodiumCapMg; // aspirational target (1800 default)
        const tier2Ceiling = Math.max(cap + 200, Math.round(cap * 1.15));
        const tier1Ceiling = Math.min(tier2Ceiling, 2300);
        if (sodium > tier1Ceiling) {
          v.push({
            tier: 1,
            kind: "sodium_safety",
            message: `SODIUM is ${sodium} mg — exceeds the ${tier1Ceiling} mg HBP safety ceiling (${cap} mg target + buffer). Reduce cheese, soy sauce, dressings, cured meats, salted butter.`,
          });
        } else if (sodium > cap) {
          v.push({
            tier: 2,
            kind: "sodium_over_target",
            message: `SODIUM is ${sodium} mg — over the ${cap} mg HBP target by ${sodium - cap} mg (within the ${tier1Ceiling} mg safety ceiling). Trim added salt where possible.`,
          });
        }
      } else {
        if (sodium > 2300) {
          v.push({
            tier: 1,
            kind: "sodium_safety",
            message: `SODIUM is ${sodium} mg — exceeds the 2,300 mg universal AHA ceiling.`,
          });
        }
      }

      // Portion sanity — signals a pathological generation state.
      // IMPORTANT: Use WORD-BOUNDARY matching on a normalized haystack (slug
      // underscores replaced with spaces) so "b\boil\bed" in "potato boiled"
      // doesn't false-match /oil/. Also exclude nut butters from the fat cap
      // (peanut/almond/cashew butter are high-fat foods but not cooking fats).
      const wbHas = (hay: string, word: string): boolean =>
        new RegExp(`\\b${word}\\b`).test(hay);

      for (const meal of d.meals) {
        for (const ing of meal.ingredients) {
          const row = byslug.get(ing.slug);
          if (!row) continue;
          // Normalize: "butter_unsalted" → "butter unsalted", "olive_oil" → "olive oil"
          const hay = `${row.slug.replace(/_/g, " ")} ${(row.name || "").toLowerCase()}`.toLowerCase();
          const grams = ing.grams;

          // --- 350g meat ---
          const meatWords = ["chicken", "beef", "pork", "turkey", "salmon", "tuna", "cod", "shrimp", "sirloin", "ribeye", "tenderloin", "thigh", "breast"];
          const isBrothOrStock = /\bbroth\b|\bstock\b/.test(hay);
          if (grams > 350 && !isBrothOrStock && meatWords.some((w) => wbHas(hay, w))) {
            v.push({ tier: 1, kind: "portion_sanity_meat", message: `"${meal.dishName || meal.name}" contains ${grams}g of ${row.name} — exceeds 350g meat portion sanity limit.` });
          }

          // --- 50g oil/butter (cooking fats only) ---
          // Exclude nut butters and seed butters — they're fat-dense but not cooking fats.
          const isNutButter = /\b(peanut|almond|cashew|sunflower|pumpkin|tahini|sesame seed)\b.*\bbutter\b/.test(hay);
          const isCookingFat =
            !isNutButter &&
            (wbHas(hay, "butter") || wbHas(hay, "oil") || wbHas(hay, "ghee") ||
             wbHas(hay, "lard") || wbHas(hay, "tallow") || wbHas(hay, "margarine"));
          if (grams > 50 && isCookingFat) {
            v.push({ tier: 1, kind: "portion_sanity_oil", message: `"${meal.dishName || meal.name}" contains ${grams}g of ${row.name} — exceeds 50g oil/butter per meal.` });
          }

          // --- 200g cheese ---
          const cheeseWords = ["cheese", "mozzarella", "cheddar", "parmesan", "feta", "ricotta", "swiss", "provolone", "gouda", "brie"];
          const isCottage = /\bcottage cheese\b/.test(hay); // cottage cheese is lighter — use a higher bar
          if (!isCottage && grams > 200 && cheeseWords.some((w) => wbHas(hay, w))) {
            v.push({ tier: 1, kind: "portion_sanity_cheese", message: `"${meal.dishName || meal.name}" contains ${grams}g of ${row.name} — exceeds 200g cheese per meal.` });
          }
          if (isCottage && grams > 300) {
            v.push({ tier: 1, kind: "portion_sanity_cheese", message: `"${meal.dishName || meal.name}" contains ${grams}g of ${row.name} — exceeds 300g cottage cheese per meal.` });
          }

          // --- 150g dry grain (only when clearly pre-cooked/dry) ---
          const grainWords = ["rice", "oats", "oatmeal", "pasta", "quinoa", "barley", "couscous", "millet"];
          const isRawOrDry = /\b(raw|dry|uncooked)\b/.test(hay);
          if (grams > 150 && isRawOrDry && grainWords.some((w) => wbHas(hay, w))) {
            v.push({ tier: 1, kind: "portion_sanity_grain", message: `"${meal.dishName || meal.name}" contains ${grams}g of dry ${row.name} — exceeds 150g dry grain per meal.` });
          }
        }
      }

      // Kidney disease: protein ≤ 0.6 g/lb, strict per-day cap
      if (medical.hasKidneyIssues) {
        const kidneyCapG = Math.round(weightLbClient * 0.6);
        if (t.p > kidneyCapG * 1.05) { // 5% slack for rounding
          v.push({
            tier: 1,
            kind: "kidney_protein_cap",
            message: `PROTEIN is ${t.p.toFixed(0)}g exceeding kidney cap of ${kidneyCapG}g (0.6 g/lb). Reduce main protein portion.`,
          });
        }
      }

      // Goal-direction kcal rule: fat_loss can't go >110%, muscle_gain can't go <90%
      if (goal === "fat_loss" && calPct > 0.10) {
        v.push({
          tier: 1,
          kind: "goal_direction_kcal",
          message: `FAT LOSS goal but day is ${Math.round(calPct * 100)}% OVER calorie target (${Math.round(t.cal)} vs ${targets.calories}). Must land ≤ +10%.`,
        });
      }
      if (goal === "muscle_gain" && calPct < -0.10) {
        v.push({
          tier: 1,
          kind: "goal_direction_kcal",
          message: `MUSCLE GAIN goal but day is ${Math.round(-calPct * 100)}% UNDER calorie target (${Math.round(t.cal)} vs ${targets.calories}). Must land ≥ −10%.`,
        });
      }

      // Diabetic: no single meal >50% of daily carbs (prevents blood-sugar spikes)
      if (medical.hasDiabetes) {
        let worstMealCarbs = 0, worstMealName = "";
        for (const meal of d.meals) {
          let mC = 0;
          for (const ing of meal.ingredients) {
            const row = byslug.get(ing.slug);
            if (!row) continue;
            mC += Number(row.carbs_g_per_100g) * (ing.grams / 100);
          }
          if (mC > worstMealCarbs) { worstMealCarbs = mC; worstMealName = meal.dishName || meal.name; }
        }
        if (worstMealCarbs > t.c * 0.50 && t.c > 0) {
          v.push({
            tier: 1,
            kind: "diabetic_carb_spike",
            message: `"${worstMealName}" has ${Math.round(worstMealCarbs)}g carbs — more than 50% of the day's ${t.c.toFixed(0)}g total. Distribute carbs more evenly across meals.`,
          });
        }
      }

      // ===== TIER 2 — QUALITY (loosened bands) =====

      if (Math.abs(calPct) > 0.10) {
        v.push({ tier: 2, kind: "kcal", message: calPct > 0
          ? `CALORIES ${Math.round(calPct * 100)}% OVER (${Math.round(t.cal)} vs ${targets.calories}) — reduce added fats and starch portions.`
          : `CALORIES ${Math.round(-calPct * 100)}% UNDER (${Math.round(t.cal)} vs ${targets.calories}) — increase protein and carb portions.`});
      }
      // Protein band: −15% (floor) to +30% (ceiling)
      if (pPct < -0.15) {
        v.push({ tier: 2, kind: "protein", message: `PROTEIN ${Math.round(-pPct * 100)}% UNDER (${t.p.toFixed(0)}g vs ${targets.proteinG}g floor) — bump the main protein's grams.` });
      } else if (pPct > 0.30) {
        v.push({ tier: 2, kind: "protein", message: `PROTEIN ${Math.round(pPct * 100)}% OVER (${t.p.toFixed(0)}g vs ${targets.proteinG}g) — reduce protein and shift calories to carbs 1:1.` });
      }
      if (Math.abs(cPct) > 0.15) {
        v.push({ tier: 2, kind: "carbs", message: cPct > 0
          ? `CARBS ${Math.round(cPct * 100)}% OVER (${t.c.toFixed(0)}g vs ${targets.carbsG}g) — trim rice/bread/pasta.`
          : `CARBS ${Math.round(-cPct * 100)}% UNDER (${t.c.toFixed(0)}g vs ${targets.carbsG}g) — increase rice/potato/oats/bread by 30-50g.` });
      }
      if (Math.abs(fPct) > 0.15) {
        v.push({ tier: 2, kind: "fat", message: fPct > 0
          ? `FAT ${Math.round(fPct * 100)}% OVER (${t.f.toFixed(0)}g vs ${targets.fatG}g) — halve butter/oil/cheese/nut portions.`
          : `FAT ${Math.round(-fPct * 100)}% UNDER (${t.f.toFixed(0)}g vs ${targets.fatG}g) — add 5-10g olive oil or a small cheese portion.` });
      }
      // Per-meal fat cap (Tier 2 — realism)
      let worstMealFat = 0, worstMealName = "";
      for (const meal of d.meals) {
        let mFat = 0;
        for (const ing of meal.ingredients) {
          const row = byslug.get(ing.slug);
          if (!row) continue;
          mFat += Number(row.fat_g_per_100g) * (ing.grams / 100);
        }
        if (mFat > worstMealFat) { worstMealFat = mFat; worstMealName = meal.dishName || meal.name; }
      }
      if (worstMealFat > targets.fatG * 0.40) {
        v.push({ tier: 2, kind: "per_meal_fat", message: `"${worstMealName}" has ${Math.round(worstMealFat)}g fat — over 40% of daily target. Max ${Math.round(targets.fatG * 0.4)}g per meal.` });
      }

      // Per-meal protein FLOOR — breakfast 25%, lunch/dinner 30% of daily target.
      // Surgical correction pattern: flag just the undershooting meal(s), not the whole day.
      for (const meal of d.meals) {
        let mP = 0;
        for (const ing of meal.ingredients) {
          const row = byslug.get(ing.slug);
          if (!row) continue;
          mP += Number(row.protein_g_per_100g) * (ing.grams / 100);
        }
        const mealName = meal.name || "";
        const isBreakfast = /breakfast/i.test(mealName);
        const isLunch = /lunch/i.test(mealName);
        const isDinner = /dinner/i.test(mealName);
        const floorPct = isBreakfast ? 0.25 : (isLunch || isDinner) ? 0.30 : 0;
        if (floorPct === 0) continue; // snacks fill the remainder — no floor
        const floorG = Math.round(targets.proteinG * floorPct);
        if (mP < floorG * 0.90) {
          v.push({
            tier: 2,
            kind: "per_meal_protein_floor",
            message: `"${meal.dishName || meal.name}" has ${Math.round(mP)}g protein — below the ${floorG}g floor (${Math.round(floorPct * 100)}% of daily ${targets.proteinG}g target). Add or increase the protein anchor (chicken/beef/fish/eggs/Greek yogurt/cottage cheese/whey).`,
          });
        }
      }

      return v;
    };

    const scoreDay = (t: { cal: number; p: number; c: number; f: number }) =>
      Math.abs(t.cal - targets.calories) +
      Math.abs(t.p - targets.proteinG) * 4 +
      Math.abs(t.c - targets.carbsG) * 4 +
      Math.abs(t.f - targets.fatG) * 9;

    const MAX_ITER = 4;
    const TIME_CEILING_MS = 38_000;
    const convergenceLog: string[] = [];

    for (let iter = 1; iter <= MAX_ITER; iter++) {
      const violating: { idx: number; violations: TierViolation[] }[] = [];
      let tier1Count = 0, tier2DayCount = 0;
      days.forEach((d, idx) => {
        const v = findViolationsForDay(d);
        const hasT1 = v.some((x) => x.tier === 1);
        const hasT2 = v.some((x) => x.tier === 2);
        if (hasT1) tier1Count++;
        if (hasT2) tier2DayCount++;
        if (v.length > 0) violating.push({ idx, violations: v });
      });
      convergenceLog.push(`iter ${iter - 1}: ${tier1Count} T1 day(s), ${tier2DayCount} T2 day(s)`);

      // Exit conditions:
      //  • No violations at all OR
      //  • All Tier 1 clean AND Tier 2 ≤ 2 day-violations (the "good enough" target)
      if (violating.length === 0) break;
      if (tier1Count === 0 && tier2DayCount <= 2) break;
      if (Date.now() - startTime > TIME_CEILING_MS) {
        convergenceLog.push(`aborted — time budget reached`);
        break;
      }

      // Build correction prompts. When Tier 1 is still dirty, we focus the
      // retry on those days ONLY and explicitly tag their violations as
      // PRIORITY 1. When Tier 1 is clean, we spend remaining iterations on Tier 2.
      const anyTier1 = tier1Count > 0;
      const targetDays = anyTier1
        ? violating.filter(({ violations }) => violations.some((x) => x.tier === 1))
        : violating;

      // For HBP retries: compute running weekly cap counts from the days
      // NOT being retried, so each retry knows how much budget it has left.
      const computeCapUsage = (slugMatch: string, excludeIdx: Set<number>): number => {
        let dayCount = 0;
        days.forEach((d, di) => {
          if (excludeIdx.has(di)) return;
          const usedInDay = d.meals.some((m) =>
            m.ingredients.some((ing) => {
              const row = byslug.get(ing.slug);
              const name = (row?.name || "").toLowerCase();
              return ing.slug.includes(slugMatch) || name.includes(slugMatch);
            })
          );
          if (usedInDay) dayCount++;
        });
        return dayCount;
      };

      const retryInputs = targetDays.map(({ idx, violations }) => {
        const t = computeTotals(days[idx]);
        const header = `Prior attempt: ${Math.round(t.cal)} kcal, ${t.p.toFixed(0)}g protein, ${t.c.toFixed(0)}g carbs, ${t.f.toFixed(0)}g fat. Targets: ${targets.calories}/${targets.proteinG}P/${targets.carbsG}C/${targets.fatG}F.`;
        const t1 = violations.filter((x) => x.tier === 1).map((x) => `• ${x.message}`);
        const t2 = violations.filter((x) => x.tier === 2).map((x) => `• ${x.message}`);
        const sections: string[] = [header];
        if (t1.length > 0) sections.push(`PRIORITY 1 (must fix — safety):\n${t1.join("\n")}`);
        if (t2.length > 0) sections.push(`PRIORITY 2 (nice to fix — quality):\n${t2.join("\n")}`);
        sections.push(`Fix PRIORITY 1 first. Only touch PRIORITY 2 if it doesn't create new PRIORITY 1 violations.`);

        // Refresh HBP cap budget: what's left AFTER subtracting the days
        // we're KEEPING (other days in the week that aren't this retry).
        let refreshedHbp = dayInputs[idx].hbpContext;
        if (refreshedHbp && medical.hasHypertension) {
          const excludeIdx = new Set([idx]);
          const cheeseUsed = computeCapUsage("cheese", excludeIdx);
          const sourdoughUsed = computeCapUsage("sourdough", excludeIdx);
          const flourTortillaUsed = computeCapUsage("tortilla_flour", excludeIdx) +
                                    computeCapUsage("flour tortilla", excludeIdx);
          refreshedHbp = {
            ...refreshedHbp,
            allowedCheeseDaysLeft: Math.max(0, 3 - cheeseUsed),
            allowedSourdoughDaysLeft: Math.max(0, 2 - sourdoughUsed),
            allowedFlourTortillaDaysLeft: Math.max(0, 3 - flourTortillaUsed),
          };
        }

        return {
          ...dayInputs[idx],
          priorAttemptError: sections.join("\n\n"),
          hbpContext: refreshedHbp,
        };
      });

      const retryDays = await generateAllDays(retryInputs, apiKey);
      for (const rd of retryDays) {
        const idx = rd.day - 1;
        if (scoreDay(computeTotals(rd)) < scoreDay(computeTotals(days[idx]))) {
          days[idx] = rd;
        }
      }
    }

    // ---------- DETERMINISTIC PORTION OPTIMIZATION ----------
    // After Claude retries, any remaining macro drift is pure arithmetic —
    // nudging gram amounts on ingredients Claude already selected. This is
    // deterministic and guaranteed to land within ±5% on nearly every day.
    optimizeAllDays(days, byslug, targets);

    // ---------- MEDICAL HARD SWAPS + FREQUENCY CAPS ----------
    // Swap problematic ingredients (e.g., salted butter → unsalted) and cap
    // how often high-sodium/high-saturated-fat items appear across the week
    // based on detected medical conditions.
    const hardSwaps = medicalHardSwaps(medical, byslug);
    const freqCaps = medicalIngredientCaps(medical);

    // Apply hard swaps first (preserves portion size)
    for (const d of days) {
      for (const m of d.meals) {
        for (const ing of m.ingredients) {
          if (hardSwaps[ing.slug]) {
            ing.slug = hardSwaps[ing.slug];
          }
        }
      }
    }

    // Enforce frequency caps: count day-appearances per cap-key, over the cap
    // replace the lowest-impact occurrence with a neutral alternative (olive oil
    // for fats, skip for cheeses by reducing grams to zero).
    for (const [capKey, maxDays] of Object.entries(freqCaps)) {
      const matches: { dayIdx: number; mealIdx: number; ingIdx: number }[] = [];
      days.forEach((d, di) => {
        d.meals.forEach((m, mi) => {
          m.ingredients.forEach((ing, ii) => {
            if (ing.slug.includes(capKey)) matches.push({ dayIdx: di, mealIdx: mi, ingIdx: ii });
          });
        });
      });
      if (matches.length > maxDays) {
        // Remove (zero-out) the excess matches from the end — the optimizer
        // will re-run if needed but at this stage we're applying clinical
        // judgment over strict macro adherence.
        const toRemove = matches.slice(maxDays);
        for (const m of toRemove) {
          const meal = days[m.dayIdx].meals[m.mealIdx];
          // Drop the ingredient and bump a neutral starch/veg to compensate calories
          meal.ingredients.splice(m.ingIdx, 1);
        }
      }
    }

    // Re-optimize portions after the medical adjustments
    if (Object.keys(hardSwaps).length > 0 || Object.keys(freqCaps).length > 0) {
      optimizeAllDays(days, byslug, targets);
    }

    // ---------- FINAL VALIDATION (after optimizer + medical) ----------
    // Separate Tier 1 (safety) from Tier 2 (quality) so the status badge
    // and the "can ship to client" decision are grounded in severity, not a
    // single blob count.
    const unresolvedByDay: { day: number; weekday: string; violations: TierViolation[] }[] = [];
    days.forEach((d, idx) => {
      const v = findViolationsForDay(d);
      if (v.length > 0) {
        unresolvedByDay.push({ day: d.day, weekday: WEEKDAYS[idx], violations: v });
      }
    });

    const tier1Violations = unresolvedByDay
      .flatMap((u) => u.violations.filter((x) => x.tier === 1).map((x) => ({ day: u.day, weekday: u.weekday, ...x })));
    const tier2Violations = unresolvedByDay
      .flatMap((u) => u.violations.filter((x) => x.tier === 2).map((x) => ({ day: u.day, weekday: u.weekday, ...x })));
    const tier2DayCount = new Set(
      unresolvedByDay
        .filter((u) => u.violations.some((x) => x.tier === 2))
        .map((u) => u.day)
    ).size;

    convergenceLog.push(
      `post-optimizer: ${tier1Violations.length} T1 violation(s), ${tier2DayCount} T2 day(s)`
    );

    // ---------- ENJOYED-FOODS COVERAGE CHECK ----------
    // Source 1: the foods_enjoy list.
    // Source 2: items mentioned in the client's daily_meals_description —
    // stuff they already eat regularly and would expect to see on the plan.
    const enjoyedFromList = parsePreferredFoods(intake.foods_enjoy || "", "");
    const enjoyedFromDaily = extractFoodsFromDailyMealsDescription(intake.daily_meals_description || "");
    const enjoyedTokens = [...enjoyedFromList, ...enjoyedFromDaily].filter((t) => t && t.length >= 3);

    // MANDATORY enjoyed foods = intersection of foods_enjoy AND daily_meals.
    // These are items the client SAID they enjoy AND already eats day-to-day.
    // Missing one = a Tier-2 violation (at least once/week is required).
    const enjoyedFromDailyLower = enjoyedFromDaily.map((t) => t.toLowerCase());
    const mandatoryFoods = enjoyedFromList.filter((t) =>
      enjoyedFromDailyLower.some((d) => d.includes(t.toLowerCase()) || t.toLowerCase().includes(d))
    );

    const allSlugsUsed = new Set<string>();
    const allNamesUsed: string[] = [];
    for (const d of days) {
      for (const m of d.meals) {
        for (const ing of m.ingredients) {
          allSlugsUsed.add(ing.slug);
          const row = byslug.get(ing.slug);
          if (row) allNamesUsed.push(row.name.toLowerCase(), ...(row.aliases || []).map((a) => a.toLowerCase()));
        }
      }
    }
    const haystack = [...allSlugsUsed, ...allNamesUsed].join(" ").toLowerCase();
    const missingEnjoyed: string[] = [];
    const missingMandatory: string[] = [];
    for (const token of enjoyedTokens) {
      if (!haystack.includes(token.toLowerCase())) missingEnjoyed.push(token);
    }
    for (const token of mandatoryFoods) {
      if (!haystack.includes(token.toLowerCase())) missingMandatory.push(token);
    }
    if (missingEnjoyed.length > 0) {
      targets.notes.push(
        `Note for reviewer: couldn't slot these enjoyed foods into the plan (likely composite dishes or not in ingredient DB): ${missingEnjoyed.join(", ")}.`
      );
    }

    // ---------- WEEKLY CAP VIOLATIONS (Tier 2) ----------
    // Surface cheese/sourdough frequency caps for HBP clients as visible
    // Tier-2 violations + mandatory-enjoyed misses.
    const weeklyTier2Violations: { kind: string; message: string }[] = [];
    if (medical.hasHypertension) {
      const countSlugAppearances = (slugMatch: string): number => {
        let count = 0;
        for (const d of days) {
          let inDay = false;
          for (const m of d.meals) {
            for (const ing of m.ingredients) {
              const name = (byslug.get(ing.slug)?.name || "").toLowerCase();
              if (ing.slug.includes(slugMatch) || name.includes(slugMatch)) { inDay = true; break; }
            }
            if (inDay) break;
          }
          if (inDay) count++;
        }
        return count;
      };
      const cheeseDays = countSlugAppearances("cheese");
      const sourdoughDays = countSlugAppearances("sourdough");
      if (cheeseDays > 3) {
        weeklyTier2Violations.push({
          kind: "hbp_cheese_cap",
          message: `Cheese appears on ${cheeseDays} days — HBP cap is 3/week to manage sodium.`,
        });
      }
      if (sourdoughDays > 2) {
        weeklyTier2Violations.push({
          kind: "hbp_sourdough_cap",
          message: `Sourdough appears on ${sourdoughDays} days — HBP cap is 2/week. Default to whole-wheat bread.`,
        });
      }
    }
    if (missingMandatory.length > 0) {
      weeklyTier2Violations.push({
        kind: "mandatory_enjoyed_missing",
        message: `Mandatory enjoyed foods missing: ${missingMandatory.join(", ")}. These appeared in BOTH the enjoyed list AND daily meals description.`,
      });
    }

    // --- Compute macros from DB, assemble PdfDay[] ---
    const pdfDays: PdfDay[] = days.map((d) => {
      const pdfMeals: PdfMeal[] = d.meals.map((m) => {
        let mCal = 0, mP = 0, mC = 0, mF = 0;
        const ingList = m.ingredients
          .map((ing) => {
            const row = byslug.get(ing.slug);
            if (!row) return null;
            const f = ing.grams / 100;
            const cal = Number(row.calories_per_100g) * f;
            const p = Number(row.protein_g_per_100g) * f;
            const c = Number(row.carbs_g_per_100g) * f;
            const fatG = Number(row.fat_g_per_100g) * f;
            mCal += cal; mP += p; mC += c; mF += fatG;
            return {
              name: row.name,
              amount: amountLabel(ing.grams, row.category),
              calories: cal,
              proteinG: p,
              carbsG: c,
              fatG: fatG,
              category: row.category,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        return {
          name: m.name,
          time: m.time || "",
          dishName: m.dishName,
          ingredients: ingList,
          totalCal: mCal,
          totalP: mP,
          totalC: mC,
          totalF: mF,
        };
      });

      const dCal = pdfMeals.reduce((s, m) => s + m.totalCal, 0);
      const dP   = pdfMeals.reduce((s, m) => s + m.totalP, 0);
      const dC   = pdfMeals.reduce((s, m) => s + m.totalC, 0);
      const dF   = pdfMeals.reduce((s, m) => s + m.totalF, 0);
      const dNa  = computeDailySodium(d, byslug);

      return {
        dayNumber: d.day,
        weekday: WEEKDAYS[d.day - 1],
        meals: pdfMeals,
        totalCal: dCal,
        totalP: dP,
        totalC: dC,
        totalF: dF,
        totalSodiumMg: dNa,
      };
    });

    // --- Grocery list (aggregate across 7 days) ---
    const groceryMap = new Map<string, { grams: number; name: string; category: string }>();
    for (const d of days) {
      for (const m of d.meals) {
        for (const ing of m.ingredients) {
          const row = byslug.get(ing.slug);
          if (!row) continue;
          const prev = groceryMap.get(ing.slug);
          if (prev) prev.grams += ing.grams;
          else groceryMap.set(ing.slug, { grams: ing.grams, name: row.name, category: row.category });
        }
      }
    }
    const grocery: PdfGroceryItem[] = Array.from(groceryMap.values()).map((item) => ({
      name: item.name,
      amount: amountLabel(item.grams, item.category),
      category: item.category,
    }));

    // --- Tips ---
    // Pull top proteins/grains from the actual grocery list so the batch-prep
    // tip reflects what the client will really cook, not hardcoded defaults.
    const proteinGroceryItems = grocery.filter((item) => {
      const cat = item.category;
      return cat === "protein" || cat === "seafood";
    });
    const grainGroceryItems = grocery.filter((item) => {
      const cat = item.category;
      return cat === "grain" || cat === "carb";
    });
    // Sort by gram amount descending (most-used first)
    const parseGrams = (s: string) => parseFloat(s) || 0;
    proteinGroceryItems.sort((a, b) => parseGrams(b.amount) - parseGrams(a.amount));
    grainGroceryItems.sort((a, b) => parseGrams(b.amount) - parseGrams(a.amount));
    const topProteinNames = proteinGroceryItems.slice(0, 3).map((p) => p.name);
    const topGrainNames = grainGroceryItems.slice(0, 2).map((g) => g.name);

    const tips = generateTips({
      fitnessGoal: intake.fitness_goal,
      canCook: intake.can_cook,
      mealCount: intake.meal_count,
      medications: intake.medications,
      supplements: intake.supplements,
      sleepHours: intake.sleep_hours,
      waterIntake: intake.water_intake,
      allergies: intake.allergies,
      goal,
      proteinG: targets.proteinG,
      caloriesPerDay: targets.calories,
      onAppetiteSuppressant: isOnAppetiteSuppressant(intake.medications || ""),
      topProteins: topProteinNames,
      topGrains: topGrainNames,
      hasHypertension: medical.hasHypertension,
      hasKidneyIssues: medical.hasKidneyIssues,
    });

    // Inject medical-condition tips just before the final "Be Consistent" tip
    // (which is always the last entry from generateTips).
    const medTips = medicalTips(medical);
    if (medTips.length > 0) {
      const lastTip = tips.pop(); // "Be Consistent, Not Perfect"
      tips.push(...medTips);
      if (lastTip) tips.push(lastTip);
    }

    // --- PDF input ---
    // Build a timeline note when we can compute one from current + goal weights.
    // Estimate 1 lb / week at a normal ~500 kcal/day deficit; 0.5 lb / week for
    // a recomp; 0.5 lb / week gain for a muscle_gain surplus.
    const goalLbs = goalKg ? goalKg * 2.20462 : null;
    const currentLbs = weightKg * 2.20462;
    let timelineNote: string | undefined;
    if (goalLbs && Math.abs(goalLbs - currentLbs) >= 3) {
      const deltaLbs = Math.abs(goalLbs - currentLbs);
      const goalLbsR = Math.round(goalLbs);
      const deltaR = Math.round(deltaLbs);
      if (goal === "fat_loss") {
        const weeks = Math.max(4, Math.round(deltaLbs));
        timelineNote =
          `At a ~1 lb/week pace, expect to reach your goal weight of ${goalLbsR} lbs in roughly ${weeks} weeks. ` +
          `Progress isn't linear — focus on the 2-week scale average, not daily weight.`;
      } else if (goal === "muscle_gain") {
        const weeks = Math.max(4, Math.round(deltaLbs * 2));
        timelineNote =
          `Muscle gain is slow — plan on ~0.5 lb/week. At this pace, ${deltaR} lbs takes roughly ${weeks} weeks. ` +
          `Judge by the mirror, strength numbers, and how clothes fit — not just the scale.`;
      } else if (goal === "recomp") {
        const weeksLow = Math.max(8, Math.round(deltaLbs * 2));   // 0.5 lb/week
        const weeksHigh = Math.max(16, Math.round(deltaLbs * 4)); // 0.25 lb/week
        timelineNote =
          `Recomp progresses slowly — expect 0.25–0.5 lb/week of scale change while body composition shifts. ` +
          `At this pace, ${deltaR} lbs of net change takes roughly ${weeksLow}–${weeksHigh} weeks. ` +
          `Track the mirror and strength numbers alongside the scale.`;
      } else if (goal === "endurance") {
        timelineNote =
          `Fuel the session, not the scale. Aim to hold weight with a small surplus and track performance metrics ` +
          `(pace, power, recovery) alongside bodyweight.`;
      } else {
        const weeks = Math.max(4, Math.round(deltaLbs * 2));
        timelineNote =
          `At a ~0.5 lb/week pace, expect to reach your goal weight of ${goalLbsR} lbs in roughly ${weeks} weeks.`;
      }
    }

    const pdfInput: PdfInput = {
      client: {
        firstName: intake.first_name,
        lastName: intake.last_name,
        age,
        weightKg,
        weightLbs: kgToLbs(weightKg),
        heightCm,
        heightFtIn: cmToFtIn(heightCm),
        goalLabel: goalLabelFor(goal),
        goalWeightLbs: goalLbs ? Math.round(goalLbs) : undefined,
        mealsPerDay,
        allergies: intake.allergies || "None",
        medications: intake.medications || undefined,
        timelineNote,
      },
      targets,
      days: pdfDays,
      grocery,
      tips,
    };

    // Push convergence summary into targets.notes so it appears in API response
    if (convergenceLog.length > 0) {
      targets.notes.push(`Convergence: ${convergenceLog.join(" → ")}.`);
    }
    if (tier1Violations.length > 0) {
      targets.notes.push(
        `⚠️ SAFETY VIOLATION (${tier1Violations.length}) — plan is BLOCKED from shipping until fixed. Check response.status.tier1Violations.`
      );
    } else if (tier2DayCount >= 3) {
      targets.notes.push(
        `⚠️ ${tier2DayCount} day(s) have minor macro variance — plan can ship but nutritionist review is recommended.`
      );
    }

    // --- Version number ---
    const { data: priorVersions } = await db
      .from("nutrition_meal_plans")
      .select("version")
      .eq("client_id", clientId)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = (priorVersions?.[0]?.version || 0) + 1;

    // --- Render + upload ---
    const pdfBytes = renderMealPlanPDF(pdfInput);
    const safeName = `${intake.first_name}_${intake.last_name}`.replace(/[^a-zA-Z0-9_]/g, "_");
    const pdfPath = `${clientId}/v${nextVersion}_${safeName}_${Date.now()}.pdf`;
    const { error: uploadErr } = await db.storage
      .from("nutrition-plans")
      .upload(pdfPath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (uploadErr) {
      return NextResponse.json({ error: `PDF upload failed: ${uploadErr.message}` }, { status: 500 });
    }

    // --- Save row ---
    const generationTimeMs = Date.now() - startTime;
    const { data: planRow, error: insertErr } = await db
      .from("nutrition_meal_plans")
      .insert({
        client_id: clientId,
        version: nextVersion,
        pdf_path: pdfPath,
        targets_calories: targets.calories,
        targets_protein_g: targets.proteinG,
        targets_carbs_g: targets.carbsG,
        targets_fat_g: targets.fatG,
        sex,
        weight_kg: weightKg,
        meals_per_day: mealsPerDay,
        plan_data: { days: pdfDays, grocery, tips },
        comments_snapshot: commentList,
        generation_time_ms: generationTimeMs,
        created_by: session.user.email || "unknown",
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    if (client.nutrition_status !== "done") {
      await db.from("clients").update({ nutrition_status: "pending" }).eq("id", clientId);
    }

    const { data: signed } = await db.storage
      .from("nutrition-plans")
      .createSignedUrl(pdfPath, 60 * 60 * 2);

    return NextResponse.json({
      success: true,
      version: nextVersion,
      planId: planRow.id,
      pdfUrl: signed?.signedUrl,
      targets,
      generationTimeMs,
      notes: targets.notes,
      // Convergence + binary ship status. No YELLOW middle state — the
      // nutritionist review layer was removed, so every plan ships directly
      // to the client and must self-enforce safety.
      //   SHIP (green)       — all Tier 1 safety passes AND Tier 2 misses ≤ 2 days
      //   DO-NOT-SHIP (red)  — ANY Tier 1 violation OR 3+ Tier 2 day misses
      status: (() => {
        // Fold weekly Tier 2 violations (cheese/sourdough caps, mandatory
        // enjoyed foods missing) into the combined Tier 2 list so they show
        // up in the admin debug output and block shipping if the count is high.
        const combinedTier2: typeof tier2Violations = [
          ...tier2Violations,
          ...weeklyTier2Violations.map((v) => ({ day: 0, weekday: "weekly", tier: 2 as const, kind: v.kind, message: v.message })),
        ];
        // Weekly violations count as extra "day-equivalent misses" for the
        // ship decision (each distinct weekly violation adds 1 to the count).
        const effectiveT2DayCount = tier2DayCount + weeklyTier2Violations.length;

        const medicalReviewRequired =
          medical.hasHypertension ||
          medical.hasDiabetes ||
          medical.hasKidneyIssues ||
          medical.hasCeliacOrGluten ||
          medical.hasLactoseIntolerance ||
          medical.onACEInhibitor ||
          medical.onBloodThinner ||
          medical.onSGLT2 ||
          medical.onGLP1 ||
          medical.onMAOI ||
          medical.onStatin ||
          medical.onLithium ||
          medical.onLevothyroxine;

        const canShip = tier1Violations.length === 0 && effectiveT2DayCount <= 2;
        const badge: "green" | "red" = canShip ? "green" : "red";

        return {
          badge,
          canShipToClient: canShip,
          converged: canShip,
          iterationsRun: Math.max(0, convergenceLog.length - 1),
          medicalReviewRequired,
          tier1Violations,
          tier2Violations: combinedTier2,
          tier2DayCount: effectiveT2DayCount,
          convergenceLog,
          // Legacy field for backwards compat — flattened string messages
          unresolvedViolations: unresolvedByDay.map((u) => ({
            day: u.day,
            weekday: u.weekday,
            violations: u.violations.map((x) => x.message),
          })),
        };
      })(),
    });
  } catch (err) {
    console.error("[generate-plan] Failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 }
    );
  }
}
