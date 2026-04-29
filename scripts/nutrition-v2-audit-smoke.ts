#!/usr/bin/env node
/**
 * Phase B4 — audit smoke tests.
 *
 * Each test fabricates a synthetic WeekPlanSuccess (no picker, no solver
 * runs) that triggers a specific check, runs auditWeekPlan, and asserts
 * the expected blocking_errors / warnings / action.
 *
 * Run: ./node_modules/.bin/tsx scripts/nutrition-v2-audit-smoke.ts
 */

import { ALL_BUILDS } from "../src/lib/nutrition/v2/builds";
import { ALL_DISTRIBUTIONS } from "../src/lib/nutrition/v2/distributions";
import {
  AllergyFlag,
  BuildType,
  DietaryStyle,
  DistributionTemplateId,
  MealSlotKind,
  MedicalFlag,
  type MealDistribution,
} from "../src/lib/nutrition/v2/types";
import {
  _seedIngredientCache,
  _clearIngredientCache,
  type IngredientNutrition,
  type SolveDaySuccess,
} from "../src/lib/nutrition/v2/solver";
import {
  auditWeekPlan,
  type ClientProfile,
} from "../src/lib/nutrition/v2/audit";
import type { WeekPlanSuccess, DayPick } from "../src/lib/nutrition/v2/picker";
import type { MacroTargets } from "../src/lib/nutrition/macro-calculator";

// ===========================================================================
// Hermetic ingredient nutrition (subset relevant to audit tests)
// ===========================================================================

