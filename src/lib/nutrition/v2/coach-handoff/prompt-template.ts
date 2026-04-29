/**
 * Coach handoff prompt — section builders.
 *
 * Pure markdown emitters, no I/O. Composed by generate-handoff-prompt.ts
 * into the final string the coach pastes into Claude.ai.
 *
 * Each builder returns a string ending in a single trailing newline so
 * the joiner can simply `\n` between sections.
 */

import type { WeekPlanSuccess } from "../picker";
import type { AuditError, AuditResult } from "../audit/types";
import type { MacroTargets } from "../../macro-calculator";
import type {
  AllergyFlag,
  BuildSpec,
  BuildType,
  DietaryStyle,
  MealDistribution,
  MedicalFlag,
} from "../types";
import type { IngredientNutrition } from "../solver/types";
import type { VerifyMacrosResult } from "../macro-verifier";
import type {
  AnchorAtCap,
  ComplexityDetail,
  NearBlockSodiumDay,
} from "./complexity-detector";
import { CORRECTION_SCHEMA } from "./correction-schema";

// ---------------------------------------------------------------------------
// Section: Header
// ---------------------------------------------------------------------------

export function headerSection(): string {
  return `# Meal Plan — Coach Review Requested

You are helping a fitness coach review and correct a meal plan. The system that generated this plan flagged it as complex and recommended human review. Your job is to iterate with the coach on specific meals, swap ingredients, adjust portions, and explain trade-offs. Prioritize: macro accuracy, variety, real-world cookability, and the client's stated preferences.
`;
}

// ---------------------------------------------------------------------------
// Section: Client profile (first name only — no PII beyond that)
// ---------------------------------------------------------------------------

export interface CoachProfileInput {
  first_name: string;
  sex: "male" | "female";
  weight_kg: number;
  height_cm: number;
  age: number;
  build_type: BuildType;
  dietary_style: DietaryStyle | null;
  allergy_flags: AllergyFlag[];
  medical_flags: MedicalFlag[];
}

export function clientProfileSection(p: CoachProfileInput): string {
  const allergy = p.allergy_flags.length ? p.allergy_flags.join(", ") : "none";
  const medical = p.medical_flags.length ? p.medical_flags.join(", ") : "none";
  return `## Client profile
- First name: ${p.first_name}
- Sex: ${p.sex}, Age: ${p.age}
- Weight: ${p.weight_kg.toFixed(1)} kg (${(p.weight_kg * 2.20462).toFixed(1)} lbs)
- Height: ${p.height_cm} cm
- Build goal: ${p.build_type}
- Dietary style: ${p.dietary_style ?? "no restriction"}
- Allergy flags: ${allergy}
- Medical flags: ${medical}
`;
}

// ---------------------------------------------------------------------------
// Section: Daily macro targets
// ---------------------------------------------------------------------------

