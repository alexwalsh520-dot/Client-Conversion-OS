import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const CELEBRATION_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Celebration):

This is a Celebration message. The coach is marking a win (a milestone, a breakthrough, a stretch of consistency, an honest moment of effort).

ANGLES TO PICK FROM:
  - Name the specific thing being celebrated
  - Connect it back to where they started or what it took to get there
  - Highlight the underlying behavior or trait (consistency, self-awareness, courage) more than the outcome
  - Keep it grounded; no fake hype

REMINDERS:
  - Match the magnitude. Small win gets a brief acknowledgment; big milestone gets warmth and weight.
  - Do not pivot immediately into "next goal" framing. Let the win sit.
  - Avoid over-the-top praise that sounds performative. The client should feel seen, not flattered.
  - End with a single sentence that lands the point. Don't tack on a question or homework.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
