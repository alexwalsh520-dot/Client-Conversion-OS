/**
 * Phase B3 — prompt construction for the slot picker.
 *
 * The system prompt is shared across all 7 days within a generation:
 *   - Role: "You compose meals; math is handled separately by a solver."
 *   - Hard rules: only DB slugs, only build's tier 1+2, exactly one anchor
 *     per slot, never include hard_excluded slugs.
 *   - Output contract: strict JSON shape with no prose around it.
 *
 * The user prompt is per-day-specific:
 *   - Day number and kind (training/rest)
 *   - Per-slot macro targets (computed from distribution × daily targets)
 *   - Build's tier 1 + tier 2 lists (filtered to remove hard_excludes)
 *   - Hard exclude list explicitly (defense in depth — even though tier
 *     filtering already removes them, the LLM may hallucinate)
 *   - Variety state (which anchors have been used in days 1..N-1)
 *   - Frequency caps from BuildSpec
 *   - Bias hint (volume / density / neutral language)
 *   - Optional solver feedback (re-prompt iterations only)
 */

import type {
  BuildSpec,
  MealDistribution,
  PlanComplexity,
  SolverBias,
} from "../types";
import {
  PLAN_COMPLEXITY_INGREDIENT_CAP,
  SolverBias as SolverBiasEnum,
} from "../types";
import type { PerSlotTargets } from "../solver";
import type {
  DayPickInput,
  PickViolation,
  WeeklyHistory,
} from "./types";

// ============================================================================
// System prompt
// ============================================================================

export function buildSystemPrompt(): string {
  return `You are an expert meal-plan composer for a fitness coaching platform.

Your job: pick a list of ingredients per meal slot for ONE day. A separate
solver computes the exact gram amounts that hit macro targets — you do NOT
return grams, only ingredient slugs and an anchor flag per slot.

Focus on what an LLM does best: choosing varied, palatable, coherent meal
combinations from the provided tier lists. Prefer tier 1 ingredients;
tier 2 are acceptable but should be the minority of picks.

HARD RULES — never break these:
  1. Only use slugs from the tier 1 / tier 2 lists in the user prompt.
     Never invent slugs. Never use a slug not in those lists.
  2. Never use any slug that appears in the "HARD EXCLUDE" list.
  3. Each slot must have EXACTLY ONE ingredient marked "isAnchor": true.
     The anchor is the slot's primary protein source — the highest-protein
     slug in the slot. Side proteins, carbs, fats, veggies are NOT anchors.
  4. Number of slots in your output MUST match the number specified in the
     user prompt (e.g., 3 for a 3-meal day, 5 for a 5-meal day).
  5. Maximum ingredients per slot is given in the user prompt (5 / 7 / 10).
     Each slot must have at least 1 ingredient.
  6. Variety: do not use a single anchor protein more than 2 times across
     a 7-day plan. The user prompt tells you which anchors have been used
     so far this week.

OUTPUT FORMAT — return ONLY this JSON object, no prose, no markdown fences,
no commentary outside the JSON:

{
  "day": <number>,
  "slots": [
    {
      "index": <slot 1-based number>,
      "ingredients": [
        { "slug": "<slug>", "isAnchor": true | false }
      ]
    }
  ]
}

Pick coherent meals. A breakfast slot might be oats + whey + berries. A
dinner slot might be salmon + sweet potato + spinach + olive oil. Don't
mix incompatible items (no tuna with peanut butter, no whey shake with
beef stew). Real meals only.`;
}

// ============================================================================
// User prompt
// ============================================================================

export interface BuildUserPromptArgs {
  input: DayPickInput;
  perSlotTargets: PerSlotTargets[];
}

