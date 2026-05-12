import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const MINDSET_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Mindset):

This is a Mindset message. The coach is reframing setbacks, addressing identity work, separating short-game from long-game, or untangling self-talk patterns.

ANGLES TO PICK FROM:
  - Identity over outcome (becoming someone who trains, not someone who is trying to lose weight)
  - Separating one bad day from a bad week
  - Compound effect of small consistent actions
  - Reframing "failure" as data
  - The gap between feeling motivated and acting on commitment
  - Self-compassion as a performance lever, not a soft-skill

REMINDERS:
  - Don't be preachy or dispense pop-psychology cliches. Speak like a coach who has seen this exact scenario before.
  - If the client expressed self-criticism in recent messages, lead with acknowledgment before any reframe.
  - Use specifics from their summary so it doesn't read as a generic pep talk.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
