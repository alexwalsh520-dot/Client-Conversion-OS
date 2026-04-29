/**
 * Phase B6a-pivot dish-namer — production Anthropic adapter.
 *
 * Wraps the Anthropic SDK in the DishNamerLLMClient interface. Uses
 * tool-use for structured output enforcement. Tests inject
 * MockDishNamerClient instead via NameMealsInput.llm_client.
 */

import Anthropic from "@anthropic-ai/sdk";
import { DISH_NAMES_TOOL } from "./prompt";
import type { DishNamerLLMClient, DishNamerLLMResponse } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
// 21 dish names × ~30 chars each + JSON wrapper = ~800 tokens of pure
// payload. Bumped to 2500 for headroom — Sonnet may include a thinking-
// preamble before submitting the tool call. Cheap; no real wall-clock
// cost since the model stops at the tool call.
const DEFAULT_MAX_TOKENS = 2500;

export interface AnthropicDishNamerClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicDishNamerClient implements DishNamerLLMClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicDishNamerClientOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async callTool(args: {
    system: string;
    user: string;
    max_tokens?: number;
  }): Promise<DishNamerLLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: args.max_tokens ?? this.maxTokens,
      system: args.system,
      tools: [DISH_NAMES_TOOL],
      tool_choice: { type: "tool", name: DISH_NAMES_TOOL.name },
      messages: [{ role: "user", content: args.user }],
    });

    // Find the tool_use block
    const toolBlock = response.content.find(
      (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
    );
    if (!toolBlock) {
      throw new Error(
        `dish-namer: Anthropic response had no tool_use block (stop_reason=${response.stop_reason})`,
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
 * Mock client for hermetic tests. Constructor takes a function that
 * returns the canned tool_input + usage for a given (system, user).
 * Tests can simulate happy path, malformed responses, errors, etc.
 */
export class MockDishNamerClient implements DishNamerLLMClient {
  private callIndex = 0;

  constructor(
    private readonly responder: (args: {
      callIndex: number;
      system: string;
      user: string;
    }) => DishNamerLLMResponse | Promise<DishNamerLLMResponse>,
  ) {}

  async callTool(args: {
    system: string;
    user: string;
  }): Promise<DishNamerLLMResponse> {
    const callIndex = this.callIndex++;
    return Promise.resolve(
      this.responder({ callIndex, system: args.system, user: args.user }),
    );
  }

  get callCount(): number {
    return this.callIndex;
  }
}
