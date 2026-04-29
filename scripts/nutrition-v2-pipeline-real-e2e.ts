#!/usr/bin/env node
/**
 * Phase B6a — REAL end-to-end pipeline test.
 *
 * Calls runPipeline() directly with a real client_id, hitting:
 *   - real Supabase (intake form load, ingredient cache fetch, plan insert,
 *     storage upload)
 *   - real Anthropic API (B3 picker, 7 sequential day calls)
 *   - real PDF render
 *
 * Bypasses the queue + cron + UI layers — those are exercised in a
 * separate post-deploy UI test. The point HERE is to find functional
 * pipeline bugs before deploy: parser quirks, Anthropic surprises,
 * audit logic failures, schema mismatches, ingredient cache holes, etc.
 *
 * Required env (in .env.local at repo root):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/nutrition-v2-pipeline-real-e2e.ts
 *
 *   # Override client_id (default 35593 = Santiago Bustamante):
 *   ./node_modules/.bin/tsx scripts/nutrition-v2-pipeline-real-e2e.ts --client 35587
 *
 *   # Override build (default recomp):
 *   ./node_modules/.bin/tsx scripts/nutrition-v2-pipeline-real-e2e.ts --build shred
 *
 *   # Skip the actual generation; just exercise intake parse + macro calc:
 *   ./node_modules/.bin/tsx scripts/nutrition-v2-pipeline-real-e2e.ts --dry-run
 */

import { config as dotenvConfig } from "dotenv";
// override:true so that an empty ANTHROPIC_API_KEY in the parent shell
// (common after sourcing zsh defaults) doesn't shadow the value in
// .env.local. Without this, dotenv silently no-ops on conflicts.
dotenvConfig({ path: ".env.local", override: true });

import { createClient } from "@supabase/supabase-js";
import { runPipeline } from "../src/lib/nutrition/v2/pipeline/run-pipeline";
import {
  loadIntake,
} from "../src/lib/nutrition/v2/pipeline/intake-loader";
import { calculateMacrosForBuild } from "../src/lib/nutrition/v2/macro-calculator-v2";
import {
  AllergyFlag,
  BuildType,
  DistributionTemplateId,
  PlanComplexity,
  type AllergyFlag as AllergyFlagType,
} from "../src/lib/nutrition/v2/types";
import type { JobRequestInputs } from "../src/lib/nutrition/v2/pipeline/types";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const CLIENT_ID = parseInt(arg("client", "35593"), 10);
const BUILD = arg("build", "recomp") as BuildType;
const DRY_RUN = flag("dry-run");

