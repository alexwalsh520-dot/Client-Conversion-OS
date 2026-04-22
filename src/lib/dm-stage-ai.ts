import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-20250514";
// Bumped when the prompt changes so webhook re-classifies stale conversations.
const ANALYSIS_VERSION = "dm-stage-v2";

// The funnel on the client dashboard no longer uses goal/gap/stakes/qualified.
// Only `in_discovery` matters: after the `lead_engaged` tag, did the lead
// respond substantively to the next setter message (usually a discovery
// voice note)?
//
// `booking_readiness_score` is kept as a coarse 0–100 signal for the sales
// manager agent. `ai_confidence` is kept so we can down-weight uncertain
// calls. `stage_evidence` returns one short quote explaining the in_discovery
// verdict.
export interface DmStageClassification {
  in_discovery: boolean;
  booking_readiness_score: number;
  ai_confidence: number;
  stage_evidence: {
    in_discovery?: string;
  };
}

const SYSTEM_PROMPT = `You are classifying a fitness sales DM conversation.

You return a single yes/no on whether the prospect has entered the DISCOVERY
phase of the conversation.

Definition of IN_DISCOVERY:
The prospect has moved past a one-word acknowledgement and has started
opening up. They say something with real content about any of these:
- their goal (what result they want)
- their current situation (where they are now, what they've tried)
- what is holding them back or frustrating them
- why they are reaching out now

Examples that are IN_DISCOVERY (return true):
- "I want to lose 20 lbs before summer and I keep falling off on weekends."
- "Honestly I've been stuck for a year and my energy is shot."
- "My main goal is getting lean. I work out but my diet is garbage."

Examples that are NOT in_discovery (return false):
- "yeah"
- "ok"
- "k"
- "thanks"
- "👍"
- "interested"
- A single emoji or sticker
- "sounds good"
- One-word replies with no content
- The prospect has not replied at all after the setter's follow-up

Be strict. The bar is: "could a setter actually run discovery off this reply?"
If the reply is a bare acknowledgement, return false.

Also return:
- booking_readiness_score: integer 0–100 (rough feel for how close to booking)
- ai_confidence: number 0–1
- stage_evidence.in_discovery: one short quote/paraphrase justifying true,
  or a short reason for false.

Output JSON only. No markdown. Shape:
{"in_discovery": boolean, "booking_readiness_score": integer, "ai_confidence": number, "stage_evidence": {"in_discovery": string}}`;

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
  const evidence =
    typeof parsed.stage_evidence?.in_discovery === "string"
      ? parsed.stage_evidence.in_discovery
      : undefined;

  return {
    in_discovery: Boolean(parsed.in_discovery),
    booking_readiness_score: clampScore(parsed.booking_readiness_score, 0, 100, 0),
    ai_confidence: clampScore(parsed.ai_confidence, 0, 1, 0),
    stage_evidence: {
      in_discovery: evidence,
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
    max_tokens: 500,
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
