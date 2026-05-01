import { getServiceSupabase } from "@/lib/supabase";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import { displayKeyword, keywordFromAdName, normalizeKeyword, normalizePersonName } from "./normalize";

export type AdsTrackerAccount = "all" | "tyson" | "keith";
export type AdsTrackerStatus = "active" | "finished" | "all";
export type AdsTrackerLevel = "campaign" | "ad";

export interface AdsTrackerQuery {
  account: AdsTrackerAccount;
  status: AdsTrackerStatus;
  level: AdsTrackerLevel;
  dateFrom: string;
  dateTo: string;
}

interface MetaRow {
  client_key: string;
  client_name: string;
  ad_account_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  ad_effective_status: string | null;
  campaign_effective_status: string | null;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  date: string;
  spend_cents: number;
  impressions: number;
  link_clicks: number;
  synced_at: string | null;
}

interface KeywordEvent {
  source: "manychat" | "ghl";
  event_type: string;
  client_key: string;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  value_cents?: number | null;
  subscriber_id: string | null;
  subscriber_name: string | null;
  setter_name: string | null;
  appointment_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  event_at: string;
}

interface GhlAppointmentRow {
  appointment_id: string | null;
  client: string | null;
  contact_id: string | null;
  contact_name: string | null;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  start_time: string | null;
  created_at: string | null;
  status: string | null;
  event_type: string | null;
  raw_payload: unknown;
}

interface ManychatContactLinkRow {
  client: string;
  subscriber_id: string;
  ghl_contact_id: string;
}

interface KeywordBackfillRow {
  client_key: string;
  client_name: string;
  date: string;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  messages: number | null;
  booked_calls: number | null;
  calls_taken: number | null;
  new_clients: number | null;
  contracted_revenue_cents: number | null;
  collected_revenue_cents: number | null;
  source_workbook: string | null;
  source_sheet: string | null;
  raw_payload: unknown;
}

interface SalesTrackerDbRow {
  call_number: string | null;
  date: string;
  prospect_name: string | null;
  call_taken: boolean | null;
  call_taken_status: string | null;
  call_length: string | null;
  recorded: boolean | null;
  outcome: string | null;
  closer: string | null;
  objection: string | null;
  program_length: string | null;
  contracted_revenue_cents: number | null;
  collected_revenue_cents: number | null;
  payment_method: string | null;
  setter: string | null;
  call_notes: string | null;
  recording_link: string | null;
  offer: string | null;
}

export interface AdsTrackerRow {
  id: string;
  clientKey: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
  keyword: string;
  dateLabel: string;
  adSpend: number;
  impressions: number;
  linkClicks: number;
  cpm: number;
  ctr: number;
  cpc: number;
  messages: number;
  costPerMessage: number | null;
  bookedCalls: number;
  costPerBookedCall: number | null;
  callsTaken: number;
  costPerCallTaken: number | null;
  newClients: number;
  mainOfferClients: number;
  subscriptionClients: number;
  contractedRevenue: number;
  callClosingRate: number;
  messagesConversionRate: number;
  collectedRevenue: number;
  costPerNewClient: number | null;
  contractedRoi: number;
  collectedRoi: number;
  status: "active" | "finished";
}

interface SalesAttributionOptions {
  groupId?: (match: KeywordEvent, row: SheetRow) => string;
  dateLabel?: (match: KeywordEvent, row: SheetRow) => string;
  groupName?: (match: KeywordEvent, row: SheetRow) => string;
  includeOutcomeMetrics?: (match: KeywordEvent, row: SheetRow) => boolean;
  includeCallTakenMetrics?: (match: KeywordEvent, row: SheetRow) => boolean;
  includeClientSplitMetrics?: (match: KeywordEvent, row: SheetRow) => boolean;
  includeUnmatchedSales?: (row: SheetRow, clientKey: string | null) => boolean;
}

interface Group {
  id: string;
  clientKey: string;
  name: string;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
  keyword: string;
  dateLabel: string;
  adSpendCents: number;
  impressions: number;
  linkClicks: number;
  messages: number;
  bookedCalls: number;
  callsTaken: number;
  newClients: number;
  mainOfferClients: number;
  subscriptionClients: number;
  contractedRevenue: number;
  collectedRevenue: number;
  status: "active" | "finished";
}

interface UnmatchedSale {
  date: string;
  clientKey: string | null;
  name: string;
  setter: string;
  outcome: string;
  callTaken: boolean;
  contractedRevenue: number;
  collectedRevenue: number;
  amount: number;
  reason: "missing_sales_name" | "no_matching_ghl_booking" | "missing_booking_keyword";
  classification: "organic_or_unattributed";
}

interface BuildPayloadOptions {
  unmatchedSales?: UnmatchedSale[];
  salesCollectedRevenue?: number;
  sourceStatus?: Record<string, unknown>;
}

interface AdsSyncRunRow {
  date_from: string | null;
  date_to: string | null;
  completed_at: string | null;
  accounts: unknown;
}

interface BackfillGroupHint {
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
}

function emptyGroup(id: string, clientKey: string, name: string, keyword: string): Group {
  return {
    id,
    clientKey,
    name,
    campaignId: null,
    campaignName: null,
    adId: null,
    adName: null,
    keyword,
    dateLabel: "",
    adSpendCents: 0,
    impressions: 0,
    linkClicks: 0,
    messages: 0,
    bookedCalls: 0,
    callsTaken: 0,
    newClients: 0,
    mainOfferClients: 0,
    subscriptionClients: 0,
    contractedRevenue: 0,
    collectedRevenue: 0,
    status: "active",
  };
}

