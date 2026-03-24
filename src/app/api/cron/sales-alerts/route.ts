/**
 * Real-Time Sales Alerts Cron
 *
 * Runs every 2 hours during business hours to catch problems fast.
 * Only posts to Slack when thresholds are breached.
 *
 * Schedule: 0 13,15,17,19,21,23 * * 1-5 (every 2 hours, 8AM-6PM EST, weekdays)
 * Simplified for vercel.json: 0 */2 * * * (every 2 hours)
 */

import { NextRequest, NextResponse } from "next/server";
import { checkAlerts } from "@/lib/sales-agent";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SALES_BRAIN_CHANNEL = process.env.SALES_BRAIN_CHANNEL_ID;

export async function GET(req: NextRequest) {
  // Verify cron authorization
  const isVercelCron = req.headers.get("x-vercel-cron") === "true";
  const authHeader = req.headers.get("authorization");
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const alerts = await checkAlerts();

    if (alerts.length > 0 && SLACK_BOT_TOKEN && SALES_BRAIN_CHANNEL) {
      await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          channel: SALES_BRAIN_CHANNEL,
          text: `ð§  *Sales Brain Alert Check*\n\n${alerts.join("\n\n")}`,
          username: "Sales Brain",
          icon_emoji: ":brain:"
        })
      });
    }

    return NextResponse.json({
      success: true,
      alertCount: alerts.length,
      alerts: alerts.length > 0 ? alerts : "All clear â no threshold breaches.",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("Sales alerts cron error:", err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : "Unknown error"
    }, { status: 500 });
  }
}
