/**
 * Phase B6a-pivot dish-namer — main entry point.
 *
 * Takes a finished WeekPlanSuccess and produces a per-(day, slot) dish
 * name map by issuing a single batched Anthropic tool-use call. Falls
 * back per-meal to authored `dish_name` from the template whenever the
 * LLM call fails, returns a malformed response, or skips a meal.
 *
 * Plumbing diagram:
 *   plan + display_names + categories + authored_fallbacks
 *     → buildSubjectFilteredMeals (per-slot ingredient filter)
 *     → buildUserPrompt
 *     → llm_client.callTool({ system, user })
 *     → parseToolResponse
 *     → merge LLM-named + per-meal authored fallbacks
 *     → NameMealsResult with diagnostics
 */

import { AnthropicDishNamerClient } from "./anthropic-client";
import { parseToolResponse } from "./parse";
import {
  buildUserPrompt,
  SYSTEM_PROMPT,
  type MealForPrompt,
} from "./prompt";
import {
  filterSubjectIngredients,
  type SubjectCandidate,
} from "./subject-filter";
import type {
  DishNamerLLMClient,
  NameMealsInput,
  NameMealsResult,
} from "./types";

// Anthropic Sonnet pricing (as of 2026-04 — may shift with model versions)
const COST_USD_PER_INPUT_TOKEN = 3 / 1_000_000;
const COST_USD_PER_OUTPUT_TOKEN = 15 / 1_000_000;

// Cost / wall-clock guardrail thresholds — log warning when exceeded
const COST_WARN_USD = 0.2;
const WALL_CLOCK_WARN_MS = 10_000;

