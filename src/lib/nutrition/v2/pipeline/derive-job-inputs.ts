/**
 * Phase B6b — derive `JobRequestInputs` from a client_id alone.
 *
 * The Coaching Hub UI POSTs `{client_id}` to /api/nutrition/v2/generate
 * and trusts the system to parse the intake form. This helper centralises
 * the derivation so both the API endpoint and any future debug paths
 * compute the same JobRequestInputs from the same intake snapshot.
 *
 * Reuses the existing v1 parsers (parseGoalFromText, parseActivityLevel,
 * detectMedicalFlags) — no rewriting of intake-parsing logic. Maps v1
 * concepts to the v2 enums:
 *   - GoalType (recomp/fat_loss/muscle_gain/maintain/endurance) → BuildType
 *   - MedicalFlags shape → MedicalFlag enum members
 *   - intake.allergies free-text → AllergyFlag enum members
 *   - intake.dietary_style or food_avoid → DietaryStyle
 *
 * All derivations are best-effort. When a field can't be parsed, defaults
 * are used (omnivore, intermediate complexity, sex=male). The coach can
 * override via comment directives or the existing edit flow.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseActivityLevel,
  type ActivityLevel,
  type GoalType,
} from "../../macro-calculator";
import { parseGoalFromText } from "../../parsers";
import { detectMedicalFlags, type MedicalFlags } from "../../medical";
import { isOnAppetiteSuppressant } from "../../parsers";
import {
  AllergyFlag,
  BuildType,
  DietaryStyle,
  DistributionTemplateId,
  MedicalFlag,
  PlanComplexity,
  type AllergyFlag as AllergyFlagType,
  type DietaryStyle as DietaryStyleType,
  type MedicalFlag as MedicalFlagType,
} from "../types";
import type { JobRequestInputs } from "./types";

// ----- v2 default distribution per build (mirrors run-pipeline's table) -----
const BUILD_TO_DEFAULT_DISTRIBUTION: Record<BuildType, DistributionTemplateId> = {
  [BuildType.RECOMP]: DistributionTemplateId.STANDARD_3_MEAL,
  [BuildType.SHRED]: DistributionTemplateId.STANDARD_3_MEAL,
  [BuildType.MAINTAIN]: DistributionTemplateId.STANDARD_3_MEAL,
  [BuildType.LEAN_GAIN]: DistributionTemplateId.STANDARD_4_MEAL,
  [BuildType.BULK]: DistributionTemplateId.ATHLETE_5_MEAL,
  [BuildType.ENDURANCE]: DistributionTemplateId.ENDURANCE_5_MEAL_TRAINING_DAY,
};

// ----- GoalType (v1) → BuildType (v2) ---------------------------------------
function goalToBuildType(goal: GoalType): BuildType {
  switch (goal) {
    case "recomp":
      return BuildType.RECOMP;
    case "fat_loss":
      return BuildType.SHRED;
    case "muscle_gain":
      return BuildType.LEAN_GAIN;
    case "maintain":
      return BuildType.MAINTAIN;
    case "endurance":
      return BuildType.ENDURANCE;
    default:
      return BuildType.RECOMP;
  }
}

// ----- v1 MedicalFlags shape → v2 MedicalFlag[] -----------------------------
function medicalFlagsV1ToV2(flags: MedicalFlags): MedicalFlagType[] {
  const out: MedicalFlagType[] = [];
  if (flags.hasHypertension) out.push(MedicalFlag.HBP);
  if (flags.hasDiabetes) out.push(MedicalFlag.DIABETES_T2);
  if (flags.hasKidneyIssues) out.push(MedicalFlag.KIDNEY);
  // IBS / Pregnant / Gout / Reflux / PCOS aren't detected by detectMedicalFlags
  // — they live on dedicated intake fields. Coach can adjust via the existing
  // comment-directive flow if needed; v1 also doesn't surface these.
  return out;
}

// ----- intake.allergies free-text → v2 AllergyFlag[] -----------------------
const ALLERGY_KEYWORDS: Array<[RegExp, AllergyFlagType]> = [
  [/\bdairy\b|\bmilk\b/, AllergyFlag.DAIRY],
  [/\blactose\b/, AllergyFlag.INTOLERANCE_LACTOSE],
  [/\beggs?\b/, AllergyFlag.EGGS],
  [/\bfish\b|\bsalmon\b|\btuna\b|\bcod\b/, AllergyFlag.FISH],
  [/\bgluten\b|\bwheat\b|\bceliac\b/, AllergyFlag.GLUTEN],
  [/\bpeanuts?\b/, AllergyFlag.PEANUTS],
  [/\bsesame\b/, AllergyFlag.SESAME],
  [/\bshellfish\b|\bshrimp\b|\bcrab\b|\blobster\b/, AllergyFlag.SHELLFISH],
  [/\bsoy\b/, AllergyFlag.SOY],
  [/\bsulfites?\b/, AllergyFlag.SULFITES],
  [/\btree\s?nuts?\b|\balmond\b|\bcashew\b|\bwalnut\b|\bpistachio\b/, AllergyFlag.TREE_NUTS],
];

function allergyFlagsFromText(allergiesRaw: string): AllergyFlagType[] {
  const txt = (allergiesRaw ?? "").toLowerCase();
  const out = new Set<AllergyFlagType>();
  for (const [pattern, flag] of ALLERGY_KEYWORDS) {
    if (pattern.test(txt)) out.add(flag);
  }
  return Array.from(out);
}

// ----- intake.foods_avoid / dietary_style field → DietaryStyle --------------
function dietaryStyleFromIntake(intake: {
  foods_avoid?: string | null;
  dietary_style?: string | null;
  protein_preferences?: string | null;
}): DietaryStyleType | null {
  const explicit = (intake.dietary_style ?? "").toLowerCase().trim();
  if (explicit) {
    if (explicit.includes("vegan")) return DietaryStyle.VEGAN;
    if (explicit.includes("vegetarian")) return DietaryStyle.VEGETARIAN;
    if (explicit.includes("pescatarian")) return DietaryStyle.PESCATARIAN;
    if (explicit.includes("omnivore") || explicit.includes("none")) return DietaryStyle.OMNIVORE;
  }
  // Fallback: scan foods_avoid + protein_preferences for vegan/vegetarian
  // self-identification phrases.
  const combined =
    `${intake.foods_avoid ?? ""} ${intake.protein_preferences ?? ""}`.toLowerCase();
  if (/\bvegan\b/.test(combined)) return DietaryStyle.VEGAN;
  if (/\bvegetarian\b/.test(combined)) return DietaryStyle.VEGETARIAN;
  if (/\bpescatarian\b/.test(combined)) return DietaryStyle.PESCATARIAN;
  return null; // null === omnivore, no restriction
}

// ----- main entry -----------------------------------------------------------

export interface DeriveJobInputsArgs {
  db: SupabaseClient;
  client_id: number;
  /** Optional reason string for diagnostics. */
  reason_for_generation?: string;
}

