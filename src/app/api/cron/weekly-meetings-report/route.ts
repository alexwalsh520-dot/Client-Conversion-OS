/**
 * GET /api/cron/weekly-meetings-report
 *
 * Fires every Sunday at 1 PM PKT (08:00 UTC Sunday) per vercel.json.
 * Counts the week's logged meetings (by meeting date), breaks them down per
 * coach, and DMs the report to Saeed via the coaching Slack bot.
 *
 * Auth mirrors the other cron routes: trust `x-vercel-cron` set by Vercel cron,
 * OR a `Bearer CRON_SECRET` Authorization header (for manual triggering).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildAndSendWeeklyMeetingsReport } from "@/lib/meetings/weekly-report";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await buildAndSendWeeklyMeetingsReport();
    return NextResponse.json({
      ok: result.slack.ok,
      slackError: result.slack.error,
      total: result.week.total,
      coaches: result.week.perCoach.length,
      range: `${result.week.startDate}..${result.week.endDate}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/weekly-meetings-report] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
