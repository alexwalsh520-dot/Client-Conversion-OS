/**
 * Complexity detector — flags plans worth a human review pass.
 *
 * Runs after audit completes and the plan is set to ship. If any of these
 * fire, the plan is flagged with `coach_review_recommended: true` and a
 * `complexity_reasons[]` array explains why. The coach UI surfaces a
 * "Coach review recommended" affordance and exposes a pre-rendered
 * correction prompt the coach pastes into Claude.ai.
 *
 * Triggers (any → flagged):
 *   - macro_retry_required        : verifier_retry_count > 0
 *   - high_cal_build              : training.calories ≥ 2900
 *   - audit_warnings_present      : audit.warnings.length > 0
 *   - sodium_near_ceiling         : any day's sodium > 2400 mg
 *   - anchor_at_frequency_cap     : any whole-food anchor used exactly 3×
 *
 * The detector also returns structured `near_block` details that feed
 * the handoff prompt's "Flagged issues" section so suggestions can be
 * day-specific and actionable.
 */

import type { WeekPlanSuccess } from "../picker";
import type { AuditResult } from "../audit/types";
import type { MacroTargets } from "../../macro-calculator";
import type { IngredientNutrition } from "../solver/types";
import {
  SUPPLEMENT_ANCHOR_SLUGS,
  WHOLE_FOOD_ANCHOR_MAX_PER_WEEK,
} from "../audit/audit-week-plan";

export type ComplexityReason =
  | "macro_retry_required"
  | "high_cal_build"
  | "audit_warnings_present"
  | "sodium_near_ceiling"
  | "anchor_at_frequency_cap";

export const HIGH_CAL_BUILD_THRESHOLD = 2900;
export const SODIUM_NEAR_CEILING_THRESHOLD_MG = 2400;

export interface NearBlockSodiumDay {
  day: number;
  actual_mg: number;
  ceiling_mg: number;
}

export interface AnchorAtCap {
  slug: string;
  count: number; // always === WHOLE_FOOD_ANCHOR_MAX_PER_WEEK (3)
}

export interface ComplexityDetail {
  /** Whether the complexity detector flagged this plan. */
  recommended: boolean;
  /** Compact reason codes (also persisted as JSONB). */
  reasons: ComplexityReason[];
  /** Structured near-block details for handoff prompt rendering.
   *  Empty arrays when no near-block conditions are present. */
  near_block: {
    sodium_days: NearBlockSodiumDay[];
    anchors_at_cap: AnchorAtCap[];
  };
}

export interface DetectComplexityArgs {
  planResult: WeekPlanSuccess;
  audit: AuditResult;
  targets: { training: MacroTargets; rest: MacroTargets };
  /** 0 if verifier passed first try, 1 if a retry was attempted. Future
   *  >1 if we ever raise the retry budget. */
  verifierRetryCount: number;
  /** Pre-fetched nutrition map for slug → per-100g values. Run-pipeline
   *  already builds this for the PDF adapter; we reuse it. */
  nutritionMap: ReadonlyMap<string, IngredientNutrition>;
  /** Sodium ceiling for the client (cap mg × 1.15). Used to surface the
   *  ceiling alongside near-block actual values. */
  sodiumCeilingMg: number;
}

export function detectComplexity(args: DetectComplexityArgs): ComplexityDetail {
  const reasons = new Set<ComplexityReason>();

  // 1. Macro retry fired
  if (args.verifierRetryCount > 0) reasons.add("macro_retry_required");

  // 2. High-cal build
  if (args.targets.training.calories >= HIGH_CAL_BUILD_THRESHOLD) {
    reasons.add("high_cal_build");
  }

  // 3. Audit warnings present
  if (args.audit.warnings.length > 0) reasons.add("audit_warnings_present");

  // 4. Sodium near ceiling — recompute per-day; flag any day > 2400 mg.
  const sodium_days: NearBlockSodiumDay[] = [];
  for (const day of args.planResult.days) {
    let dailyNa = 0;
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        const nut = args.nutritionMap.get(ing.slug);
        if (!nut) continue;
        dailyNa += (ing.grams * nut.sodium_mg_per_100g) / 100;
      }
    }
    if (dailyNa > SODIUM_NEAR_CEILING_THRESHOLD_MG) {
      sodium_days.push({
        day: day.day,
        actual_mg: Math.round(dailyNa),
        ceiling_mg: Math.round(args.sodiumCeilingMg),
      });
    }
  }
  if (sodium_days.length > 0) reasons.add("sodium_near_ceiling");

  // 5. Whole-food anchor at frequency cap (==3, not >3 — that's an audit BLOCK).
  // Reads pick.slots[].ingredients[].isAnchor like the audit does to count
  // authored anchor positions per slug, then filters to whole-food slugs
  // (i.e. NOT in SUPPLEMENT_ANCHOR_SLUGS) at exactly the cap.
  const anchorCountBySlug = new Map<string, number>();
  for (const day of args.planResult.days) {
    const pickSlots = day.pick.slots ?? [];
    for (const slot of pickSlots) {
      const authored = (slot.ingredients ?? []).find((ing) => ing.isAnchor);
      if (!authored) continue;
      anchorCountBySlug.set(
        authored.slug,
        (anchorCountBySlug.get(authored.slug) ?? 0) + 1,
      );
    }
  }
  const anchors_at_cap: AnchorAtCap[] = [];
  for (const [slug, count] of anchorCountBySlug.entries()) {
    if (SUPPLEMENT_ANCHOR_SLUGS.has(slug)) continue;
    if (count === WHOLE_FOOD_ANCHOR_MAX_PER_WEEK) {
      anchors_at_cap.push({ slug, count });
    }
  }
  if (anchors_at_cap.length > 0) reasons.add("anchor_at_frequency_cap");

  return {
    recommended: reasons.size > 0,
    reasons: Array.from(reasons),
    near_block: { sodium_days, anchors_at_cap },
  };
}
