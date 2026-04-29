/**
 * Phase B6a-pivot — meal-templates types.
 *
 * The deterministic template-based picker replaces B3's LLM picker on
 * the production critical path. This module defines:
 *
 *   - SubstitutionResult — outcome of walking a single ingredient's
 *     swap_chain against the client's hardExclude set
 *   - AdaptDayResult — outcome of converting one MealTemplateDay into
 *     either a DayPick (success) or a template-level PickError (chain
 *     exhausted on at least one slot)
 *   - TemplateNotAvailableError — thrown by loadMealTemplate when no
 *     template exists for the requested (build, dietary) pair
 *
 * The orchestrator returns the SAME WeekPlanSuccess / WeekPlanFailure
 * shape as B3 so downstream stages (audit, adapter, render) don't change.
 */

import type {
  BuildType,
  DietaryStyle,
  MealTemplate,
} from "../types";
import type { DayPick, PickError } from "../picker";

// ============================================================================
// Substitution
// ============================================================================

export type SubstitutionResult =
  | {
      kind: "ok";
      /** The slug actually selected (may equal the primary or come from swap_chain). */
      resolved_slug: string;
      /** True if a swap was needed (primary was hard-excluded). */
      was_substituted: boolean;
      /** Walked path from primary to the resolved slug, inclusive. Only
       *  populated when was_substituted is true. */
      swap_path?: string[];
    }
  | {
      kind: "exhausted";
      /** Primary slug + every swap_chain element walked, all hard-excluded. */
      walked: string[];
      /** Slugs in `walked` that were hard-excluded (the reason each was rejected). */
      excluded: string[];
    };

// ============================================================================
// Day adaptation
// ============================================================================

export interface SubstitutionLog {
  /** 1-based slot index. */
  slot_index: number;
  /** 0-based ingredient index within the slot. */
  ingredient_index: number;
  /** Original primary slug from the template. */
  primary_slug: string;
  /** Final resolved slug (after walking swap_chain). */
  resolved_slug: string;
  /** Walked path. */
  swap_path: string[];
}

export type AdaptDayResult =
  | {
      ok: true;
      day_pick: DayPick;
      /** All substitutions made for this day (empty when none needed). */
      substitutions: SubstitutionLog[];
    }
  | {
      ok: false;
      /** Picker-shaped error (reuses PickError so WeekPlanFailure shape is consistent). */
      pick_error: PickError;
    };

// ============================================================================
// Template lookup errors
// ============================================================================

export class TemplateNotAvailableError extends Error {
  readonly build: BuildType;
  readonly dietary: DietaryStyle;
  /** What combinations DO have templates — surfaced to the coach UI. */
  readonly available_combinations: Array<{ build: BuildType; dietary: DietaryStyle; template_count: number }>;
  constructor(
    build: BuildType,
    dietary: DietaryStyle,
    available_combinations: Array<{ build: BuildType; dietary: DietaryStyle; template_count: number }>,
  ) {
    super(
      `No meal template available for build="${build}" dietary="${dietary}". ` +
        `Available combinations: ${available_combinations
          .map((c) => `${c.build}/${c.dietary}(${c.template_count})`)
          .join(", ") || "(none)"}`,
    );
    this.name = "TemplateNotAvailableError";
    this.build = build;
    this.dietary = dietary;
    this.available_combinations = available_combinations;
  }
}

// Re-exports for callers
export type { MealTemplate };