function dollars(cents: number): number {
  return cents / 100;
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function finalizeGroup(group: Group): AdsTrackerRow {
  const adSpend = dollars(group.adSpendCents);
  const hasClientSplit = group.mainOfferClients > 0 || group.subscriptionClients > 0;
  return {
    id: group.id,
    clientKey: group.clientKey,
    name: group.name,
    campaignId: group.campaignId,
    campaignName: group.campaignName,
    adId: group.adId,
    adName: group.adName,
    keyword: group.keyword,
    dateLabel: group.dateLabel,
    adSpend,
    impressions: group.impressions,
    linkClicks: group.linkClicks,
    cpm: safeDiv(adSpend, group.impressions) * 1000,
    ctr: safeDiv(group.linkClicks, group.impressions) * 100,
    cpc: safeDiv(adSpend, group.linkClicks),
    messages: group.messages,
    costPerMessage: group.messages > 0 ? adSpend / group.messages : null,
    bookedCalls: group.bookedCalls,
    costPerBookedCall: group.bookedCalls > 0 ? adSpend / group.bookedCalls : null,
    callsTaken: group.callsTaken,
    costPerCallTaken: group.callsTaken > 0 ? adSpend / group.callsTaken : null,
    newClients: group.newClients,
    mainOfferClients: hasClientSplit ? group.mainOfferClients : group.newClients,
    subscriptionClients: group.subscriptionClients,
    contractedRevenue: group.contractedRevenue,
    callClosingRate: safeDiv(group.newClients, group.callsTaken || group.bookedCalls) * 100,
    messagesConversionRate: safeDiv(group.bookedCalls, group.messages) * 100,
    collectedRevenue: group.collectedRevenue,
    costPerNewClient: group.newClients > 0 ? adSpend / group.newClients : null,
    contractedRoi: safeDiv(group.contractedRevenue, adSpend),
    collectedRoi: safeDiv(group.collectedRevenue, adSpend),
    status: group.status,
  };
}

function metaRowStatus(row: MetaRow): "active" | "finished" {
  const effectiveStatus = (row.ad_effective_status || row.campaign_effective_status || "").toUpperCase();
  if (!effectiveStatus) return "active";
  return effectiveStatus === "ACTIVE" ? "active" : "finished";
}

function applyGroupStatus(group: Group, status: "active" | "finished") {
  if (status === "active") {
    group.status = "active";
    return;
  }
  if (group.adSpendCents === 0 && group.impressions === 0 && group.linkClicks === 0) {
    group.status = "finished";
  }
}

function clientFromOffer(row: SheetRow): string | null {
  const offer = row.offer.toLowerCase();
  if (offer.includes("tyson")) return "tyson";
  if (offer.includes("keith")) return "keith";
  return null;
}

function isWin(row: SheetRow): boolean {
  return row.outcome.includes("WIN");
}

function isSubscriptionSale(row: SheetRow): boolean {
  const amount = row.cashCollected > 0 ? row.cashCollected : row.revenue;
  return Math.abs(amount - 50) < 0.01;
}

function saleAmount(row: SheetRow): number {
  return row.cashCollected || 0;
}

function shouldTrackUnmatchedSale(row: SheetRow): boolean {
  return saleAmount(row) > 0 || row.revenue > 0 || isWin(row) || (row.callTaken && !isNoShow(row));
}

function unmatchedSale(
  row: SheetRow,
  clientKey: string | null,
  reason: UnmatchedSale["reason"]
): UnmatchedSale {
  return {
    date: row.date,
    clientKey,
    name: row.name || "Unknown",
    setter: row.setter || "",
    outcome: row.outcome || "",
    callTaken: row.callTaken && !isNoShow(row),
    contractedRevenue: row.revenue || 0,
    collectedRevenue: row.cashCollected || 0,
    amount: saleAmount(row),
    reason,
    classification: "organic_or_unattributed",
  };
}

function inferBackfillSubscriptionClients(row: KeywordBackfillRow): number {
  const newClients = row.new_clients || 0;
  if (newClients <= 0) return 0;

  const collected = dollars(row.collected_revenue_cents || 0);
  const contracted = dollars(row.contracted_revenue_cents || 0);
  const amount = collected > 0 ? collected : contracted;

  // Backfill rows are aggregated by keyword/day, so only classify rows where
  // every recorded client was the known $50 subscription product.
  return Math.abs(amount - newClients * 50) < 0.01 ? newClients : 0;
}

function isNoShow(row: SheetRow): boolean {
  return row.outcome.includes("NS") || row.callTakenStatus === "no";
}

function eventDateKey(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function datesInRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  for (let date = dateFrom; date <= dateTo; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function isWithinDashboardDateRange(value: string | null | undefined, query: AdsTrackerQuery) {
  const date = eventDateKey(value);
  return date >= query.dateFrom && date <= query.dateTo;
}

function looksLikeTestName(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return (
    normalized.includes("brozygaytest") ||
    normalized.includes("brozisgay") ||
    normalized.includes("clientconversionagencyforfitnessinfluencers")
  );
}

function isTestKeywordEvent(event: KeywordEvent): boolean {
  return (
    looksLikeTestName(event.contact_name) ||
    looksLikeTestName(event.subscriber_name)
  );
}

function adsClientMatchesContactLink(adsClient: string, linkClient: string | null | undefined) {
  if (!linkClient) return false;
  const normalized = linkClient.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (adsClient === "tyson") return normalized === "tyson" || normalized === "tyson_sonnek";
  if (adsClient === "keith") return normalized === "keith" || normalized === "keith_holland";
  return normalized === adsClient;
}

function extractStringByKeys(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== "object") return null;
  const targetKeys = new Set(keys);
  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (targetKeys.has(key) && typeof value === "string" && value.trim()) {
        return value.trim();
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

function extractManychatSubscriberId(payload: unknown): string | null {
  return extractStringByKeys(payload, [
    "manychat_user_id",
    "manychatUserId",
    "manychat_userid",
    "subscriber_id",
    "subscriberId",
  ]);
}

function eventTimeWithLag(value: string | null | undefined): number {
  if (!value) return Date.now();
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? Date.now() : time + 60 * 60 * 1000;
}

function isBookableAppointment(row: GhlAppointmentRow) {
  const status = (row.status || "").toLowerCase();
  const eventType = (row.event_type || "").toLowerCase();
  return !status.includes("cancel") && !eventType.includes("cancel");
}

async function buildSupplementalGhlKeywordEvents(
  db: ReturnType<typeof getServiceSupabase>,
  appointments: GhlAppointmentRow[],
  keywordEvents: KeywordEvent[],
  clientFilter: string[]
): Promise<KeywordEvent[]> {
  const existingGhlAppointmentIds = new Set(
    keywordEvents
      .filter((event) => event.source === "ghl" && event.appointment_id)
      .map((event) => event.appointment_id as string)
  );
  const contactIds = [
    ...new Set(
      appointments
        .map((appointment) => appointment.contact_id)
        .filter((value): value is string => Boolean(value))
    ),
  ];
  const subscriberIdsByContactId = new Map<string, string>();
  for (const appointment of appointments) {
    if (!appointment.contact_id) continue;
    const subscriberId = extractManychatSubscriberId(appointment.raw_payload);
    if (subscriberId) subscriberIdsByContactId.set(appointment.contact_id, subscriberId);
  }

  let contactLinks: ManychatContactLinkRow[] = [];
  if (contactIds.length > 0) {
    const { data, error } = await db
      .from("manychat_contact_links")
      .select("client,subscriber_id,ghl_contact_id")
      .in("ghl_contact_id", contactIds);

    if (error) {
      console.warn("[ads-tracker] ManyChat contact-link fallback unavailable", error);
    } else {
      contactLinks = (data || []) as ManychatContactLinkRow[];
    }
  }

  const contactLinksByContactId = new Map<string, ManychatContactLinkRow[]>();
  for (const link of contactLinks) {
    const list = contactLinksByContactId.get(link.ghl_contact_id) || [];
    list.push(link);
    contactLinksByContactId.set(link.ghl_contact_id, list);
  }

  const manychatEvents = keywordEvents
    .filter((event) => event.source === "manychat")
    .filter((event) => Boolean(event.subscriber_id && event.keyword_normalized))
    .sort((a, b) => b.event_at.localeCompare(a.event_at));

  const supplemental: KeywordEvent[] = [];
  for (const appointment of appointments) {
    if (!appointment.appointment_id || !appointment.client) continue;
    if (!clientFilter.includes(appointment.client)) continue;
    if (existingGhlAppointmentIds.has(appointment.appointment_id)) continue;
    if (!isBookableAppointment(appointment)) continue;

    const appointmentEventAt =
      appointment.created_at || appointment.start_time || new Date().toISOString();
    let keywordNormalized = normalizeKeyword(
      appointment.keyword_normalized || appointment.keyword_raw
    );
    let keywordRaw = keywordNormalized ? displayKeyword(keywordNormalized) : null;
    let subscriberId =
      extractManychatSubscriberId(appointment.raw_payload) ||
      (appointment.contact_id ? subscriberIdsByContactId.get(appointment.contact_id) : null) ||
      null;

    if (!keywordNormalized) {
      const contactLinksForAppointment = appointment.contact_id
        ? contactLinksByContactId.get(appointment.contact_id) || []
        : [];
      const matchingLink = contactLinksForAppointment.find((link) =>
        adsClientMatchesContactLink(appointment.client as string, link.client)
      );
      subscriberId = subscriberId || matchingLink?.subscriber_id || null;

      if (subscriberId) {
        const latestManychatKeyword = manychatEvents.find((event) => {
          if (event.subscriber_id !== subscriberId) return false;
          if (event.client_key !== appointment.client) return false;
          return new Date(event.event_at).getTime() <= eventTimeWithLag(appointmentEventAt);
        });
        keywordNormalized = normalizeKeyword(
          latestManychatKeyword?.keyword_normalized || latestManychatKeyword?.keyword_raw
        );
        keywordRaw = keywordNormalized ? displayKeyword(keywordNormalized) : null;
      }
    }

    if (!keywordNormalized) continue;

    supplemental.push({
      source: "ghl",
      event_type: "booked_call",
      client_key: appointment.client,
      keyword_raw: keywordRaw,
      keyword_normalized: keywordNormalized,
      subscriber_id: subscriberId,
      subscriber_name: null,
      setter_name: null,
      appointment_id: appointment.appointment_id,
      contact_id: appointment.contact_id,
      contact_name: appointment.contact_name,
      event_at: appointmentEventAt,
    });
  }

  return supplemental;
}

function isTestSalesRow(row: SheetRow): boolean {
  return looksLikeTestName(row.name);
}

function normalizeCallTakenStatus(
  value: string | null,
  callTaken: boolean | null
): SheetRow["callTakenStatus"] {
  const normalized = (value || "").toLowerCase().trim();
  if (normalized === "yes" || normalized === "no" || normalized === "pending") {
    return normalized;
  }
  if (callTaken === true) return "yes";
  if (callTaken === false) return "no";
  return "pending";
}

function salesDbRowToSheetRow(row: SalesTrackerDbRow): SheetRow {
  return {
    callNumber: row.call_number || "",
    date: row.date,
    name: row.prospect_name || "",
    callTaken: row.call_taken === true,
    callTakenStatus: normalizeCallTakenStatus(row.call_taken_status, row.call_taken),
    callLength: row.call_length || "",
    recorded: row.recorded === true,
    outcome: (row.outcome || "").toUpperCase(),
    closer: (row.closer || "").toUpperCase(),
    objection: row.objection || "",
    programLength: row.program_length || "",
    revenue: (row.contracted_revenue_cents || 0) / 100,
    cashCollected: (row.collected_revenue_cents || 0) / 100,
    method: (row.payment_method || "").toUpperCase(),
    setter: row.setter || "",
    callNotes: row.call_notes || "",
    recordingLink: row.recording_link || "",
    offer: row.offer || "",
  };
}

function filterSalesRowsForClients(rows: SheetRow[], clientFilter: string[]) {
  return rows.filter((row) => {
    const clientKey = clientFromOffer(row);
    return !clientKey || clientFilter.includes(clientKey);
  });
}

async function fetchSalesRowsFromSupabase(
  db: ReturnType<typeof getServiceSupabase>,
  query: AdsTrackerQuery,
  clientFilter: string[]
): Promise<SheetRow[] | null> {
  const { data, error } = await db
    .from("sales_tracker_rows")
    .select(
      [
        "call_number",
        "date",
        "prospect_name",
        "call_taken",
        "call_taken_status",
        "call_length",
        "recorded",
        "outcome",
        "closer",
        "objection",
        "program_length",
        "contracted_revenue_cents",
        "collected_revenue_cents",
        "payment_method",
        "setter",
        "call_notes",
        "recording_link",
        "offer",
      ].join(",")
    )
    .gte("date", query.dateFrom)
    .lte("date", query.dateTo);

  if (error) {
    console.warn("[ads-tracker] Supabase sales rows unavailable; falling back to sheet", error);
    return null;
  }

  if (!data || data.length === 0) return null;

  return filterSalesRowsForClients(
    (data as unknown as SalesTrackerDbRow[]).map(salesDbRowToSheetRow),
    clientFilter
  );
}

async function fetchFreshSalesRows(
  db: ReturnType<typeof getServiceSupabase>,
  query: AdsTrackerQuery,
  clientFilter: string[]
): Promise<SheetRow[]> {
  try {
    return filterSalesRowsForClients(
      await fetchSheetData(query.dateFrom, query.dateTo),
      clientFilter
    );
  } catch (error) {
    console.warn("[ads-tracker] Live sales sheet fetch failed; falling back to synced rows", error);
    return (await fetchSalesRowsFromSupabase(db, query, clientFilter)) || [];
  }
}

function applySalesToGroups(
  groups: Map<string, Group>,
  salesRows: SheetRow[],
  bookings: KeywordEvent[],
  options: SalesAttributionOptions = {}
): UnmatchedSale[] {
  const bookingsByName = new Map<string, KeywordEvent[]>();
  for (const booking of bookings) {
    const name = normalizePersonName(booking.contact_name);
    if (!name) continue;
    const list = bookingsByName.get(name) || [];
    list.push(booking);
    bookingsByName.set(name, list);
  }

  const unmatched: UnmatchedSale[] = [];
  const addUnmatched = (
    row: SheetRow,
    clientKey: string | null,
    reason: UnmatchedSale["reason"]
  ) => {
    if (!shouldTrackUnmatchedSale(row)) return;
    if (!(options.includeUnmatchedSales?.(row, clientKey) ?? true)) return;
    unmatched.push(unmatchedSale(row, clientKey, reason));
  };

  for (const row of salesRows) {
    const name = normalizePersonName(row.name);
    const clientKey = clientFromOffer(row);
    if (!name) {
      addUnmatched(row, clientKey, "missing_sales_name");
      continue;
    }
    const matches = bookingsByName.get(name) || [];
    const match = matches.find((item) => !clientKey || item.client_key === clientKey) || matches[0];
    if (!match) {
      addUnmatched(row, clientKey, "no_matching_ghl_booking");
      continue;
    }
    if (!match.keyword_normalized) {
      addUnmatched(row, clientKey || match.client_key, "missing_booking_keyword");
      continue;
    }

    const groupId =
      options.groupId?.(match, row) || `${match.client_key}:${match.keyword_normalized}`;
    const group =
      groups.get(groupId) ||
      emptyGroup(
        groupId,
        match.client_key,
        options.groupName?.(match, row) || displayKeyword(match.keyword_normalized),
        displayKeyword(match.keyword_normalized)
      );
    group.dateLabel = options.dateLabel?.(match, row) || group.dateLabel;
    groups.set(groupId, group);

    const includeOutcomeMetrics = options.includeOutcomeMetrics?.(match, row) ?? true;
    const includeCallTakenMetrics =
      options.includeCallTakenMetrics?.(match, row) ?? includeOutcomeMetrics;
    const includeClientSplitMetrics =
      options.includeClientSplitMetrics?.(match, row) ?? includeOutcomeMetrics;

    if (includeCallTakenMetrics && row.callTaken && !isNoShow(row)) group.callsTaken += 1;
    if (includeClientSplitMetrics && isWin(row)) {
      if (isSubscriptionSale(row)) group.subscriptionClients += 1;
      else group.mainOfferClients += 1;
    }
    if (includeOutcomeMetrics) {
      if (isWin(row)) group.newClients += 1;
      group.contractedRevenue += row.revenue || 0;
      group.collectedRevenue += row.cashCollected || 0;
    }
  }

  return unmatched;
}

function buildPayload(
  query: AdsTrackerQuery,
  rows: AdsTrackerRow[],
  events: KeywordEvent[],
  mock = false,
  dailyRows: AdsTrackerRow[] = [],
  options: BuildPayloadOptions = {}
) {
  const totalSpend = rows.reduce((sum, row) => sum + row.adSpend, 0);
  const totalCollected = rows.reduce((sum, row) => sum + row.collectedRevenue, 0);
  const totalContracted = rows.reduce((sum, row) => sum + row.contractedRevenue, 0);
  const totalMainOfferClients = rows.reduce((sum, row) => sum + row.mainOfferClients, 0);
  const totalSubscriptionClients = rows.reduce((sum, row) => sum + row.subscriptionClients, 0);
  const unmatchedSales = options.unmatchedSales || [];
  const unmatchedSalesRevenue = unmatchedSales.reduce((sum, row) => sum + row.amount, 0);
  const directSalesCollectedRevenue = options.salesCollectedRevenue;
  const totalCollectedRevenue =
    directSalesCollectedRevenue === undefined
      ? totalCollected + unmatchedSalesRevenue
      : Math.max(totalCollected, directSalesCollectedRevenue);
  const organicUnattributedRevenue = Math.max(0, totalCollectedRevenue - totalCollected);

  const adRoas = rows
    .map((row) => ({
      id: row.id,
      label: row.keyword,
      clientKey: row.clientKey,
      adSpend: row.adSpend,
      collectedRoi: row.collectedRoi,
      collectedRevenue: row.collectedRevenue,
      newClients: row.newClients,
    }))
    .sort((a, b) => b.collectedRevenue - a.collectedRevenue);

  return {
    mock,
    query,
    summary: {
      adSpend: totalSpend,
      collectedRevenue: totalCollected,
      paidAttributedRevenue: totalCollected,
      organicUnattributedRevenue,
      totalCollectedRevenue,
      contractedRevenue: totalContracted,
      collectedRoi: safeDiv(totalCollected, totalSpend),
      contractedRoi: safeDiv(totalContracted, totalSpend),
      messages: rows.reduce((sum, row) => sum + row.messages, 0),
      bookedCalls: rows.reduce((sum, row) => sum + row.bookedCalls, 0),
      callsTaken: rows.reduce((sum, row) => sum + row.callsTaken, 0),
      newClients: rows.reduce((sum, row) => sum + row.newClients, 0),
      mainOfferClients: totalMainOfferClients,
      subscriptionClients: totalSubscriptionClients,
      costPerNewClient: safeDiv(
        totalSpend,
        rows.reduce((sum, row) => sum + row.newClients, 0)
      ),
      costPerMainOfferClient: safeDiv(totalSpend, totalMainOfferClients),
      costPerCallTaken: safeDiv(
        totalSpend,
        rows.reduce((sum, row) => sum + row.callsTaken, 0)
      ),
    },
    attribution: {
      paidAttributedRevenue: totalCollected,
      organicUnattributedRevenue,
      totalCollectedRevenue,
      unmatchedSales,
    },
    sourceStatus: options.sourceStatus || null,
    rows,
    dailyRows,
    adRoas,
    trend: rows.map((row) => ({
      label: row.keyword,
      adSpend: row.adSpend,
      collectedRevenue: row.collectedRevenue,
      collectedRoi: row.collectedRoi,
    })),
    recentEvents: events
      .slice()
      .sort((a, b) => b.event_at.localeCompare(a.event_at))
      .slice(0, 10)
      .map((event) => ({
        source: event.source,
        eventType: event.event_type,
        clientKey: event.client_key,
        keyword: displayKeyword(event.keyword_normalized || event.keyword_raw),
        value: event.value_cents || null,
        name: event.contact_name || event.subscriber_name || "",
        setter: event.setter_name,
        eventAt: event.event_at,
      })),
  };
}

function addMetaRowsToGroups(
  groups: Map<string, Group>,
  rows: MetaRow[],
  query: AdsTrackerQuery,
  groupIdForRow: (row: MetaRow, keyword: string) => string,
  dateLabelForRow: (row: MetaRow) => string
) {
  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw) || keywordFromAdName(row.ad_name);
    if (!keyword) continue;
    const id = groupIdForRow(row, keyword);
    const name = query.level === "ad" ? row.ad_name || displayKeyword(keyword) : campaignDisplayName(row);
    const groupKeyword = query.level === "ad" ? displayKeyword(keyword) : row.campaign_name || row.client_name || row.client_key;
    const group = groups.get(id) || emptyGroup(id, row.client_key, name, groupKeyword);
    group.campaignId = row.campaign_id || group.campaignId;
    group.campaignName = row.campaign_name || group.campaignName;
    if (query.level === "ad") {
      group.adId = row.ad_id || group.adId;
      group.adName = row.ad_name || group.adName;
    }
    group.adSpendCents += row.spend_cents || 0;
    group.impressions += row.impressions || 0;
    group.linkClicks += row.link_clicks || 0;
    applyGroupStatus(group, metaRowStatus(row));
    group.dateLabel = dateLabelForRow(row);
    groups.set(id, group);
  }
}

function uniqueMetaGroupResolver<T>(
  rows: MetaRow[],
  groupIdForRow: (row: MetaRow, keyword: string) => string,
  keyForMetaRow: (row: MetaRow, keyword: string) => string,
  keyForAttributionRow: (row: T, keyword: string) => string
) {
  const idsByKeyword = new Map<string, Set<string>>();

  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw) || keywordFromAdName(row.ad_name);
    if (!keyword) continue;
    const key = keyForMetaRow(row, keyword);
    const ids = idsByKeyword.get(key) || new Set<string>();
    ids.add(groupIdForRow(row, keyword));
    idsByKeyword.set(key, ids);
  }

  return (row: T, keyword: string, fallbackId: string) => {
    const ids = idsByKeyword.get(keyForAttributionRow(row, keyword));
    return ids?.size === 1 ? Array.from(ids)[0] : fallbackId;
  };
}

