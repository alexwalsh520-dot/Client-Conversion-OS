import { searchDuplicateContact } from "@/lib/ghl";
import { fetchConversationMessages } from "@/lib/ghl-conversations";
import type {
  OutreachDashboardResponse,
  OutreachRange,
} from "@/lib/outreach-dashboard-types";

const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const EMAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const DM_CACHE_TTL_MS = 2 * 60 * 1000;
const EMAIL_CONTACT_CACHE_TTL_MS = 30 * 60 * 1000;
const EMAIL_CONTACT_LOOKUP_CONCURRENCY = 10;
const DM_MESSAGE_FETCH_CONCURRENCY = 8;
const DM_CONV_PAGE_SIZE = 100;
const DM_MAX_CONVERSATIONS_IN_RANGE = 1500;

type ReplyIntent = "interested" | "not_interested" | "neutral" | "system";

interface SmartleadLeadHistoryEvent {
  type?: string;
  time?: string;
  email_body?: string;
  email_seq_number?: string | number;
}

interface SmartleadLeadStatisticsRow {
  to?: string;
  history?: SmartleadLeadHistoryEvent[];
}

interface SmartleadLeadStatisticsResponse {
  hasMore?: boolean;
  data?: SmartleadLeadStatisticsRow[];
  limit?: number;
}

interface GhlConversationListItem {
  id: string;
  contactId: string | null;
  lastMessageDateMs: number | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastMessageBody: string | null;
}

interface DmMessageRow {
  conversationId: string;
  contactId: string | null;
  direction: "inbound" | "outbound" | "unknown";
  body: string;
  sentAt: string | null;
}

interface EmailLeadSummary {
  email: string;
  personId: string;
  sentTimes: string[];
  humanReplyTimes: string[];
  classification: ReplyIntent;
  firstHumanReplyAt: string | null;
  followUpsToFirstReply: number | null;
}

interface DmThreadSummary {
  threadId: string;
  personId: string;
  outboundTimes: string[];
  inboundTimes: string[];
  classification: ReplyIntent;
  firstReplyAt: string | null;
  followUpsToFirstReply: number | null;
}

interface DmSourceConfig {
  enabled: boolean;
  label: string;
  description: string;
  locationId: string | null;
}

interface DmDataset {
  conversations: GhlConversationListItem[];
  messagesByConversation: Map<string, DmMessageRow[]>;
  totalConversationsAllTime: number;
  rangeStartMs: number;
  rangeEndMs: number;
}

let emailDatasetCache:
  | {
      expiresAt: number;
      data: SmartleadLeadStatisticsRow[];
    }
  | null = null;
let emailDatasetPromise: Promise<SmartleadLeadStatisticsRow[]> | null = null;

let dmDatasetCache:
  | {
      expiresAt: number;
      rangeKey: string;
      data: DmDataset;
    }
  | null = null;
let dmDatasetPromise: Promise<DmDataset> | null = null;

const emailContactCache = new Map<
  string,
  { expiresAt: number; contactId: string | null }
>();

const SYSTEM_REPLY_PATTERNS = [
  "message blocked",
  "address not found",
  "delivery incomplete",
  "wasn't delivered",
  "was not delivered",
  "automated message",
  "this is an automated message",
  "out of office",
  "away from the office",
  "delivery status notification",
  "message rejected",
  "temporary problem delivering",
  "temporarily problem delivering",
  "mailer-daemon",
  "updated my business contact email",
  "please email support@",
];

const NOT_INTERESTED_PATTERNS = [
  "not interested",
  "no interest",
  "no thanks",
  "not for me",
  "not a fit",
  "not looking",
  "remove me",
  "unsubscribe",
  "stop emailing",
  "stop messaging",
  "already have a coach",
  "already working with",
  "no desire",
  "don't want",
  "do not want",
  "wouldn't be interested",
  "deceiving my audience",
];

const INTERESTED_PATTERNS = [
  "interested",
  "sounds interesting",
  "very interesting",
  "hear more",
  "tell me more",
  "would like to hear more",
  "how it could fit",
  "fit me",
  "how does it work",
  "how it works",
  "what does that look like",
  "what does it cost",
  "how much",
  "pricing",
  "price",
  "set up a call",
  "hop on a call",
  "hop in the call",
  "ready to hop in the call",
  "ready to hop in",
  "ready to chat",
  "send a direct link",
  "do we set up a call",
  "would like to learn more",
  "would love to learn more",
  "questions",
];

