/**
 * LLM meal generator — system prompt + user prompt builders + tool schema.
 *
 * The system prompt encodes the nutrition-template-authoring spec rules
 * (variety, four-role, sodium, dish-naming) as instructions to Claude.
 * The user prompt injects the client profile, daily macro targets, slot
 * structure, hard-exclude list, and the approved-slug table.
 *
 * The output is enforced via the `submit_plan` tool whose input_schema
 * matches the WeekPlanSuccess shape (slug+grams + dish_name + is_anchor
 * per ingredient).
 */

import type {
  GeneratePlanInput,
} from "./types";
import type { MealDistribution } from "../types";

// ---------------------------------------------------------------------------
// System prompt — spec rules encoded as authoring instructions
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are a fitness coaching meal-plan generator. You produce a 7-day weekly meal plan as structured JSON via the submit_plan tool. Each meal lists slugs (from the approved ingredient table) with gram amounts.

# CORE OUTPUT REQUIREMENTS

You MUST submit your response via the submit_plan tool. The tool input enforces the schema:
- 7 days, day_number 1 (Monday) through 7 (Sunday)
- Each day has the meal slot count specified by the client's distribution (typically 3 for Recomp/Shred/Maintain, 4 for Lean Gain, 5 for Bulk/Endurance training, 3 for Endurance rest)
- Each meal: slot index, name (matches distribution: "Breakfast", "Lunch", "Dinner", etc), dish_name (2-5 words, real food), and 4-5 ingredients
- Each ingredient: slug (from approved list), grams (integer), is_anchor (boolean — exactly ONE per slot)

# HARD RULES — failures here mean a broken plan

## Slug usage
- Use ONLY slugs from the approved table provided in the user message. Do not invent slugs.
- Honor the hard_exclude list — those slugs MUST NOT appear anywhere in the plan.
- Honor each slug's gram min-max range. Don't exceed max; don't go below min.

## Macro targeting — THE most important rule. Plans that miss here are rejected.
- Each day's total macros must land within ±10% of the day's targets:
  - Daily kcal: target ± 10%
  - Daily protein g: target ± 10%
  - Daily carbs g: target ± 10%
  - Daily fat g: target ± 10%
- The user message provides a per-slot macro budget table (kcal/P/C/F per meal). Each meal MUST land near those numbers — not 70-80% of them.
- Compute: for each ingredient, grams × (P_per_100g / 100) gives that ingredient's protein; sum across the day.
- THE COMMON FAILURE MODE IS UNDERSHOOTING. LLMs tend to pick "reasonable-looking" portions that fall 15-20% below target. To avoid this:
  - Look at each slot's protein budget. Multiply by 100, divide by anchor's P-per-100g, round up. That's the anchor portion.
  - Look at each slot's carb budget. Multiply by 100, divide by carb-source's C-per-100g, round up. That's the carb portion.
  - When in doubt, INCREASE — never decrease — portions toward the budget.
- Before submitting, sum per-day kcal/P/C/F. If any total < 90% of target, the meal is broken — increase the anchor or carb portion until it lands.

## Variety rules — these are HARD requirements, not preferences
- No whole-food protein anchor (chicken_breast, ground_beef, salmon, eggs, Greek yogurt, cottage cheese, tofu, etc.) appears more than 3 times per week as anchor (is_anchor: true).
- Combined supplement anchors (whey_protein_isolate, casein_protein, pea_protein_powder, liquid_egg_whites, egg_white_raw) ≤ 5 times per week as anchor.
- Non-anchor uses of supplements are uncapped — whey as a secondary protein in 4-5 breakfasts is encouraged for low-density-anchor slots.
- No two days have all three (or all N) meals identical. Vary at least one meal between any two days.
- Before submitting your response, count anchor slug occurrences across all 7 days. If any rule is violated, redistribute before responding.

## Four-role contributor rule (every meal)
Every main meal includes slugs filling all four roles:
- Anchor — primary protein (is_anchor: true). Always included.
- Secondary — protein-secondary OR vegetable. On low-density-anchor breakfasts (eggs/yogurt/cottage cheese — anchor protein density < 20g/100g), the secondary MUST be whey_protein_isolate (or casein/pea) to absorb the residual protein gap. On lunch/dinner, the secondary is typically a vegetable.
- Carb — grain/starch/bread/fruit-as-carb. For Recomp, prefer tier-1 carb anchors: oats_rolled_dry, brown_rice_cooked, quinoa_cooked, sweet_potato_baked, potato_red_boiled, whole_wheat_pasta_cooked, whole_wheat_bread, sourdough_bread, oatmeal_cooked_water.
- Fat — fat-dense ingredient. Skip ONLY when the anchor itself is fat-dense (eggs ≥ 10g F/100g, salmon, ground_beef ≥ 80%, whole-milk dairy).

