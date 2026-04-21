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
    const heightCm = parseHeightToCm(intake.height) ?? 175;
    const age = intake.age || 30;
    const sex = directives.sexOverride ?? "male";
    const goal = parseGoalFromText(intake.fitness_goal);
    const mealsPerDay = parseMealCount(intake.meal_count);
    const targets = calculateMacros({ sex, weightKg, heightCm, age, goal }, directives.macroOverrides);

    // --- Ingredients ---
    const { data: ingredients } = await db
      .from("ingredients")
      .select("id, slug, name, aliases, category, calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g");
    if (!ingredients || ingredients.length === 0) {
      return NextResponse.json({ error: "Ingredient database empty" }, { status: 500 });
    }
    const blocked = parseBlockedFoods(intake.allergies, intake.foods_avoid);
    const preferred = parsePreferredFoods(intake.foods_enjoy, intake.protein_preferences);
    const rankedIngredients = filterAndRankIngredients(ingredients as IngredientRow[], blocked, preferred);

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
    const allowed = pickDiverseAllowed(rankedIngredients, {
      size: 100,
      extraRequiredSlugs: spicyRequired,
    });

    // Rotate which proteins to "avoid" per day so the top preferences still get used
    // across the week without being every day.
    const rotateAvoid = (dayIdx: number): string[] => {
      if (preferredProteins.length === 0) return [];
      // Days 3-7: ask Claude to avoid proteins it likely used on prior days
      if (dayIdx < 2) return [];
      // Rotate through the list so each day avoids 1-2 proteins
      const cycle = preferredProteins;
      const avoidIdx = dayIdx % cycle.length;
      return [cycle[avoidIdx]];
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
      const pPct = (t.p - targets.proteinG) / targets.proteinG;
      const fPct = (t.f - targets.fatG) / targets.fatG;

      const calBad  = Math.abs(calPct) > 0.10;
      const protBad = Math.abs(pPct)   > 0.10;
      const fatBad  = Math.abs(fPct)   > 0.15;

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

      if (calBad || protBad || fatBad || mealFatBad) {
        const pieces: string[] = [];
        pieces.push(`Your prior attempt hit: ${Math.round(t.cal)} kcal, ${t.p.toFixed(0)}g protein, ${t.c.toFixed(0)}g carbs, ${t.f.toFixed(0)}g fat.`);
        pieces.push(`Targets: ${targets.calories} kcal, ${targets.proteinG}g protein, ${targets.carbsG}g carbs, ${targets.fatG}g fat.`);
        if (calBad && calPct > 0)  pieces.push(`CALORIES are ${Math.round(calPct * 100)}% OVER — reduce added fats (butter, oil, cheese, nuts) and starch portions.`);
        if (calBad && calPct < 0)  pieces.push(`CALORIES are ${Math.round(-calPct * 100)}% UNDER — increase protein and carb portions; add 10-15g oil if fat is low.`);
        if (fatBad && fPct > 0)    pieces.push(`FAT is ${Math.round(fPct * 100)}% OVER — cut butter/oil/cheese/nut portions in half.`);
        if (fatBad && fPct < 0)    pieces.push(`FAT is ${Math.round(-fPct * 100)}% UNDER — add 5-10g oil, avocado, or a small cheese portion.`);
        if (protBad && pPct > 0)   pieces.push(`PROTEIN is ${Math.round(pPct * 100)}% OVER — reduce protein portion sizes slightly.`);
        if (protBad && pPct < 0)   pieces.push(`PROTEIN is ${Math.round(-pPct * 100)}% UNDER — bump the main protein's grams (aim for 30-40g protein per main meal).`);
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
      // Merge retry results back into days array (only if the retry actually improved things)
      retryDays.forEach((rd) => {
        const idx = rd.day - 1;
        const before = computeTotals(days[idx]);
        const after  = computeTotals(rd);
        const scoreBefore = Math.abs(before.cal - targets.calories) + Math.abs(before.f - targets.fatG) * 9;
        const scoreAfter  = Math.abs(after.cal - targets.calories)  + Math.abs(after.f - targets.fatG)  * 9;
        if (scoreAfter < scoreBefore) {
          days[idx] = rd;
        }
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

    // --- PDF input ---
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
        mealsPerDay,
        allergies: intake.allergies || "None",
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
