/**
 * Phase B4 — Check 3 anchor detection logic.
 *
 * "Tier 1 anchor" definition (locked per spec):
 *   - A slot is "protein-anchored" if total protein from all ingredients
 *     in that slot ≥ 15g. Slots below this threshold (e.g. fruit + honey
 *     snacks) are NOT protein-anchored and do not count toward Check 3's
 *     denominator. Same for carbs at the 10g threshold.
 *
 *   - A protein-anchored slot uses a "tier 1 anchor" if the slot's
 *     highest-protein ingredient (ranked by absolute contribution =
 *     grams × protein_per_100g, NOT density) has its slug in
 *     buildSpec.tier_1 AND that entry's role/hybrid includes protein.
 *
 *   - Hybrid-tagged ingredients count for the role they're filling in
 *     that specific slot. Salmon as highest-protein in slot 2 is a tier 1
 *     protein anchor; salmon as highest-fat in slot 5 is a tier 1 fat
 *     anchor (separate evaluation, no double-counting).
 *
 *   - Tie-breaking on identical absolute contribution: first-listed in
 *     the slot.ingredients array wins (deterministic).
 *
 * Role eligibility:
 *   PROTEIN-eligible roles: PROTEIN, SUPPLEMENT (whey/casein/pea protein
 *     are protein supplements), or any hybrid containing PROTEIN.
 *   CARB-eligible roles: CARB, FRUIT (fruits are carb-dominant), or any
 *     hybrid containing CARB.
 */

import { HybridTagKind, MacroRole } from "../types";
import type { BuildSpec, TierEntry } from "../types";
import type { IngredientNutrition } from "../solver";
import type { SlotResult } from "../solver";

// ============================================================================
// Slot anchoring thresholds (locked per spec)
// ============================================================================

export const PROTEIN_ANCHORED_SLOT_MIN_G = 15;
export const CARB_ANCHORED_SLOT_MIN_G = 10;

// ============================================================================
// Total macro contributions for a slot
// ============================================================================

