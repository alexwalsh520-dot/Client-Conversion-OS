/**
 * Claude-powered meal plan generator.
 * Claude only returns structured JSON with slugs + grams.
 * All macro arithmetic is done by code (never Claude).
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

export interface GenerationInput {
  intake: ClientIntakeSummary;
  targets: MacroTargets;
  mealsPerDay: number;
  allowedIngredients: IngredientRow[];
  priorComments: string[];                // comment texts, newest first
  previousPlanSummary?: string | null;    // optional summary of last attempt
  attempt: number;                        // 1, 2, 3 for retries
  validationErrors?: string[];            // errors from previous attempt, if retry
}

function buildSystemPrompt(): string {
  return `You are a clinical nutritionist building precise 7-day meal plans.

CRITICAL RULES — THESE ARE NON-NEGOTIABLE:
1. You may ONLY use ingredients from the allowed list provided. Using any other ingredient will cause the plan to be rejected.
2. All quantities must be in grams as integers.
3. Each day must have the exact number of meals requested.
4. Each day must hit the calorie and protein targets within ±5% (target ±7% but aim for ±5% to have margin).
5. Return ONLY valid JSON matching the schema provided. No markdown, no explanation.
6. Never invent new ingredients. Never use free-text ingredient names.
7. Never calculate macros yourself — that is done by the system. Just use realistic portion sizes.

You WILL get feedback via the system if your plan fails validation. Adjust portion sizes (not ingredients) to meet targets on retry.`;
}

function buildUserPrompt(input: GenerationInput): string {
  const { intake, targets, mealsPerDay, allowedIngredients, priorComments, validationErrors } = input;

  const ingredientList = allowedIngredients
    .map(
      (i) =>
        `${i.slug} (${i.name}, ${i.category}) — per 100g: ${i.calories_per_100g}kcal / ${i.protein_g_per_100g}P / ${i.carbs_g_per_100g}C / ${i.fat_g_per_100g}F`
    )
    .join("\n");

  const commentsBlock =
    priorComments.length > 0
      ? `\n\n## NUTRITIONIST NOTES (apply these; newest first):\n${priorComments
          .slice(0, 7)
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";

  const retryBlock =
    validationErrors && validationErrors.length > 0
      ? `\n\n## RETRY — previous attempt failed validation:\n${validationErrors
          .map((e) => `- ${e}`)
          .join("\n")}\nFix by adjusting portion sizes. Do NOT change the set of meals dramatically.`
      : "";

  return `## CLIENT
Name: ${intake.firstName} ${intake.lastName}
Fitness goal: ${intake.fitnessGoal}
Preferred foods: ${intake.foodsEnjoy || "no preferences listed"}
Foods to avoid: ${intake.foodsAvoid || "none"}
Allergies: ${intake.allergies || "none"}
Protein preferences: ${intake.proteinPreferences || "no preferences"}
Can cook: ${intake.canCook || "unknown"}
Preferred meals per day: ${intake.mealCount || "3"}
Medications: ${intake.medications || "none"}
Supplements: ${intake.supplements || "none"}
Sleep: ${intake.sleepHours || "unknown"}
Water: ${intake.waterIntake || "unknown"}
Current eating habits: ${intake.dailyMealsDescription || "not provided"}

## DAILY TARGETS (EACH DAY MUST HIT THESE WITHIN ±7%)
Calories: ${targets.calories} kcal
Protein: ${targets.proteinG}g
Carbs: ${targets.carbsG}g
Fat: ${targets.fatG}g

## STRUCTURE
- 7 days (day 1 through day 7)
- ${mealsPerDay} meals per day
- Use different ingredients across days to add variety
- Favor the client's preferred foods and protein sources
- Avoid everything in their avoid list and allergies${commentsBlock}${retryBlock}

## ALLOWED INGREDIENTS (you MUST only use these)
${ingredientList}

## RESPOND WITH JSON ONLY — no markdown fences, no prose. Schema:
{
  "days": [
    {
      "day": 1,
      "meals": [
        {
          "name": "Breakfast",
          "time": "7:30 AM",
          "ingredients": [
            { "slug": "chicken_breast_cooked_skinless", "grams": 150 }
          ]
        }
      ]
    }
  ]
}

Return exactly 7 day objects, each with exactly ${mealsPerDay} meal objects.`;
}

export async function generateMealPlan(
  input: GenerationInput,
  apiKey: string
): Promise<{ days: DayPlan[]; rawResponse: string }> {
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 6000, // a full 7-day plan JSON fits comfortably; larger values just slow generation
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(input) }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const raw = textBlock.text;

  // Extract JSON from the response (strip any markdown fences if present)
  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  let parsed: { days: DayPlan[] };
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(`Failed to parse Claude response as JSON: ${(err as Error).message}\n\nResponse: ${raw.slice(0, 500)}`);
  }

  if (!parsed.days || !Array.isArray(parsed.days)) {
    throw new Error("Claude response missing 'days' array");
  }

  return { days: parsed.days, rawResponse: raw };
}