## Joint-macro feasibility
Five common failure flavors to AVOID:
1. Protein undershoot — anchor density × max grams < lower band. Add a protein-dense secondary.
2. Fat undershoot — slot has no fat-dense ingredient. Add chia/flax/hemp seeds, avocado, nut butter, or oil.
3. Carb undershoot — slot has dairy/protein anchors and only fruit, no grain. Add oats/bread/quinoa.
4. Fat overshoot — fat-dense anchor (eggs, salmon, ground beef ≥ 80%) AND additional oils/nuts. Reduce fat-stack ingredients.
5. Sodium overshoot — at most ONE high-Na slug per day. High-Na watch list: sourdough_bread (602), tuna_canned_water (219), cod_cooked (299), shrimp_cooked (395), bacon_cooked (751), feta_cheese (1034), parmesan_cheese (1175), cheddar_cheese (654), goat_cheese (459), bbq_sauce (1027), hot_sauce (2124), italian_dressing (993), ketchup (949), pickles_dill (809), sauerkraut (661), ground beef ribeye/brisket variants. Daily sodium total must stay ≤ sodiumCap × 1.15.

# BREAKFAST COMPOSITION — the post-Santiago rule
When a breakfast anchor has protein density < 20 g/100g (Greek yogurt 10.3, cottage cheese 12.4, eggs 12.6, liquid_egg_whites 10.9), the slot MUST include whey_protein_isolate (or casein/pea) as a non-anchor secondary. This carries the residual protein cleanly without dragging carbs/fat with it.

