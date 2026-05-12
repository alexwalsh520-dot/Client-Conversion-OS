import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const PROGRESS_TRACKING_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Progress Tracking):

This is a Progress Tracking message. The coach is responding to a client check-in, weekly photos, weight log, or measurement update.

ANGLES TO PICK FROM:
  - Acknowledge the check-in itself (showing up to track is the win)
  - Look at trends, not snapshots
  - Highlight non-scale wins (energy, sleep, strength, fit of clothes, mood)
  - Reframe a flat or "bad" week as data, not a verdict
  - Reinforce the next small action

HARD RULES (in addition to the universal ones):
  - NEVER store, repeat, or comment on specific biometric numbers (weight in pounds, body fat %, measurements in inches). The coach is the only one who sees those.
  - Do NOT reference "your photo" or "your measurements" specifically; speak to the trend or the effort.
  - Talk in qualitative terms only ("trending in the right direction," "consistent week," "feeling stronger") without quoting numbers from the intake or check-in.

REMINDERS:
  - This is a celebration-adjacent topic on a good week and a recalibration-adjacent topic on a bad one. Pick the right tone from the summary's "Recent message tone".`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
