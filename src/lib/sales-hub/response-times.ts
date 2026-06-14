import { getServiceSupabase } from "@/lib/supabase";

export type SalesHubClient = "tyson" | "antwan" | "all";

type ClientId = Exclude<SalesHubClient, "all">;

interface ClientDef {
  id: ClientId;
  key: string;
  label: string;
}

interface AssignmentEventRow {
  client: string;
  subscriber_id: string;
  subscriber_name: string | null;
  setter_name: string | null;
  tag_name: string;
  event_at: string;
  raw_payload?: unknown;
}

interface MessageRow {
  client: string;
  subscriber_id: string;
  conversation_id: string;
  message_id: string;
  direction: string | null;
  channel: string | null;
  message_type: string | null;
  body: string | null;
  sent_at: string | null;
  raw_payload?: unknown;
}

interface LeadLinkRow {
  client: string;
  manychat_subscriber_id: string | null;
  instagram_user_id: string | null;
  instagram_handle: string | null;
}

interface LeadAssignment {
  client: ClientDef;
  subscriberId: string;
  setterKey: string | null;
  setterLabel: string | null;
  leadName: string | null;
  assignedAt: string;
  newLeadAt: string | null;
}

interface ResponseSample {
  client: ClientId;
  clientLabel: string;
  setterKey: string | null;
  setterLabel: string;
  leadName: string | null;
  subscriberId: string;
  conversationId: string;
  inboundAt: string;
  outboundAt: string;
  activeSeconds: number;
}

export interface HourlyBucket {
  hour: number; // ET hour, 11..22 (business hours)
  count: number;
  avgSeconds: number | null;
  missedCount: number;
}

export interface ResponseTimeGroup {
  id: string;
  label: string;
  averageSeconds: number | null;
  sampleCount: number;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  missedCount: number;
  hourly: HourlyBucket[];
}

export interface ResponseTimeMetrics {
  summary: ResponseTimeGroup & {
    latestMessageAt: string | null;
    leadAssignments: number;
    leadIdentityLinks: number;
    matchedLeads: number;
    unmatchedInboundMessages: number;
    openInboundMessages: number;
    staleMessageFeed: boolean;
  };
  clients: ResponseTimeGroup[];
  setters: ResponseTimeGroup[];
  missThresholdSeconds: number;
  conversations: Array<{
    client: ClientId;
    clientLabel: string;
    setterLabel: string;
    leadName: string | null;
    subscriberId: string;
    manychatUrl: string | null;
    inboundAt: string;
    outboundAt: string;
    activeSeconds: number;
    missed: boolean;
  }>;
  slowestGaps: Array<{
    client: ClientId;
    clientLabel: string;
    setterLabel: string;
    leadName: string | null;
    inboundAt: string;
    outboundAt: string;
    activeSeconds: number;
  }>;
  setup: {
    businessHours: string;
    sourceOfTruth: {
      leads: string;
      messages: string;
      attribution: string;
      identity: string;
    };
    needs: string[];
  };
}

const CLIENTS: ClientDef[] = [
  { id: "tyson", key: "tyson_sonnek", label: "Tyson" },
  { id: "antwan", key: "antwan_rarcus", label: "Antwan Rarcus" },
];

const SETTER_LABELS: Record<string, string> = {
  amara: "Amara",
  kelechi: "Kelechi",
  kelchi: "Kelechi",
  gideon: "Gideon",
  debbie: "Debbie",
  debby: "Debbie",
  chidiebere: "Debbie",
  erin: "Erin",
};

const ET_TIMEZONE = "America/New_York";
const BUSINESS_START_SECOND = 11 * 3600;
const BUSINESS_END_SECOND = 23 * 3600;

// A reply counts as a "miss" if it took longer than this many business-hours seconds.
const MISS_THRESHOLD_SECONDS = 5 * 60;

// Business-hour buckets (ET): 11am(11) … 10pm(22) — the 12 hours of the 11am–11pm window.
const BUSINESS_HOURS = Array.from({ length: 12 }, (_, i) => 11 + i);

function etHourOfIso(iso: string): number {
  if (!iso) return 11;
  const sec = getEtParts(new Date(iso)).secondsOfDay;
  const hour = Math.floor(sec / 3600);
  if (hour < 11) return 11;
  if (hour > 22) return 22;
  return hour;
}

