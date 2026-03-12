// Slack API client for the Sales Manager Hub
// Posts messages and rich block-kit messages to Slack channels
// Uses fetch() directly — no @slack/web-api dependency needed

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLACK_API_BASE = "https://slack.com/api";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBotToken(): string | null {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.warn(
      "[slack] SLACK_BOT_TOKEN not set — Slack messaging is disabled"
    );
    return null;
  }
  return token;
}

interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
}

/**
 * Internal wrapper for Slack Web API calls.
 */
async function slackPost(
  method: string,
  body: Record<string, unknown>
): Promise<SlackApiResponse> {
  const token = getBotToken();
  if (!token) {
    return { ok: false, error: "SLACK_BOT_TOKEN not configured" };
  }

  const url = `${SLACK_API_BASE}/${method}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.error(
      `[slack] HTTP ${response.status} on ${method}: ${text.substring(0, 200)}`
    );
    return { ok: false, error: `HTTP ${response.status}` };
  }

  const data = (await response.json()) as SlackApiResponse;

  if (!data.ok) {
    console.error(`[slack] API error on ${method}: ${data.error}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Post a plain text message to a Slack channel.
 *
 * @param channelId - The Slack channel ID (e.g., "C01ABCDEF")
 * @param text      - The message text (supports Slack mrkdwn)
 * @returns true if the message was posted successfully, false otherwise
 */
export async function postToSlack(
  channelId: string,
  text: string
): Promise<boolean> {
  if (!channelId) {
    console.error("[slack] channelId is required");
    return false;
  }

  if (!text) {
    console.error("[slack] text is required");
    return false;
  }

  const result = await slackPost("chat.postMessage", {
    channel: channelId,
    text,
  });

  return result.ok;
}

/**
 * Post a rich formatted message using Slack Block Kit.
 *
 * Block Kit documentation: https://api.slack.com/block-kit
 *
 * @param channelId - The Slack channel ID (e.g., "C01ABCDEF")
 * @param blocks    - Array of Block Kit block objects
 * @returns true if the message was posted successfully, false otherwise
 *
 * @example
 * ```typescript
 * await postRichMessage("C01ABCDEF", [
 *   {
 *     type: "section",
 *     text: {
 *       type: "mrkdwn",
 *       text: "*Sales Alert* :chart_with_upwards_trend:\nBROZ just closed a $3,600 deal!"
 *     }
 *   },
 *   {
 *     type: "section",
 *     fields: [
 *       { type: "mrkdwn", text: "*Closer:*\nJacob Broz" },
 *       { type: "mrkdwn", text: "*Revenue:*\n$3,600.00" },
 *     ]
 *   }
 * ]);
 * ```
 */
export async function postRichMessage(
  channelId: string,
  blocks: unknown[]
): Promise<boolean> {
  if (!channelId) {
    console.error("[slack] channelId is required");
    return false;
  }

  if (!blocks || blocks.length === 0) {
    console.error("[slack] blocks array is required and must be non-empty");
    return false;
  }

  // Slack requires a fallback `text` for notifications and accessibility
  const fallbackText = "New message from Sales Manager Hub";

  const result = await slackPost("chat.postMessage", {
    channel: channelId,
    text: fallbackText,
    blocks,
  });

  return result.ok;
}

/**
 * Upload a file (e.g. PDF) to a Slack channel or DM.
 * Uses the files.uploadV2 API.
 */
export async function uploadFileToSlack(
  channelId: string,
  fileBuffer: Buffer,
  filename: string,
  title: string,
  initialComment?: string
): Promise<boolean> {
  const token = getBotToken();
  if (!token || !channelId) return false;

  try {
    // Step 1: Get upload URL
    const getUrlRes = await fetch(`${SLACK_API_BASE}/files.getUploadURLExternal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        filename,
        length: String(fileBuffer.length),
      }),
    });

    const getUrlData = await getUrlRes.json() as { ok: boolean; upload_url?: string; file_id?: string; error?: string };
    if (!getUrlData.ok || !getUrlData.upload_url || !getUrlData.file_id) {
      console.error("[slack] files.getUploadURLExternal failed:", getUrlData.error);
      return false;
    }

    // Step 2: Upload file content
    const uploadRes = await fetch(getUrlData.upload_url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array(fileBuffer),
    });

    if (!uploadRes.ok) {
      console.error("[slack] File upload failed:", uploadRes.status);
      return false;
    }

    // Step 3: Complete upload
    const completeRes = await fetch(`${SLACK_API_BASE}/files.completeUploadExternal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        files: [{ id: getUrlData.file_id, title }],
        channel_id: channelId,
        initial_comment: initialComment || "",
      }),
    });

    const completeData = await completeRes.json() as { ok: boolean; error?: string };
    if (!completeData.ok) {
      console.error("[slack] files.completeUploadExternal failed:", completeData.error);
      return false;
    }

    return true;
  } catch (err) {
    console.error("[slack] uploadFileToSlack error:", err);
    return false;
  }
}
