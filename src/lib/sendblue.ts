// SendBlue API client for the Sales Manager Hub
// Uses the legacy send endpoint for outbound messages and the v2 read endpoint
// for message history and response tracking.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SENDBLUE_SEND_BASE_URL = "https://api.sendblue.co/api";
// Reads must hit api.sendblue.COM — the .co host rejects /api/v2 reads with
// "Did not get inputs for authorization" (verified live 2026-08-23), which the
// catch below turned into silent empty threads.
const SENDBLUE_READ_BASE_URL = "https://api.sendblue.com/api/v2";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCredentials(): { apiKeyId: string; apiSecret: string } | null {
  const apiKeyId = process.env.SENDBLUE_API_KEY_ID;
  const apiSecret = process.env.SENDBLUE_API_SECRET_KEY;

  if (!apiKeyId || !apiSecret) {
    return null;
  }

  return { apiKeyId, apiSecret };
}

interface SendBlueResponse {
  status?: string;
  message?: string;
  error?: string;
  data?: SendBlueMessage[];
}

interface SendBlueMessage {
  content?: string;
  is_outbound?: boolean;
  date?: string;
  date_sent?: string;
  date_updated?: string;
  status?: string;
  from_number?: string;
  to_number?: string;
  number?: string;
  service?: string;
}

/**
 * Internal fetch wrapper with SendBlue auth headers.
 */
async function sendBlueFetch<T>(
  baseUrl: string,
  path: string,
  options?: RequestInit
): Promise<T> {
  const creds = getCredentials();
  if (!creds) {
    throw new Error(
      "SendBlue credentials not configured. " +
        "Set SENDBLUE_API_KEY_ID and SENDBLUE_API_SECRET_KEY environment variables."
    );
  }

  const url = `${baseUrl}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "sb-api-key-id": creds.apiKeyId,
      "sb-api-secret-key": creds.apiSecret,
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `SendBlue API error (HTTP ${response.status}) on ${path}: ${body.substring(0, 300)}`
    );
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if SendBlue is configured with valid credentials.
 *
 * @returns true if both SENDBLUE_API_KEY_ID and SENDBLUE_API_SECRET_KEY are set
 */
export function isSendBlueConfigured(): boolean {
  return getCredentials() !== null;
}

/**
 * Send a text message (iMessage/SMS) via SendBlue.
 *
 * @param to      - The recipient's phone number (E.164 format, e.g., "+15551234567")
 * @param content - The message content
 * @returns Object with success boolean and optional error message
 */
export async function sendMessage(
  to: string,
  content: string
): Promise<{ success: boolean; error?: string }> {
  if (!isSendBlueConfigured()) {
    return {
      success: false,
      error:
        "SendBlue is not configured. Set SENDBLUE_API_KEY_ID and SENDBLUE_API_SECRET_KEY.",
    };
  }

  if (!to || !content) {
    return {
      success: false,
      error: "Both 'to' (phone number) and 'content' (message) are required.",
    };
  }

  // Normalize phone number: ensure it starts with +
  const normalizedTo = to.startsWith("+") ? to : `+1${to.replace(/\D/g, "")}`;

  try {
    const data = await sendBlueFetch<SendBlueResponse>(
      SENDBLUE_SEND_BASE_URL,
      "/send-message",
      {
      method: "POST",
      body: JSON.stringify({
        number: normalizedTo,
        content,
      }),
      }
    );

    if (data.status === "QUEUED" || data.status === "SENT") {
      return { success: true };
    }

    return {
      success: false,
      error: data.error || data.message || "Unknown SendBlue error",
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error sending message";
    console.error("[sendblue] Send failed:", message);
    return { success: false, error: message };
  }
}

/**
 * Get messages for a phone number and determine if they responded.
 *
 * Returns whether the contact has sent any inbound messages (i.e., responded)
 * and the content of their most recent response.
 *
 * @param phoneNumber - The phone number to check (E.164 format)
 * @param opts        - Optional: { limit } — how many recent messages to pull
 *                      (default 25, the original behavior; the adherence
 *                      grader passes more to cover a whole booking window)
 * @returns Object with responded boolean and optional lastResponse text
 */
export async function getMessages(
  phoneNumber: string,
  opts?: { limit?: number }
): Promise<{
  responded: boolean;
  lastResponse?: string;
  messages: Array<{
    content: string;
    direction: "inbound" | "outbound";
    sentAt: string | null;
    fromNumber: string | null;
    toNumber: string | null;
    service: string | null;
    status: string | null;
  }>;
}> {
  if (!isSendBlueConfigured()) {
    // Graceful fallback when not configured — caller can check isSendBlueConfigured()
    return { responded: false, messages: [] };
  }

  if (!phoneNumber) {
    return { responded: false, messages: [] };
  }

  const normalizedNumber = phoneNumber.startsWith("+")
    ? phoneNumber
    : `+1${phoneNumber.replace(/\D/g, "")}`;

  const limit = Math.max(1, Math.min(100, Math.floor(opts?.limit ?? 25))) // SendBlue hard-caps limit at 100;

  try {
    const data = await sendBlueFetch<SendBlueResponse>(
      SENDBLUE_READ_BASE_URL,
      `/messages?number=${encodeURIComponent(normalizedNumber)}&limit=${limit}&order_by=date_sent&order_direction=desc`
    );

    const messages = Array.isArray(data.data) ? data.data : [];
    const normalizedMessages = messages.map((message) => ({
      content: message.content || "",
      direction: message.is_outbound ? "outbound" as const : "inbound" as const,
      sentAt: message.date_sent || message.date || null,
      fromNumber: message.from_number || null,
      toNumber: message.to_number || null,
      service: message.service || null,
      status: message.status || null,
    }));

    // Find inbound messages (not from us)
    const inboundMessages = normalizedMessages.filter((message) => message.direction === "inbound");

    if (inboundMessages.length === 0) {
      return { responded: false, messages: normalizedMessages };
    }

    // Sort by date descending and return the most recent
    inboundMessages.sort(
      (a, b) =>
        new Date(b.sentAt || 0).getTime() - new Date(a.sentAt || 0).getTime()
    );

    return {
      responded: true,
      lastResponse: inboundMessages[0].content,
      messages: normalizedMessages,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error fetching messages";
    console.error("[sendblue] getMessages failed:", message);
    // Fail open — return unknown state so callers can handle gracefully
    return { responded: false, messages: [] };
  }
}
