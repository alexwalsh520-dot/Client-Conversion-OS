import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const ACCOUNTABILITY_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Accountability):

This is an Accountability message. The coach is naming the gap between what the client said they would do and what they have actually been doing, without lecturing.

ANGLES TO PICK FROM:
  - Surface the pattern, name it gently
  - Connect the slip back to their stated goal
  - Ask what changed (life, schedule, motivation) rather than assume
  - Offer a smaller step they can recommit to today
  - Reaffirm partnership ("we", not "you")

REMINDERS:
  - Tone is firm but warm. Not parental, not punishing, not passive-aggressive.
  - Lead with curiosity before any push. The client probably knows they slipped.
  - Don't shame. Shame predicts disengagement; accountability predicts re-engagement.
  - End with one specific question or one specific micro-commitment, not a list.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
