// Daily Coacher: the canonical list of 14 topics a coach can pick when
// drafting a message. Topic-specific prompt templates and tip filters live
// in src/lib/daily-coacher/topics/<key>.ts (added incrementally in Phase 6
// as each topic is approved + wired up).
//
// Order here is the default UI order. Phase-suggestion logic in
// phase-suggestions.ts can elevate a subset to the top based on where the
// client is in their program; the coach can always pick any of the 14.

export type TopicKey =
  | "onboarding_momentum"
  | "nutrition"
  | "training"
  | "accountability"
  | "meeting_followup"
  | "recovery"
  | "mindset"
  | "motivation"
  | "progress_tracking"
  | "meeting_prep"
  | "retention"
  | "celebration"
  | "recalibration"
  | "lifestyle_integration";

export interface TopicDefinition {
  key: TopicKey;
  label: string;
  /** One-sentence hint shown under the label so coaches know what each topic is for. */
  description: string;
}

export const TOPICS: TopicDefinition[] = [
  {
    key: "onboarding_momentum",
    label: "Onboarding Momentum",
    description: "Keep new clients engaged in their first weeks.",
  },
  {
    key: "nutrition",
    label: "Nutrition",
    description: "General principles and habits. Never specific macros.",
  },
  {
    key: "training",
    label: "Training",
    description: "Workout context, form, frequency, intensity (no Everfit data).",
  },
  {
    key: "accountability",
    label: "Accountability",
    description: "Hold the client to commitments without being preachy.",
  },
  {
    key: "meeting_followup",
    label: "Meeting Follow-up",
    description: "Reinforce takeaways from a recent meeting.",
  },
  {
    key: "recovery",
    label: "Recovery",
    description: "Sleep, mobility, deload, hot/cold, stress management.",
  },
  {
    key: "mindset",
    label: "Mindset",
    description: "Reframe setbacks, identity work, long-game thinking.",
  },
  {
    key: "motivation",
    label: "Motivation",
    description: "Re-light the fire when energy or discipline dips.",
  },
  {
    key: "progress_tracking",
    label: "Progress Tracking",
    description: "Reply to check-ins. Never store biometric data here.",
  },
  {
    key: "meeting_prep",
    label: "Meeting Prep",
    description: "Set up an upcoming meeting with intent.",
  },
  {
    key: "retention",
    label: "Retention",
    description: "Address renewal/continuation conversations late in program.",
  },
  {
    key: "celebration",
    label: "Celebration",
    description: "Mark wins, small or milestone.",
  },
  {
    key: "recalibration",
    label: "Recalibration",
    description: "Adjust the plan when goals or life circumstances shift.",
  },
  {
    key: "lifestyle_integration",
    label: "Lifestyle Integration",
    description: "Habit-stacking and life-fit suggestions (e.g., adding a daily walk).",
  },
];

export function getTopic(key: TopicKey): TopicDefinition {
  const t = TOPICS.find((x) => x.key === key);
  if (!t) throw new Error(`Unknown topic key: ${key}`);
  return t;
}