function hasMetaDelivery(row: MetaRow) {
  return (row.spend_cents || 0) > 0 || (row.impressions || 0) > 0 || (row.link_clicks || 0) > 0;
}

function groupKeyForMetaRow(row: MetaRow) {
  return `${row.campaign_id || row.campaign_name || "campaign"}:${row.ad_id}`;
}

function campaignGroupId(row: Pick<MetaRow, "client_key" | "campaign_id" | "campaign_name">) {
  return `${row.client_key}:${row.campaign_id || row.campaign_name || "campaign"}`;
}

function adGroupId(
  row: Pick<MetaRow, "client_key" | "campaign_id" | "campaign_name" | "ad_id">,
  keyword: string
) {
  return `${row.client_key}:${row.campaign_id || row.campaign_name || "campaign"}:${row.ad_id || keyword}`;
}

function campaignDisplayName(row: Pick<MetaRow, "client_name" | "client_key" | "campaign_name">) {
  const clientName = row.client_name || row.client_key;
  return row.campaign_name ? `${clientName} · ${row.campaign_name}` : clientName;
}

function hintFromMetaRow(row: MetaRow, keyword: string): BackfillGroupHint {
  return {
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    adId: row.ad_id,
    adName: row.ad_name || displayKeyword(keyword),
  };
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function campaignHintFromBackfillPayload(row: KeywordBackfillRow): BackfillGroupHint | null {
  if (!row.raw_payload || typeof row.raw_payload !== "object" || Array.isArray(row.raw_payload)) return null;
  const payload = row.raw_payload as Record<string, unknown>;
  const rawHint = payload.campaign_hint;
  if (!rawHint || typeof rawHint !== "object" || Array.isArray(rawHint)) return null;
  const hint = rawHint as Record<string, unknown>;
  const campaignName = stringFromRecord(hint, "campaign_name");
  if (!campaignName) return null;

  return {
    campaignId: stringFromRecord(hint, "campaign_id"),
    campaignName,
    adId: stringFromRecord(hint, "ad_id"),
    adName: stringFromRecord(hint, "ad_name") || displayKeyword(row.keyword_normalized || row.keyword_raw),
  };
}

function exactMetaHintForBackfillRow(row: KeywordBackfillRow, metaRows: MetaRow[]): BackfillGroupHint | null {
  const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw);
  if (!keyword) return null;

  const candidates = metaRows
    .filter((metaRow) => {
      if (metaRow.client_key !== row.client_key || metaRow.date !== row.date) return false;
      if (!hasMetaDelivery(metaRow)) return false;
      const metaKeyword =
        normalizeKeyword(metaRow.keyword_normalized || metaRow.keyword_raw) || keywordFromAdName(metaRow.ad_name);
      return metaKeyword === keyword;
    })
    .sort((a, b) => (b.spend_cents || 0) - (a.spend_cents || 0));

  const uniqueKeys = new Set(candidates.map(groupKeyForMetaRow));
  if (uniqueKeys.size !== 1) return null;

  return hintFromMetaRow(candidates[0], keyword);
}

