// Fathom AI API client for the Sales Manager Hub
// Fetches meeting recordings, transcripts, and summaries
// Docs: https://fathom.video/api (external v1)

import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FathomAttendee {
  name: string;
  email: string;
  is_external: boolean;
}

export interface FathomTranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface FathomMeeting {
  id: string;
  title: string;
  meeting_title?: string;
  url: string;
  created_at: string;
  calendar_invitees: FathomAttendee[];
  transcript?: FathomTranscriptSegment[];
  default_summary?: string;
  share_url?: string;
  recording_id?: number;
  recorded_by?: { name: string; email: string };
}

interface FathomListResponse {
  items: FathomMeeting[];
  has_more?: boolean;
  next_cursor?: string;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const FATHOM_BASE_URL = "https://api.fathom.ai/external/v1";

function getApiKey(): string {
  const key = process.env.FATHOM_API_KEY;
  if (!key) {
    throw new Error(
      "Missing environment variable FATHOM_API_KEY. " +
        "Set it to your Fathom AI API key to enable meeting transcript features."
    );
  }
  return key;
}

/**
 * Internal fetch wrapper with auth and error handling.
 */
async function fathomFetch<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const apiKey = getApiKey();
  const url = `${FATHOM_BASE_URL}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Fathom API error (HTTP ${response.status}) on ${path}: ${body.substring(0, 300)}`
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List meetings from Fathom with optional date range filtering.
 *
 * @param opts.createdAfter  - Only meetings created after this ISO date
 * @param opts.createdBefore - Only meetings created before this ISO date
 * @param opts.includeTranscript - If true, fetch full transcript for each meeting
 * @returns Array of FathomMeeting objects
 */
export async function listMeetings(opts?: {
  createdAfter?: string;
  createdBefore?: string;
  includeTranscript?: boolean;
}): Promise<FathomMeeting[]> {
  // If API key is not set, return empty array gracefully
  if (!process.env.FATHOM_API_KEY) {
    console.warn(
      "[fathom] FATHOM_API_KEY not set — returning empty meeting list"
    );
    return [];
  }

  const params = new URLSearchParams();
  if (opts?.createdAfter) {
    params.set("created_after", opts.createdAfter);
  }
  if (opts?.createdBefore) {
    params.set("created_before", opts.createdBefore);
  }

  const queryString = params.toString();
  const path = `/meetings${queryString ? `?${queryString}` : ""}`;

  // Paginate through all results
  const allMeetings: FathomMeeting[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const paginatedPath = cursor
      ? `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`
      : path;

    const data = await fathomFetch<FathomListResponse>(paginatedPath);
    const meetings = data.items || [];
    allMeetings.push(...meetings);

    hasMore = meetings.length > 0 && !!data.next_cursor;
    cursor = data.next_cursor;
  }

  // Optionally enrich with transcripts
  if (opts?.includeTranscript) {
    await Promise.all(
      allMeetings.map(async (meeting) => {
        try {
          const transcriptData = await fathomFetch<{
            segments: FathomTranscriptSegment[];
          }>(`/meetings/${meeting.id}/transcript`);
          meeting.transcript = transcriptData.segments || [];
        } catch (err) {
          console.warn(
            `[fathom] Failed to fetch transcript for meeting ${meeting.id}:`,
            err
          );
          meeting.transcript = [];
        }
      })
    );
  }

  return allMeetings;
}

/**
 * Get the full transcript for a specific meeting as a formatted string.
 *
 * @param meetingId - The Fathom meeting ID
 * @returns Formatted transcript string with speaker labels and timestamps
 */
export async function getMeetingTranscript(meetingId: string): Promise<string> {
  if (!meetingId) {
    throw new Error("meetingId is required");
  }

  const data = await fathomFetch<{
    segments: FathomTranscriptSegment[];
  }>(`/meetings/${meetingId}/transcript`);

  const segments = data.segments || [];
  if (segments.length === 0) {
    return "(No transcript available)";
  }

  return segments
    .map((seg) => {
      const mins = Math.floor(seg.timestamp / 60);
      const secs = Math.floor(seg.timestamp % 60);
      const ts = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
      return `[${ts}] ${seg.speaker}: ${seg.text}`;
    })
    .join("\n");
}

/**
 * Validate an incoming Fathom webhook request.
 *
 * Fathom signs webhooks using HMAC-SHA256 with the webhook secret.
 * Fathom follows the Standard Webhooks spec, so all four of these matter:
 *   - headers are `webhook-id` / `webhook-timestamp` / `webhook-signature`
 *     (NOT `x-fathom-*`)
 *   - the secret is `whsec_<base64>`; the part after the prefix is base64
 *     DECODED to get the HMAC key
 *   - the digest is base64, not hex
 *   - `webhook-signature` is a space-delimited list of versioned signatures
 *     (`v1,<sig> v1,<sig>`) — during a secret rotation more than one is sent,
 *     so a match against ANY entry is valid
 *
 * The signature is computed over: `${webhookId}.${timestamp}.${body}`
 *
 * @param body      - Raw request body string (pre-JSON.parse)
 * @param signature - The `webhook-signature` header value
 * @param webhookId - The `webhook-id` header value
 * @param timestamp - The `webhook-timestamp` header value (unix seconds)
 * @returns true if the signature is valid
 */
export function validateFathomWebhook(
  body: string,
  signature: string,
  webhookId: string,
  timestamp: string
): boolean {
  const secret = process.env.FATHOM_WEBHOOK_SECRET;
  if (!secret) {
    console.error(
      "[fathom] FATHOM_WEBHOOK_SECRET not set — cannot validate webhook"
    );
    return false;
  }

  if (!body || !signature || !webhookId || !timestamp) {
    return false;
  }

  // Reject timestamps outside a 5-minute window to prevent replay attacks
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  const MAX_AGE_SECONDS = 300;
  if (Math.abs(now - ts) > MAX_AGE_SECONDS) {
    console.warn("[fathom] Webhook timestamp too old or in the future");
    return false;
  }

  // `whsec_` prefix is optional in the stored value; the remainder is base64.
  const rawSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(rawSecret, "base64");
  } catch {
    console.error("[fathom] FATHOM_WEBHOOK_SECRET is not valid base64");
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac("sha256", key)
    .update(`${webhookId}.${timestamp}.${body}`)
    .digest();

  // Header is a space-delimited list like "v1,<base64> v1,<base64>".
  for (const entry of signature.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma === -1) continue;
    if (entry.slice(0, comma) !== "v1") continue;

    let provided: Buffer;
    try {
      provided = Buffer.from(entry.slice(comma + 1), "base64");
    } catch {
      continue;
    }
    // timingSafeEqual throws on length mismatch, so gate on it first.
    if (provided.length !== expected.length) continue;
    if (timingSafeEqual(provided, expected)) return true;
  }

  return false;
}
