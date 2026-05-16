// Slack helper for the Daily Coacher digest bot.
//
// Uses SLACK_BOT_TOKEN_COACHING (the same coaching-team Slack bot that
// already powers EOD summary DMs etc.). Provides:
//   - lookupUserIdByEmail
//   - openDmChannel
//   - postMessage / postBlocks (with chat.postMessage)
//   - updateMessage (for in-place "Regenerate")
//   - verifyRequestSignature (for the interactions webhook)
//
// All functions are resilient: they log on failure and return null/false
// so callers can degrade gracefully without crashing the cron pipeline.

import { createHmac, timingSafeEqual } from "crypto";

const SLACK_API = "https://slack.com/api";
const COACHING_BOT_USERNAME = "Daily Coacher";
const COACHING_BOT_ICON = ":sparkles:";

/** Hardcoded: Ahmad/Saeed's Slack user ID. Used for new-coach onboarding
 *  pings. Matches the same constant in src/app/api/cron/eod-summary. */
export const ADMIN_SLACK_USER_ID = "U08FK5NPG9W";

function getToken(): string | null {
  const token = process.env.SLACK_BOT_TOKEN_COACHING;
  if (!token) {
    console.warn("[slack/coaching-bot] SLACK_BOT_TOKEN_COACHING not set; Slack send skipped");
    return null;
  }
  return token;
}

// ---------------------------------------------------------------------------
// User + DM
// ---------------------------------------------------------------------------

export async function lookupUserIdByEmail(email: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as { ok: boolean; user?: { id: string }; error?: string };
    if (!data.ok) {
      console.warn(`[slack/coaching-bot] users.lookupByEmail failed for ${email}:`, data.error);
      return null;
    }
    return data.user?.id ?? null;
  } catch (err) {
    console.warn(`[slack/coaching-bot] lookupUserIdByEmail threw for ${email}:`, err);
    return null;
  }
}

export async function openDmChannel(userId: string): Promise<string | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${SLACK_API}/conversations.open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ users: userId }),
    });
    const data = (await res.json()) as { ok: boolean; channel?: { id: string }; error?: string };
    if (!data.ok) {
      console.warn(`[slack/coaching-bot] conversations.open failed for ${userId}:`, data.error);
      return null;
    }
    return data.channel?.id ?? null;
  } catch (err) {
    console.warn(`[slack/coaching-bot] openDmChannel threw for ${userId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

export interface PostResult {
  ok: boolean;
  ts?: string;
  channel?: string;
  error?: string;
}

export async function postBlocks(
  channelId: string,
  blocks: unknown[],
  fallbackText: string
): Promise<PostResult> {
  const token = getToken();
  if (!token) return { ok: false, error: "no token" };
  try {
    const res = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: channelId,
        text: fallbackText,
        blocks,
        username: COACHING_BOT_USERNAME,
        icon_emoji: COACHING_BOT_ICON,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const data = (await res.json()) as PostResult;
    if (!data.ok) {
      console.error(`[slack/coaching-bot] chat.postMessage failed:`, data.error);
    }
    return data;
  } catch (err) {
    console.error(`[slack/coaching-bot] postBlocks threw:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function updateMessage(
  channelId: string,
  ts: string,
  blocks: unknown[],
  fallbackText: string
): Promise<PostResult> {
  const token = getToken();
  if (!token) return { ok: false, error: "no token" };
  try {
    const res = await fetch(`${SLACK_API}/chat.update`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: channelId,
        ts,
        text: fallbackText,
        blocks,
      }),
    });
    const data = (await res.json()) as PostResult;
    if (!data.ok) {
      console.error(`[slack/coaching-bot] chat.update failed:`, data.error);
    }
    return data;
  } catch (err) {
    console.error(`[slack/coaching-bot] updateMessage threw:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "unknown" };
  }
}

export async function openModal(triggerId: string, view: unknown): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const res = await fetch(`${SLACK_API}/views.open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger_id: triggerId, view }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) console.error("[slack/coaching-bot] views.open failed:", data.error);
    return data.ok;
  } catch (err) {
    console.error("[slack/coaching-bot] openModal threw:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Signature verification (for /api/slack/interactions)
// ---------------------------------------------------------------------------

/**
 * Verifies Slack's `X-Slack-Signature` against the request body using
 * SLACK_SIGNING_SECRET. Returns true on valid signature, false on
 * invalid/missing/expired (>5 min). Mirrors Slack's official algorithm.
 */
export function verifyRequestSignature(opts: {
  signingSecret: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  rawBody: string;
}): boolean {
  const { signingSecret, signatureHeader, timestampHeader, rawBody } = opts;
  if (!signingSecret || !signatureHeader || !timestampHeader) return false;

  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (ageSec > 5 * 60) return false; // reject replays

  const baseString = `v0:${ts}:${rawBody}`;
  const computed = "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

  // Constant-time compare
  const a = Buffer.from(computed);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