const DM_NOT_INTERESTED_PATTERNS = [
  "not interested",
  "no thanks",
  "i'm good",
  "im good",
  "already have",
  "already working with",
  "leave me alone",
  "don't message",
  "do not message",
  "stop messaging",
  "pass on this",
  "not for me",
];

function getSmartleadApiKey() {
  const apiKey = process.env.SMARTLEAD_API_KEY;
  if (!apiKey) throw new Error("SMARTLEAD_API_KEY not configured");
  return apiKey;
}

function getSmartleadCampaignId() {
  const campaignId = process.env.SMARTLEAD_CAMPAIGN_ID;
  if (!campaignId) throw new Error("SMARTLEAD_CAMPAIGN_ID not configured");
  return campaignId;
}

function normalizeText(value: string | null | undefined) {
  return (value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dateKeyFromTimestamp(timestamp: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
}

function dateLabelFromKey(dateKey: string, timeZone: string) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
  }).format(date);
}

function isDateKeyInRange(dateKey: string, startDate: string, endDate: string) {
  return dateKey >= startDate && dateKey <= endDate;
}

function toPercent(numerator: number, denominator: number) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function classifyEmailReply(body: string): ReplyIntent {
  const text = normalizeText(body);
  if (!text) return "neutral";
  if (SYSTEM_REPLY_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "system";
  }
  if (NOT_INTERESTED_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "not_interested";
  }
  if (INTERESTED_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "interested";
  }
  return "neutral";
}

const DM_INTERESTED_PATTERNS = [
  "interested",
  "tell me more",
  "hear more",
  "how does it work",
  "how it works",
  "how much",
  "pricing",
  "price",
  "sounds good",
  "let's chat",
  "lets chat",
  "set up a call",
  "hop on a call",
  "book a call",
  "send the link",
  "send me the link",
  "send me a link",
  "yes please",
  "sign me up",
];

function classifyDmReply(inboundBodies: string[]): ReplyIntent {
  const text = normalizeText(inboundBodies.join(" "));
  if (!text) return "neutral";
  if (DM_NOT_INTERESTED_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "not_interested";
  }
  if (DM_INTERESTED_PATTERNS.some((pattern) => text.includes(pattern))) {
    return "interested";
  }
  return "neutral";
}

function getDmSourceConfig(): DmSourceConfig {
  const locationId =
    process.env.OUTREACH_DM_LOCATION_ID?.trim() ||
    process.env.GHL_LOCATION_ID?.trim() ||
    null;
  const apiKey = process.env.GHL_API_KEY?.trim() || null;

  if (!locationId || !apiKey) {
    return {
      enabled: false,
      label: "DM source not connected",
      description:
        "GHL_API_KEY and GHL_LOCATION_ID (or OUTREACH_DM_LOCATION_ID) must be set for live Instagram DM numbers.",
      locationId: null,
    };
  }

  const label = process.env.OUTREACH_DM_SOURCE_NAME?.trim() || "GHL Instagram DMs";

  return {
    enabled: true,
    label,
    description: `Live from ${label} on GHL location ${locationId}.`,
    locationId,
  };
}

async function fetchSmartleadLeadStatisticsPage(offset: number) {
  const apiKey = getSmartleadApiKey();
  const campaignId = getSmartleadCampaignId();
  const res = await fetch(
    `${SMARTLEAD_BASE}/campaigns/${campaignId}/leads-statistics?api_key=${apiKey}&limit=100&offset=${offset}`,
    { cache: "no-store" },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Smartlead leads-statistics failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<SmartleadLeadStatisticsResponse>;
}

async function getEmailDataset() {
  if (emailDatasetCache && emailDatasetCache.expiresAt > Date.now()) {
    return emailDatasetCache.data;
  }
  if (emailDatasetPromise) return emailDatasetPromise;

  emailDatasetPromise = (async () => {
    try {
      let offset = 0;
      const rows: SmartleadLeadStatisticsRow[] = [];

      while (true) {
        const page = await fetchSmartleadLeadStatisticsPage(offset);
        const pageRows = page.data || [];
        rows.push(...pageRows);

        if (!page.hasMore) break;
        offset += page.limit || 100;
      }

      emailDatasetCache = {
        expiresAt: Date.now() + EMAIL_CACHE_TTL_MS,
        data: rows,
      };
      return rows;
    } finally {
      emailDatasetPromise = null;
    }
  })();

  return emailDatasetPromise;
}

async function ghlFetchJson<T>(path: string): Promise<T> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY not configured");

  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

interface GhlConversationSearchResponse {
  conversations?: Array<Record<string, unknown>>;
  total?: number;
}

function parseLastMessageDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 1_000_000_000) return asNumber;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function parseDirection(value: unknown): "inbound" | "outbound" | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v.includes("inbound") || v === "received") return "inbound";
  if (v.includes("outbound") || v === "sent") return "outbound";
  return null;
}

