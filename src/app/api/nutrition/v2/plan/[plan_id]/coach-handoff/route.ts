/**
 * Phase B6a-pivot Option 4 — coach handoff data endpoint.
 *
 * GET /api/nutrition/v2/plan/:plan_id/coach-handoff
 *
 * Returns the data the B6b coach UI needs to render the
 * "Coach review recommended" affordance:
 *   - coach_review_recommended : boolean from the complexity detector
 *   - complexity_reasons       : reason codes (e.g. ["high_cal_build"])
 *   - handoff_prompt           : pre-rendered markdown the coach pastes
 *                                into Claude.ai
 *   - current_plan_pdf_url     : freshly-signed (2hr) PDF URL
 *   - schema_for_corrections   : JSON schema for the coach's correction
 *                                payload (mirrors submit_plan tool input)
 *
 * The UI is deferred to B6b. This endpoint is the contract the UI will
 * consume; building it now means the run-pipeline → DB → API path is
 * proven end-to-end before any frontend code lands.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CORRECTION_SCHEMA } from "@/lib/nutrition/v2/coach-handoff";

export const runtime = "nodejs";
export const maxDuration = 10;

interface PlanRow {
  id: number;
  client_id: number;
  pdf_path: string | null;
  coach_review_recommended: boolean | null;
  complexity_reasons: unknown;
  coach_handoff_prompt: string | null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ plan_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { plan_id: planIdRaw } = await ctx.params;
  const planId = parseInt(planIdRaw, 10);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "invalid plan_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("nutrition_meal_plans")
    .select(
      "id, client_id, pdf_path, coach_review_recommended, complexity_reasons, coach_handoff_prompt",
    )
    .eq("id", planId)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "plan not found" }, { status: 404 });
  }
  const row = data as PlanRow;

  let signedUrl: string | null = null;
  if (row.pdf_path) {
    const { data: signed } = await db.storage
      .from("nutrition-plans")
      .createSignedUrl(row.pdf_path, 60 * 60 * 2);
    signedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;
  }

  return NextResponse.json({
    plan_id: row.id,
    client_id: row.client_id,
    coach_review_recommended: Boolean(row.coach_review_recommended),
    complexity_reasons: Array.isArray(row.complexity_reasons)
      ? row.complexity_reasons
      : [],
    handoff_prompt: row.coach_handoff_prompt ?? "",
    current_plan_pdf_url: signedUrl,
    schema_for_corrections: CORRECTION_SCHEMA,
  });
}
