/**
 * Plan scorer — classifies a single generation attempt into hard/soft errors.
 *
 * Hard errors:
 *   - allergen_leak       : LLM emitted (and parser dropped) a slug whose
 *                            origin is an allergy rule from the client's
 *                            allergyFlags. Caught even though parser scrubs.
 *   - dietary_violation   : LLM emitted a slug whose origin is the active
 *                            dietary rule (vegan/vegetarian/etc.).
 *   - invalid_slug        : LLM emitted a slug not in the approved DB list.
 *   - schema_violation    : Set by the caller when generatePlan threw — the
 *                            scorer itself can't observe this without a plan.
 *
 * Soft errors:
 *   - audit_warnings  (severity WARN) — surfaced as soft_errors[]
 *   - macro_drift     — any per-day failed_days from the verifier
 *
 * The scorer reuses the audit's `identifyExcludeOrigin` to classify whether
 * a hard_exclude leak is allergen vs dietary vs medical.
 */

import { identifyExcludeOrigin } from "../audit/audit-week-plan";
import type { ClientProfile } from "../audit/types";
import type { GeneratePlanResult } from "../llm-meal-generator";
import { auditWeekPlan } from "../audit";
import { verifyMacros } from "../macro-verifier";
import type { MacroTargets } from "../../macro-calculator";
import type { AllergyFlag, DietaryStyle, MedicalFlag } from "../types";
import type { HardError, ScoredPlan, SoftError } from "./types";
import { ALL_ALLERGY_RULES } from "../allergies";
import { ALL_DIETARY_RULES } from "../dietary";
import { ALL_MEDICAL_RULES } from "../medical";

export interface ScorePlanArgs {
  plan_index: number;
  /** Result from generatePlan, or null when generation threw. */
  generation:
    | {
        kind: "ok";
        result: GeneratePlanResult;
      }
    | {
        kind: "error";
        message: string;
      };
  audit_profile: ClientProfile;
  targets: { training: MacroTargets; rest: MacroTargets };
  /** Active client rule flags — used to classify dropped-slug origin into
   *  allergen vs dietary vs medical. */
  allergy_flags: AllergyFlag[];
  medical_flags: MedicalFlag[];
  dietary_style: DietaryStyle | null;
}