function bucketSamplesByHour(samples: ResponseSample[]): HourlyBucket[] {
  const byHour = new Map<number, ResponseSample[]>();
  for (const sample of samples) {
    const hour = etHourOfIso(sample.inboundAt);
    const list = byHour.get(hour) || [];
    list.push(sample);
    byHour.set(hour, list);
  }
  return BUSINESS_HOURS.map((hour) => {
    const list = byHour.get(hour) || [];
    const values = list.map((s) => s.activeSeconds);
    return {
      hour,
      count: list.length,
      avgSeconds: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
      missedCount: values.filter((v) => v > MISS_THRESHOLD_SECONDS).length,
    };
  });
}

// ManyChat live-chat deep link: https://app.manychat.com/fb{pageId}/chat/{subscriberId}
// (the account path segment is prefixed with "fb", confirmed from a real inbox URL).
const CLIENT_MANYCHAT_PAGE_ID: Record<ClientId, string | null> = {
  tyson: "1024471",
  antwan: null,
};

function manychatChatUrl(client: ClientId, subscriberId: string | null): string | null {
  const pageId = CLIENT_MANYCHAT_PAGE_ID[client];
  if (!pageId || !subscriberId) return null;
  return `https://app.manychat.com/fb${pageId}/chat/${subscriberId}`;
}

function getVisibleClients(client: SalesHubClient): ClientDef[] {
  if (client === "all") return CLIENTS;
  return CLIENTS.filter((item) => item.id === client);
}

function startOfUtcDay(date: string) {
  return `${date}T00:00:00.000Z`;
}

function endOfUtcDay(date: string) {
  return `${date}T23:59:59.999Z`;
}

function addDays(dateStr: string, days: number) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeSetterName(value: string | null | undefined) {
  const key = value?.trim().toLowerCase() || null;
  if (!key) return { key: null, label: null };
  return { key, label: SETTER_LABELS[key] || value?.trim() || key };
}

function getEtParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour || 0);
  const minute = Number(values.minute || 0);
  const second = Number(values.second || 0);

  return {
    dateStr: `${values.year}-${values.month}-${values.day}`,
    secondsOfDay: hour * 3600 + minute * 60 + second,
  };
}

function toEtDateStr(iso: string) {
  return getEtParts(new Date(iso)).dateStr;
}

function isDateInRangeEt(iso: string, dateFrom: string, dateTo: string) {
  const etDate = toEtDateStr(iso);
  return etDate >= dateFrom && etDate <= dateTo;
}

function computeTrackedWindowSeconds(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  if (end.getTime() <= start.getTime()) return 0;

  const startEt = getEtParts(start);
  const endEt = getEtParts(end);
  let cursor = startEt.dateStr;
  let total = 0;

  while (cursor <= endEt.dateStr) {
    const startSecond = cursor === startEt.dateStr ? startEt.secondsOfDay : 0;
    const endSecond = cursor === endEt.dateStr ? endEt.secondsOfDay : 24 * 3600;
    total += Math.max(
      0,
      Math.min(endSecond, BUSINESS_END_SECOND) -
        Math.max(startSecond, BUSINESS_START_SECOND),
    );
    cursor = addDays(cursor, 1);
  }

  return total;
}

function rawPayloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isAutomatedOutbound(message: MessageRow) {
  const raw = rawPayloadRecord(message.raw_payload);
  const source = typeof raw.source === "string" ? raw.source.toLowerCase() : "";
  const messageType = message.message_type?.toLowerCase() || "";

  return source.includes("ai-followup") || messageType.includes("followup");
}

function buildAssignments(events: AssignmentEventRow[], clientDefs: ClientDef[]) {
  const clientByKey = new Map(clientDefs.map((client) => [client.key, client]));
  const bySubscriber = new Map<string, LeadAssignment[]>();

  const sorted = [...events].sort((a, b) => a.event_at.localeCompare(b.event_at));

  for (const event of sorted) {
    const client = clientByKey.get(event.client);
    if (!client) continue;
    const setter = normalizeSetterName(event.setter_name);
    const key = `${event.client}:${event.subscriber_id}`;
    const list = bySubscriber.get(key) || [];
    const previous = list.at(-1);

    const assignment: LeadAssignment = {
      client,
      subscriberId: event.subscriber_id,
      setterKey: setter.key || previous?.setterKey || null,
      setterLabel: setter.label || previous?.setterLabel || null,
      leadName: event.subscriber_name?.trim() || previous?.leadName || null,
      assignedAt: event.event_at,
      newLeadAt:
        event.tag_name?.toLowerCase() === "new_lead"
          ? event.event_at
          : previous?.newLeadAt || null,
    };

    list.push(assignment);
    bySubscriber.set(key, list);
  }

  return bySubscriber;
}

