#!/usr/bin/env node
/**
 * End-to-end smoke for the B6b Coach UI surface.
 *
 *  1. Derive JobRequestInputs from client 35596's intake (verifies the
 *     POST /api/nutrition/v2/generate path).
 *  2. Read Michael's latest plan (74) — gives us a real plan_data
 *     payload we can reshape as a simulated Claude.ai correction.
 *  3. Reshape plan_data into the CORRECTION_SCHEMA format and call the
 *     apply-correction route's HTTP-less core path (parser → wrap →
 *     audit → render → persist) by importing the modules directly.
 *  4. Assert: new plan row exists, version bumped, template_id =
 *     "coach_corrected", parent_plan_id = 74.
 *
 * No dev server required for this part. The HTTP shell of the endpoints
 * is exercised in a follow-up step (curl).
 */

import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { createClient } from "@supabase/supabase-js";
import { deriveJobInputsFromIntake } from "../src/lib/nutrition/v2/pipeline/derive-job-inputs";
import {
  parseSubmitPlanResponse,
  wrapAsWeekPlanSuccess,
} from "../src/lib/nutrition/v2/llm-meal-generator";
import { auditWeekPlan, type ClientProfile } from "../src/lib/nutrition/v2/audit";
import { verifyMacros } from "../src/lib/nutrition/v2/macro-verifier";
import { ALL_BUILDS } from "../src/lib/nutrition/v2/builds";
import { ALL_DISTRIBUTIONS } from "../src/lib/nutrition/v2/distributions";
import { ALL_ALLERGY_RULES } from "../src/lib/nutrition/v2/allergies";
import { ALL_MEDICAL_RULES } from "../src/lib/nutrition/v2/medical";
import { ALL_DIETARY_RULES } from "../src/lib/nutrition/v2/dietary";
import { getIngredientNutrition } from "../src/lib/nutrition/v2/solver";
import { getGramBounds } from "../src/lib/nutrition/v2/solver/category-bounds";
import { calculateMacrosForBuild } from "../src/lib/nutrition/v2/macro-calculator-v2";
import { loadIntake } from "../src/lib/nutrition/v2/pipeline/intake-loader";
import { persistPlanRow } from "../src/lib/nutrition/v2/pipeline/run-pipeline";
import {
  detectComplexity,
  generateCoachHandoffPrompt,
  type CoachProfileInput,
} from "../src/lib/nutrition/v2/coach-handoff";

const CLIENT_ID = 35596;
const ORIGINAL_PLAN_ID = 74;