# DISH NAMES — naming style for the dish_name field
- 2-5 words per name.
- Real food language. Examples: "Lemon Herb Chicken & Rice", "Greek Yogurt Berry Parfait", "Sirloin & Roasted Potatoes", "Berry Almond Protein Oats".
- NO macro-speak: forbidden phrases include "High Protein", "Low Carb", "Macro", "Power", "Healthy", "Nutritious", "Wellness", "Clean", "Lean".
- NO bare suffixes ("Bowl", "Plate", "Mix") — must combine with ingredient words.
- Name only ingredients in the slot. Do NOT add implied flavorings as the lead noun (no "Lemon Chicken" if lemon isn't listed).
- All 21 (or N×7) dish names must be DISTINCT across the entire plan.
- Lead with the protein anchor or the carb headline, whichever is more recognizable.

# SELF-VERIFICATION BEFORE SUBMITTING

Before invoking the submit_plan tool, mentally walk this checklist:
1. Did I use only slugs from the approved table?
2. Did I respect the hard_exclude list?
3. For each day, do daily kcal/P/C/F land within ±10% of targets? Recompute by summing ingredient contributions if uncertain.
4. Did I count anchor occurrences? Each whole-food anchor ≤ 3×/week; combined supplement anchors ≤ 5×/week.
5. Did every breakfast with low-density anchor include whey as secondary?
6. Does every meal have all four roles (anchor, secondary, carb, fat)?
7. Are all dish names distinct, 2-5 words, no macro-speak?
8. Is each ingredient's grams within its min-max range?
9. Are all 7 days non-identical (at least one meal differs between any two days)?

If any check fails, fix it before submitting. The tool input must be the corrected plan, not the first draft.

# OUTPUT
Submit the entire 7-day plan via the submit_plan tool. Do not respond with prose. The tool input is the only output.`;

// ---------------------------------------------------------------------------
// User prompt — client specifics + macro targets + slug list
// ---------------------------------------------------------------------------

interface BuildUserPromptArgs {
  input: GeneratePlanInput;
  slug_table: string;
  retry_addendum?: string;
}

export function buildUserPrompt(args: BuildUserPromptArgs): string {
  const { input, slug_table, retry_addendum } = args;
  const p = input.client_profile;
  const t = input.targets;
  const slot_count = input.distribution.meals_per_day;

  const lines: string[] = [];

  lines.push(`# Client profile`);
  lines.push(`- Name: ${p.first_name} ${p.last_name}`);
  lines.push(`- Sex: ${p.sex}, Age: ${p.age}, Weight: ${p.weight_kg.toFixed(1)} kg, Height: ${p.height_cm} cm`);
  lines.push(`- Build: ${p.build_type}`);
  lines.push(`- Dietary style: ${p.dietary_style ?? "(no restriction)"}`);
  lines.push(`- Allergy flags: ${p.allergy_flags.length > 0 ? p.allergy_flags.join(", ") : "none"}`);
  lines.push(`- Medical flags: ${p.medical_flags.length > 0 ? p.medical_flags.join(", ") : "none"}`);
  lines.push(`- On stimulant: ${p.on_stimulant ? "yes" : "no"}`);
  lines.push("");

  lines.push(`# Daily macro targets — these are the totals each day MUST hit`);
  lines.push(`Training day:`);
  lines.push(`  kcal: ${t.training.calories}`);
  lines.push(`  protein: ${t.training.proteinG} g`);
  lines.push(`  carbs:   ${t.training.carbsG} g`);
  lines.push(`  fat:     ${t.training.fatG} g`);
  lines.push(`  sodium cap: ${t.training.sodiumCapMg} mg/day (audit ceiling = cap × 1.15 = ${Math.round(t.training.sodiumCapMg * 1.15)} mg)`);
  if (t.rest.calories !== t.training.calories) {
    lines.push(`Rest day (Endurance only — non-Endurance ignores this):`);
    lines.push(`  kcal: ${t.rest.calories}, P: ${t.rest.proteinG} g, C: ${t.rest.carbsG} g, F: ${t.rest.fatG} g`);
  }
  lines.push("");

  // Per-slot macro budgets — concrete grams the LLM must hit per meal.
  // Without these, the LLM tends to undershoot (~80-85% of target).
  lines.push(`# Per-slot macro budgets (training day) — each meal MUST land near these grams`);
  lines.push(`Hit each slot's budget within ±15%, and the daily totals will land within ±10%. UNDERSHOOTING IS THE MOST COMMON FAILURE MODE — when in doubt, increase portions.`);
  const slotBudgetTable = formatSlotBudgets(input.distribution, t.training);
  lines.push(slotBudgetTable);
  lines.push("");

  lines.push(`# Meal structure`);
  lines.push(`- Distribution: ${input.distribution.label} (${slot_count} meals/day)`);
  lines.push(`- Slot percentages (each macro column sums to 100%):`);
  lines.push(`  ${formatDistTable(input.distribution)}`);
  if (input.rest_distribution && input.rest_distribution.id !== input.distribution.id) {
    lines.push(`- Rest-day distribution: ${input.rest_distribution.label} (${input.rest_distribution.meals_per_day} meals)`);
  }
  lines.push(`- Day kind: training (use training-day targets for all 7 days for non-Endurance builds; Endurance: use rest-day targets on day_kind="rest" days as designated by you).`);
  lines.push("");

  // Concrete portion examples calibrated to this client's targets.
  // Anchors examples for protein density:
  const protPerMeal = Math.round(t.training.proteinG / slot_count);
  const carbsPerMeal = Math.round(t.training.carbsG / slot_count);
  lines.push(`# Worked portion examples — calibrated to your daily targets`);
  lines.push(`To hit ~${protPerMeal}g protein per meal, the anchor alone needs to deliver most of it:`);
  lines.push(`  - chicken_breast_cooked_skinless (31g P/100g): ${Math.round((protPerMeal * 0.85 * 100) / 31)}g cooked = ${Math.round(protPerMeal * 0.85)}g protein`);
  lines.push(`  - ground_beef_cooked_93_7 (26.6g P/100g): ${Math.round((protPerMeal * 0.85 * 100) / 26.6)}g cooked = ${Math.round(protPerMeal * 0.85)}g protein`);
  lines.push(`  - salmon_atlantic_cooked (25.4g P/100g): ${Math.round((protPerMeal * 0.85 * 100) / 25.4)}g cooked = ${Math.round(protPerMeal * 0.85)}g protein`);
  lines.push(`  - eggs_whole (12.6g P/100g, low-density anchor): ${Math.round((protPerMeal * 0.4 * 100) / 12.6)}g eggs + ${Math.round((protPerMeal * 0.45 * 100) / 90)}g whey_protein_isolate (90g P/100g) = ~${protPerMeal}g protein`);
  lines.push(`To hit ~${carbsPerMeal}g carbs per meal:`);
  lines.push(`  - oats_rolled_dry (60g C/100g): ${Math.round((carbsPerMeal * 100) / 60)}g dry = ${carbsPerMeal}g carbs`);
  lines.push(`  - brown_rice_cooked (23g C/100g): ${Math.round((carbsPerMeal * 100) / 23)}g cooked = ${carbsPerMeal}g carbs`);
  lines.push(`  - sweet_potato_baked (20g C/100g): ${Math.round((carbsPerMeal * 100) / 20)}g cooked = ${carbsPerMeal}g carbs`);
  lines.push(`These are illustrative — adjust to actual ingredient density. THE POINT: portions need to be substantial, not conservative.`);
  lines.push("");

  if (input.hard_exclude.size > 0) {
    lines.push(`# Hard exclude — these slugs MUST NOT appear anywhere`);
    lines.push(Array.from(input.hard_exclude).sort().join(", "));
    lines.push("");
  }

  lines.push(`# Build-specific tier-1 carb anchors (prefer these for ≥ 80% of carb-anchored slots)`);
  const tier1Carbs = input.build_spec.tier_1
    .filter((e) => e.role === "carb" || e.hybrid === "protein+carb" || e.hybrid === "carb+fat")
    .map((e) => e.slug);
  lines.push(tier1Carbs.join(", "));
  lines.push("");

  lines.push(slug_table);
  lines.push("");

  if (retry_addendum) {
    lines.push(`# RETRY — your first attempt failed macro verification`);
    lines.push(`Below are the per-day misses from your first attempt. The pattern is almost certainly UNDERSHOOTING — your portions were too small. For each failing day, identify which meals contribute the most to the missing macro and INCREASE those ingredient grams by 20-40%. Specifically:`);
    lines.push(`  - Carbs short? Increase oats/rice/sweet_potato/bread/pasta grams.`);
    lines.push(`  - Protein short? Increase the anchor (chicken/beef/salmon/tofu) grams, or add whey as a non-anchor secondary.`);
    lines.push(`  - Fat short? Add or increase chia/flax/hemp/avocado/nut butter/olive oil grams.`);
    lines.push(`  - Kcal short? Almost always means carbs and/or fat are short — fix those first.`);
    lines.push(``);
    lines.push(retry_addendum);
    lines.push("");
  }

  lines.push(`# Generate the plan now`);
  lines.push(`Produce the full 7-day meal plan via the submit_plan tool. Apply all rules from the system prompt. Self-verify before submitting.`);

  return lines.join("\n");
}

