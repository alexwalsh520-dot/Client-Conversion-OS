import { syncManychatEventToGhl } from "@/lib/ghl-dm-sync";
import type { GhlConversationMessage } from "@/lib/ghl-conversations";
import { getServiceSupabase } from "@/lib/supabase";

type DetectedLinkTag = "call_link_sent" | "sub_link_sent" | "challenge_link_sent";

interface DetectedLinkEvent {
  tagName: DetectedLinkTag;
  messageId: string;
  eventAt: string | null;
  matchedUrl: string | null;
}

const DEFAULT_BOOKING_LINK_PATTERNS = [
  "leadconnectorhq.com/widget/booking",
  "msgsndr.com/widget/booking",
  "calendly.com",
  "cal.com",
  "/widget/booking/",
  "/booking/",
  "/schedule/",
];

const DEFAULT_SUB_LINK_PATTERNS = [
  "buy.stripe.com",
  "checkout.stripe.com",
  "billing.stripe.com",
  "stripe.link",
];

// Challenge link = the free-challenge school link we drop early in the funnel.
// URL-only match (no text-hint fallback) so the word "challenge" in chat never
// tags the stage by itself.
const DEFAULT_CHALLENGE_LINK_PATTERNS = [
  "skool.com",
];

const BOOKING_TEXT_HINTS = [
  "book",
  "booking",
  "schedule",
  "calendar",
  "strategy call",
  "call with",
];

const SUBSCRIPTION_TEXT_HINTS = [
  "stripe",
  "checkout",
  "subscription",
  "subscribe",
  "payment",
  "join the community",
];

function getPatterns(envName: string, defaults: string[]): string[] {
  const raw = process.env[envName];
  if (!raw?.trim()) return defaults;

  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeText(value: string | null | undefined): string {
  return value?.trim().toLowerCase() || "";
}

function extractUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) || [];
  return matches.map((match) => match.replace(/[.,!?]+$/, ""));
}

function collectUrls(value: unknown, results: Set<string>, keyHint = "", depth = 0) {
  if (depth > 6 || value === null || value === undefined) return;

  if (typeof value === "string") {
    const lowerHint = keyHint.toLowerCase();
    if (
      value.includes("http://") ||
      value.includes("https://") ||
      lowerHint.includes("url") ||
      lowerHint.includes("link") ||
      lowerHint.includes("href")
    ) {
      for (const url of extractUrlsFromText(value)) {
        results.add(url);
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, results, keyHint, depth + 1);
    return;
  }

  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      collectUrls(nested, results, key, depth + 1);
    }
  }
}

function getMessageUrls(message: GhlConversationMessage): string[] {
  const urls = new Set<string>();

  for (const url of extractUrlsFromText(message.body || "")) {
    urls.add(url);
  }

  collectUrls(message.raw, urls);
  return [...urls];
}

function matchesPattern(url: string, patterns: string[]): boolean {
  const value = normalizeText(url);
  return patterns.some((pattern) => value.includes(pattern));
}

function hasAnyHint(body: string, hints: string[]): boolean {
  return hints.some((hint) => body.includes(hint));
}

function classifyMessage(message: GhlConversationMessage): DetectedLinkEvent | null {
  if (message.direction !== "outbound") return null;

  const urls = getMessageUrls(message);
  if (urls.length === 0) return null;

  const body = normalizeText(message.body);
  const bookingPatterns = getPatterns("DM_BOOKING_LINK_PATTERNS", DEFAULT_BOOKING_LINK_PATTERNS);
  const subPatterns = getPatterns("DM_SUBSCRIPTION_LINK_PATTERNS", DEFAULT_SUB_LINK_PATTERNS);
  const challengePatterns = getPatterns(
    "DM_CHALLENGE_LINK_PATTERNS",
    DEFAULT_CHALLENGE_LINK_PATTERNS,
  );

  const matchedSubUrl = urls.find((url) => matchesPattern(url, subPatterns)) || null;
  if (matchedSubUrl || hasAnyHint(body, SUBSCRIPTION_TEXT_HINTS)) {
    return {
      tagName: "sub_link_sent",
      messageId: message.messageId,
      eventAt: message.sentAt || null,
      matchedUrl: matchedSubUrl || urls[0] || null,
    };
  }

  // Challenge link comes before booking in the funnel, so prefer it when
  // the message carries a skool.com URL. URL-only match, no text hints.
  const matchedChallengeUrl =
    urls.find((url) => matchesPattern(url, challengePatterns)) || null;
  if (matchedChallengeUrl) {
    return {
      tagName: "challenge_link_sent",
      messageId: message.messageId,
      eventAt: message.sentAt || null,
      matchedUrl: matchedChallengeUrl,
    };
  }

  const matchedBookingUrl = urls.find((url) => matchesPattern(url, bookingPatterns)) || null;
  if (matchedBookingUrl || hasAnyHint(body, BOOKING_TEXT_HINTS)) {
    return {
      tagName: "call_link_sent",
      messageId: message.messageId,
      eventAt: message.sentAt || null,
      matchedUrl: matchedBookingUrl || urls[0] || null,
    };
  }

  return null;
}

async function hasExistingEvent(
  client: string,
  subscriberId: string,
  tagName: DetectedLinkTag,
  eventAt: string | null,
): Promise<boolean> {
  const sb = getServiceSupabase();
  let query = sb
    .from("manychat_tag_events")
    .select("id")
    .eq("client", client)
    .eq("subscriber_id", subscriberId)
    .eq("tag_name", tagName)
    .limit(1);

  if (eventAt) {
    query = query.eq("event_at", eventAt);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to check existing detected event: ${error.message}`);
  }

  return Boolean(data?.length);
}

async function insertDetectedEvent(params: {
  client: string;
  subscriberId: string;
  setterName: string | null;
  instagramHandle?: string | null;
  event: DetectedLinkEvent;
}) {
  const { client, subscriberId, setterName, instagramHandle, event } = params;
  const sb = getServiceSupabase();
  const normalizedEventAt = event.eventAt || new Date().toISOString();

  const { error } = await sb.from("manychat_tag_events").insert({
    subscriber_id: subscriberId,
    subscriber_name: null,
    tag_name: event.tagName,
    client,
    setter_name: setterName,
    event_at: normalizedEventAt,
  });

  if (error) {
    throw new Error(`Failed to insert detected link event: ${error.message}`);
  }

  await syncManychatEventToGhl({
    subscriberId,
    firstName: null,
    lastName: null,
    instagramHandle: instagramHandle || null,
    tagName: event.tagName,
    client,
    setterName,
    eventAt: normalizedEventAt,
  });
}

export async function ensureTrackedOutboundLinkEvents(params: {
  client: string;
  subscriberId: string;
  setterName: string | null;
  instagramHandle?: string | null;
  messages: GhlConversationMessage[];
}) {
  const { client, subscriberId, setterName, instagramHandle, messages } = params;
  const detected = messages
    .map((message) => classifyMessage(message))
    .filter((event): event is DetectedLinkEvent => Boolean(event));

  const created: DetectedLinkEvent[] = [];

  for (const event of detected) {
    const exists = await hasExistingEvent(client, subscriberId, event.tagName, event.eventAt);
    if (exists) continue;

    await insertDetectedEvent({
      client,
      subscriberId,
      setterName,
      instagramHandle,
      event,
    });

    created.push(event);
  }

  return { detected, created };
}
