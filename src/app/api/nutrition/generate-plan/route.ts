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
} from "@/lib/nutrition/parsers";
import {
  filterAndRankIngredients,
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

function goalLabel(goal: "fat_loss" | "muscle_gain" | "maintain"): string {
  if (goal === "fat_loss") return "Fat Loss";
  if (goal === "muscle_gain") return "Muscle Gain";
  return "Maintenance";
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
    // Send the top 80 ranked ingredients to Claude for this client (still gives plenty of variety)
    const allowed = rankedIngredients.slice(0, 80);
    const priorCommentTexts = commentList.map((c) => c.comment);

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
        variationHint:
          i < 2
            ? undefined
            : `Use different proteins and carbs than the previous days to keep the week varied.`,
      });
    }

    // --- Fire all 7 Claude calls in parallel ---
    const days = await generateAllDays(dayInputs, apiKey);

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
