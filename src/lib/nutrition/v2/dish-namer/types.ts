/**
 * Phase B6a-pivot dish-namer — public types.
 *
 * The dish-namer takes a finished WeekPlanSuccess and produces a dish
 * name for each of the 21 meals via a single batched Anthropic API
 * call. Sits downstream of meal composition (solver / orchestrator)
 * so its output never affects macro accuracy, feasibility, audit, or
 * substitution. Failure modes fall back per-meal to the template's
 * authored `dish_name` field.
 */

import type { WeekPlanSuccess } from "../picker";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface NameMealsInput {
  /** Finished week plan from generateWeekPlanFromTemplate. */
  plan: WeekPlanSuccess;
  /** Anthropic API key. Empty/missing → skip API, use authored fallbacks. */
  anthropic_api_key: string;
  /** Optional model override. Defaults to claude-sonnet-4-5-20250929. */
  model?: string;
  /**
   * Optional LLM client injection for hermetic tests. Production passes
   * undefined and the namer constructs a real Anthropic client from
   * anthropic_api_key. Tests pass a MockDishNamerClient.
   */
  llm_client?: DishNamerLLMClient;
  /**
   * Map from slug → display name. Reused from the PDF adapter's display
   * meta lookup so the LLM sees client-friendly names like
   * "Chicken Breast (skinless, cooked)" rather than the raw slug.
   */
  display_names: ReadonlyMap<string, string>;
  /**
   * Map from slug → DB category. Used by the subject filter to apply
   * category-tiered thresholds (oils filtered always, nuts/seeds at
   * ≥10g, grains/fruits/veg at ≥30g, proteins/dairy/supplements always
   * included). Reused from the solver's nutrition map.
   */
  ingredient_categories: ReadonlyMap<string, string>;
  /**
   * Authored fallback dish names per (day, slot). Read from the template
   * at orchestrator time and passed through here so we don't need to
   * import the template module from inside dish-namer.
   */
  authored_fallbacks: Record<number, Record<number, string>>;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface NameMealsResult {
  /** Map: day_number (1..7) → slot.index → dish name. Always populated for
   *  every (day, slot) in the plan, with fallback values used wherever the
   *  LLM didn't produce a usable name. */
  slot_dish_names: Record<number, Record<number, string>>;
  diagnostics: {
    /** True if the Anthropic API was called at all. False when the API
     *  key was missing or the LLM client was a mock that opted out. */
    api_called: boolean;
    /** Wall-clock duration of the LLM call (0 when api_called is false). */
    api_call_ms: number;
    /** Total input tokens consumed. 0 if api_called is false. */
    input_tokens: number;
    /** Total output tokens. 0 if api_called is false. */
    output_tokens: number;
    /** Estimated USD cost for this call. */
    estimated_cost_usd: number;
    /**
     * Per-meal source attribution: "llm" or "fallback". Useful for
     * observability — high fallback rate means LLM/parsing is broken.
     */
    source: Record<number, Record<number, "llm" | "fallback">>;
    /** Why the call failed (when api_called is true but parse failed),
     *  or empty when everything succeeded or the API was skipped. */
    failure_reason?: string;
    /** Names that were rejected post-parse (zero-length, too-long, dupe
     *  within plan, etc.) and caused a fallback. */
    rejected_names: Array<{
      day: number;
      slot: number;
      raw: string;
      reason: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// LLM client adapter
// ---------------------------------------------------------------------------

/**
 * Tool-use adapter the dish-namer uses to call Anthropic. Returns the
 * parsed tool-input JSON or throws. Production wraps the Anthropic SDK;
 * tests inject a mock that returns canned responses.
 */
export interface DishNamerLLMClient {
  callTool(args: {
    system: string;
    user: string;
    /** Maximum output tokens. */
    max_tokens?: number;
  }): Promise<DishNamerLLMResponse>;
}

export interface DishNamerLLMResponse {
  /** The parsed tool-input JSON. Caller validates against expected shape. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool_input: any;
  /** Token counts for cost tracking. */
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Subject filter (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Per-category portion thresholds for naming subject-eligibility.
 * Below the threshold, the ingredient is treated as seasoning/garnish
 * and filtered out before the LLM sees the meal. Categories not listed
 * are treated as "always include" (e.g. protein, seafood, supplement,
 * dairy, legume — meal-defining ingredients).
 */
export const SUBJECT_THRESHOLDS_G: Record<string, number> = {
  grain: 30,
  carb: 30,
  fruit: 30,
  vegetable: 30,
  fat: 10, // nut/seed/avocado/nut-butter range
};

/**
 * Slugs that are NEVER eligible to be named in a dish title regardless
 * of portion. Cooking media (oils, butters), condiments, beverages, and
 * herbs/aromatics that are seasoning by nature. These are filtered out
 * before the LLM call.
 */
export const NEVER_SUBJECT_SLUGS: ReadonlySet<string> = new Set([
  // Pure oils (the slug categorisation puts these in "fat" but they're
  // cooking media, not subjects)
  "olive_oil",
  "avocado_oil",
  "canola_oil",
  "vegetable_oil",
  "sesame_oil",
  "coconut_oil",
  "mct_oil",
  "ghee",
  // Butters (subject-eligible only in narrow cases like "Buttery Scallops"
  // where author has flagged butter at meaningful portion ≥30g — handled
  // by always treating butter as subject if grams ≥ 30g via category fat
  // threshold; but we exclude small-portion butter via the 10g threshold
  // which is reasonable. Keep butter NOT in NEVER_SUBJECT — let the
  // threshold rule handle it.)
  // Aromatics / herbs (vegetable category but garnish-portion)
  "basil_fresh",
  "cilantro_fresh",
  "garlic_raw",
  "ginger_raw",
  "mint_fresh",
  "parsley_fresh",
  "green_onion_raw",
  "jalapeno_raw",
  "lemon_raw",
  "lime_raw",
]);

/**
 * Categories that are NEVER subject-eligible regardless of portion.
 * Condiments and beverages — even if the solver puts 30g of ketchup in
 * a slot, "Ketchup Chicken" isn't a dish.
 */
export const NEVER_SUBJECT_CATEGORIES: ReadonlySet<string> = new Set([
  "condiment",
  "beverage",
]);
