import crypto from "node:crypto";
import { analyzeDmStages, getDmAnalysisVersion } from "@/lib/dm-stage-ai";
import { getServiceSupabase } from "@/lib/supabase";
import { cancelPendingAndAttributeReply } from "@/lib/followup/scheduler";

const INSTAGRAM_CHANNEL = "Instagram DM";
const DEFAULT_CLIENT_KEY = "matthew_conder";
const DEFAULT_SETTER_NAME = "Matthew Conder";

type MessageDirection = "inbound" | "outbound" | "unknown";

interface InstagramWebhookConfig {
  clientKey: string;
  setterName: string;
  verifyToken: string | null;
  appSecret: string | null;
  accountId: string | null;
  accountUsername: string | null;
}

interface ParsedInstagramMessage {
  client: string;
  subscriberId: string;
  setterName: string | null;
  conversationId: string;
  messageId: string;
  direction: MessageDirection;
  body: string | null;
  messageType: string | null;
  sentAt: string | null;
  rawPayload: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  const raw = asString(value);
  if (!raw) return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && raw.length >= 10) {
    return new Date(numeric).toISOString();
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function buildAttachmentSummary(message: Record<string, unknown> | null) {
  const attachments = asRecordArray(message?.attachments);
  if (attachments.length === 0) {
    return {
      body: null,
      messageType: null,
    };
  }

  const types = attachments
    .map((attachment) => asString(attachment.type) || "attachment")
    .filter(Boolean);

  return {
    body: `[${types.join(", ")}]`,
    messageType: types.join(", "),
  };
}

function getInstagramWebhookConfig(): InstagramWebhookConfig {
  return {
    clientKey: process.env.INSTAGRAM_DM_CLIENT_KEY?.trim() || DEFAULT_CLIENT_KEY,
    setterName: process.env.INSTAGRAM_DM_SETTER_NAME?.trim() || DEFAULT_SETTER_NAME,
    verifyToken: process.env.INSTAGRAM_DM_WEBHOOK_VERIFY_TOKEN?.trim() || null,
    appSecret: process.env.META_APP_SECRET?.trim() || null,
    accountId: process.env.INSTAGRAM_DM_ACCOUNT_ID?.trim() || null,
    accountUsername: process.env.INSTAGRAM_DM_ACCOUNT_USERNAME?.trim() || null,
  };
}

export function getInstagramWebhookStatus() {
  const config = getInstagramWebhookConfig();
  return {
    clientKey: config.clientKey,
    setterName: config.setterName,
    verifyTokenConfigured: Boolean(config.verifyToken),
    appSecretConfigured: Boolean(config.appSecret),
    accountIdConfigured: Boolean(config.accountId),
    accountUsername: config.accountUsername,
  };
}

export function validateInstagramWebhookChallenge(params: URLSearchParams) {
  const config = getInstagramWebhookConfig();
  const mode = params.get("hub.mode");
  const challenge = params.get("hub.challenge");
  const verifyToken = params.get("hub.verify_token");

  if (!mode && !challenge && !verifyToken) {
    return { matched: false as const };
  }

  if (mode !== "subscribe" || !challenge) {
    return { matched: true as const, ok: false as const, status: 400, body: "Invalid challenge" };
  }

  if (!config.verifyToken) {
    return { matched: true as const, ok: false as const, status: 500, body: "Verify token not configured" };
  }

  if (verifyToken !== config.verifyToken) {
    return { matched: true as const, ok: false as const, status: 403, body: "Invalid verify token" };
  }

  return { matched: true as const, ok: true as const, status: 200, body: challenge };
}

export function verifyInstagramWebhookSignature(rawBody: string, signatureHeader: string | null) {
  const config = getInstagramWebhookConfig();
  if (!config.appSecret) return true;
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", config.appSecret)
    .update(rawBody)
    .digest("hex");

  const received = signatureHeader.slice("sha256=".length);
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function summarizeMessageContent(message: Record<string, unknown> | null) {
  const text = asString(message?.text);
  if (text) {
    return {
      body: text,
      messageType: "text",
    };
  }

  return buildAttachmentSummary(message);
}

function resolveDirection(params: {
  event: Record<string, unknown>;
  message: Record<string, unknown> | null;
  entryAccountId: string | null;
  config: InstagramWebhookConfig;
}) {
  const { event, message, entryAccountId, config } = params;
  const senderId =
    asString(asRecord(event.sender)?.id) ||
    asString(asRecord(event.from)?.id) ||
    asString(event.from);
  const recipientId =
    asString(asRecord(event.recipient)?.id) ||
    asString(asRecord(event.to)?.id) ||
    asString(event.to);
  const messageIsEcho = Boolean(message?.is_echo);
  const accountId = config.accountId || entryAccountId;

  if (messageIsEcho) {
    return {
      direction: "outbound" as const,
      senderId,
      recipientId,
    };
  }

  if (accountId && senderId === accountId && recipientId) {
    return {
      direction: "outbound" as const,
      senderId,
      recipientId,
    };
  }

  if (accountId && recipientId === accountId && senderId) {
    return {
      direction: "inbound" as const,
      senderId,
      recipientId,
    };
  }

  if (entryAccountId && senderId === entryAccountId && recipientId) {
    return {
      direction: "outbound" as const,
      senderId,
      recipientId,
    };
  }

  if (entryAccountId && recipientId === entryAccountId && senderId) {
    return {
      direction: "inbound" as const,
      senderId,
      recipientId,
    };
  }

  return {
    direction: "unknown" as const,
    senderId,
    recipientId,
  };
}

function shouldKeepEvent(params: {
  senderId: string | null;
  recipientId: string | null;
  entryAccountId: string | null;
  config: InstagramWebhookConfig;
}) {
  const { senderId, recipientId, entryAccountId, config } = params;
  if (!config.accountId) return true;
  return [senderId, recipientId, entryAccountId].includes(config.accountId);
}

function buildParsedMessage(params: {
  event: Record<string, unknown>;
  message: Record<string, unknown> | null;
  entryAccountId: string | null;
  fallbackIndex: number;
  config: InstagramWebhookConfig;
}) {
  const { event, message, entryAccountId, fallbackIndex, config } = params;
  const sentAt =
    toIsoTimestamp(event.timestamp) ||
    toIsoTimestamp(message?.timestamp) ||
    new Date().toISOString();
  const { direction, senderId, recipientId } = resolveDirection({
    event,
    message,
    entryAccountId,
    config,
  });

  if (
    !shouldKeepEvent({
      senderId,
      recipientId,
      entryAccountId,
      config,
    })
  ) {
    return null;
  }

  const otherParticipantId =
    direction === "outbound"
      ? recipientId || senderId
      : direction === "inbound"
        ? senderId || recipientId
        : senderId === entryAccountId
          ? recipientId
          : recipientId === entryAccountId
            ? senderId
            : senderId || recipientId;

  const explicitConversationId =
    asString(asRecord(event.conversation)?.id) ||
    asString(asRecord(message?.conversation)?.id) ||
    asString(event.thread_id);
  const conversationId = explicitConversationId || `instagram:${otherParticipantId || "unknown"}`;
  const messageId =
    asString(message?.mid) ||
    asString(message?.id) ||
    `instagram:${conversationId}:${sentAt}:${fallbackIndex}`;
  const content = summarizeMessageContent(message);
  const subscriberId = otherParticipantId || `unknown:${conversationId}`;

  return {
    client: config.clientKey,
    subscriberId,
    setterName: config.setterName,
    conversationId,
    messageId,
    direction,
    body: content.body,
    messageType: content.messageType,
    sentAt,
    rawPayload: event,
  } satisfies ParsedInstagramMessage;
}

function extractParsedMessagesFromPayload(
  payload: Record<string, unknown>,
  config: InstagramWebhookConfig,
) {
  const parsed: ParsedInstagramMessage[] = [];
  const entries = asRecordArray(payload.entry);
  let fallbackIndex = 0;

  for (const entry of entries) {
    const entryAccountId = asString(entry.id);

    for (const messagingEvent of asRecordArray(entry.messaging)) {
      const message = asRecord(messagingEvent.message);
      if (!message || message.is_deleted === true) continue;

      const parsedMessage = buildParsedMessage({
        event: messagingEvent,
        message,
        entryAccountId,
        fallbackIndex,
        config,
      });

      fallbackIndex += 1;
      if (parsedMessage) parsed.push(parsedMessage);
    }

    for (const change of asRecordArray(entry.changes)) {
      const field = asString(change.field);
      if (field && !["messages", "messaging", "comments"].includes(field)) {
        continue;
      }

      const value = asRecord(change.value);
      if (!value) continue;

      const nestedMessages = asRecordArray(value.messages);
      if (nestedMessages.length > 0) {
        for (const nestedMessage of nestedMessages) {
          const parsedMessage = buildParsedMessage({
            event: {
              ...value,
              message: nestedMessage,
            },
            message: nestedMessage,
            entryAccountId,
            fallbackIndex,
            config,
          });

          fallbackIndex += 1;
          if (parsedMessage) parsed.push(parsedMessage);
        }
        continue;
      }

      const directMessage = asRecord(value.message) || value;
      const parsedMessage = buildParsedMessage({
        event: value,
        message: directMessage,
        entryAccountId,
        fallbackIndex,
        config,
      });

      fallbackIndex += 1;
      if (parsedMessage) parsed.push(parsedMessage);
    }
  }

  const deduped = new Map<string, ParsedInstagramMessage>();
  for (const message of parsed) {
    deduped.set(message.messageId, message);
  }

  return [...deduped.values()];
}

function buildTranscript(
  messages: Array<{
    body: string | null;
    direction: string | null;
    sent_at: string | null;
  }>,
) {
  return messages
    .filter((message) => asString(message.body))
    .slice(-40)
    .map((message) => {
      const speaker =
        message.direction === "inbound"
          ? "Prospect"
          : message.direction === "outbound"
            ? "Setter"
            : "Unknown";
      const timestamp = message.sent_at ? ` (${message.sent_at})` : "";
      return `${speaker}${timestamp}: ${message.body?.trim()}`;
    })
    .join("\n");
}

function latestTimestamp(messages: Array<{ sent_at: string | null }>) {
  const values = messages
    .map((message) => message.sent_at)
    .filter((value): value is string => Boolean(value))
    .sort();

  return values.at(-1) || null;
}

async function reclassifyConversation(
  conversationId: string,
  metadata: Pick<ParsedInstagramMessage, "client" | "subscriberId" | "setterName">,
) {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("dm_conversation_messages")
    .select("body, direction, sent_at")
    .eq("client", metadata.client)
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load Instagram DM thread: ${error.message}`);
  }

  const messages = data || [];
  const transcript = buildTranscript(messages);
  const latestMessageAt = latestTimestamp(messages);
  const classification = transcript ? await analyzeDmStages(transcript) : null;

  const { error: upsertError } = await sb.from("dm_conversation_stage_state").upsert(
    {
      client: metadata.client,
      subscriber_id: metadata.subscriberId,
      setter_name: metadata.setterName,
      contact_id: null,
      conversation_id: conversationId,
      // The dashboard funnel only uses `in_discovery` now. Legacy columns are
      // written as false and ignored by getMetrics. See src/lib/dm-stage-ai.ts.
      goal_clear: classification?.in_discovery || false,
      gap_clear: false,
      stakes_clear: false,
      qualified: false,
      booking_readiness_score: classification?.booking_readiness_score || 0,
      ai_confidence: classification?.ai_confidence || 0,
      stage_evidence: classification?.stage_evidence || null,
      raw_classification: classification,
      analysis_version: getDmAnalysisVersion(),
      latest_message_at: latestMessageAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" },
  );

  if (upsertError) {
    throw new Error(`Failed to update Instagram DM stage state: ${upsertError.message}`);
  }
}

export async function processInstagramWebhookPayload(payload: Record<string, unknown>) {
  const config = getInstagramWebhookConfig();
  const messages = extractParsedMessagesFromPayload(payload, config);

  if (messages.length === 0) {
    return {
      storedMessages: 0,
      conversations: 0,
      messageIds: [] as string[],
    };
  }

  const sb = getServiceSupabase();
  const payloadRows = messages.map((message) => ({
    client: message.client,
    subscriber_id: message.subscriberId,
    setter_name: message.setterName,
    contact_id: null,
    conversation_id: message.conversationId,
    message_id: message.messageId,
    direction: message.direction,
    channel: INSTAGRAM_CHANNEL,
    message_type: message.messageType,
    body: message.body,
    sent_at: message.sentAt,
    raw_payload: message.rawPayload,
  }));

  const { error } = await sb
    .from("dm_conversation_messages")
    .upsert(payloadRows, { onConflict: "message_id" });

  if (error) {
    throw new Error(`Failed to store Instagram DM messages: ${error.message}`);
  }

  const conversationMap = new Map<
    string,
    Pick<ParsedInstagramMessage, "client" | "subscriberId" | "setterName">
  >();
  for (const message of messages) {
    conversationMap.set(message.conversationId, {
      client: message.client,
      subscriberId: message.subscriberId,
      setterName: message.setterName,
    });
  }

  for (const [conversationId, metadata] of conversationMap.entries()) {
    await reclassifyConversation(conversationId, metadata);
  }

  // AI Follow-Up: when an inbound message arrives, cancel all pending
  // scheduled follow-ups for that subscriber and attribute the reply to
  // the most recent send (if any) for split-test accounting.
  for (const message of messages) {
    if (message.direction !== "inbound") continue;
    try {
      await cancelPendingAndAttributeReply({
        subscriberId: message.subscriberId,
        replyText: message.body,
        receivedAt: message.sentAt || new Date().toISOString(),
      });
    } catch (err) {
      // Non-fatal — log and continue. We never want follow-up cancellation
      // failures to break the inbound message storage pipeline.
      console.error("[followup] cancelPendingAndAttributeReply failed:", err);
    }
  }

  return {
    storedMessages: payloadRows.length,
    conversations: conversationMap.size,
    messageIds: payloadRows.map((row) => row.message_id),
  };
}
