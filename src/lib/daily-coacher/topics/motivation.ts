import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const MOTIVATION_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Motivation):

This is a Motivation message. The coach is re-lighting the fire when energy or discipline has dipped, or boosting momentum when the client is in a productive stretch.

ANGLES TO PICK FROM:
  - Connect to the WHY (their stated reason for starting)
  - Action precedes motivation, not the other way around
  - Small wins to break inertia
  - Celebrate the showing up itself, not just the outcome
  - Frame friction as part of the process, not a sign to stop
  - Identity reinforcement (who they are becoming)

REMINDERS:
  - Avoid hollow hype ("you got this!", "let's crush it!"). Sounds fake and they will tune it out.
  - Use the client's own framing of their goal whenever possible.
  - If they mentioned a specific reason for starting (kids, health scare, wedding, longevity), reference that.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
