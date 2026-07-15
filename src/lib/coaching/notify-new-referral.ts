// Coaching: Slack DM to admin when a new referral is submitted through CCOS.
//
// Mirrors notify-new-client. Uses the coaching-bot Slack infrastructure
// (SLACK_BOT_TOKEN_COACHING) and DMs Saeed (ADMIN_SLACK_USER_ID) with
// the details of the referred person and the client who referred them.
//
// Fire-and-forget from the API route. A Slack failure means Saeed misses
// a ping; the referral row is still in the Google Sheet. Never throws.

import { ADMIN_SLACK_USER_ID, openDmChannel, postBlocks } from "@/lib/slack/coaching-bot";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://dashboard-drab-two-78.vercel.app";

const REFERRAL_TRACKER_URL =
  "https://docs.google.com/spreadsheets/d/1pETDqpj6nFzWVmj1vuFmZs70NG9rUScTiavU9q7ERtY/edit?gid=0#gid=0";

export interface NewReferralNotifyPayload {
  existingClientName: string;
  existingClientEmail: string;
  existingClientCoach: string | null;
  refereeName: string;
  refereePhone: string;
}

export async function notifyAdminOfNewReferral(
  referral: NewReferralNotifyPayload,
): Promise<void> {
  const dmChannel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!dmChannel) {
    console.warn("[coaching/notify-new-referral] Could not open admin DM channel");
    return;
  }

  const fieldsRow: Array<{ type: "mrkdwn"; text: string }> = [
    { type: "mrkdwn", text: `*Referred by*\n${referral.existingClientName}` },
    { type: "mrkdwn", text: `*Client email*\n${referral.existingClientEmail || "not on file"}` },
    { type: "mrkdwn", text: `*Referred person*\n${referral.refereeName}` },
    { type: "mrkdwn", text: `*Phone*\n${referral.refereePhone}` },
  ];
  if (referral.existingClientCoach) {
    fieldsRow.push({ type: "mrkdwn", text: `*Coach*\n${referral.existingClientCoach}` });
  }

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "New referral submitted", emoji: true },
    },
    { type: "section", fields: fieldsRow },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Added to the Fitness Referral Tracker with status *Pending*. Closers pick it up from there.",
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open Referral Tracker", emoji: true },
          url: REFERRAL_TRACKER_URL,
          action_id: "open_referral_tracker",
          style: "primary",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Open Coaching Hub", emoji: true },
          url: `${APP_BASE_URL}/coaching`,
          action_id: "open_coaching_hub_referrals",
        },
      ],
    },
  ];

  const fallback = `New referral from ${referral.existingClientName}: ${referral.refereeName} (${referral.refereePhone}).`;
  const result = await postBlocks(dmChannel, blocks, fallback);
  if (!result.ok) {
    console.warn(
      "[coaching/notify-new-referral] postBlocks failed:",
      (result as { error?: string }).error ?? "unknown",
    );
  }
}
