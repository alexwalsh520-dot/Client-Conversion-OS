import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const ONBOARDING_MOMENTUM_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Onboarding Momentum):

This is an Onboarding Momentum message. The client is in their first 14 days, and the coach is keeping them engaged, building habit consistency, and addressing early-friction before it becomes early-dropout.

ANGLES TO PICK FROM:
  - Welcome and warmth (especially in the first few days)
  - Set realistic expectations for the first weeks (it's about reps, not results)
  - Address the specific obstacle they flagged in their onboarding (referenced in the summary)
  - Reinforce one small habit they have already started
  - Open a low-pressure channel for questions

REMINDERS:
  - Do NOT pile on a list of things to do. One small ask, max.
  - Reference their onboarding-call language. They mentioned specific reasons for starting; use them.
  - Match the program's first-two-weeks rhythm. If they just started, lean welcoming. If they're approaching day 14, lean reinforcing.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