const NUTRITION_FIXTURE: IngredientNutrition[] = [
  { slug: "chicken_breast_cooked_skinless", category: "protein", calories_per_100g: 165, protein_g_per_100g: 31.0, carbs_g_per_100g: 0, fat_g_per_100g: 3.6, sodium_mg_per_100g: 65.75 },
  { slug: "salmon_atlantic_cooked", category: "seafood", calories_per_100g: 206, protein_g_per_100g: 22.0, carbs_g_per_100g: 0, fat_g_per_100g: 12.4, sodium_mg_per_100g: 49.49 },
  { slug: "ground_turkey_cooked_93", category: "protein", calories_per_100g: 176, protein_g_per_100g: 27.4, carbs_g_per_100g: 0, fat_g_per_100g: 6.9, sodium_mg_per_100g: 80.18 },
  { slug: "egg_whole_boiled", category: "protein", calories_per_100g: 155, protein_g_per_100g: 12.6, carbs_g_per_100g: 1.1, fat_g_per_100g: 10.6, sodium_mg_per_100g: 48 },
  { slug: "tofu_firm", category: "protein", calories_per_100g: 73, protein_g_per_100g: 8.0, carbs_g_per_100g: 1.9, fat_g_per_100g: 4.2, sodium_mg_per_100g: 14 },
  { slug: "whey_protein_isolate", category: "supplement", calories_per_100g: 375, protein_g_per_100g: 80, carbs_g_per_100g: 7.5, fat_g_per_100g: 3.8, sodium_mg_per_100g: 372 },
  { slug: "beef_ribeye_cooked", category: "protein", calories_per_100g: 271, protein_g_per_100g: 27.0, carbs_g_per_100g: 0, fat_g_per_100g: 17.0, sodium_mg_per_100g: 60 },
  { slug: "ground_beef_cooked_80", category: "protein", calories_per_100g: 254, protein_g_per_100g: 26.0, carbs_g_per_100g: 0, fat_g_per_100g: 15.7, sodium_mg_per_100g: 54.94 },
  { slug: "oats_rolled_dry", category: "grain", calories_per_100g: 379, protein_g_per_100g: 13.5, carbs_g_per_100g: 68.7, fat_g_per_100g: 5.89, sodium_mg_per_100g: 0.7 },
  { slug: "brown_rice_cooked", category: "grain", calories_per_100g: 123, protein_g_per_100g: 2.7, carbs_g_per_100g: 25.6, fat_g_per_100g: 1.0, sodium_mg_per_100g: 0 },
  { slug: "white_rice_cooked", category: "grain", calories_per_100g: 130, protein_g_per_100g: 2.7, carbs_g_per_100g: 28.2, fat_g_per_100g: 0.3, sodium_mg_per_100g: 0.5 },
  { slug: "sweet_potato_baked", category: "carb", calories_per_100g: 90, protein_g_per_100g: 2.01, carbs_g_per_100g: 20.7, fat_g_per_100g: 0.15, sodium_mg_per_100g: 246 },
  { slug: "broccoli_steamed", category: "vegetable", calories_per_100g: 35, protein_g_per_100g: 2.38, carbs_g_per_100g: 7.18, fat_g_per_100g: 0.41, sodium_mg_per_100g: 262 },
  { slug: "spinach_cooked", category: "vegetable", calories_per_100g: 23, protein_g_per_100g: 2.97, carbs_g_per_100g: 3.75, fat_g_per_100g: 0.26, sodium_mg_per_100g: 306 },
  { slug: "olive_oil", category: "fat", calories_per_100g: 884, protein_g_per_100g: 0, carbs_g_per_100g: 0, fat_g_per_100g: 100, sodium_mg_per_100g: 2 },
  { slug: "almonds_raw", category: "fat", calories_per_100g: 579, protein_g_per_100g: 21.2, carbs_g_per_100g: 21.6, fat_g_per_100g: 49.9, sodium_mg_per_100g: 0 },
  { slug: "blueberries_raw", category: "fruit", calories_per_100g: 57, protein_g_per_100g: 0.7, carbs_g_per_100g: 14.6, fat_g_per_100g: 0.3, sodium_mg_per_100g: 0 },
  { slug: "banana_raw", category: "fruit", calories_per_100g: 89, protein_g_per_100g: 1.1, carbs_g_per_100g: 22.8, fat_g_per_100g: 0.3, sodium_mg_per_100g: 0 },
  { slug: "honey", category: "condiment", calories_per_100g: 304, protein_g_per_100g: 0.3, carbs_g_per_100g: 82.4, fat_g_per_100g: 0, sodium_mg_per_100g: 4 },
  // High-Na ingredients for sodium overflow test
  { slug: "soy_sauce", category: "condiment", calories_per_100g: 60, protein_g_per_100g: 8, carbs_g_per_100g: 6, fat_g_per_100g: 0, sodium_mg_per_100g: 5500 },
  { slug: "bacon_cooked", category: "protein", calories_per_100g: 541, protein_g_per_100g: 37, carbs_g_per_100g: 1.4, fat_g_per_100g: 42, sodium_mg_per_100g: 1717 },
  // Allergen for test 2
  { slug: "peanuts_raw", category: "fat", calories_per_100g: 567, protein_g_per_100g: 26, carbs_g_per_100g: 16, fat_g_per_100g: 49, sodium_mg_per_100g: 18 },
  // Extra proteins for clean-plan rotation (so frequency caps don't trip)
  { slug: "beef_sirloin_cooked", category: "protein", calories_per_100g: 183, protein_g_per_100g: 29.0, carbs_g_per_100g: 0, fat_g_per_100g: 6.4, sodium_mg_per_100g: 42.85 },
  { slug: "cod_cooked", category: "seafood", calories_per_100g: 105, protein_g_per_100g: 22.8, carbs_g_per_100g: 0, fat_g_per_100g: 0.9, sodium_mg_per_100g: 298.8 },
  { slug: "ground_beef_cooked_90", category: "protein", calories_per_100g: 217, protein_g_per_100g: 26.0, carbs_g_per_100g: 0, fat_g_per_100g: 11.9, sodium_mg_per_100g: 61.64 },
  { slug: "pork_loin_cooked", category: "protein", calories_per_100g: 239, protein_g_per_100g: 27.3, carbs_g_per_100g: 0, fat_g_per_100g: 13.6, sodium_mg_per_100g: 40.2 },
  { slug: "salmon_sockeye_cooked", category: "seafood", calories_per_100g: 184, protein_g_per_100g: 22.6, carbs_g_per_100g: 0, fat_g_per_100g: 9.3, sodium_mg_per_100g: 53.3 },
  { slug: "tilapia_cooked", category: "seafood", calories_per_100g: 128, protein_g_per_100g: 26.2, carbs_g_per_100g: 0, fat_g_per_100g: 2.7, sodium_mg_per_100g: 93.66 },
  { slug: "tuna_canned_water", category: "seafood", calories_per_100g: 116, protein_g_per_100g: 26.5, carbs_g_per_100g: 0, fat_g_per_100g: 0.8, sodium_mg_per_100g: 219 },
  // Phase B6a-pivot: clean-plan now rotates 2 non-whey breakfasts (eggs, yogurt)
  // so whey appears as anchor only 5×/week (at the new supplement-anchor cap).
  { slug: "greek_yogurt_nonfat_plain", category: "dairy", calories_per_100g: 59, protein_g_per_100g: 10.3, carbs_g_per_100g: 3.6, fat_g_per_100g: 0.4, sodium_mg_per_100g: 36 },
];

const KNOWN_SLUGS = new Set(NUTRITION_FIXTURE.map((n) => n.slug));

// ===========================================================================
// Helpers
// ===========================================================================

const MOCK_TARGETS: MacroTargets = {
  calories: 2640,
  proteinG: 199,
  carbsG: 263,
  fatG: 88,
  bmr: 1800,
  tdee: 2790,
  activityFactor: 1.55,
  goal: "recomp",
  proteinPerKg: 2.4,
  proteinPerLb: 1.1,
  sodiumCapMg: 2300,
  notes: [],
};

