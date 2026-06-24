/**
 * Midday metrics report — posts to #a-sales-manager at 5:00 PM ET.
 *
 * Covers today 5:00a–5:00p ET: ad spend / leads / CPL / cost-per-booked-call
 * per client, sales-call activity (scheduled / taken / sales / cash), and what's
 * left on the calendar for the rest of the day.
 *
 * Vercel cron fires in UTC and doesn't DST-shift, so it's scheduled at both
 * 21:00 and 22:00 UTC and this handler runs only when it's actually 17:00 ET —
 * correct year-round across EST/EDT. `?force=1` ignores the gate; `?dry=1`
 * returns the rendered message without posting. Both require the Bearer secret.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET (standard CCOS cron pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildMiddayReport } from "@/lib/daily-report/metrics";
import { formatMidday } from "@/lib/daily-report/format";
import { etHour } from "@/lib/daily-report/time";
import { postAsCso } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;

const TARGET_ET_HOUR = 17;

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

  const report = await buildMiddayReport(now);
  const text = formatMidday(report);

  if (dry) {
    return NextResponse.json({ dry: true, text, report });
  }

  const posted = await postAsCso(text);
  return NextResponse.json({ posted, warnings: report.warnings, generated_at: report.generatedAt });
}
