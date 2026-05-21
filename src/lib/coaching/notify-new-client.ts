// Coaching: Slack DM to admin when a NEW client is added through CCOS.
//
// Mirrors the testimonials lead-notify pattern. Reuses the coaching-bot
// Slack infrastructure (SLACK_BOT_TOKEN_COACHING) and DMs Saeed
// (ADMIN_SLACK_USER_ID) so he can add the client to his manager track
// record sheet.
//
// Fire-and-forget from the API route. Failures here mean Saeed misses
// one Slack ping; the client row is still saved. Never throws.
//
// IMPORTANT: only the manual "Add Client" flow at /api/coaching
// `upsert_client` (true-insert branch) calls this. Bulk Google Sheets
// sync at /api/sync intentionally does NOT, to avoid spamming the DM
// with hundreds of historical rows.

import { ADMIN_SLACK_USER_ID, openDmChannel, postBlocks } from "@/lib/slack/coaching-bot";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://dashboard-drab-two-78.vercel.app";

export interface NewClientNotifyPayload {
  name: string;
  startDate: string | null | undefined;
  endDate: string | null | undefined;
  coachName?: string | null;
  program?: string | null;
}

// Pretty-print "2026-11-02" -> "Nov 2, 2026". Falls back to the raw
// string if it can't be parsed.
function formatDate(d: string | null | undefined): string {
  if (!d) return "not set";
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function notifyAdminOfNewClient(
  client: NewClientNotifyPayload
): Promise<void> {
  const dmChannel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!dmChannel) {
    console.warn("[coaching/notify-new-client] Could not open admin DM channel");
    return;
  }

  const coachingUrl = `${APP_BASE_URL}/coaching`;

  const fieldsRow: Array<{ type: "mrkdwn"; text: string }> = [
    { type: "mrkdwn", text: `*Client*\n${client.name}` },
    { type: "mrkdwn", text: `*Start Date*\n${formatDate(client.startDate)}` },
    { type: "mrkdwn", text: `*End Date*\n${formatDate(client.endDate)}` },
  ];
  if (client.coachName) {
    fieldsRow.push({ type: "mrkdwn", text: `*Coach*\n${client.coachName}` });
  }
  if (client.program) {
    fieldsRow.push({ type: "mrkdwn", text: `*Program*\n${client.program}` });
  }

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "New client added to CCOS", emoji: true },
    },
    {
      type: "section",
      fields: fieldsRow,
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Reminder: add this client to your manager track record sheet.",
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open Coaching Hub", emoji: true },
          url: coachingUrl,
          action_id: "open_coaching_hub",
        },
      ],
    },
  ];

  const fallback = `New client added: ${client.name} (ends ${formatDate(
    client.endDate
  )}). Add to your manager track record sheet.`;
  const result = await postBlocks(dmChannel, blocks, fallback);
  if (!result.ok) {
    console.warn(
      "[coaching/notify-new-client] postBlocks failed:",
      (result as { error?: string }).error ?? "unknown"
    );
  }
}
