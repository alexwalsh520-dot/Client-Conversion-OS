/**
 * Phase B6a-pivot dish-namer — system + user prompt builders.
 */

import type { SubjectCandidate } from "./subject-filter";

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You are naming dishes for a fitness coaching meal plan. Each meal has a list of subject-eligible ingredients with gram amounts. Produce a 2-5 word dish name for each meal.

CRITICAL RULES:
1. Name only ingredients in the provided list. Do NOT invent ingredients or imply flavors that aren't there. NO "Lemon Chicken" if lemon isn't in the list. NO "Garlic Shrimp" if garlic isn't listed.
2. 2-5 words per name. Longer is awkward in the rendered PDF.
3. Real food language. Names should sound like dishes a human would order or cook. Examples: "Lemon Herb Chicken & Rice", "Greek Yogurt Berry Parfait", "Sirloin & Roasted Potatoes", "Berry Almond Protein Oats". (Note: those examples assume the ingredients listed match — only use these patterns when the ingredients do match.)
4. NO macro-speak. Forbidden phrases: "High Protein", "Lean", "Macro", "Power", "Healthy", "Nutritious", "Wellness", "Clean".
5. NO generic filler. Forbidden: "Bowl" alone, "Plate" alone, "Mix", "Combo".
6. The ingredient list for each meal is sorted by GRAM WEIGHT, descending. Prioritize leading the dish name with the larger-portion ingredients — they're the meal's actual subject. Smaller portions are accents at most, often skipped from the title entirely. A 5g of butter doesn't earn a place in the dish name; 40g does.
7. Lead with the protein anchor or the carb headline, whichever is more recognizable as the meal's identity.
8. All 21 names must be DISTINCT across the entire plan. Don't repeat a name (or near-duplicate) across days.

GOOD EXAMPLES:
- ingredients: chicken_breast 220g, brown_rice 280g, broccoli 100g → "Lemon Herb Chicken & Rice"  (lemon/herb implied flavoring, OK)
- ingredients: greek_yogurt 200g, oats 80g, raspberries 100g, almonds 25g → "Raspberry Almond Yogurt Parfait"
- ingredients: salmon 220g, sweet_potato 280g, spinach 100g, avocado 80g → "Salmon with Sweet Potato"
- ingredients: whey 35g, oats 80g, blueberries 100g, almonds 25g → "Blueberry Almond Protein Oats"
- ingredients: eggs 150g, sourdough 120g, avocado 100g → "Avocado Toast with Eggs"

BAD EXAMPLES (do NOT produce):
- "Healthy Protein Bowl" — macro-speak, generic
- "Nutritious Chicken Plate" — macro-speak, filler
- "Power Breakfast Mix" — macro-speak, filler
- "Lemon Garlic Chicken Bowl" — when neither lemon nor garlic is in the list
- "Bowl" or "Plate" alone — generic filler

Return your output via the \`submit_dish_names\` tool.`;

// ---------------------------------------------------------------------------
// User prompt — meal-by-meal listing
// ---------------------------------------------------------------------------

export interface MealForPrompt {
  day: number;
  slot: number;
  slot_label: string;  // "Breakfast", "Lunch", "Dinner"
  /** Subject-filtered ingredients sorted by grams descending. */
  ingredients: SubjectCandidate[];
}

export function buildUserPrompt(meals: MealForPrompt[]): string {
  const lines: string[] = [];
  lines.push(
    `Name each of the following ${meals.length} meals. Return all names via the submit_dish_names tool — one entry per (day, slot).`,
  );
  lines.push("");

  for (const meal of meals) {
    lines.push(`Day ${meal.day} ${meal.slot_label} (slot ${meal.slot}):`);
    if (meal.ingredients.length === 0) {
      lines.push(`  (no subject-eligible ingredients — fall back to authored)`);
    } else {
      for (const ing of meal.ingredients) {
        lines.push(`  - ${ing.display_name}, ${ing.grams}g`);
      }
    }
    lines.push("");
  }

  lines.push(
    `Remember: 2-5 words, real food, no macro-speak, no generic filler, lead with bigger-portion ingredients, all 21 names distinct.`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool definition for Anthropic structured output
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
export const DISH_NAMES_TOOL = {
  name: "submit_dish_names",
  description:
    "Submit the dish names for all meals in the plan. Each entry must reference a (day, slot) from the user prompt and provide a 2-5 word real-food dish name.",
  input_schema: {
    type: "object",
    required: ["names"],
    properties: {
      names: {
        type: "array",
        description: "One entry per (day, slot) in the user prompt.",
        items: {
          type: "object",
          required: ["day", "slot", "name"],
          properties: {
            day: {
              type: "integer",
              minimum: 1,
              maximum: 7,
              description: "Day number (1=Monday, 7=Sunday)",
            },
            slot: {
              type: "integer",
              minimum: 1,
              maximum: 6,
              description: "Slot index within the day",
            },
            name: {
              type: "string",
              minLength: 2,
              maxLength: 60,
              description: "2-5 word dish name. Real food language only.",
            },
          },
        },
      },
    },
  },
} as { name: string; description: string; input_schema: any };
