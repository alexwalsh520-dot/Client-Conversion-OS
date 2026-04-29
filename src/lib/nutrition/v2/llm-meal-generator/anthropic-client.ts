/**
 * Anthropic tool-use adapter for the meal generator.
 *
 * Production wraps the Anthropic SDK; tests inject MockMealGeneratorClient
 * via GeneratePlanInput.llm_client.
 */

import Anthropic from "@anthropic-ai/sdk";
import { SUBMIT_PLAN_TOOL } from "./prompt";
import type {
  MealGeneratorLLMClient,
  MealGeneratorLLMResponse,
} from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
// 7 days × 4-5 ingredients × ~12 chars = ~250 tokens of pure ingredient
// payload per day. Plus dish names, day structure, JSON wrapper. Estimated
// ~3500-4000 output tokens for a full plan; leaving generous headroom for
// model preamble or self-correction.
const DEFAULT_MAX_TOKENS = 8000;

export interface AnthropicMealGeneratorClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicMealGeneratorClient implements MealGeneratorLLMClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicMealGeneratorClientOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async callTool(args: {
    system: string;
    user: string;
    max_tokens?: number;
  }): Promise<MealGeneratorLLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: args.max_tokens ?? this.maxTokens,
      system: args.system,
      tools: [SUBMIT_PLAN_TOOL],
      tool_choice: { type: "tool", name: SUBMIT_PLAN_TOOL.name },
      messages: [{ role: "user", content: args.user }],
    });

    const toolBlock = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    if (!toolBlock) {
      throw new Error(
        `meal-generator: Anthropic response had no tool_use block (stop_reason=${response.stop_reason})`,
      );
    }

    return {
      tool_input: toolBlock.input,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}

/**
 * Mock client for hermetic tests. Constructor takes a function returning
 * a canned response; tests can simulate happy path, errors, malformed
 * responses, etc.
 */
export class MockMealGeneratorClient implements MealGeneratorLLMClient {
  private callIndex = 0;

  constructor(
    private readonly responder: (args: {
      callIndex: number;
      system: string;
      user: string;
    }) => MealGeneratorLLMResponse | Promise<MealGeneratorLLMResponse>,
  ) {}

  async callTool(args: {
    system: string;
    user: string;
  }): Promise<MealGeneratorLLMResponse> {
    const callIndex = this.callIndex++;
    return Promise.resolve(
      this.responder({ callIndex, system: args.system, user: args.user }),
    );
  }

  get callCount(): number {
    return this.callIndex;
  }
}