export async function deriveJobInputsFromIntake(
  args: DeriveJobInputsArgs,
): Promise<JobRequestInputs> {
  const { db, client_id } = args;

  // Load client + intake form (same pattern as v1 generate-plan).
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, nutrition_form_id")
    .eq("id", client_id)
    .single();
  if (clientErr || !client) {
    throw new Error(`client ${client_id} not found`);
  }
  const c = client as { id: number; nutrition_form_id: number | null };
  if (!c.nutrition_form_id) {
    throw new Error(
      `client ${client_id} has no linked nutrition intake form — link one first`,
    );
  }

  const { data: intake, error: intakeErr } = await db
    .from("nutrition_intake_forms")
    .select("*")
    .eq("id", c.nutrition_form_id)
    .single();
  if (intakeErr || !intake) {
    throw new Error(`intake form for client ${client_id} not found`);
  }
  const i = intake as Record<string, string | null>;

  // Goal → BuildType
  const goal = parseGoalFromText(i.fitness_goal ?? "");
  const build_type = goalToBuildType(goal);

  // Activity level
  const activity_level: ActivityLevel = parseActivityLevel(
    i.activity_level || i.fitness_goal || "",
  );

  // Medical flags
  const v1Medical = detectMedicalFlags(i.allergies ?? "", i.medications ?? "");
  const medical_flags = medicalFlagsV1ToV2(v1Medical);

  // Allergy flags
  const allergy_flags = allergyFlagsFromText(i.allergies ?? "");

  // Dietary style
  const dietary_style = dietaryStyleFromIntake({
    foods_avoid: i.foods_avoid,
    dietary_style: i.dietary_style,
    protein_preferences: i.protein_preferences,
  });

  // Stimulant
  const on_stimulant =
    v1Medical.onStimulantADHD || isOnAppetiteSuppressant(i.medications ?? "");

  // Plan complexity — default INTERMEDIATE (v1 doesn't track this explicitly).
  const plan_complexity = PlanComplexity.INTERMEDIATE;

  // Distribution — fixed per build for non-coach-edited generations.
  const distribution_template = BUILD_TO_DEFAULT_DISTRIBUTION[build_type];

  // Sex — intake form has no sex field (acknowledged in JobRequestInputs
  // comment); v1 defaults to male and overrides via comment directives.
  // Coach Hub will need a v3 field but for now mirror v1.
  const sex: "male" | "female" = "male";

  return {
    client_id,
    sex,
    activity_level,
    build_type,
    allergy_flags,
    medical_flags,
    dietary_style,
    plan_complexity,
    distribution_template,
    on_stimulant,
    reason_for_generation: args.reason_for_generation ?? "coach_hub_v2_ui",
  };
}
