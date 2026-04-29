/**
 * LLM meal generator — main entry point.
 *
 * Receives client + macro targets + distribution + hard_exclude, builds
 * the prompt, calls Anthropic with tool-use, parses the response, and
 * wraps the output in the existing WeekPlanSuccess facade so audit +
 * adapter + renderer continue to work without changes.
 *
 * On fatal parse failure: throws (caller decides whether to retry, fall
 * back, or surface error).
 */

import { AnthropicMealGeneratorClient } from "./anthropic-client";
import { parseSubmitPlanResponse } from "./parse";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { buildSlugList } from "./slug-list";
import type {
  GeneratePlanInput,
  GeneratePlanResult,
  MealGeneratorLLMClient,
  RawDay,
} from "./types";
import { getIngredientNutrition } from "../solver/ingredient-data";
import { getGramBounds } from "../solver/category-bounds";
import { computePerSlotTargets } from "../solver/per-slot-targets";
import { SolverBias } from "../types";
import type {
  PerSlotActuals,
  SolveDaySuccess,
  ZeroedSlug,
} from "../solver/types";
import type { DayPick, WeekPlanSuccess } from "../picker";
import { createClient } from "@supabase/supabase-js";

// Anthropic Sonnet pricing (as of 2026)
const COST_USD_PER_INPUT_TOKEN = 3 / 1_000_000;
const COST_USD_PER_OUTPUT_TOKEN = 15 / 1_000_000;

