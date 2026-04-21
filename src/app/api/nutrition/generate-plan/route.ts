/**
 * POST /api/nutrition/generate-plan
 *
 * Generates a 7-day meal plan for a client with a linked intake form.
 * Allowed regardless of nutrition_status (supports post-delivery revisions).
 *
 * Flow:
 *  1. Load client + linked intake form + prior comments + ingredients DB
 *  2. Compute macro targets (code-only, with comment overrides applied)
 *  3. Filter ingredients by allergies, rank by preferences
 *  4. Call Claude to generate structured plan (retry up to 3x on validation failure)
 *  5. Compute final macros (code), render PDF, upload to Storage
 *  6. Insert versioned row in nutrition_meal_plans
 *  7. Return plan + PDF signed URL
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
  isBlocked,
  type IngredientRow,
} from "@/lib/nutrition/ingredient-filter";
import { generateMealPlan, type ClientIntakeSummary } from "@/lib/nutrition/plan-generator";
import {
  validatePlan,
  buildGroceryList,
  type DayPlan,
} from "@/lib/nutrition/macro-validator";
import { renderMealPlanPDF } from "@/lib/nutrition/pdf-renderer";
import { generateTips } from "@/lib/nutrition/tips-generator";

export const maxDuration = 60; // allow up to 60s

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
    // --- 1. Load client + intake form ---
    const { data: client, error: clientErr } = await db
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();
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
      .from("nutrition_intake_forms")
      .select("*")
      .eq("id", client.nutrition_form_id)
      .single();
    if (intakeErr || !intake) {
      return NextResponse.json({ error: "Intake form not found" }, { status: 404 });
    }

    // --- 2. Load comments ---
    const { data: comments } = await db
      .from("nutrition_task_comments")
      .select("comment, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    const commentList = (comments || []).map((c) => ({
      comment: c.comment,
      createdAt: c.created_at,
    }));

    // --- 3. Compute targets (code-only) ---
    const directives = mergeCommentDirectives(commentList);

    const weightKg =
      directives.weightKgOverride ??
      parseWeightToKg(intake.current_weight) ??
      80; // sensible default

    const heightCm = parseHeightToCm(intake.height) ?? 175;
    const age = intake.age || 30;
    const sex = directives.sexOverride ?? "male";
    const goal = parseGoalFromText(intake.fitness_goal);
    const mealsPerDay = parseMealCount(intake.meal_count);

    const targets = calculateMacros(
      { sex, weightKg, heightCm, age, goal },
      directives.macroOverrides
    );

    // --- 4. Load ingredients, filter by allergies, rank by preferences ---
    const { data: ingredients } = await db
      .from("ingredients")
      .select(
        "id, slug, name, aliases, category, calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g"
      );
    if (!ingredients || ingredients.length === 0) {
      return NextResponse.json({ error: "Ingredient database empty" }, { status: 500 });
    }

    const blocked = parseBlockedFoods(intake.allergies, intake.foods_avoid);
    const preferred = parsePreferredFoods(intake.foods_enjoy, intake.protein_preferences);

    const rankedIngredients = filterAndRankIngredients(
      ingredients as IngredientRow[],
      blocked,
      preferred
    );

    const blockedSlugs = new Set<string>(
      (ingredients as IngredientRow[])
        .filter((i) => isBlocked(i, blocked))
        .map((i) => i.slug)
    );

    const byslug = new Map<string, IngredientRow>();
    for (const i of ingredients as IngredientRow[]) byslug.set(i.slug, i);

    // --- 5. Generate with Claude (up to 3 retries) ---
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

    let plan: { days: DayPlan[] } | null = null;
    let validationErrors: string[] | undefined;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const { days } = await generateMealPlan(
        {
          intake: intakeSummary,
          targets,
          mealsPerDay,
          allowedIngredients: rankedIngredients.slice(0, 120), // send top-ranked subset to stay within context
          priorComments: commentList.map((c) => c.comment),
          attempt,
          validationErrors,
        },
        apiKey
      );

      const validation = validatePlan(days, byslug, targets, blockedSlugs);
      if (validation.ok) {
        plan = { days };
        break;
      }
      validationErrors = validation.errors;
      console.warn(`[generate-plan] Attempt ${attempt} failed validation:`, validation.errors);
    }

    if (!plan) {
      return NextResponse.json(
        {
          error: "Could not generate a valid plan after 3 attempts",
          validationErrors,
        },
        { status: 502 }
      );
    }

    // --- 6. Final macros + grocery list + tips ---
    const dayMacros = plan.days.map((d) => {
      let calories = 0, proteinG = 0, carbsG = 0, fatG = 0;
      for (const meal of d.meals) {
        for (const ing of meal.ingredients) {
          const row = byslug.get(ing.slug);
          if (!row) continue;
          const f = ing.grams / 100;
          calories += Number(row.calories_per_100g) * f;
          proteinG += Number(row.protein_g_per_100g) * f;
          carbsG += Number(row.carbs_g_per_100g) * f;
          fatG += Number(row.fat_g_per_100g) * f;
        }
      }
      return {
        calories: Math.round(calories),
        proteinG: Math.round(proteinG * 10) / 10,
        carbsG: Math.round(carbsG * 10) / 10,
        fatG: Math.round(fatG * 10) / 10,
      };
    });

    const grocery = buildGroceryList(plan.days, byslug);

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

    // --- 7. Version number ---
    const { data: priorVersions } = await db
      .from("nutrition_meal_plans")
      .select("version")
      .eq("client_id", clientId)
      .order("version", { ascending: false })
      .limit(1);
    const nextVersion = (priorVersions?.[0]?.version || 0) + 1;

    // --- 8. Render PDF ---
    const pdfBytes = renderMealPlanPDF({
      clientFirstName: intake.first_name,
      clientLastName: intake.last_name,
      goal: intake.fitness_goal,
      targets,
      days: plan.days,
      dayMacros,
      grocery,
      tips,
      byslug,
      version: nextVersion,
    });

    // --- 9. Upload to storage ---
    const safeName = `${intake.first_name}_${intake.last_name}`.replace(/[^a-zA-Z0-9_]/g, "_");
    const pdfPath = `${clientId}/v${nextVersion}_${safeName}_${Date.now()}.pdf`;
    const { error: uploadErr } = await db.storage
      .from("nutrition-plans")
      .upload(pdfPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadErr) {
      console.error("[generate-plan] PDF upload failed:", uploadErr);
      return NextResponse.json({ error: `PDF upload failed: ${uploadErr.message}` }, { status: 500 });
    }

    // --- 10. Save row ---
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
        plan_data: { days: plan.days, dayMacros, grocery, tips },
        comments_snapshot: commentList,
        generation_time_ms: generationTimeMs,
        created_by: session.user.email || "unknown",
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    // --- 11. Update client to pending if currently in pending/unlinked (don't touch done) ---
    if (client.nutrition_status !== "done") {
      await db
        .from("clients")
        .update({ nutrition_status: "pending" })
        .eq("id", clientId);
    }

    // --- 12. Signed URL for preview/download ---
    const { data: signed } = await db.storage
      .from("nutrition-plans")
      .createSignedUrl(pdfPath, 60 * 60 * 2); // 2 hours

    return NextResponse.json({
      success: true,
      version: nextVersion,
      planId: planRow.id,
      pdfUrl: signed?.signedUrl,
      targets,
      dayMacros,
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