function campaignHintForBackfillRow(row: KeywordBackfillRow, metaRows: MetaRow[]): BackfillGroupHint | null {
  const payloadHint = campaignHintFromBackfillPayload(row);
  if (payloadHint) return payloadHint;

  const exactHint = exactMetaHintForBackfillRow(row, metaRows);
  if (exactHint) return exactHint;

  const source = `${row.source_workbook || ""} ${row.source_sheet || ""}`.toLowerCase();
  const clientRows = metaRows.filter((metaRow) => metaRow.client_key === row.client_key && metaRow.campaign_name);

  let candidates = clientRows;
  if (row.client_key === "tyson" && source.includes("warm ads tracker")) {
    candidates = clientRows.filter((metaRow) => {
      const name = (metaRow.campaign_name || "").toLowerCase();
      return name.includes("warm") && name.includes("spring shred");
    });
  } else if (row.client_key === "tyson" && source.includes("cold ads tracker")) {
    candidates = clientRows.filter((metaRow) => {
      const name = (metaRow.campaign_name || "").toLowerCase();
      return name.includes("vets") && name.includes("cold") && name.includes("spring shred");
    });
  } else if (row.client_key === "keith" && source.includes("ads tracker")) {
    candidates = clientRows.filter((metaRow) => {
      const name = (metaRow.campaign_name || "").toLowerCase();
      return name.includes("warm") && name.includes("spring shredding");
    });
  }

  const ranked = candidates
    .slice()
    .sort((a, b) => (b.spend_cents || 0) - (a.spend_cents || 0));
  const campaign = ranked[0];
  if (!campaign?.campaign_name) return null;

  const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw);
  const adName = displayKeyword(keyword);
  return {
    campaignId: campaign.campaign_id,
    campaignName: campaign.campaign_name,
    adId: keyword ? `backfill:${row.client_key}:${campaign.campaign_id || campaign.campaign_name}:${keyword}` : null,
    adName,
  };
}

