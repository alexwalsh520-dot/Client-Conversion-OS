/**
 * Phase B6a — pipeline runner.
 *
 * Executes the full v2 chain end-to-end:
 *   intake load → B1 (macros) → B3 (picker + solver via orchestrator) →
 *   B4 (audit) → B5 (pdf adapter) → render → upload → persist plan row
 *
 * Called by the cron worker (one job at a time). Wraps each stage in
 * structured error handling so the worker can write a clear `error_kind`
 * to the job row regardless of which stage blew up.
 *
 * Cancellation: caller passes onProgress, which is also used to check
 * job.status. If status flips to 'cancelled' between stages, the
 * orchestrator's onDayStart hook throws PipelineCancelledError and we
 * unwind cleanly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateMacrosForBuild } from "../macro-calculator-v2";
// LLM-meal-generator pivot: templates and solver are dormant. The
// production critical path goes through the LLM meal generator
// (slug+grams JSON via Anthropic tool-use) followed by a hard
// macro-verifier with one retry on tolerance miss. The audit module
// continues to run as the final pre-render gate.
import { auditWeekPlan } from "../audit";
import { weekPlanToPdfInput } from "../pdf-adapter";
import type { IngredientDisplayMeta } from "../pdf-adapter";
import { renderMealPlanPDF } from "../../pdf-renderer";
import { ALL_BUILDS } from "../builds";
import { ALL_DISTRIBUTIONS } from "../distributions";
import { ALL_ALLERGY_RULES } from "../allergies";
import { ALL_MEDICAL_RULES } from "../medical";
import { ALL_DIETARY_RULES } from "../dietary";
import { getIngredientNutrition } from "../solver";
import {
  generatePlanBatch,
  type ClientProfile as LLMClientProfile,
} from "../llm-meal-generator";
// verifyMacros now runs inside scorePlan (per-attempt diagnostic). The
// pipeline reads its result off the selected ScoredPlan rather than
// invoking the verifier directly.
import {
  scorePlan,
  selectBest,
  type ScoredPlan,
  type SelectionResult,
} from "../plan-selector";
import {
  detectComplexity,
  generateCoachHandoffPrompt,
  type CoachProfileInput,
  type ComplexityDetail,
} from "../coach-handoff";
import type { WeekPlanSuccess } from "../picker";
import type { ClientProfile } from "../audit";
import { isOnAppetiteSuppressant } from "../../parsers";
import { DistributionTemplateId } from "../types";
import type { BuildType, MealDistribution } from "../types";
import { loadIntake } from "./intake-loader";
import { IntakeParseError } from "./intake-parser";
import {
  PipelineCancelledError,
  type JobRequestInputs,
  type PipelineResult,
} from "./types";

// Build → fixed distribution mapping (B6a-pivot: meal counts are fixed
// per build, not coach-selected). Endurance training/rest split lives in
// the template itself; we still set defaults here for the solver's
// per-slot macro percentages.
const BUILD_TO_TRAINING_DISTRIBUTION: Record<BuildType, DistributionTemplateId> = {
  recomp: DistributionTemplateId.STANDARD_3_MEAL,
  shred: DistributionTemplateId.STANDARD_3_MEAL,
  maintain: DistributionTemplateId.STANDARD_3_MEAL,
  lean_gain: DistributionTemplateId.STANDARD_4_MEAL,
  bulk: DistributionTemplateId.ATHLETE_5_MEAL,
  endurance: DistributionTemplateId.ENDURANCE_5_MEAL_TRAINING_DAY,
};
const BUILD_TO_REST_DISTRIBUTION: Partial<Record<BuildType, DistributionTemplateId>> = {
  endurance: DistributionTemplateId.ENDURANCE_3_MEAL_REST_DAY,
};

const SODIUM_DEFAULT_MG = 2300;
const SODIUM_HBP_MG = 1800;
const SODIUM_KIDNEY_MG = 2000;
const SODIUM_STIMULANT_MG = 2000;

// ============================================================================
// Public entry point
// ============================================================================

export interface RunPipelineArgs {
  /** Supabase service-role client. */
  db: SupabaseClient;
  /** The job row id (used by the progress callback to update current_step). */
  job_id: number;
  /** Validated request body. */
  inputs: JobRequestInputs;
  /** Anthropic API key. */
  anthropic_api_key: string;
  /**
   * Called whenever the pipeline transitions to a new step. The runner
   * passes the new label; caller is responsible for the DB UPDATE +
   * cancellation check.
   *
   * If the callback throws (typically because the job was cancelled),
   * the error propagates and run-pipeline catches it as a cancelled
   * failure.
   */
  on_step?: (step: string) => Promise<void>;
}

