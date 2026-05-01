/**
 * Shared helper: client_id → (intake row, raw calculator macro targets).
 *
 * Both the live-preview /macros endpoint and the /copy-prompt endpoint
 * need this exact pipeline. Centralizing here so the parsing rules
 * (weight/height/age/goal/activity/medical) stay in one place and any
 * coach-facing surface that derives macros sees the same numbers.
 *
 * Returns a structured failure when the intake form is missing critical
 * fields (weight unparseable, no linked form, etc.) so the caller can
 * show a clean error instead of bad numbers.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calculateMacros,
  parseActivityLevel,
  parseHeightToCm,
  parseWeightToKg,
  type MacroTargets,
} from "./macro-calculator";
import { detectMedicalFlags } from "./medical";
import { parseGoalFromText, reconcileGoalWithWeights } from "./parsers";

export type IntakeTargetsResult =
  | {
      ok: true;
      intake: Record<string, string | number | null>;
      clientName: string | null;
      raw: MacroTargets;
      parsed: {
        weightKg: number;
        heightCm: number;
        age: number;
        sex: "male" | "female";
      };
    }
  | {
      ok: false;
      status: 400 | 404;
      error: string;
    };

export async function loadIntakeAndComputeRawTargets(
  db: SupabaseClient,
  clientId: number,
): Promise<IntakeTargetsResult> {
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name, nutrition_form_id")
    .eq("id", clientId)
    .single();
  if (clientErr || !client) {
    return { ok: false, status: 404, error: "client not found" };
  }
  const c = client as {
    id: number;
    name: string | null;
    nutrition_form_id: number | null;
  };
  if (!c.nutrition_form_id) {
    return {
      ok: false,
      status: 400,
      error: "client has no linked intake form",
    };
  }

  const { data: intake, error: intakeErr } = await db
    .from("nutrition_intake_forms")
    .select("*")
    .eq("id", c.nutrition_form_id)
    .single();
  if (intakeErr || !intake) {
    return { ok: false, status: 404, error: "intake form not found" };
  }
  const i = intake as Record<string, string | number | null>;

  // Weight is the macro calculator's most-load-bearing input. If it's
  // unparseable we surface a hard error instead of falling back to the
  // 80kg default — bad targets are worse than no targets.
  const weightKg = parseWeightToKg(String(i.current_weight ?? ""));
  if (weightKg == null) {
    return {
      ok: false,
      status: 400,
      error:
        "intake form is missing weight or weight is unreadable — please update the form before generating a plan",
    };
  }

  const goalKg = parseWeightToKg(String(i.goal_weight ?? ""));
  const heightCm = parseHeightToCm(String(i.height ?? "")) ?? 175;
  const age = typeof i.age === "number" ? i.age : 30;
  const sex = "male" as const; // intake form has no sex field; v1 default
  const textGoal = parseGoalFromText(String(i.fitness_goal ?? ""));
  const reconciled = reconcileGoalWithWeights(textGoal, weightKg, goalKg);
  const goal = reconciled.goal;
  const activity = parseActivityLevel(
    String(i.activity_level ?? i.fitness_goal ?? ""),
  );
  const medical = detectMedicalFlags(
    String(i.allergies ?? ""),
    String(i.medications ?? ""),
  );

  const raw = calculateMacros({
    sex,
    weightKg,
    heightCm,
    age,
    goal,
    activityLevel: activity,
    medical: {
      hasHypertension: medical.hasHypertension,
      hasDiabetes: medical.hasDiabetes,
      hasKidneyIssues: medical.hasKidneyIssues,
      onStimulant: medical.onStimulantADHD,
    },
  });

  return {
    ok: true,
    intake: i,
    clientName: c.name,
    raw,
    parsed: { weightKg, heightCm, age, sex },
  };
}
