/**
 * Automated Sales Agent Review Cron
 *
 * Runs daily at 9 PM EST (after business hours). Does three things:
 * 1. Auto-reviews all new call transcripts from today
 * 2. Auto-reviews all new DM transcripts from today
 * 3. Checks alert thresholds and flags problems
 * 4. Posts a daily digest to the #sales-brain Slack channel
 *
 * Schedule: 0 2 * * * (2 AM UTC = 9 PM EST)
 * Add to vercel.json crons array
 */

import { NextRequest, NextResponse } from "next/server";
import { autoReviewNewCalls, autoReviewNewDMs, checkAlerts, runSalesAgent } from "@/lib/sales-agent";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SALES_BRAIN_CHANNEL = process.env.SALES_BRAIN_CHANNEL_ID;

async function postToSlack(text: string) {
  if (!SLACK_BOT_TOKEN || !SALES_BRAIN_CHANNEL) {
    console.log("Slack not configured, skipping post:", text.slice(0, 100));
    return;
  }

  // Split into chunks if needed
  const chunks = text.length > 3900 ? splitIntoChunks(text, 3900) : [text];

  for (const chunk of chunks) {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        channel: SALES_BRAIN_CHANNEL,
        text: chunk,
        username: "Sales Brain",
        icon_emoji: ":brain:"
      })
    });
  }
}

function splitIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let idx = remaining.lastIndexOf("\n", maxLength);
    if (idx === -1 || idx < maxLength * 0.5) idx = remaining.lastIndexOf(" ", maxLength);
    if (idx === -1) idx = maxLength;
    chunks.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function GET(req: NextRequest) {
  // Verify this is a legitimate cron call
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === "production") {
    // Allow if called from Vercel cron (which uses CRON_SECRET)
    // Or if not in production (for testing)
    const isVercelCron = req.headers.get("x-vercel-cron") === "true";
    if (!isVercelCron) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const results = {
    callReviews: 0,
    dmReviews: 0,
    alerts: 0,
    errors: [] as string[]
  };

  try {
    // âââ 1. Check Alerts First âââââââââââââââââââââââââââââââââââââââââ
    const alerts = await checkAlerts();
    results.alerts = alerts.length;

    if (alerts.length > 0) {
      await postToSlack(
        `ð¨ *SALES BRAIN ALERTS*\n\n${alerts.join("\n\n")}`
      );
    }

    // âââ 2. Auto-Review Today's Calls ââââââââââââââââââââââââââââââââââ
    const callReviews = await autoReviewNewCalls();
    results.callReviews = callReviews.length;

    if (callReviews.length > 0) {
      await postToSlack(
        `ð *CALL REVIEWS â ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}*\n\n${callReviews.join("\n\nâââââââââââââââ\n\n")}`
      );
    }

    // âââ 3. Auto-Review Today's DMs ââââââââââââââââââââââââââââââââââââ
    const dmReviews = await autoReviewNewDMs();
    results.dmReviews = dmReviews.length;

    if (dmReviews.length > 0) {
      await postToSlack(
        `ð¬ *DM REVIEWS â ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}*\n\n${dmReviews.join("\n\nâââââââââââââââ\n\n")}`
      );
    }

    // âââ 4. Generate End-of-Day Summary ââââââââââââââââââââââââââââââââ
    const today = new Date().toISOString().split("T")[0];
    const monthStart = today.slice(0, 8) + "01";

    const dailySummary = await runSalesAgent(
      `Give me today's end-of-day sales performance summary. Cover: cash collected today, MTD pace, show rate today vs MTD, any closers on hot/cold streaks, and the #1 action item for tomorrow. Keep it tight â this goes to Slack.`
    );

    await postToSlack(
      `ð *END OF DAY REPORT â ${new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}*\n\n${dailySummary}`
    );

    const duration = Date.now() - startTime;

    // âââ 5. Log Run ââââââââââââââââââââââââââââââââââââââââââââââââââââ
    await postToSlack(
      `â _Daily review complete in ${Math.round(duration / 1000)}s â ${results.callReviews} calls reviewed, ${results.dmReviews} DM batches reviewed, ${results.alerts} alerts triggered._`
    );

    return NextResponse.json({
      success: true,
      ...results,
      durationMs: duration
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    results.errors.push(message);
    console.error("Sales agent cron error:", err);

    await postToSlack(`â ï¸ *Sales Brain cron encountered an error:* ${message}`);

    return NextResponse.json({
      success: false,
      ...results,
      error: message
    }, { status: 500 });
  }
}
