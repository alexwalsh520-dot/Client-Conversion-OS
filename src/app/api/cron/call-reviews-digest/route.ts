// Layer 2 of the Call Review Autopilot: once a day, roll the day's call
// reviews into a head-of-sales digest (per-closer strengths/weaknesses + top
// low-hanging fruit) and run the dead-feed watchdog.
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
  const report = await runDailyDigest(getServiceSupabase());
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
