/**
 * GET /api/cron/check-in-tough-nutrition-sleep
 *
 * Fires every Sunday at 11:30 UTC (30 minutes after the main weekly
 * check-in digest at 11:00 UTC). Lists every client whose lowest Q3
 * (nutrition + sleep) score this week was 4 or below out of 10, and
 * DMs Saeed via the coaching Slack bot.
 *
 * Auth mirrors the sibling check-in-weekly-digest cron.
 */

import { NextRequest, NextResponse } from "next/server";
import { buildAndSendToughReport } from "@/lib/check-in/tough-nutrition-sleep-report";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(
    process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`,
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await buildAndSendToughReport();
    return NextResponse.json({
      ok: result.slack.ok,
      slackError: result.slack.error,
      toughClientCount: result.data.toughClients.length,
      totalSubmissionsThisWeek: result.data.totalSubmissionsThisWeek,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cron/check-in-tough-nutrition-sleep] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
