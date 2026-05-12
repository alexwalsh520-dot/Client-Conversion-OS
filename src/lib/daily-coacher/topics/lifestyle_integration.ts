import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const LIFESTYLE_INTEGRATION_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Lifestyle Integration):

This is a Lifestyle Integration message. The coach is suggesting a habit or behavior that fits naturally into the client's life and stacks on top of what they already do (e.g., a 10-minute walk after lunch, a glass of water by the bed, weekend meal prep).

ANGLES TO PICK FROM:
  - Habit stacking onto something they already do
  - One small add-on, not a lifestyle overhaul
  - Connect the new habit to something they already care about
  - Make it ridiculously easy to start (lower the bar)
  - Frame it as an experiment, not a commitment

REMINDERS:
  - Pick a habit that fits the client's specific life (work hours, family situation, hobbies). Don't suggest morning runs to someone who works night shifts.
  - One habit per message. More than one and they'll do none.
  - Avoid prescribing duration or frequency unless the tip you're using does. "After lunch" is better than "for 10 minutes at 1pm".`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
