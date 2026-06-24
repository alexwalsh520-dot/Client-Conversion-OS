/**
 * End-of-day metrics recap — posts to #a-sales-manager at 1:00 AM ET.
 *
 * Recaps the day that just ended (spend / leads / CPL / booked calls /
 * cost-per-booked-call, for the day + week-to-date + month-to-date), the sales
 * outcome for that day, and how many calls are scheduled for the new day.
 *
 * Scheduled at 05:00 and 06:00 UTC; this handler runs only when it's 1:00 AM ET
 * (DST-correct year-round). `?force=1` ignores the gate; `?dry=1` returns the
 * rendered message without posting. Both require the Bearer secret.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET (standard CCOS cron pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildEodReport } from "@/lib/daily-report/metrics";
import { formatEod } from "@/lib/daily-report/format";
import { etHour } from "@/lib/daily-report/time";
import { postAsCso } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;

const TARGET_ET_HOUR = 1;

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
  const atParam = url.searchParams.get("at"); // override "now" for testing/backfill (ISO)
  const now = atParam && !Number.isNaN(Date.parse(atParam)) ? new Date(atParam) : new Date();

  if (!force && etHour(now) !== TARGET_ET_HOUR) {
    return NextResponse.json({ skipped: true, reason: `ET hour ${etHour(now)} != ${TARGET_ET_HOUR}` });
  }

  const report = await buildEodReport(now);
  const text = formatEod(report);

  if (dry) {
    return NextResponse.json({ dry: true, text, report });
  }

  const posted = await postAsCso(text);
  return NextResponse.json({ posted, warnings: report.warnings, generated_at: report.generatedAt });
}