const failures: string[] = [];
function ok(cond: boolean, label: string, detail?: string): void {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(
    "=".repeat(72) +
      "\nB6b coach-UI smoke — Michael Rogers (35596)\n" +
      "=".repeat(72),
  );

  // ===== Phase 1: derive inputs ============================================
  console.log("\n[1/3] Deriving JobRequestInputs from intake form…");
  const inputs = await deriveJobInputsFromIntake({
    db: db as any,
    client_id: CLIENT_ID,
  });
  console.log(
    `   build_type=${inputs.build_type} dietary=${inputs.dietary_style} allergies=[${inputs.allergy_flags.join(",") || "none"}] medical=[${inputs.medical_flags.join(",") || "none"}] activity=${inputs.activity_level}`,
  );
  // Build type is derived from intake free-text. Either "shred" (intake
  // says fat-loss) or "lean_gain" (intake says muscle-gain) is valid for
  // Michael. Just assert it's a known v2 BuildType, not a specific one.
  const validBuilds = ["recomp", "shred", "bulk", "lean_gain", "endurance", "maintain"];
  ok(
    validBuilds.includes(inputs.build_type),
    `build_type is a valid v2 BuildType (got ${inputs.build_type})`,
  );
  ok(
    Array.isArray(inputs.allergy_flags),
    "allergy_flags is array",
    JSON.stringify(inputs.allergy_flags),
  );
  ok(
    Array.isArray(inputs.medical_flags),
    "medical_flags is array",
    JSON.stringify(inputs.medical_flags),
  );

  // ===== Phase 2: pull plan 74 plan_data ===================================
  console.log("\n[2/3] Pulling plan 74's plan_data for correction simulation…");
  const { data: planRow, error: planErr } = await db
    .from("nutrition_meal_plans")
    .select("*")
    .eq("id", ORIGINAL_PLAN_ID)
    .single();
  if (planErr || !planRow) {
    console.error(`✗ couldn't load plan ${ORIGINAL_PLAN_ID}`);
    process.exit(1);
  }
  const orig = planRow as Record<string, any>;
  ok(orig.coach_review_recommended === true, "plan 74 was coach_review_recommended");
  console.log(`   complexity_reasons: ${JSON.stringify(orig.complexity_reasons)}`);

  // ===== Phase 3: simulate correction ======================================
  console.log("\n[3/3] Simulating coach-paste correction (reuse plan 74 days, mark as corrected)…");

  // Convert plan 74's persisted slots (slug + grams) into the
  // CORRECTION_SCHEMA shape that Claude.ai would return.
  const persistedDays = (orig.plan_data as { days: Array<{ day: number; day_kind: string; slots: Array<{ index: number; ingredients: Array<{ slug: string; grams: number }> }> }> }).days;
  const weekdays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  const correctedPlan = {
    days: persistedDays.map((d, i) => ({
      day_number: i + 1,
      weekday: weekdays[i],
      meals: d.slots.map((slot, sIdx) => ({
        slot: slot.index,
        name:
          slot.index === 1
            ? "Breakfast"
            : slot.index === 2
              ? "Lunch"
              : slot.index === 3
                ? "Snack"
                : slot.index === 4
                  ? "Dinner"
                  : `Meal ${slot.index}`,
        dish_name: `Corrected Day ${i + 1} Meal ${slot.index}`,
        ingredients: slot.ingredients.map((ing, ingIdx) => ({
          slug: ing.slug,
          grams: Math.round(ing.grams),
          // First ingredient marked anchor (mimic Claude.ai's choice)
          is_anchor: ingIdx === 0,
        })),
      })),
    })),
  };

  // Run the same logic apply-correction's route handler runs (HTTP-less).
  const resolved = await loadIntake({
    db: db as any,
    client_id: CLIENT_ID,
    build_type: inputs.build_type,
    allergy_flags: inputs.allergy_flags,
    medical_flags: inputs.medical_flags,
    dietary_style: inputs.dietary_style,
    on_stimulant: inputs.on_stimulant ?? false,
  });
  const targets = calculateMacrosForBuild({
    sex: resolved.macro_inputs.sex,
    weightKg: resolved.macro_inputs.weight_kg,
    heightCm: resolved.macro_inputs.height_cm,
    age: resolved.macro_inputs.age,
    buildType: inputs.build_type,
    activityLevel: inputs.activity_level,
    medicalFlags: inputs.medical_flags,
    onStimulant: inputs.on_stimulant ?? false,
  });
  const buildSpec = ALL_BUILDS[inputs.build_type];
  const distribution = ALL_DISTRIBUTIONS[inputs.distribution_template];

  const hardExclude = new Set<string>();
  for (const f of inputs.allergy_flags) {
    const r = ALL_ALLERGY_RULES[f];
    if (r) for (const slug of r.hard_exclude) hardExclude.add(slug);
  }
  for (const f of inputs.medical_flags) {
    const r = ALL_MEDICAL_RULES[f];
    if (r) for (const slug of r.hard_exclude) hardExclude.add(slug);
  }
  if (inputs.dietary_style) {
    const r = ALL_DIETARY_RULES[inputs.dietary_style];
    if (r) for (const slug of r.hard_exclude) hardExclude.add(slug);
  }

  const { data: ingRows } = await db.from("ingredients").select("slug");
  const allSlugs = new Set(((ingRows ?? []) as Array<{ slug: string }>).map((r) => r.slug));

  const candidateSlugs = new Set<string>();
  for (const day of correctedPlan.days)
    for (const meal of day.meals)
      for (const ing of meal.ingredients) candidateSlugs.add(ing.slug);
  const nutritionMap = await getIngredientNutrition(
    Array.from(candidateSlugs).filter((s) => allSlugs.has(s)),
  );
  const gramBounds = new Map<string, { min: number; max: number }>();
  for (const [slug, nut] of nutritionMap) {
    gramBounds.set(slug, getGramBounds(slug, nut.category));
  }

  const parseResult = parseSubmitPlanResponse(correctedPlan, {
    approved_slugs: allSlugs,
    gram_bounds: gramBounds,
    hard_exclude: hardExclude,
  });
  ok(parseResult.fatal === null, "parser accepts simulated correction");
  ok(parseResult.dropped_slugs.length === 0, "no dropped slugs in simulated correction");

  if (!parseResult.plan) {
    console.error("✗ parser produced no plan");
    process.exit(1);
  }

  const survivingSlugs = new Set<string>();
  for (const d of parseResult.plan.days)
    for (const m of d.meals) for (const ing of m.ingredients) survivingSlugs.add(ing.slug);
  const fullNutritionMap = await getIngredientNutrition(Array.from(survivingSlugs));

  const weekPlan = wrapAsWeekPlanSuccess({
    rawDays: parseResult.plan.days,
    targets,
    distribution,
    rest_distribution: distribution,
    nutrition_map: fullNutritionMap,
  });

  const auditProfile: ClientProfile = {
    buildType: inputs.build_type,
    buildSpec,
    allergyFlags: inputs.allergy_flags,
    medicalFlags: inputs.medical_flags,
    dietaryStyle: inputs.dietary_style,
    sodiumCapMg: 2300,
    distributionTemplate: inputs.distribution_template,
  };
  const audit = await auditWeekPlan(weekPlan, auditProfile);
  ok(
    audit.action !== "BLOCK_GENERATION_RETURN_TO_COACH",
    "audit doesn't block the corrected plan",
  );

  const verifyResult = await verifyMacros({ plan: weekPlan, targets });
  console.log(
    `   verifier: pass=${verifyResult.pass} failed_days=${verifyResult.failed_days}/7`,
  );

  const coachProfile: CoachProfileInput = {
    first_name: resolved.intake_snapshot.first_name,
    sex: resolved.macro_inputs.sex,
    weight_kg: resolved.macro_inputs.weight_kg,
    height_cm: resolved.macro_inputs.height_cm,
    age: resolved.macro_inputs.age,
    build_type: inputs.build_type,
    dietary_style: inputs.dietary_style,
    allergy_flags: inputs.allergy_flags,
    medical_flags: inputs.medical_flags,
  };
  const complexity = detectComplexity({
    planResult: weekPlan,
    audit,
    targets,
    verifierRetryCount: 0,
    nutritionMap: fullNutritionMap,
    sodiumCeilingMg: 2300 * 1.15,
  });
  const coachHandoffPrompt = await generateCoachHandoffPrompt({
    profile: coachProfile,
    targets,
    distribution,
    buildSpec,
    hardExclude,
    planResult: weekPlan,
    audit,
    verifyResult,
    complexity,
    nutritionMap: fullNutritionMap,
  });

  // Compute next version + persist
  const { data: priorVersions } = await db
    .from("nutrition_meal_plans")
    .select("version")
    .eq("client_id", CLIENT_ID)
    .order("version", { ascending: false })
    .limit(1);
  const lastV =
    (priorVersions as Array<{ version: number }> | null)?.[0]?.version ?? 0;
  const nextVersion = lastV + 1;
  console.log(`   persisting as version ${nextVersion}, template_id=coach_corrected, parent_plan_id=${ORIGINAL_PLAN_ID}…`);

  // Skip PDF render in this smoke (just persist with pdf_path: null).
  // Real apply-correction route renders and uploads, but PDF render
  // requires the chrome shell which the script can't easily invoke.
  // Confirming the persistence path is the goal here.
  const newId = await persistPlanRow({
    db: db as any,
    client_id: CLIENT_ID,
    inputs,
    targets,
    planResult: weekPlan,
    audit,
    pdf_path: null,
    version_number: nextVersion,
    template_id: "coach_corrected",
    weight_kg: resolved.macro_inputs.weight_kg,
    sex: resolved.macro_inputs.sex,
    meals_per_day: distribution.meals_per_day,
    coach_review_recommended: complexity.recommended,
    complexity_reasons: complexity.reasons,
    coach_handoff_prompt: coachHandoffPrompt,
    parent_plan_id: ORIGINAL_PLAN_ID,
    manual_completion: false,
  });
  ok(typeof newId === "number" && newId > 0, `persisted new plan id=${newId}`);

  // Verify the row
  const { data: verifyRow } = await db
    .from("nutrition_meal_plans")
    .select("id, version, version_number, template_id, parent_plan_id, manual_completion, coach_review_recommended")
    .eq("id", newId)
    .single();
  const v = verifyRow as Record<string, unknown>;
  ok(v?.template_id === "coach_corrected", `template_id=coach_corrected (got ${v?.template_id})`);
  ok(v?.parent_plan_id === ORIGINAL_PLAN_ID, `parent_plan_id=${ORIGINAL_PLAN_ID} (got ${v?.parent_plan_id})`);
  ok(v?.manual_completion === false, "manual_completion=false");
  ok(v?.version_number === nextVersion, `version_number=${nextVersion}`);

  console.log("\n" + "=".repeat(72));
  if (failures.length === 0) {
    console.log("PASS — all coach-UI smoke assertions matched.");
  } else {
    console.log(`FAIL — ${failures.length} assertion(s) failed.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\nFATAL: ${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
