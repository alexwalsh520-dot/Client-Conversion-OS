import type { SummaryInputs } from "../summary-inputs";
import type { TopicSpec } from "./registry";
import { deriveCommonTags } from "./_shared";

export const RECOVERY_SPEC: TopicSpec = {
  systemPromptAddendum: `TOPIC-SPECIFIC GUIDANCE (Recovery):

This is a Recovery message. The coach is addressing sleep, mobility, deloads, stress, hot/cold protocols, or the spaces between training that determine whether the work compounds.

ANGLES TO PICK FROM:
  - Sleep is the cheapest performance enhancer
  - Active recovery (walking, mobility) over total rest on off days
  - Stress management is recovery
  - Deload weeks are a feature, not weakness
  - Hot showers, cold exposure, breath work, simple modalities
  - Listening to body signals (RHR, soreness patterns, mood)

REMINDERS:
  - Don't push expensive gear or fancy protocols. Most recovery wins are free or near-free.
  - If the client mentioned poor sleep, address that before suggesting anything else.
  - Frame recovery as part of training, not a break from it.`,

  deriveClientTags: (inputs: SummaryInputs): string[] => {
    return deriveCommonTags(inputs);
  },
};
