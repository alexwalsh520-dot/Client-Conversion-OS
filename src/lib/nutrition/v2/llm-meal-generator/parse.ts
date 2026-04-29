/**
 * Defensive parser for the submit_plan tool response.
 *
 * Even with strict input_schema, Claude occasionally produces variant
 * shapes or invalid values (slugs not in the approved list, grams out
 * of bounds, missing meals, etc). This parser:
 *   - Locates the days array under common variant keys
 *   - Coerces day_number / slot / grams to integers
 *   - Validates each ingredient slug against the known set
 *   - Validates grams against per-slug min/max bounds
 *   - Filters meals with too few ingredients or invalid structure
 *
 * Returns a parsed plan plus per-meal rejection reasons so the caller
 * can surface them in diagnostics.
 */

import type { RawDay, RawIngredient, RawMeal, RawPlan } from "./types";

export interface ParseResult {
  plan: RawPlan | null;
  rejected_meals: Array<{
    day_number: number;
    slot: number;
    reason: string;
  }>;
  /**
   * Slugs the parser had to drop because they were either not in the
   * approved set or in the merged hard_exclude. Surfacing these (rather
   * than silently filtering) lets the plan-selector grade attempts:
   * an attempt with an allergen leak is a hard error even if the parser
   * scrubbed it, because it indicates the LLM didn't honor the constraint.
   */
  dropped_slugs: Array<{
    day_number: number;
    slot: number;
    slug: string;
    reason: "invalid_slug" | "hard_exclude";
  }>;
  fatal: string | null;
}

