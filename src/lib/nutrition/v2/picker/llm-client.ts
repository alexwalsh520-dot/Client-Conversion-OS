/**
 * Phase B3 — LLM client for the slot picker.
 *
 * Production: Anthropic claude-sonnet-4-5-20250929 — same model the existing
 * generator uses, for parity. Tests inject MockLLMClient via the picker's
 * options.llmClient parameter to avoid burning tokens.
 *
 * The client uses raw text response with JSON parsing (matching legacy
 * generator pattern). No tool use — the LLM returns JSON in the response
 * and pickSlotsForDay parses it. This keeps prompt + response shape
 * inspectable in logs.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient } from "./types";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";
const DEFAULT_MAX_TOKENS = 8000;

export interface AnthropicLLMClientOptions {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Production LLM client that hits Anthropic's API.
 */
export class AnthropicLLMClient implements LLMClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(opts: AnthropicLLMClientOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(args: { system: string; user: string; label?: string }): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: args.system,
      messages: [{ role: "user", content: args.user }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(
        `LLM client (${args.label ?? "unlabeled"}): no text block in response`,
      );
    }
    return textBlock.text;
  }
}

/**
 * Mock LLM client for smoke tests. Constructor takes a function that maps
 * (call_index, system, user) → response string. Tests can return canned
 * JSON or simulate validation failures.
 */
export class MockLLMClient implements LLMClient {
  private callIndex = 0;
  private readonly responder: (args: {
    callIndex: number;
    system: string;
    user: string;
    label?: string;
  }) => string | Promise<string>;

  constructor(
    responder: (args: {
      callIndex: number;
      system: string;
      user: string;
      label?: string;
    }) => string | Promise<string>,
  ) {
    this.responder = responder;
  }

  async complete(args: { system: string; user: string; label?: string }): Promise<string> {
    const callIndex = this.callIndex++;
    return Promise.resolve(this.responder({ callIndex, ...args }));
  }

  /** How many calls were made. Useful for assertions. */
  get callCount(): number {
    return this.callIndex;
  }
}