function fallbackGroupIdForBackfillRow(
  row: KeywordBackfillRow,
  keyword: string,
  metaRows: MetaRow[],
  prefix = "",
  level: AdsTrackerLevel = "ad"
) {
  const hint = campaignHintForBackfillRow(row, metaRows);
  if (!hint?.campaignName) return `${prefix}${row.client_key}:keyword:${keyword}`;
  if (level === "campaign") {
    return `${prefix}${row.client_key}:${hint.campaignId || hint.campaignName}`;
  }
  return `${prefix}${row.client_key}:${hint.campaignId || hint.campaignName}:${hint.adId || keyword}`;
}

function applyBackfillHint(group: Group, hint: BackfillGroupHint | null, level: AdsTrackerLevel = "ad") {
  if (!hint) return;
  group.campaignId = group.campaignId || hint.campaignId;
  group.campaignName = group.campaignName || hint.campaignName;
  if (level === "ad") {
    group.adId = group.adId || hint.adId;
    group.adName = group.adName || hint.adName;
  }
}

function addKeywordEventsToGroups(
  groups: Map<string, Group>,
  events: KeywordEvent[],
  groupIdForEvent: (event: KeywordEvent, keyword: string) => string,
  dateLabelForEvent: (event: KeywordEvent) => string
) {
  for (const event of events) {
    const keyword = normalizeKeyword(event.keyword_normalized || event.keyword_raw);
    if (!keyword) continue;
    const id = groupIdForEvent(event, keyword);
    const group = groups.get(id) || emptyGroup(id, event.client_key, displayKeyword(keyword), displayKeyword(keyword));
    const manualValue = Number(event.value_cents || 0);

    if (event.event_type === "manual_messages") {
      group.messages += manualValue;
    } else if (event.event_type === "manual_booked_calls") {
      group.bookedCalls += manualValue;
    } else if (event.event_type === "manual_calls_taken") {
      group.callsTaken += manualValue;
    } else if (event.event_type === "manual_new_clients") {
      group.newClients += manualValue;
      group.mainOfferClients += manualValue;
    } else if (event.event_type === "manual_collected_revenue") {
      const amount = dollars(manualValue);
      group.collectedRevenue += amount;
      group.contractedRevenue += amount;
    } else {
      if (event.source === "manychat") group.messages += 1;
      if (event.source === "ghl") group.bookedCalls += 1;
    }

    group.dateLabel = dateLabelForEvent(event);
    groups.set(id, group);
  }
}

