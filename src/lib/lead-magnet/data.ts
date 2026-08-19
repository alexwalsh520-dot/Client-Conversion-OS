/**
 * Lead Magnet funnel data.
 *
 * The funnel: someone DMs for the lead magnet → joins the Skool community →
 * Zapier creates a GHL contact AND pings #fresh-leads ("NEW LEAD - GET ON THE
 * PHONES!"). Phone setters are expected to dial within one minute.
 *
 * Sources, per stage:
 *   - Leads:            #fresh-leads Slack pings from the Zapier "Lead Machine"
 *                       bot are the registry (the GHL "tyson sonnek lead" tag
 *                       also covers DM-funnel contacts, so it over-counts).
 *   - Dials / pickups:  GHL conversation TYPE_CALL messages for the contact
 *                       matched by phone number. Speed to lead = first outbound
 *                       dial after the ping. "Connected" = a completed outbound
 *                       call of at least CONNECT_MIN_SECONDS (short "completed"
 *                       calls are voicemail drops / instant hangups).
 *   - Bookings + sales: the sales tracker sheet is the source of truth. A lead
 *                       is booked when a row with Type of call "Phone Set" /
 *                       "Lead Magnet Phone Set" matches its name. Call Taken
 *                       blank = upcoming; Outcome WIN = close.
 */

import { fetchMonthTabSalesRows, type SheetRow } from "@/lib/google-sheets";

const SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_FRESH_LEADS_CHANNEL = "C0BN7MB13MF";
const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const DEFAULT_LOCATION_ID = "01q51CXSze9vXCGt0tWD";
const ET = "America/New_York";

/** Minimum completed-call duration (seconds) to count as a real connect. */
export const CONNECT_MIN_SECONDS = 30;
/** The team's speed-to-lead target. */
export const SPEED_TARGET_SECONDS = 60;
/** How many leads we enrich against GHL concurrently (PIT limit: 100 req/10s). */
const GHL_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeadCall {
  at: string; // ISO
  direction: "inbound" | "outbound";
  status: string;
  durationSec: number | null;
  userId: string | null; // GHL user who placed the call
}

export interface LeadBooking {
  date: string; // YYYY-MM-DD (call date in the tracker)
  closer: string;
  setter: string;
  callType: string;
  callTakenStatus: "yes" | "no" | "pending";
  outcome: string;
  revenue: number;
  cashCollected: number;
}

export interface LeadJourney {
  slackTs: string;
  pingAt: string; // ISO — the #fresh-leads ping (clock start)
  dateEt: string; // ET day bucket of the ping
  name: string; // display name (GHL name when matched, else Slack name)
  phone: string | null;
  offer: string | null;
  ghlContactId: string | null;
  dials: number;
  firstDialAt: string | null;
  speedToLeadSec: number | null;
  connected: boolean;
  longestCallSec: number | null;
  setter: string | null; // GHL user who made the first dial (name)
  ghlAppointmentAt: string | null; // first GHL appointment created AFTER the ping
  booked: boolean; // GHL appointment exists — bookings run through GHL calendar links
  booking: LeadBooking | null; // sales tracker row (outcome/cash enrichment when logged)
}

export interface ClientStats {
  key: string; // e.g. "tyson"
  label: string; // e.g. "Tyson"
  leads: number; // = Skool joins (one #fresh-leads ping per join)
  dialed: number;
  avgSpeedToLeadSec: number | null;
  medianSpeedToLeadSec: number | null;
  booked: number;
  bookingRate: number | null;
}

export interface SetterStats {
  name: string;
  leadsDialed: number;
  dialedWithinTarget: number;
  avgSpeedToLeadSec: number | null;
  medianSpeedToLeadSec: number | null;
  pickups: number;
  bookings: number;
}

