/**
 * Daily EOD Summary Cron — DM to Ahmad
 *
 * Runs at 3 PM PKT (10:00 UTC) daily.
 * Sends a comprehensive summary of all EOD submissions for today
 * directly to Ahmad via Slack DM.
 *
 * Schedule: 0 10 * * *
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

const AHMAD_SLACK_ID = "U08FK5NPG9W";
const SLACK_API = "https://slack.com/api";

async function sendDM(blocks: unknown[], fallbackText: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN_COACHING;
  if (!token) {
    console.error("[eod-summary] SLACK_BOT_TOKEN_COACHING not set");
    return false;
  }

  // Open a DM conversation with Ahmad
  const openRes = await fetch(`${SLACK_API}/conversations.open`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: AHMAD_SLACK_ID }),
  });
  const openData = (await openRes.json()) as { ok: boolean; channel?: { id: string }; error?: string };
  if (!openData.ok || !openData.channel?.id) {
    console.error("[eod-summary] Failed to open DM:", openData.error);
    return false;
  }

  const dmChannelId = openData.channel.id;

  const postRes = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: dmChannelId,
      text: fallbackText,
      blocks,
      username: "CCOS Coaching Bot",
      icon_emoji: ":clipboard:",
    }),
  });
  const postData = (await postRes.json()) as { ok: boolean; error?: string };
  if (!postData.ok) {
    console.error("[eod-summary] Failed to send DM:", postData.error);
    return false;
  }
  return true;
}

export async function GET(req: NextRequest) {
  const isVercelCron = req.headers.get("x-vercel-cron") === "true";
  const authHeader = req.headers.get("authorization");
  const isAuthed = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthed && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getServiceSupabase();

    // Today's date in PKT (UTC+5)
    const now = new Date();
    const pkt = new Date(now.getTime() + 5 * 60 * 60 * 1000);
    const today = pkt.toISOString().split("T")[0];

    // Get all expected submitters
    const { data: activeClients } = await db
      .from("clients")
      .select("coach_name")
      .eq("status", "active");

    const expectedCoaches = [
      ...new Set(
        (activeClients || [])
          .map((c: { coach_name: string | null }) => c.coach_name)
          .filter(Boolean) as string[]
      ),
    ];
    const expectedSubmitters = [...expectedCoaches, "Nicole", "Daman"];

    // Get all EOD reports submitted today (by created_at) or for today's date
    const { data: reports } = await db
      .from("eod_reports")
      .select("*")
      .or(`date.eq.${today},created_at.gte.${today}T00:00:00`);

    const allReports = reports || [];

    // Group reports by submitter
    const bySubmitter = new Map<string, typeof allReports>();
    for (const r of allReports) {
      const name = r.submitted_by;
      if (!bySubmitter.has(name)) bySubmitter.set(name, []);
      bySubmitter.get(name)!.push(r);
    }

    // Build summary blocks
    const blocks: unknown[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `:clipboard: EOD Summary — ${today}` },
      },
    ];

    for (const name of expectedSubmitters.sort()) {
      const personReports = bySubmitter.get(name);

      if (!personReports || personReports.length === 0) {
        // No submission
        blocks.push({
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${name}* — :x: _No EOD submitted_`,
          },
        });
      } else {
        // Has submissions
        for (const r of personReports) {
          const role = r.role || "coach";
          const roleEmoji = role === "onboarding" ? ":woman-raising-hand:" : role === "nutrition" ? ":salad:" : ":weight_lifter:";
          const lines: string[] = [];

          lines.push(`*${name}* ${roleEmoji} (${role}) — EOD for *${r.date}*`);

          if (r.active_client_count) lines.push(`  Clients: ${r.active_client_count} active`);
          if (r.hours_logged) lines.push(`  Hours: ${r.hours_logged}h`);
          if (r.feeling_today) lines.push(`  Feeling: ${r.feeling_today}`);

          // New clients
          const newNames = r.new_client_names ? JSON.parse(r.new_client_names) : [];
          if (newNames.length > 0) lines.push(`  :new: New clients: ${newNames.join(", ")}`);

          // Deactivated
          const deactivated = r.deactivated_client_names ? JSON.parse(r.deactivated_client_names) : [];
          if (deactivated.length > 0) lines.push(`  :red_circle: Deactivated: ${deactivated.join(", ")}`);

          if (r.community_engagement) lines.push(`  Community: ${r.community_engagement.substring(0, 150)}`);
          if (r.summary) lines.push(`  Summary: ${r.summary.substring(0, 300)}`);
          if (r.questions_for_management) lines.push(`  :question: *Questions:* ${r.questions_for_management.substring(0, 300)}`);

          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: lines.join("\n") },
          });
        }
      }

      blocks.push({ type: "divider" });
    }

    // Also include any submissions from people not in expected list
    for (const [name, personReports] of bySubmitter) {
      if (!expectedSubmitters.includes(name)) {
        for (const r of personReports) {
          const lines = [`*${name}* (${r.role || "unknown"}) — EOD for *${r.date}*`];
          if (r.summary) lines.push(`  Summary: ${r.summary.substring(0, 300)}`);
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: lines.join("\n") },
          });
        }
        blocks.push({ type: "divider" });
      }
    }

    // Footer
    const submitted = bySubmitter.size;
    const total = expectedSubmitters.length;
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${submitted}/${total} team members submitted | Generated at ${new Date().toISOString()}`,
        },
      ],
    });

    await sendDM(blocks, `EOD Summary for ${today}: ${submitted}/${total} submitted`);

    return NextResponse.json({
      success: true,
      date: today,
      submitted,
      total,
    });
  } catch (err) {
    console.error("[cron/eod-summary] Failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Internal error" },
      { status: 500 }
    );
  }
}