interface ValidationContext {
  approved_slugs: ReadonlySet<string>;
  /** Per-slug gram bounds (min, max). */
  gram_bounds: ReadonlyMap<string, { min: number; max: number }>;
  /** Hard-excluded slugs — appearance is fatal-ish (per-meal reject). */
  hard_exclude: ReadonlySet<string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseSubmitPlanResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolInput: any,
  ctx: ValidationContext,
): ParseResult {
  const rejected: ParseResult["rejected_meals"] = [];
  const dropped_slugs: ParseResult["dropped_slugs"] = [];

  if (toolInput == null || typeof toolInput !== "object") {
    return {
      plan: null,
      rejected_meals: [],
      dropped_slugs: [],
      fatal: `tool_input is not an object: ${typeof toolInput}`,
    };
  }

  // Locate the days array under common variant keys (model occasionally
  // wraps differently despite the schema).
  let daysArray: unknown = null;
  if (Array.isArray(toolInput)) {
    daysArray = toolInput;
  } else if (Array.isArray(toolInput.days)) {
    daysArray = toolInput.days;
  } else {
    for (const key of ["plan", "week", "schedule"]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const candidate = (toolInput as any)[key];
      if (Array.isArray(candidate)) {
        daysArray = candidate;
        break;
      }
      if (candidate && typeof candidate === "object" && Array.isArray(candidate.days)) {
        daysArray = candidate.days;
        break;
      }
    }
  }
  if (!Array.isArray(daysArray)) {
    const keys = Object.keys(toolInput).join(", ");
    return {
      plan: null,
      rejected_meals: [],
      dropped_slugs: [],
      fatal: `tool_input has no days array (top-level keys: [${keys}])`,
    };
  }

  if (daysArray.length === 0) {
    return {
      plan: null,
      rejected_meals: [],
      dropped_slugs: [],
      fatal: "tool_input.days is empty",
    };
  }

  const parsedDays: RawDay[] = [];
  for (const rawDay of daysArray as unknown[]) {
    if (rawDay == null || typeof rawDay !== "object") continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = rawDay as any;
    const day_number = coerceInt(d.day_number, 1, 7);
    const weekday = typeof d.weekday === "string" ? d.weekday.toLowerCase() : "";
    if (day_number === null) continue;
    if (!Array.isArray(d.meals)) continue;

    const parsedMeals: RawMeal[] = [];
    for (const rawMeal of d.meals as unknown[]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = rawMeal as any;
      if (m == null || typeof m !== "object") continue;
      const slot = coerceInt(m.slot, 1, 6);
      const name = typeof m.name === "string" ? m.name : "";
      const dish_name = typeof m.dish_name === "string" ? m.dish_name.trim() : "";
      if (slot === null || name.length === 0) continue;
      if (!Array.isArray(m.ingredients)) {
        rejected.push({ day_number, slot, reason: "ingredients not an array" });
        continue;
      }

      const parsedIngs: RawIngredient[] = [];
      let mealHadInvalidSlug = false;
      let mealHadHardExclude = false;
      let mealHadOutOfBoundsGrams = false;
      for (const rawIng of m.ingredients as unknown[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const i = rawIng as any;
        if (i == null || typeof i !== "object") continue;
        const slug = typeof i.slug === "string" ? i.slug.trim() : "";
        const grams = coerceInt(i.grams, 1, 800);
        const is_anchor = i.is_anchor === true;
        if (slug.length === 0 || grams === null) continue;

        if (!ctx.approved_slugs.has(slug)) {
          mealHadInvalidSlug = true;
          dropped_slugs.push({
            day_number,
            slot,
            slug,
            reason: "invalid_slug",
          });
          continue;
        }
        if (ctx.hard_exclude.has(slug)) {
          mealHadHardExclude = true;
          dropped_slugs.push({
            day_number,
            slot,
            slug,
            reason: "hard_exclude",
          });
          continue;
        }
        const bounds = ctx.gram_bounds.get(slug);
        if (bounds && (grams < bounds.min || grams > bounds.max)) {
          // Clamp instead of rejecting — small over/under is OK; the macro
          // verifier will catch real macro misses downstream.
          const clamped = Math.max(bounds.min, Math.min(bounds.max, grams));
          parsedIngs.push({ slug, grams: clamped, is_anchor });
          if (Math.abs(clamped - grams) > 5) mealHadOutOfBoundsGrams = true;
          continue;
        }
        parsedIngs.push({ slug, grams, is_anchor });
      }

      if (parsedIngs.length < 2) {
        rejected.push({
          day_number,
          slot,
          reason: `${parsedIngs.length} valid ingredient(s) — need ≥ 2` +
            (mealHadInvalidSlug ? " (invalid slug rejected)" : "") +
            (mealHadHardExclude ? " (hard-exclude slug rejected)" : ""),
        });
        continue;
      }

      const anchorCount = parsedIngs.filter((i) => i.is_anchor).length;
      if (anchorCount === 0) {
        // No anchor flagged — promote the highest-protein slug as anchor.
        const sorted = [...parsedIngs];
        sorted.sort((a, b) => b.grams - a.grams);
        const promoted = sorted[0];
        for (const ing of parsedIngs) {
          if (ing.slug === promoted.slug) ing.is_anchor = true;
          else ing.is_anchor = false;
        }
        rejected.push({
          day_number,
          slot,
          reason: `no anchor flagged — promoted ${promoted.slug} (highest grams)`,
        });
      } else if (anchorCount > 1) {
        // Multiple anchors — keep the first, demote the rest.
        let kept = false;
        for (const ing of parsedIngs) {
          if (!kept && ing.is_anchor) {
            kept = true;
          } else {
            ing.is_anchor = false;
          }
        }
        rejected.push({
          day_number,
          slot,
          reason: `multiple anchors flagged — kept first, demoted rest`,
        });
      }

      void mealHadOutOfBoundsGrams;
      parsedMeals.push({ slot, name, dish_name: dish_name || `Meal ${slot}`, ingredients: parsedIngs });
    }

    if (parsedMeals.length === 0) continue;
    parsedDays.push({ day_number, weekday, meals: parsedMeals });
  }

  if (parsedDays.length < 7) {
    return {
      plan: null,
      rejected_meals: rejected,
      dropped_slugs,
      fatal: `parsed ${parsedDays.length} valid day(s), expected 7`,
    };
  }

  return {
    plan: { days: parsedDays },
    rejected_meals: rejected,
    dropped_slugs,
    fatal: null,
  };
}

function coerceInt(v: unknown, min: number, max: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const i = Math.floor(v);
  if (i < min || i > max) return null;
  return i;
}