async function listInstagramConversationsInRange(
  locationId: string,
  rangeStartMs: number,
): Promise<{ items: GhlConversationListItem[]; totalAllTime: number }> {
  const items: GhlConversationListItem[] = [];
  let totalAllTime = 0;
  let startAfterDate: number | undefined;

  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams({
      locationId,
      lastMessageType: "TYPE_INSTAGRAM",
      limit: String(DM_CONV_PAGE_SIZE),
    });
    if (startAfterDate !== undefined) {
      params.set("startAfterDate", String(startAfterDate));
    }

    const data = await ghlFetchJson<GhlConversationSearchResponse>(
      `/conversations/search?${params.toString()}`,
    );

    if (page === 0) totalAllTime = typeof data.total === "number" ? data.total : 0;

    const rows = data.conversations || [];
    if (rows.length === 0) break;

    let stop = false;
    let lastDateOnPage: number | null = null;

    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) continue;

      const lastMessageDateMs = parseLastMessageDate(row.lastMessageDate);
      if (lastMessageDateMs !== null) lastDateOnPage = lastMessageDateMs;

      if (lastMessageDateMs !== null && lastMessageDateMs < rangeStartMs) {
        stop = true;
        break;
      }

      items.push({
        id,
        contactId: typeof row.contactId === "string" ? row.contactId : null,
        lastMessageDateMs,
        lastMessageDirection: parseDirection(row.lastMessageDirection),
        lastMessageBody: typeof row.lastMessageBody === "string" ? row.lastMessageBody : null,
      });

      if (items.length >= DM_MAX_CONVERSATIONS_IN_RANGE) {
        stop = true;
        break;
      }
    }

    if (stop) break;
    if (rows.length < DM_CONV_PAGE_SIZE) break;
    if (lastDateOnPage === null) break;
    startAfterDate = lastDateOnPage;
  }

  return { items, totalAllTime };
}

async function getDmDataset(
  dmSource: DmSourceConfig,
  range: OutreachRange,
): Promise<DmDataset> {
  const rangeStartMs = Date.parse(`${range.startDate}T00:00:00Z`);
  const rangeEndMs = Date.parse(`${range.endDate}T23:59:59Z`);
  const rangeKey = `${range.startDate}_${range.endDate}`;

  if (!dmSource.enabled || !dmSource.locationId) {
    return {
      conversations: [],
      messagesByConversation: new Map(),
      totalConversationsAllTime: 0,
      rangeStartMs,
      rangeEndMs,
    };
  }

  if (
    dmDatasetCache &&
    dmDatasetCache.rangeKey === rangeKey &&
    dmDatasetCache.expiresAt > Date.now()
  ) {
    return dmDatasetCache.data;
  }
  if (dmDatasetPromise) return dmDatasetPromise;

  dmDatasetPromise = (async () => {
    try {
      const { items, totalAllTime } = await listInstagramConversationsInRange(
        dmSource.locationId!,
        rangeStartMs,
      );

      const messagesByConversation = new Map<string, DmMessageRow[]>();

      await mapWithConcurrency(items, DM_MESSAGE_FETCH_CONCURRENCY, async (conv) => {
        try {
          const messages = await fetchConversationMessages(conv.id);
          messagesByConversation.set(
            conv.id,
            messages.map((message) => ({
              conversationId: conv.id,
              contactId: conv.contactId || message.contactId || null,
              direction: message.direction,
              body: message.body,
              sentAt: message.sentAt ?? null,
            })),
          );
        } catch {
          messagesByConversation.set(conv.id, []);
        }
      });

      const data: DmDataset = {
        conversations: items,
        messagesByConversation,
        totalConversationsAllTime: totalAllTime,
        rangeStartMs,
        rangeEndMs,
      };

      dmDatasetCache = {
        expiresAt: Date.now() + DM_CACHE_TTL_MS,
        rangeKey,
        data,
      };

      return data;
    } finally {
      dmDatasetPromise = null;
    }
  })();

  return dmDatasetPromise;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
) {
  if (items.length === 0) return [] as R[];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (true) {
        const current = nextIndex++;
        if (current >= items.length) return;
        results[current] = await worker(items[current], current);
      }
    }),
  );

  return results;
}