function makeSolveDaySuccess(args: {
  slots: Array<{ index: number; ingredients: Array<{ slug: string; grams: number }> }>;
  daily?: { calories: number; protein_g: number; carbs_g: number; fat_g: number; sodium_mg: number };
  perSlot?: Array<{ slot_index: number; protein_g: number; carbs_g: number; fat_g: number; calories: number; sodium_mg: number }>;
  fallbackLevel?: 10 | 15 | 20;
  zeroedSlugs?: Array<{ slot_index: number; slug: string; anchor: boolean }>;
}): SolveDaySuccess {
  // Auto-compute daily/per-slot if not provided, using NUTRITION_FIXTURE
  const map = new Map(NUTRITION_FIXTURE.map((n) => [n.slug, n]));
  const computedPerSlot = args.slots.map((slot) => {
    let p = 0, c = 0, f = 0, na = 0;
    for (const ing of slot.ingredients) {
      const nut = map.get(ing.slug);
      if (!nut) continue;
      p += (ing.grams * nut.protein_g_per_100g) / 100;
      c += (ing.grams * nut.carbs_g_per_100g) / 100;
      f += (ing.grams * nut.fat_g_per_100g) / 100;
      na += (ing.grams * nut.sodium_mg_per_100g) / 100;
    }
    return {
      slot_index: slot.index,
      protein_g: Math.round(p * 10) / 10,
      carbs_g: Math.round(c * 10) / 10,
      fat_g: Math.round(f * 10) / 10,
      calories: Math.round((p * 4 + c * 4 + f * 9) * 10) / 10,
      sodium_mg: Math.round(na * 10) / 10,
    };
  });
  const perSlot = args.perSlot ?? computedPerSlot;
  const daily = args.daily ?? {
    calories: perSlot.reduce((s, x) => s + x.calories, 0),
    protein_g: perSlot.reduce((s, x) => s + x.protein_g, 0),
    carbs_g: perSlot.reduce((s, x) => s + x.carbs_g, 0),
    fat_g: perSlot.reduce((s, x) => s + x.fat_g, 0),
    sodium_mg: perSlot.reduce((s, x) => s + x.sodium_mg, 0),
  };

  return {
    status: "SUCCESS",
    slots: args.slots.map((s) => ({
      index: s.index,
      ingredients: s.ingredients,
    })),
    diagnostics: {
      fallback_level: args.fallbackLevel ?? 10,
      zeroed_slugs: args.zeroedSlugs ?? [],
      daily,
      per_slot: perSlot,
      objective_value: 0,
      bias: "neutral" as never,
      solve_time_ms: 0,
    },
  };
}

function makeDayPick(day: number, slots: Array<{ index: number; ingredients: Array<{ slug: string; isAnchor?: boolean }> }>): DayPick {
  return {
    day,
    day_kind: "training",
    slots: slots.map((s) => ({
      index: s.index,
      ingredients: s.ingredients.map((i) => ({ slug: i.slug, isAnchor: !!i.isAnchor })),
    })),
    llm_calls_used: 1,
    retried: false,
  };
}

function makeWeekPlan(args: {
  daySlots: Array<Array<{ index: number; ingredients: Array<{ slug: string; grams: number; isAnchor?: boolean }> }>>;
  distribution?: MealDistribution;
  targets?: MacroTargets;
}): WeekPlanSuccess {
  const distribution = args.distribution ?? ALL_DISTRIBUTIONS[DistributionTemplateId.STANDARD_3_MEAL];
  const targets = args.targets ?? MOCK_TARGETS;
  const days = args.daySlots.map((slots, i) => {
    const day = i + 1;
    return {
      day,
      day_kind: "training" as const,
      pick: makeDayPick(day, slots),
      solve: makeSolveDaySuccess({ slots: slots.map((s) => ({ index: s.index, ingredients: s.ingredients.map((ing) => ({ slug: ing.slug, grams: ing.grams })) })) }),
      targets,
      distribution,
    };
  });
  return {
    status: "SUCCESS",
    days,
    diagnostics: {
      per_day: [],
      total_llm_calls: 0,
      total_wall_clock_ms: 0,
      days_with_reprompts: 0,
      days_with_solver_fallback: 0,
      days_infeasible: 0,
    },
  };
}

const DEFAULT_RECOMP_PROFILE: ClientProfile = {
  buildType: BuildType.RECOMP,
  buildSpec: ALL_BUILDS[BuildType.RECOMP],
  allergyFlags: [],
  medicalFlags: [],
  dietaryStyle: null,
  sodiumCapMg: 2300,
  distributionTemplate: DistributionTemplateId.STANDARD_3_MEAL,
};

