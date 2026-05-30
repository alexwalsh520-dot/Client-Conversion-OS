/**
 * GET /api/nutrition/v2/admin/pipeline-run-status?id=NNN
 *
 * Returns the current state of a pipeline run row. Admin only.
 *
 * Useful for checking on a queued/running test run if Slack DM hasn't
 * landed yet, OR for diagnosing failed runs after the fact.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 5;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const idRaw = req.nextUrl.searchParams.get("id");
  if (!idRaw) {
    return NextResponse.json({ error: "id query param required" }, { status: 400 });
  }
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("nutrition_pipeline_runs")
    .select(
      "id, client_id, client_name, trigger_type, triggered_by, status, storage_path, signed_url, signed_url_expires_at, input_tokens, output_tokens, error_message, queued_at, started_at, finished_at",
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "not found" },
      { status: 404 },
    );
  }

  return NextResponse.json(data);
}
