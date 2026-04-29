/**
 * Phase B5 — main pdf-adapter entry point.
 *
 * Pure data transformation: (WeekPlanSuccess, IntakeSnapshot) → PdfInput
 * ready to feed into renderMealPlanPDF.
 *
 * What this module does NOT do:
 *   - Call solveDay or any picker code (plan is already finalized)
 *   - Hit the database (uses in-memory ingredient cache)
 *   - Take the audit result (audit is coach-facing, not client-facing)
 *   - Modify the legacy renderer or its types
 *
 * Sodium is not surfaced anywhere in the PdfInput. Per the locked rule,
 * the rendered PDF must contain no sodium values. The renderer's PdfDay
 * type has an optional `totalSodiumMg` field that we deliberately leave
 * undefined.
 */

import type {
  PdfInput,
  PdfDay,
  PdfMeal,
  PdfIngredient,
} from "../../pdf-renderer";
import { getIngredientNutrition, type IngredientNutrition } from "../solver";
import type { WeekPlanSuccess } from "../picker";
import {
  computeIngredientMacros,
  formatAmount,
  lookupDisplayMeta,
  type IngredientDisplayMeta,
} from "./ingredient-display";
import { aggregateGrocery, topByCategoryGrams } from "./grocery-aggregator";
import { buildClientInfo } from "./client-info";
import { buildTips } from "./tips-bridge";
import { AdapterError, type AdapterOptions, type IntakeSnapshot } from "./types";

// ============================================================================
// Weekday labels
// ============================================================================

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Async because we may need to populate the ingredient cache. After the
 * first call (or if caller pre-warms via getIngredientNutrition), subsequent
 * calls hit the cache directly. No DB hits on warm cache.
 *
 * The optional `displayMeta` parameter lets callers pre-supply the
 * slug → display name + category mapping. If omitted, the adapter throws
 * AdapterError immediately — display names aren't in the nutrition cache,
 * so the caller MUST provide them.
 */
export async function weekPlanToPdfInput(
  plan: WeekPlanSuccess,
  intake: IntakeSnapshot,
  displayMeta: ReadonlyMap<string, IngredientDisplayMeta>,
  _options: AdapterOptions = {},
): Promise<PdfInput> {
  // ---- 1. Validate inputs ------------------------------------------------
  if (plan.days.length === 0) {
    throw new AdapterError("invalid_plan", "WeekPlanSuccess has zero days.");
  }
  if (plan.days.length > 7) {
    throw new AdapterError(
      "invalid_plan",
      `WeekPlanSuccess has ${plan.days.length} days; expected ≤ 7.`,
    );
  }

  // ---- 2. Collect every slug used + fetch nutrition (cache-warm) ---------
  const allSlugs = new Set<string>();
  for (const day of plan.days) {
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        if (ing.grams > 0) allSlugs.add(ing.slug);
      }
    }
  }
  const nutritionMap = await getIngredientNutrition(Array.from(allSlugs));
  for (const slug of allSlugs) {
    if (!nutritionMap.has(slug)) {
      throw new AdapterError(
        "missing_ingredient",
        `pdf-adapter: nutrition for slug '${slug}' not in cache. Pre-warm the cache before calling.`,
      );
    }
  }

  // ---- 3. Build per-day PdfDay structures --------------------------------
  const pdfDays = plan.days.map((day) =>
    buildPdfDay(day, nutritionMap, displayMeta),
  );

  // ---- 4. Aggregate grocery list across all 7 days -----------------------
  const grocery = aggregateGrocery(plan, displayMeta);

  // ---- 5. Build tips (legacy generators called unchanged via bridge) -----
  // Use the training-day targets as the "daily" reference for tip copy
  // (kcal-per-day messaging). Endurance's rest days will land below.
  // Pick the first day's targets as a representative; if all days are
  // training, this is the training target.
  const referenceTargets =
    plan.days.find((d) => d.day_kind === "training")?.targets ??
    plan.days[0].targets;

  const topProteins = topByCategoryGrams(grocery, ["protein", "seafood"], 3);
  const topGrains = topByCategoryGrams(grocery, ["grain", "carb"], 2);
  const tips = buildTips({
    intake,
    targets: referenceTargets,
    topProteins,
    topGrains,
  });

  // ---- 6. Cover page client info ----------------------------------------
  const mealsPerDayDisplay = computeMealsPerDayDisplay(pdfDays);
  const client = buildClientInfo({ intake, mealsPerDayDisplay });

  // ---- 7. Compose PdfInput ----------------------------------------------
  return {
    client,
    targets: referenceTargets,
    days: pdfDays,
    grocery,
    tips,
  };
}

