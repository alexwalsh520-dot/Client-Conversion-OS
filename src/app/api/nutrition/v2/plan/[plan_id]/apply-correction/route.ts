/**
 * Phase B6b — POST /api/nutrition/v2/plan/:plan_id/apply-correction
 *
 * Coach-driven correction loop:
 *   1. Coach copies the handoff prompt + PDF link, pastes into Claude.ai
 *   2. Claude.ai returns a JSON correction matching CORRECTION_SCHEMA
 *   3. Coach pastes that JSON into the panel; UI POSTs here
 *   4. We validate the JSON, re-ingest via the meal-generator parser,
 *      run audit + verifier + complexity + handoff, render PDF, persist
 *      a new plan version with parent_plan_id pointing to the original.
 *
 * Hard-error guard: if the parser drops slugs (allergen leak / dietary
 * violation / invalid slug), we 400 with a coach-readable message —
 * shipping a corrected plan with a hard error would defeat the system's
 * safety contract.
 *
 * Audit BLOCK on the corrected plan (rare post-demotion): persist with
 * pdf_path: null and return audit_blocked: true. UI surfaces this as an
 * inline error within the existing panel (per spec — does NOT transition
 * to State 4).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  CORRECTION_SCHEMA,
  detectComplexity,
  generateCoachHandoffPrompt,
  type CoachProfileInput,
} from "@/lib/nutrition/v2/coach-handoff";
import {
  parseSubmitPlanResponse,
  wrapAsWeekPlanSuccess,
} from "@/lib/nutrition/v2/llm-meal-generator";
import { auditWeekPlan, type ClientProfile } from "@/lib/nutrition/v2/audit";
import { verifyMacros } from "@/lib/nutrition/v2/macro-verifier";
import {
  ALL_BUILDS,
} from "@/lib/nutrition/v2/builds";
import { ALL_DISTRIBUTIONS } from "@/lib/nutrition/v2/distributions";
import { ALL_ALLERGY_RULES } from "@/lib/nutrition/v2/allergies";
import { ALL_MEDICAL_RULES } from "@/lib/nutrition/v2/medical";
import { ALL_DIETARY_RULES } from "@/lib/nutrition/v2/dietary";
import { getIngredientNutrition } from "@/lib/nutrition/v2/solver";
import { getGramBounds } from "@/lib/nutrition/v2/solver/category-bounds";
import { weekPlanToPdfInput, type IngredientDisplayMeta } from "@/lib/nutrition/v2/pdf-adapter";
import { renderMealPlanPDF } from "@/lib/nutrition/pdf-renderer";
import { calculateMacrosForBuild } from "@/lib/nutrition/v2/macro-calculator-v2";
import { loadIntake } from "@/lib/nutrition/v2/pipeline/intake-loader";
import { persistPlanRow } from "@/lib/nutrition/v2/pipeline/run-pipeline";
import type { JobRequestInputs } from "@/lib/nutrition/v2/pipeline/types";
import type {
  AllergyFlag,
  BuildType,
  DietaryStyle,
  DistributionTemplateId,
  MedicalFlag,
  PlanComplexity,
} from "@/lib/nutrition/v2/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Tiny JSON Schema runtime — covers the subset CORRECTION_SCHEMA uses.
// ---------------------------------------------------------------------------

interface ValidationError {
  path: string;
  message: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function validateAgainstSchema(
  value: any,
  schema: any,
  path = "$",
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (schema.type === "object") {
    if (value == null || typeof value !== "object" || Array.isArray(value)) {
      errors.push({ path, message: `expected object, got ${typeOf(value)}` });
      return errors;
    }
    for (const required of schema.required ?? []) {
      if (!(required in value)) {
        errors.push({ path: `${path}.${required}`, message: "required field missing" });
      }
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (value[key] !== undefined) {
        errors.push(...validateAgainstSchema(value[key], subSchema, `${path}.${key}`));
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push({ path, message: `expected array, got ${typeOf(value)}` });
      return errors;
    }
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push({ path, message: `expected ≥ ${schema.minItems} items, got ${value.length}` });
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push({ path, message: `expected ≤ ${schema.maxItems} items, got ${value.length}` });
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        errors.push(...validateAgainstSchema(value[i], schema.items, `${path}[${i}]`));
      }
    }
  } else if (schema.type === "integer") {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      errors.push({ path, message: `expected integer, got ${typeOf(value)}` });
      return errors;
    }
    if (schema.minimum != null && value < schema.minimum) {
      errors.push({ path, message: `value ${value} < minimum ${schema.minimum}` });
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push({ path, message: `value ${value} > maximum ${schema.maximum}` });
    }
  } else if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push({ path, message: `expected string, got ${typeOf(value)}` });
      return errors;
    }
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push({ path, message: `string length ${value.length} < min ${schema.minLength}` });
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push({ path, message: `string length ${value.length} > max ${schema.maxLength}` });
    }
    if (schema.enum != null && !schema.enum.includes(value)) {
      errors.push({ path, message: `value '${value}' not in enum [${schema.enum.join(",")}]` });
    }
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push({ path, message: `expected boolean, got ${typeOf(value)}` });
    }
  }
  return errors;
}

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

// ---------------------------------------------------------------------------
// Helper: strip ```json fences if present (Claude.ai sometimes wraps)
// ---------------------------------------------------------------------------

function stripFences(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    // Drop opening fence (``` or ```json)
    s = s.replace(/^```(?:json)?\s*/i, "");
    // Drop trailing fence
    s = s.replace(/\s*```\s*$/, "");
  }
  return s.trim();
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ plan_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { plan_id: planIdRaw } = await ctx.params;
  const planId = parseInt(planIdRaw, 10);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "invalid plan_id" }, { status: 400 });
  }

  // Parse body — accept either a structured object or a string the coach
  // pasted (we'll JSON.parse it server-side, tolerating ```json fences).
  let body: { corrected_plan?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  let correctedPlan: any;
  if (typeof body.corrected_plan === "string") {
    try {
      correctedPlan = JSON.parse(stripFences(body.corrected_plan));
    } catch (e) {
      return NextResponse.json(
        {
          error: "couldn_t_parse_pasted_text",
          message: `Couldn't parse the pasted text as JSON. ${e instanceof Error ? e.message : ""}`,
        },
        { status: 400 },
      );
    }
  } else {
    correctedPlan = body.corrected_plan;
  }

  if (correctedPlan == null) {
    return NextResponse.json(
      { error: "corrected_plan field required" },
      { status: 400 },
    );
  }

  // Schema validation
  const schemaErrors = validateAgainstSchema(correctedPlan, CORRECTION_SCHEMA);
  if (schemaErrors.length > 0) {
    return NextResponse.json(
      {
        error: "schema_validation_failed",
        message: `JSON does not match the correction schema (${schemaErrors.length} issue${schemaErrors.length === 1 ? "" : "s"})`,
        details: schemaErrors.slice(0, 10),
      },
      { status: 400 },
    );
  }

  // Load original plan + client + intake
  const db = getServiceSupabase();
  const { data: planRow, error: planErr } = await db
    .from("nutrition_meal_plans")
    .select("*")
    .eq("id", planId)
    .single();
  if (planErr || !planRow) {
    return NextResponse.json({ error: "plan not found" }, { status: 404 });
  }
  const original = planRow as Record<string, unknown>;
  const clientId = original.client_id as number;

  // Load intake to recompute targets + intake_snapshot for the PDF.
  const inputs: JobRequestInputs = {
    client_id: clientId,
    sex: (original.sex as "male" | "female") ?? "male",
    activity_level: "moderate", // intake-loader recomputes; this is just a placeholder
    build_type: original.build_type as BuildType,
    allergy_flags: (original.allergy_flags as AllergyFlag[]) ?? [],
    medical_flags: (original.medical_flags as MedicalFlag[]) ?? [],
    dietary_style: (original.dietary_style as DietaryStyle | null) ?? null,
    plan_complexity: (original.plan_complexity as PlanComplexity) ?? "intermediate",
    distribution_template:
      (original.distribution_template as DistributionTemplateId) ?? "standard_3_meal",
    on_stimulant: false,
  };

  let resolved;
  try {
    resolved = await loadIntake({
      db,
      client_id: clientId,
      build_type: inputs.build_type,
      allergy_flags: inputs.allergy_flags,
      medical_flags: inputs.medical_flags,
      dietary_style: inputs.dietary_style,
      on_stimulant: inputs.on_stimulant ?? false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "intake_load_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Re-compute macro targets (same as run-pipeline)
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
  const restDistribution = distribution; // same as run-pipeline default

  // Compose hard_exclude (same merge as run-pipeline)
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

  // Re-ingest via the meal-generator parser
  const allSlugs = await fetchApprovedSlugs(db);
  // Pre-fetch nutrition for all candidate slugs surfacing in the correction
  const candidateSlugs = new Set<string>();
  for (const day of (correctedPlan as { days: Array<{ meals: Array<{ ingredients: Array<{ slug: string }> }> }> }).days ?? []) {
    for (const meal of day.meals ?? []) {
      for (const ing of meal.ingredients ?? []) {
        if (typeof ing.slug === "string") candidateSlugs.add(ing.slug);
      }
    }
  }
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
  if (parseResult.fatal || !parseResult.plan) {
    return NextResponse.json(
      {
        error: "parse_failed",
        message: parseResult.fatal ?? "parser produced no plan",
      },
      { status: 400 },
    );
  }
  if (parseResult.dropped_slugs.length > 0) {
    return NextResponse.json(
      {
        error: "hard_errors_in_correction",
        message:
          "Claude.ai's correction contains slugs that aren't allowed for this client. Ask Claude.ai to retry — it included slugs the system filtered out.",
        dropped_slugs: parseResult.dropped_slugs.slice(0, 20),
      },
      { status: 400 },
    );
  }

  // Pull any slugs that were only added by the corrected plan (parser
  // didn't pre-fetch them all if some were brand-new).
  const survivingSlugs = new Set<string>();
  for (const d of parseResult.plan.days) {
    for (const m of d.meals) for (const ing of m.ingredients) survivingSlugs.add(ing.slug);
  }
  const fullNutritionMap = await getIngredientNutrition(Array.from(survivingSlugs));

  // Wrap as WeekPlanSuccess facade
  const weekPlan = wrapAsWeekPlanSuccess({
    rawDays: parseResult.plan.days,
    targets,
    distribution,
    rest_distribution: restDistribution,
    nutrition_map: fullNutritionMap,
  });

  // Audit
  const sodiumCapMg = computeSodiumCap(inputs);
  const auditProfile: ClientProfile = {
    buildType: inputs.build_type,
    buildSpec,
    allergyFlags: inputs.allergy_flags,
    medicalFlags: inputs.medical_flags,
    dietaryStyle: inputs.dietary_style,
    sodiumCapMg,
    distributionTemplate: inputs.distribution_template,
  };
  const audit = await auditWeekPlan(weekPlan, auditProfile);
  const auditBlocked = audit.action === "BLOCK_GENERATION_RETURN_TO_COACH";

  // Verifier (diagnostic)
  const verifyResult = await verifyMacros({ plan: weekPlan, targets });
  if (!verifyResult.pass) {
    const driftSummary = verifyResult.day_diagnostics
      .filter((d) => !d.pass)
      .map((d) => `Day ${d.day_number}: ${d.fail_reasons.join(", ")}`)
      .join(" | ");
    audit.warnings.push({
      severity: "WARN",
      check: "daily_macro_drift",
      details: {
        source: "macro_verifier",
        failed_days: verifyResult.failed_days,
        tolerance_pct: 15,
      },
      reason: `Macro verifier (corrected plan): ${verifyResult.failed_days} day(s) outside tolerance — ${driftSummary}`,
    });
  }

  // Complexity + handoff
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
    sodiumCeilingMg: sodiumCapMg * 1.15,
  });

  let coachHandoffPrompt = "";
  try {
    coachHandoffPrompt = await generateCoachHandoffPrompt({
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
  } catch (e) {
    console.warn(
      `[apply-correction] handoff prompt regeneration failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Compute next version
  const { data: priorVersions } = await db
    .from("nutrition_meal_plans")
    .select("version")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1);
  const lastV = (priorVersions as Array<{ version: number }> | null)?.[0]?.version ?? 0;
  const nextVersion = lastV + 1;

  // Render PDF (skip on audit BLOCK — persist row without PDF)
  let pdfPath: string | null = null;
  let signedUrl: string | null = null;
  if (!auditBlocked) {
    try {
      const allSlugsInPlan = new Set<string>();
      for (const day of weekPlan.days) {
        for (const slot of day.solve.slots) {
          for (const ing of slot.ingredients) if (ing.grams > 0) allSlugsInPlan.add(ing.slug);
        }
      }
      const displayMeta = new Map<string, IngredientDisplayMeta>();
      for (const slug of allSlugsInPlan) {
        const nut = fullNutritionMap.get(slug);
        if (!nut) continue;
        displayMeta.set(slug, { name: nut.name ?? slug, category: nut.category });
      }
      const pdfInput = await weekPlanToPdfInput(
        weekPlan,
        resolved.intake_snapshot,
        displayMeta,
      );
      const pdfBytes = renderMealPlanPDF(pdfInput);
      const safeName = `${resolved.intake_snapshot.first_name}_${resolved.intake_snapshot.last_name}`
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_");
      pdfPath = `${clientId}/v2_v${nextVersion}_corrected_${safeName}_${Date.now()}.pdf`;

      const { error: uploadErr } = await db.storage
        .from("nutrition-plans")
        .upload(pdfPath, pdfBytes, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (uploadErr) {
        return NextResponse.json(
          { error: "pdf_upload_failed", message: uploadErr.message },
          { status: 500 },
        );
      }
      const { data: signed } = await db.storage
        .from("nutrition-plans")
        .createSignedUrl(pdfPath, 60 * 60 * 2);
      signedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;
    } catch (e) {
      return NextResponse.json(
        {
          error: "render_failed",
          message: e instanceof Error ? e.message : String(e),
        },
        { status: 500 },
      );
    }
  }

  // Persist new plan row
  let newPlanId: number;
  try {
    newPlanId = await persistPlanRow({
      db,
      client_id: clientId,
      inputs,
      targets,
      planResult: weekPlan,
      audit,
      pdf_path: pdfPath,
      version_number: nextVersion,
      template_id: "coach_corrected",
      weight_kg: resolved.macro_inputs.weight_kg,
      sex: resolved.macro_inputs.sex,
      meals_per_day: distribution.meals_per_day,
      coach_review_recommended: complexity.recommended,
      complexity_reasons: complexity.reasons,
      coach_handoff_prompt: coachHandoffPrompt,
      parent_plan_id: planId,
      manual_completion: false,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "persist_failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    plan_id: newPlanId,
    parent_plan_id: planId,
    audit_blocked: auditBlocked,
    audit_summary: {
      pass: audit.pass,
      blocking_count: audit.blocking_errors.length,
      warning_count: audit.warnings.length,
    },
    coach_review_recommended: complexity.recommended,
    complexity_reasons: complexity.reasons,
    pdf_signed_url: signedUrl,
  });
}

// ---------------------------------------------------------------------------
// Helpers (duplicates of run-pipeline locals — kept inline to avoid
// exporting more surface area; sodium cap math + slug fetch.)
// ---------------------------------------------------------------------------

const SODIUM_DEFAULT_MG = 2300;
const SODIUM_HBP_MG = 1800;
const SODIUM_KIDNEY_MG = 1500;
const SODIUM_STIMULANT_MG = 2000;

function computeSodiumCap(inputs: JobRequestInputs): number {
  const candidates: number[] = [SODIUM_DEFAULT_MG];
  for (const f of inputs.medical_flags) {
    if (f === "medical_hbp") candidates.push(SODIUM_HBP_MG);
    if (f === "medical_kidney") candidates.push(SODIUM_KIDNEY_MG);
  }
  if (inputs.on_stimulant) candidates.push(SODIUM_STIMULANT_MG);
  return Math.min(...candidates);
}

async function fetchApprovedSlugs(db: ReturnType<typeof getServiceSupabase>): Promise<Set<string>> {
  const { data, error } = await db.from("ingredients").select("slug");
  if (error) throw new Error(`fetchApprovedSlugs: ${error.message}`);
  return new Set(((data as Array<{ slug: string }> | null) ?? []).map((r) => r.slug));
}