const COST_WARN_USD = 0.2;
const WALL_CLOCK_WARN_MS = 60_000;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function generatePlan(
  input: GeneratePlanInput,
): Promise<GeneratePlanResult> {
  // 1. Build the slug table for the prompt.
  const slugTable = await buildSlugList({ hardExclude: input.hard_exclude });

  // 2. Build the user prompt.
  const userPrompt = buildUserPrompt({
    input,
    slug_table: slugTable,
    retry_addendum: input.retry_addendum,
  });

  // 3. Resolve LLM client.
  const llmClient = resolveLLMClient(input);

  // 4. Call the LLM.
  const t0 = Date.now();
  let response: Awaited<ReturnType<MealGeneratorLLMClient["callTool"]>>;
  try {
    response = await llmClient.callTool({
      system: SYSTEM_PROMPT,
      user: userPrompt,
    });
  } catch (e) {
    const apiCallMs = Date.now() - t0;
    throw new Error(
      `meal-generator: LLM call failed after ${apiCallMs}ms — ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const apiCallMs = Date.now() - t0;
  const estimatedCostUsd =
    response.usage.input_tokens * COST_USD_PER_INPUT_TOKEN +
    response.usage.output_tokens * COST_USD_PER_OUTPUT_TOKEN;

  if (estimatedCostUsd > COST_WARN_USD) {
    console.warn(
      `[meal-generator] cost guardrail tripped: $${estimatedCostUsd.toFixed(4)} > $${COST_WARN_USD}`,
    );
  }
  if (apiCallMs > WALL_CLOCK_WARN_MS) {
    console.warn(
      `[meal-generator] wall-clock guardrail tripped: ${apiCallMs}ms > ${WALL_CLOCK_WARN_MS}ms`,
    );
  }

  // 5. Parse + validate the response.
  const approvedSlugs = await fetchApprovedSlugs();
  const allSlugsInResponse = new Set<string>();
  collectSlugs(response.tool_input, allSlugsInResponse);
  const nutritionMap = await getIngredientNutrition(
    Array.from(allSlugsInResponse).filter((s) => approvedSlugs.has(s)),
  );
  const gramBounds = new Map<string, { min: number; max: number }>();
  for (const [slug, nut] of nutritionMap) {
    gramBounds.set(slug, getGramBounds(slug, nut.category));
  }

  const parseResult = parseSubmitPlanResponse(response.tool_input, {
    approved_slugs: approvedSlugs,
    gram_bounds: gramBounds,
    hard_exclude: input.hard_exclude,
  });

  if (parseResult.fatal || !parseResult.plan) {
    let preview = "";
    try {
      preview = JSON.stringify(response.tool_input).slice(0, 600);
    } catch {
      preview = "(unstringifiable)";
    }
    console.warn(
      `[meal-generator] parse failed: ${parseResult.fatal} | preview: ${preview}`,
    );
    throw new Error(
      `meal-generator: parse failed — ${parseResult.fatal ?? "unknown"}`,
    );
  }

  // 6. Wrap in WeekPlanSuccess facade.
  // Need nutrition for ALL slugs that survived parsing (some may not have
  // been fetched in the first round if they weren't initially in tool_input).
  const survivingSlugs = new Set<string>();
  for (const day of parseResult.plan.days) {
    for (const meal of day.meals) {
      for (const ing of meal.ingredients) survivingSlugs.add(ing.slug);
    }
  }
  const fullNutritionMap = await getIngredientNutrition(Array.from(survivingSlugs));

  const weekPlan = wrapAsWeekPlanSuccess({
    rawDays: parseResult.plan.days,
    targets: input.targets,
    distribution: input.distribution,
    rest_distribution: input.rest_distribution,
    nutrition_map: fullNutritionMap,
  });

  return {
    plan: weekPlan,
    diagnostics: {
      api_call_ms: apiCallMs,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      estimated_cost_usd: estimatedCostUsd,
      rejected_meals: parseResult.rejected_meals,
      dropped_slugs: parseResult.dropped_slugs,
    },
  };
}

// ---------------------------------------------------------------------------
// Batch entry — fires N parallel generations and returns per-attempt outcomes.
// Used by the plan-selector pipeline (Option 4: best-of-N).
// ---------------------------------------------------------------------------

export type BatchAttempt =
  | { kind: "ok"; result: GeneratePlanResult }
  | { kind: "error"; message: string; api_call_ms?: number };

/**
 * Runs `count` independent generatePlan calls in parallel. Each attempt's
 * outcome is captured separately so a single failure doesn't take down
 * the batch. Use Promise.all (not Promise.allSettled directly because we
 * want the errors typed and inline).
 */
export async function generatePlanBatch(
  input: GeneratePlanInput,
  count = 3,
): Promise<BatchAttempt[]> {
  if (count < 1) throw new Error("generatePlanBatch: count must be >= 1");
  const promises: Array<Promise<BatchAttempt>> = [];
  for (let i = 0; i < count; i++) {
    const p = generatePlan(input).then(
      (result): BatchAttempt => ({ kind: "ok", result }),
      (err): BatchAttempt => ({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    promises.push(p);
  }
  return Promise.all(promises);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function resolveLLMClient(input: GeneratePlanInput): MealGeneratorLLMClient {
  if (input.llm_client) return input.llm_client;
  if (!input.anthropic_api_key || input.anthropic_api_key.trim().length === 0) {
    throw new Error(
      "meal-generator: anthropic_api_key required (LLM mode has no deterministic fallback)",
    );
  }
  return new AnthropicMealGeneratorClient({
    apiKey: input.anthropic_api_key,
    model: input.model,
  });
}

let _approvedSlugsCache: Set<string> | null = null;
async function fetchApprovedSlugs(): Promise<Set<string>> {
  if (_approvedSlugsCache) return _approvedSlugsCache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "meal-generator: SUPABASE_URL + key required to validate slugs",
    );
  }
  const client = createClient(url, key);
  const { data, error } = await client.from("ingredients").select("slug");
  if (error) throw new Error(`meal-generator: slug fetch failed — ${error.message}`);
  _approvedSlugsCache = new Set(
    (data ?? []).map((r) => String((r as { slug: string }).slug)),
  );
  return _approvedSlugsCache;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectSlugs(toolInput: any, out: Set<string>): void {
  if (!toolInput || typeof toolInput !== "object") return;
  // Walk the structure looking for objects with a `slug` string field.
  const stack: unknown[] = [toolInput];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== "object") continue;
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.slug === "string" && obj.slug.length > 0) {
      out.add(obj.slug);
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
}

// ---------------------------------------------------------------------------
// WeekPlanSuccess facade — wrap LLM output for downstream compatibility
// ---------------------------------------------------------------------------

export interface WrapArgs {
  rawDays: RawDay[];
  targets: GeneratePlanInput["targets"];
  distribution: GeneratePlanInput["distribution"];
  rest_distribution?: GeneratePlanInput["rest_distribution"];
  nutrition_map: Awaited<ReturnType<typeof getIngredientNutrition>>;
}

/**
 * Public: wrap raw parsed days into the WeekPlanSuccess facade. Exposed so
 * the apply-correction endpoint can re-ingest a coach-edited JSON payload
 * through the same wrapping logic (synthesizes solve diagnostics, slot
 * dish names, day kinds, distribution metadata).
 */
export function wrapAsWeekPlanSuccess(args: WrapArgs): WeekPlanSuccess {
  const { rawDays, targets, distribution, rest_distribution, nutrition_map } = args;

  const days: WeekPlanSuccess["days"] = rawDays.map((rawDay) => {
    // Day kind defaults to training (rest-day support is endurance-only;
    // the LLM doesn't currently designate rest days). Tagged as a
    // const-narrowed value so we can stay simple.
    const day_kind = "training" as const;
    const dayTargets = targets.training;
    const dayDistribution = distribution;
    void rest_distribution;

    // Build pick (slug + isAnchor per ingredient per slot)
    const pick: DayPick = {
      day: rawDay.day_number,
      day_kind,
      slots: rawDay.meals.map((m) => ({
        index: m.slot,
        ingredients: m.ingredients.map((i) => ({
          slug: i.slug,
          isAnchor: i.is_anchor,
        })),
      })),
      llm_calls_used: 1,
      retried: false,
    };

    // Build solve (slug + grams per ingredient per slot, with synthetic
    // diagnostics computed from nutrition lookups)
    let dailyKcal = 0,
      dailyP = 0,
      dailyC = 0,
      dailyF = 0,
      dailyNa = 0;
    const perSlotActuals: PerSlotActuals[] = [];
    const solveSlots = rawDay.meals.map((m) => {
      let slotP = 0,
        slotC = 0,
        slotF = 0,
        slotNa = 0;
      for (const ing of m.ingredients) {
        const nut = nutrition_map.get(ing.slug);
        if (!nut) continue;
        slotP += (ing.grams * nut.protein_g_per_100g) / 100;
        slotC += (ing.grams * nut.carbs_g_per_100g) / 100;
        slotF += (ing.grams * nut.fat_g_per_100g) / 100;
        slotNa += (ing.grams * nut.sodium_mg_per_100g) / 100;
      }
      const slotKcal = slotP * 4 + slotC * 4 + slotF * 9;
      perSlotActuals.push({
        slot_index: m.slot,
        protein_g: round1(slotP),
        carbs_g: round1(slotC),
        fat_g: round1(slotF),
        calories: round1(slotKcal),
        sodium_mg: round1(slotNa),
      });
      dailyP += slotP;
      dailyC += slotC;
      dailyF += slotF;
      dailyNa += slotNa;
      dailyKcal += slotKcal;

      return {
        index: m.slot,
        ingredients: m.ingredients.map((i) => ({ slug: i.slug, grams: i.grams })),
      };
    });

    const solve: SolveDaySuccess = {
      status: "SUCCESS",
      slots: solveSlots,
      diagnostics: {
        fallback_level: 10, // synthetic — LLM doesn't have a fallback ladder
        zeroed_slugs: [] as ZeroedSlug[],
        daily: {
          calories: round1(dailyKcal),
          protein_g: round1(dailyP),
          carbs_g: round1(dailyC),
          fat_g: round1(dailyF),
          sodium_mg: round1(dailyNa),
        },
        per_slot: perSlotActuals,
        objective_value: 0,
        bias: SolverBias.NEUTRAL,
        solve_time_ms: 0,
      },
    };

    // Populate template_meta.slot_dish_names from the LLM's dish_name
    // outputs. Adapter reads from this field — same wiring as the
    // dormant template orchestrator + dish-namer pair.
    const slot_dish_names: Record<number, string> = {};
    for (const m of rawDay.meals) {
      slot_dish_names[m.slot] = m.dish_name;
    }
    void computePerSlotTargets;

    return {
      day: rawDay.day_number,
      day_kind,
      pick,
      solve,
      targets: dayTargets,
      distribution: dayDistribution,
      template_meta: { slot_dish_names },
    };
  });

  return {
    status: "SUCCESS",
    days,
    diagnostics: {
      per_day: days.map((d) => ({
        day_number: d.day,
        day_kind: d.day_kind,
        llm_calls_used: 1,
        anchor_reprompt_fired: false,
        infeasibility_reprompt_fired: false,
        solver_status: "SUCCESS" as const,
        total_wall_clock_ms: 0,
        zeroed_slugs: [],
      })),
      total_llm_calls: 1,
      total_wall_clock_ms: 0,
      days_with_reprompts: 0,
      days_with_solver_fallback: 0,
      days_infeasible: 0,
    },
  };
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}
