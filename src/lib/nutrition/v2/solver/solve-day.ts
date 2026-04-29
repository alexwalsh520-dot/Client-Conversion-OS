/**
 * Phase B2 — MILP solver for one day's meal plan.
 *
 * Translates a SolveDayInput (daily macro targets + per-slot ingredient
 * picks) into a GLPK MILP, solves it with fallback widening, and returns
 * either gram amounts per slot (success / success-with-degradation) or a
 * structured InfeasibilityError.
 *
 * Variables, per slot i and slug s in that slot:
 *   x_i_s  — continuous, grams of slug s in slot i (≥ 0)
 *   y_i_s  — binary, 1 if slug s is included (used for plan complexity cap)
 *   For NEUTRAL bias only:
 *     pos_i_<p|c|f>, neg_i_<p|c|f> — L1 deviation aux vars
 *
 * Constraints:
 *   per-slug big-M linkage:
 *     x_i_s ≤ max[s] × y_i_s        (x = 0 when y = 0)
 *     x_i_s ≥ min[s] × y_i_s        (x ≥ min[s] when y = 1)
 *   per-slot macro band (±tol per spec):
 *     (1 - tol) × target_i_m ≤ Σ_s (m_per_100g[s] / 100) × x_i_s ≤ (1 + tol) × target_i_m
 *   daily macro band (±5%):
 *     0.95 × daily_m ≤ Σ_i Σ_s (m_per_100g[s] / 100) × x_i_s ≤ 1.05 × daily_m
 *   plan complexity cap:
 *     Σ_s y_i_s ≤ planComplexity_cap     (per slot i)
 *   daily sodium cap (×1.15, hard, never widens):
 *     Σ_i Σ_s (Na_per_100g[s] / 100) × x_i_s ≤ sodiumCap × 1.15
 *   hard excludes — slugs in hardExclude get NO variables (skipped entirely).
 *
 * Objective:
 *   VOLUME bias  — maximize Σ x_i_s
 *   DENSITY bias — minimize Σ x_i_s
 *   NEUTRAL bias — minimize Σ_i Σ_m (pos_i_m + neg_i_m)
 *
 * Fallback widening (per Q&A):
 *   Try ±10% per-slot tolerance.
 *   If infeasible, retry ±15% (one shot).
 *   If infeasible, retry ±20% (one shot).
 *   If still infeasible, return InfeasibilityError.
 *   Sodium hard cap and hard excludes never relax.
 *
 * Anchor degradation (per Q&A):
 *   When the solver zeroes out an LLM-picked slug:
 *     SUCCESS_WITH_DEGRADATION status, plus zeroed_slugs[] in diagnostics
 *     including the anchor flag. B3 inspects to decide re-prompt.
 */

import {
  PLAN_COMPLEXITY_INGREDIENT_CAP,
  PlanComplexity,
  SolverBias,
} from "../types";
import { getGramBounds } from "./category-bounds";
import { getIngredientNutrition } from "./ingredient-data";
import { computePerSlotTargets } from "./per-slot-targets";
import type {
  DailyActuals,
  FallbackLevel,
  IngredientNutrition,
  InfeasibilityError,
  PerSlotActuals,
  PerSlotTargets,
  SlotInput,
  SlotResult,
  SolveDayInput,
  SolveDayOutput,
  SolveDaySuccess,
  ZeroedSlug,
} from "./types";

// ----- glpk lazy loader ---------------------------------------------------

type GlpkInstance = Awaited<ReturnType<typeof loadGlpk>>;

async function loadGlpk() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import("glpk.js")) as any;
  // glpk.js exports a default factory function that returns a sync GLPK
  const factory = (mod.default ?? mod) as () => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return factory() as any;
}

// ----- Tunable thresholds -------------------------------------------------

const SOLVER_TIME_LIMIT_SEC = 10; // hard wall-clock per attempt
const ZERO_DETECTION_THRESHOLD_G = 0.5; // x < 0.5g → zeroed
const SODIUM_CAP_FACTOR = 1.15;
const DAILY_MACRO_TOLERANCE = 0.05; // ±5% on daily totals

