/**
 * Per-day Claude meal generator.
 * Each call produces ONE day only — small output (< 1000 tokens), ~5-8s.
 * Caller parallelizes 7 concurrent calls to stay well under Vercel's 60s limit.
 *
 * Claude outputs slugs + grams only. All macro arithmetic is done by code.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { IngredientRow } from "./ingredient-filter";
import type { MacroTargets } from "./macro-calculator";
import type { DayPlan } from "./macro-validator";

export interface ClientIntakeSummary {
  firstName: string;
  lastName: string;
  fitnessGoal: string;
  foodsEnjoy: string;
  foodsAvoid: string;
  allergies: string;
  proteinPreferences: string;
  canCook: string;
  mealCount: string;
  medications: string;
  supplements: string;
  sleepHours: string;
  waterIntake: string;
  dailyMealsDescription: string;
}

export interface DayGenerationInput {
  dayNumber: number;                 // 1-7
  weekday: string;                   // "Monday"..."Sunday"
  mealSlots: { name: string; time: string }[]; // per-day meal structure
  intake: ClientIntakeSummary;
  targets: MacroTargets;             // daily targets
  allowedIngredients: IngredientRow[]; // already filtered for allergies
  priorComments: string[];           // newest first
  variationHint?: string;            // e.g. "use different proteins than days 1-3"
}

function buildSystemPrompt(): string {
  return `You are a clinical nutritionist building one day of a meal plan.

RULES (NON-NEGOTIABLE):
1. Output ONLY JSON — no markdown, no prose, no explanation.
2. Use ONLY ingredients from the allowed list provided (use exact slug strings).
3. Quantities must be integer grams.
4. Each meal must have 3-5 ingredients for variety (unless it's a pure drink or snack).
5. Each day must hit ±5% of the calorie and protein targets via portion sizes.
6. Respect client preferences and protein sources when picking ingredients.
7. Never invent ingredient slugs. Never use free-text names.
8. Do not recommend supplements — only food ingredients from the list.`;
}

function buildUserPrompt(input: DayGenerationInput): string {
  const { intake, targets, mealSlots, allowedIngredients, priorComments, dayNumber, weekday, variationHint } = input;

  // Compact ingredient list: slug + short macro summary
  const ingredientList = allowedIngredients
    .map((i) => `${i.slug}|${i.name}|C${i.category}|${i.calories_per_100g}kc/${i.protein_g_per_100g}p/${i.carbs_g_per_100g}c/${i.fat_g_per_100g}f per 100g`)
    .join("\n");

  const commentsBlock =
    priorComments.length > 0
      ? `\n\nNUTRITIONIST NOTES (apply, newest first):\n${priorComments
          .slice(0, 7)
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";

  const variationBlock = variationHint ? `\n\nVARIATION: ${variationHint}` : "";

  const mealSlotsBlock = mealSlots
    .map((s, i) => `${i + 1}. ${s.name} at ${s.time}`)
    .join("\n");

  return `CLIENT INTAKE
Name: ${intake.firstName} ${intake.lastName}
Goal: ${intake.fitnessGoal}
Preferred foods: ${intake.foodsEnjoy || "no preferences listed"}
Foods to avoid: ${intake.foodsAvoid || "none"}
Allergies: ${intake.allergies || "none"}
Protein preferences: ${intake.proteinPreferences || "no preferences"}
Can cook: ${intake.canCook || "unknown"}

DAY: ${dayNumber} (${weekday})

DAILY TARGETS (hit these ±5% via portion sizes):
Calories: ${targets.calories} kcal
Protein: ${targets.proteinG}g
Carbs:   ${targets.carbsG}g
Fat:     ${targets.fatG}g

MEAL STRUCTURE (produce exactly these meals, in this order):
${mealSlotsBlock}${commentsBlock}${variationBlock}

ALLOWED INGREDIENTS (format: slug|name|category|macros per 100g):
${ingredientList}

RESPOND WITH JSON ONLY. No markdown fences, no prose. Schema:
{
  "meals": [
    {
      "name": "Breakfast",
      "time": "7:30 AM",
      "ingredients": [
        { "slug": "chicken_breast_cooked_skinless", "grams": 180 }
      ]
    }
  ]
}`;
}

const DAY_CALL_MAX_TOKENS = 1500; // plenty for ~4-5 meals with ingredient lists

export async function generateDay(
  input: DayGenerationInput,
  apiKey: string
): Promise<DayPlan> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: DAY_CALL_MAX_TOKENS,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Day ${input.dayNumber}: no text response from Claude`);
  }
  const raw = textBlock.text;

  // Strip any accidental markdown fences
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  let parsed: { meals: { name: string; time: string; ingredients: { slug: string; grams: number }[] }[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Day ${input.dayNumber}: failed to parse Claude JSON: ${(err as Error).message} | raw: ${raw.slice(0, 300)}`
    );
  }

  if (!parsed.meals || !Array.isArray(parsed.meals)) {
    throw new Error(`Day ${input.dayNumber}: Claude response missing 'meals' array`);
  }

  return {
    day: input.dayNumber,
    meals: parsed.meals.map((m) => ({
      name: m.name,
      time: m.time,
      ingredients: (m.ingredients || []).map((i) => ({
        slug: i.slug,
        grams: Math.round(Number(i.grams) || 0),
      })),
    })),
  };
}

/**
 * Generate all 7 days in parallel. Returns array of DayPlan (day 1..7).
 * If any day fails, throws — caller decides retry strategy.
 */
export async function generateAllDays(
  inputs: DayGenerationInput[],
  apiKey: string
): Promise<DayPlan[]> {
  const results = await Promise.all(inputs.map((inp) => generateDay(inp, apiKey)));
  // Ensure ordered by day number
  results.sort((a, b) => a.day - b.day);
  return results;
}