async function resolveContactIdForEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const cached = emailContactCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.contactId;
  }

  try {
    const data = await searchDuplicateContact(normalized);
    const contactId =
      data?.contact?.id ||
      data?.contact?.contactId ||
      data?.id ||
      null;

    emailContactCache.set(normalized, {
      expiresAt: Date.now() + EMAIL_CONTACT_CACHE_TTL_MS,
      contactId,
    });

    return contactId;
  } catch {
    emailContactCache.set(normalized, {
      expiresAt: Date.now() + EMAIL_CONTACT_CACHE_TTL_MS,
      contactId: null,
    });
    return null;
  }
}

async function resolveEmailContactIds(emails: string[]) {
  const uniqueEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  const missingEmails = uniqueEmails.filter((email) => {
    const cached = emailContactCache.get(email);
    return !cached || cached.expiresAt <= Date.now();
  });

  await mapWithConcurrency(
    missingEmails,
    EMAIL_CONTACT_LOOKUP_CONCURRENCY,
    async (email) => resolveContactIdForEmail(email),
  );

  const mapping = new Map<string, string | null>();
  for (const email of uniqueEmails) {
    mapping.set(email, emailContactCache.get(email)?.contactId || null);
  }
  return mapping;
}

async function buildEmailSummaries() {
  const emailRows = await getEmailDataset();
  const emails = emailRows
    .map((row) => row.to?.trim().toLowerCase() || "")
    .filter(Boolean);
  const contactMap = await resolveEmailContactIds(emails);

  const leads: EmailLeadSummary[] = [];

  for (const row of emailRows) {
    const email = row.to?.trim().toLowerCase();
    if (!email) continue;

    const history = [...(row.history || [])].sort((a, b) => {
      const timeA = a.time ? new Date(a.time).getTime() : 0;
      const timeB = b.time ? new Date(b.time).getTime() : 0;
      return timeA - timeB;
    });

    const sentTimes: string[] = [];
    const humanReplyTimes: string[] = [];
    const replyClassifications: ReplyIntent[] = [];
    let firstHumanReplyAt: string | null = null;
    let followUpsToFirstReply: number | null = null;

    for (const event of history) {
      if (!event.time) continue;

      if (event.type === "SENT") {
        sentTimes.push(event.time);
        continue;
      }

      if (event.type !== "REPLY") continue;

      const classification = classifyEmailReply(event.email_body || "");
      if (classification === "system") continue;

      humanReplyTimes.push(event.time);
      replyClassifications.push(classification);

      if (!firstHumanReplyAt) {
        firstHumanReplyAt = event.time;
        followUpsToFirstReply = Math.max(0, sentTimes.length - 1);
      }
    }

    const classification = replyClassifications.includes("interested")
      ? "interested"
      : replyClassifications.includes("not_interested")
        ? "not_interested"
        : replyClassifications.length > 0
          ? "neutral"
          : "neutral";

    const contactId = contactMap.get(email) || null;

    leads.push({
      email,
      personId: contactId ? `contact:${contactId}` : `email:${email}`,
      sentTimes,
      humanReplyTimes,
      classification,
      firstHumanReplyAt,
      followUpsToFirstReply,
    });
  }

  return leads;
}

