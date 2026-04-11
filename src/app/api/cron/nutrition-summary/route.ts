/**
 * Bi-monthly Nutrition Meal Plan Summary Cron
 *
 * Runs on the 1st and 15th of each month.
 * - 1st: counts meal plans completed from the 16th of prev month to end of prev month
 * - 15th: counts meal plans completed from the 1st to the 14th of current month
 *
 * Posts summary to #eod-report-status tagging Ahmad.
 *
 * Schedule: 0 11 1,15 * * (11:00 UTC = 4:00 PM PKT on the 1st and 15th)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { postToCoachingChannel } from "@/lib/slack";

const AHMAD_SLACK_ID = "U08FK5NPG9W";

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "true";
  const authHeader = req.headers.get("authorization");
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getServiceSupabase();
    const now = new Date();
    const day = now.getUTCDate();
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-indexed

    let periodStart: string;
    let periodEnd: string;
    let periodLabel: string;

    if (day <= 15) {
      // Running on the 15th: count from 1st to 14th of current month
      periodStart = new Date(year, month, 1).toISOString();
      periodEnd = new Date(year, month, 15).toISOString();
      const monthName = new Date(year, month, 1).toLocaleDateString("en-US", { month: "long" });
      periodLabel = `${monthName} 1–14, ${year}`;
    } else {
      // Running on the 1st: count from 16th to end of previous month
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      const lastDayPrev = new Date(year, month, 0).getDate();
      periodStart = new Date(prevYear, prevMonth, 16).toISOString();
      periodEnd = new Date(prevYear, prevMonth, lastDayPrev, 23, 59, 59).toISOString();
      const monthName = new Date(prevYear, prevMonth, 1).toLocaleDateString("en-US", { month: "long" });
      periodLabel = `${monthName} 16–${lastDayPrev}, ${prevYear}`;
    }

    // Count completed meal plans in the period
    const { data: completed, error } = await db
      .from("clients")
      .select("name, nutrition_assigned_to, nutrition_completed_at")
      .eq("nutrition_status", "done")
      .gte("nutrition_completed_at", periodStart)
      .lt("nutrition_completed_at", periodEnd);

    if (error) throw error;

    const count = completed?.length || 0;

    // Group by assignee
    const byAssignee: Record<string, number> = {};
    for (const c of completed || []) {
      const assignee = c.nutrition_assigned_to || "Unknown";
      byAssignee[assignee] = (byAssignee[assignee] || 0) + 1;
    }

    const breakdownLines = Object.entries(byAssignee)
      .map(([name, cnt]) => `  • ${name}: ${cnt}`)
      .join("\n");

    await postToCoachingChannel([
      {
        type: "header",
        text: { type: "plain_text", text: ":bar_chart: Meal Plan Summary" },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Period:* ${periodLabel}\n*Total meal plans completed:* ${count}\n\n${breakdownLines || "No meal plans completed in this period."}\n\n<@${AHMAD_SLACK_ID}>`,
        },
      },
    ]);

    return NextResponse.json({
      success: true,
      period: periodLabel,
      count,
      breakdown: byAssignee,
    });
  } catch (err) {
    console.error("[cron/nutrition-summary] Failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 }
    );
  }
}
