/**
 * Plan-selector — select the best of N scored plans.
 *
 * Selection rules:
 *   1. Filter to plans with `valid === true` (zero hard errors).
 *   2. Among valid plans, pick the one with fewest soft_errors.
 *   3. Tie-break by lowest plan_index (deterministic, takes #1).
 *   4. If no valid plans → return selected_index: null with structured reason.
 *
 * The caller decides what to do when selected_index is null (typically:
 * BLOCK with a coach-readable message that all attempts had hard errors).
 */

import type { ScoredPlan, SelectionResult } from "./types";

export function selectBest(scored: readonly ScoredPlan[]): SelectionResult {
  const valid = scored.filter((s) => s.valid);

  if (valid.length === 0) {
    // Build a per-plan summary of hard errors for the coach message.
    const summaries = scored.map(
      (s) =>
        `attempt ${s.plan_index}: ${s.hard_errors.map((h) => h.kind).join(",") || "none"}`,
    );
    return {
      selected_index: null,
      reason: `All ${scored.length} generation attempts had hard errors — ${summaries.join(" | ")}`,
      scored: scored.slice(),
    };
  }

  // Sort: fewest soft errors, then lowest plan_index.
  const sorted = valid
    .slice()
    .sort((a, b) => {
      if (a.soft_errors.length !== b.soft_errors.length) {
        return a.soft_errors.length - b.soft_errors.length;
      }
      return a.plan_index - b.plan_index;
    });
  const winner = sorted[0];
  const others = sorted.slice(1);
  const reason = others.length === 0
    ? `1 valid plan — selected attempt ${winner.plan_index} (soft_errors=${winner.soft_errors.length})`
    : `selected attempt ${winner.plan_index} (soft_errors=${winner.soft_errors.length}) over ${others.map((s) => `${s.plan_index}=${s.soft_errors.length}`).join(", ")}`;

  return {
    selected_index: winner.plan_index,
    reason,
    scored: scored.slice(),
  };
}