// --allergy <name>[,<name>...] — comma-separated list of allergy flags to
// inject into hardExclude. Used to verify the deterministic substitution
// path (e.g. dairy → swap whey/yogurt anchors to alternatives).
const ALLERGY_RAW = arg("allergy", "");
const ALLERGY_FLAGS: AllergyFlagType[] = ALLERGY_RAW
  ? ALLERGY_RAW.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((short) => {
        // Accept both short ("dairy") and full ("allergy_dairy") forms
        const full = short.startsWith("allergy_") || short.startsWith("intolerance_")
          ? short
          : `allergy_${short}`;
        // Validate by checking against the enum values
        const validValues = Object.values(AllergyFlag) as string[];
        if (!validValues.includes(full)) {
          console.error(`✗ Unknown allergy flag: "${short}" (resolved to "${full}")`);
          console.error(`  Valid: ${validValues.join(", ")}`);
          process.exit(1);
        }
        return full as AllergyFlagType;
      })
  : [];

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ Missing required env var: ${name}`);
    console.error(`  Add it to .env.local at the repo root.`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
// ANTHROPIC_API_KEY is required again post-LLM-dish-naming. The
// meal-composition path remains zero-LLM (template + solver + audit
// are all deterministic), but the dish-namer (post-solve) uses
// Anthropic to produce dish names from the actually-rendered
// ingredient lists. If the key is missing, dish-namer falls back to
// authored names per template — plan still ships, just with worse
// names.
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? "";
if (!ANTHROPIC_KEY) {
  console.warn(
    "  ⚠ ANTHROPIC_API_KEY not set — dish-namer will skip API and use authored fallbacks",
  );
}

// ---------------------------------------------------------------------------
// Supabase client (service role — bypasses RLS for the pipeline)
// ---------------------------------------------------------------------------

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------------------------------------------------------------------------
// Job inputs (Recomp + omnivore + no allergies + intermediate per spec)
// ---------------------------------------------------------------------------

const inputs: JobRequestInputs = {
  client_id: CLIENT_ID,
  sex: "male",
  activity_level: "moderate",
  build_type: BUILD,
  allergy_flags: ALLERGY_FLAGS,
  medical_flags: [],
  dietary_style: null, // omnivore default; null is also "no restriction"
  plan_complexity: PlanComplexity.INTERMEDIATE,
  distribution_template: DistributionTemplateId.STANDARD_3_MEAL,
  on_stimulant: false,
  reason_for_generation:
    ALLERGY_FLAGS.length > 0
      ? `B6a-pivot e2e (allergies: ${ALLERGY_FLAGS.join(", ")})`
      : "B6a-pivot e2e (no restrictions)",
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=".repeat(72));
  console.log(`B6a-pivot real-e2e smoke: client ${CLIENT_ID}, build=${BUILD}`);
  if (ALLERGY_FLAGS.length > 0) {
    console.log(`  injected allergies: ${ALLERGY_FLAGS.join(", ")}`);
  }
  // No-Anthropic instrumentation: monkey-patch fetch to detect any call to
  // api.anthropic.com. If hit, log loudly. The deterministic path should
  // never trigger this.
  const originalFetch = globalThis.fetch;
  let anthropicCallCount = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("api.anthropic.com")) {
      anthropicCallCount += 1;
      console.warn(`  ⚠ FETCH TO ANTHROPIC DETECTED: ${url}`);
    }
    return originalFetch(input, init);
  };
  console.log("=".repeat(72));

  // Stage 1: intake parse (regardless of dry-run)
  console.log("\n[stage] loading intake...");
  const t0 = Date.now();
  const resolved = await loadIntake({
    db,
    client_id: CLIENT_ID,
    build_type: inputs.build_type,
    allergy_flags: inputs.allergy_flags,
    medical_flags: inputs.medical_flags,
    dietary_style: inputs.dietary_style,
    on_stimulant: false,
  });
  resolved.macro_inputs.sex = inputs.sex;
  console.log(`  ✓ intake parsed in ${Date.now() - t0}ms`);
  console.log(`    name:        ${resolved.intake_snapshot.first_name} ${resolved.intake_snapshot.last_name}`);
  console.log(`    age:         ${resolved.macro_inputs.age}`);
  console.log(`    weight:      ${resolved.macro_inputs.weight_kg.toFixed(2)} kg (${(resolved.macro_inputs.weight_kg * 2.20462).toFixed(1)} lbs)`);
  console.log(`    height:      ${resolved.macro_inputs.height_cm} cm`);
  console.log(`    goal weight: ${resolved.goal_weight_kg ? `${resolved.goal_weight_kg.toFixed(2)} kg` : "unparseable (non-blocking)"}`);
  if (resolved.parse_warnings.length > 0) {
    console.log(`    warnings:`);
    for (const w of resolved.parse_warnings) console.log(`      - ${w}`);
  }

  // Stage 2: macro calc (regardless of dry-run)
  console.log("\n[stage] calculating macros...");
  const t1 = Date.now();
  const targets = calculateMacrosForBuild({
    sex: inputs.sex,
    weightKg: resolved.macro_inputs.weight_kg,
    heightCm: resolved.macro_inputs.height_cm,
    age: resolved.macro_inputs.age,
    buildType: inputs.build_type,
    activityLevel: inputs.activity_level,
    medicalFlags: inputs.medical_flags,
    onStimulant: false,
  });
  console.log(`  ✓ macros computed in ${Date.now() - t1}ms`);
  const tt = targets.training;
  const tr = targets.rest;
  console.log(`    TRAINING: ${tt.calories} kcal · P=${tt.proteinG} C=${tt.carbsG} F=${tt.fatG} · Na≤${tt.sodiumCapMg}`);
  console.log(`    REST:     ${tr.calories} kcal · P=${tr.proteinG} C=${tr.carbsG} F=${tr.fatG} · Na≤${tr.sodiumCapMg}`);
  // Self-consistency check
  const trainCheck = tt.proteinG * 4 + tt.carbsG * 4 + tt.fatG * 9;
  console.log(`    training kcal balance: ${trainCheck} (target ${tt.calories}, drift ${trainCheck - tt.calories})`);

  if (DRY_RUN) {
    console.log("\n[dry-run] stopping before B3/B4/B5/render/upload");
    process.exit(0);
  }

  // Stage 3+: full pipeline via runPipeline (real Anthropic, real Supabase)
  console.log("\n[stage] running full pipeline (this hits real Anthropic — ~30s)...");
  const ttotal = Date.now();
  const stepLog: Array<{ step: string; t: number }> = [];
  const result = await runPipeline({
    db,
    job_id: -1, // not a real job row; on_step is logging-only
    inputs,
    anthropic_api_key: ANTHROPIC_KEY,
    on_step: async (step) => {
      const elapsed = Date.now() - ttotal;
      stepLog.push({ step, t: elapsed });
      const fmt = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
      console.log(`    [${fmt(elapsed)}] ${step}`);
    },
  });

  const totalSec = (Date.now() - ttotal) / 1000;
  console.log(`\n  ✓ pipeline returned in ${totalSec.toFixed(2)}s total`);

  // LLM-meal-generator architecture: 1 Anthropic call on success, 2 if
  // macro-verifier triggered a single retry. Anything else is suspect.
  if (anthropicCallCount === 1) {
    console.log(`  ✓ 1 Anthropic API call (verifier passed first try)`);
  } else if (anthropicCallCount === 2) {
    console.log(`  ✓ 2 Anthropic API calls (verifier triggered 1 retry — within budget)`);
  } else if (anthropicCallCount === 0) {
    console.error(`  ✗ Zero Anthropic calls — generator did not run, plan should not exist`);
  } else {
    console.error(`  ✗ Anthropic API was called ${anthropicCallCount} times — expected 1 or 2 (generator + ≤1 retry)`);
  }

  // Wall-clock target ~40s per user spec for ship; B6b perf later.
  if (totalSec < 45) {
    console.log(`  ✓ wall-clock ${totalSec.toFixed(2)}s under 45s target`);
  } else {
    console.warn(`  ⚠ wall-clock ${totalSec.toFixed(2)}s exceeds 45s target (B6b perf followup)`);
  }

  console.log("\n----- result -----");
  console.log(`  kind: ${result.kind}`);
  if (result.kind === "success") {
    console.log(`  plan_id: ${result.plan_id}`);
    console.log(`  pdf_path: ${result.pdf_path}`);
    console.log(`  pdf_signed_url: ${result.pdf_signed_url.slice(0, 80)}...`);
    console.log(`  audit: pass=${result.audit.pass}, blocking=${result.audit.blocking_errors.length}, warnings=${result.audit.warnings.length}`);
    console.log(`\n  stage_timings (ms):`);
    for (const [k, v] of Object.entries(result.stage_timings)) {
      if (k === "_cumulative") continue;
      console.log(`    ${k}: ${v}`);
    }

    // Surface LLM-generator + macro-verifier diagnostics
    const diag = result.diagnostics as
      | {
          generator_calls?: number;
          generator_retries?: number;
          verifier_pass?: boolean;
          verifier_failed_days?: number;
          verifier_day_diagnostics?: Array<{
            day_number: number;
            day_kind: string;
            kcal_actual: number;
            kcal_target: number;
            kcal_drift_pct: number;
            protein_drift_pct: number;
            carbs_drift_pct: number;
            fat_drift_pct: number;
            pass: boolean;
          }>;
        }
      | undefined;
    if (diag?.generator_calls != null) {
      console.log(
        `\n  generator: ${diag.generator_calls} call(s), ${diag.generator_retries ?? 0} retry/retries`,
      );
    }
    if (diag?.verifier_day_diagnostics) {
      const passing = diag.verifier_day_diagnostics.filter((d) => d.pass).length;
      console.log(
        `  verifier: pass=${diag.verifier_pass}, ${passing}/${diag.verifier_day_diagnostics.length} days within ±15%`,
      );
      console.log(`  per-day macro drift (training/rest):`);
      for (const d of diag.verifier_day_diagnostics) {
        const flag = d.pass ? "✓" : "✗";
        console.log(
          `    ${flag} d${d.day_number} ${d.day_kind.padEnd(8)} kcal=${d.kcal_actual}/${d.kcal_target} (${d.kcal_drift_pct >= 0 ? "+" : ""}${d.kcal_drift_pct}%)  P${d.protein_drift_pct >= 0 ? "+" : ""}${d.protein_drift_pct}% C${d.carbs_drift_pct >= 0 ? "+" : ""}${d.carbs_drift_pct}% F${d.fat_drift_pct >= 0 ? "+" : ""}${d.fat_drift_pct}%`,
        );
      }
    }

    // Verify the row was actually written with v2 columns
    console.log("\n[verify] reading inserted nutrition_meal_plans row...");
    const { data: row, error } = await db
      .from("nutrition_meal_plans")
      .select(
        "id, client_id, version, version_number, build_type, template_id, distribution_template, plan_complexity, solver_bias, solver_feasibility, dietary_style, allergy_flags, medical_flags, audit_results, rest_day_calories, pdf_path",
      )
      .eq("id", result.plan_id)
      .single();
    if (error || !row) {
      console.error(`  ✗ failed to read plan row: ${error?.message ?? "no row"}`);
    } else {
      const r = row as Record<string, unknown>;
      console.log(`  ✓ plan row verified:`);
      console.log(`    id=${r.id} client_id=${r.client_id} version=${r.version} version_number=${r.version_number}`);
      console.log(`    build_type=${r.build_type} template_id=${r.template_id} distribution=${r.distribution_template} complexity=${r.plan_complexity}`);
      console.log(`    solver_bias=${r.solver_bias} solver_feasibility=${r.solver_feasibility}`);
      console.log(`    dietary_style=${r.dietary_style} allergy_flags=${JSON.stringify(r.allergy_flags)} medical_flags=${JSON.stringify(r.medical_flags)}`);
      console.log(`    audit_results: ${r.audit_results ? "populated" : "missing!"}`);
      console.log(`    rest_day_calories=${r.rest_day_calories}`);
      console.log(`    pdf_path=${r.pdf_path}`);
    }

    process.exit(0);
  } else {
    console.log(`  error_kind: ${result.error_kind}`);
    console.log(`  error_details:`);
    console.log("    " + JSON.stringify(result.error_details, null, 2).split("\n").join("\n    "));
    if (result.plan_id) {
      console.log(`  plan_id (partial-persist): ${result.plan_id}`);
    }
    if (result.audit) {
      console.log(`  audit: pass=${result.audit.pass}, blocking=${result.audit.blocking_errors.length}, warnings=${result.audit.warnings.length}`);
      if (result.audit.blocking_errors.length > 0) {
        console.log("  blocking_errors:");
        for (const e of result.audit.blocking_errors.slice(0, 5)) {
          console.log(`    [${e.check}] day=${e.day} meal=${e.meal} ${e.reason}`);
        }
      }
    }
    console.log(`\n  stage_timings (ms):`);
    for (const [k, v] of Object.entries(result.stage_timings)) {
      if (k === "_cumulative") continue;
      console.log(`    ${k}: ${v}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n✗ Uncaught error:");
  console.error(e);
  process.exit(2);
});