/** Internal type matching parse.ts output. */
export interface ParsedNameEntry {
  day: number;
  slot: number;
  name: string;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function nameMeals(
  input: NameMealsInput,
): Promise<NameMealsResult> {
  // 1. Build subject-filtered meal list from the solved plan.
  const meals = buildMealsForPrompt(input);

  // 2. Initialize result skeleton with authored fallbacks. Every (day, slot)
  // will have a name even if everything that follows fails.
  const slotNames: Record<number, Record<number, string>> = {};
  const sourceMap: Record<number, Record<number, "llm" | "fallback">> = {};
  for (const meal of meals) {
    if (!slotNames[meal.day]) slotNames[meal.day] = {};
    if (!sourceMap[meal.day]) sourceMap[meal.day] = {};
    const fallback = input.authored_fallbacks[meal.day]?.[meal.slot];
    slotNames[meal.day][meal.slot] = fallback ?? "Meal";
    sourceMap[meal.day][meal.slot] = "fallback";
  }

  // 3. Skip the API entirely if no key + no injected client.
  const llmClient = resolveLLMClient(input);
  if (llmClient === null) {
    return {
      slot_dish_names: slotNames,
      diagnostics: {
        api_called: false,
        api_call_ms: 0,
        input_tokens: 0,
        output_tokens: 0,
        estimated_cost_usd: 0,
        source: sourceMap,
        rejected_names: [],
        failure_reason: "no_api_key",
      },
    };
  }

  // 4. Call the LLM.
  const userPrompt = buildUserPrompt(meals);
  const t0 = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let toolInput: any = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let failureReason: string | undefined;

  try {
    const resp = await llmClient.callTool({
      system: SYSTEM_PROMPT,
      user: userPrompt,
    });
    toolInput = resp.tool_input;
    inputTokens = resp.usage.input_tokens;
    outputTokens = resp.usage.output_tokens;
  } catch (e) {
    failureReason = e instanceof Error ? e.message : String(e);
  }
  const apiCallMs = Date.now() - t0;
  const estimatedCostUsd =
    inputTokens * COST_USD_PER_INPUT_TOKEN +
    outputTokens * COST_USD_PER_OUTPUT_TOKEN;

  // 5. If the call failed, return all-fallback.
  if (toolInput === null) {
    return {
      slot_dish_names: slotNames,
      diagnostics: {
        api_called: true,
        api_call_ms: apiCallMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimatedCostUsd,
        source: sourceMap,
        rejected_names: [],
        failure_reason: failureReason,
      },
    };
  }

  // 6. Parse + validate.
  const parseResult = parseToolResponse(toolInput);
  if (parseResult.fatal) {
    // Log the raw shape (first 400 chars) for debugging when parsing fails.
    let preview = "";
    try {
      preview = JSON.stringify(toolInput).slice(0, 400);
    } catch {
      preview = "(unstringifiable)";
    }
    console.warn(
      `[dish-namer] parse failed: ${parseResult.fatal} | raw preview: ${preview}`,
    );
    return {
      slot_dish_names: slotNames,
      diagnostics: {
        api_called: true,
        api_call_ms: apiCallMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        estimated_cost_usd: estimatedCostUsd,
        source: sourceMap,
        rejected_names: [],
        failure_reason: parseResult.fatal,
      },
    };
  }

  // 7. Apply LLM names where parsed; per-meal fallback otherwise.
  for (const [key, entry] of parseResult.parsed) {
    void key;
    if (!slotNames[entry.day]) slotNames[entry.day] = {};
    if (!sourceMap[entry.day]) sourceMap[entry.day] = {};
    slotNames[entry.day][entry.slot] = entry.name;
    sourceMap[entry.day][entry.slot] = "llm";
  }

  // 8. Cost / wall-clock guardrail warnings.
  if (estimatedCostUsd > COST_WARN_USD) {
    console.warn(
      `[dish-namer] cost guardrail tripped: $${estimatedCostUsd.toFixed(4)} > $${COST_WARN_USD} (input=${inputTokens} output=${outputTokens})`,
    );
  }
  if (apiCallMs > WALL_CLOCK_WARN_MS) {
    console.warn(
      `[dish-namer] wall-clock guardrail tripped: ${apiCallMs}ms > ${WALL_CLOCK_WARN_MS}ms`,
    );
  }

  return {
    slot_dish_names: slotNames,
    diagnostics: {
      api_called: true,
      api_call_ms: apiCallMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      estimated_cost_usd: estimatedCostUsd,
      source: sourceMap,
      rejected_names: parseResult.rejected,
    },
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveLLMClient(
  input: NameMealsInput,
): DishNamerLLMClient | null {
  if (input.llm_client) return input.llm_client;
  if (!input.anthropic_api_key || input.anthropic_api_key.trim().length === 0) {
    return null;
  }
  return new AnthropicDishNamerClient({
    apiKey: input.anthropic_api_key,
    model: input.model,
  });
}

/**
 * Walk the plan's solved slots, apply the subject filter, and produce
 * the prompt-ready meal list. Skips meals where every solved ingredient
 * was filtered out (extremely rare — would mean every ingredient was
 * an oil/condiment/below-threshold-fruit, which shouldn't happen for a
 * real meal). Those skipped meals get authored fallback at merge time.
 */
function buildMealsForPrompt(input: NameMealsInput): MealForPrompt[] {
  const meals: MealForPrompt[] = [];
  for (const day of input.plan.days) {
    for (const slot of day.solve.slots) {
      const candidates: SubjectCandidate[] = [];
      for (const ing of slot.ingredients) {
        if (ing.grams <= 0) continue;
        const display_name = input.display_names.get(ing.slug) ?? ing.slug;
        const category = input.ingredient_categories.get(ing.slug) ?? "unknown";
        candidates.push({
          slug: ing.slug,
          display_name,
          grams: ing.grams,
          category,
        });
      }
      const filtered = filterSubjectIngredients(candidates);
      // Find the slot label from the day's distribution.
      const distSlot = day.distribution.slots.find((s) => s.index === slot.index);
      const slotLabel = distSlot?.label ?? `Slot ${slot.index}`;
      meals.push({
        day: day.day,
        slot: slot.index,
        slot_label: slotLabel,
        ingredients: filtered,
      });
    }
  }
  return meals;
}
