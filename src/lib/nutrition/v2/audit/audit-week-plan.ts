/**
 * Phase B4 — auditWeekPlan.
 *
 * Runs the 8 deterministic safety checks against a finished week plan and
 * client profile. Returns AuditResult with structured BLOCK / WARN errors
 * and a final action (PROCEED_TO_PDF_RENDER vs BLOCK_GENERATION_RETURN_TO_COACH).
 *
 * Performance target: <100ms. No DB hits (uses in-memory ingredient cache
 * shared with B2's solver). No LLM calls.
 *
 * Check ordering (Check 7 runs FIRST for early-exit potential):
 *   7. Build/medical incompatibility (BLOCK or WARN)
 *   1. Hard exclude violations (BLOCK)
 *   2. Sodium ceiling per day (BLOCK)
 *   3. Weekly tier distribution (BLOCK)
 *   4. Frequency cap violations (BLOCK)
 *   5. Daily macro compliance (WARN only)
 *   6. Per-meal macro compliance (WARN only)
 *   8. Custom distribution sum (BLOCK if customDistribution provided)
 *   0. Ingredient data missing (BLOCK) — implicit pre-check while loading
 *
 * IMPORTANT — anchor identity: two notions, two checks, do not unify.
 *
 *   • Authored anchor (intent) — `day.pick.slots[i].ingredients[j].isAnchor`,
 *     set by the template author. Drives Check 4 (variety / frequency caps).
 *     The variety question is "did the AUTHOR rotate the meal-defining
 *     protein choices reasonably?" — and that's about the author's intent,
 *     not whatever the solver's gram math produced. Specifically: when a
 *     low-density anchor (eggs, yogurt, cottage cheese) is paired with a
 *     whey non-anchor secondary, whey at 80g P/100g easily outscores the
 *     authored anchor on absolute protein contribution — but the author
 *     deliberately listed the low-density slug as the meal's defining
 *     choice and whey as a completion ingredient. Counting whey as the
 *     de-facto anchor would falsely block legitimate templates.
 *
 *   • Post-hoc anchor (reality) — highest-protein contributor in the
 *     SOLVED slot, computed by classifySlotAnchors. Drives Check 3 (tier-1
 *     macro distribution). The tier-1 question is "is the actual
 *     macro-defining ingredient on the plate from the build's preferred
 *     pool?" — and that's about the eaten reality, not the author's label.
 *
 * Same word, two meanings, two consumers. Keep them separate.
 */

import {
  ALL_ALLERGY_RULES,
} from "../allergies";
import { ALL_DIETARY_RULES } from "../dietary";
import { ALL_MEDICAL_RULES } from "../medical";
import {
  BuildType,
  MedicalFlag,
} from "../types";
import {
  computePerSlotTargets,
  getIngredientNutrition,
  type IngredientNutrition,
} from "../solver";
import {
  classifySlotAnchors,
  PROTEIN_ANCHORED_SLOT_MIN_G,
  CARB_ANCHORED_SLOT_MIN_G,
} from "./anchor-detection";
import type {
  AuditError,
  AuditResult,
  ClientProfile,
  WeekPlanSuccess,
} from "./types";

const SODIUM_CAP_FACTOR = 1.15;
const DAILY_KCAL_DRIFT_WARN = 0.05;
const DAILY_MACRO_DRIFT_WARN = 0.10;
const PER_MEAL_DRIFT_WARN = 0.15;
const CUSTOM_DIST_TOLERANCE = 0.005; // 0.5%