// Standard "good" 7-day plan with anchor rotation respecting the new
// Phase B6a-pivot anchor-variety rule:
//   Slot 1 (BF): whey × 5 (at the supplement combined cap of 5)
//                + eggs × 1 + greek_yogurt × 1 (each ≤ 3 whole-food cap)
//   Slot 2 (L) : chicken×3, ground_turkey×2, beef_sirloin×2  → all ≤ 3 cap
//   Slot 3 (D) : salmon_atlantic×2, salmon_sockeye×2, cod×1, tilapia×1, pork_loin×1
function buildCleanPlanSlots() {
  // Days 1-5 = whey BF anchor (5 = combined supplement cap).
  // Day 6 = egg_whole_boiled BF anchor (whole-food, 1 ≤ 3).
  // Day 7 = greek_yogurt_nonfat_plain BF anchor (whole-food, 1 ≤ 3).
  const slot1Anchors: Array<{
    anchor: string;
    grams: number;
    extras?: Array<{ slug: string; grams: number; isAnchor?: boolean }>;
  }> = [
    { anchor: "whey_protein_isolate", grams: 30 },
    { anchor: "whey_protein_isolate", grams: 30 },
    { anchor: "whey_protein_isolate", grams: 30 },
    { anchor: "whey_protein_isolate", grams: 30 },
    { anchor: "whey_protein_isolate", grams: 30 },
    // Day 6: egg anchor + whey secondary (per breakfast composition rule —
    // low-density anchors include whey to absorb the residual protein gap).
    {
      anchor: "egg_whole_boiled",
      grams: 200,
      extras: [{ slug: "whey_protein_isolate", grams: 20 }],
    },
    // Day 7: yogurt anchor + whey secondary.
    {
      anchor: "greek_yogurt_nonfat_plain",
      grams: 200,
      extras: [{ slug: "whey_protein_isolate", grams: 20 }],
    },
  ];
  const slot2Anchors = [
    "chicken_breast_cooked_skinless", "ground_turkey_cooked_93",
    "chicken_breast_cooked_skinless", "beef_sirloin_cooked",
    "ground_turkey_cooked_93", "chicken_breast_cooked_skinless",
    "beef_sirloin_cooked",
  ];
  const slot3Anchors = [
    "salmon_atlantic_cooked", "salmon_sockeye_cooked",
    "cod_cooked", "salmon_atlantic_cooked",
    "tilapia_cooked", "salmon_sockeye_cooked",
    "pork_loin_cooked",
  ];
  return slot2Anchors.map((s2anchor, i) => {
    const bf = slot1Anchors[i];
    const slot1Ings: Array<{ slug: string; grams: number; isAnchor?: boolean }> = [
      { slug: bf.anchor, grams: bf.grams, isAnchor: true },
      ...(bf.extras ?? []),
      { slug: "oats_rolled_dry", grams: 90, isAnchor: false },
      { slug: "blueberries_raw", grams: 100, isAnchor: false },
      { slug: "olive_oil", grams: 10, isAnchor: false },
    ];
    return [
      { index: 1, ingredients: slot1Ings },
      { index: 2, ingredients: [
        { slug: s2anchor, grams: 220, isAnchor: true },
        { slug: "brown_rice_cooked", grams: 300, isAnchor: false },
        { slug: "broccoli_steamed", grams: 100, isAnchor: false },
        { slug: "olive_oil", grams: 10, isAnchor: false },
      ]},
      { index: 3, ingredients: [
        { slug: slot3Anchors[i], grams: 280, isAnchor: true },
        { slug: "sweet_potato_baked", grams: 300, isAnchor: false },
        { slug: "spinach_cooked", grams: 100, isAnchor: false }, // 100g — keeps day 3 cod under HBP-friendly Na ceiling
        { slug: "almonds_raw", grams: 20, isAnchor: false },
      ]},
    ];
  });
}

// ===========================================================================
// Test runners
// ===========================================================================

interface FailureRecord {
  test: string;
  message: string;
}
const failures: FailureRecord[] = [];

function ok(condition: boolean, test: string, message: string): void {
  if (!condition) {
    failures.push({ test, message });
    console.log(`    ✗ ${message}`);
  } else {
    console.log(`    ✓ ${message}`);
  }
}

// ---- Test 1 — Clean plan ---------------------------------------------------

async function test1Clean(): Promise<void> {
  console.log("\n=== Test 1: Clean plan — passes all 8 checks ===");
  const plan = makeWeekPlan({ daySlots: buildCleanPlanSlots() });
  const result = await auditWeekPlan(plan, DEFAULT_RECOMP_PROFILE);
  ok(result.pass === true, "Test 1", `pass=true (got ${result.pass})`);
  ok(result.action === "PROCEED_TO_PDF_RENDER", "Test 1", `action=PROCEED (got ${result.action})`);
  ok(result.blocking_errors.length === 0, "Test 1", `0 blocking errors (got ${result.blocking_errors.length})`);
  console.log(`    perf: ${result.performance_ms}ms; warnings: ${result.warnings.length}`);
}

// ---- Test 2 — Allergen smuggle ---------------------------------------------

async function test2Allergen(): Promise<void> {
  console.log("\n=== Test 2: Allergen smuggle — peanuts on peanut-allergic ===");
  const slots = buildCleanPlanSlots();
  // Smuggle peanuts into day 3 slot 1
  slots[2][0].ingredients.push({ slug: "peanuts_raw", grams: 30, isAnchor: false });
  const plan = makeWeekPlan({ daySlots: slots });
  const profile: ClientProfile = {
    ...DEFAULT_RECOMP_PROFILE,
    allergyFlags: [AllergyFlag.PEANUTS],
  };
  const result = await auditWeekPlan(plan, profile);
  ok(result.pass === false, "Test 2", `pass=false (got ${result.pass})`);
  const block = result.blocking_errors.find((e) => e.check === "hard_exclude_violation" && e.ingredient === "peanuts_raw");
  ok(block !== undefined, "Test 2", `hard_exclude_violation fired for peanuts_raw`);
  ok(block?.day === 3 && block?.meal === 1, "Test 2", `correct day/meal location`);
}