export interface FunnelMetrics {
  leads: number;
  dialed: number;
  connected: number;
  booked: number;
  decided: number; // booked calls with Call Taken filled in (yes or no)
  shows: number;
  wins: number;
  paidWins: number; // wins with cash collected > 0
  totalCash: number;
  totalRevenue: number;
  avgSpeedToLeadSec: number | null;
  medianSpeedToLeadSec: number | null;
  withinTargetRate: number | null; // leads dialed within SPEED_TARGET_SECONDS / leads
  pickupRate: number | null; // connected / dialed
  bookingRate: number | null; // booked / leads
  showRate: number | null; // shows / decided (upcoming excluded)
  closeRate: number | null; // wins / shows
  aov: number | null; // cash / paid wins
  revenuePerLead: number | null; // cash / leads
}

export interface LeadMagnetReport {
  from: string;
  to: string;
  generatedAt: string;
  slackError: string | null; // set when #fresh-leads can't be read (setup needed)
  metrics: FunnelMetrics;
  clients: ClientStats[]; // per-offer split (Tyson / Jake / …) + "all" total row
  setters: SetterStats[];
  leadList: LeadJourney[];
  /** Phone-set tracker rows in range that didn't match any Slack lead. */
  unmatchedBookings: LeadBooking[];
  connectMinSeconds: number;
  speedTargetSeconds: number;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function getSlackToken(): string | null {
  return process.env.SLACK_BOT_TOKEN?.trim() || null;
}

function getFreshLeadsChannel(): string {
  return process.env.SLACK_CHANNEL_FRESH_LEADS?.trim() || DEFAULT_FRESH_LEADS_CHANNEL;
}

function getGhlToken(): string {
  const token = process.env.GHL_API_KEY?.trim();
  if (!token) throw new Error("Missing environment variable GHL_API_KEY");
  return token;
}

function getLocationId(): string {
  return process.env.GHL_LOCATION_ID?.trim() || DEFAULT_LOCATION_ID;
}

function etDay(iso: string | number | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

/** Last 10 digits — good enough to match US numbers across +1 formatting. */
function phoneKey(raw: string | null | undefined): string | null {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

/** Lowercase letters only — "JosephRoemer" and "Joseph Roemer " both → "josephroemer". */
function nameKey(raw: string | null | undefined): string {
  return (raw || "").toLowerCase().replace(/[^a-z]/g, "");
}

/** "ERIN" (tracker Setter column) → "Erin" so it merges with GHL user names. */
function titleCaseName(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .trim();
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Stage 1 — Slack lead registry
// ---------------------------------------------------------------------------

interface SlackLead {
  slackTs: string;
  pingAt: string;
  dateEt: string;
  slackName: string;
  phone: string | null;
  offer: string | null;
}

function readField(text: string, label: string): string | null {
  const match = text.match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"));
  return match?.[1]?.trim() || null;
}

/**
 * Pull the Zapier "NEW LEAD" pings from #fresh-leads for an ET date range.
 * Throws SlackReadError when the channel can't be read so the caller can show
 * setup guidance instead of silently reporting zero leads.
 */
export class SlackReadError extends Error {}

async function fetchSlackLeads(from: string, to: string): Promise<SlackLead[]> {
  const token = getSlackToken();
  if (!token) throw new SlackReadError("SLACK_BOT_TOKEN is not configured");

  const channel = getFreshLeadsChannel();
  // Pad a day each side (UTC boundaries) and filter to ET days afterwards.
  const oldest = String(Math.floor(Date.parse(`${addDays(from, -1)}T00:00:00.000Z`) / 1000));
  const latest = String(Math.floor(Date.parse(`${addDays(to, 1)}T23:59:59.999Z`) / 1000));

  const leads: SlackLead[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 20; page++) {
    const params = new URLSearchParams({ channel, oldest, latest, limit: "200", inclusive: "true" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${SLACK_API_BASE}/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) throw new SlackReadError(`Slack API HTTP ${res.status}`);
    const data = (await res.json()) as {
      ok: boolean;
      error?: string;
      has_more?: boolean;
      response_metadata?: { next_cursor?: string };
      messages?: Array<{ ts?: string; text?: string; bot_id?: string }>;
    };
    if (!data.ok) throw new SlackReadError(data.error || "unknown Slack error");

    for (const msg of data.messages || []) {
      const text = msg.text || "";
      if (!msg.ts || !/NEW LEAD/i.test(text)) continue;
      const pingAt = new Date(Number(msg.ts) * 1000).toISOString();
      const dateEt = etDay(pingAt);
      if (dateEt < from || dateEt > to) continue;
      leads.push({
        slackTs: msg.ts,
        pingAt,
        dateEt,
        slackName: readField(text, "Name") || "Unknown",
        phone: phoneKey(readField(text, "Number")),
        offer: readField(text, "Offer"),
      });
    }

    cursor = data.response_metadata?.next_cursor || undefined;
    if (!data.has_more || !cursor) break;
  }

  // Zapier occasionally re-fires; keep the earliest ping per phone number.
  leads.sort((a, b) => a.pingAt.localeCompare(b.pingAt));
  const seen = new Set<string>();
  return leads.filter((lead) => {
    const key = lead.phone || `ts:${lead.slackTs}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Stage 2 — GHL calls per lead
// ---------------------------------------------------------------------------

interface GhlEnrichment {
  contactId: string | null;
  firstName: string;
  lastName: string;
  calls: LeadCall[];
  appointmentTimes: string[]; // every appointment-created activity (caller filters to post-ping)
}

async function ghlFetch(path: string, init?: RequestInit): Promise<Response> {
  // One retry on rate-limit/server errors — a silently dropped lookup reads as
  // "this lead was never dialed", which is worse than a slower request.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${GHL_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${getGhlToken()}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (attempt >= 2 || (res.status !== 429 && res.status < 500)) return res;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
}

async function enrichFromGhl(phone: string | null): Promise<GhlEnrichment> {
  const empty: GhlEnrichment = { contactId: null, firstName: "", lastName: "", calls: [], appointmentTimes: [] };
  if (!phone) return empty;

  const searchRes = await ghlFetch("/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      locationId: getLocationId(),
      pageLimit: 3,
      filters: [{ field: "phone", operator: "contains", value: phone }],
    }),
  });
  if (!searchRes.ok) return empty;
  const search = (await searchRes.json()) as {
    contacts?: Array<{ id: string; firstNameLowerCase?: string; lastNameLowerCase?: string }>;
  };
  const contact = search.contacts?.[0];
  if (!contact) return empty;

  const convRes = await ghlFetch(
    `/conversations/search?locationId=${getLocationId()}&contactId=${contact.id}`,
  );
  const conversations: Array<{ id: string }> = convRes.ok
    ? ((await convRes.json()) as { conversations?: Array<{ id: string }> }).conversations || []
    : [];

  const calls: LeadCall[] = [];
  const appointmentTimes: string[] = [];

  for (const conv of conversations.slice(0, 5)) {
    const msgRes = await ghlFetch(`/conversations/${conv.id}/messages?limit=100`);
    if (!msgRes.ok) continue;
    const payload = (await msgRes.json()) as {
      messages?: {
        messages?: Array<{
          messageType?: string;
          direction?: string;
          status?: string;
          dateAdded?: string;
          userId?: string;
          meta?: { call?: { duration?: number | null } };
        }>;
      };
    };
    for (const msg of payload.messages?.messages || []) {
      if (!msg.dateAdded) continue;
      if (msg.messageType === "TYPE_CALL") {
        calls.push({
          at: msg.dateAdded,
          direction: msg.direction === "inbound" ? "inbound" : "outbound",
          status: msg.status || "unknown",
          durationSec: msg.meta?.call?.duration ?? null,
          userId: msg.userId || null,
        });
      } else if (msg.messageType === "TYPE_ACTIVITY_APPOINTMENT") {
        appointmentTimes.push(msg.dateAdded);
      }
    }
  }

  calls.sort((a, b) => a.at.localeCompare(b.at));
  return {
    contactId: contact.id,
    firstName: contact.firstNameLowerCase || "",
    lastName: contact.lastNameLowerCase || "",
    calls,
    appointmentTimes: appointmentTimes.sort(),
  };
}

/** Resolve GHL user IDs to display first names (per-request cache). */
async function fetchUserNames(userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  await mapWithConcurrency(userIds, 3, async (id) => {
    try {
      const res = await ghlFetch(`/users/${id}`);
      if (!res.ok) return;
      const user = (await res.json()) as { name?: string; firstName?: string };
      const name = user.firstName || user.name?.split(" ")[0];
      if (name) names.set(id, name);
    } catch {
      // Unresolvable user — the setter shows by raw id below.
    }
  });
  return names;
}

// ---------------------------------------------------------------------------
// Stage 3 — sales tracker bookings (source of truth)
// ---------------------------------------------------------------------------

function isPhoneSetRow(row: SheetRow): boolean {
  // "Phone Set" and "Lead Magnet Phone Set" both count.
  return nameKey(row.callType).includes("phoneset");
}

function toBooking(row: SheetRow): LeadBooking {
  return {
    date: row.date,
    closer: row.closer,
    setter: row.setter,
    callType: row.callType,
    callTakenStatus: row.callTakenStatus,
    outcome: row.outcome,
    revenue: row.revenue,
    cashCollected: row.cashCollected,
  };
}

/** All phone-set tracker rows from the month of `from` through the current ET month. */
async function fetchPhoneSetRows(from: string): Promise<SheetRow[]> {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const today = etDay(new Date());
  const [toYear, toMonth] = today.split("-").map(Number);

  const months: Array<{ year: number; month: number }> = [];
  let y = fromYear;
  let m = fromMonth;
  while (y < toYear || (y === toYear && m <= toMonth)) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }

  const rowsByMonth = await Promise.all(
    months.map(({ year, month }) => fetchMonthTabSalesRows(year, month).catch(() => [] as SheetRow[])),
  );
  return rowsByMonth.flat().filter(isPhoneSetRow);
}

/**
 * Pick the best tracker row for a lead when several match (rebooks): a WIN
 * beats everything, then a decided call beats an upcoming one, then latest.
 */
function pickBooking(rows: SheetRow[]): SheetRow {
  return [...rows].sort((a, b) => {
    const winDiff = Number(b.outcome === "WIN") - Number(a.outcome === "WIN");
    if (winDiff) return winDiff;
    const decidedDiff =
      Number(b.callTakenStatus !== "pending") - Number(a.callTakenStatus !== "pending");
    if (decidedDiff) return decidedDiff;
    return b.date.localeCompare(a.date);
  })[0];
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export async function buildLeadMagnetReport(from: string, to: string): Promise<LeadMagnetReport> {
  let slackError: string | null = null;
  let slackLeads: SlackLead[] = [];
  try {
    slackLeads = await fetchSlackLeads(from, to);
  } catch (err) {
    if (err instanceof SlackReadError) slackError = err.message;
    else throw err;
  }

  const [enrichments, phoneSetRows] = await Promise.all([
    mapWithConcurrency(slackLeads, GHL_CONCURRENCY, (lead) =>
      enrichFromGhl(lead.phone).catch(() => ({
        contactId: null,
        firstName: "",
        lastName: "",
        calls: [] as LeadCall[],
        appointmentTimes: [] as string[],
      })),
    ),
    fetchPhoneSetRows(from).catch(() => [] as SheetRow[]),
  ]);

  const claimedRowKeys = new Set<SheetRow>();

  const drafts = slackLeads.map((lead, i) => {
    const ghl = enrichments[i];
    // Only calls from just before the ping onward belong to this funnel —
    // a matched contact may be older than the ping (e.g. re-opt-in).
    const cutoff = new Date(Date.parse(lead.pingAt) - 120000).toISOString();
    const outbound = ghl.calls.filter((c) => c.direction === "outbound" && c.at >= cutoff);
    const firstDial = outbound[0] || null;
    const speedToLeadSec = firstDial
      ? Math.max(0, Math.round((Date.parse(firstDial.at) - Date.parse(lead.pingAt)) / 1000))
      : null;
    const connects = outbound.filter(
      (c) => c.status === "completed" && (c.durationSec ?? 0) >= CONNECT_MIN_SECONDS,
    );
    const longestCallSec = outbound.reduce<number | null>(
      (max, c) => (c.durationSec !== null && c.durationSec > (max ?? -1) ? c.durationSec : max),
      null,
    );

    const ghlName = `${ghl.firstName} ${ghl.lastName}`.trim();
    const keys = new Set([nameKey(lead.slackName), nameKey(ghlName)].filter(Boolean));
    const matches = phoneSetRows.filter(
      (row) => keys.has(nameKey(row.name)) && row.date >= lead.dateEt,
    );
    const bookingRow = matches.length ? pickBooking(matches) : null;
    if (bookingRow) matches.forEach((row) => claimedRowKeys.add(row));

    // Booked = a GHL appointment created after the ping (the team books through
    // GHL calendar links). Pre-ping appointments belong to earlier journeys.
    const appointmentAt = ghl.appointmentTimes.find((t) => t >= cutoff) || null;

    return {
      journey: {
        slackTs: lead.slackTs,
        pingAt: lead.pingAt,
        dateEt: lead.dateEt,
        name: ghlName || lead.slackName.replace(/([a-z])([A-Z])/g, "$1 $2"),
        phone: lead.phone,
        offer: lead.offer,
        ghlContactId: ghl.contactId,
        dials: outbound.length,
        firstDialAt: firstDial?.at || null,
        speedToLeadSec,
        connected: connects.length > 0,
        longestCallSec,
        setter: null as string | null,
        ghlAppointmentAt: appointmentAt,
        booked: appointmentAt !== null,
        booking: bookingRow ? toBooking(bookingRow) : null,
      },
      firstDialUserId: firstDial?.userId || null,
    };
  });

  // Name the setter on each lead: the GHL user who made the first dial. The
  // tracker's Setter column wins for bookings when it's filled in.
  const dialUserIds = [...new Set(drafts.map((d) => d.firstDialUserId).filter((id): id is string => !!id))];
  const userNames = await fetchUserNames(dialUserIds);
  const leadList: LeadJourney[] = drafts.map((d) => ({
    ...d.journey,
    setter: d.firstDialUserId ? userNames.get(d.firstDialUserId) || d.firstDialUserId : null,
  }));

  const unmatchedBookings = phoneSetRows
    .filter((row) => !claimedRowKeys.has(row) && row.date >= from && row.date <= to)
    .map(toBooking);

  const speeds = leadList
    .map((l) => l.speedToLeadSec)
    .filter((s): s is number => s !== null);
  // Booked = GHL appointment after the ping. Tracker rows still feed the
  // sales substats (show/win/cash) for the leads that do get logged there.
  const bookedLeads = leadList.filter((l) => l.booked);
  const trackerBooked = leadList.filter((l) => l.booking);
  const decided = trackerBooked.filter((l) => l.booking!.callTakenStatus !== "pending");
  const shows = trackerBooked.filter((l) => l.booking!.callTakenStatus === "yes");
  const wins = trackerBooked.filter((l) => l.booking!.outcome === "WIN");
  const paidWins = wins.filter((l) => l.booking!.cashCollected > 0);
  const totalCash = trackerBooked.reduce((sum, l) => sum + l.booking!.cashCollected, 0);
  const totalRevenue = trackerBooked.reduce((sum, l) => sum + l.booking!.revenue, 0);
  const dialed = leadList.filter((l) => l.dials > 0);
  const connected = leadList.filter((l) => l.connected);

  const metrics: FunnelMetrics = {
    leads: leadList.length,
    dialed: dialed.length,
    connected: connected.length,
    booked: bookedLeads.length,
    decided: decided.length,
    shows: shows.length,
    wins: wins.length,
    paidWins: paidWins.length,
    totalCash,
    totalRevenue,
    avgSpeedToLeadSec: speeds.length
      ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)
      : null,
    medianSpeedToLeadSec: median(speeds),
    withinTargetRate: ratio(
      speeds.filter((s) => s <= SPEED_TARGET_SECONDS).length,
      leadList.length,
    ),
    pickupRate: ratio(connected.length, dialed.length),
    bookingRate: ratio(bookedLeads.length, leadList.length),
    showRate: ratio(shows.length, decided.length),
    closeRate: ratio(wins.length, shows.length),
    aov: paidWins.length ? totalCash / paidWins.length : null,
    revenuePerLead: ratio(totalCash, leadList.length),
  };

  // Per-setter cut. Dial stats go to whoever made the first GHL dial; a
  // booking goes to the tracker's Setter column when filled, else the dialer.
  const setterMap = new Map<string, SetterStats & { speeds: number[] }>();
  const setterFor = (name: string) => {
    const existing = setterMap.get(name);
    if (existing) return existing;
    const fresh = {
      name,
      leadsDialed: 0,
      dialedWithinTarget: 0,
      avgSpeedToLeadSec: null,
      medianSpeedToLeadSec: null,
      pickups: 0,
      bookings: 0,
      speeds: [] as number[],
    };
    setterMap.set(name, fresh);
    return fresh;
  };
  for (const lead of leadList) {
    if (lead.setter) {
      const s = setterFor(lead.setter);
      s.leadsDialed += 1;
      if (lead.speedToLeadSec !== null) {
        s.speeds.push(lead.speedToLeadSec);
        if (lead.speedToLeadSec <= SPEED_TARGET_SECONDS) s.dialedWithinTarget += 1;
      }
      if (lead.connected) s.pickups += 1;
    }
    if (lead.booked) {
      const bookingSetter =
        (lead.booking?.setter && titleCaseName(lead.booking.setter)) || lead.setter;
      if (bookingSetter) setterFor(bookingSetter).bookings += 1;
    }
  }
  const setters: SetterStats[] = [...setterMap.values()]
    .map(({ speeds, ...s }) => ({
      ...s,
      avgSpeedToLeadSec: speeds.length
        ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length)
        : null,
      medianSpeedToLeadSec: median(speeds),
    }))
    .sort((a, b) => b.leadsDialed - a.leadsDialed || b.bookings - a.bookings);

  // Per-client cut, keyed off the ping's Offer field ("Tyson Sonnek" /
  // "Jake Divljak" / anything new lands in its own row). "All" totals last.
  const clientLabel = (offer: string | null) => {
    const key = nameKey(offer);
    if (key.includes("tyson")) return "Tyson";
    if (key.includes("jake")) return "Jake";
    return (offer || "Unknown").trim();
  };
  const clientStatsFor = (label: string, group: LeadJourney[]): ClientStats => {
    const groupSpeeds = group
      .map((l) => l.speedToLeadSec)
      .filter((s): s is number => s !== null);
    const groupBooked = group.filter((l) => l.booked).length;
    return {
      key: nameKey(label) || "unknown",
      label,
      leads: group.length,
      dialed: group.filter((l) => l.dials > 0).length,
      avgSpeedToLeadSec: groupSpeeds.length
        ? Math.round(groupSpeeds.reduce((a, b) => a + b, 0) / groupSpeeds.length)
        : null,
      medianSpeedToLeadSec: median(groupSpeeds),
      booked: groupBooked,
      bookingRate: ratio(groupBooked, group.length),
    };
  };
  const byClient = new Map<string, LeadJourney[]>();
  for (const lead of leadList) {
    const label = clientLabel(lead.offer);
    byClient.set(label, [...(byClient.get(label) || []), lead]);
  }
  const clients: ClientStats[] = [...byClient.entries()]
    .map(([label, group]) => clientStatsFor(label, group))
    .sort((a, b) => b.leads - a.leads);
  if (clients.length > 1) clients.push({ ...clientStatsFor("All", leadList), key: "all" });

  return {
    from,
    to,
    generatedAt: new Date().toISOString(),
    slackError,
    metrics,
    clients,
    setters,
    leadList: leadList.sort((a, b) => b.pingAt.localeCompare(a.pingAt)),
    unmatchedBookings,
    connectMinSeconds: CONNECT_MIN_SECONDS,
    speedTargetSeconds: SPEED_TARGET_SECONDS,
  };
}
