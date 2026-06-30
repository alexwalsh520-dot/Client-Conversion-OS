import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { addBusinessMinutes, businessMinutesBetween } from "@/lib/sales-hub/business-hours";
import {
  postAnswerLeadAlert,
  postDeadMeatAlert,
  postResponseTargetAlert,
  postTimeToEatAlert,
} from "@/lib/sales-hub/time-to-eat-alerts";

// Checking ManyChat tags for candidate leads adds a handful of API calls, so give
// the function room beyond the default timeout.
export const maxDuration = 60;

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
  client: string;
  subscriber_id: string;
  conversation_id: string;
  direction: string | null;
  body: string | null;
  sent_at: string | null;
}

interface Assignment {
  setterKey: string | null;
  leadName: string | null;
  manychatUrl: string | null;
}

interface LeadLinkRow {
  client: string;
  manychat_subscriber_id: string | null;
  instagram_user_id: string | null;
  instagram_handle: string | null;
}

interface LeadMeta {
  subscriberId: string;
  client: ServerClient;
  // Resolved ManyChat subscriber id (via the IGSID bridge). Null = this Instagram
  // conversation isn't a known ManyChat lead, so it isn't actionable / shown.
  manychatId: string | null;
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
// got a reply, then slipped again), OR it has gone a single stretch of 2 working
// hours with no reply. The first single-occasion slip is Time to Eat; a second
// slip OR crossing 2 working hours makes it Dead Meat.
const DEAD_MEAT_AFTER_MISSES = 2;
const DEAD_MEAT_AFTER_BUSINESS_MINUTES = 120;
// Proactive nudge at 4 working minutes — owner is about to miss the 5-min target.
const RESPONSE_TARGET_WARN_BUSINESS_MINUTES = 4;
// ...but only within a tight window. The "about to miss 5 min" message is
// meaningless for a lead that's already been waiting much longer, and the ceiling
// also stops a backlog burst when this first goes live.
const RESPONSE_TARGET_WARN_CEILING_BUSINESS_MINUTES = 8;
// Early "answer your lead" nudge fires at 15 working minutes of no reply.
const WARN_AFTER_BUSINESS_MINUTES = 15;
// The earliest alert threshold — used to decide which leads need an exempt check.
const EARLIEST_ALERT_BUSINESS_MINUTES = RESPONSE_TARGET_WARN_BUSINESS_MINUTES;
const LOOKBACK_DAYS = 90;
const MEMORY_RETENTION_DAYS = 180;
const BUSINESS_HOURS_LABEL = "11am-11pm ET";

// A lead carrying any of these ManyChat tags is done — never chase or alert it.
// (Booked Call / Subscription Sold / Closed — matched loosely so prefixed variants
// like "Sales - Booked Call", "Subscription - Closed", "AI-CLOSED" also count.)
const EXEMPT_TAG_SUBSTRINGS = ["booked call", "sold", "closed"];
// Manychat ids confirmed exempt are cached here so we don't re-hit the API.
const EXEMPT_CACHE_KEY = "time_to_eat_exempt_v2";
const EXEMPT_RETENTION_DAYS = 30;
// Re-check a lead's ManyChat tags at most this often, so the fast (every-2-min)
// cron doesn't re-hit the ManyChat API every tick — cost stays bounded by time,
// not by cron frequency. A newly-booked lead is caught within this window.
const EXEMPT_CHECK_TTL_MS = 6 * 60 * 1000;
// The moment this tracker went live. Only prospect replies AFTER this instant
// count — so there is no historical backlog, just leads moving forward. Past
// slips before this time are ignored too, giving every lead a clean slate.
// Change this if you ever want to re-baseline the queue.
const GO_LIVE_AT = "2026-06-10T03:24:16Z";
const GO_LIVE_MS = new Date(GO_LIVE_AT).getTime();

// Slack alerts only fire for leads whose last reply is after this instant, so
// turning the alerts on never replays a burst for leads already sitting stale.
const ALERTS_GO_LIVE_AT = "2026-06-12T05:45:00Z";
const ALERTS_GO_LIVE_MS = new Date(ALERTS_GO_LIVE_AT).getTime();

// Remembers which Slack alerts already fired for each stale episode so the
// 10-minute cron never double-posts. Keyed by `${subscriberId}:${lastInboundAt}`.
const ALERT_LOG_KEY = "time_to_eat_alerts_v1";
const ALERT_LOG_RETENTION_DAYS = 3;

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

// ManyChat live-chat deep link (the account path segment is "fb"-prefixed).
const CLIENT_MANYCHAT_PAGE_ID: Record<ServerClient, string | null> = {
  tyson_sonnek: "1024471",
  antwan_rarcus: null,
};

function manychatChatUrl(client: ServerClient, manychatSubscriberId: string | null): string | null {
  const pageId = CLIENT_MANYCHAT_PAGE_ID[client];
  if (!pageId || !manychatSubscriberId) return null;
  return `https://app.manychat.com/fb${pageId}/chat/${manychatSubscriberId}`;
}

// Latest setter + name per ManyChat subscriber, derived from their tag events.
function buildAssignments(events: TagEventRow[]): Map<string, Assignment> {
  const byId = new Map<string, Assignment>();
  const sorted = [...events].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
  );