// ---- Test 3 — Sodium overflow ---------------------------------------------

async function test3Sodium(): Promise<void> {
  console.log("\n=== Test 3: Sodium overflow — 3000mg/day on HBP client (cap 1800) ===");
  const slots = buildCleanPlanSlots();
  // Add high-sodium soy sauce to every day's slot 2 to push past cap
  for (const day of slots) {
    day[1].ingredients.push({ slug: "soy_sauce", grams: 60, isAnchor: false }); // ~3300mg Na alone
  }
  const plan = makeWeekPlan({ daySlots: slots });
  const profile: ClientProfile = {
    ...DEFAULT_RECOMP_PROFILE,
    medicalFlags: [MedicalFlag.HBP],
    sodiumCapMg: 1800, // HBP cap
  };
  const result = await auditWeekPlan(plan, profile);
  // B6a-pivot Option 4: sodium_ceiling_exceeded demoted from BLOCK to WARN.
  // Plan ships even with sodium overflow; coach handoff prompt surfaces the breach.
  const sodiumWarns = result.warnings.filter((e) => e.check === "sodium_ceiling_exceeded");
  ok(sodiumWarns.length === 7, "Test 3", `7 sodium WARN findings (got ${sodiumWarns.length})`);
  ok(result.blocking_errors.filter((e) => e.check === "sodium_ceiling_exceeded").length === 0, "Test 3", `sodium no longer BLOCKs`);
  if (sodiumWarns.length > 0) {
    const first = sodiumWarns[0].details as { actual_mg: number; ceiling_mg: number };
    console.log(`    sample WARN: day ${sodiumWarns[0].day}: ${first.actual_mg}mg > ${first.ceiling_mg}mg`);
  }
}

// ---- Test 4 — Tier distribution failure ----------------------------------

async function test4TierFailure(): Promise<void> {
  console.log("\n=== Test 4: Tier distribution — Recomp with mostly tier-2 protein anchors ===");
  // Recomp tier_1_protein_min_pct = 0.70. With 21 protein-anchored slots,
  // need ≥ ceil(21 × 0.70) = 15. We'll make 10 tier-1 anchored.
  const tier1Anchor = "chicken_breast_cooked_skinless"; // tier 1 in recomp
  const tier2Anchor = "ground_beef_cooked_80"; // tier 2 in recomp
  const slots: Array<Array<{ index: number; ingredients: Array<{ slug: string; grams: number; isAnchor?: boolean }> }>> = [];
  // 21 protein-anchored slots = 7 days × 3 slots. We make 10 use tier-1, 11 use tier-2.
  let tier1Count = 0;
  for (let day = 0; day < 7; day++) {
    const dayslots: Array<{ index: number; ingredients: Array<{ slug: string; grams: number; isAnchor?: boolean }> }> = [];
    for (let slotIdx = 1; slotIdx <= 3; slotIdx++) {
      const useTier1 = tier1Count < 10;
      const anchor = useTier1 ? tier1Anchor : tier2Anchor;
      if (useTier1) tier1Count++;
      dayslots.push({
        index: slotIdx,
        ingredients: [
          { slug: anchor, grams: 200, isAnchor: true },
          { slug: "brown_rice_cooked", grams: 300 },
          { slug: "broccoli_steamed", grams: 100 },
          { slug: "olive_oil", grams: 10 },
        ],
      });
    }
    slots.push(dayslots);
  }
  const plan = makeWeekPlan({ daySlots: slots });
  const result = await auditWeekPlan(plan, DEFAULT_RECOMP_PROFILE);
  // B6a-pivot Option 4: tier_1_protein_below_min demoted to WARN.
  const proteinWarn = result.warnings.find((e) => e.check === "tier_1_protein_below_min");
  ok(proteinWarn !== undefined, "Test 4", `tier_1_protein_below_min fired as WARN`);
  ok(result.blocking_errors.find((e) => e.check === "tier_1_protein_below_min") === undefined, "Test 4", `tier_1_protein_below_min no longer BLOCKs`);
  if (proteinWarn) {
    const d = proteinWarn.details as { tier_1_count: number; required: number; total_anchored: number };
    console.log(`    counts: ${d.tier_1_count} tier-1 of ${d.total_anchored} anchored (required ${d.required})`);
    ok(d.tier_1_count === 10 && d.total_anchored === 21 && d.required === 15, "Test 4", `expected 10/21 tier-1 with 15 required`);
  }
}

// ---- Test 5 — Frequency cap ----------------------------------------------