export interface SlotMacroSum {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export function computeSlotMacroSum(
  slot: SlotResult,
  nutritionMap: Map<string, IngredientNutrition>,
): SlotMacroSum {
  let p = 0,
    c = 0,
    f = 0;
  for (const ing of slot.ingredients) {
    const nut = nutritionMap.get(ing.slug);
    if (!nut) continue; // missing ingredients flagged separately by Check 0
    p += (ing.grams * nut.protein_g_per_100g) / 100;
    c += (ing.grams * nut.carbs_g_per_100g) / 100;
    f += (ing.grams * nut.fat_g_per_100g) / 100;
  }
  return { protein_g: p, carbs_g: c, fat_g: f };
}

// ============================================================================
// Highest-X ingredient finders (by absolute contribution, first-listed wins on tie)
// ============================================================================

export function findHighestProteinIngredient(
  slot: SlotResult,
  nutritionMap: Map<string, IngredientNutrition>,
): { slug: string; absolute_protein_g: number } | null {
  let best: { slug: string; absolute_protein_g: number } | null = null;
  for (const ing of slot.ingredients) {
    const nut = nutritionMap.get(ing.slug);
    if (!nut) continue;
    const contribution = (ing.grams * nut.protein_g_per_100g) / 100;
    // First-listed wins on tie: only update if STRICTLY greater
    if (best === null || contribution > best.absolute_protein_g) {
      best = { slug: ing.slug, absolute_protein_g: contribution };
    }
  }
  return best;
}

export function findHighestCarbIngredient(
  slot: SlotResult,
  nutritionMap: Map<string, IngredientNutrition>,
): { slug: string; absolute_carbs_g: number } | null {
  let best: { slug: string; absolute_carbs_g: number } | null = null;
  for (const ing of slot.ingredients) {
    const nut = nutritionMap.get(ing.slug);
    if (!nut) continue;
    const contribution = (ing.grams * nut.carbs_g_per_100g) / 100;
    if (best === null || contribution > best.absolute_carbs_g) {
      best = { slug: ing.slug, absolute_carbs_g: contribution };
    }
  }
  return best;
}

// ============================================================================
// Role eligibility for tier 1 anchor classification
// ============================================================================

function tierEntryHasProteinRole(entry: TierEntry): boolean {
  // PROTEIN role: obvious
  if (entry.role === MacroRole.PROTEIN) return true;
  // SUPPLEMENT role: whey, casein, pea protein, etc. — protein supplements
  // are protein anchors functionally. (nutritional_yeast is the only
  // supplement that isn't protein-dominant; if it were the highest-P
  // ingredient in a slot, the slot would fail the 15g threshold anyway.)
  if (entry.role === MacroRole.SUPPLEMENT) return true;
  // Hybrid tags containing protein
  if (entry.hybrid !== undefined) {
    if (
      entry.hybrid === HybridTagKind.PROTEIN ||
      entry.hybrid === HybridTagKind.PROTEIN_FAT ||
      entry.hybrid === HybridTagKind.PROTEIN_CARB
    ) {
      return true;
    }
  }
  return false;
}

function tierEntryHasCarbRole(entry: TierEntry): boolean {
  if (entry.role === MacroRole.CARB) return true;
  // FRUIT: bananas, apples, dates etc. are carb-dominant
  if (entry.role === MacroRole.FRUIT) return true;
  if (entry.hybrid !== undefined) {
    if (
      entry.hybrid === HybridTagKind.CARB ||
      entry.hybrid === HybridTagKind.PROTEIN_CARB ||
      entry.hybrid === HybridTagKind.CARB_FAT
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// Tier 1 anchor classification
// ============================================================================

export interface AnchorClassification {
  /** Whether the slot meets the protein-anchored threshold (≥15g). */
  is_protein_anchored: boolean;
  /** Whether the slot meets the carb-anchored threshold (≥10g). */
  is_carb_anchored: boolean;
  /** Highest-protein ingredient slug if protein-anchored, else null. */
  protein_anchor_slug: string | null;
  /** Highest-carb ingredient slug if carb-anchored, else null. */
  carb_anchor_slug: string | null;
  /** Whether the protein anchor is a tier 1 ingredient with a protein role. */
  protein_anchor_is_tier_1: boolean;
  /** Whether the carb anchor is a tier 1 ingredient with a carb role. */
  carb_anchor_is_tier_1: boolean;
}

export function classifySlotAnchors(
  slot: SlotResult,
  nutritionMap: Map<string, IngredientNutrition>,
  buildSpec: BuildSpec,
): AnchorClassification {
  const sums = computeSlotMacroSum(slot, nutritionMap);
  const is_protein_anchored = sums.protein_g >= PROTEIN_ANCHORED_SLOT_MIN_G;
  const is_carb_anchored = sums.carbs_g >= CARB_ANCHORED_SLOT_MIN_G;

  let protein_anchor_slug: string | null = null;
  let protein_anchor_is_tier_1 = false;
  if (is_protein_anchored) {
    const top = findHighestProteinIngredient(slot, nutritionMap);
    if (top !== null) {
      protein_anchor_slug = top.slug;
      const tier1Entry = buildSpec.tier_1.find((e) => e.slug === top.slug);
      if (tier1Entry !== undefined && tierEntryHasProteinRole(tier1Entry)) {
        protein_anchor_is_tier_1 = true;
      }
    }
  }

  let carb_anchor_slug: string | null = null;
  let carb_anchor_is_tier_1 = false;
  if (is_carb_anchored) {
    const top = findHighestCarbIngredient(slot, nutritionMap);
    if (top !== null) {
      carb_anchor_slug = top.slug;
      const tier1Entry = buildSpec.tier_1.find((e) => e.slug === top.slug);
      if (tier1Entry !== undefined && tierEntryHasCarbRole(tier1Entry)) {
        carb_anchor_is_tier_1 = true;
      }
    }
  }

  return {
    is_protein_anchored,
    is_carb_anchored,
    protein_anchor_slug,
    carb_anchor_slug,
    protein_anchor_is_tier_1,
    carb_anchor_is_tier_1,
  };
}
