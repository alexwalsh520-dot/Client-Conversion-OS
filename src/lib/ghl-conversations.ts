const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export interface GhlConversationDetails {
  id: string;
  contactId?: string | null;
  locationId?: string | null;
  channel?: string | null;
  raw: Record<string, unknown>;
}

export interface GhlConversationSearchResult {
  id: string;
  contactId?: string | null;
  locationId?: string | null;
  channel?: string | null;
  lastMessageDate?: string | null;
  raw: Record<string, unknown>;
}

export interface GhlConversationMessage {
  messageId: string;
  conversationId: string;
  contactId?: string | null;
  body: string;
  direction: "inbound" | "outbound" | "unknown";
  messageType?: string | null;
  channel?: string | null;
  sentAt?: string | null;
  raw: Record<string, unknown>;
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY not configured");

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: GHL_VERSION,
  };
}

async function ghlFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: getHeaders(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL request failed (${res.status}) ${path}: ${text}`);
  }

  return res.json() as Promise<T>;
}

async function searchConversations(
  params: Record<string, string | number | null | undefined>,
): Promise<GhlConversationSearchResult[]> {
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    query.set(key, String(value));
  }

  const response = await ghlFetch<Record<string, unknown>>(
    `/conversations/search?${query.toString()}`,
  );

  const list = Array.isArray(response.conversations)
    ? (response.conversations as unknown[])
    : Array.isArray(response.data)
      ? (response.data as unknown[])
      : [];

  return list
    .flatMap((item) => {
      const record = asRecord(item);
      const id = readString(record, ["id", "_id"]);
      if (!id) return [];

      return [{
        id,
        contactId: readString(record, ["contactId", "contact_id"]),
        locationId: readString(record, ["locationId", "location_id"]),
        channel: normalizeConversationChannel(record),
        lastMessageDate: readString(record, ["lastMessageDate", "dateUpdated", "dateAdded"]),
        raw: record,
      }];
    })
    .sort((a, b) => {
      const timeA = a.lastMessageDate ? new Date(a.lastMessageDate).getTime() : 0;
      const timeB = b.lastMessageDate ? new Date(b.lastMessageDate).getTime() : 0;
      return timeB - timeA;
    });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function normalizeDirection(record: Record<string, unknown>): "inbound" | "outbound" | "unknown" {
  const direction = readString(record, ["direction", "messageDirection", "directionType"]);
  if (direction) {
    const value = direction.toLowerCase();
    if (value.includes("inbound") || value === "received") return "inbound";
    if (value.includes("outbound") || value === "sent") return "outbound";
  }

  if (record.userId || record.assignedTo || record.userName) return "outbound";
  if (record.contactId || record.contact_id) return "inbound";
  return "unknown";
}

function normalizeTimestamp(record: Record<string, unknown>): string | null {
  return readString(record, [
    "dateAdded",
    "createdAt",
    "updatedAt",
    "sentAt",
    "created_at",
    "date_added",
  ]);
}

function normalizeBody(record: Record<string, unknown>): string {
  return (
    readString(record, ["body", "message", "text", "content", "htmlBody", "emailMessage"]) || ""
  );
}

function normalizeConversationChannel(record: Record<string, unknown>): string | null {
  const direct = readString(record, ["channel", "type", "providerType"]);
  if (direct) return direct;

  const lastMessageType = readString(record, ["lastMessageType", "messageType"]);
  if (!lastMessageType) return null;

  const value = lastMessageType.toLowerCase();
  if (value.includes("instagram")) return "Instagram DM";
  if (value.includes("facebook") || value.includes("messenger")) return "Facebook Messenger";
  if (value.includes("sms")) return "SMS";
  if (value.includes("email")) return "Email";
  if (value.includes("whatsapp")) return "WhatsApp";
  return lastMessageType;
}

export async function fetchConversation(conversationId: string): Promise<GhlConversationDetails> {
  const response = await ghlFetch<Record<string, unknown>>(`/conversations/${conversationId}`);
  const record = asRecord(response.conversation || response.data || response);

  return {
    id: readString(record, ["id", "_id"]) || conversationId,
    contactId: readString(record, ["contactId", "contact_id"]),
    locationId: readString(record, ["locationId", "location_id"]),
    channel: normalizeConversationChannel(record),
    raw: record,
  };
}

export async function searchConversationsByContact(
  contactId: string,
  locationId: string,
): Promise<GhlConversationSearchResult[]> {
  return searchConversations({
    locationId,
    contactId,
  });
}

export async function searchRecentConversations(
  locationId: string,
  options?: {
    limit?: number;
    page?: number;
  },
): Promise<GhlConversationSearchResult[]> {
  return searchConversations({
    locationId,
    limit: options?.limit ?? 100,
    page: options?.page ?? 1,
  });
}

export async function fetchConversationMessages(
  conversationId: string,
): Promise<GhlConversationMessage[]> {
  const response = await ghlFetch<Record<string, unknown> | unknown[]>(
    `/conversations/${conversationId}/messages`,
  );

  const list = Array.isArray(response)
    ? response
    : Array.isArray((response as Record<string, unknown>).messages)
      ? ((response as Record<string, unknown>).messages as unknown[])
      : Array.isArray((response as Record<string, unknown>).data)
        ? ((response as Record<string, unknown>).data as unknown[])
        : Array.isArray((response as Record<string, unknown>).conversationMessages)
          ? ((response as Record<string, unknown>).conversationMessages as unknown[])
          : [];

  return list
    .map((item, index) => {
      const record = asRecord(item);
      const messageId =
        readString(record, ["id", "_id", "messageId"]) ||
        `${conversationId}-${normalizeTimestamp(record) || "unknown"}-${index}`;

      return {
        messageId,
        conversationId,
        contactId: readString(record, ["contactId", "contact_id"]),
        body: normalizeBody(record),
        direction: normalizeDirection(record),
        messageType: readString(record, ["messageType", "type"]),
        channel: readString(record, ["channel", "providerType"]),
        sentAt: normalizeTimestamp(record),
        raw: record,
      };
    })
    .sort((a, b) => {
      const timeA = a.sentAt ? new Date(a.sentAt).getTime() : 0;
      const timeB = b.sentAt ? new Date(b.sentAt).getTime() : 0;
      return timeA - timeB;
    });
}
