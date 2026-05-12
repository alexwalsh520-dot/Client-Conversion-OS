// Daily Coacher: shared tag-derivation helpers used across topic specs.
//
// Every topic's deriveClientTags can pull from these so we don't
// reimplement "what's the client's goal" in 14 places. Topic-specific
// tags layer on top.

import type { SummaryInputs } from "../summary-inputs";

export function deriveGoalTags(inputs: SummaryInputs): string[] {
  const tags: string[] = [];
  const goal = (inputs.intake?.fitness_goal || "").toLowerCase();
  if (/lose|fat\s*loss|cut|drop/.test(goal)) tags.push("fat_loss");
  if (/gain|build|bulk|muscle|size/.test(goal)) tags.push("muscle_gain");
  if (/recomp|tone|lean/.test(goal)) tags.push("recomp");
  if (/maintain|sustain/.test(goal)) tags.push("maintenance");
  return tags;
}

export function derivePhaseTags(inputs: SummaryInputs): string[] {
  const phase = inputs.progress.phase;
  if (phase === "unknown" || phase === "post_program") return [];
  return [`phase_${phase}`];
}

export function deriveSleepTags(inputs: SummaryInputs): string[] {
  const sleep = (inputs.intake?.sleep_hours || "").toLowerCase();
  if (/[1-5](?!\d)|less\s*than\s*6|poor|bad|disrupted/.test(sleep)) return ["low_sleep"];
  return [];
}

export function deriveCookingTags(inputs: SummaryInputs): string[] {
  const cook = (inputs.intake?.can_cook || "").toLowerCase();
  const tags: string[] = [];
  if (/no\b|barely|rarely|hate|don'?t/.test(cook)) tags.push("limited_cooking");
  if (/yes|love|enjoy|some/.test(cook)) tags.push("cooks_at_home");
  return tags;
}

/** Reasonable default for topics that don't need anything custom. */
export function deriveCommonTags(inputs: SummaryInputs): string[] {
  return [
    ...deriveGoalTags(inputs),
    ...derivePhaseTags(inputs),
    ...deriveSleepTags(inputs),
  ];
}