// ----- Public entry point -------------------------------------------------

export async function solveDay(input: SolveDayInput): Promise<SolveDayOutput> {
  validateInput(input);

  // 1. Build the ingredient pool (post-exclude) and fetch nutrition data.
  const slotsFiltered = input.slots.map((slot) => ({
    index: slot.index,
    ingredients: slot.ingredients.filter(
      (ing) => !input.hardExclude.has(ing.slug),
    ),
  }));
  const allSlugs = Array.from(
    new Set(slotsFiltered.flatMap((s) => s.ingredients.map((i) => i.slug))),
  );
  const nutritionMap = await getIngredientNutrition(allSlugs);
  const missing = allSlugs.filter((s) => !nutritionMap.has(s));
  if (missing.length > 0) {
    throw new Error(
      `solveDay: ingredient(s) not found in DB: ${missing.join(", ")}`,
    );
  }

  // 2. Per-slot targets from daily × distribution.
  const perSlotTargets = computePerSlotTargets(input.targets, input.distribution);

  // 3. Solver attempts at increasing tolerance.
  const glpk = await loadGlpk();
  const fallbackLevels: FallbackLevel[] = [10, 15, 20];
  let lastFailure: { level: FallbackLevel; reason: string } | null = null;
  let totalSolveTimeMs = 0;

  for (const level of fallbackLevels) {
    const tol = level / 100;
    const attempt = await runSolver({
      glpk,
      input,
      slotsFiltered,
      nutritionMap,
      perSlotTargets,
      perSlotTolerance: tol,
    });
    totalSolveTimeMs += attempt.solveTimeMs;

    if (attempt.kind === "success") {
      const success = parseSolverResult({
        input,
        slotsFiltered,
        perSlotTargets,
        nutritionMap,
        glpkResult: attempt.result,
        fallbackLevel: level,
        solveTimeMs: totalSolveTimeMs,
      });
      return success;
    }
    lastFailure = { level, reason: attempt.reason };
  }

  // 4. All fallbacks exhausted — diagnose and return InfeasibilityError.
  return diagnoseInfeasibility({
    input,
    slotsFiltered,
    nutritionMap,
    perSlotTargets,
    lastFailure: lastFailure!,
  });
}

// ============================================================================
// Solver attempt (one fallback level)
// ============================================================================

interface RunSolverArgs {
  glpk: GlpkInstance;
  input: SolveDayInput;
  slotsFiltered: SlotInput[];
  nutritionMap: Map<string, IngredientNutrition>;
  perSlotTargets: PerSlotTargets[];
  perSlotTolerance: number;
}

interface SolverAttemptSuccess {
  kind: "success";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  solveTimeMs: number;
}

interface SolverAttemptFailure {
  kind: "failure";
  reason: string;
  solveTimeMs: number;
}

type SolverAttempt = SolverAttemptSuccess | SolverAttemptFailure;

async function runSolver(args: RunSolverArgs): Promise<SolverAttempt> {
  const { glpk, input, slotsFiltered, nutritionMap, perSlotTargets } = args;
  const tol = args.perSlotTolerance;

  const lp = buildLP({
    glpk,
    input,
    slotsFiltered,
    nutritionMap,
    perSlotTargets,
    perSlotTolerance: tol,
  });

  const t0 = Date.now();
  const result = glpk.solve(lp, {
    msglev: glpk.GLP_MSG_OFF,
    tmlim: SOLVER_TIME_LIMIT_SEC,
  });
  const solveTimeMs = Date.now() - t0;

  const status = result.result?.status;
  if (status === glpk.GLP_OPT || status === glpk.GLP_FEAS) {
    return { kind: "success", result, solveTimeMs };
  }
  return {
    kind: "failure",
    reason: glpkStatusName(glpk, status),
    solveTimeMs,
  };
}

// ============================================================================
// LP builder
// ============================================================================

