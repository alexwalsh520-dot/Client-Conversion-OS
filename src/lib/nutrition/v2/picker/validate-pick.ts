/**
 * Phase B3 — picker output validation.
 *
 * Validates the JSON the LLM returned BEFORE handing to solveDay. Catches:
 *   - JSON parse failures
 *   - Missing required fields (day, slots, slots[i].ingredients, etc.)
 *   - Invalid slug references (not in DB)
 *   - Excluded slug references (LLM hallucinated past hard_exclude)
 *   - Anchor count violations (must be exactly 1 per slot)
 *   - Slot count mismatch (must equal distribution.slots.length)
 *   - Empty slots
 *   - Per-slot ingredient count > planComplexity cap
 *
 * Returns an array of violations (empty = pass) so the retry prompt can
 * surface ALL issues at once instead of one-at-a-time.
 */

import type { MealDistribution, PlanComplexity } from "../types";
import { PLAN_COMPLEXITY_INGREDIENT_CAP } from "../types";
import type { PickViolation, PickedSlot } from "./types";

export interface ParsedPick {
  day: number;
  slots: PickedSlot[];
}

export interface ValidationContext {
  distribution: MealDistribution;
  hardExclude: ReadonlySet<string>;
  planComplexity: PlanComplexity;
  /** Slugs that exist in the DB. Validated against this set. */
  knownSlugs: ReadonlySet<string>;
}

// ============================================================================
// Parsing
// ============================================================================

export type ParseResult =
  | { ok: true; parsed: ParsedPick }
  | { ok: false; violations: PickViolation[] };

export function parsePickResponse(raw: string): ParseResult {
  let jsonStr = raw.trim();
  // Strip markdown fences if the LLM included them despite the system prompt
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();

  let raw_obj: unknown;
  try {
    raw_obj = JSON.parse(jsonStr);
  } catch (err) {
    return {
      ok: false,
      violations: [
        {
          kind: "json_parse_failed",
          message: `JSON parse failed: ${(err as Error).message}. First 300 chars: "${raw.slice(0, 300)}"`,
        },
      ],
    };
  }

  if (!isRecord(raw_obj)) {
    return {
      ok: false,
      violations: [
        {
          kind: "json_parse_failed",
          message: "Response is not a JSON object",
        },
      ],
    };
  }

  const violations: PickViolation[] = [];

  const day = toInt(raw_obj.day);
  if (day === null) {
    violations.push({ kind: "missing_field", message: "Missing or non-integer 'day' field" });
  }

  if (!Array.isArray(raw_obj.slots)) {
    violations.push({ kind: "missing_field", message: "Missing or non-array 'slots' field" });
    return { ok: false, violations };
  }

  const slots: PickedSlot[] = [];
  for (let i = 0; i < raw_obj.slots.length; i++) {
    const rawSlot = raw_obj.slots[i];
    if (!isRecord(rawSlot)) {
      violations.push({
        kind: "missing_field",
        slot_index: i + 1,
        message: `slots[${i}] is not an object`,
      });
      continue;
    }
    const idx = toInt(rawSlot.index);
    if (idx === null) {
      violations.push({
        kind: "missing_field",
        slot_index: i + 1,
        message: `slots[${i}] missing or non-integer 'index'`,
      });
      continue;
    }
    if (!Array.isArray(rawSlot.ingredients)) {
      violations.push({
        kind: "missing_field",
        slot_index: idx,
        message: `slots[${i}] missing or non-array 'ingredients'`,
      });
      continue;
    }
    const ingredients: PickedSlot["ingredients"] = [];
    for (let j = 0; j < rawSlot.ingredients.length; j++) {
      const rawIng = rawSlot.ingredients[j];
      if (!isRecord(rawIng) || typeof rawIng.slug !== "string") {
        violations.push({
          kind: "missing_field",
          slot_index: idx,
          message: `slot ${idx} ingredient[${j}] missing 'slug' string`,
        });
        continue;
      }
      ingredients.push({
        slug: rawIng.slug,
        isAnchor: rawIng.isAnchor === true,
      });
    }
    slots.push({ index: idx, ingredients });
  }

  if (violations.length > 0) {
    return { ok: false, violations };
  }
  return {
    ok: true,
    parsed: { day: day ?? 0, slots },
  };
}

// ============================================================================
// Validation against context
// ============================================================================

export function validatePick(
  parsed: ParsedPick,
  ctx: ValidationContext,
): PickViolation[] {
  const violations: PickViolation[] = [];

  // Slot count
  if (parsed.slots.length !== ctx.distribution.slots.length) {
    violations.push({
      kind: "wrong_slot_count",
      message: `Expected ${ctx.distribution.slots.length} slots (per ${ctx.distribution.label}); got ${parsed.slots.length}`,
    });
  }

  const expectedIndices = new Set(ctx.distribution.slots.map((s) => s.index));
  const cap = PLAN_COMPLEXITY_INGREDIENT_CAP[ctx.planComplexity];

  for (const slot of parsed.slots) {
    if (!expectedIndices.has(slot.index)) {
      violations.push({
        kind: "wrong_slot_count",
        slot_index: slot.index,
        message: `Slot index ${slot.index} not present in ${ctx.distribution.label} (expected one of ${Array.from(expectedIndices).join(", ")})`,
      });
    }

    if (slot.ingredients.length === 0) {
      violations.push({
        kind: "empty_slot",
        slot_index: slot.index,
        message: `Slot ${slot.index} has zero ingredients`,
      });
      continue;
    }

    if (slot.ingredients.length > cap) {
      violations.push({
        kind: "complexity_cap_exceeded",
        slot_index: slot.index,
        message: `Slot ${slot.index} has ${slot.ingredients.length} ingredients; cap is ${cap} (${ctx.planComplexity})`,
      });
    }

    let anchorCount = 0;
    for (const ing of slot.ingredients) {
      if (!ctx.knownSlugs.has(ing.slug)) {
        violations.push({
          kind: "invalid_slug",
          slot_index: slot.index,
          slug: ing.slug,
          message: `Slug "${ing.slug}" does not exist in the ingredients database`,
        });
        continue;
      }
      if (ctx.hardExclude.has(ing.slug)) {
        violations.push({
          kind: "excluded_slug",
          slot_index: slot.index,
          slug: ing.slug,
          message: `Slug "${ing.slug}" is on the HARD EXCLUDE list and may not be used`,
        });
      }
      if (ing.isAnchor) anchorCount++;
    }

    if (anchorCount === 0) {
      violations.push({
        kind: "missing_anchor",
        slot_index: slot.index,
        message: `Slot ${slot.index} has no anchor — exactly one ingredient must have isAnchor: true`,
      });
    } else if (anchorCount > 1) {
      violations.push({
        kind: "multiple_anchors",
        slot_index: slot.index,
        message: `Slot ${slot.index} has ${anchorCount} anchors — exactly one ingredient must have isAnchor: true`,
      });
    }
  }

  return violations;
}

// ============================================================================
// Helpers
// ============================================================================

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return parseInt(v, 10);
  return null;
}
