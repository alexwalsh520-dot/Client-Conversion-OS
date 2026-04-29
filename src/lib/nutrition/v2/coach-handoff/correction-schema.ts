/**
 * Coach-correction JSON schema.
 *
 * Mirrors the LLM meal-generator's submit_plan tool input_schema so a
 * coach-edited plan returned via Claude.ai can be re-ingested without
 * a separate parser. The coach-handoff API exposes this so the coach UI
 * can show the schema next to the prompt.
 *
 * IMPORTANT: keep this in sync with SUBMIT_PLAN_TOOL in
 * src/lib/nutrition/v2/llm-meal-generator/prompt.ts. If the generator's
 * shape changes, update both.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
export const CORRECTION_SCHEMA: { type: "object"; required: string[]; properties: any } = {
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
            enum: [
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ],
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
};