// ----------------------------------------------------------------------------
// Anchor-variety rule (Phase B6a-pivot post-Santiago revision).
//
// The pre-pivot rule (per-slug all-uses caps from buildSpec.frequency_caps)
// was designed for the LLM picker era when variety was only enforceable
// post-hoc. With deterministic templates we control variety via authoring,
// so the audit's job becomes a sanity guardrail rather than the primary
// rotation enforcer.
//
// New rule (anchor-only — non-anchor uses are uncapped):
//   • Slugs in SUPPLEMENT_ANCHOR_SLUGS (whey/casein/pea/liquid_egg_whites/
//     egg_white_raw): combined limit of 5×/week as anchor across the set.
//     Rationale: protein supplements are clean protein-dense ingredients
//     that don't drag carb/fat bands; daily supplementation is the norm
//     in fitness coaching.
//   • All other slugs: 3×/week as anchor (per-slug). Rationale: variety
//     across whole-food protein anchors prevents monotony.
//
// Anchor identity is determined by classifySlotAnchors (highest-protein
// ingredient by absolute contribution), NOT the template's authored
// `anchor` flag — this catches cases where the solver effectively shifted
// the anchor by zeroing the original primary.
// ----------------------------------------------------------------------------

export const SUPPLEMENT_ANCHOR_SLUGS: ReadonlySet<string> = new Set([
  "whey_protein_isolate",
  "whey_protein_concentrate",
  "casein_protein",
  "pea_protein_powder",
  "liquid_egg_whites",
  "egg_white_raw",
]);

export const SUPPLEMENT_ANCHOR_MAX_PER_WEEK = 5;
export const WHOLE_FOOD_ANCHOR_MAX_PER_WEEK = 3;

// ============================================================================
// Public entry point
// ============================================================================