export async function runPipeline(args: RunPipelineArgs): Promise<PipelineResult> {
  const { db, inputs, anthropic_api_key, on_step } = args;
  const stage_timings: Record<string, number> = {};
  const t0 = Date.now();
  const stamp = (label: string) => {
    stage_timings[label] = Date.now() - t0 - (stage_timings._cumulative ?? 0);
    stage_timings._cumulative = Date.now() - t0;
  };

  try {
    // ---- 1. Load intake ----
    if (on_step) await on_step("loading_intake");
    let resolved;
    try {
      resolved = await loadIntake({
        db,
        client_id: inputs.client_id,
        build_type: inputs.build_type,
        allergy_flags: inputs.allergy_flags,
        medical_flags: inputs.medical_flags,
        dietary_style: inputs.dietary_style,
        on_stimulant:
          inputs.on_stimulant ??
          isOnAppetiteSuppressant(""), // Placeholder; we re-check after we know medications text
      });
    } catch (e) {
      if (e instanceof IntakeParseError) {
        return failure("intake_invalid", { field: e.field, raw_value: e.rawValue, hint: e.hint }, stage_timings);
      }
      throw e;
    }
    // Re-resolve on_stimulant now that we have the medications free-text
    const onStim =
      inputs.on_stimulant ??
      isOnAppetiteSuppressant(resolved.intake_snapshot.medications);
    resolved.intake_snapshot.on_stimulant = onStim;
    // Use the sex from request inputs (intake form has no sex field)
    resolved.macro_inputs.sex = inputs.sex;
    stamp("loading_intake");

    // ---- 2. B1: macro calculation ----
    if (on_step) await on_step("calculating_macros");
    const targets = calculateMacrosForBuild({
      sex: resolved.macro_inputs.sex,
      weightKg: resolved.macro_inputs.weight_kg,
      heightCm: resolved.macro_inputs.height_cm,
      age: resolved.macro_inputs.age,
      buildType: inputs.build_type,
      activityLevel: inputs.activity_level,
      medicalFlags: inputs.medical_flags,
      onStimulant: onStim,
    });
    stamp("calculating_macros");

    // ---- 3. Build derived data: distribution, hardExclude, version ----
    // Distribution is derived from build_type per the B6a-pivot rule (meal
    // counts are fixed per build, not coach-selected). The
    // `distribution_template` request field is now ignored for non-Endurance
    // builds and accepted only for backward compatibility with the JobInputs
    // shape.
    // anthropic_api_key is now used by the dish-namer (post-solve).
    // The meal-composition path (template + solver + audit) remains
    // entirely deterministic.
    const buildSpec = ALL_BUILDS[inputs.build_type];
    const trainingDistId = BUILD_TO_TRAINING_DISTRIBUTION[inputs.build_type];
    const restDistId = BUILD_TO_REST_DISTRIBUTION[inputs.build_type];
    const distribution = ALL_DISTRIBUTIONS[trainingDistId];
    const restDistribution: MealDistribution | undefined = restDistId
      ? ALL_DISTRIBUTIONS[restDistId]
      : undefined;

    const hardExclude = new Set<string>();
    for (const f of inputs.allergy_flags) {
      const rule = ALL_ALLERGY_RULES[f];
      if (rule) for (const slug of rule.hard_exclude) hardExclude.add(slug);
    }
    for (const f of inputs.medical_flags) {
      const rule = ALL_MEDICAL_RULES[f];
      if (rule) for (const slug of rule.hard_exclude) hardExclude.add(slug);
    }
    if (inputs.dietary_style) {
      const rule = ALL_DIETARY_RULES[inputs.dietary_style];
      if (rule) for (const slug of rule.hard_exclude) hardExclude.add(slug);
    }

    // Compute next plan version EARLY — used for the persisted version chain.
    const nextVersion = await computeNextVersion(db, inputs.client_id);

    // ---- 4. LLM meal generator (best-of-3 parallel, plan-selector) ----
    // Replaces single-gen-with-retry. Fires 3 concurrent generations,
    // scores each against hard error categories (allergen leak, dietary
    // violation, invalid slug, schema violation), picks the valid plan
    // with fewest soft errors. If all 3 have hard errors → BLOCK with
    // structured failure. Macro-verifier becomes diagnostic-only.
    if (on_step) await on_step("generating_plan");

    const llmClientProfile: LLMClientProfile = {
      first_name: resolved.intake_snapshot.first_name,
      last_name: resolved.intake_snapshot.last_name,
      sex: resolved.macro_inputs.sex,
      weight_kg: resolved.macro_inputs.weight_kg,
      height_cm: resolved.macro_inputs.height_cm,
      age: resolved.macro_inputs.age,
      build_type: inputs.build_type,
      dietary_style: inputs.dietary_style,
      allergy_flags: inputs.allergy_flags,
      medical_flags: inputs.medical_flags,
      on_stimulant: onStim,
    };

    const BATCH_COUNT = 3;
    const batch = await generatePlanBatch(
      {
        client_profile: llmClientProfile,
        targets,
        build_spec: buildSpec,
        distribution,
        rest_distribution: restDistribution,
        hard_exclude: hardExclude,
        anthropic_api_key,
      },
      BATCH_COUNT,
    );
    stamp("generating_plan");

    const sodiumCapMg = resolveSodiumCap(inputs);
    const clientProfile: ClientProfile = {
      buildType: inputs.build_type,
      buildSpec,
      allergyFlags: inputs.allergy_flags,
      medicalFlags: inputs.medical_flags,
      dietaryStyle: inputs.dietary_style,
      sodiumCapMg,
      distributionTemplate: inputs.distribution_template,
    };

    if (on_step) await on_step("scoring_plans");
    const scored: ScoredPlan[] = await Promise.all(
      batch.map((attempt, i) =>
        scorePlan({
          plan_index: i,
          generation:
            attempt.kind === "ok"
              ? { kind: "ok", result: attempt.result }
              : { kind: "error", message: attempt.message },
          audit_profile: clientProfile,
          targets,
          allergy_flags: inputs.allergy_flags,
          medical_flags: inputs.medical_flags,
          dietary_style: inputs.dietary_style,
        }),
      ),
    );

    for (const s of scored) {
      const okCount = batch[s.plan_index].kind === "ok";
      const tokens =
        batch[s.plan_index].kind === "ok"
          ? `tokens_in=${s.generator_diagnostics?.input_tokens} out=${s.generator_diagnostics?.output_tokens} cost=$${s.generator_diagnostics?.estimated_cost_usd.toFixed(4)}`
          : `(generation_failed)`;
      console.log(
        `[plan-selector] attempt ${s.plan_index}: valid=${s.valid} hard=${s.hard_errors.length} soft=${s.soft_errors.length} ${tokens}`,
      );
      void okCount;
    }

    const selection: SelectionResult = selectBest(scored);
    console.log(`[plan-selector] ${selection.reason}`);
    stamp("scoring_plans");

    if (selection.selected_index === null) {
      // All 3 attempts had hard errors. Surface a coach-readable summary.
      const hard_kinds_per_attempt = scored.map((s) => ({
        attempt: s.plan_index,
        kinds: s.hard_errors.map((h) => h.kind),
      }));
      return failure(
        "audit_blocked",
        {
          reason:
            "All 3 generation attempts produced hard errors (allergen leak / dietary violation / invalid slug / schema violation). Coach should review intake form and try again.",
          attempts: hard_kinds_per_attempt,
          scored_diagnostics: scored.map((s) => ({
            plan_index: s.plan_index,
            valid: s.valid,
            hard_errors: s.hard_errors,
            soft_error_count: s.soft_errors.length,
          })),
        },
        stage_timings,
      );
    }

    const selectedScored = scored[selection.selected_index];
    if (!selectedScored.plan || !selectedScored.audit || !selectedScored.verify_result) {
      // Defensive — should be unreachable since valid implies plan present.
      return failure(
        "unexpected",
        { reason: `selected attempt ${selection.selected_index} missing plan/audit` },
        stage_timings,
      );
    }
    const planResult = selectedScored.plan;
    const audit = selectedScored.audit;
    const verifyResult = selectedScored.verify_result;
    console.log(
      `[macro-verifier:diagnostic] selected_attempt=${selection.selected_index} pass=${verifyResult.pass} failed_days=${verifyResult.failed_days}/7`,
    );

    // Pipe the verifier's per-day drift into audit_warnings as well —
    // not for blocking (already demoted), but so the coach handoff
    // prompt's "Flagged issues" surfaces the macro misses concretely.
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
        reason: `Macro verifier: ${verifyResult.failed_days} day(s) outside tolerance — ${driftSummary}`,
      });
    }

    const pipelineDiagnostics = {
      ...(planResult.diagnostics as unknown as Record<string, unknown>),
      verifier_pass: verifyResult.pass,
      verifier_failed_days: verifyResult.failed_days,
      verifier_day_diagnostics: verifyResult.day_diagnostics,
      batch_count: BATCH_COUNT,
      selected_attempt: selection.selected_index,
      selection_reason: selection.reason,
      attempt_summaries: scored.map((s) => ({
        plan_index: s.plan_index,
        valid: s.valid,
        hard_error_count: s.hard_errors.length,
        soft_error_count: s.soft_errors.length,
        hard_error_kinds: s.hard_errors.map((h) => h.kind),
      })),
    };

    // Audit BLOCK is now extremely rare (only ingredient_data_missing,
    // build_medical_block, custom_distribution_invalid_sum survive after
    // demotion). If it does fire on the selected plan, persist as block.
    stamp("auditing");

    if (audit.action === "BLOCK_GENERATION_RETURN_TO_COACH") {
      // Persist plan row WITHOUT a PDF — coach reviews audit blocks first.
      const planId = await persistPlanRow({
        db,
        client_id: inputs.client_id,
        inputs,
        targets,
        planResult,
        audit,
        pdf_path: null,
        version_number: nextVersion,
        template_id: "llm_meal_generator",
        weight_kg: resolved.macro_inputs.weight_kg,
        sex: resolved.macro_inputs.sex,
        meals_per_day: distribution.meals_per_day,
      });
      return {
        kind: "failure",
        error_kind: "audit_blocked",
        error_details: {
          blocking_errors: audit.blocking_errors,
          warnings: audit.warnings,
        },
        plan_id: planId,
        audit,
        diagnostics: pipelineDiagnostics,
        stage_timings,
      };
    }

    // ---- 6. B5: adapter (slugs + grams → PdfInput) ----
    if (on_step) await on_step("adapting_for_pdf");
    // Build display meta from the cached IngredientNutrition rows (which now
    // carry `name`).
    const allSlugs = new Set<string>();
    for (const day of planResult.days) {
      for (const slot of day.solve.slots) {
        for (const ing of slot.ingredients) {
          if (ing.grams > 0) allSlugs.add(ing.slug);
        }
      }
    }
    const nutritionMap = await getIngredientNutrition(Array.from(allSlugs));
    const displayMeta = new Map<string, IngredientDisplayMeta>();
    for (const slug of allSlugs) {
      const nut = nutritionMap.get(slug);
      if (!nut) {
        return failure(
          "unexpected",
          { reason: `nutrition for slug "${slug}" missing after fetch` },
          stage_timings,
          pipelineDiagnostics,
        );
      }
      // The B6a-extended ingredient cache populates `name` from the
      // ingredients table. If somehow absent, fall back to slug.
      displayMeta.set(slug, {
        name: nut.name ?? slug,
        category: nut.category,
      });
    }
    const pdfInput = await weekPlanToPdfInput(
      planResult,
      resolved.intake_snapshot,
      displayMeta,
    );
    stamp("adapting_for_pdf");

    // ---- 6b. Complexity detection + coach handoff prompt ----
    // Runs after audit + adapter so we have the final planResult, the audit
    // result, and the nutritionMap. Always generates a handoff prompt (the
    // coach UI shows it on demand even when not flagged).
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
    const complexity: ComplexityDetail = detectComplexity({
      planResult,
      audit,
      targets,
      // Best-of-N architecture has no retry — surface the batch size
      // instead so the complexity detector still triggers on
      // "needed multiple attempts to find a valid plan".
      verifierRetryCount: 0,
      nutritionMap,
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
        planResult,
        audit,
        verifyResult,
        complexity,
        nutritionMap,
      });
    } catch (e) {
      console.warn(
        `[coach-handoff] prompt generation failed: ${e instanceof Error ? e.message : String(e)} — proceeding without`,
      );
    }
    console.log(
      `[coach-handoff] recommended=${complexity.recommended} reasons=[${complexity.reasons.join(",")}] near_block_sodium_days=${complexity.near_block.sodium_days.length} anchors_at_cap=${complexity.near_block.anchors_at_cap.length} prompt_chars=${coachHandoffPrompt.length}`,
    );

    // ---- 7. Render PDF ----
    if (on_step) await on_step("rendering_pdf");
    const pdfBytes = renderMealPlanPDF(pdfInput);
    stamp("rendering_pdf");

    // ---- 8. Build pdf path; upload (nextVersion already computed early) ----
    if (on_step) await on_step("uploading");
    const safeName = `${resolved.intake_snapshot.first_name}_${resolved.intake_snapshot.last_name}`
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_");
    const pdfPath = `${inputs.client_id}/v2_v${nextVersion}_${safeName}_${Date.now()}.pdf`;

    const { error: uploadErr } = await db.storage
      .from("nutrition-plans")
      .upload(pdfPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadErr) {
      return failure(
        "storage_error",
        { message: uploadErr.message, path: pdfPath },
        stage_timings,
        pipelineDiagnostics,
      );
    }
    stamp("uploading");

    // ---- 9. Persist plan row ----
    if (on_step) await on_step("persisting");
    const planId = await persistPlanRow({
      db,
      client_id: inputs.client_id,
      inputs,
      targets,
      planResult,
      audit,
      pdf_path: pdfPath,
      version_number: nextVersion,
      template_id: "llm_meal_generator",
      weight_kg: resolved.macro_inputs.weight_kg,
      sex: resolved.macro_inputs.sex,
      meals_per_day: distribution.meals_per_day,
      coach_review_recommended: complexity.recommended,
      complexity_reasons: complexity.reasons,
      coach_handoff_prompt: coachHandoffPrompt,
    });
    stamp("persisting");

    // Mirror v1: flip clients.nutrition_status to 'pending' if not already done
    {
      const { data: client } = await db
        .from("clients")
        .select("nutrition_status")
        .eq("id", inputs.client_id)
        .single();
      const ns = (client as { nutrition_status?: string } | null)?.nutrition_status;
      if (ns !== "done") {
        await db
          .from("clients")
          .update({ nutrition_status: "pending" })
          .eq("id", inputs.client_id);
      }
    }

    // ---- 10. 2-hour signed URL ----
    const { data: signed } = await db.storage
      .from("nutrition-plans")
      .createSignedUrl(pdfPath, 60 * 60 * 2);
    const signedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? "";

    return {
      kind: "success",
      plan_id: planId,
      pdf_path: pdfPath,
      pdf_signed_url: signedUrl,
      audit,
      diagnostics: {
        ...pipelineDiagnostics,
        coach_review_recommended: complexity.recommended,
        complexity_reasons: complexity.reasons,
      },
      stage_timings,
    };
  } catch (e) {
    if (e instanceof PipelineCancelledError) {
      return {
        kind: "failure",
        error_kind: "cancelled",
        error_details: { reason: "cancelled by user" },
        stage_timings,
      };
    }
    const msg = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack?.slice(0, 1500) : undefined;
    return {
      kind: "failure",
      error_kind: "unexpected",
      error_details: { message: msg, stack },
      stage_timings,
    };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function failure(
  kind: PipelineResult & { kind: "failure" } extends infer R
    ? R extends { error_kind: infer K }
      ? K
      : never
    : never,
  details: Record<string, unknown>,
  stage_timings: Record<string, number>,
  diagnostics?: unknown,
): PipelineResult {
  return {
    kind: "failure",
    error_kind: kind,
    error_details: details,
    diagnostics,
    stage_timings,
  };
}

function resolveSodiumCap(inputs: JobRequestInputs): number {
  // Lowest cap wins across all triggered rules.
  const candidates: number[] = [SODIUM_DEFAULT_MG];
  for (const f of inputs.medical_flags) {
    if (f === "medical_hbp") candidates.push(SODIUM_HBP_MG);
    if (f === "medical_kidney") candidates.push(SODIUM_KIDNEY_MG);
  }
  if (inputs.on_stimulant) candidates.push(SODIUM_STIMULANT_MG);
  return Math.min(...candidates);
}

async function fetchAllIngredientSlugs(db: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await db.from("ingredients").select("slug");
  if (error) throw new Error(`fetchAllIngredientSlugs: ${error.message}`);
  return new Set(((data as Array<{ slug: string }> | null) ?? []).map((r) => r.slug));
}

async function computeNextVersion(
  db: SupabaseClient,
  clientId: number,
): Promise<number> {
  const { data } = await db
    .from("nutrition_meal_plans")
    .select("version")
    .eq("client_id", clientId)
    .order("version", { ascending: false })
    .limit(1);
  const arr = (data as Array<{ version: number }> | null) ?? [];
  return (arr[0]?.version ?? 0) + 1;
}

export interface PersistArgs {
  db: SupabaseClient;
  client_id: number;
  inputs: JobRequestInputs;
  targets: ReturnType<typeof calculateMacrosForBuild>;
  planResult: WeekPlanSuccess;
  audit: Awaited<ReturnType<typeof auditWeekPlan>>;
  pdf_path: string | null;
  version_number?: number;
  /** Template id (e.g. "recomp_omnivore_a"). Persisted to the new
   *  template_id column from migration 019 for observability. */
  template_id?: string;
  weight_kg: number;
  sex: "male" | "female";
  meals_per_day: number;
  // ---- B6a-pivot Option 4 (coach review) -------------------------------
  /** Whether the complexity detector recommended human review. */
  coach_review_recommended?: boolean;
  /** Reason codes (e.g. ["high_cal_build","macro_retry_required"]). */
  complexity_reasons?: readonly string[];
  /** Pre-rendered markdown the coach can paste into Claude.ai. Empty
   *  string when generation failed; the column accepts any text. */
  coach_handoff_prompt?: string;
  // ---- B6b (correction lineage + manual completion) -------------------
  /** When this row is a coach-corrected version, the original plan_id. */
  parent_plan_id?: number | null;
  /** True iff coach used "Handle manually & mark Done" — bypasses PDF. */
  manual_completion?: boolean;
}

export async function persistPlanRow(args: PersistArgs): Promise<number> {
  const { db, client_id, inputs, targets, planResult, audit, pdf_path } = args;
  const t = targets.training;
  const versionLegacy = args.version_number ?? (await computeNextVersion(db, client_id));

  // Build plan_data JSONB matching v1 shape (days/rawDays/grocery/tips)
  // OMITTED for the audit_blocked path (no PDF render happened).
  const plan_data: Record<string, unknown> = {
    v2: true,
    days: planResult.days.map((d) => ({
      day: d.day,
      day_kind: d.day_kind,
      slots: d.solve.slots,
    })),
    diagnostics: planResult.diagnostics,
  };

  const insertPayload: Record<string, unknown> = {
    client_id,
    version: versionLegacy,
    pdf_path,
    targets_calories: Math.round(t.calories),
    targets_protein_g: Math.round(t.proteinG),
    targets_carbs_g: Math.round(t.carbsG),
    targets_fat_g: Math.round(t.fatG),
    sex: args.sex,
    weight_kg: args.weight_kg,
    meals_per_day: args.meals_per_day,
    plan_data,
    comments_snapshot: [],
    created_by: "v2_pipeline",
    // ----- v2-specific columns from migration 017 -----
    version_number: versionLegacy,
    build_type: inputs.build_type,
    distribution_template: inputs.distribution_template,
    allergy_flags: inputs.allergy_flags,
    medical_flags: inputs.medical_flags,
    dietary_style: inputs.dietary_style,
    plan_complexity: inputs.plan_complexity,
    solver_bias: ALL_BUILDS[inputs.build_type].default_solver_bias,
    solver_feasibility:
      audit.action === "BLOCK_GENERATION_RETURN_TO_COACH" ? "warn" : "feasible",
    audit_results: audit,
    rest_day_calories: Math.round(targets.rest.calories),
    rest_day_protein_g: Math.round(targets.rest.proteinG),
    rest_day_carbs_g: Math.round(targets.rest.carbsG),
    rest_day_fat_g: Math.round(targets.rest.fatG),
    reason_for_generation: inputs.reason_for_generation ?? null,
    template_id: args.template_id ?? null,
    // Migration 020 — coach review affordances
    coach_review_recommended: args.coach_review_recommended ?? false,
    complexity_reasons: args.complexity_reasons ?? null,
    coach_handoff_prompt: args.coach_handoff_prompt ?? null,
    // Migration 021 — correction lineage + manual completion
    parent_plan_id: args.parent_plan_id ?? null,
    manual_completion: args.manual_completion ?? false,
  };

  const { data, error } = await db
    .from("nutrition_meal_plans")
    .insert(insertPayload)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`persistPlanRow: ${error?.message ?? "no row returned"}`);
  }
  return (data as { id: number }).id;
}
