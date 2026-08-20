/**
 * Daily call-outcomes recap → #a-sales-manager at 12:30 AM ET.
 *
 * Recaps the day that just ended: every call that was on a GHL calendar for
 * that ET day, with taken / closed / rescheduled / cash beside it, split by
 * offer. Fires 12:30 AM rather than late evening so closers and setters have
 * the evening to finish logging the sales tracker.
 *
 * Scheduled at 04:30 and 05:30 UTC; the ET-hour gate means exactly one of the
 * two runs does the work, year-round through DST.
 *
 * Test hooks: `?dry=1` renders without posting, `?force=1` skips the hour gate,
 * `?day=YYYY-MM-DD` recaps a specific ET day, `?json=1` returns the raw report.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET (standard CCOS cron pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { addDays, etDateStr, etHour } from "@/lib/daily-report/time";
import { buildCallOutcomesReport } from "@/lib/call-outcomes/data";
import { formatCallOutcomes } from "@/lib/call-outcomes/format";
import { postAsCso } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const TARGET_ET_HOUR = 0; // 12:30 AM ET (the cron's :30 minute pins the time)

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const dry = url.searchParams.get("dry") === "1";
  const json = url.searchParams.get("json") === "1";
  const dayParam = url.searchParams.get("day");

  const now = new Date();
  if (!force && !dayParam && etHour(now) !== TARGET_ET_HOUR) {
    return NextResponse.json({
      skipped: true,
      reason: `ET hour ${etHour(now)} != ${TARGET_ET_HOUR}`,
    });
  }

  // Firing just after midnight, "today's calls" are the calls of the day that
  // just ended.
  const day =
    dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam)
      ? dayParam
      : addDays(etDateStr(now), -1);

  const report = await buildCallOutcomesReport(day);
  const text = formatCallOutcomes(report);

  if (json) return NextResponse.json(report);
  if (dry) return NextResponse.json({ dry: true, day, text, warnings: report.warnings });

  const posted = await postAsCso(text);
  return NextResponse.json({
    posted,
    day,
    scheduled: report.totals.scheduled,
    excludedClientOnboarding: report.excludedClientOnboarding,
    warnings: report.warnings,
  });
}
