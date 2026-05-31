// Auto pipeline: call Anthropic API → get HTML body for the meal plan.
//
// Reads the prebuilt prompt from plan-prompt-auto.ts, attaches the
// two reference plan PDFs as `document` content blocks (URL source),
// sends the message to Sonnet 4.5, and returns the raw HTML body
// the model produced.
//
// Caller is responsible for wrapping the HTML in the CCOS shell via
// wrapAsFullHtml() and rendering to PDF via renderHtmlToPdf().
//
// Model + caching: Sonnet 4.5 (claude-sonnet-4-5-20250929), same
// model the Daily Coacher uses. No system prompt caching here — the
// prompt is per-client and changes every call.

import Anthropic from "@anthropic-ai/sdk";
import { REFERENCE_PLAN_URLS, buildAutoPlanPrompt } from "./plan-prompt-auto";
import { logAiUsage } from "@/lib/ai-usage";
import type { IntakeTargetsResult } from "./intake-targets";
import type { AdjustedTargets } from "./macro-adjust";

const MODEL = "claude-sonnet-4-5-20250929";
// Detailed plans run 18-22k tokens of output (Zach's hit the prior
// 16k ceiling mid-Substitutions, before Shopping List + Variance
// could land). 32k is comfortably above the worst case we've seen;
// max_tokens is a ceiling not a cost, so unused budget is free.
// Sonnet 4.5 supports up to 64k if we ever need more.
const MAX_TOKENS = 32000;

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("Missing ANTHROPIC_API_KEY");
  return key;
}

export interface GeneratePlanArgs {
  intake: Extract<IntakeTargetsResult, { ok: true }>;
  targets: AdjustedTargets;
  coachInternalName: string | null;
  /** Today's date formatted "Mon DD, YYYY". Used in the prompt + on the PDF cover. */
  generatedDateLabel: string;
}

export interface GeneratePlanResult {
  /** Raw HTML body fragment (no <html>/<head>/<body> wrappers). */
  bodyHtml: string;
  /** Tokens used — useful for cost monitoring. */
  inputTokens: number;
  outputTokens: number;
  /** Full prompt text sent to the model (for debugging). */
  promptDebug: string;
}

/**
 * Generate the HTML body for a client's meal plan via the Anthropic
 * API with reference PDFs attached. Returns the raw fragment + token
 * usage. Does NOT wrap or render — caller composes the pipeline.
 *
 * Throws on API failure. The caller (cron sweep or admin endpoint)
 * is responsible for retry / circuit-breaker logic.
 */
export async function generatePlanHtml(
  args: GeneratePlanArgs,
): Promise<GeneratePlanResult> {
  const prompt = buildAutoPlanPrompt({
    intake: args.intake,
    targets: args.targets,
    coachInternalName: args.coachInternalName,
    generatedDateLabel: args.generatedDateLabel,
  });

  const anthropic = new Anthropic({ apiKey: getApiKey() });

  // Build the message content: PDF documents first, then the prompt text.
  // Anthropic accepts URL-source documents directly so we don't need to
  // fetch+base64-encode the reference plans ourselves.
  const content: Anthropic.MessageCreateParams["messages"][number]["content"] = [
    ...REFERENCE_PLAN_URLS.map((url, idx) => ({
      type: "document" as const,
      source: { type: "url" as const, url },
      title: `Reference plan ${idx + 1}`,
    })),
    {
      type: "text" as const,
      text: prompt,
    },
  ];

  // Use the streaming API. The Anthropic SDK refuses non-streaming
  // requests when max_tokens is high enough that the call could exceed
  // 10 minutes (which is true at our 32k ceiling). messages.stream()
  // accepts the same params; .finalMessage() resolves with the same
  // response shape as messages.create() once the stream completes.
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content }],
  });
  const response = await stream.finalMessage();

  logAiUsage({ feature: "nutrition-generate-plan-html", model: MODEL, usage: response.usage });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude returned no text block for meal plan generation");
  }

  return {
    bodyHtml: cleanModelOutput(textBlock.text),
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
    promptDebug: prompt,
  };
}

/**
 * Post-process the model's output:
 *   - strip surrounding markdown code fences if the model added them
 *   - strip any em-dashes / en-dashes that slipped past the prompt rule
 *     (belt-and-suspenders — the prompt also bans them)
 *   - trim leading/trailing whitespace
 */
function cleanModelOutput(raw: string): string {
  let text = raw.trim();
  // Strip ```html ... ``` or ``` ... ``` wrappers
  text = text.replace(/^```(?:html)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  // Belt-and-suspenders dash strip
  text = text.replace(/—/g, ",").replace(/–/g, "-");
  return text.trim();
}
