// Layer 3 of the Call Review Autopilot: Monday morning, roll last week's
// reviews + tracker into the WEEKLY PATTERN REPORT (closer trends, objection
// patterns, setter show rates, coaching focus, review queue).
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { runWeeklyReport } from "@/lib/call-reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const weekStart = req.nextUrl.searchParams.get("weekStart") || undefined; // YYYY-MM-DD (a Monday) to re-run a week
  const force = req.nextUrl.searchParams.get("force") === "1";
  const report = await runWeeklyReport(getServiceSupabase(), { weekStart, force });
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
