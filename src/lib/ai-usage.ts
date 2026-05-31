import { getServiceSupabase } from "@/lib/supabase";

// Tracks real Anthropic API spend so the founder can watch a $50/month budget.
// Everything here is built to be ACCURATE: cost is computed from the exact token
// counts the API returns, never guessed. Logging is fire-and-forget and fully
// swallowed on error so it can NEVER break the feature that made the API call.

// Shape of the `usage` object returned by `messages.create`. Cache fields are
// optional — older calls / non-cached calls simply omit them.
export type AnthropicUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

// USD per 1,000,000 tokens (per MTok), broken out by token class.
type ModelPricing = {
  input: number; // standard input tokens
  output: number; // output tokens
  cacheWrite: number; // cache-creation input tokens (5m write)
  cacheRead: number; // cache-read input tokens
};

const MILLION = 1_000_000;

// Per-model pricing table. Easy to extend: add a new model id with its four
// per-MTok rates. Anthropic publishes these on the pricing page.
const PRICING: Record<string, ModelPricing> = {
  // Claude Sonnet 4 (the model the ads-tracker vision OCR + messaging insights use)
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  // Claude Sonnet 4.5 — same headline pricing as Sonnet 4; used by sales-hub / coacher.
  "claude-sonnet-4-5-20250929": { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 },
  // Claude Haiku 4.5
  "claude-haiku-4-5": { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
};

// Sane fallback if a model id isn't in the table yet. We use Sonnet-class rates
// (the more expensive of the models actually in use) so an unknown model is more
// likely to OVER-estimate than silently under-count the budget.
const DEFAULT_PRICING: ModelPricing = { input: 3.0, output: 15.0, cacheWrite: 3.75, cacheRead: 0.3 };

export function getPricing(model: string): ModelPricing {
  return PRICING[model] ?? DEFAULT_PRICING;
}

export type CostBreakdown = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

// Pure, unit-testable cost computation. Returns the normalized token counts plus
// total USD cost. Missing / null token fields are treated as 0.
export function computeCost(model: string, usage: AnthropicUsage | null | undefined): CostBreakdown {
  const inputTokens = Math.max(0, Number(usage?.input_tokens) || 0);
  const outputTokens = Math.max(0, Number(usage?.output_tokens) || 0);
  const cacheWriteTokens = Math.max(0, Number(usage?.cache_creation_input_tokens) || 0);
  const cacheReadTokens = Math.max(0, Number(usage?.cache_read_input_tokens) || 0);

  const p = getPricing(model);
  const costUsd =
    (inputTokens * p.input +
      outputTokens * p.output +
      cacheWriteTokens * p.cacheWrite +
      cacheReadTokens * p.cacheRead) /
    MILLION;

  return { inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, costUsd };
}

export type LogAiUsageArgs = {
  feature: string; // short stable id, e.g. "ads-creative-copy", "ads-messaging-insights"
  model: string;
  usage: AnthropicUsage | null | undefined;
};

// Fire-and-forget: log one API call's token usage + computed cost into the
// `ai_usage` table. NEVER throws — any failure (table missing, network, env
// not configured) is caught and logged to console. Callers should NOT await
// this in a way that blocks their response; calling it without `await` is fine.
export function logAiUsage({ feature, model, usage }: LogAiUsageArgs): void {
  // Compute synchronously (cheap, can't fail) so a usage object captured at the
  // call site isn't lost, then persist asynchronously without blocking.
  let breakdown: CostBreakdown;
  try {
    breakdown = computeCost(model, usage);
  } catch (err) {
    console.error("[ai-usage] cost computation failed:", err);
    return;
  }

  void (async () => {
    try {
      const supabase = getServiceSupabase();
      const { error } = await supabase.from("ai_usage").insert({
        feature,
        model,
        input_tokens: breakdown.inputTokens,
        output_tokens: breakdown.outputTokens,
        cache_write_tokens: breakdown.cacheWriteTokens,
        cache_read_tokens: breakdown.cacheReadTokens,
        // numeric(10,6) column — keep full precision; per-call costs are tiny.
        cost_usd: Number(breakdown.costUsd.toFixed(6)),
      });
      if (error) {
        console.error("[ai-usage] insert failed (non-fatal):", error.message);
      }
    } catch (err) {
      console.error("[ai-usage] logging failed (non-fatal):", err);
    }
  })();
}
