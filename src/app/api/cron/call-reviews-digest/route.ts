// Layer 2 of the Call Review Autopilot: nightly, roll the day's call reviews
// into the DAILY SALES BRIEF (Matt) and the DAILY MARKETING BRIEF (Alex), and
// run the dead-feed / dead-key / not-recording watchdog.
//
// ?date=YYYY-MM-DD re-runs a past day (ET).
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { runDailyDigest } from "@/lib/call-reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const date = req.nextUrl.searchParams.get("date") || undefined;
  const force = req.nextUrl.searchParams.get("force") === "1"; // re-post a period that already completed
  const onlyParam = req.nextUrl.searchParams.get("only");
  const only = onlyParam === "digest" || onlyParam === "marketing" ? onlyParam : undefined;
  const report = await runDailyDigest(getServiceSupabase(), { date, force, only });
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
