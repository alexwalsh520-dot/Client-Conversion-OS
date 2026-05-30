// Slack DM helpers for auto meal-plan pipeline results.
//
// Two flavors:
//   - notifyAdminTestRunDone: DM Saeed when an admin-triggered test
//     run finishes. Includes a download link (signed URL) so he can
//     review the PDF without bouncing through the CCOS UI.
//   - notifyAdminTestRunFailed: DM Saeed when a test run fails.
//     Includes the error message so he can fix or ping.
//
// Production cron-triggered runs post to #nutritiontalk via a
// different helper that tags the coach (built in Piece 4).

import {
  ADMIN_SLACK_USER_ID,
  openDmChannel,
  postBlocks,
} from "@/lib/slack/coaching-bot";

export async function notifyAdminTestRunDone(params: {
  runId: number;
  clientFullName: string;
  signedUrl: string;
  coachInternalName: string | null;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  const channel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!channel) {
    console.warn(
      "[notify-pipeline-result] could not open admin DM channel for run",
      params.runId,
    );
    return;
  }

  const coachLine = params.coachInternalName ?? "(no coach on file)";
  const tokenLine =
    params.inputTokens != null && params.outputTokens != null
      ? `${params.inputTokens.toLocaleString()} in / ${params.outputTokens.toLocaleString()} out`
      : "(token usage unavailable)";

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Test meal plan ready 🥗",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client*\n${params.clientFullName}` },
        { type: "mrkdwn", text: `*Coach*\n${coachLine}` },
        { type: "mrkdwn", text: `*Run ID*\n${params.runId}` },
        { type: "mrkdwn", text: `*Tokens*\n${tokenLine}` },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "Download link expires in 7 days. This is a TEST run — the plan was not uploaded to CCOS and the task was not marked done.",
        },
      ],
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Download PDF", emoji: true },
          url: params.signedUrl,
          action_id: `download_test_plan_${params.runId}`,
          style: "primary",
        },
      ],
    },
  ];

  const fallback = `Test meal plan for ${params.clientFullName} ready: ${params.signedUrl}`;
  const result = await postBlocks(channel, blocks, fallback);
  if (!result.ok) {
    console.warn(
      "[notify-pipeline-result] postBlocks failed for run",
      params.runId,
      (result as { error?: string }).error ?? "unknown",
    );
  }
}

export async function notifyAdminTestRunFailed(params: {
  runId: number;
  clientFullName: string;
  errorMessage: string;
}): Promise<void> {
  const channel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!channel) return;
  const truncated = params.errorMessage.length > 500
    ? params.errorMessage.slice(0, 499) + "…"
    : params.errorMessage;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Test meal plan FAILED ⚠️",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Client*\n${params.clientFullName}` },
        { type: "mrkdwn", text: `*Run ID*\n${params.runId}` },
      ],
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Error*\n\`\`\`${truncated}\`\`\``,
      },
    },
  ];
  const fallback = `Test meal plan for ${params.clientFullName} failed: ${truncated}`;
  await postBlocks(channel, blocks, fallback).catch(() => {});
}