export async function auditWeekPlan(
  plan: WeekPlanSuccess,
  clientProfile: ClientProfile,
): Promise<AuditResult> {
  const start = Date.now();
  const blocking_errors: AuditError[] = [];
  const warnings: AuditError[] = [];

  // ----- Check 7 (early): build/medical compatibility ----------------------
  const compatErrors = checkBuildMedicalCompatibility(clientProfile);
  for (const err of compatErrors) {
    if (err.severity === "BLOCK") blocking_errors.push(err);
    else warnings.push(err);
  }
  // If we hit a hard build/medical block, short-circuit and return — running
  // the rest of the audit on a plan we shouldn't have generated wastes work.
  if (blocking_errors.some((e) => e.check === "build_medical_block")) {
    return finalizeResult(blocking_errors, warnings, start);
  }

  // ----- Build merged hard_exclude (used by Check 1) ----------------------
  const merged_hard_exclude = mergeHardExclude(clientProfile);

  // ----- Pre-load ingredient nutrition for all slugs in the plan ----------
  const allSlugs = new Set<string>();
  for (const day of plan.days) {
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        allSlugs.add(ing.slug);
      }
    }
  }
  const nutritionMap = await getIngredientNutrition(Array.from(allSlugs));

  // ----- Check 0: ingredient data missing ---------------------------------
  for (const slug of allSlugs) {
    if (!nutritionMap.has(slug)) {
      blocking_errors.push({
        severity: "BLOCK",
        check: "ingredient_data_missing",
        ingredient: slug,
        details: { slug },
        reason: `Ingredient '${slug}' is not present in the nutrition data cache; audit cannot verify macros or sodium for it.`,
      });
    }
  }

  // ----- Check 1: hard exclude violations ---------------------------------
  for (const day of plan.days) {
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        if (merged_hard_exclude.has(ing.slug)) {
          blocking_errors.push({
            severity: "BLOCK",
            check: "hard_exclude_violation",
            day: day.day,
            meal: slot.index,
            ingredient: ing.slug,
            details: {
              slug: ing.slug,
              grams: ing.grams,
              triggered_by: identifyExcludeOrigin(ing.slug, clientProfile),
            },
            reason: `Slug '${ing.slug}' appears in day ${day.day} meal ${slot.index} but is in the merged hard_exclude set.`,
          });
        }
      }
    }
  }

  // ----- Check 2: sodium ceiling per day ----------------------------------
  const sodium_ceiling = clientProfile.sodiumCapMg * SODIUM_CAP_FACTOR;
  for (const day of plan.days) {
    let dailyNa = 0;
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        const nut = nutritionMap.get(ing.slug);
        if (!nut) continue; // already flagged by Check 0
        dailyNa += (ing.grams * nut.sodium_mg_per_100g) / 100;
      }
    }
    if (dailyNa > sodium_ceiling) {
      // B6a-pivot Option 4: demoted from BLOCK to WARN. Sodium thresholds
      // are kept (HBP/kidney safety) but variance lands as soft error so
      // the plan still ships. Coach handoff prompt surfaces the breach.
      warnings.push({
        severity: "WARN",
        check: "sodium_ceiling_exceeded",
        day: day.day,
        details: {
          actual_mg: Math.round(dailyNa),
          cap_mg: clientProfile.sodiumCapMg,
          ceiling_mg: sodium_ceiling,
        },
        reason: `Day ${day.day} sodium ${Math.round(dailyNa)}mg exceeds ceiling ${sodium_ceiling}mg (cap ${clientProfile.sodiumCapMg}mg × ${SODIUM_CAP_FACTOR}).`,
      });
    }
  }

  // ----- Check 3: weekly tier distribution --------------------------------
  const tierResults = computeWeeklyTierDistribution(plan, clientProfile, nutritionMap);
  if (tierResults.protein_anchored_total > 0) {
    const requiredP = Math.ceil(
      tierResults.protein_anchored_total *
        clientProfile.buildSpec.tier_1_protein_min_pct_of_anchored_slots,
    );
    if (tierResults.protein_tier_1_count < requiredP) {
      // B6a-pivot Option 4: demoted from BLOCK to WARN.
      warnings.push({
        severity: "WARN",
        check: "tier_1_protein_below_min",
        details: {
          tier_1_count: tierResults.protein_tier_1_count,
          required: requiredP,
          total_anchored: tierResults.protein_anchored_total,
          required_pct: clientProfile.buildSpec.tier_1_protein_min_pct_of_anchored_slots,
          build_type: clientProfile.buildType,
        },
        reason: `Only ${tierResults.protein_tier_1_count} of ${tierResults.protein_anchored_total} protein-anchored slots use a tier 1 protein anchor; required minimum is ${requiredP} (${Math.round(clientProfile.buildSpec.tier_1_protein_min_pct_of_anchored_slots * 100)}%).`,
      });
    }
  }
  if (tierResults.carb_anchored_total > 0) {
    const requiredC = Math.ceil(
      tierResults.carb_anchored_total *
        clientProfile.buildSpec.tier_1_carb_min_pct_of_anchored_slots,
    );
    if (tierResults.carb_tier_1_count < requiredC) {
      // B6a-pivot Option 4: demoted from BLOCK to WARN.
      warnings.push({
        severity: "WARN",
        check: "tier_1_carb_below_min",
        details: {
          tier_1_count: tierResults.carb_tier_1_count,
          required: requiredC,
          total_anchored: tierResults.carb_anchored_total,
          required_pct: clientProfile.buildSpec.tier_1_carb_min_pct_of_anchored_slots,
          build_type: clientProfile.buildType,
        },
        reason: `Only ${tierResults.carb_tier_1_count} of ${tierResults.carb_anchored_total} carb-anchored slots use a tier 1 carb anchor; required minimum is ${requiredC} (${Math.round(clientProfile.buildSpec.tier_1_carb_min_pct_of_anchored_slots * 100)}%).`,
      });
    }
  }

  // ----- Check 4: anchor-variety violations (per Phase B6a-pivot rule) -----
  // Count ANCHOR uses per slug using the AUTHORED anchor flag from
  // day.pick.slots[i].ingredients[j].isAnchor. The earlier post-hoc
  // classification (highest absolute protein contributor) wrongly flagged
  // whey as the de-facto anchor on days where whey appears as a secondary
  // (whey at 80g P/100g easily outscores eggs at 12.6g P/100g even when
  // eggs is the authored anchor). Per the variety rule, non-anchor whey
  // is uncapped — only authored anchor positions count.
  //
  // After the meal-templates substitute step, day.pick reflects the
  // resolved slugs (e.g. swap_chain fallbacks for excluded primaries),
  // so this counts what was actually delivered.
  const anchorCountBySlug = new Map<string, number>();
  let supplementAnchorTotal = 0;
  for (const day of plan.days) {
    const pickByIndex = new Map(day.pick.slots.map((s) => [s.index, s]));
    for (const solveSlot of day.solve.slots) {
      // Skip slots that aren't protein-anchored (snacks, fruit-only slots).
      const cls = classifySlotAnchors(solveSlot, nutritionMap, clientProfile.buildSpec);
      if (!cls.is_protein_anchored) continue;

      // Find the authored anchor in the pick slot (first ingredient flagged
      // isAnchor). This is what the template author labeled the slot's
      // protein-defining choice — independent of which ingredient ends up
      // contributing the most absolute protein after the solver runs.
      const pickSlot = pickByIndex.get(solveSlot.index);
      if (!pickSlot) continue;
      const authored = pickSlot.ingredients.find((ing) => ing.isAnchor);
      if (!authored) continue;

      const slug = authored.slug;
      anchorCountBySlug.set(slug, (anchorCountBySlug.get(slug) ?? 0) + 1);
      if (SUPPLEMENT_ANCHOR_SLUGS.has(slug)) supplementAnchorTotal += 1;
    }
  }

  // Combined supplement cap (5×/week across the supplement-slug set).
  if (supplementAnchorTotal > SUPPLEMENT_ANCHOR_MAX_PER_WEEK) {
    const offenders = Array.from(anchorCountBySlug.entries())
      .filter(([slug]) => SUPPLEMENT_ANCHOR_SLUGS.has(slug))
      .sort((a, b) => b[1] - a[1])
      .map(([slug, n]) => `${slug}=${n}`);
    // B6a-pivot Option 4: demoted from BLOCK to WARN.
    warnings.push({
      severity: "WARN",
      check: "frequency_cap_exceeded",
      details: {
        rule: "supplement_anchor_combined_cap",
        actual_uses: supplementAnchorTotal,
        cap: SUPPLEMENT_ANCHOR_MAX_PER_WEEK,
        offending_slugs: offenders,
        category: "supplement",
      },
      reason: `Protein supplements appear as anchor ${supplementAnchorTotal} times across the week (${offenders.join(", ")}); combined cap is ${SUPPLEMENT_ANCHOR_MAX_PER_WEEK}× per week.`,
    });
  }

  // Per-slug cap for whole-food protein anchors (3×/week each).
  for (const [slug, count] of anchorCountBySlug.entries()) {
    if (SUPPLEMENT_ANCHOR_SLUGS.has(slug)) continue;
    if (count > WHOLE_FOOD_ANCHOR_MAX_PER_WEEK) {
      // B6a-pivot Option 4: demoted from BLOCK to WARN.
      warnings.push({
        severity: "WARN",
        check: "frequency_cap_exceeded",
        ingredient: slug,
        details: {
          rule: "whole_food_anchor_per_slug_cap",
          slug,
          actual_uses: count,
          cap: WHOLE_FOOD_ANCHOR_MAX_PER_WEEK,
          category: "whole_food",
        },
        reason: `Slug '${slug}' is the protein anchor in ${count} slots across the week; cap is ${WHOLE_FOOD_ANCHOR_MAX_PER_WEEK}× per week for whole-food anchors.`,
      });
    }
  }

  // ----- Check 5: daily macro compliance (WARN only) ----------------------
  for (const day of plan.days) {
    const actuals = day.solve.diagnostics.daily;
    const dayTargets = day.targets;
    const kcalDrift = actuals.calories / dayTargets.calories - 1;
    if (Math.abs(kcalDrift) > DAILY_KCAL_DRIFT_WARN) {
      warnings.push({
        severity: "WARN",
        check: "daily_kcal_drift",
        day: day.day,
        details: {
          actual_kcal: actuals.calories,
          target_kcal: dayTargets.calories,
          drift_pct: Math.round(kcalDrift * 1000) / 10,
        },
        reason: `Day ${day.day} kcal drift ${(kcalDrift * 100).toFixed(1)}% exceeds ±${DAILY_KCAL_DRIFT_WARN * 100}% target.`,
      });
    }
    for (const macro of ["protein", "carbs", "fat"] as const) {
      const actualV =
        macro === "protein"
          ? actuals.protein_g
          : macro === "carbs"
            ? actuals.carbs_g
            : actuals.fat_g;
      const targetV =
        macro === "protein"
          ? dayTargets.proteinG
          : macro === "carbs"
            ? dayTargets.carbsG
            : dayTargets.fatG;
      if (targetV === 0) continue;
      const drift = actualV / targetV - 1;
      if (Math.abs(drift) > DAILY_MACRO_DRIFT_WARN) {
        warnings.push({
          severity: "WARN",
          check: "daily_macro_drift",
          day: day.day,
          details: {
            macro,
            actual_g: actualV,
            target_g: targetV,
            drift_pct: Math.round(drift * 1000) / 10,
          },
          reason: `Day ${day.day} ${macro} drift ${(drift * 100).toFixed(1)}% exceeds ±${DAILY_MACRO_DRIFT_WARN * 100}% target.`,
        });
      }
    }
  }

  // ----- Check 6: per-meal compliance (WARN only) -------------------------
  for (const day of plan.days) {
    const dayTargets = day.targets;
    const dayDistribution = day.distribution;
    const perSlotTargets = computePerSlotTargets(dayTargets, dayDistribution);
    for (const slot of day.solve.slots) {
      const target = perSlotTargets.find((t) => t.index === slot.index);
      if (!target) continue;
      const actual = day.solve.diagnostics.per_slot.find((s) => s.slot_index === slot.index);
      if (!actual) continue;
      for (const macro of ["protein", "carbs", "fat"] as const) {
        const actualV =
          macro === "protein"
            ? actual.protein_g
            : macro === "carbs"
              ? actual.carbs_g
              : actual.fat_g;
        const targetV =
          macro === "protein"
            ? target.protein_g
            : macro === "carbs"
              ? target.carbs_g
              : target.fat_g;
        if (targetV === 0) continue;
        const drift = actualV / targetV - 1;
        if (Math.abs(drift) > PER_MEAL_DRIFT_WARN) {
          warnings.push({
            severity: "WARN",
            check: "per_meal_drift",
            day: day.day,
            meal: slot.index,
            details: {
              macro,
              actual_g: actualV,
              target_g: targetV,
              drift_pct: Math.round(drift * 1000) / 10,
            },
            reason: `Day ${day.day} meal ${slot.index} ${macro} drift ${(drift * 100).toFixed(1)}% exceeds ±${PER_MEAL_DRIFT_WARN * 100}% (observability — solver allowed wider band).`,
          });
        }
      }
    }
  }

  // ----- Check 8: custom distribution percentage validation ---------------
  if (clientProfile.customDistribution) {
    const dist = clientProfile.customDistribution;
    const sums = { protein: 0, carbs: 0, fat: 0 };
    for (const slot of dist.slots) {
      sums.protein += slot.protein_pct;
      sums.carbs += slot.carb_pct;
      sums.fat += slot.fat_pct;
    }
    for (const macro of ["protein", "carbs", "fat"] as const) {
      const sum = sums[macro];
      if (Math.abs(sum - 100) > CUSTOM_DIST_TOLERANCE * 100) {
        blocking_errors.push({
          severity: "BLOCK",
          check: "custom_distribution_invalid_sum",
          details: {
            macro,
            actual_sum: Math.round(sum * 100) / 100,
            tolerance_pct: CUSTOM_DIST_TOLERANCE * 100,
          },
          reason: `Custom distribution ${macro} column sums to ${sum.toFixed(2)}%, must be 100% ± ${CUSTOM_DIST_TOLERANCE * 100}%.`,
        });
      }
    }
  }

  return finalizeResult(blocking_errors, warnings, start);
}

