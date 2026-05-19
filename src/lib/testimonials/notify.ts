// Testimonials: Slack notification when a new lead lands.
//
// Reuses the Daily Coacher Slack bot infrastructure (SLACK_BOT_TOKEN_COACHING).
// DMs the admin with full lead details + a deep link to the admin leads page.
//
// Fire-and-forget from the API route — failures here only mean the admin
// doesn't get the Slack ping for that lead. The lead row is still in the DB,
// and the admin will see it on next refresh of the leads page.

import { ADMIN_SLACK_USER_ID, openDmChannel, postBlocks } from "@/lib/slack/coaching-bot";
import type { TestimonialLead } from "./types";

const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://dashboard-drab-two-78.vercel.app";

export async function notifyAdminOfNewLead(lead: TestimonialLead): Promise<void> {
  const dmChannel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!dmChannel) {
    console.warn("[testimonials/notify] Could not open admin DM channel");
    return;
  }

  const ccosUrl = `${APP_BASE_URL}/testimonials/leads`;
  const submittedRelative = "just now"; // Always near-real-time
  void submittedRelative;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "New testimonials-page lead 🎉", emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Name*\n${lead.name}` },
        { type: "mrkdwn", text: `*Email*\n${lead.email}` },
        { type: "mrkdwn", text: `*Phone*\n${lead.phone}` },
      ],
    },
  ];

  if (lead.message && lead.message.trim()) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Message*\n> ${lead.message.replace(/\n/g, "\n> ")}`,
      },
    });
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "View in CCOS", emoji: true },
        url: ccosUrl,
        action_id: "view_in_ccos",
        style: "primary",
      },
    ],
  });

  const fallback = `New lead: ${lead.name} <${lead.email}>`;
  const result = await postBlocks(dmChannel, blocks, fallback);
  if (!result.ok) {
    console.warn(
      "[testimonials/notify] postBlocks failed:",
      (result as { error?: string }).error ?? "unknown"
    );
  }
}