async function test5FrequencyCap(): Promise<void> {
  console.log("\n=== Test 5: Frequency cap — chicken 4× exceeds Recomp's 3/wk cap ===");
  const slots = buildCleanPlanSlots();
  // Rotation puts chicken at 3× — at cap. Override day 7 slot 2 to chicken
  // (was beef_sirloin) to push chicken to 4× and trip the cap.
  const day7slot2 = slots[6][1];
  const anchorIng = day7slot2.ingredients.find((i) => i.isAnchor);
  if (anchorIng) anchorIng.slug = "chicken_breast_cooked_skinless";
  const plan = makeWeekPlan({ daySlots: slots });
  const result = await auditWeekPlan(plan, DEFAULT_RECOMP_PROFILE);
  // B6a-pivot Option 4: frequency_cap_exceeded demoted to WARN.
  const freqWarn = result.warnings.find((e) => e.check === "frequency_cap_exceeded" && e.ingredient === "chicken_breast_cooked_skinless");
  ok(freqWarn !== undefined, "Test 5", `frequency_cap_exceeded fired for chicken as WARN`);
  ok(result.blocking_errors.find((e) => e.check === "frequency_cap_exceeded") === undefined, "Test 5", `frequency_cap_exceeded no longer BLOCKs`);
  if (freqWarn) {
    const d = freqWarn.details as { actual_uses: number; cap: number };
    console.log(`    chicken used ${d.actual_uses}/${d.cap}× per week`);
    ok(d.actual_uses === 4 && d.cap === 3, "Test 5", `4× usage vs 3 cap`);
  }
}

// ---- Test 6 — Build/medical conflict --------------------------------------

async function test6BuildMedical(): Promise<void> {
  console.log("\n=== Test 6: Shred + pregnant_nursing — Check 7 BLOCK before others ===");
  const slots = buildCleanPlanSlots();
  const plan = makeWeekPlan({ daySlots: slots });
  const profile: ClientProfile = {
    buildType: BuildType.SHRED,
    buildSpec: ALL_BUILDS[BuildType.SHRED],
    allergyFlags: [],
    medicalFlags: [MedicalFlag.PREGNANT_NURSING],
    dietaryStyle: null,
    sodiumCapMg: 2300,
    distributionTemplate: DistributionTemplateId.STANDARD_3_MEAL,
  };
  const result = await auditWeekPlan(plan, profile);
  ok(result.pass === false, "Test 6", `pass=false`);
  const buildBlock = result.blocking_errors.find((e) => e.check === "build_medical_block");
  ok(buildBlock !== undefined, "Test 6", `build_medical_block fired`);
  // Verify early-exit: should ONLY have the build_medical_block, not other checks
  ok(result.blocking_errors.length === 1, "Test 6", `only 1 blocking error (got ${result.blocking_errors.length}) — early exit fired`);
}

// ---- Test 7 — Custom distribution invalid sum -----------------------------

async function test7CustomDist(): Promise<void> {
  console.log("\n=== Test 7: Custom distribution — carbs sum to 95% (5% short) ===");
  const slots = buildCleanPlanSlots();
  const plan = makeWeekPlan({ daySlots: slots });
  const customDist: MealDistribution = {
    id: DistributionTemplateId.STANDARD_3_MEAL,
    label: "Custom 3 Meals",
    description: "Test custom distribution",
    meals_per_day: 3,
    day_kind: "any",
    slots: [
      { index: 1, label: "BF", kind: MealSlotKind.BREAKFAST, protein_pct: 25, carb_pct: 20, fat_pct: 20 }, // carbs short
      { index: 2, label: "L", kind: MealSlotKind.LUNCH, protein_pct: 35, carb_pct: 35, fat_pct: 35 },
      { index: 3, label: "D", kind: MealSlotKind.DINNER, protein_pct: 40, carb_pct: 40, fat_pct: 45 },
      // carbs total = 20+35+40 = 95
    ],
  };
  const profile: ClientProfile = {
    ...DEFAULT_RECOMP_PROFILE,
    customDistribution: customDist,
  };
  const result = await auditWeekPlan(plan, profile);
  ok(result.pass === false, "Test 7", `pass=false`);
  const distBlock = result.blocking_errors.find((e) => e.check === "custom_distribution_invalid_sum");
  ok(distBlock !== undefined, "Test 7", `custom_distribution_invalid_sum fired`);
  if (distBlock) {
    const d = distBlock.details as { macro: string; actual_sum: number };
    console.log(`    ${d.macro} sum: ${d.actual_sum}%`);
    ok(d.macro === "carbs" && Math.abs(d.actual_sum - 95) < 0.01, "Test 7", `carbs sum = 95%`);
  }
}

// ---- Test 8 — Multiple warnings, no blocks --------------------------------

async function test8WarningsOnly(): Promise<void> {
  console.log("\n=== Test 8: Warnings only — daily protein +12%, per-meal +18% ===");
  const slots = buildCleanPlanSlots();
  // Bump day 1 protein well above target (target P=199, push to ~225 = +13%)
  // by adding extra chicken to slot 2
  slots[0][1].ingredients.find((i) => i.slug === "chicken_breast_cooked_skinless")!.grams = 280;
  // Add a per-meal +18% drift on day 5 slot 1
  slots[4][0].ingredients.find((i) => i.slug === "whey_protein_isolate")!.grams = 60;

  const plan = makeWeekPlan({ daySlots: slots });
  const result = await auditWeekPlan(plan, DEFAULT_RECOMP_PROFILE);
  ok(result.pass === true, "Test 8", `pass=true (warnings don't block)`);
  ok(result.action === "PROCEED_TO_PDF_RENDER", "Test 8", `action=PROCEED`);
  ok(result.warnings.length > 0, "Test 8", `warnings populated (got ${result.warnings.length})`);
  console.log(`    warnings (${result.warnings.length}):`);
  for (const w of result.warnings.slice(0, 5)) {
    console.log(`      ${w.check} day=${w.day} meal=${w.meal ?? "—"}: ${w.reason}`);
  }
}

