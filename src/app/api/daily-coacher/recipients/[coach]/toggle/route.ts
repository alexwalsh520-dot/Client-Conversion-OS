/**
 * Toggle the digest enabled flag for a coach. Used by the toggle on the
 * Coach Performance scorecard.
 *
 *   POST /api/daily-coacher/recipients/[coach]/toggle
 *     body: { enabled: boolean }
 *
 * Admins only. Coach name in the URL is matched against
 * daily_coacher_recipients.coach_name (the canonical case). If the
 * recipient row doesn't exist yet, this creates it (no Slack email yet,
 * which means no digest will actually send until one's provided).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ coach: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  const { coach: coachRaw } = await ctx.params;
  const coachName = decodeURIComponent(coachRaw).trim();
  if (!coachName) {
    return NextResponse.json({ error: "coach name required" }, { status: 400 });
  }

  let body: { enabled?: boolean };
  try {
    body = (await req.json()) as { enabled?: boolean };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled (boolean) is required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("daily_coacher_recipients")
    .upsert({ coach_name: coachName, enabled: body.enabled }, { onConflict: "coach_name" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ recipient: data });
}
