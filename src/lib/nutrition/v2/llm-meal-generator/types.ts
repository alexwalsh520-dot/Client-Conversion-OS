/**
 * LLM meal generator — public types.
 *
 * Replaces the template-lookup + glpk-solver pipeline stage with a
 * structured Anthropic tool-use call that returns slug+grams JSON
 * for the entire 7-day plan in one batched request. Wraps the LLM
 * output in the existing WeekPlanSuccess facade so audit + adapter +
 * renderer continue to work unchanged.
 *
 * Templates and solver remain in the repo (dormant) for future
 * reactivation if the LLM approach hits a wall.
 */

import type {
  AllergyFlag,
  BuildSpec,
  BuildType,
  DietaryStyle,
  MealDistribution,
  MedicalFlag,
} from "../types";
import type { MacroTargets } from "../../macro-calculator";
import type { WeekPlanSuccess } from "../picker";

// ---------------------------------------------------------------------------
// LLM client interface
// ---------------------------------------------------------------------------

/** Tool-use adapter the generator uses. Tests inject a mock. */
export interface MealGeneratorLLMClient {
  callTool(args: {
    system: string;
    user: string;
    max_tokens?: number;
  }): Promise<MealGeneratorLLMResponse>;
}

export interface MealGeneratorLLMResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tool_input: any;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Generator inputs
// ---------------------------------------------------------------------------

/**
 * Subset of the client profile the LLM needs to pick meals. Pulled from
 * the intake-loader output by run-pipeline. The LLM uses this to apply
 * hard_exclude rules, scale gram portions to the client's calorie
 * budget (via targets), and reason about training-vs-rest meal
 * compositions for endurance builds.
 */
export interface ClientProfile {
  first_name: string;
  last_name: string;
  sex: "male" | "female";
  weight_kg: number;
  height_cm: number;
  age: number;
  build_type: BuildType;
  dietary_style: DietaryStyle | null;
  allergy_flags: AllergyFlag[];
  medical_flags: MedicalFlag[];
  on_stimulant: boolean;
}

export interface GeneratePlanInput {
  client_profile: ClientProfile;
  /** Daily macro targets (training + rest). The LLM produces 7 days
   *  matching training-day vs rest-day distribution as appropriate. */
  targets: { training: MacroTargets; rest: MacroTargets };
  build_spec: BuildSpec;
  /** Distribution defining slot count + per-slot macro percentages. */
  distribution: MealDistribution;
  /** Optional rest-day distribution (Endurance only). */
  rest_distribution?: MealDistribution;
  /** Hard-excluded slugs derived from allergy/medical/dietary rules. */
  hard_exclude: ReadonlySet<string>;
  /** Anthropic API key. Empty/missing → throws (LLM mode requires API). */
  anthropic_api_key: string;
  /** Optional model override. Defaults to claude-sonnet-4-5-20250929. */
  model?: string;
  /** Optional client injection for hermetic tests. Production passes
   *  undefined and the generator constructs an Anthropic client. */
  llm_client?: MealGeneratorLLMClient;
  /**
   * Optional retry hint for the second-attempt call. Populated by
   * run-pipeline when the macro-verifier rejects the first attempt
   * with per-day drift details.
   */
  retry_addendum?: string;
}

// ---------------------------------------------------------------------------
// Raw LLM response shape (what we expect from the tool call)
// ---------------------------------------------------------------------------

export interface RawIngredient {
  slug: string;
  grams: number;
  is_anchor: boolean;
}

export interface RawMeal {
  slot: number;
  name: string;
  dish_name: string;
  ingredients: RawIngredient[];
}

export interface RawDay {
  day_number: number;
  weekday: string;
  meals: RawMeal[];
}

export interface RawPlan {
  days: RawDay[];
}

// ---------------------------------------------------------------------------
// Generator output
// ---------------------------------------------------------------------------

export interface GeneratePlanResult {
  /** Wrapped in the existing WeekPlanSuccess facade so downstream
   *  (audit, adapter, renderer) work without changes. */
  plan: WeekPlanSuccess;
  diagnostics: {
    api_call_ms: number;
    input_tokens: number;
    output_tokens: number;
    estimated_cost_usd: number;
    /** Per-meal source attribution. All "llm" in success path; on
     *  parse-fallback or validation rejection, individual meals may
     *  be marked "fallback_skip" (caller decides whether to retry). */
    rejected_meals: Array<{
      day_number: number;
      slot: number;
      reason: string;
    }>;
    /** Slugs the parser had to drop (because they were not in the
     *  approved set, or were in the merged hard_exclude). Surfaced so
     *  the plan-selector can score allergen leaks / dietary violations
     *  / invalid slugs as hard errors at the LLM-attempt level, even
     *  when the parser scrubs them before audit sees them. */
    dropped_slugs: Array<{
      day_number: number;
      slot: number;
      slug: string;
      reason: "invalid_slug" | "hard_exclude";
    }>;
    /** Reason the call failed (parse error, schema violation, API
     *  error). Empty when successful. */
    failure_reason?: string;
  };
}