// ---- Test 9 — Snack with protein < 15g excluded from denominator ----------

async function test9LowProteinSnack(): Promise<void> {
  console.log("\n=== Test 9: Snack slot with <15g protein excluded from denominator ===");
  // Build a day with one "real" protein-anchored slot and one snack slot
  // (blueberries + honey, total P ≈ 0.7g + 0.3g = 1g, well below 15g).
  // Verify the snack does NOT count toward the protein-anchored total.
  const slots: Array<{ index: number; ingredients: Array<{ slug: string; grams: number; isAnchor?: boolean }> }> = [
    { index: 1, ingredients: [
      { slug: "chicken_breast_cooked_skinless", grams: 300, isAnchor: true }, // ~93g P
      { slug: "brown_rice_cooked", grams: 300 },
      { slug: "broccoli_steamed", grams: 100 },
    ]},
    { index: 2, ingredients: [
      { slug: "blueberries_raw", grams: 100, isAnchor: true }, // 0.7g P
      { slug: "honey", grams: 30 }, // 0.09g P
    ]},
    { index: 3, ingredients: [
      { slug: "salmon_atlantic_cooked", grams: 250, isAnchor: true },
      { slug: "sweet_potato_baked", grams: 300 },
    ]},
  ];
  const days = Array.from({ length: 7 }, () => slots);
  const plan = makeWeekPlan({ daySlots: days });
  const result = await auditWeekPlan(plan, DEFAULT_RECOMP_PROFILE);
  // We don't assert pass/fail here — we drill into the tier-distribution math.
  // The snack slot 2 should be EXCLUDED from protein-anchored count.
  // 7 days × 2 protein-anchored slots (slot 1, slot 3) = 14 anchored slots.
  // Both anchors (chicken + salmon) are tier 1. → 14/14 → 100% pass.
  // If snack was incorrectly included as anchored, it would be 14/21 = 67%, BLOCK.
  const proteinBlock = result.blocking_errors.find((e) => e.check === "tier_1_protein_below_min");
  ok(proteinBlock === undefined, "Test 9", `no tier_1_protein_below_min — snack correctly excluded`);
  // Check carb side too: salmon slot has no carb anchor since SP gives major carbs
  // chicken slot has rice as carb anchor (tier 1)
  // snack: blueberries 14.6g → carb-anchored (≥10g)! highest-carb is honey (24.7g) — let me check
  // honey 30g × 82.4/100 = 24.72g C. blueberries 100g × 14.6/100 = 14.6g C. Honey wins.
  // honey is NOT in recomp tier_1 — so this would fail tier-1-carb if all 21 carb-anchored.
  // But we only have 21 carb-anchored slots (every slot in this test has ≥10g carbs).
  // Actually slot 1 (chicken+rice+broccoli): rice 300g × 25.6 = 76.8g C. anchor=rice (tier 1).
  // slot 2 snack: anchor=honey (NOT tier 1). 7 days × 1 honey-anchor = 7 non-tier-1 carb anchors.
  // slot 3 (salmon+sweet potato): anchor=sweet_potato (tier 1).
  // Total carb-anchored: 21. Tier 1: 14. Required: ceil(21 × 0.80) = 17. 14 < 17 → BLOCK.
  // This is fine — the test is designed to verify the protein side; the carb block is expected here.
  console.log(`    blocking errors (${result.blocking_errors.length}): ${result.blocking_errors.map((e) => e.check).join(", ")}`);
}

// ---- Test 10 — Egg + chicken slot, chicken wins protein anchor ------------

