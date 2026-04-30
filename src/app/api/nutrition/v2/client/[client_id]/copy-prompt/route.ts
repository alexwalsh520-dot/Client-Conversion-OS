/**
 * Phase B6c — GET /api/nutrition/v2/client/:client_id/copy-prompt
 *
 * Assembles the prompt the coach pastes into Claude.ai to get a meal
 * plan. Format: directive + intake fields + computed macro targets,
 * ~1500 chars total.
 *
 * Centralized server-side so future tweaks to the prompt content don't
 * require a frontend redeploy.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  calculateMacros,
  parseActivityLevel,
  parseHeightToCm,
  parseWeightToKg,
} from "@/lib/nutrition/macro-calculator";
import { detectMedicalFlags } from "@/lib/nutrition/medical";
import {
  parseGoalFromText,
  reconcileGoalWithWeights,
  parseMealCount,
} from "@/lib/nutrition/parsers";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { client_id: rawId } = await ctx.params;
  const clientId = parseInt(rawId, 10);
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  const db = getServiceSupabase();

  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name, nutrition_form_id")
    .eq("id", clientId)
    .single();
  if (clientErr || !client) {
    return NextResponse.json({ error: "client not found" }, { status: 404 });
  }
  const c = client as { id: number; name: string | null; nutrition_form_id: number | null };
  if (!c.nutrition_form_id) {
    return NextResponse.json(
      { error: "client has no linked intake form" },
      { status: 400 },
    );
  }

  const { data: intake, error: intakeErr } = await db
    .from("nutrition_intake_forms")
    .select("*")
    .eq("id", c.nutrition_form_id)
    .single();
  if (intakeErr || !intake) {
    return NextResponse.json({ error: "intake form not found" }, { status: 404 });
  }
  const i = intake as Record<string, string | number | null>;

  // ---- Compute macro targets from intake (mirrors v1 generate-plan parsing) ----
  const weightKg = parseWeightToKg(String(i.current_weight ?? "")) ?? 80;
  const goalKg = parseWeightToKg(String(i.goal_weight ?? ""));
  const heightCm = parseHeightToCm(String(i.height ?? "")) ?? 175;
  const age = typeof i.age === "number" ? i.age : 30;
  const sex = "male" as const; // intake form has no sex field; v1 default
  const textGoal = parseGoalFromText(String(i.fitness_goal ?? ""));
  const reconciled = reconcileGoalWithWeights(textGoal, weightKg, goalKg);
  const goal = reconciled.goal;
  const activity = parseActivityLevel(
    String(i.activity_level ?? i.fitness_goal ?? ""),
  );
  const medical = detectMedicalFlags(
    String(i.allergies ?? ""),
    String(i.medications ?? ""),
  );
  const targets = calculateMacros({
    sex,
    weightKg,
    heightCm,
    age,
    goal,
    activityLevel: activity,
    medical: {
      hasHypertension: medical.hasHypertension,
      hasDiabetes: medical.hasDiabetes,
      hasKidneyIssues: medical.hasKidneyIssues,
      onStimulant: medical.onStimulantADHD,
    },
  });

  const mealCountRaw = String(i.meal_count ?? "").trim();
  const mealCount = parseMealCount(mealCountRaw);

  // ---- Assemble prompt ----
  const lines: string[] = [];
  lines.push("# Meal plan request");
  lines.push("");
  lines.push(
    "Build a 7-day meal plan for the client below. Honor the foods-to-avoid list and the meal-count preference. Use realistic portions in grams. For each day, list every meal with its ingredients (slug + grams) and a daily macro total. Respect any allergies and medical conditions noted.",
  );
  lines.push("");
  lines.push("## Client");
  if (i.first_name || i.last_name)
    lines.push(`- Name: ${[i.first_name, i.last_name].filter(Boolean).join(" ")}`);
  if (age) lines.push(`- Age: ${age}`);
  lines.push(`- Sex: ${sex}`);
  if (i.height) lines.push(`- Height: ${i.height}`);
  if (i.current_weight) lines.push(`- Current weight: ${i.current_weight}`);
  if (i.goal_weight) lines.push(`- Goal weight: ${i.goal_weight}`);
  if (i.fitness_goal) lines.push(`- Fitness goal: ${i.fitness_goal}`);
  if (i.activity_level) lines.push(`- Activity level: ${i.activity_level}`);
  if (i.foods_enjoy) lines.push(`- Foods enjoyed: ${i.foods_enjoy}`);
  if (i.foods_avoid) lines.push(`- Foods to AVOID (do not include any of these): ${i.foods_avoid}`);
  if (i.allergies) lines.push(`- Allergies / medical conditions: ${i.allergies}`);
  if (i.medications) lines.push(`- Medications: ${i.medications}`);
  if (i.supplements) lines.push(`- Supplements: ${i.supplements}`);
  // Medical supervision flag — added 2026-04-30. When the client is
  // already under a healthcare provider's prescribed diet, surface the
  // detail prominently so Claude.ai (and the coach reviewing the plan)
  // knows to either coordinate with the provider's restrictions or flag
  // for referral. Critical safety info — do not omit.
  if (i.medical_supervision_yn) {
    const yn = String(i.medical_supervision_yn).trim();
    if (yn.toLowerCase() === "yes") {
      lines.push(
        `- ⚠ Under medical supervision: YES — client is on a prescribed diet from a healthcare provider`,
      );
      if (i.medical_supervision_detail) {
        lines.push(
          `- Provider-prescribed diet detail: ${i.medical_supervision_detail}`,
        );
      } else {
        lines.push(
          `- (Client did not provide detail — coach should follow up before delivery.)`,
        );
      }
    } else {
      lines.push(`- Under medical supervision: ${yn || "no"}`);
    }
  }
  if (i.protein_preferences) lines.push(`- Protein preferences: ${i.protein_preferences}`);
  if (mealCountRaw) {
    const mealNote = mealCount
      ? ` (parsed as ${mealCount} meals/day — split the day's macros across this many meals)`
      : "";
    lines.push(`- Preferred meal count: ${mealCountRaw}${mealNote}`);
  }
  if (i.can_cook) lines.push(`- Cooking ability: ${i.can_cook}`);
  if (i.daily_meals_description) lines.push(`- Typical daily meals: ${i.daily_meals_description}`);
  if (i.daily_meals_description_2) lines.push(`- Daily meals (cont.): ${i.daily_meals_description_2}`);
  if (i.water_intake) lines.push(`- Water intake: ${i.water_intake}`);
  if (i.sleep_hours) lines.push(`- Sleep hours: ${i.sleep_hours}`);
  lines.push("");

  lines.push("## Daily macro targets (computed)");
  lines.push(`- kcal: ${targets.calories}`);
  lines.push(`- Protein: ${targets.proteinG} g`);
  lines.push(`- Carbs: ${targets.carbsG} g`);
  lines.push(`- Fat: ${targets.fatG} g`);
  lines.push(`- Sodium cap: ${targets.sodiumCapMg} mg/day`);
  if (targets.notes && targets.notes.length > 0) {
    lines.push(`- Notes: ${targets.notes.join("; ")}`);
  }
  lines.push("");

  lines.push("## Output format");
  lines.push(
    "Return the plan as a polished, printable document with a clear daily breakdown. Each day should have all meals laid out with ingredients in grams, per-meal macros, and a daily total. The coach will deliver it to the client as a PDF.",
  );

  const prompt = lines.join("\n");

  return NextResponse.json({
    client_id: clientId,
    client_name: c.name,
    prompt,
    targets: {
      calories: targets.calories,
      proteinG: targets.proteinG,
      carbsG: targets.carbsG,
      fatG: targets.fatG,
      sodiumCapMg: targets.sodiumCapMg,
    },
    meta: {
      character_count: prompt.length,
      meal_count_parsed: mealCount,
    },
  });
}
