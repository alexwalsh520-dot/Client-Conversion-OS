/**
 * EOD Report Deadline Check Cron
 *
 * Runs daily at 4 PM PKT (11:00 UTC) to check who missed their EOD
 * submission for the previous day. Posts results to the coaching Slack channel.
 *
 * Schedule: 0 11 * * * (11:00 UTC = 4:00 PM PKT)
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { postToCoachingChannel, getCoachingChannel } from "@/lib/slack";

export async function GET(req: NextRequest) {
  // Verify cron authorization
  const isVercelCron = req.headers.get("x-vercel-cron") === "true";
  const authHeader = req.headers.get("authorization");
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channel = getCoachingChannel();
  if (!channel) {
    return NextResponse.json(
      { error: "SLACK_CHANNEL_COACHING not configured" },
      { status: 500 }
    );
  }

  try {
    const db = getServiceSupabase();

    // Yesterday's date in YYYY-MM-DD (the day we're checking EODs for)
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const checkDate = yesterday.toISOString().split("T")[0];

    // Get all active coaches (unique coach_name from clients with active status)
    const { data: activeClients, error: clientErr } = await db
      .from("clients")
      .select("coach_name")
      .eq("status", "active");

    if (clientErr) throw clientErr;

    const expectedCoaches = [
      ...new Set(
        (activeClients || [])
          .map((c: { coach_name: string | null }) => c.coach_name)
          .filter(Boolean) as string[]
      ),
    ];

    // Nicole is always expected for onboarding
    const expectedSubmitters = [...expectedCoaches, "Nicole"];

    // Get EOD reports submitted for yesterday
    const { data: reports, error: reportErr } = await db
      .from("eod_reports")
      .select("submitted_by, role")
      .eq("date", checkDate);

    if (reportErr) throw reportErr;

    const submittedBy = new Set(
      (reports || []).map((r: { submitted_by: string }) => r.submitted_by)
    );

    // Find who's missing
    const missing = expectedSubmitters.filter(
      (name) => !submittedBy.has(name)
    );

    // Build Slack message
    if (missing.length > 0) {
      const missingList = missing.map((name) => `  - ${name}`).join("\n");

      await postToCoachingChannel([
        {
          type: "header",
          text: {
            type: "plain_text",
            text: ":warning: Missing EOD Reports",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `The following people have *not submitted* their EOD report for *${checkDate}* by the 4 PM PKT deadline:\n\n${missingList}`,
          },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `${submittedBy.size}/${expectedSubmitters.length} reports received | Checked at ${new Date().toISOString()}`,
            },
          ],
        },
      ]);
    } else {
      await postToCoachingChannel([
        {
          type: "header",
          text: {
            type: "plain_text",
            text: ":tada: All EOD Reports Submitted",
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `All *${expectedSubmitters.length}* team members submitted their EOD report for *${checkDate}* on time.`,
          },
        },
      ]);
    }

    return NextResponse.json({
      success: true,
      date: checkDate,
      expected: expectedSubmitters,
      submitted: [...submittedBy],
      missing,
    });
  } catch (err) {
    console.error("[cron/eod-check] Failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 }
    );
  }
}
