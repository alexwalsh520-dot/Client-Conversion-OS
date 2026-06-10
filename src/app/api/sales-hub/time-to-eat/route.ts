import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { addBusinessMinutes, businessMinutesBetween } from "@/lib/sales-hub/business-hours";

type ClientFilter = "all" | "tyson" | "antwan";
type ServerClient = "tyson_sonnek" | "antwan_rarcus";
type TimeToEatStatus = "watching" | "time_to_eat" | "dead_meat" | "resolved";

interface TagEventRow {
  client: ServerClient;
  subscriber_id: string;
  subscriber_name: string | null;
  setter_name: string | null;
  tag_name: string;
  event_at: string;
  raw_payload: unknown;
}

interface MessageRow {
  subscriber_id: string;
  setter_name: string | null;
  conversation_id: string;
  direction: string | null;
  body: string | null;
  sent_at: string | null;
}

interface LeadMeta {
  subscriberId: string;
  client: ServerClient;
  leadName: string | null;
  initialSetter: string | null;
  setters: Set<string>;
  manychatUrl: string | null;
  newLeadAt: string;
}

interface TimeToEatLead {
  id: string;
  subscriberId: string;
  leadName: string | null;
  manychatUrl: string | null;
  conversationId: string;
  lastProspectResponseAt: string;
  hoursSinceProspectResponse: number;
  initialSetter: string | null;
  setters: string[];
  previousMisses: number;
  preview: string | null;
}

interface StoredLeadState {
  client: ServerClient;
  subscriberId: string;
  leadName: string | null;
  manychatUrl: string | null;
  conversationId: string | null;
  initialSetter: string | null;
  setters: string[];
  firstStaleAt: string | null;
  currentStaleAt: string | null;
  lastInboundAt: string | null;
  lastSeenStaleAt: string | null;
  lastResolvedAt: string | null;
  staleEventCount: number;
  status: TimeToEatStatus;
  updatedAt: string;
}

interface TimeToEatMemory {
  version: 1;
  updatedAt: string | null;
  leads: Record<string, StoredLeadState>;
}

const CLIENT_MAP: Record<Exclude<ClientFilter, "all">, ServerClient> = {
  tyson: "tyson_sonnek",
  antwan: "antwan_rarcus",
};

const MEMORY_KEY = "time_to_eat_memory_v1";
// A lead is "stale" after 60 minutes of WORKING time with no reply. Working time
// is only counted inside 11am–11pm ET (see lib/sales-hub/business-hours.ts), so
// overnight gaps don't push a lead into the list.
const STALE_AFTER_BUSINESS_MINUTES = 60;
// Dead Meat = the lead has gone stale on TWO separate occasions (it slipped,
// got a reply, then slipped again). The first occasion is Time to Eat; the
// second is Dead Meat. So "1 prior miss" already on record => Dead Meat.
const DEAD_MEAT_AFTER_MISSES = 2;
const LOOKBACK_DAYS = 90;
const MEMORY_RETENTION_DAYS = 180;
const MANYCHAT_BASE = "https://api.manychat.com/fb";
const BUSINESS_HOURS_LABEL = "11am-11pm ET";

function normalizeClient(value: string | null): ClientFilter {
  if (value === "tyson" || value === "antwan") return value;
  return "all";
}

