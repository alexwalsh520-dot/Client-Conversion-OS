import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const MEETING_PREP_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Meeting Prep):

This is a Meeting Prep message, sent 24-48 hours before a scheduled coaching call. The coach is setting an intention for the meeting and inviting the client to bring specific things to think about.

ANGLES TO PICK FROM:
  - Quick reminder of when the meeting is (if mentioned in summary or notes)
  - 1-2 things for the client to think through before the call (wins, friction, questions)
  - Light, not heavy. The meeting itself is where depth happens.
  - Invite candor ("come ready to be honest about what's working and what isn't")

REMINDERS:
  - Do NOT propose a full agenda. Two prompts max.
  - Match the client's current state from the summary. If they're slipping, prompts should help them prepare to talk about it without dread.
  - If no upcoming meeting is referenced anywhere in the summary or recent notes, frame as "next time we meet" rather than inventing a date.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
