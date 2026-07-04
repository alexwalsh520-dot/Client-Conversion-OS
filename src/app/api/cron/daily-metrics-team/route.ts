/**
 * Team recap — posts per-closer + per-setter metrics to #a-sales-manager at
 * 12:30 AM ET (alongside the daily recap). Covers the previous ET day.
 *
 * Closers (from the sales sheet): calls · showed · closed · cash.
 * Setters (Sales Hub): leads · booked · booking rate · avg/median response · miss rate.
 *
 * Scheduled at 04:30 and 05:30 UTC; runs only when it's 12:30 AM ET (DST-correct).
 * `?force=1` ignores the gate; `?dry=1` returns the message without posting;
 * `?at=<ISO>` overrides "now". All require the Bearer secret.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET (standard CCOS cron pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { buildTeamReport, formatTeam } from "@/lib/daily-report/team";
import { etHour } from "@/lib/daily-report/time";
import { postAsCso } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;

const TARGET_ET_HOUR = 0; // 12:30 AM ET (cron minute :30 pins the time)

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
  const atParam = url.searchParams.get("at");
  const now = atParam && !Number.isNaN(Date.parse(atParam)) ? new Date(atParam) : new Date();

  if (!force && etHour(now) !== TARGET_ET_HOUR) {
    return NextResponse.json({ skipped: true, reason: `ET hour ${etHour(now)} != ${TARGET_ET_HOUR}` });
  }

  const report = await buildTeamReport(now);
  const text = formatTeam(report);

  if (dry) {
    return NextResponse.json({ dry: true, text, report });
  }

  const posted = await postAsCso(text);
  return NextResponse.json({ posted, warnings: report.warnings, generated_at: report.generatedAt });
}
