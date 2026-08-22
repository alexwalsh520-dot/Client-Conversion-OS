// Nutrition: Slack DM to admin when a new intake form is submitted.
//
// Mirrors notify-new-client + notify-new-referral. Uses the coaching-bot
// Slack infrastructure and DMs Saeed (ADMIN_SLACK_USER_ID) so he knows
// an intake landed while we're still confirming the direct-to-Supabase
// pipeline is healthy.
//
// Fire-and-forget from the API route. Never throws.

import { ADMIN_SLACK_USER_ID, openDmChannel, postBlocks } from "@/lib/slack/coaching-bot";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://dashboard-drab-two-78.vercel.app";

export interface NewIntakeNotifyPayload {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  fitness_goal: string | null;
  current_weight: string | null;
  intake_id: number;
}

export async function notifyAdminOfNewIntake(
  intake: NewIntakeNotifyPayload,
): Promise<void> {
  const dmChannel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!dmChannel) {
    console.warn("[nutrition/notify-new-intake] Could not open admin DM channel");
    return;
  }

  const fullName = `${intake.first_name} ${intake.last_name}`.trim() || "(no name)";

  const fields: Array<{ type: "mrkdwn"; text: string }> = [
    { type: "mrkdwn", text: `*Name*\n${fullName}` },
    { type: "mrkdwn", text: `*Email*\n${intake.email || "not provided"}` },
    { type: "mrkdwn", text: `*Phone*\n${intake.phone || "not provided"}` },
  ];
  if (intake.current_weight) {
    fields.push({ type: "mrkdwn", text: `*Current weight*\n${intake.current_weight}` });
  }
  if (intake.fitness_goal) {
    fields.push({ type: "mrkdwn", text: `*Fitness goal*\n${intake.fitness_goal}` });
  }

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "New nutrition intake submitted", emoji: true },
    },
    { type: "section", fields },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Landed directly in Supabase (not through the Google Sheet). Row id: `" + intake.intake_id + "`.",
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Open Coaching Hub", emoji: true },
          url: `${APP_BASE_URL}/coaching`,
          action_id: "open_coaching_hub_intake",
          style: "primary",
        },
      ],
    },
  ];

  const fallback = `New nutrition intake: ${fullName} (${intake.email}). Row id ${intake.intake_id}.`;
  const result = await postBlocks(dmChannel, blocks, fallback);
  if (!result.ok) {
    console.warn(
      "[nutrition/notify-new-intake] postBlocks failed:",
      (result as { error?: string }).error ?? "unknown",
    );
  }
}
