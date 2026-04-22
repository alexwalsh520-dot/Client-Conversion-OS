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
  medicalHardSwaps,
  medicalIngredientCaps,
  medicalSoftAvoidTokens,
  medicalTips,
} from "@/lib/nutrition/medical";

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

function goalLabel(goal: "fat_loss" | "muscle_gain" | "maintain" | "recomp"): string {
  if (goal === "fat_loss") return "Fat Loss";
  if (goal === "muscle_gain") return "Muscle Gain";
  if (goal === "recomp") return "Body Recomposition";
  return "Maintenance";
}

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
    const targets = calculateMacros({ sex, weightKg, heightCm, age, goal }, directives.macroOverrides);
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
    const blocked = parseBlockedFoods(intake.allergies, intake.foods_avoid);
    const preferred = parsePreferredFoods(intake.foods_enjoy, intake.protein_preferences);

    // Medical flags → soft-avoid tokens feed into the ranker (deprioritize, not exclude)
    const medical = detectMedicalFlags(intake.allergies || "", intake.medications || "");
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
      });
    }

    // --- Fire all 7 Claude calls in parallel ---
    let days = await generateAllDays(dayInputs, apiKey);

    // ---------- MACRO VALIDATION + SELECTIVE SINGLE RETRY ----------
    // Recompute day totals from DB macros; any day significantly out of spec
    // (>10% over calories OR >15% over/under fat OR >10% under protein) gets
    // one corrective retry in parallel — only if we still have time budget.
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

    // Symmetric validation — retry if ANY macro is outside ±10% in either direction.
    // Also retries on per-meal fat violations (>40% of daily fat in one meal).
    const outOfSpec: { idx: number; errMsg: string }[] = [];
    days.forEach((d, idx) => {
      const t = computeTotals(d);
      const calPct = (t.cal - targets.calories) / targets.calories;
      const pPct   = (t.p   - targets.proteinG) / targets.proteinG;
      const cPct   = (t.c   - targets.carbsG)   / targets.carbsG;
      const fPct   = (t.f   - targets.fatG)     / targets.fatG;

      const calBad   = Math.abs(calPct) > 0.08;  // tightened: retry if >8% off
      const protBad  = Math.abs(pPct)   > 0.10;
      const carbBad  = Math.abs(cPct)   > 0.12;  // new: retry if carbs are off
      const fatBad   = Math.abs(fPct)   > 0.12;  // tightened from 15% to 12%

      // Check if any single meal exceeds 40% of daily fat target
      let worstMealFat = 0;
      let worstMealName = "";
      for (const meal of d.meals) {
        let mFat = 0;
        for (const ing of meal.ingredients) {
          const row = byslug.get(ing.slug);
          if (!row) continue;
          mFat += Number(row.fat_g_per_100g) * (ing.grams / 100);
        }
        if (mFat > worstMealFat) {
          worstMealFat = mFat;
          worstMealName = meal.dishName || meal.name;
        }
      }
      const mealFatBad = worstMealFat > targets.fatG * 0.40;

      if (calBad || protBad || carbBad || fatBad || mealFatBad) {
        const pieces: string[] = [];
        pieces.push(`Your prior attempt hit: ${Math.round(t.cal)} kcal, ${t.p.toFixed(0)}g protein, ${t.c.toFixed(0)}g carbs, ${t.f.toFixed(0)}g fat.`);
        pieces.push(`Targets: ${targets.calories} kcal, ${targets.proteinG}g protein, ${targets.carbsG}g carbs, ${targets.fatG}g fat.`);
        if (calBad && calPct > 0)  pieces.push(`CALORIES are ${Math.round(calPct * 100)}% OVER — reduce added fats (butter, oil, cheese, nuts) and starch portions.`);
        if (calBad && calPct < 0)  pieces.push(`CALORIES are ${Math.round(-calPct * 100)}% UNDER — increase protein and carb portions; add 10-15g oil if fat is low.`);
        if (fatBad && fPct > 0)    pieces.push(`FAT is ${Math.round(fPct * 100)}% OVER — cut butter/oil/cheese/nut portions in half.`);
        if (fatBad && fPct < 0)    pieces.push(`FAT is ${Math.round(-fPct * 100)}% UNDER — add 5-10g oil, avocado, or a small cheese portion.`);
        if (protBad && pPct > 0)   pieces.push(`PROTEIN is ${Math.round(pPct * 100)}% OVER — reduce protein portions by 10-15g each and move the calories into carbs (rice, potato, oats, bread). Protein and carbs both cost 4 kcal/g, so swap them 1:1.`);
        if (protBad && pPct < 0)   pieces.push(`PROTEIN is ${Math.round(-pPct * 100)}% UNDER — bump the main protein's grams (aim for 30-40g protein per main meal).`);
        if (carbBad && cPct > 0)   pieces.push(`CARBS are ${Math.round(cPct * 100)}% OVER — trim starch portions (rice, bread, pasta) by 20-30%.`);
        if (carbBad && cPct < 0)   pieces.push(`CARBS are ${Math.round(-cPct * 100)}% UNDER — increase rice/potato/oats/bread portions by 30-50g. Don't add more protein to fill the calorie gap — swap into carbs.`);
        if (mealFatBad)            pieces.push(`"${worstMealName}" has ${Math.round(worstMealFat)}g fat — that's more than 40% of the daily target. Spread fats across meals; no single meal should exceed ${Math.round(targets.fatG * 0.4)}g fat.`);
        outOfSpec.push({ idx, errMsg: pieces.join(" ") });
      }
    });

    // Only retry if time budget allows (stay under 45s total so PDF render + upload fits)
    const elapsedSoFar = Date.now() - startTime;
    if (outOfSpec.length > 0 && elapsedSoFar < 35_000) {
      console.log(`[generate-plan] Retrying ${outOfSpec.length} out-of-spec day(s)`);
      const retryInputs = outOfSpec.map(({ idx, errMsg }) => ({
        ...dayInputs[idx],
        priorAttemptError: errMsg,
      }));
      const retryDays = await generateAllDays(retryInputs, apiKey);
      // Merge retry results back into days array — score compares ALL four macros
      // (not just calories+fat, so protein/carb corrections aren't rejected).
      // Each macro contributes its own kcal-equivalent distance from target.
      const scoreDay = (t: { cal: number; p: number; c: number; f: number }) =>
        Math.abs(t.cal - targets.calories) +
        Math.abs(t.p - targets.proteinG) * 4 +
        Math.abs(t.c - targets.carbsG) * 4 +
        Math.abs(t.f - targets.fatG) * 9;

      retryDays.forEach((rd) => {
        const idx = rd.day - 1;
        const before = computeTotals(days[idx]);
        const after  = computeTotals(rd);
        if (scoreDay(after) < scoreDay(before)) {
          days[idx] = rd;
        }
      });
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

    // ---------- ENJOYED-FOODS COVERAGE CHECK ----------
    // Source 1: the foods_enjoy list.
    // Source 2: items mentioned in the client's daily_meals_description —
    // stuff they already eat regularly and would expect to see on the plan.
    const enjoyedTokens = [
      ...parsePreferredFoods(intake.foods_enjoy, ""),
      ...extractFoodsFromDailyMealsDescription(intake.daily_meals_description || ""),
    ].filter((t) => t && t.length >= 3);
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
    for (const token of enjoyedTokens) {
      if (!haystack.includes(token.toLowerCase())) {
        missingEnjoyed.push(token);
      }
    }
    if (missingEnjoyed.length > 0) {
      targets.notes.push(
        `Note for reviewer: couldn't slot these enjoyed foods into the plan (likely composite dishes or not in ingredient DB): ${missingEnjoyed.join(", ")}.`
      );
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

      return {
        dayNumber: d.day,
        weekday: WEEKDAYS[d.day - 1],
        meals: pdfMeals,
        totalCal: dCal,
        totalP: dP,
        totalC: dC,
        totalF: dF,
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
      const perWeek = goal === "fat_loss" ? 1 : goal === "muscle_gain" ? 0.5 : 0.5;
      const weeks = Math.max(4, Math.round(deltaLbs / perWeek));
      const direction = goalLbs < currentLbs ? "reach" : "reach";
      timelineNote =
        `At this deficit/surplus, expect to ${direction} your goal weight of ${Math.round(goalLbs)} lbs in roughly ${weeks} weeks. ` +
        `Progress isn't linear — focus on the 2-week scale average, not daily weight.`;
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
        goalLabel: goalLabel(goal),
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
    });
  } catch (err) {
    console.error("[generate-plan] Failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 }
    );
  }
}