async function test10EggChickenAnchor(): Promise<void> {
  console.log("\n=== Test 10: Egg + chicken slot — chicken is protein anchor (higher absolute) ===");
  // Slot with eggs (12.6g P/100g) and chicken (31g P/100g):
  // If chicken 200g and eggs 100g: chicken P = 62g, eggs P = 12.6g. Chicken wins.
  // Verify chicken is identified as the tier 1 protein anchor.
  const slots: Array<{ index: number; ingredients: Array<{ slug: string; grams: number; isAnchor?: boolean }> }> = [
    { index: 1, ingredients: [
      { slug: "egg_whole_boiled", grams: 100 }, // 12.6g P
      { slug: "chicken_breast_cooked_skinless", grams: 200, isAnchor: true }, // 62g P
      { slug: "brown_rice_cooked", grams: 300 },
    ]},
    { index: 2, ingredients: [
      { slug: "chicken_breast_cooked_skinless", grams: 200, isAnchor: true },
      { slug: "brown_rice_cooked", grams: 300 },
      { slug: "broccoli_steamed", grams: 100 },
    ]},
    { index: 3, ingredients: [
      { slug: "salmon_atlantic_cooked", grams: 250, isAnchor: true },
      { slug: "sweet_potato_baked", grams: 300 },
    ]},
  ];
  const days = Array.from({ length: 7 }, () => slots);
  const plan = makeWeekPlan({ daySlots: days });

  // Use the anchor classifier directly to verify which slug is detected as anchor
  const { classifySlotAnchors } = await import("../src/lib/nutrition/v2/audit/anchor-detection");
  const slot1 = plan.days[0].solve.slots[0];
  const nutMap = new Map(NUTRITION_FIXTURE.map((n) => [n.slug, n]));
  const cls = classifySlotAnchors(slot1, nutMap, ALL_BUILDS[BuildType.RECOMP]);
  ok(cls.is_protein_anchored, "Test 10", "slot 1 IS protein-anchored");
  ok(cls.protein_anchor_slug === "chicken_breast_cooked_skinless", "Test 10", `chicken (not eggs) is anchor (got '${cls.protein_anchor_slug}')`);
  ok(cls.protein_anchor_is_tier_1, "Test 10", "chicken IS tier 1 protein anchor");

  // Audit-level: chicken cap is 3/week → 7 uses will trip it. We're testing
  // anchor detection, not the cap; just sanity-check the audit runs.
  await auditWeekPlan(plan, DEFAULT_RECOMP_PROFILE);
}

// ---- Test 11 — Salmon as both highest-P and highest-fat in slot -----------

async function test11SalmonDualRole(): Promise<void> {
  console.log("\n=== Test 11: Salmon highest-P AND highest-fat — protein anchor classified independently ===");
  // Slot with salmon (22g P, 12.4g F per 100g). Salmon as highest of both.
  // No competing protein in slot. Salmon hybrid=PROTEIN_FAT in recomp tier_1.
  const slots: Array<{ index: number; ingredients: Array<{ slug: string; grams: number; isAnchor?: boolean }> }> = [
    { index: 1, ingredients: [
      { slug: "salmon_atlantic_cooked", grams: 250, isAnchor: true }, // 55g P, 31g F
      { slug: "brown_rice_cooked", grams: 100 }, // 2.7g P, 25.6g C, 1g F
      { slug: "spinach_cooked", grams: 100 }, // 2.97g P, 3.75g C, 0.26g F
    ]},
    { index: 2, ingredients: [
      { slug: "chicken_breast_cooked_skinless", grams: 200, isAnchor: true },
      { slug: "brown_rice_cooked", grams: 300 },
      { slug: "broccoli_steamed", grams: 100 },
    ]},
    { index: 3, ingredients: [
      { slug: "ground_turkey_cooked_93", grams: 200, isAnchor: true },
      { slug: "sweet_potato_baked", grams: 300 },
    ]},
  ];
  const plan = makeWeekPlan({ daySlots: Array.from({ length: 7 }, () => slots) });

  const { classifySlotAnchors } = await import("../src/lib/nutrition/v2/audit/anchor-detection");
  const slot1 = plan.days[0].solve.slots[0];
  const nutMap = new Map(NUTRITION_FIXTURE.map((n) => [n.slug, n]));
  const cls = classifySlotAnchors(slot1, nutMap, ALL_BUILDS[BuildType.RECOMP]);
  ok(cls.is_protein_anchored, "Test 11", `slot 1 protein-anchored (sum >15g)`);
  ok(cls.protein_anchor_slug === "salmon_atlantic_cooked", "Test 11", `salmon is protein anchor`);
  ok(cls.protein_anchor_is_tier_1, "Test 11", `salmon (PROTEIN_FAT hybrid in tier_1) classified as tier 1 protein anchor`);
  // Salmon as carb anchor: salmon has 0g C, so brown_rice (25.6g C) is carb anchor — not salmon. Verify no double-counting.
  ok(cls.carb_anchor_slug !== "salmon_atlantic_cooked", "Test 11", `salmon NOT classified as carb anchor (rice wins on carbs)`);

  // Run the full audit to ensure no errors thrown on dual-role hybrid
  const result = await auditWeekPlan(plan, DEFAULT_RECOMP_PROFILE);
  ok(typeof result.performance_ms === "number", "Test 11", `audit completes with hybrid-role slug, perf=${result.performance_ms}ms`);
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  _clearIngredientCache();
  _seedIngredientCache(NUTRITION_FIXTURE);

  await test1Clean();
  await test2Allergen();
  await test3Sodium();
  await test4TierFailure();
  await test5FrequencyCap();
  await test6BuildMedical();
  await test7CustomDist();
  await test8WarningsOnly();
  await test9LowProteinSnack();
  await test10EggChickenAnchor();
  await test11SalmonDualRole();

  console.log("\n" + "=".repeat(72));
  if (failures.length === 0) {
    console.log(`PASS — all assertions matched.`);
    process.exit(0);
  }
  console.log(`FAIL — ${failures.length} assertion(s):`);
  for (const f of failures) console.log(`  · [${f.test}] ${f.message}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