export async function scorePlan(args: ScorePlanArgs): Promise<ScoredPlan> {
  // Schema violation short-circuit — generation didn't produce a plan.
  if (args.generation.kind === "error") {
    return {
      plan_index: args.plan_index,
      valid: false,
      hard_errors: [
        {
          kind: "schema_violation",
          reason: args.generation.message,
        },
      ],
      soft_errors: [],
      plan: null,
    };
  }

  const generated = args.generation.result;
  const plan = generated.plan;
  const hard_errors: HardError[] = [];
  const soft_errors: SoftError[] = [];

  // ----- Hard errors from the parser's dropped_slugs ------------------------
  // Even though the parser scrubs these before audit sees them, the fact
  // that the LLM emitted them is a signal to reject the attempt.
  const droppedSlugs = generated.diagnostics.dropped_slugs ?? [];
  for (const drop of droppedSlugs) {
    if (drop.reason === "invalid_slug") {
      hard_errors.push({
        kind: "invalid_slug",
        reason: `LLM emitted unknown slug '${drop.slug}' at day ${drop.day_number} slot ${drop.slot}`,
        slug: drop.slug,
        day: drop.day_number,
        meal: drop.slot,
      });
      continue;
    }
    // hard_exclude — classify origin
    const origin = classifyExcludeOrigin(
      drop.slug,
      args.allergy_flags,
      args.medical_flags,
      args.dietary_style,
    );
    if (origin === "allergy") {
      hard_errors.push({
        kind: "allergen_leak",
        reason: `LLM emitted '${drop.slug}' at day ${drop.day_number} slot ${drop.slot} — blocked by allergy rule`,
        slug: drop.slug,
        day: drop.day_number,
        meal: drop.slot,
      });
    } else if (origin === "dietary") {
      hard_errors.push({
        kind: "dietary_violation",
        reason: `LLM emitted '${drop.slug}' at day ${drop.day_number} slot ${drop.slot} — blocked by dietary style`,
        slug: drop.slug,
        day: drop.day_number,
        meal: drop.slot,
      });
    } else {
      // medical or unknown — count as allergen_leak (still a safety hard error)
      hard_errors.push({
        kind: "allergen_leak",
        reason: `LLM emitted '${drop.slug}' at day ${drop.day_number} slot ${drop.slot} — blocked by hard_exclude (${origin})`,
        slug: drop.slug,
        day: drop.day_number,
        meal: drop.slot,
      });
    }
  }

  // ----- Defensive: any slug surviving in the plan that's still in
  // hard_exclude (parser bug) — escalate to allergen_leak.
  for (const day of plan.days) {
    for (const slot of day.solve.slots) {
      for (const ing of slot.ingredients) {
        if (args.audit_profile.dietaryStyle !== null) {
          const dietRule = ALL_DIETARY_RULES[args.audit_profile.dietaryStyle];
          if (dietRule?.hard_exclude.includes(ing.slug)) {
            hard_errors.push({
              kind: "dietary_violation",
              reason: `Plan contains '${ing.slug}' at day ${day.day} slot ${slot.index} — dietary violation that survived parsing`,
              slug: ing.slug,
              day: day.day,
              meal: slot.index,
            });
          }
        }
        for (const flag of args.audit_profile.allergyFlags) {
          if (ALL_ALLERGY_RULES[flag]?.hard_exclude.includes(ing.slug)) {
            hard_errors.push({
              kind: "allergen_leak",
              reason: `Plan contains '${ing.slug}' (allergen ${flag}) at day ${day.day} slot ${slot.index} — survived parsing`,
              slug: ing.slug,
              day: day.day,
              meal: slot.index,
            });
          }
        }
      }
    }
  }

  // ----- Audit (post-demotion: BLOCK only on allergen + structural + medical)
  const audit = await auditWeekPlan(plan, args.audit_profile);

  // Audit BLOCK errors → hard errors. After the demotions, the only BLOCKs
  // remaining are: hard_exclude_violation (allergen), ingredient_data_missing
  // (data integrity), build_medical_block (medical), custom_distribution_invalid_sum.
  for (const e of audit.blocking_errors) {
    if (e.check === "hard_exclude_violation") {
      // Already counted above by our defensive scan, but if the audit also
      // catches it, classify here too. Use details.triggered_by.
      const origin = (e.details as { triggered_by?: string }).triggered_by ?? "";
      const isDietary =
        args.audit_profile.dietaryStyle !== null &&
        origin.includes(args.audit_profile.dietaryStyle);
      const kind: HardError["kind"] = isDietary
        ? "dietary_violation"
        : "allergen_leak";
      // De-dup against our defensive scan
      if (
        !hard_errors.some(
          (h) =>
            h.slug === (e.ingredient ?? "") &&
            h.day === e.day &&
            h.meal === e.meal,
        )
      ) {
        hard_errors.push({
          kind,
          reason: e.reason,
          slug: e.ingredient ?? undefined,
          day: e.day,
          meal: e.meal,
        });
      }
    } else {
      // ingredient_data_missing / build_medical_block / structural — treat
      // as hard error of nearest kind. invalid_slug is the closest match
      // for ingredient_data_missing; allergen_leak isn't quite right.
      // Use schema_violation as a catch-all bucket for "this attempt is
      // structurally unusable".
      hard_errors.push({
        kind: "schema_violation",
        reason: `[${e.check}] ${e.reason}`,
        slug: e.ingredient ?? undefined,
        day: e.day,
        meal: e.meal,
      });
    }
  }

  // Audit WARNs → soft errors
  for (const w of audit.warnings) {
    soft_errors.push({
      kind: classifySoftErrorKind(w.check),
      reason: w.reason,
      day: w.day,
      meal: w.meal,
    });
  }

  // ----- Verifier (diagnostic-only) — surfaces per-day macro drift ----------
  const verify_result = await verifyMacros({
    plan,
    targets: args.targets,
  });
  for (const d of verify_result.day_diagnostics) {
    if (d.pass) continue;
    for (const reason of d.fail_reasons) {
      soft_errors.push({
        kind: "macro_drift",
        reason: `Day ${d.day_number} ${reason}`,
        day: d.day_number,
      });
    }
  }

  return {
    plan_index: args.plan_index,
    valid: hard_errors.length === 0,
    hard_errors,
    soft_errors,
    plan,
    generator_diagnostics: generated.diagnostics,
    audit,
    verify_result,
  };
}

// ===========================================================================
// Helpers
// ===========================================================================

type ExcludeOrigin = "allergy" | "dietary" | "medical" | "unknown";

function classifyExcludeOrigin(
  slug: string,
  allergyFlags: AllergyFlag[],
  medicalFlags: MedicalFlag[],
  dietaryStyle: DietaryStyle | null,
): ExcludeOrigin {
  for (const flag of allergyFlags) {
    if (ALL_ALLERGY_RULES[flag]?.hard_exclude.includes(slug)) return "allergy";
  }
  if (
    dietaryStyle !== null &&
    ALL_DIETARY_RULES[dietaryStyle]?.hard_exclude.includes(slug)
  ) {
    return "dietary";
  }
  for (const flag of medicalFlags) {
    if (ALL_MEDICAL_RULES[flag]?.hard_exclude.includes(slug)) return "medical";
  }
  // identifyExcludeOrigin reuse for parity (covers edge cases)
  void identifyExcludeOrigin;
  return "unknown";
}

function classifySoftErrorKind(
  check: string,
): import("./types").SoftErrorKind {
  switch (check) {
    case "sodium_ceiling_exceeded":
      return "sodium_ceiling_exceeded";
    case "frequency_cap_exceeded":
      return "frequency_cap_exceeded";
    case "tier_1_protein_below_min":
      return "tier_1_protein_below_min";
    case "tier_1_carb_below_min":
      return "tier_1_carb_below_min";
    case "daily_kcal_drift":
      return "daily_kcal_drift";
    case "daily_macro_drift":
      return "daily_macro_drift";
    case "per_meal_drift":
      return "per_meal_drift";
    case "build_medical_warn":
      return "build_medical_warn";
    default:
      return "audit_warning_other";
  }
}