function findAssignment(
  assignments: Map<string, LeadAssignment[]>,
  clientKey: string,
  subscriberId: string,
  at: string,
) {
  const list = assignments.get(`${clientKey}:${subscriberId}`) || [];
  let match: LeadAssignment | null = null;

  for (const item of list) {
    if (item.assignedAt <= at) match = item;
    else break;
  }

  return match;
}

function buildLeadLinkMap(rows: LeadLinkRow[]) {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (!row.client || !row.instagram_user_id || !row.manychat_subscriber_id) continue;
    map.set(`${row.client}:${row.instagram_user_id}`, row.manychat_subscriber_id);
  }
  return map;
}

function findAssignmentForMessage(
  assignments: Map<string, LeadAssignment[]>,
  leadLinkByInstagramId: Map<string, string>,
  clientKey: string,
  subscriberId: string,
  at: string,
) {
  const direct = findAssignment(assignments, clientKey, subscriberId, at);
  if (direct) return direct;

  const manychatSubscriberId = leadLinkByInstagramId.get(`${clientKey}:${subscriberId}`);
  if (!manychatSubscriberId) return null;

  return findAssignment(assignments, clientKey, manychatSubscriberId, at);
}

function summarizeSamples(id: string, label: string, samples: ResponseSample[]): ResponseTimeGroup {
  const hourly = bucketSamplesByHour(samples);

  if (samples.length === 0) {
    return {
      id,
      label,
      averageSeconds: null,
      sampleCount: 0,
      fastestSeconds: null,
      slowestSeconds: null,
      missedCount: 0,
      hourly,
    };
  }

  const values = samples.map((sample) => sample.activeSeconds);
  return {
    id,
    label,
    averageSeconds: values.reduce((sum, value) => sum + value, 0) / values.length,
    sampleCount: samples.length,
    fastestSeconds: Math.min(...values),
    slowestSeconds: Math.max(...values),
    missedCount: values.filter((value) => value > MISS_THRESHOLD_SECONDS).length,
    hourly,
  };
}