// ============================================================================
// PdfDay construction
// ============================================================================

function buildPdfDay(
  day: WeekPlanSuccess["days"][number],
  nutritionMap: ReadonlyMap<string, IngredientNutrition>,
  displayMeta: ReadonlyMap<string, IngredientDisplayMeta>,
): PdfDay {
  const dayIdx = day.day - 1; // 0-based for WEEKDAYS
  const weekday =
    dayIdx >= 0 && dayIdx < WEEKDAYS.length
      ? WEEKDAYS[dayIdx]
      : `Day ${day.day}`;

  // Solver outputs slots ordered by index; preserve that ordering.
  const meals: PdfMeal[] = day.solve.slots.map((slot) => {
    // Find the matching distribution slot for label + time hint.
    const distSlot = day.distribution.slots.find((s) => s.index === slot.index);
    const mealName = distSlot?.label ?? `Meal ${slot.index}`;
    // The renderer expects a `time` string. v2 doesn't carry meal times,
    // so we leave it empty — renderer handles "" gracefully (it just
    // appends "  ·  " + empty, which renders as a separator).
    // Future polish: derive times from per-slot kind (BREAKFAST → 7:30 AM,
    // PRE_WORKOUT → 1 hr before training, etc.).
    const time = "";

    // Template-authored dish name lookup (B6a-pivot wiring). The
    // deterministic template orchestrator populates day.template_meta
    // with a slot.index → dish_name map. Renderer shows it as the inline
    // meal heading: "Breakfast · Blueberry Almond Protein Oats · 7:30 AM".
    // Falls back to undefined when template_meta is absent (e.g. legacy
    // LLM picker path) — renderer omits the extra segment cleanly.
    const dishName = day.template_meta?.slot_dish_names[slot.index];

    let mealCal = 0;
    let mealP = 0;
    let mealC = 0;
    let mealF = 0;

    const ingredients: PdfIngredient[] = slot.ingredients
      .filter((i) => i.grams > 0)
      .map((ing) => {
        const nut = nutritionMap.get(ing.slug)!;
        const display = lookupDisplayMeta(ing.slug, displayMeta);
        const macros = computeIngredientMacros(ing.grams, nut);
        mealCal += macros.calories;
        mealP += macros.proteinG;
        mealC += macros.carbsG;
        mealF += macros.fatG;
        return {
          name: display.name,
          amount: formatAmount(ing.grams, display.category),
          calories: macros.calories,
          proteinG: macros.proteinG,
          carbsG: macros.carbsG,
          fatG: macros.fatG,
          category: display.category,
        };
      });

    return {
      name: mealName,
      time,
      dishName,
      ingredients,
      totalCal: mealCal,
      totalP: mealP,
      totalC: mealC,
      totalF: mealF,
    };
  });

  const totalCal = meals.reduce((s, m) => s + m.totalCal, 0);
  const totalP = meals.reduce((s, m) => s + m.totalP, 0);
  const totalC = meals.reduce((s, m) => s + m.totalC, 0);
  const totalF = meals.reduce((s, m) => s + m.totalF, 0);

  // Sodium intentionally omitted: renderer's PdfDay.totalSodiumMg is
  // optional and only displayed if present. Leaving undefined keeps
  // sodium off the rendered output.
  return {
    dayNumber: day.day,
    weekday,
    meals,
    totalCal,
    totalP,
    totalC,
    totalF,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Determine the value to display in the cover page's "Meals / Day" row.
 * If every day has the same meal count, return that number. Otherwise
 * return "Variable" (used for endurance training/rest mixes).
 */
function computeMealsPerDayDisplay(
  days: ReadonlyArray<PdfDay>,
): number | "Variable" {
  if (days.length === 0) return 0;
  const counts = new Set(days.map((d) => d.meals.length));
  if (counts.size === 1) {
    return days[0].meals.length;
  }
  return "Variable";
}