interface BuildLPArgs {
  glpk: GlpkInstance;
  input: SolveDayInput;
  slotsFiltered: SlotInput[];
  nutritionMap: Map<string, IngredientNutrition>;
  perSlotTargets: PerSlotTargets[];
  perSlotTolerance: number;
}

interface VarRef {
  name: string;
  slug: string;
  slotIdx: number; // 0-based within slotsFiltered (NOT distribution index)
  slugIdx: number; // 0-based within the slot's filtered list
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildLP(args: BuildLPArgs): any {
  const {
    glpk,
    input,
    slotsFiltered,
    nutritionMap,
    perSlotTargets,
    perSlotTolerance,
  } = args;

  // ---- Variable registry --------------------------------------------------
  const xVars: VarRef[] = [];
  const yVars: VarRef[] = [];
  // Map from (slotIdx, slugIdx) → bounds
  const bounds: Array<{ name: string; type: number; lb: number; ub: number }> = [];

  slotsFiltered.forEach((slot, slotIdx) => {
    slot.ingredients.forEach((ing, slugIdx) => {
      const xName = `x_${slotIdx}_${slugIdx}`;
      const yName = `y_${slotIdx}_${slugIdx}`;
      xVars.push({ name: xName, slug: ing.slug, slotIdx, slugIdx });
      yVars.push({ name: yName, slug: ing.slug, slotIdx, slugIdx });
      // x bounded [0, max] regardless (linkage handles y=0 forcing)
      const nut = nutritionMap.get(ing.slug)!;
      const gb = getGramBounds(ing.slug, nut.category);
      bounds.push({ name: xName, type: glpk.GLP_DB, lb: 0, ub: gb.max });
      // y is binary so bounds are inferred from `binaries` list; no explicit bounds
    });
  });

  // ---- Constraints --------------------------------------------------------
  const subjectTo: Array<{
    name: string;
    vars: Array<{ name: string; coef: number }>;
    bnds: { type: number; lb: number; ub: number };
  }> = [];

  // Big-M linkage per (slot, slug):
  //   x ≤ max × y → x - max·y ≤ 0
  //   x ≥ min × y → x - min·y ≥ 0
  for (const x of xVars) {
    const slug = x.slug;
    const nut = nutritionMap.get(slug)!;
    const gb = getGramBounds(slug, nut.category);
    const yName = `y_${x.slotIdx}_${x.slugIdx}`;
    subjectTo.push({
      name: `linkmax_${x.slotIdx}_${x.slugIdx}`,
      vars: [
        { name: x.name, coef: 1 },
        { name: yName, coef: -gb.max },
      ],
      bnds: { type: glpk.GLP_UP, ub: 0, lb: 0 },
    });
    subjectTo.push({
      name: `linkmin_${x.slotIdx}_${x.slugIdx}`,
      vars: [
        { name: x.name, coef: 1 },
        { name: yName, coef: -gb.min },
      ],
      bnds: { type: glpk.GLP_LO, lb: 0, ub: 0 },
    });
  }

  // Per-slot macro bands.
  slotsFiltered.forEach((slot, slotIdx) => {
    const target = perSlotTargets[slotIdx];
    const macros: Array<["protein" | "carbs" | "fat", number, "p_per_100" | "c_per_100" | "f_per_100"]> = [
      ["protein", target.protein_g, "p_per_100"],
      ["carbs", target.carbs_g, "c_per_100"],
      ["fat", target.fat_g, "f_per_100"],
    ];
    for (const [name, slotTarget, ___] of macros) {
      void ___;
      const vars = slot.ingredients.map((ing, slugIdx) => {
        const nut = nutritionMap.get(ing.slug)!;
        const coef =
          name === "protein"
            ? nut.protein_g_per_100g
            : name === "carbs"
              ? nut.carbs_g_per_100g
              : nut.fat_g_per_100g;
        return { name: `x_${slotIdx}_${slugIdx}`, coef: coef / 100 };
      });
      const lb = (1 - perSlotTolerance) * slotTarget;
      const ub = (1 + perSlotTolerance) * slotTarget;
      subjectTo.push({
        name: `slot${slotIdx}_${name}`,
        vars,
        bnds: { type: glpk.GLP_DB, lb, ub },
      });
    }
  });

  // Daily macro bands ±5%.
  const dailyTol = DAILY_MACRO_TOLERANCE;
  const allXNutritionPairs: Array<{ x: VarRef; nut: IngredientNutrition }> = xVars.map(
    (x) => ({ x, nut: nutritionMap.get(x.slug)! }),
  );
  for (const macro of ["protein", "carbs", "fat"] as const) {
    const dailyTarget =
      macro === "protein"
        ? input.targets.proteinG
        : macro === "carbs"
          ? input.targets.carbsG
          : input.targets.fatG;
    const vars = allXNutritionPairs.map(({ x, nut }) => {
      const coef =
        macro === "protein"
          ? nut.protein_g_per_100g
          : macro === "carbs"
            ? nut.carbs_g_per_100g
            : nut.fat_g_per_100g;
      return { name: x.name, coef: coef / 100 };
    });
    subjectTo.push({
      name: `daily_${macro}`,
      vars,
      bnds: {
        type: glpk.GLP_DB,
        lb: (1 - dailyTol) * dailyTarget,
        ub: (1 + dailyTol) * dailyTarget,
      },
    });
  }

  // Plan complexity cap per slot.
  const cap = PLAN_COMPLEXITY_INGREDIENT_CAP[input.planComplexity];
  slotsFiltered.forEach((slot, slotIdx) => {
    const vars = slot.ingredients.map((_, slugIdx) => ({
      name: `y_${slotIdx}_${slugIdx}`,
      coef: 1,
    }));
    subjectTo.push({
      name: `cap_${slotIdx}`,
      vars,
      bnds: { type: glpk.GLP_UP, ub: cap, lb: 0 },
    });
  });

  // Daily sodium cap (HARD, no widening).
  const sodiumVars = allXNutritionPairs.map(({ x, nut }) => ({
    name: x.name,
    coef: nut.sodium_mg_per_100g / 100,
  }));
  subjectTo.push({
    name: "sodium_cap",
    vars: sodiumVars,
    bnds: {
      type: glpk.GLP_UP,
      ub: input.targets.sodiumCapMg * SODIUM_CAP_FACTOR,
      lb: 0,
    },
  });

  // ---- Objective ---------------------------------------------------------
  const binaries = yVars.map((y) => y.name);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let objective: any;

  if (input.bias === SolverBias.NEUTRAL) {
    // Add L1 deviation aux vars and equality-link constraints, then minimize sum.
    const auxBounds: Array<{ name: string; type: number; lb: number; ub: number }> = [];
    const auxVarNames: string[] = [];
    perSlotTargets.forEach((target, slotIdx) => {
      const slot = slotsFiltered[slotIdx];
      for (const macro of ["p", "c", "f"] as const) {
        const posName = `pos_${slotIdx}_${macro}`;
        const negName = `neg_${slotIdx}_${macro}`;
        auxVarNames.push(posName, negName);
        auxBounds.push({ name: posName, type: glpk.GLP_LO, lb: 0, ub: 0 });
        auxBounds.push({ name: negName, type: glpk.GLP_LO, lb: 0, ub: 0 });
        // Σ_s (m/100) × x - pos + neg = target
        const macroTarget =
          macro === "p" ? target.protein_g : macro === "c" ? target.carbs_g : target.fat_g;
        const macroCoef = (nut: IngredientNutrition) =>
          macro === "p"
            ? nut.protein_g_per_100g / 100
            : macro === "c"
              ? nut.carbs_g_per_100g / 100
              : nut.fat_g_per_100g / 100;
        const linkVars = slot.ingredients.map((ing, slugIdx) => ({
          name: `x_${slotIdx}_${slugIdx}`,
          coef: macroCoef(nutritionMap.get(ing.slug)!),
        }));
        linkVars.push({ name: posName, coef: -1 });
        linkVars.push({ name: negName, coef: 1 });
        subjectTo.push({
          name: `l1_${slotIdx}_${macro}`,
          vars: linkVars,
          bnds: { type: glpk.GLP_FX, lb: macroTarget, ub: macroTarget },
        });
      }
    });
    bounds.push(...auxBounds);
    objective = {
      direction: glpk.GLP_MIN,
      name: "neutral_l1",
      vars: auxVarNames.map((name) => ({ name, coef: 1 })),
    };
  } else if (input.bias === SolverBias.VOLUME) {
    objective = {
      direction: glpk.GLP_MAX,
      name: "volume_max_grams",
      vars: xVars.map((x) => ({ name: x.name, coef: 1 })),
    };
  } else {
    // DENSITY
    objective = {
      direction: glpk.GLP_MIN,
      name: "density_min_grams",
      vars: xVars.map((x) => ({ name: x.name, coef: 1 })),
    };
  }

  return {
    name: "meal_day",
    objective,
    subjectTo,
    bounds,
    binaries,
  };
}

// ============================================================================
// Result parsing
// ============================================================================

interface ParseArgs {
  input: SolveDayInput;
  slotsFiltered: SlotInput[];
  perSlotTargets: PerSlotTargets[];
  nutritionMap: Map<string, IngredientNutrition>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  glpkResult: any;
  fallbackLevel: FallbackLevel;
  solveTimeMs: number;
}

function parseSolverResult(args: ParseArgs): SolveDaySuccess {
  const { input, slotsFiltered, perSlotTargets, nutritionMap, glpkResult } = args;
  const vars = (glpkResult.result?.vars ?? {}) as Record<string, number>;

  const slots: SlotResult[] = [];
  const perSlotActuals: PerSlotActuals[] = [];
  const zeroedSlugs: ZeroedSlug[] = [];
  const dailyAcc: DailyActuals = {
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    sodium_mg: 0,
  };

  slotsFiltered.forEach((slot, slotIdx) => {
    const slotIngredients: SlotResult["ingredients"] = [];
    let pSum = 0,
      cSum = 0,
      fSum = 0,
      naSum = 0;

    slot.ingredients.forEach((ing, slugIdx) => {
      const xRaw = vars[`x_${slotIdx}_${slugIdx}`] ?? 0;
      const grams = roundGrams(xRaw);
      const nut = nutritionMap.get(ing.slug)!;
      const isZeroed = xRaw < ZERO_DETECTION_THRESHOLD_G;

      if (isZeroed) {
        zeroedSlugs.push({
          slot_index: slot.index,
          slug: ing.slug,
          anchor: !!ing.isAnchor,
        });
      } else {
        slotIngredients.push({ slug: ing.slug, grams });
        // Use unrounded x for actuals to match what solver actually produced
        pSum += (xRaw * nut.protein_g_per_100g) / 100;
        cSum += (xRaw * nut.carbs_g_per_100g) / 100;
        fSum += (xRaw * nut.fat_g_per_100g) / 100;
        naSum += (xRaw * nut.sodium_mg_per_100g) / 100;
      }
    });

    const slotKcal = pSum * 4 + cSum * 4 + fSum * 9;
    perSlotActuals.push({
      slot_index: slot.index,
      protein_g: round1(pSum),
      carbs_g: round1(cSum),
      fat_g: round1(fSum),
      calories: round1(slotKcal),
      sodium_mg: round1(naSum),
    });
    slots.push({ index: slot.index, ingredients: slotIngredients });

    dailyAcc.protein_g += pSum;
    dailyAcc.carbs_g += cSum;
    dailyAcc.fat_g += fSum;
    dailyAcc.sodium_mg += naSum;
  });

  void perSlotTargets; // (kept in signature for future drift accounting)

  dailyAcc.calories = dailyAcc.protein_g * 4 + dailyAcc.carbs_g * 4 + dailyAcc.fat_g * 9;

  const status: SolveDaySuccess["status"] =
    zeroedSlugs.length > 0 ? "SUCCESS_WITH_DEGRADATION" : "SUCCESS";

  return {
    status,
    slots,
    diagnostics: {
      fallback_level: args.fallbackLevel,
      zeroed_slugs: zeroedSlugs,
      daily: {
        calories: round1(dailyAcc.calories),
        protein_g: round1(dailyAcc.protein_g),
        carbs_g: round1(dailyAcc.carbs_g),
        fat_g: round1(dailyAcc.fat_g),
        sodium_mg: round1(dailyAcc.sodium_mg),
      },
      per_slot: perSlotActuals,
      objective_value: glpkResult.result?.z ?? 0,
      bias: input.bias,
      solve_time_ms: args.solveTimeMs,
    },
  };
}

// ============================================================================
// Infeasibility diagnosis
// ============================================================================

interface DiagnoseArgs {
  input: SolveDayInput;
  slotsFiltered: SlotInput[];
  nutritionMap: Map<string, IngredientNutrition>;
  perSlotTargets: PerSlotTargets[];
  lastFailure: { level: FallbackLevel; reason: string };
}

function diagnoseInfeasibility(args: DiagnoseArgs): InfeasibilityError {
  const { input, slotsFiltered, nutritionMap, perSlotTargets, lastFailure } = args;
  void perSlotTargets;

  // Heuristic: examine which daily target is hardest to hit given the
  // available ingredient pool. For each macro, compute the max achievable
  // sum if every ingredient ran at its category max in every slot.
  const allNutritions = slotsFiltered
    .flatMap((slot) => slot.ingredients)
    .map((ing) => nutritionMap.get(ing.slug)!);

  const maxAchievable = {
    protein: 0,
    carbs: 0,
    fat: 0,
    sodium: 0,
  };
  let totalMaxGrams = 0;
  slotsFiltered.forEach((slot) => {
    slot.ingredients.forEach((ing) => {
      const nut = nutritionMap.get(ing.slug)!;
      const gb = getGramBounds(ing.slug, nut.category);
      maxAchievable.protein += (nut.protein_g_per_100g * gb.max) / 100;
      maxAchievable.carbs += (nut.carbs_g_per_100g * gb.max) / 100;
      maxAchievable.fat += (nut.fat_g_per_100g * gb.max) / 100;
      maxAchievable.sodium += (nut.sodium_mg_per_100g * gb.min) / 100;
      totalMaxGrams += gb.max;
    });
  });
  void allNutritions;
  void totalMaxGrams;

  const dailyP = input.targets.proteinG * (1 - DAILY_MACRO_TOLERANCE);
  const dailyC = input.targets.carbsG * (1 - DAILY_MACRO_TOLERANCE);
  const dailyF = input.targets.fatG * (1 - DAILY_MACRO_TOLERANCE);

  const recommendations: string[] = [];
  let bindingConstraint = "";
  let failedConstraint = "macro_or_sodium";
  let slotIndex: number | null = null;

  if (maxAchievable.protein < dailyP) {
    bindingConstraint = `Protein target ${input.targets.proteinG}g infeasible — available ingredient pool maxes out at ${Math.round(
      maxAchievable.protein,
    )}g/day.`;
    failedConstraint = "daily_protein";
    recommendations.push(
      "Allow whey or plant protein powder if currently excluded.",
    );
    recommendations.push(
      "Switch to a build with a lower protein g/lb (e.g. Lean Gain at 1.05 vs Shred at 1.15).",
    );
    recommendations.push(
      "Add legumes or animal proteins to the slot ingredient picks.",
    );
  } else if (maxAchievable.fat < dailyF * 0.8) {
    bindingConstraint = `Fat target ${input.targets.fatG}g infeasible — available pool maxes at ${Math.round(
      maxAchievable.fat,
    )}g/day with current dietary restrictions.`;
    failedConstraint = "daily_fat";
    recommendations.push(
      "Allow nuts/seeds (currently excluded by allergy flags?) or peanuts if not strict.",
    );
    recommendations.push(
      "Switch to a build with a higher fat percentage (e.g. Bulk at 30% vs Shred at 25%).",
    );
    recommendations.push("Add olive oil / avocado oil to slot picks.");
  } else {
    // Macro pool seems sufficient — likely sodium ceiling or band tightness
    // beyond ±20% widening.
    const upperFat = input.targets.fatG * (1 + DAILY_MACRO_TOLERANCE);
    if (maxAchievable.fat < upperFat * 0.5) {
      bindingConstraint = `Fat target ${input.targets.fatG}g hard to hit at the lower band even after ±${lastFailure.level}% per-meal widening.`;
      failedConstraint = "daily_fat";
      recommendations.push(
        "Loosen the dietary stack — currently active exclusions remove most fat sources.",
      );
      recommendations.push(
        "Consider a different build with a less aggressive fat target.",
      );
      recommendations.push(
        "If the client insists on strict diet + Shred, plan for ±20% per-meal drift as the normal case.",
      );
    } else if (input.targets.sodiumCapMg < 2000 && maxAchievable.sodium > input.targets.sodiumCapMg * SODIUM_CAP_FACTOR) {
      bindingConstraint = `Sodium ceiling ${input.targets.sodiumCapMg}mg infeasible — even minimum portions of selected ingredients would exceed cap × ${SODIUM_CAP_FACTOR}.`;
      failedConstraint = "sodium_cap";
      recommendations.push("Replace high-Na slugs (cured meats, sauces) at LLM-pick stage.");
      recommendations.push("Confirm sodium cap with the medical context — HBP is 1800, kidney 2000.");
      recommendations.push("Check stimulant flag — if active, base cap drops to 2000.");
    } else {
      bindingConstraint = `No single constraint dominates — the macro band combinations are individually feasible but jointly tight after ±${lastFailure.level}% widening.`;
      failedConstraint = "joint_band_tightness";
      recommendations.push(
        "Re-pick ingredient slugs at the LLM stage with more variety.",
      );
      recommendations.push(
        "Allow planComplexity to step up (intermediate → advanced) for more solver flexibility.",
      );
      recommendations.push(
        "Switch the build's distribution template (e.g. 3-meal → 4-meal) to spread macros more evenly.",
      );
    }
  }

  return {
    type: "INFEASIBLE",
    binding_constraint: bindingConstraint,
    recommendations: recommendations.slice(0, 3),
    solver_diagnostics: {
      fallback_level_reached: lastFailure.level,
      failed_constraint: failedConstraint,
      slot_index: slotIndex,
    },
  };
}
// ============================================================================
// Helpers
// ============================================================================

function validateInput(input: SolveDayInput): void {
  if (input.slots.length === 0) {
    throw new Error("solveDay: input.slots must be non-empty.");
  }
  if (input.slots.length !== input.distribution.slots.length) {
    throw new Error(
      `solveDay: input.slots.length (${input.slots.length}) does not match distribution.slots.length (${input.distribution.slots.length}).`,
    );
  }
  for (const slot of input.slots) {
    if (slot.ingredients.length === 0) {
      throw new Error(
        `solveDay: slot ${slot.index} has no ingredients — LLM (or fixture) must pick at least one.`,
      );
    }
  }
}

function roundGrams(x: number): number {
  // Below the zero detection threshold, force to 0 so the output is clean.
  if (x < ZERO_DETECTION_THRESHOLD_G) return 0;
  return Math.round(x);
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function glpkStatusName(glpk: any, status: number): string {
  if (status === glpk.GLP_OPT) return "OPT";
  if (status === glpk.GLP_FEAS) return "FEAS";
  if (status === glpk.GLP_INFEAS) return "INFEAS";
  if (status === glpk.GLP_NOFEAS) return "NOFEAS";
  if (status === glpk.GLP_UNBND) return "UNBND";
  if (status === glpk.GLP_UNDEF) return "UNDEF";
  return `UNKNOWN(${status})`;
}
