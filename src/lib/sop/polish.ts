// AI Polish: take raw or messy SOP HTML and reformat it consistently
// to the CCOS SOP template. Preserves all wording; restructures
// presentation (headings, lists, sections).
//
// Used by:
//   - The "Polish with AI" button in the editor
//   - The PDF/DOCX import flow (auto-polish after text extraction)
//
// Hard rules:
//   - Output is HTML only — no markdown fences, no prose preamble
//   - Tag whitelist matches the editor + sanitizer
//   - No em-dashes (CCOS-wide memory rule)

import Anthropic from "@anthropic-ai/sdk";
import { sanitizeSopHtml } from "./sanitize";
import { logAiUsage } from "@/lib/ai-usage";

const MODEL = "claude-sonnet-4-5-20250929";

const SYSTEM_PROMPT = `You are a documentation formatter for an internal company SOP (Standard Operating Procedure) library. Your only job is to take messy or unformatted SOP content and reformat it consistently to the company's template. You do NOT change the meaning, add new information, or remove substantive content.

OUTPUT FORMAT (non-negotiable):
- Return ONLY HTML. No markdown fences, no preamble like "Here is the formatted SOP," no closing remarks.
- Use only these tags: <p>, <br>, <h1>, <h2>, <h3>, <strong>, <em>, <code>, <ul>, <ol>, <li>, <blockquote>, <a>, <img>, <hr>
- The first heading should be <h2> (not <h1>) since the SOP's title is displayed separately by the viewer.
- Preserve any <img> tags that exist in the input — never remove or change them.

TEMPLATE STRUCTURE (follow when the content fits):
1. Brief overview paragraph (1-2 sentences). What the SOP covers, who it's for.
2. <h2>When to use it</h2> followed by 1-3 bullet points (only if this naturally maps to the content).
3. <h2>Steps</h2> followed by an <ol> (ordered list) of numbered steps. Use nested <ul> for sub-points within a step. Keep image tags inline within the step they belong to.
4. <h2>Notes</h2> at the end with bulleted caveats, exceptions, or warnings (only if the content includes them).

If the content doesn't fit "steps" (e.g., a reference doc, glossary, policy statement), skip steps and use <h2> sections with paragraphs and lists as appropriate. Use your judgment.

WRITING RULES:
- PRESERVE EVERY MEANINGFUL WORD. Restructure presentation only.
- NEVER use em-dashes (U+2014, the long dash) or en-dashes (U+2013) anywhere in your output. Use commas, periods, parentheses, or restructure the sentence.
- Convert run-on instructions into discrete numbered steps when the content is clearly procedural.
- Convert prose bullet-like content ("First do X. Then do Y. Then do Z.") into actual <ol>/<ul> lists.
- Bold critical words sparingly: action verbs at the start of steps, names of tools, key concepts.
- Keep tone professional but warm. Don't make it sound corporate or stiff.
- If the input is already well-formatted, return it with minimal changes.`;

export interface PolishResult {
  html: string;
  inputTokens: number;
  outputTokens: number;
}

export async function polishSopHtml(rawHtml: string, titleHint?: string): Promise<PolishResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  if (!rawHtml || !rawHtml.trim()) {
    return { html: "", inputTokens: 0, outputTokens: 0 };
  }

  const userPrompt = `<sop_title>${titleHint ?? "(untitled)"}</sop_title>

<raw_content>
${rawHtml}
</raw_content>

Reformat the raw content above into the SOP template. Return only the formatted HTML body.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: [
      { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  logAiUsage({ feature: "sop-polish", model: MODEL, usage: response.usage });

  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude returned no text block for SOP polish");
  }

  let html = block.text.trim();
  // Strip any markdown fences Claude added despite the instruction
  const fence = html.match(/^```(?:html)?\s*([\s\S]*?)```$/);
  if (fence) html = fence[1].trim();

  // Strip em-dashes and en-dashes as a safety net (matches CCOS-wide rule)
  html = html
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s*–\s*/g, ", ")
    .replace(/[—–]/g, "-");

  // Sanitize before returning so caller doesn't have to
  html = sanitizeSopHtml(html);

  return {
    html,
    inputTokens: response.usage.input_tokens ?? 0,
    outputTokens: response.usage.output_tokens ?? 0,
  };
}
