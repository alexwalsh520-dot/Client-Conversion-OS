#!/usr/bin/env node
/**
 * Hermetic smoke for the macro-verifier module.
 *
 * Builds synthetic WeekPlanSuccess plans with seeded ingredient nutrition
 * data, runs verifyMacros, and checks pass/fail/diagnostic shape.
 *
 * No Supabase calls — _seedIngredientCache pre-populates the
 * solver's ingredient cache, which the verifier reads.
 *
 * Cases:
 *   1. All-pass — 7 days within ±15% on every macro.
 *   2. Single-day fail — 1 day's protein 50% high; pass=false; failed_days=1;
 *      retry_hint mentions "Day 3".
 *   3. All-four-macros fail on one day — fail_reasons length 4 with
 *      kcal/protein/carbs/fat each present.
 *   4. Direction signs — positive drift renders "+"; negative renders "−" or "-".
 *   5. Custom tighter tolerance (±5%) — flips a borderline-passing case to fail.
 *   6. Multi-day fail (≥4 days) — failed_days ≥ 4, simulating BLOCK threshold.
 *   7. Day-kind targeting — rest-day with training-only macros fails because
 *      rest macros are lower (verifier picked the right target by day_kind).
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

import { verifyMacros } from "../src/lib/nutrition/v2/macro-verifier";
import {
  _clearIngredientCache,
  _seedIngredientCache,
} from "../src/lib/nutrition/v2/solver/ingredient-data";
import type { WeekPlanSuccess } from "../src/lib/nutrition/v2/picker";
import type { MacroTargets } from "../src/lib/nutrition/macro-calculator";
import type { IngredientNutrition } from "../src/lib/nutrition/v2/solver/types";

interface FailureRecord { test: string; message: string }
const failures: FailureRecord[] = [];

function ok(condition: boolean, test: string, message: string): void {
  if (!condition) {
    failures.push({ test, message });
    console.log(`    ✗ ${message}`);
  } else {
    console.log(`    ✓ ${message}`);
  }
}

// ===== Mock nutrition data ===================================================
// Tuned so a "balanced" daily portion lands at exactly the training targets.

const NUTRITION: IngredientNutrition[] = [
  {
    slug: "mock_protein", category: "protein",
    calories_per_100g: 400, protein_g_per_100g: 100,
    carbs_g_per_100g: 0, fat_g_per_100g: 0, sodium_mg_per_100g: 0,
  },
  {
    slug: "mock_carb", category: "carb",
    calories_per_100g: 400, protein_g_per_100g: 0,
    carbs_g_per_100g: 100, fat_g_per_100g: 0, sodium_mg_per_100g: 0,
  },
  {
    slug: "mock_fat", category: "fat",
    calories_per_100g: 900, protein_g_per_100g: 0,
    carbs_g_per_100g: 0, fat_g_per_100g: 100, sodium_mg_per_100g: 0,
  },
];

// ===== Targets ==============================================================

const TRAINING: MacroTargets = {
  calories: 2700, proteinG: 220, carbsG: 250, fatG: 90,
  bmr: 1800, tdee: 2700, activityFactor: 1.5,
  goal: "recomp", proteinPerKg: 2.4, proteinPerLb: 1.1,
  sodiumCapMg: 2300, notes: [],
};

const REST: MacroTargets = {
  calories: 2200, proteinG: 200, carbsG: 180, fatG: 75,
  bmr: 1800, tdee: 2200, activityFactor: 1.2,
  goal: "recomp", proteinPerKg: 2.2, proteinPerLb: 1.0,
  sodiumCapMg: 2300, notes: [],
};

// ===== Plan builder =========================================================

function buildDay(
  day: number,
  day_kind: "training" | "rest",
  targets: MacroTargets,
  override?: { proteinG?: number; carbsG?: number; fatG?: number },
): WeekPlanSuccess["days"][0] {
  const proteinG = override?.proteinG ?? targets.proteinG;
  const carbsG = override?.carbsG ?? targets.carbsG;
  const fatG = override?.fatG ?? targets.fatG;

  // Each macro slug has 100% of its macro per 100g, so grams = target_g.
  const slots = [
    { index: 1, ingredients: [{ slug: "mock_protein", grams: Math.round(proteinG / 3) }, { slug: "mock_carb", grams: Math.round(carbsG / 3) }, { slug: "mock_fat", grams: Math.round(fatG / 3) }] },
    { index: 2, ingredients: [{ slug: "mock_protein", grams: Math.round(proteinG / 3) }, { slug: "mock_carb", grams: Math.round(carbsG / 3) }, { slug: "mock_fat", grams: Math.round(fatG / 3) }] },
    { index: 3, ingredients: [{ slug: "mock_protein", grams: proteinG - 2 * Math.round(proteinG / 3) }, { slug: "mock_carb", grams: carbsG - 2 * Math.round(carbsG / 3) }, { slug: "mock_fat", grams: fatG - 2 * Math.round(fatG / 3) }] },
  ];

  return {
    day,
    day_kind,
    pick: { dayKind: day_kind, slots: [], assemblyHints: { dishes: [] } } as any,
    solve: {
      status: "SUCCESS",
      slots,
      diagnostics: {
        fallback_level: 10,
        zeroed_slugs: [],
        daily: {
          calories: proteinG * 4 + carbsG * 4 + fatG * 9,
          protein_g: proteinG, carbs_g: carbsG, fat_g: fatG,
          sodium_mg: 0,
        },
        per_slot: [],
        objective_value: 0,
        bias: "balanced" as any,
        solve_time_ms: 0,
      },
    } as any,
    targets,
    distribution: {} as any,
  };
}

function buildPlan(
  days: Array<{
    day_kind: "training" | "rest";
    override?: { proteinG?: number; carbsG?: number; fatG?: number };
  }>,
): WeekPlanSuccess {
  return {
    status: "SUCCESS",
    days: days.map((d, i) =>
      buildDay(
        i + 1,
        d.day_kind,
        d.day_kind === "training" ? TRAINING : REST,
        d.override,
      ),
    ),
    diagnostics: {
      per_day: [],
      total_llm_calls: 1,
      total_wall_clock_ms: 0,
      days_with_reprompts: 0,
      days_with_solver_fallback: 0,
      days_infeasible: 0,
    },
  };
}

// ===== Main ================================================================

async function main(): Promise<void> {
  _clearIngredientCache();
  _seedIngredientCache(NUTRITION);

  // ----- Test V.1: all-pass -----
  console.log("\n=== Test V.1: all 7 days within ±15% → pass ===");
  {
    const plan = buildPlan([
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "rest" },
    ]);
    const result = await verifyMacros({ plan, targets: { training: TRAINING, rest: REST } });
    ok(result.pass === true, "V.1", `pass=true (got ${result.pass})`);
    ok(result.failed_days === 0, "V.1", `failed_days=0 (got ${result.failed_days})`);
    ok(result.retry_hint === "", "V.1", "retry_hint empty");
    ok(result.day_diagnostics.length === 7, "V.1", `7 day diagnostics (got ${result.day_diagnostics.length})`);
    ok(result.day_diagnostics.every((d) => d.pass), "V.1", "every day pass=true");
  }

  // ----- Test V.2: single-day fail -----
  console.log("\n=== Test V.2: 1 day's protein 50% high → fail with single-day diagnostic ===");
  {
    const plan = buildPlan([
      { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "training", override: { proteinG: 330 } }, // +50% protein
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "rest" },
    ]);
    const result = await verifyMacros({ plan, targets: { training: TRAINING, rest: REST } });
    ok(result.pass === false, "V.2", `pass=false (got ${result.pass})`);
    ok(result.failed_days === 1, "V.2", `failed_days=1 (got ${result.failed_days})`);
    ok(result.retry_hint.includes("Day 3"), "V.2", "retry_hint mentions Day 3");
    ok(result.retry_hint.includes("protein"), "V.2", "retry_hint mentions protein");
    const day3 = result.day_diagnostics.find((d) => d.day_number === 3);
    ok(day3 !== undefined && day3.pass === false, "V.2", "day 3 pass=false");
    ok(day3 !== undefined && day3.protein_drift_pct > 30, "V.2", `day 3 protein_drift_pct > 30 (got ${day3?.protein_drift_pct})`);
  }

  // ----- Test V.3: all-four-macros fail one day -----
  console.log("\n=== Test V.3: 1 day with all 4 macros way off → fail_reasons length 4 ===");
  {
    const plan = buildPlan([
      { day_kind: "training", override: { proteinG: 80, carbsG: 80, fatG: 30 } }, // way under
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "rest" },
    ]);
    const result = await verifyMacros({ plan, targets: { training: TRAINING, rest: REST } });
    const day1 = result.day_diagnostics[0];
    ok(day1.fail_reasons.length === 4, "V.3", `4 fail_reasons (got ${day1.fail_reasons.length})`);
    ok(day1.fail_reasons.some((r) => r.startsWith("kcal")), "V.3", "kcal in fail_reasons");
    ok(day1.fail_reasons.some((r) => r.startsWith("protein")), "V.3", "protein in fail_reasons");
    ok(day1.fail_reasons.some((r) => r.startsWith("carbs")), "V.3", "carbs in fail_reasons");
    ok(day1.fail_reasons.some((r) => r.startsWith("fat")), "V.3", "fat in fail_reasons");
  }

  // ----- Test V.4: direction signs -----
  console.log("\n=== Test V.4: positive vs negative drift sign rendering ===");
  {
    const plan = buildPlan([
      { day_kind: "training", override: { proteinG: 330 } }, // +50% protein
      { day_kind: "training", override: { proteinG: 100 } }, // -55% protein
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "training" }, { day_kind: "rest" },
    ]);
    const result = await verifyMacros({ plan, targets: { training: TRAINING, rest: REST } });
    ok(result.retry_hint.includes("+"), "V.4", "retry_hint includes '+' for positive drift");
    ok(/-\d|−\d/.test(result.retry_hint), "V.4", "retry_hint includes '-' for negative drift");
    const day1 = result.day_diagnostics[0];
    const day2 = result.day_diagnostics[1];
    ok(day1.protein_drift_pct > 0, "V.4", `day 1 drift positive (got ${day1.protein_drift_pct})`);
    ok(day2.protein_drift_pct < 0, "V.4", `day 2 drift negative (got ${day2.protein_drift_pct})`);
  }

  // ----- Test V.5: custom tolerance -----
  console.log("\n=== Test V.5: tighter tolerance (±5%) flips borderline-passing to fail ===");
  {
    // Day 2 protein 10% over. Default tolerance (15%) → pass. Tight (5%) → fail.
    const plan = buildPlan([
      { day_kind: "training" },
      { day_kind: "training", override: { proteinG: 242 } }, // +10% protein
      { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "rest" },
    ]);
    const defaultResult = await verifyMacros({ plan, targets: { training: TRAINING, rest: REST } });
    ok(defaultResult.pass === true, "V.5", "default ±15% → pass");

    const tightResult = await verifyMacros({
      plan,
      targets: { training: TRAINING, rest: REST },
      tolerance_pct: 0.05,
    });
    ok(tightResult.pass === false, "V.5", "tight ±5% → fail");
    ok(tightResult.failed_days === 1, "V.5", `tight failed_days=1 (got ${tightResult.failed_days})`);
    ok(tightResult.retry_hint.includes("±5%"), "V.5", "retry_hint mentions ±5% tolerance");
  }

  // ----- Test V.6: multi-day fail (≥ 4 → BLOCK threshold) -----
  console.log("\n=== Test V.6: 5 days off → failed_days ≥ 4 (simulating BLOCK threshold) ===");
  {
    const plan = buildPlan([
      { day_kind: "training", override: { proteinG: 350 } },
      { day_kind: "training", override: { fatG: 30 } },
      { day_kind: "training", override: { carbsG: 400 } },
      { day_kind: "training", override: { proteinG: 100 } },
      { day_kind: "training", override: { fatG: 150 } },
      { day_kind: "training" }, // pass
      { day_kind: "rest" }, // pass
    ]);
    const result = await verifyMacros({ plan, targets: { training: TRAINING, rest: REST } });
    ok(result.pass === false, "V.6", `pass=false (got ${result.pass})`);
    ok(result.failed_days >= 4, "V.6", `failed_days ≥ 4 (got ${result.failed_days})`);
    ok(result.failed_days === 5, "V.6", `failed_days=5 (got ${result.failed_days})`);
    // retry_hint should list each failed day
    const dayMatches = (result.retry_hint.match(/Day \d/g) ?? []).length;
    ok(dayMatches === 5, "V.6", `retry_hint references 5 days (got ${dayMatches})`);
  }

  // ----- Test V.7: day-kind picks correct targets -----
  console.log("\n=== Test V.7: rest day with training-target macros → fails (verifier uses rest targets) ===");
  {
    // Day is marked rest but macros match TRAINING (which exceed REST by ~25%).
    // Verifier should use REST targets and detect the overshoot.
    const plan = buildPlan([
      { day_kind: "rest", override: { proteinG: TRAINING.proteinG, carbsG: TRAINING.carbsG, fatG: TRAINING.fatG } },
      { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "training" }, { day_kind: "training" }, { day_kind: "training" },
      { day_kind: "training" },
    ]);
    const result = await verifyMacros({ plan, targets: { training: TRAINING, rest: REST } });
    const day1 = result.day_diagnostics[0];
    ok(day1.day_kind === "rest", "V.7", `day 1 day_kind=rest (got ${day1.day_kind})`);
    ok(day1.kcal_target === REST.calories, "V.7", `day 1 kcal_target=${REST.calories} (rest, got ${day1.kcal_target})`);
    ok(day1.protein_target_g === REST.proteinG, "V.7", `day 1 protein_target_g=${REST.proteinG}`);
    ok(day1.pass === false, "V.7", "rest day overshooting rest targets → pass=false");
  }

  // ===== Summary ============================================================
  console.log("\n" + "=".repeat(72));
  if (failures.length > 0) {
    console.log(`FAIL — ${failures.length} verifier assertion(s) failed:\n`);
    for (const f of failures) console.log(`  • [${f.test}] ${f.message}`);
    process.exit(1);
  }
  console.log("PASS — all macro-verifier assertions matched.");
}

main().catch((e) => {
  console.error(`\nFATAL: ${e instanceof Error ? e.message : String(e)}`);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
