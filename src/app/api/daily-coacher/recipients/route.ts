/**
 * Read endpoint for the per-coach digest recipient state.
 *
 *   GET /api/daily-coacher/recipients?coach=Stef
 *     → { recipient: { coach_name, enabled, snoozed_until } } | 404
 *
 * Used by the CoachDigestToggle component on the Coach Performance tab.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const coach = searchParams.get("coach")?.trim();
  if (!coach) {
    return NextResponse.json({ error: "coach query param required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("daily_coacher_recipients")
    .select("coach_name, enabled, snoozed_until, slack_email")
    .eq("coach_name", coach)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ recipient: data });
}