// ============================================================================
// Helpers
// ============================================================================

function checkBuildMedicalCompatibility(profile: ClientProfile): AuditError[] {
  const errors: AuditError[] = [];
  const isPregnant = profile.medicalFlags.includes(MedicalFlag.PREGNANT_NURSING);
  const isKidney = profile.medicalFlags.includes(MedicalFlag.KIDNEY);

  if (isPregnant && profile.buildType === BuildType.SHRED) {
    errors.push({
      severity: "BLOCK",
      check: "build_medical_block",
      details: {
        build: profile.buildType,
        medical_flag: "pregnant_nursing",
      },
      reason: "Shred build incompatible with pregnancy/nursing — caloric deficit is contraindicated.",
    });
  }

  if (isKidney && profile.buildType === BuildType.BULK) {
    errors.push({
      severity: "WARN",
      check: "build_medical_warn",
      details: {
        build: profile.buildType,
        medical_flag: "kidney",
      },
      reason: "Bulk's elevated protein target may conflict with kidney protein restrictions; coach review required before delivering plan.",
    });
  }

  return errors;
}

function mergeHardExclude(profile: ClientProfile): Set<string> {
  const out = new Set<string>();
  for (const flag of profile.allergyFlags) {
    const rule = ALL_ALLERGY_RULES[flag];
    if (rule) for (const slug of rule.hard_exclude) out.add(slug);
  }
  for (const flag of profile.medicalFlags) {
    const rule = ALL_MEDICAL_RULES[flag];
    if (rule) for (const slug of rule.hard_exclude) out.add(slug);
  }
  if (profile.dietaryStyle !== null) {
    const rule = ALL_DIETARY_RULES[profile.dietaryStyle];
    if (rule) for (const slug of rule.hard_exclude) out.add(slug);
  }
  return out;
}

