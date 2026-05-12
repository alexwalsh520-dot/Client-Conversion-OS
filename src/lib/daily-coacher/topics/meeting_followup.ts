import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const MEETING_FOLLOWUP_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Meeting Follow-up):

This is a Meeting Follow-up message, sent within 24-48 hours after a coaching call. The coach is reinforcing what was discussed and locking in next actions.

ANGLES TO PICK FROM:
  - Echo back the most important takeaway from the meeting
  - Confirm the one or two action items they committed to
  - Acknowledge something the client said that landed (vulnerability, insight, win)
  - Open the door for between-meeting check-ins

REMINDERS:
  - The "Last meeting takeaway" line in the summary is your primary source. Build the message around it.
  - If no meeting is logged in the summary, this draft will not have specific content to reinforce. In that case, write a softer "checking in since we last talked" message.
  - Keep it short. The client just heard everything in real time; this is a reminder, not a recap.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
