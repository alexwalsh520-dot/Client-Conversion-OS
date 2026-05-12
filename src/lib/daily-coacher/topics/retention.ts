import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const RETENTION_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Retention):

This is a Retention message. The client is in the late stages of their program (last few weeks), and the coach is opening the conversation about continuing.

ANGLES TO PICK FROM:
  - Acknowledge how far they have come (not in numbers, in changes you can name)
  - Remind them what got built was infrastructure, not a finished result
  - Frame continuation as "keeping momentum" not "buying again"
  - Invite a low-pressure conversation about what comes next
  - Reference the long-game version of their goal

REMINDERS:
  - Do NOT pitch hard. This message opens a door, it does not close a sale.
  - Avoid scarcity tactics, urgency language, or anything that smells like marketing copy.
  - End with an invitation, not a CTA. Examples: "Want to talk about what's next?" or "Open to chatting about staying on this trajectory?"`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
