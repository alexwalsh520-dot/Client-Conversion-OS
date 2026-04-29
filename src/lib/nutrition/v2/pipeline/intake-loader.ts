/**
 * Phase B6a — intake loader.
 *
 * Resolves clients.id → nutrition_intake_forms row → IntakeSnapshot
 * (the shape B5's pdf-adapter needs) plus parsed weight/height/age values
 * for B1's calculator.
 *
 * Two-step database read:
 *   1. clients(id) → nutrition_form_id
 *   2. nutrition_intake_forms(id) → free-text fields
 *
 * Then the parser converts free-text to canonical units. Failures surface
 * as IntakeParseError (caught and repackaged by run-pipeline).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { IntakeSnapshot } from "../pdf-adapter/types";
import type { Sex } from "../../macro-calculator";
import {
  parseAge,
  parseGoalWeight,
  parseHeight,
  parseWeight,
  IntakeParseError,
} from "./intake-parser";
import type {
  AllergyFlag,
  BuildType,
  DietaryStyle,
  MedicalFlag,
} from "../types";

// ============================================================================
// Resolved intake (parsed + structured for the pipeline)
// ============================================================================

export interface ResolvedIntake {
  /** Snapshot in the shape B5 adapter expects. */
  intake_snapshot: IntakeSnapshot;
  /** Inputs B1's calculator consumes. */
  macro_inputs: {
    sex: Sex;
    weight_kg: number;
    height_cm: number;
    age: number;
  };
  /** Goal weight if parseable; null otherwise (non-blocking). */
  goal_weight_kg: number | null;
  /** Diagnostic notes from parsing — empty array on clean parse. */
  parse_warnings: string[];
}

// ============================================================================
// Loader
// ============================================================================

export interface IntakeLoaderArgs {
  /** Supabase service-role client (so RLS doesn't block reads). */
  db: SupabaseClient;
  client_id: number;
  /** v2 structured flags from the POST request body. */
  build_type: BuildType;
  allergy_flags: AllergyFlag[];
  medical_flags: MedicalFlag[];
  dietary_style: DietaryStyle | null;
  /** From request body or auto-detected from medications. */
  on_stimulant: boolean;
}

export async function loadIntake(args: IntakeLoaderArgs): Promise<ResolvedIntake> {
  const { db, client_id } = args;

  // 1. clients row
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name, nutrition_form_id")
    .eq("id", client_id)
    .single();
  if (clientErr || !client) {
    throw new IntakeParseError(
      "client_id",
      String(client_id),
      `client not found: ${clientErr?.message ?? "no row"}`,
    );
  }
  const c = client as { id: number; name: string; nutrition_form_id: number | null };
  if (!c.nutrition_form_id) {
    throw new IntakeParseError(
      "nutrition_form_id",
      "null",
      "client has no linked nutrition intake form",
    );
  }

  // 2. nutrition_intake_forms row
  const { data: form, error: formErr } = await db
    .from("nutrition_intake_forms")
    .select(
      "first_name, last_name, age, height, current_weight, goal_weight, fitness_goal, foods_enjoy, foods_avoid, allergies, protein_preferences, can_cook, meal_count, medications, supplements, sleep_hours, water_intake, daily_meals_description",
    )
    .eq("id", c.nutrition_form_id)
    .single();
  if (formErr || !form) {
    throw new IntakeParseError(
      "nutrition_form_id",
      String(c.nutrition_form_id),
      `intake form not found: ${formErr?.message ?? "no row"}`,
    );
  }
  const f = form as Record<string, string | number | null>;

  // 3. Parse blocking fields (weight, height, age). All throw IntakeParseError.
  const weight = parseWeight(String(f.current_weight ?? ""), "current_weight");
  const height = parseHeight(String(f.height ?? ""), "height");
  const age = parseAge(f.age, "age");

  // 4. Parse non-blocking goal weight.
  const goal = parseGoalWeight(String(f.goal_weight ?? ""));
  const parse_warnings: string[] = [];
  if (goal.unparseable) {
    parse_warnings.push(
      `goal_weight unparseable (raw="${f.goal_weight ?? ""}", reason=${goal.reason ?? "unknown"}); timeline note will be generic`,
    );
  }

  // 5. Sex inference. The intake form does NOT have a direct sex field.
  // Heuristic: derive from BMR-relevant inputs is not possible without sex.
  // For B6a, we pass sex via the JobRequestInputs (the debug UI's hardcoded
  // dropdown). This loader does NOT determine sex — caller must.
  // We default to 'male' here as a placeholder, but the caller should
  // override via macro_inputs.sex before passing to B1.
  // TODO B6b: sex either lives on clients table, gets added to intake form,
  // or coach selects it in the UI.

  const firstName = String(f.first_name ?? "").trim() || "Unknown";
  const lastName = String(f.last_name ?? "").trim() || "";

  const intake_snapshot: IntakeSnapshot = {
    first_name: firstName,
    last_name: lastName,
    age,
    weight_kg: weight.kg,
    height_cm: height.cm,
    goal_weight_kg: goal.kg ?? undefined,
    fitness_goal: String(f.fitness_goal ?? ""),
    can_cook: String(f.can_cook ?? ""),
    meal_count: String(f.meal_count ?? ""),
    medications: String(f.medications ?? ""),
    supplements: String(f.supplements ?? ""),
    sleep_hours: String(f.sleep_hours ?? ""),
    water_intake: String(f.water_intake ?? ""),
    allergies: String(f.allergies ?? ""),
    build_type: args.build_type,
    allergy_flags: args.allergy_flags,
    medical_flags: args.medical_flags,
    dietary_style: args.dietary_style,
    on_stimulant: args.on_stimulant,
  };

  return {
    intake_snapshot,
    macro_inputs: {
      sex: "male", // placeholder — caller overrides
      weight_kg: weight.kg,
      height_cm: height.cm,
      age,
    },
    goal_weight_kg: goal.kg,
    parse_warnings,
  };
}
