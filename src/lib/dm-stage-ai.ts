import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-20250514";
const ANALYSIS_VERSION = "dm-stage-v1";

export interface DmStageClassification {
  goal_clear: boolean;
  gap_clear: boolean;
  stakes_clear: boolean;
  qualified: boolean;
  booking_readiness_score: number;
  ai_confidence: number;
  stage_evidence: {
    goal_clear?: string;
    gap_clear?: string;
    stakes_clear?: string;
    qualified?: string;
  };
}

const SYSTEM_PROMPT = `You are classifying fitness sales DM conversations into funnel stages.

Be conservative. Accuracy matters more than optimism.

Return TRUE only when the conversation contains explicit evidence.
If the stage is implied, weak, or ambiguous, return FALSE.

Stage definitions:
- goal_clear: The prospect clearly states the result they want.
- gap_clear: The prospect clearly explains both where they are now OR what is missing/holding them back.
- stakes_clear: The prospect clearly states the cost of staying stuck, why now matters, or what happens if nothing changes.
- qualified: The conversation clearly shows both fit for the coaching call and real ability/willingness to invest beyond a low-ticket freebie mindset.

Also return:
- booking_readiness_score: integer 0-100
- ai_confidence: number 0-1
- stage_evidence: one short quote/paraphrase per TRUE stage

Output JSON only. No markdown.`;

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function clampScore(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function parseClassification(text: string): DmStageClassification {
  const cleaned = stripCodeFence(text);
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("AI response did not contain JSON");
  }

  const parsed = JSON.parse(match[0]);
  return {
    goal_clear: Boolean(parsed.goal_clear),
    gap_clear: Boolean(parsed.gap_clear),
    stakes_clear: Boolean(parsed.stakes_clear),
    qualified: Boolean(parsed.qualified),
    booking_readiness_score: clampScore(parsed.booking_readiness_score, 0, 100, 0),
    ai_confidence: clampScore(parsed.ai_confidence, 0, 1, 0),
    stage_evidence: {
      goal_clear:
        typeof parsed.stage_evidence?.goal_clear === "string" ? parsed.stage_evidence.goal_clear : undefined,
      gap_clear:
        typeof parsed.stage_evidence?.gap_clear === "string" ? parsed.stage_evidence.gap_clear : undefined,
      stakes_clear:
        typeof parsed.stage_evidence?.stakes_clear === "string" ? parsed.stage_evidence.stakes_clear : undefined,
      qualified:
        typeof parsed.stage_evidence?.qualified === "string" ? parsed.stage_evidence.qualified : undefined,
    },
  };
}

export function getDmAnalysisVersion() {
  return ANALYSIS_VERSION;
}

export async function analyzeDmStages(
  transcript: string,
): Promise<DmStageClassification | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({ apiKey });
  const prompt = `Classify this DM conversation.\n\n${transcript}`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 700,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n")
    .trim();

  return parseClassification(text);
}
