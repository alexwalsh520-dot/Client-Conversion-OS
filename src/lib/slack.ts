// Slack API client for the Sales Manager Hub
// Posts messages and rich block-kit messages to Slack channels
// Uses fetch() directly — no @slack/web-api dependency needed
//
// CSO (Chief Sales Officer) wrappers route all reports, briefs, and
// reviews to the #a-sales-manager channel with a consistent identity.

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
 * Pass an explicit token to override the default SLACK_BOT_TOKEN.
 */
async function slackPost(
  method: string,
  body: Record<string, unknown>,
  tokenOverride?: string
): Promise<SlackApiResponse> {
  const token = tokenOverride || getBotToken();
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

// ---------------------------------------------------------------------------
// CSO (Sales Manager) Wrappers
// ---------------------------------------------------------------------------

/**
 * Resolve the Coaching / EOD Report Status channel ID.
 */
export function getCoachingChannel(): string {
  return process.env.SLACK_CHANNEL_COACHING || "";
}

/**
 * Get the dedicated coaching bot token (separate from the Sales Manager bot).
 */
function getCoachingBotToken(): string | null {
  const token = process.env.SLACK_BOT_TOKEN_COACHING;
  if (!token) {
    console.warn("[slack] SLACK_BOT_TOKEN_COACHING not set");
    return null;
  }
  return token;
}

/**
 * Post a rich message to the coaching channel using the dedicated coaching bot.
 */
export async function postToCoachingChannel(
  blocks: unknown[]
): Promise<boolean> {
  const channel = getCoachingChannel();
  const token = getCoachingBotToken();
  if (!channel || !token) {
    console.error("[slack] Coaching channel or token not configured");
    return false;
  }

  if (!blocks || blocks.length === 0) return false;

  const result = await slackPost(
    "chat.postMessage",
    {
      channel,
      text: "Coaching Bot notification",
      blocks,
      username: "CCOS Coaching Bot",
      icon_emoji: ":clipboard:",
    },
    token
  );

  return result.ok;
}

/**
 * Resolve the Sales Manager channel ID.
 * Falls back through available channel env vars.
 */
export function getSalesManagerChannel(): string {
  return (
    process.env.SLACK_CHANNEL_SALES_MANAGER ||
    process.env.SALES_BRAIN_CHANNEL_ID ||
    process.env.SLACK_USER_DM ||
    process.env.SLACK_CHANNEL_MARKETING ||
    ""
  );
}

/**
 * Post a message as the CSO to the #a-sales-manager channel.
 */
export async function postAsCso(
  text: string,
  options?: { threadTs?: string }
): Promise<boolean> {
  const channel = getSalesManagerChannel();
  if (!channel) {
    console.error("[slack] No sales-manager channel configured");
    return false;
  }

  const result = await slackPost("chat.postMessage", {
    channel,
    text,
    ...(options?.threadTs ? { thread_ts: options.threadTs } : {}),
    username: "Sales Brain",
    icon_emoji: ":brain:",
  });

  return result.ok;
}

/**
 * Upload a file (PDF etc.) as the CSO to the #a-sales-manager channel.
 */
export async function uploadFileAsCso(
  fileBuffer: Buffer,
  filename: string,
  title: string,
  initialComment?: string
): Promise<boolean> {
  const channel = getSalesManagerChannel();
  if (!channel) return false;
  return uploadFileToSlack(channel, fileBuffer, filename, title, initialComment);
}