function normalizeSetter(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function titleName(value: string | null) {
  if (!value) return null;
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function isString(value: string | null): value is string {
  return Boolean(value);
}

function memoryId(client: ServerClient, subscriberId: string) {
  return `${client}:${subscriberId}`;
}

function emptyMemory(): TimeToEatMemory {
  return { version: 1, updatedAt: null, leads: {} };
}

function normalizeStoredState(value: unknown): StoredLeadState | null {
  if (!isRecord(value)) return null;
  const client = value.client;
  const subscriberId = value.subscriberId;
  if (
    (client !== "tyson_sonnek" && client !== "antwan_rarcus") ||
    typeof subscriberId !== "string" ||
    !subscriberId
  ) {
    return null;
  }

  const status = value.status;
  const safeStatus: TimeToEatStatus =
    status === "time_to_eat" || status === "dead_meat" || status === "resolved" || status === "watching"
      ? status
      : "watching";

  return {
    client,
    subscriberId,
    leadName: typeof value.leadName === "string" ? value.leadName : null,
    manychatUrl: typeof value.manychatUrl === "string" ? value.manychatUrl : null,
    conversationId: typeof value.conversationId === "string" ? value.conversationId : null,
    initialSetter: typeof value.initialSetter === "string" ? value.initialSetter : null,
    setters: Array.isArray(value.setters)
      ? value.setters.filter((setter): setter is string => typeof setter === "string")
      : [],
    firstStaleAt: typeof value.firstStaleAt === "string" ? value.firstStaleAt : null,
    currentStaleAt: typeof value.currentStaleAt === "string" ? value.currentStaleAt : null,
    lastInboundAt: typeof value.lastInboundAt === "string" ? value.lastInboundAt : null,
    lastSeenStaleAt: typeof value.lastSeenStaleAt === "string" ? value.lastSeenStaleAt : null,
    lastResolvedAt: typeof value.lastResolvedAt === "string" ? value.lastResolvedAt : null,
    staleEventCount: Math.max(0, Number(value.staleEventCount) || 0),
    status: safeStatus,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
  };
}

function normalizeMemory(raw: unknown): TimeToEatMemory {
  if (!isRecord(raw) || !isRecord(raw.leads)) return emptyMemory();

  const memory = emptyMemory();
  memory.updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : null;

  for (const [key, value] of Object.entries(raw.leads)) {
    const state = normalizeStoredState(value);
    if (state) memory.leads[key] = state;
  }

  return memory;
}

async function loadMemory(sb: ReturnType<typeof getServiceSupabase>) {
  try {
    const { data, error } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", MEMORY_KEY)
      .maybeSingle();

    if (error) throw error;
    if (!data?.value) return { enabled: true, memory: emptyMemory(), warning: null as string | null };
    return {
      enabled: true,
      memory: normalizeMemory(JSON.parse(String(data.value))),
      warning: null as string | null,
    };
  } catch (error) {
    console.warn("[sales-hub/time-to-eat] memory unavailable:", error);
    return {
      enabled: false,
      memory: emptyMemory(),
      warning: "Time to Eat memory is not active because the app_settings table is unavailable.",
    };
  }
}

async function saveMemory(sb: ReturnType<typeof getServiceSupabase>, memory: TimeToEatMemory) {
  const cutoff = Date.now() - MEMORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const [key, state] of Object.entries(memory.leads)) {
    const updatedAt = new Date(state.updatedAt).getTime();
    if (
      state.status !== "time_to_eat" &&
      state.status !== "dead_meat" &&
      Number.isFinite(updatedAt) &&
      updatedAt < cutoff
    ) {
      delete memory.leads[key];
    }
  }

  memory.updatedAt = new Date().toISOString();

  const { error } = await sb.from("app_settings").upsert(
    {
      key: MEMORY_KEY,
      value: JSON.stringify(memory),
      updated_at: memory.updatedAt,
      updated_by: "time-to-eat",
    },
    { onConflict: "key" },
  );

  if (error) throw new Error(error.message);
}

function getManyChatKey(client: ServerClient) {
  if (client === "tyson_sonnek") return process.env.MANYCHAT_API_KEY_TYSON || null;
  if (client === "antwan_rarcus") return process.env.MANYCHAT_API_KEY_ANTWAN || null;
  return null;
}

async function fetchManyChatLiveChatUrl(client: ServerClient, subscriberId: string) {
  const key = getManyChatKey(client);
  if (!key) return null;

  const res = await fetch(
    `${MANYCHAT_BASE}/subscriber/getInfo?subscriber_id=${encodeURIComponent(subscriberId)}`,
    { headers: { Authorization: `Bearer ${key}` } },
  );

  if (!res.ok) return null;

  const body = (await res.json().catch(() => ({}))) as {
    data?: { live_chat_url?: unknown };
  };
  return typeof body.data?.live_chat_url === "string" ? body.data.live_chat_url : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function extractManychatUrl(raw: unknown): string | null {
  const directKeys = [
    "inbox_chat_url",
    "inboxChatUrl",
    "Inbox chat URL",
    "live_chat_url",
    "liveChatUrl",
    "manychat_url",
    "manychatUrl",
    "conversation_url",
    "conversationUrl",
    "chat_url",
    "chatUrl",
  ];

  if (isRecord(raw)) {
    for (const key of directKeys) {
      const value = raw[key];
      if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
    }
  }

  const found: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (/^https?:\/\/.+manychat\.com/i.test(value)) found.push(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (isRecord(value)) {
      for (const item of Object.values(value)) visit(item);
    }
  };

  visit(raw);
  return found[0] || null;
}

function buildLeadMeta(events: TagEventRow[]) {
  const leads = new Map<string, LeadMeta>();
  const sorted = [...events].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
  );

  for (const event of sorted) {
    const setter = normalizeSetter(event.setter_name);
    const existing = leads.get(event.subscriber_id);
    const url = extractManychatUrl(event.raw_payload);

    if (!existing) {
      leads.set(event.subscriber_id, {
        subscriberId: event.subscriber_id,
        client: event.client,
        leadName: event.subscriber_name?.trim() || null,
        initialSetter: setter,
        setters: new Set(setter ? [setter] : []),
        manychatUrl: url,
        newLeadAt: event.event_at,
      });
      continue;
    }

    if (setter) existing.setters.add(setter);
    if (!existing.leadName && event.subscriber_name?.trim()) {
      existing.leadName = event.subscriber_name.trim();
    }
    if (!existing.manychatUrl && url) existing.manychatUrl = url;
  }

  return leads;
}

// Count how many EARLIER times this lead waited past the stale threshold and
// then got a reply. Each inbound→outbound gap is measured in working minutes
// (11am–11pm ET), so an overnight reply isn't unfairly counted as a miss.
function countPastMisses(messages: MessageRow[], currentLastInboundIndex: number) {
  let pendingInboundAt: string | null = null;
  let misses = 0;

  for (let i = 0; i < currentLastInboundIndex; i += 1) {
    const message = messages[i];
    if (!message.sent_at) continue;

    if (message.direction === "inbound") {
      pendingInboundAt = message.sent_at;
      continue;
    }

    if (message.direction === "outbound" && pendingInboundAt) {
      const waitedMinutes = businessMinutesBetween(pendingInboundAt, message.sent_at);
      if (waitedMinutes >= STALE_AFTER_BUSINESS_MINUTES) misses += 1;
      pendingInboundAt = null;
    }
  }

  return misses;
}

// Wall-clock hours since the prospect replied — used for the human-facing
// "Xh waiting" label and for sorting, NOT for the stale decision (that is
// business-hours, via businessMinutesBetween).
function hoursSince(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, diff / (60 * 60 * 1000));
}