function addKeywordBackfillRowsToGroups(
  groups: Map<string, Group>,
  rows: KeywordBackfillRow[],
  query: AdsTrackerQuery,
  groupIdForRow: (row: KeywordBackfillRow, keyword: string) => string,
  dateLabelForRow: (row: KeywordBackfillRow) => string,
  hintForRow?: (row: KeywordBackfillRow, keyword: string) => BackfillGroupHint | null
) {
  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw);
    if (!keyword) continue;

    const id = groupIdForRow(row, keyword);
    const hint = hintForRow?.(row, keyword) || null;
    const name =
      query.level === "ad"
        ? displayKeyword(keyword)
        : hint?.campaignName
          ? `${row.client_name || row.client_key} · ${hint.campaignName}`
          : row.client_name || row.client_key;
    const groupKeyword = query.level === "ad" ? displayKeyword(keyword) : hint?.campaignName || row.client_name || row.client_key;
    const group = groups.get(id) || emptyGroup(id, row.client_key, name, groupKeyword);
    applyBackfillHint(group, hint, query.level);

    const newClients = row.new_clients || 0;
    const subscriptionClients = inferBackfillSubscriptionClients(row);
    group.messages += row.messages || 0;
    group.bookedCalls += row.booked_calls || 0;
    group.callsTaken += row.calls_taken || 0;
    group.newClients += newClients;
    group.subscriptionClients += subscriptionClients;
    group.mainOfferClients += Math.max(0, newClients - subscriptionClients);
    group.contractedRevenue += dollars(row.contracted_revenue_cents || 0);
    group.collectedRevenue += dollars(row.collected_revenue_cents || 0);
    group.dateLabel = dateLabelForRow(row);
    groups.set(id, group);
  }
}

