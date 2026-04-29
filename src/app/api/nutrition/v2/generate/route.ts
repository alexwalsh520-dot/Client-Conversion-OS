/**
 * Phase B6b — POST /api/nutrition/v2/generate
 *
 * Coach UI's entry point. Body: { client_id }. Server derives all
 * JobRequestInputs from the intake form (mirrors v1's parsing) and
 * enqueues a `nutrition_plan_jobs` row. The cron drain picks up the
 * job and runs the best-of-3 batch architecture via runPipeline.
 *
 * No template early-reject — the new pipeline doesn't use templates.
 *
 * Auth: NextAuth session. Coach must be signed in.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { deriveJobInputsFromIntake } from "@/lib/nutrition/v2/pipeline/derive-job-inputs";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { client_id?: number; reason_for_generation?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const client_id =
    typeof body.client_id === "number" && Number.isFinite(body.client_id)
      ? body.client_id
      : null;
  if (client_id == null) {
    return NextResponse.json(
      { error: "client_id (number) required" },
      { status: 400 },
    );
  }

  const db = getServiceSupabase();

  // Derive JobRequestInputs from the intake form. Surfaces 400 if the
  // intake isn't linked or readable.
  let inputs;
  try {
    inputs = await deriveJobInputsFromIntake({
      db,
      client_id,
      reason_for_generation: body.reason_for_generation,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "intake derivation failed" },
      { status: 400 },
    );
  }

  // Enqueue.
  const { data: job, error: insertErr } = await db
    .from("nutrition_plan_jobs")
    .insert({
      client_id,
      status: "pending",
      current_step: null,
      inputs,
      created_by: session.user.email,
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
    job_id: (job as { id: number }).id,
    status: "pending",
    derived_inputs: {
      build_type: inputs.build_type,
      allergy_flags: inputs.allergy_flags,
      medical_flags: inputs.medical_flags,
      dietary_style: inputs.dietary_style,
    },
  });
}