export function targetsSection(args: {
  training: MacroTargets;
  rest: MacroTargets;
  distribution: MealDistribution;
}): string {
  const { training, rest, distribution } = args;
  const lines: string[] = [];
  lines.push("## Daily macro targets");
  lines.push(`Training day: ${training.calories} kcal · P=${training.proteinG}g · C=${training.carbsG}g · F=${training.fatG}g · sodium cap ${training.sodiumCapMg} mg/day (audit ceiling = cap × 1.15 ≈ ${Math.round(training.sodiumCapMg * 1.15)} mg)`);
  if (rest.calories !== training.calories) {
    lines.push(`Rest day: ${rest.calories} kcal · P=${rest.proteinG}g · C=${rest.carbsG}g · F=${rest.fatG}g`);
  }
  lines.push("");
  lines.push(`Distribution: ${distribution.label} (${distribution.meals_per_day} meals/day)`);
  for (const s of distribution.slots) {
    const p = Math.round((training.proteinG * s.protein_pct) / 100);
    const c = Math.round((training.carbsG * s.carb_pct) / 100);
    const f = Math.round((training.fatG * s.fat_pct) / 100);
    const kcal = p * 4 + c * 4 + f * 9;
    lines.push(`- Slot ${s.index} ${s.label}: ~${kcal} kcal · P=${p}g · C=${c}g · F=${f}g`);
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Section: Current plan (structured slug + grams + dish_name per meal)
// ---------------------------------------------------------------------------

export function currentPlanSection(
  planResult: WeekPlanSuccess,
  nutritionMap: ReadonlyMap<string, IngredientNutrition>,
): string {
  const lines: string[] = [];
  lines.push("## Current generated plan");
  lines.push("Format: per-day, per-meal slug+grams (anchor marked ★) plus computed totals.");
  lines.push("");

  for (const day of planResult.days) {
    const dishNames = day.template_meta?.slot_dish_names ?? {};
    let dailyP = 0, dailyC = 0, dailyF = 0, dailyKcal = 0, dailyNa = 0;
    lines.push(`### Day ${day.day} (${day.day_kind})`);

    const pickByIndex = new Map(
      (day.pick.slots ?? []).map((s) => [s.index, s]),
    );

    for (const slot of day.solve.slots) {
      const dish = dishNames[slot.index] ?? `(meal ${slot.index})`;
      lines.push(`**Slot ${slot.index} — ${dish}**`);
      const pickSlot = pickByIndex.get(slot.index);
      const anchorSlug = pickSlot?.ingredients.find((i) => i.isAnchor)?.slug;
      let slotP = 0, slotC = 0, slotF = 0, slotKcal = 0, slotNa = 0;
      for (const ing of slot.ingredients) {
        const nut = nutritionMap.get(ing.slug);
        const isAnchor = ing.slug === anchorSlug;
        const marker = isAnchor ? " ★" : "";
        if (nut) {
          const p = (ing.grams * nut.protein_g_per_100g) / 100;
          const c = (ing.grams * nut.carbs_g_per_100g) / 100;
          const f = (ing.grams * nut.fat_g_per_100g) / 100;
          const na = (ing.grams * nut.sodium_mg_per_100g) / 100;
          const kcal = p * 4 + c * 4 + f * 9;
          slotP += p; slotC += c; slotF += f; slotKcal += kcal; slotNa += na;
          lines.push(`  - ${ing.slug}${marker}: ${ing.grams}g (P${p.toFixed(0)} C${c.toFixed(0)} F${f.toFixed(0)} ${kcal.toFixed(0)}kcal Na${na.toFixed(0)}mg)`);
        } else {
          lines.push(`  - ${ing.slug}${marker}: ${ing.grams}g (nutrition data missing)`);
        }
      }
      lines.push(`  → slot total: ${slotKcal.toFixed(0)} kcal · P=${slotP.toFixed(0)}g · C=${slotC.toFixed(0)}g · F=${slotF.toFixed(0)}g · Na=${slotNa.toFixed(0)}mg`);
      dailyP += slotP; dailyC += slotC; dailyF += slotF; dailyKcal += slotKcal; dailyNa += slotNa;
    }
    lines.push(`**Day ${day.day} totals: ${dailyKcal.toFixed(0)} kcal · P=${dailyP.toFixed(0)}g · C=${dailyC.toFixed(0)}g · F=${dailyF.toFixed(0)}g · Na=${dailyNa.toFixed(0)}mg**`);
    lines.push("");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Section: Flagged issues — concrete, day-specific, actionable
// ---------------------------------------------------------------------------

export interface FlaggedIssuesArgs {
  audit: AuditResult;
  verifyResult: VerifyMacrosResult;
  complexity: ComplexityDetail;
  planResult: WeekPlanSuccess;
  nutritionMap: ReadonlyMap<string, IngredientNutrition>;
  targets: { training: MacroTargets; rest: MacroTargets };
}

export function flaggedIssuesSection(args: FlaggedIssuesArgs): string {
  const bullets: string[] = [];

  // -- macro drift from the verifier (per-day, per-macro) --------------------
  for (const d of args.verifyResult.day_diagnostics) {
    if (d.pass) continue;
    for (const reason of d.fail_reasons) {
      const directional = directionalSuggestionForDay(
        args.planResult,
        args.nutritionMap,
        d.day_number,
        reason,
      );
      bullets.push(`- Day ${d.day_number} ${reason}${directional ? ` — ${directional}` : ""}`);
    }
  }

  // -- audit BLOCK errors that survived (rare — usually means we're in the
  // verifier-WARN branch; audit blocking_errors that go to coach-review path
  // would be on a different return shape, but listing them defensively here).
  for (const e of args.audit.blocking_errors) {
    bullets.push(`- [BLOCK] ${e.reason}`);
  }

  // -- audit WARN findings the user wants surfaced ---------------------------
  for (const w of args.audit.warnings) {
    bullets.push(`- [WARN] ${w.reason}${suggestForAuditWarning(w, args.planResult, args.nutritionMap)}`);
  }

  // -- near-block: sodium days ------------------------------------------------
  for (const s of args.complexity.near_block.sodium_days) {
    const swap = highestSodiumSwapHint(args.planResult, args.nutritionMap, s.day);
    bullets.push(
      `- Day ${s.day} sodium ${s.actual_mg} mg (ceiling ${s.ceiling_mg} mg) — ${swap}`,
    );
  }

  // -- near-block: anchor at cap ---------------------------------------------
  for (const a of args.complexity.near_block.anchors_at_cap) {
    bullets.push(
      `- '${a.slug}' is the protein anchor in ${a.count} slots this week (cap is 3 for whole-food anchors). One more use blocks the plan; consider rotating one slot to a different anchor (e.g. greek_yogurt_nonfat_plain, eggs_whole, cottage_cheese_lowfat, ground_turkey_cooked_93, salmon_atlantic_cooked, tofu_firm).`,
    );
  }

  if (bullets.length === 0) {
    return `## Flagged issues
No specific blockers — the plan is flagged because of broad triggers (e.g. high-cal build) rather than concrete misses. Use this review to verify variety and cookability look right to you.
`;
  }

  return `## Flagged issues — concrete, day-specific
${bullets.join("\n")}
`;
}

// ---------------------------------------------------------------------------
// Section: Constraint rules summary
// ---------------------------------------------------------------------------

export function constraintsSection(args: {
  buildSpec: BuildSpec;
  profile: CoachProfileInput;
  hardExclude: ReadonlySet<string>;
}): string {
  const tier1Proteins = args.buildSpec.tier_1
    .filter((e) => e.role === "protein" || e.hybrid === "protein+carb")
    .map((e) => e.slug);
  const tier1Carbs = args.buildSpec.tier_1
    .filter((e) => e.role === "carb" || e.hybrid === "protein+carb" || e.hybrid === "carb+fat")
    .map((e) => e.slug);

  return `## Constraint rules — keep these intact
- **Variety caps**: each whole-food protein anchor (chicken_breast, ground_beef, salmon, eggs, greek_yogurt, cottage_cheese, tofu, etc.) ≤ 3×/week as anchor. Combined supplement anchors (whey/casein/pea/liquid_egg_whites) ≤ 5×/week. Non-anchor uses of supplements are uncapped.
- **Four-role rule** (every main meal): one anchor (protein, is_anchor: true), one secondary (protein-secondary OR vegetable), one carb (grain/starch/bread/fruit-as-carb), one fat (fat-dense ingredient — skip ONLY when the anchor itself is fat-dense).
- **Breakfast composition**: when the breakfast anchor has protein density < 20 g/100g (greek_yogurt 10.3, cottage_cheese 12.4, eggs 12.6), include whey_protein_isolate (or casein/pea) as a non-anchor secondary.
- **Sodium discipline**: at most ONE high-Na slug per day. Watch list (mg/100g): sourdough_bread (602), tuna_canned_water (219), cod_cooked (299), shrimp_cooked (395), bacon_cooked (751), feta_cheese (1034), parmesan_cheese (1175), cheddar_cheese (654), goat_cheese (459), bbq_sauce (1027), hot_sauce (2124), italian_dressing (993), ketchup (949), pickles_dill (809), sauerkraut (661). Daily total must stay ≤ sodium cap × 1.15.
- **Tier-1 anchors for ${args.profile.build_type}** — prefer these for ≥ 80% of carb-anchored slots: ${tier1Carbs.join(", ")}. Tier-1 protein anchors: ${tier1Proteins.join(", ")}.
- **Dish names**: 2-5 words, real food (e.g. "Lemon Herb Chicken & Rice"). NO macro-speak ("High Protein", "Lean", "Power", "Healthy", "Macro"). All 21+ dish names must be distinct across the week.
- **Hard exclude (allergens/dietary/medical)**: ${args.hardExclude.size > 0 ? Array.from(args.hardExclude).sort().join(", ") : "none"}.
- **Per-ingredient gram bounds**: each slug has a min-max in the approved list. Do not go below min; do not exceed max.
`;
}

// ---------------------------------------------------------------------------
// Section: Output schema instructions
// ---------------------------------------------------------------------------

export function outputSchemaSection(): string {
  return `## Output format — what to return when corrections are done
Once you've made corrections (the coach will iterate with you on specific meals first), output the **complete revised plan** as JSON matching this schema:

\`\`\`json
${JSON.stringify(CORRECTION_SCHEMA, null, 2)}
\`\`\`

Key requirements:
- Exactly 7 days, day_number 1 (Monday) through 7 (Sunday)
- Each meal: slot index, name (Breakfast/Lunch/Dinner etc), dish_name (2-60 chars, real food, distinct across the week), 3-8 ingredients
- Each ingredient: slug (from the approved list ONLY), grams (integer 1-600), is_anchor (boolean — exactly ONE anchor per slot)
- Daily totals must land within ±25% of the targets (the system uses ±15% for normal builds, ±25% for high-cal builds)

The coach will paste your output back into the system and the PDF will regenerate.
`;
}

// ---------------------------------------------------------------------------
// Section: Closing
// ---------------------------------------------------------------------------

export function closingSection(): string {
  return `## How to work with the coach
The coach will iterate with you on specific meals — they may ask things like "swap day 3 lunch's chicken for tofu and rebalance the carbs", or "Day 5 sodium is too high, fix it".

Be willing to:
- Swap ingredients within the approved list
- Adjust portions to hit daily macro targets
- Explain trade-offs (e.g. "swapping sourdough for whole_wheat_bread drops 500 mg sodium but loses 8 g protein per slice")
- Suggest improvements the coach hasn't asked for, if you spot them

Prioritize, in order:
1. **Macro accuracy** — daily totals near target
2. **Hard rules** — variety caps, sodium ceiling, hard_exclude, four-role
3. **Variety** — interesting protein/carb/veg rotation across the week
4. **Real-world cookability** — sensible portions, recognizable meals
5. **Client preferences** — surface any tension and ask the coach
`;
}

// ===========================================================================
// Helpers — directional suggestions
// ===========================================================================

/**
 * Given a verifier fail reason like "carbs -17% off (215.9g vs 260g)" and
 * a day index, finds the meal in that day with the largest carb contribution
 * and emits a one-line suggestion to scale that ingredient up.
 *
 * Returns empty string if we can't make a confident suggestion.
 */
function directionalSuggestionForDay(
  planResult: WeekPlanSuccess,
  nutritionMap: ReadonlyMap<string, IngredientNutrition>,
  day_number: number,
  failReason: string,
): string {
  // Parse out: which macro? high or low?
  const macro = (failReason.match(/^(kcal|protein|carbs|fat)/) ?? [])[0];
  if (!macro) return "";
  const direction = failReason.includes(" -") || failReason.includes("− off")
    ? "low"
    : "high";

  // Find the target day
  const day = planResult.days.find((d) => d.day === day_number);
  if (!day) return "";

  // Pick the macro field on the per-100g nutrition row
  const field: keyof IngredientNutrition | "kcal" =
    macro === "protein" ? "protein_g_per_100g"
    : macro === "carbs" ? "carbs_g_per_100g"
    : macro === "fat" ? "fat_g_per_100g"
    : "kcal";

  // For kcal undershoot/overshoot, suggest looking at carbs or fat (most variable).
  if (field === "kcal") {
    return direction === "low"
      ? "consider increasing carb-anchor and fat-source portions"
      : "consider trimming carb-anchor and fat-source portions";
  }

  // Find the largest contributor among ingredients across the day's slots
  let best: { slot_index: number; slug: string; grams: number; contributesG: number } | null = null;
  for (const slot of day.solve.slots) {
    for (const ing of slot.ingredients) {
      const nut = nutritionMap.get(ing.slug);
      if (!nut) continue;
      const per100 = (nut[field as keyof IngredientNutrition] as number) ?? 0;
      const contrib = (ing.grams * per100) / 100;
      if (!best || contrib > best.contributesG) {
        best = { slot_index: slot.index, slug: ing.slug, grams: ing.grams, contributesG: contrib };
      }
    }
  }
  if (!best) return "";

  if (direction === "low") {
    // Suggest scaling up the top contributor by ~30%
    const proposed = Math.round(best.grams * 1.3);
    return `consider increasing ${best.slug} at slot ${best.slot_index} from ${best.grams}g to ~${proposed}g, or adding a denser ${macro} source`;
  }
  // direction === "high"
  const proposed = Math.round(best.grams * 0.75);
  return `consider trimming ${best.slug} at slot ${best.slot_index} from ${best.grams}g to ~${proposed}g`;
}

/**
 * Concise actionable suffix for an audit WARN. Returns a leading
 * " — <suggestion>" string or empty if we have nothing useful to add.
 */
function suggestForAuditWarning(
  w: AuditError,
  planResult: WeekPlanSuccess,
  nutritionMap: ReadonlyMap<string, IngredientNutrition>,
): string {
  if (w.check === "daily_macro_drift" && w.day) {
    const macro = (w.details as { macro?: string }).macro;
    const drift = (w.details as { drift_pct?: number }).drift_pct ?? 0;
    const direction = drift < 0 ? "low" : "high";
    if (macro && macro !== "kcal") {
      const reason = `${macro} ${direction === "low" ? "-" : "+"}${Math.abs(drift).toFixed(0)}% off`;
      const sug = directionalSuggestionForDay(
        planResult,
        nutritionMap,
        w.day,
        reason,
      );
      return sug ? ` — ${sug}` : "";
    }
  }
  return "";
}

/**
 * For sodium near-ceiling days, suggest swapping the highest-Na ingredient
 * for a lower-Na alternative.
 */
function highestSodiumSwapHint(
  planResult: WeekPlanSuccess,
  nutritionMap: ReadonlyMap<string, IngredientNutrition>,
  day_number: number,
): string {
  const day = planResult.days.find((d) => d.day === day_number);
  if (!day) return "consider swapping the highest-sodium ingredient for a lower-sodium alternative";

  let best: { slug: string; slot_index: number; mg: number } | null = null;
  for (const slot of day.solve.slots) {
    for (const ing of slot.ingredients) {
      const nut = nutritionMap.get(ing.slug);
      if (!nut) continue;
      const mg = (ing.grams * nut.sodium_mg_per_100g) / 100;
      if (!best || mg > best.mg) {
        best = { slug: ing.slug, slot_index: slot.index, mg };
      }
    }
  }
  if (!best || best.mg < 100) {
    return "near the cap — consider rotating one high-sodium ingredient (sourdough, cured meats, cheese, sauces) to a lower-sodium alternative";
  }
  // Tailored swap suggestion for common offenders
  const swap = SODIUM_SWAP_HINTS[best.slug];
  return swap
    ? `top contributor is ${best.slug} at slot ${best.slot_index} (~${best.mg.toFixed(0)} mg) — ${swap}`
    : `top contributor is ${best.slug} at slot ${best.slot_index} (~${best.mg.toFixed(0)} mg) — consider swapping or reducing`;
}

const SODIUM_SWAP_HINTS: Record<string, string> = {
  sourdough_bread: "swap to whole_wheat_bread or sourdough_bread reduced to a smaller portion",
  feta_cheese: "swap to greek_yogurt_nonfat_plain or cottage_cheese_lowfat",
  parmesan_cheese: "reduce portion or swap to a lower-Na cheese (mozzarella_partskim)",
  cheddar_cheese: "swap to mozzarella_partskim or reduce portion",
  bacon_cooked: "swap to chicken_breast_cooked_skinless or ground_turkey_cooked_93",
  tuna_canned_water: "swap to salmon_atlantic_cooked or chicken_breast_cooked_skinless",
  bbq_sauce: "reduce portion or remove",
  hot_sauce: "reduce portion",
  italian_dressing: "swap to olive_oil + lemon_juice",
  ketchup: "reduce portion or remove",
  pickles_dill: "remove or reduce",
};

// Re-exports needed by generate-handoff-prompt
export type { NearBlockSodiumDay, AnchorAtCap };