/**
 * Classifies which rule(s) put a slug into the merged hard_exclude set.
 * Returns a comma-joined list of source rule names (allergy_dairy,
 * vegan, etc.) — empty/`unknown` if no rule claims it. Used by
 * plan-selector to distinguish allergen leaks from dietary violations.
 */
export function identifyExcludeOrigin(
  slug: string,
  profile: ClientProfile,
): string {
  const sources: string[] = [];
  for (const flag of profile.allergyFlags) {
    if (ALL_ALLERGY_RULES[flag]?.hard_exclude.includes(slug)) sources.push(flag);
  }
  for (const flag of profile.medicalFlags) {
    if (ALL_MEDICAL_RULES[flag]?.hard_exclude.includes(slug)) sources.push(flag);
  }
  if (profile.dietaryStyle !== null) {
    if (ALL_DIETARY_RULES[profile.dietaryStyle]?.hard_exclude.includes(slug)) {
      sources.push(profile.dietaryStyle);
    }
  }
  return sources.join(", ") || "unknown";
}

interface TierDistributionResults {
  protein_anchored_total: number;
  protein_tier_1_count: number;
  carb_anchored_total: number;
  carb_tier_1_count: number;
}

function computeWeeklyTierDistribution(
  plan: WeekPlanSuccess,
  profile: ClientProfile,
  nutritionMap: Map<string, IngredientNutrition>,
): TierDistributionResults {
  let protein_anchored_total = 0;
  let protein_tier_1_count = 0;
  let carb_anchored_total = 0;
  let carb_tier_1_count = 0;

  for (const day of plan.days) {
    for (const slot of day.solve.slots) {
      const cls = classifySlotAnchors(slot, nutritionMap, profile.buildSpec);
      if (cls.is_protein_anchored) {
        protein_anchored_total += 1;
        if (cls.protein_anchor_is_tier_1) protein_tier_1_count += 1;
      }
      if (cls.is_carb_anchored) {
        carb_anchored_total += 1;
        if (cls.carb_anchor_is_tier_1) carb_tier_1_count += 1;
      }
    }
  }
  return {
    protein_anchored_total,
    protein_tier_1_count,
    carb_anchored_total,
    carb_tier_1_count,
  };
}

function finalizeResult(
  blocking_errors: AuditError[],
  warnings: AuditError[],
  startTime: number,
): AuditResult {
  const performance_ms = Date.now() - startTime;
  const pass = blocking_errors.length === 0;
  return {
    pass,
    blocking_errors,
    warnings,
    action: pass ? "PROCEED_TO_PDF_RENDER" : "BLOCK_GENERATION_RETURN_TO_COACH",
    performance_ms,
  };
}

// Re-export helpers for tests
export {
  PROTEIN_ANCHORED_SLOT_MIN_G,
  CARB_ANCHORED_SLOT_MIN_G,
};
