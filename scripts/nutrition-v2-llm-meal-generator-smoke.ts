#!/usr/bin/env node
/**
 * Hermetic smoke for the llm-meal-generator module.
 *
 * Tests parsing + WeekPlanSuccess facade with a MockMealGeneratorClient.
 * No real Anthropic. Uses Supabase only to fetch ingredient nutrition for
 * the slugs the mock LLM produces (cached after first run).
 *
 * Cases:
 *   1. Happy path — mock returns valid 7-day plan; result is a
 *      WeekPlanSuccess shape with synthesized solve diagnostics.
 *   2. Schema violation — mock returns top-level non-object → throws.
 *   3. Slug not in approved list — invalid slug filtered, kept meals
 *      proceed; rejected_meals diagnostic populated.
 *   4. Hard-exclude leakage — slug in hard_exclude appears in mock
 *      output; that ingredient gets dropped per-meal.
 *   5. Missing anchor — mock returns meal with no is_anchor: true;
 *      parser promotes highest-grams ingredient.
 *   6. Multiple anchors — parser keeps first, demotes rest.
 *   7. Day count mismatch — mock returns 6 days → fatal.
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env.local", override: true });

import {
  generatePlan,
  MockMealGeneratorClient,
  type GeneratePlanInput,
} from "../src/lib/nutrition/v2/llm-meal-generator";
import { ALL_BUILDS } from "../src/lib/nutrition/v2/builds";
import { ALL_DISTRIBUTIONS } from "../src/lib/nutrition/v2/distributions";
import {
  AllergyFlag,
  BuildType,
  DistributionTemplateId,
} from "../src/lib/nutrition/v2/types";
import type { MacroTargets } from "../src/lib/nutrition/macro-calculator";

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

const TARGETS: { training: MacroTargets; rest: MacroTargets } = {
  training: {
    calories: 2700, proteinG: 220, carbsG: 250, fatG: 90,
    bmr: 1800, tdee: 2700, activityFactor: 1.5,
    goal: "recomp", proteinPerKg: 2.4, proteinPerLb: 1.1,
    sodiumCapMg: 2300, notes: [],
  },
  rest: {
    calories: 2500, proteinG: 220, carbsG: 200, fatG: 90,
    bmr: 1800, tdee: 2700, activityFactor: 1.5,
    goal: "recomp", proteinPerKg: 2.4, proteinPerLb: 1.1,
    sodiumCapMg: 2300, notes: [],
  },
};

const baseInput = (overrides: Partial<GeneratePlanInput> = {}): GeneratePlanInput => ({
  client_profile: {
    first_name: "Test", last_name: "Client",
    sex: "male", weight_kg: 80, height_cm: 178, age: 30,
    build_type: BuildType.RECOMP,
    dietary_style: null,
    allergy_flags: [],
    medical_flags: [],
    on_stimulant: false,
  },
  targets: TARGETS,
  build_spec: ALL_BUILDS[BuildType.RECOMP],
  distribution: ALL_DISTRIBUTIONS[DistributionTemplateId.STANDARD_3_MEAL],
  hard_exclude: new Set(),
  anthropic_api_key: "sk-mock",
  ...overrides,
});

// Build a 7-day "happy" tool_input (3 meals × 4 ingredients each)
function happyToolInput() {
  const days = [];
  const weekdays = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  for (let i = 1; i <= 7; i++) {
    days.push({
      day_number: i,
      weekday: weekdays[i - 1],
      meals: [
        {
          slot: 1, name: "Breakfast",
          dish_name: `Mock BF Day ${i}`,
          ingredients: [
            { slug: "whey_protein_isolate", grams: 35, is_anchor: true },
            { slug: "oats_rolled_dry", grams: 80, is_anchor: false },
            { slug: "blueberries_raw", grams: 100, is_anchor: false },
            { slug: "almonds_raw", grams: 25, is_anchor: false },
          ],
        },
        {
          slot: 2, name: "Lunch",
          dish_name: `Mock L Day ${i}`,
          ingredients: [
            { slug: "chicken_breast_cooked_skinless", grams: 220, is_anchor: true },
            { slug: "brown_rice_cooked", grams: 250, is_anchor: false },
            { slug: "broccoli_raw", grams: 100, is_anchor: false },
            { slug: "olive_oil", grams: 8, is_anchor: false },
          ],
        },
        {
          slot: 3, name: "Dinner",
          dish_name: `Mock D Day ${i}`,
          ingredients: [
            { slug: "salmon_atlantic_cooked", grams: 220, is_anchor: true },
            { slug: "sweet_potato_baked", grams: 280, is_anchor: false },
            { slug: "spinach_raw", grams: 100, is_anchor: false },
            { slug: "avocado_raw", grams: 60, is_anchor: false },
          ],
        },
      ],
    });
  }
  return { days };
}

async function test1Happy() {
  console.log("\n=== Test G.1: happy path — 7-day plan with synthesized diagnostics ===");
  const client = new MockMealGeneratorClient(() => ({
    tool_input: happyToolInput(),
    usage: { input_tokens: 6500, output_tokens: 3500 },
  }));
  const result = await generatePlan(baseInput({ llm_client: client }));
  ok(result.plan.status === "SUCCESS", "G.1", `plan.status=SUCCESS (got ${result.plan.status})`);
  ok(result.plan.days.length === 7, "G.1", `7 days (got ${result.plan.days.length})`);
  ok(result.plan.days.every((d) => d.solve.slots.length === 3), "G.1", "every day has 3 slots");
  ok(client.callCount === 1, "G.1", `1 LLM call (got ${client.callCount})`);
  // Synthesized solve diagnostics
  const day1 = result.plan.days[0];
  ok(day1.solve.diagnostics.daily.protein_g > 100, "G.1", `day 1 protein > 100g (got ${day1.solve.diagnostics.daily.protein_g})`);
  ok(day1.solve.diagnostics.fallback_level === 10, "G.1", "fallback_level synthesized to 10");
  // Dish names populated
  ok(day1.template_meta?.slot_dish_names[1] === "Mock BF Day 1", "G.1", "dish_name surfaces via template_meta");
  // Cost diagnostics
  ok(result.diagnostics.estimated_cost_usd > 0.05, "G.1", `cost computed (got $${result.diagnostics.estimated_cost_usd.toFixed(4)})`);
  ok(result.diagnostics.rejected_meals.length === 0, "G.1", "no rejected meals");
}

async function test2SchemaViolation() {
  console.log("\n=== Test G.2: schema violation — top-level non-object → throws ===");
  const client = new MockMealGeneratorClient(() => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tool_input: "not an object" as any,
    usage: { input_tokens: 6500, output_tokens: 50 },
  }));
  let threw = false;
  try {
    await generatePlan(baseInput({ llm_client: client }));
  } catch (e) {
    threw = true;
    ok((e as Error).message.includes("parse failed"), "G.2", `error message includes "parse failed"`);
  }
  ok(threw, "G.2", "throws on schema violation");
}

async function test3InvalidSlug() {
  console.log("\n=== Test G.3: invalid slug — filtered, kept ingredients proceed ===");
  const happy = happyToolInput();
  // Day 1 BF: replace one ingredient with an invalid slug
  happy.days[0].meals[0].ingredients[2] = { slug: "made_up_fake_slug", grams: 100, is_anchor: false };
  const client = new MockMealGeneratorClient(() => ({
    tool_input: happy,
    usage: { input_tokens: 6500, output_tokens: 3500 },
  }));
  const result = await generatePlan(baseInput({ llm_client: client }));
  ok(result.plan.status === "SUCCESS", "G.3", "plan still SUCCESS (3 valid ingredients suffice)");
  const day1bf = result.plan.days[0].solve.slots[0];
  ok(day1bf.ingredients.length === 3, "G.3", `Day 1 BF has 3 ingredients (invalid filtered, got ${day1bf.ingredients.length})`);
  ok(!day1bf.ingredients.some((i) => i.slug === "made_up_fake_slug"), "G.3", "invalid slug NOT in result");
}

async function test4HardExclude() {
  console.log("\n=== Test G.4: hard-exclude leakage — slug dropped per-meal ===");
  const happy = happyToolInput();
  // Day 2 BF: include a slug that would be in hard_exclude
  happy.days[1].meals[0].ingredients[3] = { slug: "almonds_raw", grams: 25, is_anchor: false };
  const client = new MockMealGeneratorClient(() => ({
    tool_input: happy,
    usage: { input_tokens: 6500, output_tokens: 3500 },
  }));
  const result = await generatePlan(
    baseInput({
      llm_client: client,
      hard_exclude: new Set(["almonds_raw", "walnuts_raw"]),
      client_profile: {
        ...baseInput().client_profile,
        allergy_flags: [AllergyFlag.TREE_NUTS],
      },
    }),
  );
  const day2bf = result.plan.days[1].solve.slots[0];
  ok(!day2bf.ingredients.some((i) => i.slug === "almonds_raw"), "G.4", "almonds_raw NOT in Day 2 BF after hard_exclude");
  // Should still have ≥ 3 ingredients (only 1 was dropped)
  ok(day2bf.ingredients.length >= 3, "G.4", `Day 2 BF has ≥ 3 ingredients (got ${day2bf.ingredients.length})`);
}

async function test5MissingAnchor() {
  console.log("\n=== Test G.5: missing anchor — parser promotes highest-grams ===");
  const happy = happyToolInput();
  // Day 3 BF: no anchor flagged
  for (const ing of happy.days[2].meals[0].ingredients) ing.is_anchor = false;
  const client = new MockMealGeneratorClient(() => ({
    tool_input: happy,
    usage: { input_tokens: 6500, output_tokens: 3500 },
  }));
  const result = await generatePlan(baseInput({ llm_client: client }));
  const day3bf = result.plan.days[2].pick.slots[0];
  const anchorCount = day3bf.ingredients.filter((i) => i.isAnchor).length;
  ok(anchorCount === 1, "G.5", `exactly 1 anchor (got ${anchorCount})`);
  // Highest grams was blueberries_raw at 100g (vs whey 35, oats 80, almonds 25)
  const promoted = day3bf.ingredients.find((i) => i.isAnchor);
  ok(promoted?.slug === "blueberries_raw", "G.5", `highest-grams (blueberries_raw) promoted (got ${promoted?.slug})`);
}

async function test6MultipleAnchors() {
  console.log("\n=== Test G.6: multiple anchors — keeps first, demotes rest ===");
  const happy = happyToolInput();
  // Day 4 lunch: 3 anchors flagged
  for (let i = 0; i < 3; i++) happy.days[3].meals[1].ingredients[i].is_anchor = true;
  const client = new MockMealGeneratorClient(() => ({
    tool_input: happy,
    usage: { input_tokens: 6500, output_tokens: 3500 },
  }));
  const result = await generatePlan(baseInput({ llm_client: client }));
  const day4lunch = result.plan.days[3].pick.slots[1];
  const anchorCount = day4lunch.ingredients.filter((i) => i.isAnchor).length;
  ok(anchorCount === 1, "G.6", `exactly 1 anchor after demotion (got ${anchorCount})`);
}

async function test7DayCountMismatch() {
  console.log("\n=== Test G.7: 6 days — fatal parse error ===");
  const happy = happyToolInput();
  happy.days = happy.days.slice(0, 6);
  const client = new MockMealGeneratorClient(() => ({
    tool_input: happy,
    usage: { input_tokens: 6500, output_tokens: 3000 },
  }));
  let threw = false;
  try {
    await generatePlan(baseInput({ llm_client: client }));
  } catch (e) {
    threw = true;
    ok((e as Error).message.includes("parse failed"), "G.7", "throws with parse-failed");
  }
  ok(threw, "G.7", "throws on 6-day plan");
}

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("✗ NEXT_PUBLIC_SUPABASE_URL not set — generator smoke needs Supabase to validate slugs");
    process.exit(1);
  }
  await test1Happy();
  await test2SchemaViolation();
  await test3InvalidSlug();
  await test4HardExclude();
  await test5MissingAnchor();
  await test6MultipleAnchors();
  await test7DayCountMismatch();

  console.log("\n" + "=".repeat(72));
  if (failures.length === 0) {
    console.log("PASS — all generator assertions matched.");
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