async function buildDmSummaries(
  dmSource: DmSourceConfig,
  range: OutreachRange,
): Promise<{ threads: DmThreadSummary[]; dataset: DmDataset }> {
  const dataset = await getDmDataset(dmSource, range);
  const threads: DmThreadSummary[] = [];

  for (const conv of dataset.conversations) {
    const threadMessages = dataset.messagesByConversation.get(conv.id) || [];
    const sortedMessages = [...threadMessages].sort((a, b) => {
      const timeA = a.sentAt ? new Date(a.sentAt).getTime() : 0;
      const timeB = b.sentAt ? new Date(b.sentAt).getTime() : 0;
      return timeA - timeB;
    });

    const outboundTimes: string[] = [];
    const inboundTimes: string[] = [];
    const inboundBodies: string[] = [];
    let firstReplyAt: string | null = null;
    let followUpsToFirstReply: number | null = null;

    for (const message of sortedMessages) {
      if (!message.sentAt) continue;

      if (message.direction === "outbound") {
        outboundTimes.push(message.sentAt);
        continue;
      }

      if (message.direction !== "inbound") continue;

      inboundTimes.push(message.sentAt);
      inboundBodies.push(message.body || "");

      if (!firstReplyAt) {
        firstReplyAt = message.sentAt;
        followUpsToFirstReply = outboundTimes.length > 0
          ? Math.max(0, outboundTimes.length - 1)
          : 0;
      }
    }

    const personId = conv.contactId
      ? `contact:${conv.contactId}`
      : `conversation:${conv.id}`;

    threads.push({
      threadId: conv.id,
      personId,
      outboundTimes,
      inboundTimes,
      classification: classifyDmReply(inboundBodies),
      firstReplyAt,
      followUpsToFirstReply,
    });
  }

  return { threads, dataset };
}

function buildDateSeries(startDate: string, endDate: string) {
  const values: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const finish = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= finish) {
    values.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return values;
}