export async function GET(req: NextRequest) {
  const client = normalizeClient(req.nextUrl.searchParams.get("client"));
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({
        status: "ok",
        warning: "Supabase service env vars are not configured.",
        staleAfterBusinessMinutes: STALE_AFTER_BUSINESS_MINUTES,
        deadMeatAfterMisses: DEAD_MEAT_AFTER_MISSES,
        businessHours: BUSINESS_HOURS_LABEL,
        lookbackDays: LOOKBACK_DAYS,
        memory: { enabled: false, trackedLeads: 0, updatedAt: null },
        timeToEat: [],
        deadMeat: [],
      });
    }

    const sb = getServiceSupabase();
    const memoryState = await loadMemory(sb);
    const memory = memoryState.memory;
    const warnings = memoryState.warning ? [memoryState.warning] : [];
    let memoryDirty = false;

    let eventQuery = sb
      .from("manychat_tag_events")
      .select("client, subscriber_id, subscriber_name, setter_name, tag_name, event_at, raw_payload")
      .gte("event_at", since)
      .order("event_at", { ascending: true });

    if (client !== "all") eventQuery = eventQuery.eq("client", CLIENT_MAP[client]);

    const { data: eventData, error: eventError } = await eventQuery;
    if (eventError) throw new Error(eventError.message);

    const events = (eventData ?? []) as TagEventRow[];
    const newLeadEvents = events.filter((event) => event.tag_name === "new_lead");
    const leads = buildLeadMeta(newLeadEvents);

    if (leads.size === 0) {
      return NextResponse.json({
        status: "ok",
        staleAfterBusinessMinutes: STALE_AFTER_BUSINESS_MINUTES,
        deadMeatAfterMisses: DEAD_MEAT_AFTER_MISSES,
        businessHours: BUSINESS_HOURS_LABEL,
        lookbackDays: LOOKBACK_DAYS,
        warning: warnings.join(" ") || undefined,
        memory: {
          enabled: memoryState.enabled,
          trackedLeads: Object.keys(memory.leads).length,
          updatedAt: memory.updatedAt,
        },
        timeToEat: [],
        deadMeat: [],
      });
    }

    let messageQuery = sb
      .from("dm_conversation_messages")
      .select("subscriber_id, setter_name, conversation_id, direction, body, sent_at")
      .gte("sent_at", since)
      .order("sent_at", { ascending: true })
      .limit(5000);

    if (client !== "all") messageQuery = messageQuery.eq("client", CLIENT_MAP[client]);

    const { data: messageData, error: messageError } = await messageQuery;
    if (messageError) throw new Error(messageError.message);

    const messagesBySubscriber = new Map<string, MessageRow[]>();
    for (const message of (messageData ?? []) as MessageRow[]) {
      if (!message.sent_at || !leads.has(message.subscriber_id)) continue;
      const meta = leads.get(message.subscriber_id);
      const setter = normalizeSetter(message.setter_name);
      if (meta && setter) meta.setters.add(setter);

      const list = messagesBySubscriber.get(message.subscriber_id) ?? [];
      list.push(message);
      messagesBySubscriber.set(message.subscriber_id, list);
    }

    const timeToEat: TimeToEatLead[] = [];
    const deadMeat: TimeToEatLead[] = [];

    for (const [subscriberId, messages] of messagesBySubscriber.entries()) {
      const lead = leads.get(subscriberId);
      const lastMessage = messages.at(-1);
      if (!lead || !lastMessage?.sent_at) continue;

      const id = memoryId(lead.client, subscriberId);
      const existing = memory.leads[id];
      if (!existing) continue;

      const setters = [...new Set([...existing.setters, ...[...lead.setters].map(titleName).filter(isString)])];

      if (
        lastMessage.direction === "outbound" &&
        (existing.status === "time_to_eat" || existing.status === "dead_meat")
      ) {
        memory.leads[id] = {
          ...existing,
          leadName: lead.leadName || existing.leadName,
          manychatUrl: lead.manychatUrl || existing.manychatUrl,
          conversationId: lastMessage.conversation_id || existing.conversationId,
          setters,
          status: "resolved",
          lastResolvedAt: lastMessage.sent_at,
          updatedAt: nowIso,
        };
        memoryDirty = true;
        continue;
      }

      if (
        lastMessage.direction === "inbound" &&
        existing.status !== "watching" &&
        existing.lastInboundAt !== lastMessage.sent_at &&
        businessMinutesBetween(lastMessage.sent_at, nowIso) < STALE_AFTER_BUSINESS_MINUTES
      ) {
        memory.leads[id] = {
          ...existing,
          leadName: lead.leadName || existing.leadName,
          manychatUrl: lead.manychatUrl || existing.manychatUrl,
          conversationId: lastMessage.conversation_id || existing.conversationId,
          setters,
          status: "watching",
          lastInboundAt: lastMessage.sent_at,
          updatedAt: nowIso,
        };
        memoryDirty = true;
      }
    }

    for (const [subscriberId, messages] of messagesBySubscriber.entries()) {
      const lead = leads.get(subscriberId);
      if (!lead) continue;

      const lastMessage = messages.at(-1);
      if (!lastMessage?.sent_at || lastMessage.direction !== "inbound") continue;

      // Working minutes (11am–11pm ET) since the prospect's last reply decide
      // whether this lead is stale. waitingHours is kept only for display.
      const businessMinutesWaiting = businessMinutesBetween(lastMessage.sent_at, nowIso);
      if (businessMinutesWaiting < STALE_AFTER_BUSINESS_MINUTES) continue;
      const waitingHours = hoursSince(lastMessage.sent_at);

      const pastMisses = countPastMisses(messages, messages.length - 1);
      const id = memoryId(lead.client, subscriberId);
      const existing = memory.leads[id];
      const hasAlreadyCountedCurrentStale =
        existing?.lastInboundAt === lastMessage.sent_at &&
        (existing.status === "time_to_eat" || existing.status === "dead_meat");
      const savedStaleEvents = existing?.staleEventCount ?? 0;
      const staleEventCount = hasAlreadyCountedCurrentStale
        ? Math.max(savedStaleEvents, pastMisses + 1)
        : Math.max(savedStaleEvents + 1, pastMisses + 1);
      const previousMisses = Math.max(pastMisses, staleEventCount - 1);
      // The instant this lead actually crossed the 1-working-hour mark.
      const staleStartedAt = addBusinessMinutes(lastMessage.sent_at, STALE_AFTER_BUSINESS_MINUTES);
      // This stale event counts as one occasion; prior misses add to it. Two or
      // more total occasions => Dead Meat, otherwise Time to Eat.
      const totalOccasions = previousMisses + 1;
      const status: TimeToEatStatus =
        totalOccasions >= DEAD_MEAT_AFTER_MISSES ? "dead_meat" : "time_to_eat";
      const manychatUrl =
        lead.manychatUrl ||
        existing?.manychatUrl ||
        (await fetchManyChatLiveChatUrl(lead.client, subscriberId));
      const setters = [...lead.setters].map(titleName).filter(isString);
      const card = {
        id: `${subscriberId}:${lastMessage.sent_at}`,
        subscriberId,
        leadName: lead.leadName,
        manychatUrl,
        conversationId: lastMessage.conversation_id,
        lastProspectResponseAt: lastMessage.sent_at,
        hoursSinceProspectResponse: waitingHours,
        initialSetter: titleName(lead.initialSetter),
        setters,
        previousMisses,
        preview: lastMessage.body?.slice(0, 120) || null,
      };

      memory.leads[id] = {
        client: lead.client,
        subscriberId,
        leadName: lead.leadName || existing?.leadName || null,
        manychatUrl,
        conversationId: lastMessage.conversation_id || existing?.conversationId || null,
        initialSetter: titleName(lead.initialSetter) || existing?.initialSetter || null,
        setters: [...new Set([...(existing?.setters ?? []), ...setters])],
        firstStaleAt: existing?.firstStaleAt || staleStartedAt,
        currentStaleAt: staleStartedAt,
        lastInboundAt: lastMessage.sent_at,
        lastSeenStaleAt: nowIso,
        lastResolvedAt: existing?.lastResolvedAt || null,
        staleEventCount,
        status,
        updatedAt: nowIso,
      };
      memoryDirty = true;

      if (status === "dead_meat") deadMeat.push(card);
      else timeToEat.push(card);
    }

    if (memoryState.enabled && memoryDirty) {
      try {
        await saveMemory(sb, memory);
      } catch (error) {
        console.warn("[sales-hub/time-to-eat] memory save failed:", error);
        warnings.push("Time to Eat loaded, but memory could not be saved.");
      }
    }

    const byAge = (
      a: { hoursSinceProspectResponse: number },
      b: { hoursSinceProspectResponse: number },
    ) => b.hoursSinceProspectResponse - a.hoursSinceProspectResponse;

    return NextResponse.json({
      status: "ok",
      staleAfterBusinessMinutes: STALE_AFTER_BUSINESS_MINUTES,
      deadMeatAfterMisses: DEAD_MEAT_AFTER_MISSES,
      businessHours: BUSINESS_HOURS_LABEL,
      lookbackDays: LOOKBACK_DAYS,
      warning: warnings.join(" ") || undefined,
      memory: {
        enabled: memoryState.enabled,
        trackedLeads: Object.keys(memory.leads).length,
        updatedAt: memory.updatedAt,
      },
      timeToEat: timeToEat.sort(byAge),
      deadMeat: deadMeat.sort(byAge),
    });
  } catch (error) {
    console.error("[sales-hub/time-to-eat] error:", error);
    return NextResponse.json(
      {
        status: "error",
        error: error instanceof Error ? error.message : "Failed to load Time to Eat",
        staleAfterBusinessMinutes: STALE_AFTER_BUSINESS_MINUTES,
        deadMeatAfterMisses: DEAD_MEAT_AFTER_MISSES,
        businessHours: BUSINESS_HOURS_LABEL,
        lookbackDays: LOOKBACK_DAYS,
        memory: { enabled: false, trackedLeads: 0, updatedAt: null },
        timeToEat: [],
        deadMeat: [],
      },
      { status: 500 },
    );
  }
}