  for (const event of sorted) {
    const setter = normalizeSetter(event.setter_name);
    const url = extractManychatUrl(event.raw_payload);
    const current = byId.get(event.subscriber_id) || {
      setterKey: null,
      leadName: null,
      manychatUrl: null,
    };
    if (setter) current.setterKey = setter; // most recent assignment wins
    if (!current.leadName && event.subscriber_name?.trim()) {
      current.leadName = event.subscriber_name.trim();
    }
    if (!current.manychatUrl && url) current.manychatUrl = url;
    byId.set(event.subscriber_id, current);
  }

  return byId;
}

// Resolve a conversation's prospect identity through the IGSID↔ManyChat bridge.
// Best-effort: where the IGSID isn't bridged yet, the owner is unknown.
function resolveConversation(
  client: ServerClient,
  igsid: string | null,
  assignments: Map<string, Assignment>,
  igToManychat: Map<string, string>,
  manychatToHandle: Map<string, string>,
): LeadMeta {
  const manychatId =
    igsid && assignments.has(igsid)
      ? igsid
      : igsid
        ? igToManychat.get(igsid) ?? null
        : null;
  const assignment = manychatId ? assignments.get(manychatId) ?? null : null;
  const setter = assignment?.setterKey ?? null;
  const handle = manychatId ? manychatToHandle.get(manychatId) ?? null : null;
  const leadName = assignment?.leadName ?? (handle ? `@${handle}` : null);
  const manychatUrl = assignment?.manychatUrl ?? manychatChatUrl(client, manychatId);

  return {
    subscriberId: manychatId || igsid || "unknown",
    client,
    manychatId,
    leadName,
    initialSetter: setter,
    setters: new Set(setter ? [setter] : []),
    manychatUrl,
    newLeadAt: "",
  };
}

// True when the current instant is inside the 11am–11pm ET working window.
function withinEtBusinessHours(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return hour >= 11 && hour < 23;
}