function formatDistTable(dist: MealDistribution): string {
  const headers = ["slot", "label", "P%", "C%", "F%"];
  const rows = dist.slots.map((s) => [
    String(s.index),
    s.label,
    String(s.protein_pct),
    String(s.carb_pct),
    String(s.fat_pct),
  ]);
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n  ");
}

/**
 * Pre-compute per-slot macro grams from the distribution percentages × the
 * day's totals. Surfaces concrete numbers ("Lunch needs 79g protein") so
 * the LLM doesn't undershoot.
 */
function formatSlotBudgets(
  dist: MealDistribution,
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number },
): string {
  const headers = ["slot", "label", "kcal", "P (g)", "C (g)", "F (g)"];
  const rows = dist.slots.map((s) => {
    const p = Math.round((targets.proteinG * s.protein_pct) / 100);
    const c = Math.round((targets.carbsG * s.carb_pct) / 100);
    const f = Math.round((targets.fatG * s.fat_pct) / 100);
    const kcal = p * 4 + c * 4 + f * 9;
    return [String(s.index), s.label, String(kcal), String(p), String(c), String(f)];
  });
  return [headers.join("\t"), ...rows.map((r) => r.join("\t"))].join("\n  ");
}

// ---------------------------------------------------------------------------
// Tool definition for Anthropic structured output
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export const SUBMIT_PLAN_TOOL = {
  name: "submit_plan",
  description:
    "Submit the complete 7-day meal plan. The plan must satisfy the hard rules from the system prompt: macro targeting ±10%, variety caps, four-role coverage per meal, breakfast composition rule, sodium ceiling, dish-name style, all 21+ dish names distinct.",
  input_schema: {
    type: "object",
    required: ["days"],
    properties: {
      days: {
        type: "array",
        minItems: 7,
        maxItems: 7,
        description: "7 days, ordered Monday through Sunday.",
        items: {
          type: "object",
          required: ["day_number", "weekday", "meals"],
          properties: {
            day_number: { type: "integer", minimum: 1, maximum: 7 },
            weekday: {
              type: "string",
              enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
            },
            meals: {
              type: "array",
              minItems: 3,
              maxItems: 6,
              items: {
                type: "object",
                required: ["slot", "name", "dish_name", "ingredients"],
                properties: {
                  slot: { type: "integer", minimum: 1, maximum: 6 },
                  name: { type: "string" },
                  dish_name: { type: "string", minLength: 2, maxLength: 60 },
                  ingredients: {
                    type: "array",
                    minItems: 3,
                    maxItems: 8,
                    items: {
                      type: "object",
                      required: ["slug", "grams", "is_anchor"],
                      properties: {
                        slug: { type: "string" },
                        grams: { type: "integer", minimum: 1, maximum: 600 },
                        is_anchor: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as { name: string; description: string; input_schema: any };
