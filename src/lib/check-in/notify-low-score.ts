// Client Check-In: Slack DM to admin when a single submission's
// effectiveness score drops below LOW_SCORE_ALERT_THRESHOLD (50).
//
// Mirrors src/lib/testimonials/notify.ts and src/lib/coaching/notify-new-client.ts
// — reuses the coaching-bot Slack infrastructure and DMs Saeed
// (ADMIN_SLACK_USER_ID). Fire-and-forget from the API route; never throws,
// never blocks the API response.

import { ADMIN_SLACK_USER_ID, openDmChannel, postBlocks } from "@/lib/slack/coaching-bot";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://dashboard-drab-two-78.vercel.app";

export interface LowScoreAlertPayload {
  clientName: string;
  coachName: string | null;
  thisFormScore: number; // 0-100
  runningAvgScore: number; // 0-100, across all this client's submissions
  totalSubmissions: number;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  q5Paragraph: string | null;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export async function notifyAdminOfLowScore(
  payload: LowScoreAlertPayload
): Promise<void> {
  const dmChannel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!dmChannel) {
    console.warn("[check-in/notify-low-score] Could not open admin DM channel");
    return;
  }

  const coachLine = payload.coachName ?? "(no coach assigned)";
  const paragraph = payload.q5Paragraph?.trim()
    ? truncate(payload.q5Paragraph.trim(), 500)
    : "(no paragraph)";

  // Deep link: Client Progress tab → that client. The tab itself is
  // client-side rendered, so we just send the user to /coaching and they
  // can navigate. Future enhancement: append a query param the tab reads
  // to auto-open the client's detail view.
  const ccosUrl = `${APP_BASE_URL}/coaching`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Low program effectiveness — investigate",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client*\n${payload.clientName}` },
        { type: "mrkdwn", text: `*Coach*\n${coachLine}` },
        { type: "mrkdwn", text: `*This form*\n${payload.thisFormScore}/100` },
        {
          type: "mrkdwn",
          text: `*Running avg*\n${payload.runningAvgScore}/100 (${payload.totalSubmissions} form${payload.totalSubmissions === 1 ? "" : "s"})`,
        },
      ],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Q1 Coaching*\n${payload.q1}/10` },
        { type: "mrkdwn", text: `*Q2 Strength*\n${payload.q2}/10` },
        { type: "mrkdwn", text: `*Q3 Adherence*\n${payload.q3}/10` },
        { type: "mrkdwn", text: `*Q4 Progress*\n${payload.q4}/10` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Client wrote*\n> ${paragraph.replace(/\n/g, "\n> ")}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open Client Progress", emoji: true },
          url: ccosUrl,
          action_id: "open_client_progress",
          style: "primary",
        },
      ],
    },
  ];

  const fallback = `Low check-in: ${payload.clientName} scored ${payload.thisFormScore}/100. Investigate in Client Progress.`;
  const result = await postBlocks(dmChannel, blocks, fallback);
  if (!result.ok) {
    console.warn(
      "[check-in/notify-low-score] postBlocks failed:",
      (result as { error?: string }).error ?? "unknown"
    );
  }
}