export function buildUserPrompt(args: BuildUserPromptArgs): string {
  const { input, perSlotTargets } = args;
  const { buildSpec, distribution, hardExclude, planComplexity, weeklyHistory, day_number, day_kind, targets, solverFeedback } = input;

  const cap = PLAN_COMPLEXITY_INGREDIENT_CAP[planComplexity];

  const sections: string[] = [];

  // ----- Header -----
  sections.push(
    `DAY ${day_number} OF 7 — ${day_kind.toUpperCase()} DAY`,
    `Build: ${buildSpec.label} (${buildSpec.id})`,
    `Distribution: ${distribution.label} (${distribution.meals_per_day} meals)`,
    `Plan complexity: ${planComplexity} (max ${cap} ingredients per slot)`,
    "",
  );

  // ----- Daily macro context -----
  sections.push(
    `DAILY TARGETS (whole-day budget — solver hits these):`,
    `  Calories: ${Math.round(targets.calories)} kcal`,
    `  Protein:  ${targets.proteinG} g`,
    `  Carbs:    ${targets.carbsG} g`,
    `  Fat:      ${targets.fatG} g`,
    `  Sodium:   ≤ ${targets.sodiumCapMg} mg`,
    "",
  );

  // ----- Per-slot targets -----
  sections.push("PER-SLOT MACRO TARGETS (the solver will fit these within ±10%):");
  for (let i = 0; i < perSlotTargets.length; i++) {
    const t = perSlotTargets[i];
    const slotMeta = distribution.slots[i];
    sections.push(
      `  Slot ${t.index} — ${slotMeta.label} [${slotMeta.kind}]: P=${t.protein_g.toFixed(0)}g C=${t.carbs_g.toFixed(0)}g F=${t.fat_g.toFixed(0)}g (kcal=${t.calories.toFixed(0)})`,
    );
  }
  sections.push("");

  // ----- Bias hint -----
  sections.push(buildBiasHint(buildSpec.default_solver_bias));
  sections.push("");

  // ----- Tier lists -----
  sections.push("TIER 1 INGREDIENTS (preferred — pick mostly from here):");
  sections.push(formatTierList(buildSpec, "tier_1", hardExclude));
  sections.push("");
  sections.push("TIER 2 INGREDIENTS (acceptable in moderation — use sparingly):");
  sections.push(formatTierList(buildSpec, "tier_2", hardExclude));
  sections.push("");

  // ----- Hard exclude list (defense in depth) -----
  if (hardExclude.size > 0) {
    sections.push(
      "HARD EXCLUDE — these slugs are FORBIDDEN. Even if listed in tier 1/2 above, NEVER use them:",
    );
    sections.push(`  ${Array.from(hardExclude).sort().join(", ")}`);
    sections.push("");
  }

  // ----- Variety state -----
  sections.push("VARIETY STATE (anchor uses across days 1..N-1):");
  if (weeklyHistory.anchor_use_counts.size === 0) {
    sections.push("  (none — this is day 1 of the week)");
  } else {
    const anchorEntries = Array.from(weeklyHistory.anchor_use_counts.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    for (const [slug, count] of anchorEntries) {
      const remaining = 2 - count;
      const status = remaining <= 0 ? "EXHAUSTED — DO NOT USE AS ANCHOR AGAIN" : `${remaining} more allowed`;
      sections.push(`  ${slug}: used ${count}× as anchor (${status})`);
    }
  }
  sections.push("");

  // ----- Frequency caps from BuildSpec -----
  if (buildSpec.frequency_caps.length > 0) {
    sections.push("BUILD FREQUENCY CAPS (total uses across the week, including non-anchor):");
    for (const cap of buildSpec.frequency_caps) {
      const used = weeklyHistory.total_use_counts.get(cap.slug) ?? 0;
      const remaining = cap.max_per_week - used;
      sections.push(
        `  ${cap.slug}: used ${used}/${cap.max_per_week} so far (${remaining} more allowed) — ${cap.reason}`,
      );
    }
    sections.push("");
  }

  // ----- Solver feedback (re-prompt only) -----
  if (solverFeedback) {
    sections.push("===========================================================");
    sections.push("RE-PROMPT — SOLVER FEEDBACK FROM PRIOR ATTEMPT:");
    sections.push(`  ${solverFeedback.message}`);
    if (solverFeedback.affected_slots && solverFeedback.affected_slots.length > 0) {
      sections.push("  Affected slots:");
      for (const s of solverFeedback.affected_slots) {
        const zeroedNote = s.zeroed_anchor ? ` (anchor "${s.zeroed_anchor}" got zeroed by the solver)` : "";
        sections.push(`    Slot ${s.slot_index}: ${s.issue}${zeroedNote}`);
      }
    }
    sections.push(
      "  Adjust your picks to address this feedback. Pick different ingredients " +
        "for the affected slots; other slots may stay the same if they were fine.",
    );
    sections.push("===========================================================");
    sections.push("");
  }

  // ----- Final reminder -----
  sections.push(
    `RETURN ONLY the JSON object described in the system prompt. ${distribution.meals_per_day} slots required, max ${cap} ingredients per slot, exactly one anchor per slot.`,
  );

  return sections.join("\n");
}

// ============================================================================
// Validation-failure re-prompt (used by pickSlotsForDay's internal retry)
// ============================================================================

/**
 * Given a list of validation violations from the FIRST attempt, build a
 * follow-up user message that lists the problems and asks for a corrected
 * JSON. Sent as a continuation user prompt.
 */
export function buildValidationRetryMessage(
  violations: PickViolation[],
  raw_response: string,
): string {
  const lines: string[] = [];
  lines.push(
    "Your previous response had validation failures. Fix ALL of them and return a corrected JSON. Do not include prose, only the JSON object.",
  );
  lines.push("");
  lines.push("VIOLATIONS:");
  for (const v of violations) {
    const slot = v.slot_index !== undefined ? `slot ${v.slot_index}: ` : "";
    const slug = v.slug ? ` (slug: ${v.slug})` : "";
    lines.push(`  - [${v.kind}] ${slot}${v.message}${slug}`);
  }
  lines.push("");
  lines.push("Your previous response (for reference):");
  lines.push("```");
  lines.push(raw_response.slice(0, 1500));
  lines.push("```");
  lines.push("");
  lines.push("Return ONLY the corrected JSON object now.");
  return lines.join("\n");
}

// ============================================================================
// Helpers
// ============================================================================

function buildBiasHint(bias: SolverBias): string {
  switch (bias) {
    case SolverBiasEnum.VOLUME:
      return (
        "BIAS: VOLUME — this build prioritizes high-volume, water-rich foods " +
        "for satiety on a tight kcal target. Lean into vegetables, whole " +
        "fruits, fibrous carbs (oats, sweet potato), and lean proteins. " +
        "Avoid calorie-dense additions like nut butters in slots where a " +
        "lower-cal option works."
      );
    case SolverBiasEnum.DENSITY:
      return (
        "BIAS: DENSITY — this build needs calorie-dense foods to hit elevated " +
        "kcal targets without overloading stomach volume. Prefer white rice " +
        "over brown when both are tier 1, full-fat dairy, nut butters, " +
        "olive oil, dried fruits, and richer proteins."
      );
    case SolverBiasEnum.NEUTRAL:
    default:
      return (
        "BIAS: NEUTRAL — no specific volume or density preference. Pick " +
        "balanced, conventional combinations."
      );
  }
}

function formatTierList(
  buildSpec: BuildSpec,
  tier: "tier_1" | "tier_2",
  hardExclude: ReadonlySet<string>,
): string {
  const entries = buildSpec[tier]
    .filter((e) => !hardExclude.has(e.slug))
    .map((e) => {
      const hybrid = e.hybrid ? ` [hybrid: ${e.hybrid}]` : "";
      const note = e.notes ? ` — ${e.notes}` : "";
      return `${e.slug} (${e.role})${hybrid}${note}`;
    });
  if (entries.length === 0) return "  (none — all tier candidates filtered out)";
  // Group every 4 per line for readability
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i += 4) {
    lines.push("  " + entries.slice(i, i + 4).join("; "));
  }
  return lines.join("\n");
}

// ============================================================================
// Variety helpers (used by orchestrator when accumulating weekly_history)
// ============================================================================

export function emptyWeeklyHistory(): WeeklyHistory {
  return {
    anchor_use_counts: new Map(),
    total_use_counts: new Map(),
  };
}

export function appendDayToHistory(
  history: WeeklyHistory,
  picks: { slots: Array<{ ingredients: Array<{ slug: string; isAnchor: boolean }> }> },
): WeeklyHistory {
  const next: WeeklyHistory = {
    anchor_use_counts: new Map(history.anchor_use_counts),
    total_use_counts: new Map(history.total_use_counts),
    dish_names_used: history.dish_names_used ? [...history.dish_names_used] : undefined,
  };
  for (const slot of picks.slots) {
    for (const ing of slot.ingredients) {
      const total = (next.total_use_counts.get(ing.slug) ?? 0) + 1;
      next.total_use_counts.set(ing.slug, total);
      if (ing.isAnchor) {
        const anchor = (next.anchor_use_counts.get(ing.slug) ?? 0) + 1;
        next.anchor_use_counts.set(ing.slug, anchor);
      }
    }
  }
  return next;
}