export async function getOutreachDashboard(range: OutreachRange): Promise<OutreachDashboardResponse> {
  const dmSource = getDmSourceConfig();
  const notes = [
    "Email reply rate skips bounce notices and auto-replies.",
    "Interested email replies are best-effort from Smartlead reply text.",
    "DM numbers come live from GHL Instagram conversations on the CC-Clients sub-account.",
    "Positive DM replies are best-effort from reply text matching.",
  ];

  let dmError: string | null = null;
  const [emailLeads, dmResult] = await Promise.all([
    buildEmailSummaries(),
    buildDmSummaries(dmSource, range).catch((err: unknown) => {
      dmError = err instanceof Error ? err.message : "Failed to load DM data";
      return {
        threads: [] as DmThreadSummary[],
        dataset: {
          conversations: [],
          messagesByConversation: new Map(),
          totalConversationsAllTime: 0,
          rangeStartMs: 0,
          rangeEndMs: 0,
        } as DmDataset,
      };
    }),
  ]);
  const dmThreads = dmResult.threads;
  const dmDatasetAllTime = dmResult.dataset.totalConversationsAllTime;

  const dateSeries = buildDateSeries(range.startDate, range.endDate);
  const chart = dateSeries.map((date) => ({
    date,
    label: dateLabelFromKey(date, range.timeZone),
    emailMessages: 0,
    dmMessages: 0,
    emailReplies: 0,
    dmReplies: 0,
  }));
  const chartByDate = new Map(chart.map((point) => [point.date, point]));

  const emailReachedInRange = new Set<string>();
  const emailReachedAllTime = new Set<string>();
  const emailRepliedInRange = new Set<string>();
  const emailInterestedInRange = new Set<string>();
  const emailNotInterestedInRange = new Set<string>();
  const emailFollowUpsToReply: number[] = [];

  for (const lead of emailLeads) {
    for (const sentTime of lead.sentTimes) {
      const dateKey = dateKeyFromTimestamp(sentTime, range.timeZone);
      emailReachedAllTime.add(lead.personId);
      if (isDateKeyInRange(dateKey, range.startDate, range.endDate)) {
        emailReachedInRange.add(lead.personId);
        const chartPoint = chartByDate.get(dateKey);
        if (chartPoint) chartPoint.emailMessages += 1;
      }
    }

    for (const replyTime of lead.humanReplyTimes) {
      const dateKey = dateKeyFromTimestamp(replyTime, range.timeZone);
      if (!isDateKeyInRange(dateKey, range.startDate, range.endDate)) continue;

      emailRepliedInRange.add(lead.personId);
      if (lead.classification === "interested") {
        emailInterestedInRange.add(lead.personId);
      }
      if (lead.classification === "not_interested") {
        emailNotInterestedInRange.add(lead.personId);
      }
      const chartPoint = chartByDate.get(dateKey);
      if (chartPoint) chartPoint.emailReplies += 1;
    }

    if (lead.firstHumanReplyAt && lead.followUpsToFirstReply !== null) {
      const dateKey = dateKeyFromTimestamp(lead.firstHumanReplyAt, range.timeZone);
      if (isDateKeyInRange(dateKey, range.startDate, range.endDate)) {
        emailFollowUpsToReply.push(lead.followUpsToFirstReply);
      }
    }
  }

  const dmReachedInRange = new Set<string>();
  const dmReachedAllTime = new Set<string>();
  const dmRepliedInRange = new Set<string>();
  const dmInterestedInRange = new Set<string>();
  const dmNotInterestedInRange = new Set<string>();
  const dmFollowUpsToReply: number[] = [];

  for (const thread of dmThreads) {
    for (const outboundTime of thread.outboundTimes) {
      const dateKey = dateKeyFromTimestamp(outboundTime, range.timeZone);
      dmReachedAllTime.add(thread.personId);
      if (isDateKeyInRange(dateKey, range.startDate, range.endDate)) {
        dmReachedInRange.add(thread.personId);
        const chartPoint = chartByDate.get(dateKey);
        if (chartPoint) chartPoint.dmMessages += 1;
      }
    }

    if (thread.outboundTimes.length === 0) {
      continue;
    }

    for (const inboundTime of thread.inboundTimes) {
      const dateKey = dateKeyFromTimestamp(inboundTime, range.timeZone);
      if (!isDateKeyInRange(dateKey, range.startDate, range.endDate)) continue;

      dmRepliedInRange.add(thread.personId);
      if (thread.classification === "interested") {
        dmInterestedInRange.add(thread.personId);
      }
      if (thread.classification === "not_interested") {
        dmNotInterestedInRange.add(thread.personId);
      }
      const chartPoint = chartByDate.get(dateKey);
      if (chartPoint) chartPoint.dmReplies += 1;
    }

    if (thread.firstReplyAt && thread.followUpsToFirstReply !== null) {
      const dateKey = dateKeyFromTimestamp(thread.firstReplyAt, range.timeZone);
      if (isDateKeyInRange(dateKey, range.startDate, range.endDate)) {
        dmFollowUpsToReply.push(thread.followUpsToFirstReply);
      }
    }
  }

  return {
    range,
    combined: {
      reachedInRange: new Set([...emailReachedInRange, ...dmReachedInRange]).size,
      reachedAllTime: new Set([...emailReachedAllTime, ...dmReachedAllTime]).size,
    },
    email: {
      reachedInRange: emailReachedInRange.size,
      reachedAllTime: emailReachedAllTime.size,
      messagesInRange: chart.reduce((sum, point) => sum + point.emailMessages, 0),
      messagesAllTime: emailLeads.reduce((sum, lead) => sum + lead.sentTimes.length, 0),
      repliesInRange: emailRepliedInRange.size,
      replyRateInRange: toPercent(emailRepliedInRange.size, emailReachedInRange.size),
      interestedRepliesInRange: emailInterestedInRange.size,
      interestedReplyRateInRange: toPercent(emailInterestedInRange.size, emailReachedInRange.size),
      notInterestedRepliesInRange: emailNotInterestedInRange.size,
      notInterestedReplyRateInRange: toPercent(emailNotInterestedInRange.size, emailReachedInRange.size),
      avgFollowUpsToReplyInRange: average(emailFollowUpsToReply),
    },
    dm: {
      reachedInRange: dmReachedInRange.size,
      reachedAllTime: Math.max(dmDatasetAllTime, dmReachedAllTime.size),
      messagesInRange: chart.reduce((sum, point) => sum + point.dmMessages, 0),
      messagesAllTime: dmThreads.reduce((sum, thread) => sum + thread.outboundTimes.length, 0),
      repliesInRange: dmRepliedInRange.size,
      replyRateInRange: toPercent(dmRepliedInRange.size, dmReachedInRange.size),
      interestedRepliesInRange: dmInterestedInRange.size,
      interestedReplyRateInRange: toPercent(dmInterestedInRange.size, dmReachedInRange.size),
      notInterestedRepliesInRange: dmNotInterestedInRange.size,
      notInterestedReplyRateInRange: toPercent(dmNotInterestedInRange.size, dmReachedInRange.size),
      avgFollowUpsToReplyInRange: average(dmFollowUpsToReply),
    },
    sources: {
      email: {
        connected: true,
        label: "Smartlead",
        description: "Live email data from Smartlead.",
      },
      dm: {
        connected: dmSource.enabled && !dmError,
        label: dmSource.label,
        description: dmError
          ? `DM source error: ${dmError}`
          : dmSource.enabled && dmThreads.length === 0
            ? `Connected to ${dmSource.label} — no Instagram conversations with activity in the selected range.`
            : dmSource.description,
      },
    },
    chart,
    notes,
    generatedAt: new Date().toISOString(),
  };
}
