// Daily Coacher: per-topic spec registry.
//
// Each topic that's been wired up exports a TopicSpec from its own file
// (src/lib/daily-coacher/topics/<key>.ts). This registry maps topic keys
// to those specs. Topics not yet wired return null; the topic-generator
// throws TopicNotReadyError so the UI can show a clear "not ready" state.

import type { SummaryInputs } from "../summary-inputs";
import type { TopicKey } from "../topics";

import { NUTRITION_SPEC } from "./nutrition";
import { TRAINING_SPEC } from "./training";
import { RECOVERY_SPEC } from "./recovery";
import { MINDSET_SPEC } from "./mindset";
import { MOTIVATION_SPEC } from "./motivation";
import { ACCOUNTABILITY_SPEC } from "./accountability";
import { PROGRESS_TRACKING_SPEC } from "./progress_tracking";
import { MEETING_PREP_SPEC } from "./meeting_prep";
import { MEETING_FOLLOWUP_SPEC } from "./meeting_followup";
import { RETENTION_SPEC } from "./retention";
import { CELEBRATION_SPEC } from "./celebration";
import { RECALIBRATION_SPEC } from "./recalibration";
import { ONBOARDING_MOMENTUM_SPEC } from "./onboarding_momentum";
import { LIFESTYLE_INTEGRATION_SPEC } from "./lifestyle_integration";

export interface TopicSpec {
  /** Extra instructions appended to the base system prompt. Topic-specific
   *  guidance: tone hints, things to focus on, things to avoid. Should be
   *  short, under 200 words. */
  systemPromptAddendum: string;
  /** Derive client-context tags from the gathered inputs (intake form,
   *  recent messages, etc.). Used to filter `tips_library` by
   *  `applies_to_tags`. Return [] if no tags should narrow tip selection. */
  deriveClientTags: (inputs: SummaryInputs) => string[];
}

const SPECS: Record<TopicKey, TopicSpec> = {
  nutrition: NUTRITION_SPEC,
  training: TRAINING_SPEC,
  recovery: RECOVERY_SPEC,
  mindset: MINDSET_SPEC,
  motivation: MOTIVATION_SPEC,
  accountability: ACCOUNTABILITY_SPEC,
  progress_tracking: PROGRESS_TRACKING_SPEC,
  meeting_prep: MEETING_PREP_SPEC,
  meeting_followup: MEETING_FOLLOWUP_SPEC,
  retention: RETENTION_SPEC,
  celebration: CELEBRATION_SPEC,
  recalibration: RECALIBRATION_SPEC,
  onboarding_momentum: ONBOARDING_MOMENTUM_SPEC,
  lifestyle_integration: LIFESTYLE_INTEGRATION_SPEC,
};

export function getTopicSpec(key: TopicKey): TopicSpec | null {
  return SPECS[key] ?? null;
}

export function isTopicReady(key: TopicKey): boolean {
  return SPECS[key] != null;
}
