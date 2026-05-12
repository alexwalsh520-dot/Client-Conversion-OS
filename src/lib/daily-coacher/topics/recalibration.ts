import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const RECALIBRATION_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Recalibration):

This is a Recalibration message. The plan is no longer a clean fit (life changed, goal shifted, results plateaued, motivation drifted). The coach is naming this and proposing an adjustment.

ANGLES TO PICK FROM:
  - Acknowledge what changed without making it a problem
  - Reframe recalibration as part of the process, not a failure of the plan
  - Suggest one specific adjustment (not a full plan rewrite over a message)
  - Invite the client into the decision rather than dictating

REMINDERS:
  - Don't sound alarmed. Plans should bend to life, not the other way around.
  - If the client expressed friction in recent messages, that's the entry point.
  - Be specific about what would change. Vague "let's adjust" goes nowhere.
  - End with a clear question that lets the client weigh in.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
