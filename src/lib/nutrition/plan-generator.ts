/**
 * Per-day Claude meal generator.
 * Each call produces ONE day only — small output (~1000 tokens), ~5-8s.
 * Caller parallelizes 7 concurrent calls to stay well under Vercel's 60s limit.
 *
 * Claude outputs dish names + ingredient slugs + grams.
 * All macro arithmetic is done by code.
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
  proteinPreferences: string;  // "Chicken, Beef, Fish, Eggs, Dairy" — order matters
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
  // Client flags detected by code from intake form
  prefersQuickPrep: boolean;
  prefersSpicy: boolean;
  // Preferred proteins in ranked order (from intake "Protein Preferences")
  preferredProteins: string[];
  // Variation hint (e.g., avoid proteins used on prior days)
  avoidProteins?: string[];
  // Corrective feedback from a prior attempt on this day, if any
  priorAttemptError?: string;
}

function buildSystemPrompt(): string {
  return `You are a precise nutritionist building ONE day of a meal plan.

OUTPUT FORMAT (non-negotiable):
- Return ONLY valid JSON. No markdown fences. No prose.
- Use ONLY ingredient slugs from the allowed list provided.
- All quantities are integer grams.

MACRO HIERARCHY — strictness applies top-down:
1. CALORIES must be within ±5% of target, in BOTH directions. Do not undershoot OR overshoot.
   Plans that run 10%+ under target leave the client hungry and under-fueled.
2. FAT grams must be within ±10% of target. FAT is the #1 cause of plans failing validation.
   → Use added fats SPARINGLY: butter/oil 5-10g per meal (NOT 15-25g); cheese 15-20g
     portions (NOT 30-50g); nuts 15g portions (NOT 30g). Track them across the day.
   → NO SINGLE MEAL may contain more than 40% of the daily fat target. Spread fats across the day.
3. PROTEIN must be within ±7% of target. Spread 20-40g per meal.
4. CARBS are a "remainder" macro — within ±10% is fine.

MEAL COMPOSITION:
- LUNCH AND DINNER must each include at least ONE vegetable ingredient
  (bell pepper, onion, tomato, lettuce, corn, broccoli, spinach, mushrooms, cucumber, etc.).
  A "taco bowl" or "burrito bowl" without any vegetables is not realistic — peppers, onions,
  tomato, and lettuce belong in those dishes.
- Most meals should have 4-6 ingredients, not 2-3.

INGREDIENT SELECTION:
- Respect the client's ranked protein preferences — their #1 choice should appear 1-2×/week;
  pick a variety across the 7 days. Do not skip their top preference.
- Respect the foods-enjoy list: favor matching ingredients when they fit the macros.
- Respect "foods to avoid" and allergies absolutely.

DISH NAMING (truth-in-labeling):
- Every meal needs a real dish name (e.g., "Beef Burrito Bowl", "Oats with Berries and Whey").
- If you name a meal "Spicy X", it MUST include a real spicy ingredient
  (salsa, hot_sauce, jalapeno_raw, or similar). Do NOT label a meal "Spicy" without one.
- If you name a meal "Crockpot X" or "Slow Cooker X", it should look like a real one-pot dish
  — include vegetables and sauce/seasoning, not just a protein cube + rice + cheese.`;
}

function buildUserPrompt(input: DayGenerationInput): string {
  const {
    intake, targets, mealSlots, allowedIngredients, priorComments,
    dayNumber, weekday, avoidProteins, priorAttemptError,
    prefersQuickPrep, prefersSpicy, preferredProteins,
  } = input;

  // Compact ingredient list
  const ingredientList = allowedIngredients
    .map((i) => `${i.slug}|${i.name}|${i.category}|${i.calories_per_100g}kc/${i.protein_g_per_100g}p/${i.carbs_g_per_100g}c/${i.fat_g_per_100g}f per 100g`)
    .join("\n");

  const commentsBlock =
    priorComments.length > 0
      ? `\n\nNUTRITIONIST NOTES (apply, newest first):\n${priorComments
          .slice(0, 7)
          .map((c, i) => `${i + 1}. ${c}`)
          .join("\n")}`
      : "";

  const mealSlotsBlock = mealSlots.map((s, i) => `${i + 1}. ${s.name} at ${s.time}`).join("\n");

  // Client-specific directives
  const directives: string[] = [];
  if (preferredProteins.length > 0) {
    directives.push(
      `Client's ranked protein preferences: ${preferredProteins.join(" → ")}. Favor their top 2 protein preferences in today's meals.`
    );
  }
  if (avoidProteins && avoidProteins.length > 0) {
    directives.push(
      `For variety, don't use these proteins today (already used on prior days): ${avoidProteins.join(", ")}.`
    );
  }
  if (prefersQuickPrep) {
    directives.push(
      "Client prefers QUICK PREP / crockpot / one-pot style meals. Avoid meals requiring >20 minutes of active cooking. Favor: ground meat, pre-cooked rotisserie chicken, canned tuna/salmon, microwaveable rice, bagged salad, simple assembly."
    );
  }
  if (prefersSpicy) {
    directives.push(
      "Client likes SPICY food. Where it fits (lunch/dinner especially), include salsa, hot sauce, jalapeños, chili powder, or sriracha as flavoring elements (they add flavor without major macro impact)."
    );
  }
  const directivesBlock = directives.length > 0 ? `\n\nCLIENT DIRECTIVES:\n${directives.map((d) => `- ${d}`).join("\n")}` : "";

  const retryBlock = priorAttemptError
    ? `\n\nCORRECTIVE FEEDBACK — your previous attempt for this day failed validation:\n${priorAttemptError}\nFix by adjusting portion sizes (smaller oil/butter/cheese/nut portions are the usual culprits). Do not change the set of ingredients dramatically.`
    : "";

  return `CLIENT INTAKE
Name: ${intake.firstName} ${intake.lastName}
Goal: ${intake.fitnessGoal}
Preferred foods: ${intake.foodsEnjoy || "no preferences listed"}
Foods to avoid: ${intake.foodsAvoid || "none"}
Allergies: ${intake.allergies || "none"}
Can cook: ${intake.canCook || "unknown"}
Typical meals: ${intake.dailyMealsDescription || "not provided"}

DAY: ${dayNumber} (${weekday})

DAILY TARGETS (hit these via portion sizes):
Calories: ${targets.calories} kcal  (max ${Math.round(targets.calories * 1.05)})
Protein:  ${targets.proteinG}g       (min ${Math.round(targets.proteinG * 0.93)}, max ${Math.round(targets.proteinG * 1.07)})
Carbs:    ${targets.carbsG}g
Fat:      ${targets.fatG}g           (max ${Math.round(targets.fatG * 1.10)} — DO NOT OVERSHOOT)

MEAL STRUCTURE (produce exactly these meals, in this order):
${mealSlotsBlock}${directivesBlock}${commentsBlock}${retryBlock}

ALLOWED INGREDIENTS (format: slug|name|category|macros per 100g):
${ingredientList}

RESPOND WITH JSON ONLY. No markdown fences, no prose. Schema:
{
  "meals": [
    {
      "name": "Breakfast",
      "time": "7:30 AM",
      "dishName": "Tex-Mex Egg Scramble Bowl",
      "ingredients": [
        { "slug": "eggs_whole_cooked", "grams": 150 }
      ]
    }
  ]
}

The "name" field is fixed (from the meal structure above: Breakfast, Lunch, etc.).
The "dishName" field is a short (2-5 word) dish name you invent based on the ingredients.
Examples: "Tex-Mex Egg Scramble Bowl", "Lemon Herb Chicken & Rice", "Miso Salmon with Quinoa", "Peanut Butter Banana Oats".`;
}

const DAY_CALL_MAX_TOKENS = 1800; // slight bump for dishName + variety

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

  let jsonStr = raw.trim();
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  let parsed: {
    meals: {
      name: string;
      time: string;
      dishName?: string;
      ingredients: { slug: string; grams: number }[];
    }[];
  };
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
      dishName: m.dishName,
      ingredients: (m.ingredients || []).map((i) => ({
        slug: i.slug,
        grams: Math.round(Number(i.grams) || 0),
      })),
    })),
  };
}

/**
 * Generate all 7 days in parallel. Returns array of DayPlan (ordered day 1..7).
 */
export async function generateAllDays(
  inputs: DayGenerationInput[],
  apiKey: string
): Promise<DayPlan[]> {
  const results = await Promise.all(inputs.map((inp) => generateDay(inp, apiKey)));
  results.sort((a, b) => a.day - b.day);
  return results;
}