// PostgREST caps one response at 1000 rows, so page through to get the full set.
// Fetch PER CLIENT and merge. PostgREST caps a response at 1000 rows, so a single
// `.in(clients)` query lets a high-volume client (Tyson) fill the cap and starve a
// lower-volume one (Antwan) — which made "All Clients" silently drop Antwan. Giving
// each client its own paged budget guarantees "all" is a true superset.
async function fetchMessages(
  sb: ReturnType<typeof getServiceSupabase>,
  clients: ServerClient[],
  since: string,
): Promise<MessageRow[]> {
  const out: MessageRow[] = [];
  const PAGE = 1000;
  for (const client of clients) {
    for (let page = 0; page < 8; page += 1) {
      const { data, error } = await sb
        .from("dm_conversation_messages")
        .select("client, subscriber_id, conversation_id, direction, body, sent_at")
        .eq("client", client)
        .gte("sent_at", since)
        .order("sent_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as MessageRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

async function fetchTagEvents(
  sb: ReturnType<typeof getServiceSupabase>,
  clients: ServerClient[],
  since: string,
): Promise<TagEventRow[]> {
  const out: TagEventRow[] = [];
  const PAGE = 1000;
  for (const client of clients) {
    for (let page = 0; page < 6; page += 1) {
      const { data, error } = await sb
        .from("manychat_tag_events")
        .select("client, subscriber_id, subscriber_name, setter_name, tag_name, event_at, raw_payload")
        .eq("client", client)
        .gte("event_at", since)
        .order("event_at", { ascending: false })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as TagEventRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

// The IGSID↔ManyChat bridge. Same starvation trap as above — and it was the actual
// "All Clients shows nothing" bug, since this was a single un-paged query.
async function fetchLeadLinks(
  sb: ReturnType<typeof getServiceSupabase>,
  clients: ServerClient[],
): Promise<LeadLinkRow[]> {
  const out: LeadLinkRow[] = [];
  const PAGE = 1000;
  for (const client of clients) {
    for (let page = 0; page < 8; page += 1) {
      const { data, error } = await sb
        .from("instagram_lead_links")
        .select("client, manychat_subscriber_id, instagram_user_id, instagram_handle")
        .eq("client", client)
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as LeadLinkRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
  }
  return out;
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
      // Only replies from go-live onward can count as a miss — clean slate.
      pendingInboundAt = new Date(message.sent_at).getTime() >= GO_LIVE_MS ? message.sent_at : null;
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

// Which Slack alerts have already fired, per stale episode. The values are the
// fire timestamps (used only for retention pruning).
type AlertFlags = { warn4?: number; warn15?: number; tte?: number; deadMeat?: number };
type AlertLog = Record<string, AlertFlags>;

async function loadAlertLog(sb: ReturnType<typeof getServiceSupabase>): Promise<AlertLog> {
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", ALERT_LOG_KEY)
      .maybeSingle();
    if (!data?.value) return {};
    const parsed = JSON.parse(String(data.value));
    return parsed && typeof parsed === "object" ? (parsed as AlertLog) : {};
  } catch (error) {
    console.warn("[sales-hub/time-to-eat] alert log unavailable:", error);
    return {};
  }
}

async function saveAlertLog(sb: ReturnType<typeof getServiceSupabase>, log: AlertLog) {
  const cutoff = Date.now() - ALERT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const [key, flags] of Object.entries(log)) {
    const latest = Math.max(flags.warn4 ?? 0, flags.warn15 ?? 0, flags.tte ?? 0, flags.deadMeat ?? 0);
    if (latest && latest < cutoff) delete log[key];
  }
  await sb.from("app_settings").upsert(
    {
      key: ALERT_LOG_KEY,
      value: JSON.stringify(log),
      updated_at: new Date().toISOString(),
      updated_by: "time-to-eat-alerts",
    },
    { onConflict: "key" },
  );
}

// ── Exempt leads (Booked Call / Subscription Sold / Closed) ────────────────────
// These tags aren't synced into CCOS, so we read them live from ManyChat for the
// handful of candidate leads, and cache the confirmed-exempt ids.

function manychatApiKey(client: ServerClient): string | null {
  if (client === "tyson_sonnek") return process.env.MANYCHAT_API_KEY_TYSON || null;
  if (client === "antwan_rarcus") return process.env.MANYCHAT_API_KEY_ANTWAN || null;
  return null;
}

function tagsAreExempt(tags: string[]): boolean {
  return tags.some((tag) => {
    const name = tag.toLowerCase();
    return EXEMPT_TAG_SUBSTRINGS.some((sub) => name.includes(sub));
  });
}

// A subscriber's current ManyChat tag names, or null if the call failed (which we
// treat as "not exempt" so we never hide a real lead on a transient error).
async function fetchSubscriberTags(client: ServerClient, manychatId: string): Promise<string[] | null> {
  const key = manychatApiKey(client);
  if (!key) return null;
  try {
    const res = await fetch(
      `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(manychatId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as
      | { data?: { tags?: Array<{ name?: unknown }> } }
      | null;
    const tags = body?.data?.tags;
    if (!Array.isArray(tags)) return null;
    return tags.map((t) => (typeof t?.name === "string" ? t.name : "")).filter(Boolean);
  } catch {
    return null;
  }
}

// Run an async fn over items with bounded concurrency (keeps us under ManyChat's
// rate limit while still finishing quickly).
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// manychatId -> { whether booked/sold/closed, when we last checked }. Caching the
// CHECK (not just exempt hits) lets the fast cron skip leads checked recently.
type ExemptEntry = { exempt: boolean; checkedAt: number };
type ExemptCache = Record<string, ExemptEntry>;

async function loadExemptCache(sb: ReturnType<typeof getServiceSupabase>): Promise<ExemptCache> {
  try {
    const { data } = await sb
      .from("app_settings")
      .select("value")
      .eq("key", EXEMPT_CACHE_KEY)
      .maybeSingle();
    if (!data?.value) return {};
    const parsed = JSON.parse(String(data.value));
    return parsed && typeof parsed === "object" ? (parsed as ExemptCache) : {};
  } catch (error) {
    console.warn("[sales-hub/time-to-eat] exempt cache unavailable:", error);
    return {};
  }
}

async function saveExemptCache(sb: ReturnType<typeof getServiceSupabase>, cache: ExemptCache) {
  const cutoff = Date.now() - EXEMPT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const [key, entry] of Object.entries(cache)) {
    if (!entry || entry.checkedAt < cutoff) delete cache[key];
  }
  await sb.from("app_settings").upsert(
    {
      key: EXEMPT_CACHE_KEY,
      value: JSON.stringify(cache),
      updated_at: new Date().toISOString(),
      updated_by: "time-to-eat-exempt",
    },
    { onConflict: "key" },
  );
}

export async function GET(req: NextRequest) {
  const client = normalizeClient(req.nextUrl.searchParams.get("client"));
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Messages are only needed recently — enough to see current threads and recent
  // misses. A 3-day window keeps the paged read cheap, which matters now that the
  // fast cron hits this every ~2 minutes.
  const messagesSince = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
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

    // Slack alerts are driven only by the cron (`sync=1`) so they fire exactly
    // once and even when nobody has the tab open — viewer page-loads never post.
    const isSync = req.nextUrl.searchParams.get("sync") === "1";
    const alertLog: AlertLog = isSync && memoryState.enabled ? await loadAlertLog(sb) : {};
    let alertLogDirty = false;

    // Drop any pre-go-live history so the backlog clears and counts start fresh.
    for (const [key, state] of Object.entries(memory.leads)) {
      const lastInboundMs = state.lastInboundAt ? new Date(state.lastInboundAt).getTime() : 0;
      if (!lastInboundMs || lastInboundMs < GO_LIVE_MS) {
        delete memory.leads[key];
        memoryDirty = true;
      }
    }

    const serverClients: ServerClient[] =
      client === "all" ? (Object.values(CLIENT_MAP) as ServerClient[]) : [CLIENT_MAP[client]];

    // Assignments: who owns / what's the name of each ManyChat subscriber.
    const tagEvents = await fetchTagEvents(sb, serverClients, since);
    const assignments = buildAssignments(tagEvents);

    // Identity bridge: Instagram IGSID ↔ ManyChat subscriber (sparse, best-effort).
    const igToManychat = new Map<string, string>();
    const manychatToHandle = new Map<string, string>();
    try {
      for (const row of await fetchLeadLinks(sb, serverClients)) {
        if (row.instagram_user_id && row.manychat_subscriber_id) {
          igToManychat.set(row.instagram_user_id, row.manychat_subscriber_id);
        }
        if (row.manychat_subscriber_id && row.instagram_handle) {
          manychatToHandle.set(row.manychat_subscriber_id, row.instagram_handle);
        }
      }
    } catch (error) {
      console.warn("[sales-hub/time-to-eat] lead-link bridge unavailable:", error);
    }

    // The live Instagram feed keys messages by IGSID, not the ManyChat id, so we
    // detect stale leads from the conversation THREAD (exactly how Response Times
    // does) and resolve the owner/name through the bridge.
    const allMessages = await fetchMessages(sb, serverClients, messagesSince);

    const messagesByConversation = new Map<string, MessageRow[]>();
    for (const message of allMessages) {
      if (!message.sent_at || !message.conversation_id) continue;
      const list = messagesByConversation.get(message.conversation_id) ?? [];
      list.push(message);
      messagesByConversation.set(message.conversation_id, list);
    }
    for (const list of messagesByConversation.values()) {
      list.sort((a, b) => (a.sent_at! < b.sent_at! ? -1 : a.sent_at! > b.sent_at! ? 1 : 0));
    }

    const conversationLeads = new Map<string, LeadMeta>();
    let unbridgedConversations = 0;
    for (const [conversationId, messages] of messagesByConversation) {
      const serverClient = (messages[0].client as ServerClient) || serverClients[0];
      const inbound = messages.find((m) => m.direction === "inbound");
      const igsid = inbound?.subscriber_id || conversationId.replace(/^instagram:/, "") || null;
      const resolved = resolveConversation(serverClient, igsid, assignments, igToManychat, manychatToHandle);
      // Only conversations that resolve to a known ManyChat lead are actionable
      // (real lead with a name, an owner, and a working steal-link). Unbridged
      // Instagram DMs — organic messages, story replies, spam — are skipped.
      if (!resolved.manychatId) {
        unbridgedConversations += 1;
        continue;
      }
      conversationLeads.set(conversationId, resolved);
    }

    // Exempt leads: anyone tagged Booked Call / Subscription Sold / Closed in
    // ManyChat is done — never list or alert them (they "just replied" but don't
    // need chasing). Cached ids are reused; on cron runs we refresh by checking
    // the live ManyChat tags of any candidate not already known to be exempt.
    const exemptCache: ExemptCache = memoryState.enabled ? await loadExemptCache(sb) : {};
    let exemptCacheDirty = false;

    if (isSync) {
      const nowMs = Date.now();
      const toCheck: LeadMeta[] = [];
      const seenManychatIds = new Set<string>();
      for (const [conversationId, messages] of messagesByConversation.entries()) {
        const lead = conversationLeads.get(conversationId);
        const lastMessage = messages.at(-1);
        if (!lead?.manychatId || !lastMessage?.sent_at || lastMessage.direction !== "inbound") continue;
        if (new Date(lastMessage.sent_at).getTime() < GO_LIVE_MS) continue;
        // Candidate for any alert once it's past the earliest threshold (4 min).
        if (businessMinutesBetween(lastMessage.sent_at, nowIso) < EARLIEST_ALERT_BUSINESS_MINUTES) continue;
        if (seenManychatIds.has(lead.manychatId)) continue;
        // Skip if we checked this lead's tags recently (TTL) — keeps ManyChat calls
        // bounded by time, not by how often the cron runs.
        const cached = exemptCache[lead.manychatId];
        if (cached && nowMs - cached.checkedAt < EXEMPT_CHECK_TTL_MS) continue;
        seenManychatIds.add(lead.manychatId);
        toCheck.push(lead);
      }
      const results = await mapLimit(toCheck, 5, async (lead) => {
        const tags = await fetchSubscriberTags(lead.client, lead.manychatId as string);
        // null tags = API hiccup → treat as not-exempt but DON'T cache, so we retry.
        return { manychatId: lead.manychatId as string, tags };
      });
      for (const result of results) {
        if (result.tags === null) continue;
        exemptCache[result.manychatId] = { exempt: tagsAreExempt(result.tags), checkedAt: nowMs };
        exemptCacheDirty = true;
      }
    }

    const isExempt = (lead: LeadMeta) =>
      Boolean(lead.manychatId && exemptCache[lead.manychatId]?.exempt);

    const timeToEat: TimeToEatLead[] = [];
    const deadMeat: TimeToEatLead[] = [];
    const businessHoursNow = withinEtBusinessHours(new Date());

    // Pass 1 — resolve/reset memory state for conversations we already track.
    for (const [conversationId, messages] of messagesByConversation.entries()) {
      const lead = conversationLeads.get(conversationId);
      const lastMessage = messages.at(-1);
      if (!lead || !lastMessage?.sent_at) continue;
      if (isExempt(lead)) continue;

      const id = memoryId(lead.client, conversationId);
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
          conversationId,
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
          conversationId,
          setters,
          status: "watching",
          lastInboundAt: lastMessage.sent_at,
          updatedAt: nowIso,
        };
        memoryDirty = true;
      }
    }

    // Pass 2 — detect stale leads + fire alerts.
    for (const [conversationId, messages] of messagesByConversation.entries()) {
      const lead = conversationLeads.get(conversationId);
      if (!lead) continue;
      // Booked / Sold / Closed leads are exempt from the lists and every alert.
      if (isExempt(lead)) continue;

      const lastMessage = messages.at(-1);
      if (!lastMessage?.sent_at || lastMessage.direction !== "inbound") continue;
      // No backlog: only leads whose latest reply is after go-live are tracked.
      if (new Date(lastMessage.sent_at).getTime() < GO_LIVE_MS) continue;

      const businessMinutesWaiting = businessMinutesBetween(lastMessage.sent_at, nowIso);

      // Alerts: cron-only, business-hours-only, and only for episodes after the
      // alert go-live (so turning this on never replays the existing backlog).
      const episodeKey = `${conversationId}:${lastMessage.sent_at}`;
      const canAlert =
        isSync &&
        businessHoursNow &&
        new Date(lastMessage.sent_at).getTime() >= ALERTS_GO_LIVE_MS;

      // 4-minute proactive nudge — owner is about to miss the 5-min target.
      // Only in the [4, 8) working-min window so it never fires for already-stale
      // leads (or replays the backlog on first launch).
      if (
        canAlert &&
        businessMinutesWaiting >= RESPONSE_TARGET_WARN_BUSINESS_MINUTES &&
        businessMinutesWaiting < RESPONSE_TARGET_WARN_CEILING_BUSINESS_MINUTES
      ) {
        const flags = alertLog[episodeKey] || (alertLog[episodeKey] = {});
        if (!flags.warn4) {
          await postResponseTargetAlert(lead.client, lead.leadName, lead.initialSetter);
          flags.warn4 = Date.now();
          alertLogDirty = true;
        }
      }

      // 15-minute "answer your lead" nudge — fires once, before the stale line.
      if (canAlert && businessMinutesWaiting >= WARN_AFTER_BUSINESS_MINUTES) {
        const flags = alertLog[episodeKey] || (alertLog[episodeKey] = {});
        if (!flags.warn15) {
          await postAnswerLeadAlert(lead.client, lead.leadName, lead.initialSetter);
          flags.warn15 = Date.now();
          alertLogDirty = true;
        }
      }

      if (businessMinutesWaiting < STALE_AFTER_BUSINESS_MINUTES) continue;
      const waitingHours = hoursSince(lastMessage.sent_at);

      const pastMisses = countPastMisses(messages, messages.length - 1);
      const id = memoryId(lead.client, conversationId);
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
      const totalOccasions = previousMisses + 1;
      // Dead Meat if it slipped twice OR has sat a single 2-working-hour stretch.
      const status: TimeToEatStatus =
        totalOccasions >= DEAD_MEAT_AFTER_MISSES ||
        businessMinutesWaiting >= DEAD_MEAT_AFTER_BUSINESS_MINUTES
          ? "dead_meat"
          : "time_to_eat";
      const manychatUrl = lead.manychatUrl || existing?.manychatUrl || null;
      const setters = [...lead.setters].map(titleName).filter(isString);
      const card = {
        id: episodeKey,
        subscriberId: lead.subscriberId,
        leadName: lead.leadName,
        manychatUrl,
        conversationId,
        lastProspectResponseAt: lastMessage.sent_at,
        hoursSinceProspectResponse: waitingHours,
        initialSetter: titleName(lead.initialSetter),
        setters,
        previousMisses,
        preview: lastMessage.body?.slice(0, 120) || null,
      };

      memory.leads[id] = {
        client: lead.client,
        subscriberId: lead.subscriberId,
        leadName: lead.leadName || existing?.leadName || null,
        manychatUrl,
        conversationId,
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

      // Entry alerts — fire once per episode when the lead lands in a section.
      // A first-occasion lead fires Time to Eat at 1h, then Dead Meat at 2h; a
      // straight-to-Dead-Meat lead only fires the Dead Meat one.
      if (canAlert) {
        const flags = alertLog[episodeKey] || (alertLog[episodeKey] = {});
        if (status === "dead_meat" && !flags.deadMeat) {
          await postDeadMeatAlert(lead.client, lead.leadName, lead.initialSetter);
          flags.deadMeat = Date.now();
          alertLogDirty = true;
        } else if (status === "time_to_eat" && !flags.tte) {
          await postTimeToEatAlert(lead.client, lead.leadName, lead.initialSetter);
          flags.tte = Date.now();
          alertLogDirty = true;
        }
      }
    }

    if (memoryState.enabled && memoryDirty) {
      try {
        await saveMemory(sb, memory);
      } catch (error) {
        console.warn("[sales-hub/time-to-eat] memory save failed:", error);
        warnings.push("Time to Eat loaded, but memory could not be saved.");
      }
    }

    if (isSync && memoryState.enabled && alertLogDirty) {
      try {
        await saveAlertLog(sb, alertLog);
      } catch (error) {
        console.warn("[sales-hub/time-to-eat] alert log save failed:", error);
      }
    }

    if (isSync && memoryState.enabled && exemptCacheDirty) {
      try {
        await saveExemptCache(sb, exemptCache);
      } catch (error) {
        console.warn("[sales-hub/time-to-eat] exempt cache save failed:", error);
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
      // Unanswered Instagram DMs we couldn't tie to a ManyChat lead (and so don't
      // show) — organic/spam, or leads whose IGSID hasn't bridged yet.
      unbridgedConversations,
      // How many leads are currently held back because they're Booked/Sold/Closed.
      exemptLeads: Object.values(exemptCache).filter((e) => e?.exempt).length,
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