async function fetchKeywordBackfillRows(
  db: ReturnType<typeof getServiceSupabase>,
  query: AdsTrackerQuery,
  clientFilter: string[]
): Promise<KeywordBackfillRow[]> {
  const columns = [
    "client_key",
    "client_name",
    "date",
    "keyword_raw",
    "keyword_normalized",
    "messages",
    "booked_calls",
    "calls_taken",
    "new_clients",
    "contracted_revenue_cents",
    "collected_revenue_cents",
    "source_workbook",
    "source_sheet",
    "raw_payload",
  ];

  const queryRows = (selectColumns: string[]) =>
    db
      .from("ads_keyword_backfill_daily")
      .select(selectColumns.join(","))
      .in("client_key", clientFilter)
      .gte("date", query.dateFrom)
      .lte("date", query.dateTo);

  let { data, error } = await queryRows(columns);

  if (error && error.message?.toLowerCase().includes("calls_taken")) {
    const retry = await queryRows(columns.filter((column) => column !== "calls_taken"));
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.warn("[ads-tracker] Keyword backfill unavailable; continuing with live events only", error);
    return [];
  }

  return ((data || []) as unknown as KeywordBackfillRow[]).map((row) => ({
    ...row,
    calls_taken: row.calls_taken || 0,
  }));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function syncedMetaDateAccounts(
  runs: AdsSyncRunRow[],
  query: AdsTrackerQuery,
  clientFilter: string[]
) {
  const synced = new Set<string>();
  for (const run of runs) {
    const accounts = Array.isArray(run.accounts) ? run.accounts : [];
    for (const accountValue of accounts) {
      const account = asObject(accountValue);
      if (!account) continue;
      const clientKey = account.account || account.key;
      if (typeof clientKey !== "string" || !clientFilter.includes(clientKey)) continue;

      const dateSummaries = Array.isArray(account.dates) ? account.dates : null;
      if (dateSummaries) {
        for (const dateValue of dateSummaries) {
          const dateSummary = asObject(dateValue);
          const date = dateSummary?.date;
          if (typeof date === "string" && date >= query.dateFrom && date <= query.dateTo) {
            synced.add(`${clientKey}:${date}`);
          }
        }
        continue;
      }

      // Only the replacement-sync shape includes per-date verification. Older
      // sync logs are intentionally ignored so stale runs cannot hide gaps.
    }
  }
  return synced;
}

export async function getAdsTrackerDashboard(query: AdsTrackerQuery) {
  const db = getServiceSupabase();

  const clientFilter =
    query.account === "all" ? ["tyson", "keith"] : [query.account];
  const eventQueryFrom = `${shiftDate(query.dateFrom, -120)}T00:00:00.000Z`;
  const eventQueryTo = `${shiftDate(query.dateTo, 1)}T23:59:59.999Z`;

  const [
    { data: metaRows, error: metaError },
    { data: keywordEvents, error: eventError },
    { data: ghlAppointments, error: appointmentError },
    { data: metaSyncRuns, error: syncRunError },
    backfillRows,
  ] = await Promise.all([
      db
        .from("ads_meta_insights_daily")
        .select("*")
        .in("client_key", clientFilter)
        .gte("date", query.dateFrom)
        .lte("date", query.dateTo),
      db
        .from("ads_keyword_events")
        .select(
          "source,event_type,client_key,keyword_raw,keyword_normalized,value_cents,subscriber_id,subscriber_name,setter_name,appointment_id,contact_id,contact_name,event_at"
        )
        .in("client_key", clientFilter)
        .gte("event_at", eventQueryFrom)
        .lte("event_at", eventQueryTo),
      db
        .from("ghl_appointments")
        .select(
          "appointment_id,client,contact_id,contact_name,keyword_raw,keyword_normalized,start_time,created_at,status,event_type,raw_payload"
        )
        .gte("created_at", eventQueryFrom)
        .lte("created_at", eventQueryTo),
      db
        .from("ads_sync_runs")
        .select("date_from,date_to,completed_at,accounts")
        .eq("source", "meta_ads")
        .eq("status", "success")
        .lte("date_from", query.dateTo)
        .gte("date_to", query.dateFrom)
        .order("completed_at", { ascending: false })
        .limit(20),
      fetchKeywordBackfillRows(db, query, clientFilter),
    ]);

  if (metaError || eventError || appointmentError || syncRunError) {
    throw new Error(
      `Ads Tracker data query failed: ${(metaError || eventError || appointmentError || syncRunError)?.message || "unknown error"}`
    );
  }

  const groups = new Map<string, Group>();
  const rows = (metaRows || []) as MetaRow[];
  const backfill = backfillRows as KeywordBackfillRow[];
  const baseKeywordEvents = ((keywordEvents || []) as KeywordEvent[]);
  const supplementalGhlEvents = await buildSupplementalGhlKeywordEvents(
    db,
    (ghlAppointments || []) as GhlAppointmentRow[],
    baseKeywordEvents,
    clientFilter
  );
  const backfilledDateKeys = new Set(
    backfill.map((row) => `${row.client_key}:${row.date}`)
  );
  const attributionEvents = [...baseKeywordEvents, ...supplementalGhlEvents]
    .filter((event) => !isTestKeywordEvent(event))
    .filter((event) => clientFilter.includes(event.client_key));
  const allEvents = attributionEvents
    .filter((event) => isWithinDashboardDateRange(event.event_at, query));
  const events = allEvents.filter(
    (event) => !backfilledDateKeys.has(`${event.client_key}:${eventDateKey(event.event_at)}`)
  );
  const periodMetaGroupId = (row: MetaRow, keyword: string) =>
    query.level === "campaign" ? campaignGroupId(row) : adGroupId(row, keyword);
  const dailyMetaGroupId = (row: MetaRow, keyword: string) =>
    `${row.date}:${periodMetaGroupId(row, keyword)}`;
  const periodAttributionGroupId = uniqueMetaGroupResolver<KeywordEvent | KeywordBackfillRow>(
    rows,
    periodMetaGroupId,
    (row, keyword) => `${row.client_key}:${keyword}`,
    (row, keyword) => `${row.client_key}:${keyword}`
  );
  const dailyAttributionGroupId = uniqueMetaGroupResolver<KeywordEvent | KeywordBackfillRow>(
    rows,
    dailyMetaGroupId,
    (row, keyword) => `${row.date}:${row.client_key}:${keyword}`,
    (row, keyword) => {
      const date = "event_at" in row ? eventDateKey(row.event_at) : row.date;
      return `${date}:${row.client_key}:${keyword}`;
    }
  );

  addMetaRowsToGroups(
    groups,
    rows,
    query,
    periodMetaGroupId,
    () => `${query.dateFrom} - ${query.dateTo}`
  );

  addKeywordEventsToGroups(
    groups,
    events,
    (event, keyword) =>
      periodAttributionGroupId(event, keyword, `${event.client_key}:keyword:${keyword}`),
    () => `${query.dateFrom} - ${query.dateTo}`
  );
  addKeywordBackfillRowsToGroups(
    groups,
    backfill,
    query,
    (row, keyword) =>
      periodAttributionGroupId(
        row,
        keyword,
        fallbackGroupIdForBackfillRow(row, keyword, rows, "", query.level)
      ),
    () => `${query.dateFrom} - ${query.dateTo}`,
    (row) => campaignHintForBackfillRow(row, rows)
  );

  const bookings = attributionEvents.filter((event) => event.source === "ghl");
  const salesRows = await fetchFreshSalesRows(db, query, clientFilter);
  const attributionSalesRows = salesRows.filter((row) => !isTestSalesRow(row));

  const includeSalesOutcomeMetrics = (match: KeywordEvent, row: SheetRow) =>
    !backfilledDateKeys.has(`${match.client_key}:${row.date}`);
  const includeCallTakenMetrics = () => true;
  const includeUnmatchedSales = (row: SheetRow, clientKey: string | null) =>
    Boolean(clientKey && clientFilter.includes(clientKey)) &&
    !backfilledDateKeys.has(`${clientKey}:${row.date}`);

  const unmatchedSales = applySalesToGroups(groups, attributionSalesRows, bookings, {
    groupId: (match) =>
      periodAttributionGroupId(
        match,
        match.keyword_normalized || "",
        `${match.client_key}:keyword:${match.keyword_normalized}`
      ),
    includeOutcomeMetrics: includeSalesOutcomeMetrics,
    includeCallTakenMetrics,
    includeClientSplitMetrics: includeSalesOutcomeMetrics,
    includeUnmatchedSales,
  });

  const dailyGroups = new Map<string, Group>();
  addMetaRowsToGroups(
    dailyGroups,
    rows,
    query,
    dailyMetaGroupId,
    (row) => row.date
  );
  addKeywordEventsToGroups(
    dailyGroups,
    events,
    (event, keyword) =>
      dailyAttributionGroupId(
        event,
        keyword,
        `${eventDateKey(event.event_at)}:${event.client_key}:keyword:${keyword}`
      ),
    (event) => eventDateKey(event.event_at)
  );
  addKeywordBackfillRowsToGroups(
    dailyGroups,
    backfill,
    query,
    (row, keyword) =>
      dailyAttributionGroupId(
        row,
        keyword,
        fallbackGroupIdForBackfillRow(row, keyword, rows, `${row.date}:`, query.level)
      ),
    (row) => row.date,
    (row) => campaignHintForBackfillRow(row, rows)
  );
  applySalesToGroups(dailyGroups, attributionSalesRows, bookings, {
    groupId: (match, row) =>
      dailyAttributionGroupId(
        { ...match, event_at: `${row.date}T00:00:00.000Z` },
        match.keyword_normalized || "",
        `${row.date}:${match.client_key}:keyword:${match.keyword_normalized}`
      ),
    dateLabel: (_match, row) => row.date,
    includeOutcomeMetrics: includeSalesOutcomeMetrics,
    includeCallTakenMetrics,
    includeClientSplitMetrics: includeSalesOutcomeMetrics,
    includeUnmatchedSales,
  });

  const finalized = Array.from(groups.values())
    .map(finalizeGroup)
    .filter(
      (row) =>
        row.adSpend > 0 ||
        row.impressions > 0 ||
        row.linkClicks > 0 ||
        row.messages > 0 ||
        row.bookedCalls > 0 ||
        row.callsTaken > 0 ||
        row.newClients > 0 ||
        row.collectedRevenue > 0
    )
    .filter((row) => query.status === "all" || row.status === query.status)
    .sort((a, b) => b.collectedRoi - a.collectedRoi);

  const finalizedDaily = Array.from(dailyGroups.values())
    .map(finalizeGroup)
    .filter(
      (row) =>
        row.adSpend > 0 ||
        row.impressions > 0 ||
        row.linkClicks > 0 ||
        row.messages > 0 ||
        row.bookedCalls > 0 ||
        row.callsTaken > 0 ||
        row.newClients > 0 ||
        row.collectedRevenue > 0
    )
    .filter((row) => query.status === "all" || row.status === query.status)
    .sort((a, b) => a.dateLabel.localeCompare(b.dateLabel));

  const metaDateAccounts = new Set(rows.map((row) => `${row.client_key}:${row.date}`));
  const syncedDateAccounts = syncedMetaDateAccounts(
    (metaSyncRuns || []) as AdsSyncRunRow[],
    query,
    clientFilter
  );
  const missingDateAccounts = datesInRange(query.dateFrom, query.dateTo).flatMap((date) =>
    clientFilter
      .map((clientKey) => ({ date, clientKey }))
      .filter(
        ({ date: dateKey, clientKey }) =>
          !metaDateAccounts.has(`${clientKey}:${dateKey}`) &&
          !syncedDateAccounts.has(`${clientKey}:${dateKey}`)
      )
  );
  const latestMetaSyncedAt = rows
    .map((row) => row.synced_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const unmatchedRevenue = unmatchedSales.reduce((sum, row) => sum + row.amount, 0);
  const salesCollectedRevenue = attributionSalesRows.reduce(
    (sum, row) => sum + (row.cashCollected || 0),
    0
  );
  const sourceStatus = {
    meta: {
      rowCount: rows.length,
      spend: dollars(rows.reduce((sum, row) => sum + (row.spend_cents || 0), 0)),
      latestSyncedAt: latestMetaSyncedAt || null,
      missingDates: Array.from(new Set(missingDateAccounts.map((row) => row.date))),
      missingDateAccounts,
    },
    attributionEvents: {
      manychat: events.filter((event) => event.source === "manychat").length,
      ghl: events.filter((event) => event.source === "ghl").length,
    },
    sales: {
      rowCount: attributionSalesRows.length,
      directCollectedRevenue: salesCollectedRevenue,
      organicOrUnattributedCount: unmatchedSales.length,
      unmatchedSalesRevenue: unmatchedRevenue,
      organicOrUnattributedRevenue: Math.max(
        0,
        salesCollectedRevenue - finalized.reduce((sum, row) => sum + row.collectedRevenue, 0)
      ),
    },
  };

  return buildPayload(query, finalized, events, false, finalizedDaily, {
    unmatchedSales,
    salesCollectedRevenue,
    sourceStatus,
  });
}