// Supabase/PostgREST caps a single request at 1000 rows. Tyson alone generates far
// more than 1000 ManyChat assignment events across the lookback window, so a single
// ascending query silently returns only the OLDEST 1000 — dropping every recent lead
// and producing zero matched samples. Page through all rows so nothing is truncated.
async function loadAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
  maxRows = 50000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export async function getResponseTimeMetrics(params: {
  client: SalesHubClient;
  dateFrom: string;
  dateTo: string;
}): Promise<ResponseTimeMetrics> {
  const { client, dateFrom, dateTo } = params;
  const sb = getServiceSupabase();
  const visibleClients = getVisibleClients(client);
  const clientKeys = visibleClients.map((item) => item.key);
  const messageEndDate = addDays(dateTo, 3);
  const assignmentStartDate = addDays(dateFrom, -120);

  const [assignmentRows, messageRows, latestMessageRes] = await Promise.all([
    loadAllRows<AssignmentEventRow>(async (from, to) => {
      const { data, error } = await sb
        .from("manychat_tag_events")
        .select("client, subscriber_id, subscriber_name, setter_name, tag_name, event_at, raw_payload")
        .in("client", clientKeys)
        .gte("event_at", startOfUtcDay(assignmentStartDate))
        .lte("event_at", endOfUtcDay(messageEndDate))
        .order("event_at", { ascending: false })
        .range(from, to);
      return { data: (data as AssignmentEventRow[] | null) ?? null, error };
    }),
    loadAllRows<MessageRow>(async (from, to) => {
      const { data, error } = await sb
        .from("dm_conversation_messages")
        .select("client, subscriber_id, conversation_id, message_id, direction, channel, message_type, body, sent_at, raw_payload")
        .in("client", clientKeys)
        .gte("sent_at", startOfUtcDay(dateFrom))
        .lte("sent_at", endOfUtcDay(messageEndDate))
        .order("sent_at", { ascending: false })
        .range(from, to);
      return { data: (data as MessageRow[] | null) ?? null, error };
    }),
    sb
      .from("dm_conversation_messages")
      .select("sent_at")
      .in("client", clientKeys)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (latestMessageRes.error) {
    throw new Error(`Failed to load latest DM message: ${latestMessageRes.error.message}`);
  }

  let leadLinks: LeadLinkRow[] = [];
  let leadLinksReady = true;
  try {
    leadLinks = await loadAllRows<LeadLinkRow>(async (from, to) => {
      const { data, error } = await sb
        .from("instagram_lead_links")
        .select("client, manychat_subscriber_id, instagram_user_id, instagram_handle")
        .in("client", clientKeys)
        .range(from, to);
      return { data: (data as LeadLinkRow[] | null) ?? null, error };
    });
  } catch {
    leadLinksReady = false;
  }

  const assignments = buildAssignments(assignmentRows, visibleClients);
  const leadLinkByInstagramId = buildLeadLinkMap(leadLinks);
  const groupedMessages = new Map<string, MessageRow[]>();
  let samples: ResponseSample[] = [];
  const matchedLeadIds = new Set<string>();
  let unmatchedInboundMessages = 0;
  let openInboundMessages = 0;

  for (const message of messageRows) {
    if (!message.conversation_id || !message.sent_at) continue;
    const key = `${message.client}:${message.conversation_id}`;
    const list = groupedMessages.get(key) || [];
    list.push(message);
    groupedMessages.set(key, list);
  }

  for (const messages of groupedMessages.values()) {
    const ordered = [...messages].sort((a, b) => (a.sent_at || "").localeCompare(b.sent_at || ""));
    let pending:
      | {
          message: MessageRow;
          assignment: LeadAssignment;
        }
      | null = null;

    for (const message of ordered) {
      if (!message.sent_at) continue;

      if (message.direction === "inbound") {
        if (!isDateInRangeEt(message.sent_at, dateFrom, dateTo)) continue;

        const assignment = findAssignmentForMessage(
          assignments,
          leadLinkByInstagramId,
          message.client,
          message.subscriber_id,
          message.sent_at,
        );

        if (!assignment?.newLeadAt) {
          unmatchedInboundMessages += 1;
          continue;
        }

        matchedLeadIds.add(`${message.client}:${message.subscriber_id}`);
        if (!pending) pending = { message, assignment };
        continue;
      }

      if (message.direction === "outbound" && pending && !isAutomatedOutbound(message)) {
        samples.push({
          client: pending.assignment.client.id,
          clientLabel: pending.assignment.client.label,
          setterKey: pending.assignment.setterKey,
          setterLabel: pending.assignment.setterLabel || "Unassigned",
          leadName: pending.assignment.leadName,
          subscriberId: pending.assignment.subscriberId,
          conversationId: pending.message.conversation_id,
          inboundAt: pending.message.sent_at || "",
          outboundAt: message.sent_at,
          activeSeconds: computeTrackedWindowSeconds(pending.message.sent_at || "", message.sent_at),
        });
        pending = null;
      }
    }

    if (pending) openInboundMessages += 1;
  }

  // Stop tracking a conversation FROM THE MOMENT it's marked done. When a lead is
  // tagged Booked Call / Subscription Sold / Closed in ManyChat, the conversation
  // has reached a terminal outcome, so any response to a message received at or
  // after that instant must not count toward response times (it was unfairly
  // dinging setters). Replies to messages received BEFORE the tag still count —
  // that was real setting work.
  //
  // We read the tag-application time from the synced ManyChat tag events
  // (manychat_tag_events, already loaded as assignmentRows above). For this to
  // fire, those terminal tags must be sent to /api/sales-hub/manychat-webhook
  // (an External Request per tag, like new_lead) so CCOS records WHEN each was
  // applied — ManyChat's API does not expose tag timestamps.
  const doneAtBySubscriber = new Map<string, number>();
  for (const event of assignmentRows) {
    if (!event.subscriber_id || !event.event_at) continue;
    const name = (event.tag_name || "").toLowerCase();
    if (!name.includes("booked") && !name.includes("sold") && !name.includes("closed")) continue;
    const at = new Date(event.event_at).getTime();
    if (Number.isNaN(at)) continue;
    const prev = doneAtBySubscriber.get(event.subscriber_id);
    if (prev === undefined || at < prev) doneAtBySubscriber.set(event.subscriber_id, at);
  }
  if (doneAtBySubscriber.size > 0) {
    samples = samples.filter((sample) => {
      const doneAt = doneAtBySubscriber.get(sample.subscriberId);
      // Keep the sample only if the prospect's message arrived before the lead
      // was marked done.
      return doneAt === undefined || new Date(sample.inboundAt).getTime() < doneAt;
    });
  }

  const clients = visibleClients.map((item) =>
    summarizeSamples(
      item.id,
      item.label,
      samples.filter((sample) => sample.client === item.id),
    ),
  );

  const setterKeys = [...new Set(samples.map((sample) => sample.setterKey || "unassigned"))];
  const setters = setterKeys
    .map((setterKey) =>
      summarizeSamples(
        setterKey,
        setterKey === "unassigned" ? "Unassigned" : SETTER_LABELS[setterKey] || setterKey,
        samples.filter((sample) => (sample.setterKey || "unassigned") === setterKey),
      ),
    )
    .sort((a, b) => a.label.localeCompare(b.label));

  const latestMessageAt = latestMessageRes.data?.sent_at || null;
  const latestTime = latestMessageAt ? new Date(latestMessageAt).getTime() : 0;
  const staleMessageFeed =
    !latestTime || Date.now() - latestTime > 24 * 60 * 60 * 1000;

  const needs = [
    "Connect Tyson's Instagram professional account to the CCOS Meta app.",
    "Turn on Meta message webhooks so new Tyson DMs land in CCOS live.",
    "Confirm Tyson's ManyChat keyword flows send subscriber_id, instagram_handle, setter_name, client, tag_name, and event_at.",
  ];

  if (!leadLinksReady) {
    needs.unshift("Run the Instagram connection database setup so ManyChat leads can be matched to Instagram DM people.");
  } else if (leadLinks.length === 0) {
    needs.unshift("No ManyChat-to-Instagram identity links exist yet. These start filling in after ManyChat and Instagram both send events.");
  }
  if (samples.length === 0) {
    needs.unshift("No matched response-time samples were found for this date range yet.");
  }
  if (staleMessageFeed) {
    needs.unshift("The live DM feed is stale or not connected yet.");
  }

  return {
    summary: {
      ...summarizeSamples("team", "Team", samples),
      latestMessageAt,
      leadAssignments: assignmentRows.length,
      leadIdentityLinks: leadLinks.length,
      matchedLeads: matchedLeadIds.size,
      unmatchedInboundMessages,
      openInboundMessages,
      staleMessageFeed,
    },
    clients,
    setters,
    missThresholdSeconds: MISS_THRESHOLD_SECONDS,
    conversations: [...samples]
      .sort((a, b) => (a.inboundAt < b.inboundAt ? 1 : -1))
      .map((sample) => ({
        client: sample.client,
        clientLabel: sample.clientLabel,
        setterLabel: sample.setterLabel,
        leadName: sample.leadName,
        subscriberId: sample.subscriberId,
        manychatUrl: manychatChatUrl(sample.client, sample.subscriberId),
        inboundAt: sample.inboundAt,
        outboundAt: sample.outboundAt,
        activeSeconds: sample.activeSeconds,
        missed: sample.activeSeconds > MISS_THRESHOLD_SECONDS,
      })),
    slowestGaps: [...samples]
      .sort((a, b) => b.activeSeconds - a.activeSeconds)
      .slice(0, 5)
      .map((sample) => ({
        client: sample.client,
        clientLabel: sample.clientLabel,
        setterLabel: sample.setterLabel,
        leadName: sample.leadName,
        inboundAt: sample.inboundAt,
        outboundAt: sample.outboundAt,
        activeSeconds: sample.activeSeconds,
      })),
    setup: {
      businessHours: "11am-11pm ET",
      sourceOfTruth: {
        leads: "ManyChat tag events",
        messages: "Meta/Instagram DM message feed stored in dm_conversation_messages",
        attribution: "Assigned setter from ManyChat at the time the prospect message was received",
        identity: "instagram_lead_links connects ManyChat contact IDs to Instagram DM user IDs",
      },
      needs,
    },
  };
}
