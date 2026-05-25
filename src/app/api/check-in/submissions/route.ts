/**
 * GET /api/check-in/submissions — admin-only list of all check-in
 * submissions joined with their client metadata (name, coach, end_date)
 * so the Client Progress tab can compute days-left and effectiveness
 * averages in one round-trip.
 *
 * Returns 401 for unauthenticated. Returns 403 for non-admins.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import type { CheckInSubmissionRow } from "@/lib/check-in/types";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(_req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const db = getServiceSupabase();

  // Pull all submissions. Volume is low (a few thousand max over years),
  // and the Client Progress tab needs everything to aggregate by client.
  const { data: rows, error } = await db
    .from("client_check_ins")
    .select(
      "id, client_id, client_name, client_email, coach_name, q1_overall, q2_strength, q3_lifestyle, q4_progress, q5_open_response, score_0_100, submitted_at"
    )
    .order("submitted_at", { ascending: false });
  if (error) {
    console.error("[api/check-in/submissions] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Batch-fetch end_date + status for all referenced clients.
  const clientIds = [...new Set((rows ?? []).map((r) => r.client_id).filter(Boolean))] as number[];
  let clientMetaById = new Map<number, { endDate: string | null; status: string | null }>();
  if (clientIds.length > 0) {
    const { data: clientRows } = await db
      .from("clients")
      .select("id, end_date, status")
      .in("id", clientIds);
    clientMetaById = new Map(
      (clientRows ?? []).map((c) => [
        c.id as number,
        { endDate: c.end_date as string | null, status: c.status as string | null },
      ])
    );
  }

  const submissions: CheckInSubmissionRow[] = (rows ?? []).map((r) => {
    const meta = r.client_id ? clientMetaById.get(r.client_id) : null;
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: r.client_name,
      clientEmail: r.client_email,
      coachName: r.coach_name,
      q1Overall: r.q1_overall,
      q2Strength: r.q2_strength,
      q3Lifestyle: r.q3_lifestyle,
      q4Progress: r.q4_progress,
      q5OpenResponse: r.q5_open_response,
      score0to100: r.score_0_100,
      submittedAt: r.submitted_at,
      clientEndDate: meta?.endDate ?? null,
      clientStatus: meta?.status ?? null,
    };
  });

  return NextResponse.json({ submissions });
}
