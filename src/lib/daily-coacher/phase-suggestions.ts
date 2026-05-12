// Daily Coacher: phase-based topic suggestions.
//
// The coach can always pick any of the 14 topics. This file just controls
// which topics get visually elevated in the topic selector based on where
// the client is in their program. Suggestions guide ordering; they never gate.
//
// Phase mapping is config-only (no DB) so we can tune it without migrations.
// The phase-detection logic itself lives in summary-inputs.ts (deriveProgress).

import type { ProgramProgress } from "./summary-inputs";
import type { TopicKey } from "./topics";

/**
 * Topics elevated for each phase. First entry is the "top suggestion."
 * Order within each array roughly reflects priority within that phase.
 */
const PHASE_SUGGESTIONS: Record<ProgramProgress["phase"], TopicKey[]> = {
  onboarding: [
    "onboarding_momentum",
    "motivation",
    "nutrition",
    "training",
  ],
  early_program: [
    "accountability",
    "nutrition",
    "training",
    "lifestyle_integration",
  ],
  mid_program: [
    "mindset",
    "recovery",
    "progress_tracking",
    "recalibration",
  ],
  late_mid: [
    "celebration",
    "mindset",
    "progress_tracking",
    "recalibration",
  ],
  end_game: [
    "retention",
    "celebration",
    "progress_tracking",
  ],
  post_program: [
    "retention",
    "celebration",
  ],
  unknown: [], // No elevation when we don't know where they are.
};

/**
 * Returns the topic keys to elevate (visually) for a given program phase.
 * Empty array = no elevation, all topics shown in default order.
 */
export function elevatedTopicsForPhase(
  phase: ProgramProgress["phase"]
): TopicKey[] {
  return PHASE_SUGGESTIONS[phase] ?? [];
}

/**
 * Returns true if a topic should be highlighted in the selector for a
 * given phase. Convenience wrapper used by the topic-selector component.
 */
export function isTopicElevated(
  topic: TopicKey,
  phase: ProgramProgress["phase"]
): boolean {
  return elevatedTopicsForPhase(phase).includes(topic);
}
