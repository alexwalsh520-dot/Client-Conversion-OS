/**
 * Phase B6a — POST /api/nutrition/generate-plan-v2
 *
 * Validates the request body, inserts a `nutrition_plan_jobs` row with
 * status='pending', and returns { jobId } immediately. The cron-driven
 * worker (`/api/cron/nutrition-plan-drain`) picks up the job and runs
 * the full pipeline.
 *
 * Auth: NextAuth session OR internal_trigger_tokens bearer (mirrors v1).
 * Anyone authed can trigger; no per-coach permission gating in B6a.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { auth } from "@/auth";
import {
  ALL_ALLERGY_FLAGS,
  ALL_BUILD_TYPES,
  ALL_DIETARY_STYLES,
  ALL_DISTRIBUTION_TEMPLATE_IDS,
  ALL_MEDICAL_FLAGS,
  PlanComplexity,
} from "@/lib/nutrition/v2/types";
import {
  listAvailableCombinations,
  templatesForCombination,
} from "@/lib/nutrition/v2/meal-templates";
import type { JobRequestInputs } from "@/lib/nutrition/v2/pipeline/types";

export const runtime = "nodejs";
export const maxDuration = 10;

const VALID_PLAN_COMPLEXITY = new Set<string>(Object.values(PlanComplexity));
const VALID_SEX = new Set(["male", "female"]);
const VALID_ACTIVITY = new Set(["sedentary", "light", "moderate", "high", "very_high"]);

export async function POST(req: NextRequest) {
  // ---- Auth ----
  const sessionUserEmail = await getSessionEmail(req);
  if (!sessionUserEmail) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---- Parse + validate ----
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const validation = validateRequestBody(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const inputs = validation.inputs;

  // ---- Verify client exists (cheap sanity check before queueing) ----
  const db = getServiceSupabase();
  const { data: client, error: clientErr } = await db
    .from("clients")
    .select("id, name, nutrition_form_id")
    .eq("id", inputs.client_id)
    .single();
  if (clientErr || !client) {
    return NextResponse.json(
      { error: `client ${inputs.client_id} not found` },
      { status: 404 },
    );
  }
  const c = client as { id: number; nutrition_form_id: number | null };
  if (!c.nutrition_form_id) {
    return NextResponse.json(
      { error: `client ${inputs.client_id} has no linked nutrition intake form` },
      { status: 400 },
    );
  }

  // ---- B6a-pivot: early-reject if no template exists for (build, dietary) ----
  // The deterministic template picker requires a hand-authored template
  // for every (build, dietary) pair. Reject before queueing so the coach
  // sees an immediate error with the list of valid combinations.
  const dietaryForLookup = inputs.dietary_style ?? ("omnivore" as const);
  const candidateTemplates = templatesForCombination(
    inputs.build_type,
    dietaryForLookup,
  );
  if (candidateTemplates.length === 0) {
    return NextResponse.json(
      {
        error: `No meal template available for build="${inputs.build_type}" dietary="${dietaryForLookup}". Pick a combination from available_combinations.`,
        available_combinations: listAvailableCombinations(),
      },
      { status: 400 },
    );
  }

  // ---- Insert job row ----
  const { data: job, error: insertErr } = await db
    .from("nutrition_plan_jobs")
    .insert({
      client_id: inputs.client_id,
      status: "pending",
      current_step: null,
      inputs,
      created_by: sessionUserEmail,
    })
    .select("id, created_at")
    .single();
  if (insertErr || !job) {
    return NextResponse.json(
      { error: `failed to enqueue job: ${insertErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    jobId: (job as { id: number }).id,
    status: "pending",
    created_at: (job as { created_at: string }).created_at,
  });
}

// ============================================================================
// Auth helper (NextAuth + bearer token fallback)
// ============================================================================

async function getSessionEmail(req: NextRequest): Promise<string | null> {
  const h = req.headers.get("authorization") || req.headers.get("x-cron-secret");
  // Internal trigger pattern: Bearer <CRON_SECRET> for automated regens.
  if (h) {
    const expected = process.env.CRON_SECRET;
    if (expected && (h === `Bearer ${expected}` || h === expected)) {
      return "internal";
    }
  }
  try {
    const session = await auth();
    const email = (session as { user?: { email?: string } } | null)?.user?.email ?? null;
    return email;
  } catch {
    return null;
  }
}

// ============================================================================
// Request validation
// ============================================================================

interface ValidatedOk {
  ok: true;
  inputs: JobRequestInputs;
}
interface ValidatedFail {
  ok: false;
  error: string;
}

function validateRequestBody(raw: unknown): ValidatedOk | ValidatedFail {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "body must be a JSON object" };
  }
  const b = raw as Record<string, unknown>;

  const clientId = typeof b.client_id === "number" ? b.client_id : Number(b.client_id);
  if (!Number.isFinite(clientId) || !Number.isInteger(clientId) || clientId <= 0) {
    return { ok: false, error: "client_id must be a positive integer" };
  }

  if (typeof b.sex !== "string" || !VALID_SEX.has(b.sex)) {
    return { ok: false, error: 'sex must be "male" or "female"' };
  }
  if (typeof b.activity_level !== "string" || !VALID_ACTIVITY.has(b.activity_level)) {
    return {
      ok: false,
      error: 'activity_level must be one of sedentary|light|moderate|high|very_high',
    };
  }
  if (typeof b.build_type !== "string" || !(ALL_BUILD_TYPES as string[]).includes(b.build_type)) {
    return { ok: false, error: `build_type must be one of ${ALL_BUILD_TYPES.join(", ")}` };
  }
  if (
    typeof b.distribution_template !== "string" ||
    !(ALL_DISTRIBUTION_TEMPLATE_IDS as string[]).includes(b.distribution_template)
  ) {
    return {
      ok: false,
      error: `distribution_template must be one of the 7 stock templates`,
    };
  }
  if (typeof b.plan_complexity !== "string" || !VALID_PLAN_COMPLEXITY.has(b.plan_complexity)) {
    return { ok: false, error: "plan_complexity must be beginner|intermediate|advanced" };
  }

  const allergyFlags = b.allergy_flags ?? [];
  if (!Array.isArray(allergyFlags) || !allergyFlags.every((f) => typeof f === "string" && (ALL_ALLERGY_FLAGS as string[]).includes(f))) {
    return { ok: false, error: "allergy_flags must be an array of valid AllergyFlag values" };
  }
  const medicalFlags = b.medical_flags ?? [];
  if (!Array.isArray(medicalFlags) || !medicalFlags.every((f) => typeof f === "string" && (ALL_MEDICAL_FLAGS as string[]).includes(f))) {
    return { ok: false, error: "medical_flags must be an array of valid MedicalFlag values" };
  }

  let dietaryStyle: string | null = null;
  if (b.dietary_style != null) {
    if (typeof b.dietary_style !== "string" || !(ALL_DIETARY_STYLES as string[]).includes(b.dietary_style)) {
      return { ok: false, error: `dietary_style must be one of ${ALL_DIETARY_STYLES.join(", ")} or null` };
    }
    dietaryStyle = b.dietary_style;
  }

  let dayKinds: Array<"training" | "rest"> | undefined;
  if (b.day_kinds != null) {
    if (
      !Array.isArray(b.day_kinds) ||
      b.day_kinds.length !== 7 ||
      !b.day_kinds.every((d) => d === "training" || d === "rest")
    ) {
      return { ok: false, error: "day_kinds must be an array of 7 'training'|'rest' strings" };
    }
    dayKinds = b.day_kinds as Array<"training" | "rest">;
  }

  const onStimulant = b.on_stimulant === true ? true : b.on_stimulant === false ? false : undefined;
  const reason = typeof b.reason_for_generation === "string" ? b.reason_for_generation : undefined;

  return {
    ok: true,
    inputs: {
      client_id: clientId,
      sex: b.sex as "male" | "female",
      activity_level: b.activity_level as JobRequestInputs["activity_level"],
      build_type: b.build_type as JobRequestInputs["build_type"],
      allergy_flags: allergyFlags as JobRequestInputs["allergy_flags"],
      medical_flags: medicalFlags as JobRequestInputs["medical_flags"],
      dietary_style: dietaryStyle as JobRequestInputs["dietary_style"],
      plan_complexity: b.plan_complexity as JobRequestInputs["plan_complexity"],
      distribution_template: b.distribution_template as JobRequestInputs["distribution_template"],
      day_kinds: dayKinds,
      on_stimulant: onStimulant,
      reason_for_generation: reason,
    },
  };
}
