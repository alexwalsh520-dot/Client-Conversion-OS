/**
 * Phase B5 — client info + timeline note builder.
 *
 * Builds the PdfClient block displayed on the cover page of the rendered
 * plan. Includes timeline-note copy for each v2 BuildType.
 *
 * Timeline-note philosophy:
 *   Existing legacy copy covered fat_loss / muscle_gain / recomp /
 *   maintain / endurance. v2 introduces Shred / Bulk / Lean Gain as
 *   distinct builds with different rate-of-change expectations:
 *
 *     SHRED  — aggressive deficit (-350 kcal). Expect ~1 lb/week.
 *     BULK   — aggressive surplus (+400 kcal). Expect ~1 lb/week lean gain.
 *     LEAN GAIN — modest surplus (+200 kcal). Expect ~0.25-0.5 lb/week.
 *
 *   Recomp / Maintain / Endurance copy reuses the legacy text patterns
 *   (matched by build, not by mapped legacy goal) so coaches see the
 *   familiar phrasing.
 *
 * Allergies-vs-medical split on the cover page is handled inside the
 * legacy renderer's `splitAllergiesMedical` helper. The adapter passes
 * the raw `intake.allergies` free-text and lets the renderer split it.
 */

import { goalLabelFor, parseHeightToCm } from "../../macro-calculator";
import type { PdfClient, IntakeSnapshot } from "./types";
import { mapBuildTypeToLegacyGoal } from "../macro-calculator-v2";
import { BuildType } from "../types";

// ============================================================================
// Conversion helpers (kept local to the adapter — no shared util module yet)
// ============================================================================

function kgToLbs(kg: number): number {
  return kg * 2.20462;
}

function cmToFtIn(cm: number): string {
  const totalIn = cm / 2.54;
  const ft = Math.floor(totalIn / 12);
  const inches = Math.round(totalIn - ft * 12);
  return `${ft}'${inches}"`;
}

// ============================================================================
// Timeline note copy
// ============================================================================

interface TimelineArgs {
  buildType: BuildType;
  currentLbs: number;
  goalLbs: number | null;
}

/**
 * Returns null when no meaningful timeline can be computed (no goal weight,
 * or goal weight is within ~3 lb of current — too small to project).
 */
export function buildTimelineNote(args: TimelineArgs): string | null {
  const { buildType, currentLbs, goalLbs } = args;
  if (goalLbs === null || Math.abs(goalLbs - currentLbs) < 3) return null;

  const deltaLbs = Math.abs(goalLbs - currentLbs);
  const goalLbsR = Math.round(goalLbs);
  const deltaR = Math.round(deltaLbs);

  switch (buildType) {
    case BuildType.SHRED: {
      const weeks = Math.max(4, Math.round(deltaLbs));
      return (
        `Shred targets ~1 lb/week loss. At this pace, expect to reach your goal weight of ${goalLbsR} lbs in roughly ${weeks} weeks. ` +
        `Progress isn't linear — focus on the 2-week scale average, not daily weight.`
      );
    }
    case BuildType.BULK: {
      const weeks = Math.max(4, Math.round(deltaLbs));
      return (
        `Bulk targets ~1 lb/week of mass gain. At this pace, ${deltaR} lbs takes roughly ${weeks} weeks. ` +
        `Some of that gain is fat — that's expected during a surplus. Judge by the mirror, strength numbers, ` +
        `and how clothes fit alongside the scale.`
      );
    }
    case BuildType.LEAN_GAIN: {
      // Lean gain is slower — 0.25–0.5 lb/week
      const weeksLow = Math.max(4, Math.round(deltaLbs * 2));
      const weeksHigh = Math.max(8, Math.round(deltaLbs * 4));
      return (
        `Lean gain prioritizes minimal fat — plan on ~0.25–0.5 lb/week. ` +
        `At this pace, ${deltaR} lbs takes roughly ${weeksLow}–${weeksHigh} weeks. ` +
        `If waist circumference rises faster than expected, the surplus is too aggressive — ` +
        `coach can dial it back.`
      );
    }
    case BuildType.RECOMP: {
      const weeksLow = Math.max(8, Math.round(deltaLbs * 2));
      const weeksHigh = Math.max(16, Math.round(deltaLbs * 4));
      return (
        `Recomp progresses slowly — expect 0.25–0.5 lb/week of scale change while body composition shifts. ` +
        `At this pace, ${deltaR} lbs of net change takes roughly ${weeksLow}–${weeksHigh} weeks. ` +
        `Track the mirror and strength numbers alongside the scale.`
      );
    }
    case BuildType.ENDURANCE:
      return (
        `Fuel the session, not the scale. Aim to hold weight with a small surplus and track performance metrics ` +
        `(pace, power, recovery) alongside bodyweight.`
      );
    case BuildType.MAINTAIN:
      // No directional weight goal in maintain — skip the timeline note
      return null;
  }
}

// ============================================================================
// Goal label
// ============================================================================

/**
 * Display label for the cover page's "Goal" row. Reuses the legacy
 * goalLabelFor() — Recomp/Maintain/Endurance map cleanly. Shred / Bulk /
 * Lean Gain don't have legacy entries, so we override here with explicit
 * labels.
 */
export function goalLabelForBuild(buildType: BuildType): string {
  switch (buildType) {
    case BuildType.SHRED:
      return "Shred (Fat Loss)";
    case BuildType.BULK:
      return "Bulk (Muscle Gain)";
    case BuildType.LEAN_GAIN:
      return "Lean Gain";
    default:
      // Recomp / Endurance / Maintain map cleanly to legacy goals
      return goalLabelFor(mapBuildTypeToLegacyGoal(buildType));
  }
}

// ============================================================================
// PdfClient builder
// ============================================================================

export interface BuildClientInfoArgs {
  intake: IntakeSnapshot;
  /** Per-day meal counts vary on Endurance; use the most-frequent count
   *  for the cover page's "Meals / Day" row, or "Variable" if none repeats. */
  mealsPerDayDisplay: number | "Variable";
}

export function buildClientInfo(args: BuildClientInfoArgs): PdfClient {
  const { intake, mealsPerDayDisplay } = args;

  const weightLbs = kgToLbs(intake.weight_kg);
  const goalLbs = intake.goal_weight_kg ? kgToLbs(intake.goal_weight_kg) : null;

  const timelineNote = buildTimelineNote({
    buildType: intake.build_type,
    currentLbs: weightLbs,
    goalLbs,
  });

  return {
    firstName: intake.first_name,
    lastName: intake.last_name,
    age: intake.age,
    weightKg: intake.weight_kg,
    weightLbs,
    heightCm: intake.height_cm,
    heightFtIn: cmToFtIn(intake.height_cm),
    goalLabel: goalLabelForBuild(intake.build_type),
    goalWeightLbs: goalLbs ? Math.round(goalLbs) : undefined,
    // The cover-page row reads "Meals / Day". For Endurance with variable
    // counts, render the most-frequent (or "Variable" if none repeats >2x).
    mealsPerDay:
      typeof mealsPerDayDisplay === "number" ? mealsPerDayDisplay : 0,
    allergies: intake.allergies || "None",
    medications: intake.medications || undefined,
    timelineNote: timelineNote ?? undefined,
  };
}

// silence unused-import warning when parseHeightToCm isn't called yet
void parseHeightToCm;
