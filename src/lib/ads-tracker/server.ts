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
  raw_payload?: unknown;
}

interface KeywordEvent {
  source: "manychat" | "ghl";
  event_type: string;
  client_key: string;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  override_group_id?: string | null;
  override_group_name?: string | null;
  override_campaign_id?: string | null;
  override_campaign_name?: string | null;
  override_ad_id?: string | null;
  override_ad_name?: string | null;
  attribution_resolution_id?: string | null;
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

interface ManychatTagEventRow {
  id: string;
  subscriber_id: string;
  subscriber_name: string | null;
  tag_name: string;
  client: string;
  setter_name: string | null;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  raw_payload: unknown;
  event_at: string;
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
  previewImageUrl: string | null;
  previewThumbnailUrl: string | null;
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
  attributionOnly: boolean;
}

interface SalesAttributionOptions {
  groupId?: (match: KeywordEvent, row: SheetRow) => string;
  dateLabel?: (match: KeywordEvent, row: SheetRow) => string;
  groupName?: (match: KeywordEvent, row: SheetRow) => string;
  groupHint?: (match: KeywordEvent, row: SheetRow) => BackfillGroupHint | null;
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
  previewImageUrl: string | null;
  previewThumbnailUrl: string | null;
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
  key: string;
  date: string;
  clientKey: string | null;
  name: string;
  setter: string;
  outcome: string;
  callTaken: boolean;
  contractedRevenue: number;
  collectedRevenue: number;
  amount: number;
  reason:
    | "missing_sales_name"
    | "no_matching_ghl_booking"
    | "missing_booking_keyword"
    | "ambiguous_or_missing_meta_match"
    | "missing_manychat_keyword";
  classification: "organic_or_unattributed" | "missing_keyword";
  alertType?: "sale" | "call" | "missing_dm_keyword" | "missing_booking_keyword";
  subscriberId?: string | null;
  instagramHandle?: string | null;
  manychatUrl?: string | null;
  appointmentId?: string | null;
  contactId?: string | null;
  eventAt?: string | null;
}

type AttributionResolutionAction = "attribute" | "organic" | "unattributed" | "ignore";

interface AttributionExceptionRow {
  id: string;
  source: string;
  reason: string;
  client_key: string | null;
  keyword_normalized: string | null;
  contact_name: string | null;
  appointment_id: string | null;
  payload: unknown;
  resolved_at: string | null;
  created_at: string | null;
}

interface AttributionResolution {
  id: string;
  source: string;
  saleKey: string;
  action: AttributionResolutionAction;
  clientKey: string | null;
  keywordNormalized: string | null;
  keywordRaw: string | null;
  noKeyword: boolean;
  paidAttributionType: string | null;
  contactName: string | null;
  subscriberId: string | null;
  subscriberName: string | null;
  appointmentId: string | null;
  contactId: string | null;
  eventAt: string | null;
  saleDate: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
  groupId: string | null;
  groupName: string | null;
  note: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
  alertType: "sale" | "call" | "missing_dm_keyword" | "missing_booking_keyword" | null;
}

interface ResolvedAttributionAlert {
  id: string;
  saleKey: string;
  action: AttributionResolutionAction;
  date: string;
  clientKey: string | null;
  name: string;
  setter: string;
  amount: number;
  keyword: string;
  campaignName: string | null;
  adName: string | null;
  note: string | null;
  resolvedAt: string | null;
}

interface BuildPayloadOptions {
  unmatchedSales?: UnmatchedSale[];
  financialUnmatchedSales?: UnmatchedSale[];
  resolvedAlerts?: ResolvedAttributionAlert[];
  financialResolvedAlerts?: ResolvedAttributionAlert[];
  salesCollectedRevenue?: number;
  allTimePaidAttributedRevenue?: number;
  allTimeUnattributedRevenue?: number;
  allTimeOrganicRevenue?: number;
  allTimeIgnoredRevenue?: number;
  sourceStatus?: Record<string, unknown>;
  eventsHistory?: AttributionHistoryEvent[];
  attributionKeywordOptions?: Record<string, unknown>[];
  attributionCampaignOptions?: Record<string, unknown>[];
}

interface AttributionHistoryEvent {
  id: string;
  source: "manychat" | "ghl" | "sales_tracker" | "manual";
  eventType:
    | "dm"
    | "booked_call"
    | "call_taken"
    | "no_show"
    | "sale"
    | "manual_correction"
    | "manual_messages"
    | "manual_booked_calls"
    | "manual_calls_taken"
    | "manual_new_clients"
    | "manual_collected_revenue";
  status: "attributed" | "needs_review" | "missing_keyword" | "organic" | "unattributed" | "ignored";
  clientKey: string | null;
  keyword: string;
  campaignName: string | null;
  adName: string | null;
  value: number | null;
  name: string;
  setter: string;
  reason: string | null;
  eventAt: string;
  saleKey?: string | null;
  alertType?: "sale" | "call" | "missing_dm_keyword" | "missing_booking_keyword" | null;
  appointmentId?: string | null;
  contactId?: string | null;
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

const SUPABASE_PAGE_SIZE = 1000;
const ALERT_RESOLUTION_SOURCE = "ads_tracker_alert_resolution";
const AUTO_ATTRIBUTION_SOURCE = "ads_tracker_auto_sales_attribution";
const NO_KEYWORD_ATTRIBUTION_KEYWORD = "no keyword / ad unknown";
const NO_KEYWORD_ATTRIBUTION_LABEL = "No keyword / ad unknown";
const NO_KEYWORD_ATTRIBUTION_AD_ID = "no-keyword-ad-unknown";
const MANYCHAT_MISSING_KEYWORD_TAG_NAMES = [
  "needs_keyword_attribution",
  "needs keyword attribution",
];

function emptyGroup(id: string, clientKey: string, name: string, keyword: string): Group {
  return {
    id,
    clientKey,
    name,
    campaignId: null,
    campaignName: null,
    adId: null,
    adName: null,
    previewImageUrl: null,
    previewThumbnailUrl: null,
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
    status: "finished",
  };
}

function dollars(cents: number): number {
  return cents / 100;
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function sumAlertRevenue(alerts: UnmatchedSale[]) {
  return alerts.reduce((sum, row) => sum + row.amount, 0);
}

function sumResolvedRevenue(
  alerts: ResolvedAttributionAlert[],
  action: AttributionResolutionAction
) {
  return alerts
    .filter((alert) => alert.action === action)
    .reduce((sum, alert) => sum + alert.amount, 0);
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
    previewImageUrl: group.previewImageUrl,
    previewThumbnailUrl: group.previewThumbnailUrl,
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
    attributionOnly: !group.campaignId && !group.adId && group.adSpendCents === 0,
  };
}

function matchesStatusFilter(row: AdsTrackerRow, status: AdsTrackerStatus) {
  if (status === "all") return true;
  return row.status === status;
}

function normalizedMetaStatus(value: string | null | undefined) {
  return (value || "").trim().toUpperCase();
}

function metaRowStatus(row: MetaRow): "active" | "finished" {
  const adStatus = normalizedMetaStatus(row.ad_effective_status);
  const campaignStatus = normalizedMetaStatus(row.campaign_effective_status);
  if (campaignStatus && campaignStatus !== "ACTIVE") return "finished";
  if (adStatus && adStatus !== "ACTIVE") return "finished";
  if (campaignStatus === "ACTIVE" || adStatus === "ACTIVE") return "active";
  return "finished";
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

function isRevenueEvent(row: SheetRow): boolean {
  return saleAmount(row) > 0 || row.revenue > 0 || isWin(row);
}

function normalizeKeyPart(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function salesRowKey(row: SheetRow, clientKey: string | null): string {
  const stableRowId =
    normalizeKeyPart(row.callNumber) ||
    normalizePersonName(row.name) ||
    normalizeKeyPart(row.name) ||
    "unknown";
  return [
    "sale",
    row.date || "nodate",
    clientKey || clientFromOffer(row) || "unknown",
    stableRowId,
    normalizeKeyPart(row.setter) || "nosetter",
    normalizeKeyPart(row.outcome) || "nooutcome",
  ].join(":");
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
    key: salesRowKey(row, clientKey),
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
    alertType: isRevenueEvent(row) ? "sale" : "call",
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

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function attributionAlertsStartDate(): string {
  const configured = process.env.ADS_ATTRIBUTION_ALERTS_START_DATE;
  return configured && /^\d{4}-\d{2}-\d{2}$/.test(configured) ? configured : "2026-04-01";
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

function bookingsByContactName(bookings: KeywordEvent[]) {
  const byName = new Map<string, KeywordEvent[]>();
  for (const booking of bookings) {
    const name = normalizePersonName(booking.contact_name);
    if (!name) continue;
    const list = byName.get(name) || [];
    list.push(booking);
    byName.set(name, list);
  }
  return byName;
}

function matchedBookingForSalesRow(
  row: SheetRow,
  bookingsByName: Map<string, KeywordEvent[]>
) {
  const name = normalizePersonName(row.name);
  if (!name) return null;
  const clientKey = clientFromOffer(row);
  const matches = bookingsByName.get(name) || [];
  return matches.find((item) => !clientKey || item.client_key === clientKey) || matches[0] || null;
}

function isFallbackAttributionGroupId(groupId: string) {
  return groupId.includes(":keyword:");
}

function applySalesToGroups(
  groups: Map<string, Group>,
  salesRows: SheetRow[],
  bookings: KeywordEvent[],
  options: SalesAttributionOptions = {}
): UnmatchedSale[] {
  const bookingsByName = bookingsByContactName(bookings);

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
    const match = matchedBookingForSalesRow(row, bookingsByName);
    if (!match) {
      addUnmatched(row, clientKey, "no_matching_ghl_booking");
      continue;
    }
    if (!match.keyword_normalized) {
      addUnmatched(row, clientKey || match.client_key, "missing_booking_keyword");
      continue;
    }

    const groupId =
      options.groupId?.(match, row) ||
      match.override_group_id ||
      `${match.client_key}:${match.keyword_normalized}`;
    if (isFallbackAttributionGroupId(groupId)) {
      addUnmatched(row, clientKey || match.client_key, "ambiguous_or_missing_meta_match");
      continue;
    }
    const group =
      groups.get(groupId) ||
      emptyGroup(
        groupId,
        match.client_key,
        options.groupName?.(match, row) || displayKeyword(match.keyword_normalized),
        displayKeyword(match.keyword_normalized)
      );
    applyOverrideMetadata(group, match);
    applyBackfillHint(group, options.groupHint?.(match, row) || null, "ad");
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
  const paidRows = rows.filter((row) => !row.attributionOnly);
  const totalSpend = paidRows.reduce((sum, row) => sum + row.adSpend, 0);
  const totalCollected = paidRows.reduce((sum, row) => sum + row.collectedRevenue, 0);
  const totalContracted = paidRows.reduce((sum, row) => sum + row.contractedRevenue, 0);
  const totalMainOfferClients = paidRows.reduce((sum, row) => sum + row.mainOfferClients, 0);
  const totalSubscriptionClients = paidRows.reduce((sum, row) => sum + row.subscriptionClients, 0);
  const unmatchedSales = options.unmatchedSales || [];
  const resolvedAlerts = options.resolvedAlerts || [];
  const financialUnmatchedSales = options.financialUnmatchedSales || unmatchedSales;
  const financialResolvedAlerts = options.financialResolvedAlerts || resolvedAlerts;
  const unattributedRevenue = sumAlertRevenue(financialUnmatchedSales);
  const resolvedUnattributedRevenue = sumResolvedRevenue(financialResolvedAlerts, "unattributed");
  const organicRevenue = sumResolvedRevenue(financialResolvedAlerts, "organic");
  const ignoredRevenue = sumResolvedRevenue(financialResolvedAlerts, "ignore");
  const allTimePaidAttributedRevenue = options.allTimePaidAttributedRevenue ?? totalCollected;
  const allTimeUnattributedRevenue =
    options.allTimeUnattributedRevenue ?? sumAlertRevenue(unmatchedSales);
  const allTimeOrganicRevenue = options.allTimeOrganicRevenue ?? organicRevenue;
  const allTimeIgnoredRevenue = options.allTimeIgnoredRevenue ?? ignoredRevenue;
  const directSalesCollectedRevenue = options.salesCollectedRevenue;
  const totalCollectedRevenue =
    directSalesCollectedRevenue === undefined
      ? totalCollected + unattributedRevenue + resolvedUnattributedRevenue + organicRevenue + ignoredRevenue
      : Math.max(totalCollected, directSalesCollectedRevenue);
  const impliedUnattributedRevenue = Math.max(
    0,
    totalCollectedRevenue - totalCollected - organicRevenue - ignoredRevenue
  );
  const finalUnattributedRevenue = Math.max(
    unattributedRevenue + resolvedUnattributedRevenue,
    impliedUnattributedRevenue
  );

  const adRoas = paidRows
    .map((row) => ({
      id: row.id,
      label: row.keyword,
      clientKey: row.clientKey,
      campaignId: row.campaignId,
      campaignName: row.campaignName,
      adId: row.adId,
      adName: row.adName,
      previewImageUrl: row.previewImageUrl,
      previewThumbnailUrl: row.previewThumbnailUrl,
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
      allTimePaidAttributedRevenue,
      unattributedRevenue: finalUnattributedRevenue,
      organicRevenue,
      ignoredRevenue,
      potentialAttributedRevenue: totalCollected + finalUnattributedRevenue,
      potentialRoi: safeDiv(totalCollected + finalUnattributedRevenue, totalSpend),
      allTimeUnattributedRevenue,
      allTimeOrganicRevenue,
      allTimeIgnoredRevenue,
      organicUnattributedRevenue: finalUnattributedRevenue,
      totalCollectedRevenue,
      contractedRevenue: totalContracted,
      collectedRoi: safeDiv(totalCollected, totalSpend),
      contractedRoi: safeDiv(totalContracted, totalSpend),
      messages: paidRows.reduce((sum, row) => sum + row.messages, 0),
      bookedCalls: paidRows.reduce((sum, row) => sum + row.bookedCalls, 0),
      callsTaken: paidRows.reduce((sum, row) => sum + row.callsTaken, 0),
      newClients: paidRows.reduce((sum, row) => sum + row.newClients, 0),
      mainOfferClients: totalMainOfferClients,
      subscriptionClients: totalSubscriptionClients,
      costPerNewClient: safeDiv(
        totalSpend,
        paidRows.reduce((sum, row) => sum + row.newClients, 0)
      ),
      costPerMainOfferClient: safeDiv(totalSpend, totalMainOfferClients),
      costPerCallTaken: safeDiv(
        totalSpend,
        paidRows.reduce((sum, row) => sum + row.callsTaken, 0)
      ),
    },
    attribution: {
      paidAttributedRevenue: totalCollected,
      allTimePaidAttributedRevenue,
      unattributedRevenue: finalUnattributedRevenue,
      organicRevenue,
      ignoredRevenue,
      potentialAttributedRevenue: totalCollected + finalUnattributedRevenue,
      potentialRoi: safeDiv(totalCollected + finalUnattributedRevenue, totalSpend),
      selectedRange: {
        paidAttributedRevenue: totalCollected,
        unattributedRevenue: finalUnattributedRevenue,
        organicRevenue,
        ignoredRevenue,
        potentialAttributedRevenue: totalCollected + finalUnattributedRevenue,
        potentialRoi: safeDiv(totalCollected + finalUnattributedRevenue, totalSpend),
      },
      allTime: {
        paidAttributedRevenue: allTimePaidAttributedRevenue,
        unattributedRevenue: allTimeUnattributedRevenue,
        organicRevenue: allTimeOrganicRevenue,
        ignoredRevenue: allTimeIgnoredRevenue,
      },
      organicUnattributedRevenue: finalUnattributedRevenue,
      totalCollectedRevenue,
      unmatchedSales,
      resolvedAlerts,
      keywordOptions: options.attributionKeywordOptions || [],
      campaignOptions: options.attributionCampaignOptions || [],
    },
    sourceStatus: options.sourceStatus || null,
    rows,
    dailyRows,
    adRoas,
    trend: paidRows.map((row) => ({
      label: row.keyword,
      adSpend: row.adSpend,
      collectedRevenue: row.collectedRevenue,
      collectedRoi: row.collectedRoi,
    })),
    eventsHistory: options.eventsHistory || [],
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

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function creativePreviewFromPayload(payload: unknown) {
  const root = recordFromUnknown(payload);
  const preview = recordFromUnknown(root?.creative_preview);
  if (!preview) return { imageUrl: null, thumbnailUrl: null };

  const imageUrl = stringFromRecord(preview, "image_url");
  const thumbnailUrl = stringFromRecord(preview, "thumbnail_url");
  return {
    imageUrl: imageUrl || thumbnailUrl,
    thumbnailUrl,
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
      const preview = creativePreviewFromPayload(row.raw_payload);
      group.previewImageUrl = group.previewImageUrl || preview.imageUrl;
      group.previewThumbnailUrl = group.previewThumbnailUrl || preview.thumbnailUrl;
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
  const candidatesByKeyword = new Map<
    string,
    Map<
      string,
      {
        id: string;
        spendCents: number;
        impressions: number;
        linkClicks: number;
        firstDate: string;
        lastDate: string;
        active: boolean;
        dateMetrics: Map<string, { spendCents: number; impressions: number; linkClicks: number }>;
      }
    >
  >();

  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw) || keywordFromAdName(row.ad_name);
    if (!keyword) continue;
    const key = keyForMetaRow(row, keyword);
    const id = groupIdForRow(row, keyword);
    const candidates = candidatesByKeyword.get(key) || new Map<
      string,
      {
        id: string;
        spendCents: number;
        impressions: number;
        linkClicks: number;
        firstDate: string;
        lastDate: string;
        active: boolean;
        dateMetrics: Map<string, { spendCents: number; impressions: number; linkClicks: number }>;
      }
    >();
    const candidate = candidates.get(id) || {
      id,
      spendCents: 0,
      impressions: 0,
      linkClicks: 0,
      firstDate: row.date,
      lastDate: row.date,
      active: false,
      dateMetrics: new Map<string, { spendCents: number; impressions: number; linkClicks: number }>(),
    };
    candidate.spendCents += row.spend_cents || 0;
    candidate.impressions += row.impressions || 0;
    candidate.linkClicks += row.link_clicks || 0;
    const existingDateMetrics = candidate.dateMetrics.get(row.date) || {
      spendCents: 0,
      impressions: 0,
      linkClicks: 0,
    };
    existingDateMetrics.spendCents += row.spend_cents || 0;
    existingDateMetrics.impressions += row.impressions || 0;
    existingDateMetrics.linkClicks += row.link_clicks || 0;
    candidate.dateMetrics.set(row.date, existingDateMetrics);
    if (row.date < candidate.firstDate) candidate.firstDate = row.date;
    if (row.date > candidate.lastDate) candidate.lastDate = row.date;
    if (metaRowStatus(row) === "active") candidate.active = true;
    candidates.set(id, candidate);
    candidatesByKeyword.set(key, candidates);
  }

  return (row: T, keyword: string, fallbackId: string) => {
    const candidates = Array.from(
      candidatesByKeyword.get(keyForAttributionRow(row, keyword))?.values() || []
    );
    if (candidates.length === 0) return fallbackId;
    if (candidates.length === 1) return candidates[0].id;

    const attributionDate = attributionDateForResolver(row);
    if (attributionDate) {
      const exactDateCandidates = candidates
        .map((candidate) => {
          const metrics = candidate.dateMetrics.get(attributionDate);
          return metrics ? { ...candidate, exactDateMetrics: metrics } : null;
        })
        .filter((candidate): candidate is (typeof candidates)[number] & {
          exactDateMetrics: { spendCents: number; impressions: number; linkClicks: number };
        } => Boolean(candidate))
        .filter(
          (candidate) =>
            candidate.exactDateMetrics.spendCents > 0 ||
            candidate.exactDateMetrics.impressions > 0 ||
            candidate.exactDateMetrics.linkClicks > 0
        )
        .sort(
          (a, b) =>
            b.exactDateMetrics.spendCents - a.exactDateMetrics.spendCents ||
            b.exactDateMetrics.impressions - a.exactDateMetrics.impressions ||
            b.exactDateMetrics.linkClicks - a.exactDateMetrics.linkClicks
        );

      if (exactDateCandidates[0]) return exactDateCandidates[0].id;

      const rankedByDate = candidates
        .map((candidate) => ({
          ...candidate,
          distanceDays: distanceFromDateWindow(attributionDate, candidate.firstDate, candidate.lastDate),
        }))
        .sort(
          (a, b) =>
            a.distanceDays - b.distanceDays ||
            b.spendCents - a.spendCents ||
            b.impressions - a.impressions ||
            b.linkClicks - a.linkClicks
        );
      if (
        rankedByDate[0] &&
        rankedByDate[0].distanceDays <= 30 &&
        rankedByDate[0].distanceDays < (rankedByDate[1]?.distanceDays ?? Number.POSITIVE_INFINITY)
      ) {
        return rankedByDate[0].id;
      }
    }

    const activeCandidates = candidates.filter((candidate) => candidate.active);
    if (activeCandidates.length === 1) return activeCandidates[0].id;

    const deliveredCandidates = candidates.filter(
      (candidate) =>
        candidate.spendCents > 0 || candidate.impressions > 0 || candidate.linkClicks > 0
    );
    const ranked = (deliveredCandidates.length ? deliveredCandidates : candidates).sort(
      (a, b) =>
        b.spendCents - a.spendCents ||
        b.impressions - a.impressions ||
        b.linkClicks - a.linkClicks
    );
    const top = ranked[0];
    const totalSpend = ranked.reduce((sum, candidate) => sum + candidate.spendCents, 0);
    const totalImpressions = ranked.reduce((sum, candidate) => sum + candidate.impressions, 0);

    if (totalSpend > 0 && top.spendCents / totalSpend >= 0.8) return top.id;
    if (totalImpressions > 0 && top.impressions / totalImpressions >= 0.8) return top.id;

    return fallbackId;
  };
}

function attributionDateForResolver(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  if ("event_at" in row && typeof row.event_at === "string") return eventDateKey(row.event_at);
  if ("date" in row && typeof row.date === "string") return row.date;
  return null;
}

function distanceFromDateWindow(date: string, firstDate: string, lastDate: string) {
  if (date >= firstDate && date <= lastDate) return 0;
  if (date < firstDate) return daysBetween(date, firstDate);
  return daysBetween(lastDate, date);
}

function daysBetween(from: string, to: string) {
  const fromMs = Date.parse(`${from}T00:00:00.000Z`);
  const toMs = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.round((toMs - fromMs) / 86_400_000));
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

function attributionPickerOptionsFromMetaRows(rows: MetaRow[]) {
  const keywordOptions = new Map<string, Record<string, unknown>>();
  const campaignOptions = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw) || keywordFromAdName(row.ad_name);
    const campaignId = row.campaign_id || row.campaign_name || "campaign";
    const campaignKey = `${row.client_key}:${campaignId}`;
    const campaignStatus = metaRowStatus(row);
    const campaignName = row.campaign_name || campaignDisplayName(row);
    const adId = row.ad_id || keyword || row.ad_name || "ad";
    const groupId = keyword ? adGroupId(row, keyword) : `${campaignKey}:${adId}`;
    const spend = dollars(row.spend_cents || 0);

    const campaign = campaignOptions.get(campaignKey) || {
      id: campaignKey,
      clientKey: row.client_key,
      campaignId: row.campaign_id,
      campaignName,
      name: campaignName,
      firstDate: row.date,
      lastDate: row.date,
      status: "finished",
      spend: 0,
    };
    if (row.date < String(campaign.firstDate)) campaign.firstDate = row.date;
    if (row.date > String(campaign.lastDate)) campaign.lastDate = row.date;
    if (campaignStatus === "active") campaign.status = "active";
    campaign.spend = Number(campaign.spend || 0) + spend;
    campaignOptions.set(campaignKey, campaign);

    if (!keyword) continue;
    const key = `${row.client_key}:${groupId}:${keyword}`;
    const option = keywordOptions.get(key) || {
      id: key,
      clientKey: row.client_key,
      keyword: displayKeyword(keyword),
      campaignId: row.campaign_id,
      campaignName,
      adId: row.ad_id,
      adName: row.ad_name || displayKeyword(keyword),
      groupId,
      groupName: row.ad_name || displayKeyword(keyword),
      firstDate: row.date,
      lastDate: row.date,
      status: "finished",
      spend: 0,
    };
    if (row.date < String(option.firstDate)) option.firstDate = row.date;
    if (row.date > String(option.lastDate)) option.lastDate = row.date;
    if (campaignStatus === "active") option.status = "active";
    option.spend = Number(option.spend || 0) + spend;
    keywordOptions.set(key, option);
  }

  const sortOptions = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    String(b.lastDate || "").localeCompare(String(a.lastDate || "")) ||
    Number(b.spend || 0) - Number(a.spend || 0) ||
    String(a.keyword || a.campaignName || "").localeCompare(String(b.keyword || b.campaignName || ""));

  return {
    keywordOptions: Array.from(keywordOptions.values()).sort(sortOptions),
    campaignOptions: Array.from(campaignOptions.values()).sort(sortOptions),
  };
}

function stringFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function booleanFromRecord(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return value === true || value === "true";
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

  const candidatesByAd = new Map<
    string,
    {
      row: MetaRow;
      spendCents: number;
      impressions: number;
      linkClicks: number;
    }
  >();

  for (const metaRow of metaRows) {
    if (metaRow.client_key !== row.client_key || metaRow.date !== row.date) continue;
    if (!hasMetaDelivery(metaRow)) continue;
    const metaKeyword =
      normalizeKeyword(metaRow.keyword_normalized || metaRow.keyword_raw) || keywordFromAdName(metaRow.ad_name);
    if (metaKeyword !== keyword) continue;

    const key = groupKeyForMetaRow(metaRow);
    const existing = candidatesByAd.get(key) || {
      row: metaRow,
      spendCents: 0,
      impressions: 0,
      linkClicks: 0,
    };
    existing.spendCents += metaRow.spend_cents || 0;
    existing.impressions += metaRow.impressions || 0;
    existing.linkClicks += metaRow.link_clicks || 0;
    candidatesByAd.set(key, existing);
  }

  const candidates = Array.from(candidatesByAd.values())
    .filter((metaRow) => {
      return metaRow.spendCents > 0 || metaRow.impressions > 0 || metaRow.linkClicks > 0;
    })
    .sort(
      (a, b) =>
        b.spendCents - a.spendCents ||
        b.impressions - a.impressions ||
        b.linkClicks - a.linkClicks
    );

  if (candidates.length === 0) return null;

  return hintFromMetaRow(candidates[0].row, keyword);
}

function exactMetaHintForKeywordEvent(event: KeywordEvent, metaRows: MetaRow[]): BackfillGroupHint | null {
  const keyword = normalizeKeyword(event.keyword_normalized || event.keyword_raw);
  if (!keyword) return null;

  const eventDate = eventDateKey(event.event_at);
  const candidatesByAd = new Map<
    string,
    {
      row: MetaRow;
      spendCents: number;
      impressions: number;
      linkClicks: number;
    }
  >();

  for (const metaRow of metaRows) {
    if (metaRow.client_key !== event.client_key || metaRow.date !== eventDate) continue;
    if (!hasMetaDelivery(metaRow)) continue;
    const metaKeyword =
      normalizeKeyword(metaRow.keyword_normalized || metaRow.keyword_raw) || keywordFromAdName(metaRow.ad_name);
    if (metaKeyword !== keyword) continue;

    const key = groupKeyForMetaRow(metaRow);
    const existing = candidatesByAd.get(key) || {
      row: metaRow,
      spendCents: 0,
      impressions: 0,
      linkClicks: 0,
    };
    existing.spendCents += metaRow.spend_cents || 0;
    existing.impressions += metaRow.impressions || 0;
    existing.linkClicks += metaRow.link_clicks || 0;
    candidatesByAd.set(key, existing);
  }

  const candidates = Array.from(candidatesByAd.values()).sort(
    (a, b) =>
      b.spendCents - a.spendCents ||
      b.impressions - a.impressions ||
      b.linkClicks - a.linkClicks
  );

  if (candidates.length === 0) return null;

  return hintFromMetaRow(candidates[0].row, keyword);
}

function hintForAttributionGroupId(
  groupId: string,
  metaRows: MetaRow[],
  keyword: string
): BackfillGroupHint | null {
  const normalizedKeyword = normalizeKeyword(keyword);
  if (!normalizedKeyword) return null;
  const candidates = metaRows
    .filter((metaRow) => {
      const metaKeyword =
        normalizeKeyword(metaRow.keyword_normalized || metaRow.keyword_raw) || keywordFromAdName(metaRow.ad_name);
      if (metaKeyword !== normalizedKeyword) return false;
      const adId = adGroupId(metaRow, normalizedKeyword);
      const campaignId = campaignGroupId(metaRow);
      return (
        groupId === adId ||
        groupId === campaignId ||
        groupId.endsWith(`:${adId}`) ||
        groupId.endsWith(`:${campaignId}`)
      );
    })
    .sort((a, b) =>
      (b.spend_cents || 0) - (a.spend_cents || 0) ||
      (b.impressions || 0) - (a.impressions || 0)
    );

  return candidates[0] ? hintFromMetaRow(candidates[0], normalizedKeyword) : null;
}

function appointmentBookingEventAt(appointment: GhlAppointmentRow | null | undefined): string | null {
  if (!appointment) return null;
  const payload = recordFromUnknown(appointment.raw_payload);
  const calendar = recordFromUnknown(payload?.calendar);

  return (
    stringFromRecord(calendar || {}, "date_created") ||
    stringFromRecord(calendar || {}, "dateCreated") ||
    stringFromRecord(calendar || {}, "created_at") ||
    stringFromRecord(calendar || {}, "createdAt") ||
    stringFromRecord(payload || {}, "appointment_created_at") ||
    stringFromRecord(payload || {}, "appointmentCreatedAt") ||
    stringFromRecord(payload || {}, "booking_created_at") ||
    stringFromRecord(payload || {}, "bookingCreatedAt") ||
    appointment.created_at ||
    null
  );
}

function normalizeGhlKeywordEventDates(
  events: KeywordEvent[],
  appointments: GhlAppointmentRow[]
): KeywordEvent[] {
  const appointmentsById = new Map(
    appointments
      .filter((appointment) => appointment.appointment_id)
      .map((appointment) => [appointment.appointment_id as string, appointment])
  );

  return events.map((event) => {
    if (event.source !== "ghl" || !event.appointment_id) return event;
    const bookingEventAt = appointmentBookingEventAt(appointmentsById.get(event.appointment_id));
    return bookingEventAt ? { ...event, event_at: bookingEventAt } : event;
  });
}

function campaignHintForBackfillRow(row: KeywordBackfillRow, metaRows: MetaRow[]): BackfillGroupHint | null {
  const exactHint = exactMetaHintForBackfillRow(row, metaRows);
  if (exactHint) return exactHint;

  const payloadHint = campaignHintFromBackfillPayload(row);
  if (payloadHint) return payloadHint;

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

function dailySalesGroupIdFromSaleDate(
  match: KeywordEvent,
  row: SheetRow,
  keyword: string,
  periodAttributionGroupId: (row: KeywordEvent, keyword: string, fallbackId: string) => string
) {
  const resolvedBookingIdentity = match.override_group_id ||
    periodAttributionGroupId(
      match,
      keyword,
      `${match.client_key}:keyword:${keyword}`
    );

  return `${row.date}:${resolvedBookingIdentity}`;
}

function resolvedAttributionGroupId(
  match: KeywordEvent,
  keyword: string,
  level: AdsTrackerLevel,
  fallbackId: string
) {
  const campaignIdentity = match.override_campaign_id || match.override_campaign_name;
  if (campaignIdentity) {
    if (level === "campaign") return `${match.client_key}:${campaignIdentity}`;
    return `${match.client_key}:${campaignIdentity}:${match.override_ad_id || keyword}`;
  }

  return match.override_group_id || fallbackId;
}

function dailyResolvedAttributionGroupId(
  match: KeywordEvent,
  keyword: string,
  level: AdsTrackerLevel,
  date: string,
  fallbackId: string
) {
  const campaignIdentity = match.override_campaign_id || match.override_campaign_name;
  if (campaignIdentity) {
    return `${date}:${resolvedAttributionGroupId(match, keyword, level, fallbackId)}`;
  }
  if (match.override_group_id) return `${date}:${match.override_group_id}`;
  return fallbackId.startsWith(`${date}:`) ? fallbackId : `${date}:${fallbackId}`;
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
  dateLabelForEvent: (event: KeywordEvent) => string,
  hintForEvent?: (event: KeywordEvent, keyword: string, groupId: string) => BackfillGroupHint | null
) {
  for (const event of events) {
    const keyword = normalizeKeyword(event.keyword_normalized || event.keyword_raw);
    if (!keyword) continue;
    const id = groupIdForEvent(event, keyword);
    const group = groups.get(id) || emptyGroup(id, event.client_key, displayKeyword(keyword), displayKeyword(keyword));
    applyOverrideMetadata(group, event);
    applyBackfillHint(group, hintForEvent?.(event, keyword, id) || null, "ad");
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
    } else if (event.event_type === "manual_missing_booking_attribution_override") {
      group.bookedCalls += 1;
    } else if (event.event_type !== "manual_attribution_override") {
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

async function fetchMetaRows(
  db: ReturnType<typeof getServiceSupabase>,
  query: AdsTrackerQuery,
  clientFilter: string[]
): Promise<MetaRow[]> {
  return fetchMetaRowsForDateRange(db, clientFilter, query.dateFrom, query.dateTo);
}

async function fetchMetaRowsForDateRange(
  db: ReturnType<typeof getServiceSupabase>,
  clientFilter: string[],
  dateFrom: string,
  dateTo: string
): Promise<MetaRow[]> {
  const rows: MetaRow[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await db
      .from("ads_meta_insights_daily")
      .select("*")
      .in("client_key", clientFilter)
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .order("date", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw new Error(`Meta insights query failed: ${error.message}`);

    const page = (data || []) as MetaRow[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

async function fetchKeywordEvents(
  db: ReturnType<typeof getServiceSupabase>,
  clientFilter: string[],
  eventQueryFrom: string,
  eventQueryTo: string
): Promise<KeywordEvent[]> {
  const rows: KeywordEvent[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await db
      .from("ads_keyword_events")
      .select(
        "source,event_type,client_key,keyword_raw,keyword_normalized,value_cents,subscriber_id,subscriber_name,setter_name,appointment_id,contact_id,contact_name,event_at"
      )
      .in("client_key", clientFilter)
      .gte("event_at", eventQueryFrom)
      .lte("event_at", eventQueryTo)
      .order("event_at", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw new Error(`Keyword events query failed: ${error.message}`);

    const page = (data || []) as KeywordEvent[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

function adsClientKeyFromManychatClient(client: string | null | undefined): "tyson" | "keith" | null {
  const value = (client || "").trim().toLowerCase();
  if (value.includes("tyson")) return "tyson";
  if (value.includes("keith")) return "keith";
  return null;
}

function manychatMissingKeywordAlertKey(row: ManychatTagEventRow, clientKey: string) {
  return [
    "manychat_missing_keyword",
    clientKey,
    row.subscriber_id,
    row.event_at,
  ].join(":");
}

function instagramHandleFromPayload(payload: unknown) {
  return extractStringByKeys(payload, ["instagram_handle", "instagramHandle", "username"]);
}

function manychatConversationUrl(subscriberId: string | null | undefined) {
  if (!subscriberId) return null;
  const base = process.env.MANYCHAT_APP_CHAT_BASE_URL || "https://app.manychat.com/fb1024471/chat";
  return `${base.replace(/\/$/, "")}/${encodeURIComponent(subscriberId)}`;
}

async function fetchManychatMissingKeywordEvents(
  db: ReturnType<typeof getServiceSupabase>,
  clientFilter: string[],
  eventQueryFrom: string,
  eventQueryTo: string
): Promise<ManychatTagEventRow[]> {
  const rows: ManychatTagEventRow[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await db
      .from("manychat_tag_events")
      .select(
        "id,subscriber_id,subscriber_name,tag_name,client,setter_name,keyword_raw,keyword_normalized,raw_payload,event_at"
      )
      .in("tag_name", MANYCHAT_MISSING_KEYWORD_TAG_NAMES)
      .gte("event_at", eventQueryFrom)
      .lte("event_at", eventQueryTo)
      .order("event_at", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) {
      console.warn("[ads-tracker] ManyChat missing-keyword alerts unavailable", error);
      return [];
    }

    const page = ((data || []) as ManychatTagEventRow[]).filter((row) => {
      const clientKey = adsClientKeyFromManychatClient(row.client);
      return Boolean(clientKey && clientFilter.includes(clientKey));
    });
    rows.push(...page);
    if ((data || []).length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

function buildMissingManychatKeywordAlerts(
  rows: ManychatTagEventRow[],
  resolutionBySaleKey: Map<string, AttributionResolution>
): UnmatchedSale[] {
  const alerts: UnmatchedSale[] = [];

  for (const row of rows) {
    const clientKey = adsClientKeyFromManychatClient(row.client);
    if (!clientKey) continue;
    const key = manychatMissingKeywordAlertKey(row, clientKey);
    if (resolutionBySaleKey.has(key)) continue;
    const eventDate = eventDateKey(row.event_at);

    alerts.push({
      key,
      date: eventDate,
      clientKey,
      name: row.subscriber_name || row.subscriber_id || "Unknown",
      setter: row.setter_name || "",
      outcome: "",
      callTaken: false,
      contractedRevenue: 0,
      collectedRevenue: 0,
      amount: 0,
      reason: "missing_manychat_keyword",
      classification: "missing_keyword",
      alertType: "missing_dm_keyword",
      subscriberId: row.subscriber_id,
      instagramHandle: instagramHandleFromPayload(row.raw_payload),
      manychatUrl: manychatConversationUrl(row.subscriber_id),
      eventAt: row.event_at,
    });
  }

  return alerts;
}

function adsClientKeyFromGhlClient(value: string | null | undefined): string | null {
  const normalized = (value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (normalized === "tyson" || normalized === "tyson_sonnek") return "tyson";
  if (normalized === "keith" || normalized === "keith_holland") return "keith";
  return null;
}

function missingGhlBookingKeywordAlertKey(
  appointment: GhlAppointmentRow,
  clientKey: string
): string {
  const stableId =
    appointment.appointment_id ||
    appointment.contact_id ||
    appointmentBookingEventAt(appointment) ||
    appointment.start_time ||
    "unknown";
  return `ghl_booking_missing_keyword:${clientKey}:${stableId}`;
}

function buildMissingGhlBookingKeywordEvents(
  appointments: GhlAppointmentRow[],
  clientFilter: string[],
  resolutionBySaleKey: Map<string, AttributionResolution>
): KeywordEvent[] {
  const events: KeywordEvent[] = [];

  for (const appointment of appointments) {
    const clientKey = adsClientKeyFromGhlClient(appointment.client);
    if (!clientKey || !clientFilter.includes(clientKey)) continue;
    if (!appointment.appointment_id) continue;
    if (!isBookableAppointment(appointment)) continue;
    if (normalizeKeyword(appointment.keyword_normalized || appointment.keyword_raw)) continue;

    const alertKey = missingGhlBookingKeywordAlertKey(appointment, clientKey);
    if (resolutionBySaleKey.has(alertKey)) continue;

    events.push({
      source: "ghl",
      event_type: "missing_booking_keyword",
      client_key: clientKey,
      keyword_raw: null,
      keyword_normalized: null,
      attribution_resolution_id: alertKey,
      subscriber_id: extractManychatSubscriberId(appointment.raw_payload),
      subscriber_name: null,
      setter_name: null,
      appointment_id: appointment.appointment_id,
      contact_id: appointment.contact_id,
      contact_name: appointment.contact_name,
      event_at:
        appointmentBookingEventAt(appointment) ||
        appointment.created_at ||
        appointment.start_time ||
        new Date().toISOString(),
    });
  }

  return events;
}

function buildMissingGhlBookingKeywordAlerts(
  events: KeywordEvent[],
  resolutionBySaleKey: Map<string, AttributionResolution>,
  salesRows: SheetRow[] = []
): UnmatchedSale[] {
  const coveredBySalesAlert = new Set(
    salesRows
      .filter(shouldTrackUnmatchedSale)
      .map((row) => normalizePersonName(row.name))
      .filter((value): value is string => Boolean(value))
  );

  return events
    .filter((event) => event.attribution_resolution_id)
    .filter((event) => !resolutionBySaleKey.has(event.attribution_resolution_id as string))
    .filter((event) => {
      const name = normalizePersonName(event.contact_name);
      return !name || !coveredBySalesAlert.has(name);
    })
    .map((event) => ({
      key: event.attribution_resolution_id as string,
      date: eventDateKey(event.event_at),
      clientKey: event.client_key,
      name: event.contact_name || event.appointment_id || "Unknown",
      setter: "",
      outcome: "",
      callTaken: false,
      contractedRevenue: 0,
      collectedRevenue: 0,
      amount: 0,
      reason: "missing_booking_keyword" as const,
      classification: "missing_keyword" as const,
      alertType: "missing_booking_keyword" as const,
      appointmentId: event.appointment_id,
      contactId: event.contact_id,
      eventAt: event.event_at,
    }));
}

async function fetchGhlAppointments(
  db: ReturnType<typeof getServiceSupabase>,
  eventQueryFrom: string,
  eventQueryTo: string
): Promise<GhlAppointmentRow[]> {
  const rows: GhlAppointmentRow[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await db
      .from("ghl_appointments")
      .select(
        "appointment_id,client,contact_id,contact_name,keyword_raw,keyword_normalized,start_time,created_at,status,event_type,raw_payload"
      )
      .gte("created_at", eventQueryFrom)
      .lte("created_at", eventQueryTo)
      .order("created_at", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw new Error(`GHL appointments query failed: ${error.message}`);

    const page = (data || []) as GhlAppointmentRow[];
    rows.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isResolutionAction(value: unknown): value is AttributionResolutionAction {
  return value === "attribute" || value === "organic" || value === "unattributed" || value === "ignore";
}

function parseAttributionResolution(row: AttributionExceptionRow): AttributionResolution | null {
  const payload = asObject(row.payload);
  if (!payload) return null;

  const saleKey = stringFromRecord(payload, "saleKey") || stringFromRecord(payload, "sale_key");
  const actionValue = stringFromRecord(payload, "action") || row.reason;
  if (!saleKey || !isResolutionAction(actionValue)) return null;
  const salePayload = asObject(payload.sale);

  const keyword =
    normalizeKeyword(row.keyword_normalized) ||
    normalizeKeyword(stringFromRecord(payload, "keyword")) ||
    normalizeKeyword(stringFromRecord(payload, "keywordRaw"));

  return {
    id: row.id,
    source: row.source,
    saleKey,
    action: actionValue,
    clientKey: row.client_key || stringFromRecord(payload, "clientKey"),
    keywordNormalized: keyword,
    keywordRaw:
      stringFromRecord(payload, "keywordRaw") ||
      stringFromRecord(payload, "keyword") ||
      (keyword ? displayKeyword(keyword) : null),
    noKeyword: booleanFromRecord(payload, "noKeyword"),
    paidAttributionType: stringFromRecord(payload, "paidAttributionType"),
    contactName: row.contact_name || stringFromRecord(payload, "contactName"),
    subscriberId: stringFromRecord(payload, "subscriberId"),
    subscriberName: stringFromRecord(payload, "subscriberName"),
    appointmentId: row.appointment_id || stringFromRecord(payload, "appointmentId"),
    contactId: stringFromRecord(payload, "contactId"),
    eventAt: stringFromRecord(payload, "eventAt"),
    saleDate: salePayload ? stringFromRecord(salePayload, "date") : null,
    campaignId: stringFromRecord(payload, "campaignId"),
    campaignName: stringFromRecord(payload, "campaignName"),
    adId: stringFromRecord(payload, "adId"),
    adName: stringFromRecord(payload, "adName"),
    groupId: stringFromRecord(payload, "groupId"),
    groupName: stringFromRecord(payload, "groupName"),
    note: stringFromRecord(payload, "note"),
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    alertType: parseAlertType(stringFromRecord(payload, "alertType")),
  };
}

function parseAlertType(value: string | null): AttributionResolution["alertType"] {
  if (
    value === "sale" ||
    value === "call" ||
    value === "missing_dm_keyword" ||
    value === "missing_booking_keyword"
  ) {
    return value;
  }
  return null;
}

async function fetchAttributionResolutions(
  db: ReturnType<typeof getServiceSupabase>
): Promise<AttributionResolution[]> {
  const rows: AttributionResolution[] = [];

  for (let from = 0; ; from += SUPABASE_PAGE_SIZE) {
    const { data, error } = await db
      .from("ads_attribution_exceptions")
      .select(
        "id,source,reason,client_key,keyword_normalized,contact_name,appointment_id,payload,resolved_at,created_at"
      )
      .in("source", [ALERT_RESOLUTION_SOURCE, AUTO_ATTRIBUTION_SOURCE])
      .order("created_at", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);

    if (error) throw new Error(`Attribution alert resolutions query failed: ${error.message}`);

    const page = ((data || []) as AttributionExceptionRow[])
      .map(parseAttributionResolution)
      .filter((value): value is AttributionResolution => Boolean(value));
    rows.push(...page);
    if ((data || []).length < SUPABASE_PAGE_SIZE) break;
  }

  return rows;
}

function latestResolutionsBySaleKey(resolutions: AttributionResolution[]) {
  const latest = new Map<string, AttributionResolution>();
  for (const resolution of resolutions) {
    const previous = latest.get(resolution.saleKey);
    if (!previous || resolutionPriority(resolution) >= resolutionPriority(previous)) {
      latest.set(resolution.saleKey, resolution);
    }
  }
  return latest;
}

function resolutionPriority(resolution: AttributionResolution) {
  if (resolution.source === ALERT_RESOLUTION_SOURCE) return 2;
  if (resolution.source === AUTO_ATTRIBUTION_SOURCE) return 1;
  return 0;
}

async function persistAutomaticSalesAttributions({
  db,
  salesRows,
  bookings,
  clientFilter,
  existingResolutionBySaleKey,
  backfilledDateKeys,
  attributionRows,
  adAttributionGroupId,
}: {
  db: ReturnType<typeof getServiceSupabase>;
  salesRows: SheetRow[];
  bookings: KeywordEvent[];
  clientFilter: string[];
  existingResolutionBySaleKey: Map<string, AttributionResolution>;
  backfilledDateKeys: Set<string>;
  attributionRows: MetaRow[];
  adAttributionGroupId: (row: KeywordEvent, keyword: string, fallbackId: string) => string;
}): Promise<AttributionResolution[]> {
  const bookingsByName = bookingsByContactName(bookings);
  const now = new Date().toISOString();
  const inserts: Array<Record<string, unknown>> = [];
  const saleKeysInBatch = new Set<string>();

  for (const row of salesRows) {
    if (!shouldTrackUnmatchedSale(row)) continue;
    const clientKey = clientFromOffer(row);
    if (!clientKey || !clientFilter.includes(clientKey)) continue;
    if (backfilledDateKeys.has(`${clientKey}:${row.date}`)) continue;

    const saleKey = salesRowKey(row, clientKey);
    const existingResolution = existingResolutionBySaleKey.get(saleKey);
    if (saleKeysInBatch.has(saleKey)) continue;
    if (existingResolution && existingResolution.source !== AUTO_ATTRIBUTION_SOURCE) continue;

    const match = matchedBookingForSalesRow(row, bookingsByName);
    if (!match) continue;

    const keyword = normalizeKeyword(match.keyword_normalized || match.keyword_raw);
    if (!keyword) continue;

    const resolvedAdGroupId = adAttributionGroupId(match, keyword, `${match.client_key}:keyword:${keyword}`);
    if (isFallbackAttributionGroupId(resolvedAdGroupId)) continue;

    const hint =
      hintForAttributionGroupId(resolvedAdGroupId, attributionRows, keyword) ||
      exactMetaHintForKeywordEvent(match, attributionRows);
    if (!hint?.campaignName && !hint?.adName) continue;
    if (
      existingResolution?.action === "attribute" &&
      existingResolution.groupId === resolvedAdGroupId &&
      normalizeKeyword(existingResolution.keywordNormalized || existingResolution.keywordRaw) === keyword
    ) {
      continue;
    }

    saleKeysInBatch.add(saleKey);
    inserts.push({
      source: AUTO_ATTRIBUTION_SOURCE,
      reason: "attribute",
      client_key: clientKey,
      keyword_normalized: keyword,
      contact_name: row.name || match.contact_name,
      appointment_id: match.appointment_id,
      payload: {
        saleKey,
        action: "attribute",
        clientKey,
        keyword: displayKeyword(keyword),
        keywordRaw: match.keyword_raw || displayKeyword(keyword),
        campaignId: hint.campaignId,
        campaignName: hint.campaignName,
        adId: hint.adId,
        adName: hint.adName,
        groupId: resolvedAdGroupId,
        groupName: hint.adName || displayKeyword(keyword),
        contactName: row.name || match.contact_name,
        sale: {
          date: row.date,
          name: row.name,
          setter: row.setter,
          amount: saleAmount(row),
          outcome: row.outcome,
          callTaken: row.callTaken,
        },
        booking: {
          appointmentId: match.appointment_id,
          contactId: match.contact_id,
          contactName: match.contact_name,
          eventAt: match.event_at,
        },
        created_from: "ads_tracker_auto_sales_attribution",
        created_at: now,
      },
      resolved_at: now,
    });
  }

  if (inserts.length === 0) return [];

  const { data, error } = await db
    .from("ads_attribution_exceptions")
    .insert(inserts)
    .select("id,source,reason,client_key,keyword_normalized,contact_name,appointment_id,payload,resolved_at,created_at");

  if (error) {
    throw new Error(`Automatic sales attribution save failed: ${error.message}`);
  }

  return ((data || []) as AttributionExceptionRow[])
    .map(parseAttributionResolution)
    .filter((value): value is AttributionResolution => Boolean(value));
}

function resolutionHasCampaignTarget(resolution: AttributionResolution) {
  return Boolean(resolution.campaignId || resolution.campaignName || resolution.groupId);
}

function noKeywordEventAt(resolution: AttributionResolution, fallbackDate?: string | null) {
  if (resolution.eventAt) return resolution.eventAt;
  if (fallbackDate) return `${fallbackDate}T12:00:00.000Z`;
  if (resolution.saleDate) return `${resolution.saleDate}T12:00:00.000Z`;
  return resolution.resolvedAt || resolution.createdAt || new Date().toISOString();
}

function noKeywordAdId(resolution: AttributionResolution) {
  return resolution.adId || `${NO_KEYWORD_ATTRIBUTION_AD_ID}:${normalizeKeyPart(
    resolution.campaignId || resolution.campaignName || resolution.groupId || "unknown"
  )}`;
}

function attributionOverrideEventForRow(
  row: SheetRow,
  resolution: AttributionResolution | undefined,
  clientKey: string | null,
  hasRealGhlBooking = true
): KeywordEvent | null {
  if (!resolution || resolution.action !== "attribute") return null;

  const keyword = normalizeKeyword(resolution.keywordNormalized || resolution.keywordRaw);
  const resolvedClientKey = resolution.clientKey || clientKey;
  const useNoKeyword = !keyword && resolution.noKeyword && resolutionHasCampaignTarget(resolution);
  const eventKeyword = keyword || (useNoKeyword ? NO_KEYWORD_ATTRIBUTION_KEYWORD : null);
  if (!eventKeyword || !resolvedClientKey) return null;

  return {
    source: "ghl",
    event_type: hasRealGhlBooking
      ? "manual_attribution_override"
      : "manual_missing_booking_attribution_override",
    client_key: resolvedClientKey,
    keyword_raw: keyword
      ? resolution.keywordRaw || displayKeyword(keyword)
      : NO_KEYWORD_ATTRIBUTION_LABEL,
    keyword_normalized: eventKeyword,
    override_group_id: resolution.groupId,
    override_group_name:
      resolution.source === AUTO_ATTRIBUTION_SOURCE || useNoKeyword ? null : resolution.groupName,
    override_campaign_id: resolution.campaignId,
    override_campaign_name: resolution.campaignName,
    override_ad_id: useNoKeyword ? noKeywordAdId(resolution) : resolution.adId,
    override_ad_name: useNoKeyword ? NO_KEYWORD_ATTRIBUTION_LABEL : resolution.adName,
    attribution_resolution_id: resolution.id,
    subscriber_id: null,
    subscriber_name: null,
    setter_name: row.setter || null,
    appointment_id: null,
    contact_id: null,
    contact_name: row.name || resolution.contactName,
    event_at: `${row.date}T12:00:00.000Z`,
  };
}

function attributionOverrideEventForStandaloneResolution(
  resolution: AttributionResolution
): KeywordEvent | null {
  if (
    resolution.action !== "attribute" ||
    !resolution.noKeyword ||
    !resolution.clientKey ||
    !resolutionHasCampaignTarget(resolution)
  ) {
    return null;
  }

  if (resolution.alertType === "missing_dm_keyword") {
    return {
      source: "manychat",
      event_type: "manual_messages",
      client_key: resolution.clientKey,
      keyword_raw: NO_KEYWORD_ATTRIBUTION_LABEL,
      keyword_normalized: NO_KEYWORD_ATTRIBUTION_KEYWORD,
      override_group_id: resolution.groupId,
      override_group_name: null,
      override_campaign_id: resolution.campaignId,
      override_campaign_name: resolution.campaignName,
      override_ad_id: noKeywordAdId(resolution),
      override_ad_name: NO_KEYWORD_ATTRIBUTION_LABEL,
      attribution_resolution_id: resolution.id,
      value_cents: 1,
      subscriber_id: resolution.subscriberId,
      subscriber_name: resolution.subscriberName || resolution.contactName,
      setter_name: null,
      appointment_id: null,
      contact_id: null,
      contact_name: resolution.contactName,
      event_at: noKeywordEventAt(resolution),
    };
  }

  if (resolution.alertType === "missing_booking_keyword") {
    return {
      source: "ghl",
      event_type: "manual_missing_booking_attribution_override",
      client_key: resolution.clientKey,
      keyword_raw: NO_KEYWORD_ATTRIBUTION_LABEL,
      keyword_normalized: NO_KEYWORD_ATTRIBUTION_KEYWORD,
      override_group_id: resolution.groupId,
      override_group_name: null,
      override_campaign_id: resolution.campaignId,
      override_campaign_name: resolution.campaignName,
      override_ad_id: noKeywordAdId(resolution),
      override_ad_name: NO_KEYWORD_ATTRIBUTION_LABEL,
      attribution_resolution_id: resolution.id,
      subscriber_id: resolution.subscriberId,
      subscriber_name: resolution.subscriberName,
      setter_name: null,
      appointment_id: resolution.appointmentId,
      contact_id: resolution.contactId,
      contact_name: resolution.contactName,
      event_at: noKeywordEventAt(resolution),
    };
  }

  return null;
}

function resolvedAlertForRow(
  row: SheetRow,
  clientKey: string | null,
  resolution: AttributionResolution
): ResolvedAttributionAlert {
  const keyword = normalizeKeyword(resolution.keywordNormalized || resolution.keywordRaw);
  return {
    id: resolution.id,
    saleKey: resolution.saleKey,
    action: resolution.action,
    date: row.date,
    clientKey: resolution.clientKey || clientKey,
    name: row.name || resolution.contactName || "Unknown",
    setter: row.setter || "",
    amount: saleAmount(row),
    keyword: keyword ? displayKeyword(keyword) : "",
    campaignName: resolution.campaignName,
    adName: resolution.adName,
    note: resolution.note,
    resolvedAt: resolution.resolvedAt || resolution.createdAt,
  };
}

function historyEventAtForSalesRow(row: SheetRow) {
  return `${row.date}T12:00:00.000Z`;
}

function historyKeyword(keyword: string | null | undefined) {
  const normalized = normalizeKeyword(keyword);
  return normalized ? displayKeyword(normalized) : "";
}

function historyHintFromResolution(resolution: AttributionResolution | undefined): BackfillGroupHint | null {
  if (!resolution || resolution.action !== "attribute") return null;
  return {
    campaignId: resolution.campaignId,
    campaignName: resolution.campaignName,
    adId: resolution.adId,
    adName: resolution.adName,
  };
}

function historyStatusForResolution(
  resolution: AttributionResolution | undefined
): AttributionHistoryEvent["status"] | null {
  if (!resolution) return null;
  if (resolution.action === "organic") return "organic";
  if (resolution.action === "unattributed") return "unattributed";
  if (resolution.action === "ignore") return "ignored";
  return "attributed";
}

function historyEventHintForKeywordEvent(
  event: KeywordEvent,
  keyword: string,
  groupId: string,
  attributionRows: MetaRow[]
): BackfillGroupHint | null {
  if (event.override_campaign_name || event.override_ad_name) {
    return {
      campaignId: event.override_campaign_id || null,
      campaignName: event.override_campaign_name || null,
      adId: event.override_ad_id || null,
      adName: event.override_ad_name || null,
    };
  }

  return (
    hintForAttributionGroupId(groupId, attributionRows, keyword) ||
    exactMetaHintForKeywordEvent(event, attributionRows)
  );
}

function buildAttributionEventsHistory({
  query,
  events,
  salesRows,
  bookings,
  resolutionBySaleKey,
  attributionRows,
  periodAttributionGroupId,
}: {
  query: AdsTrackerQuery;
  events: KeywordEvent[];
  salesRows: SheetRow[];
  bookings: KeywordEvent[];
  resolutionBySaleKey: Map<string, AttributionResolution>;
  attributionRows: MetaRow[];
  periodAttributionGroupId: (
    row: KeywordEvent,
    keyword: string,
    fallbackId: string
  ) => string;
}): AttributionHistoryEvent[] {
  const history: AttributionHistoryEvent[] = [];

  for (const event of events.filter((item) => isWithinDashboardDateRange(item.event_at, query))) {
    const keyword = normalizeKeyword(event.keyword_normalized || event.keyword_raw);
    const fallbackId = keyword ? `${event.client_key}:keyword:${keyword}` : "";
    const groupId = keyword
      ? event.override_group_id || periodAttributionGroupId(event, keyword, fallbackId)
      : "";
    const hint = keyword
      ? historyEventHintForKeywordEvent(event, keyword, groupId, attributionRows)
      : null;
    const isManual = event.event_type.startsWith("manual_");
    const eventType: AttributionHistoryEvent["eventType"] = isManual
      ? event.event_type === "manual_missing_booking_attribution_override"
        ? "booked_call"
        : (event.event_type as AttributionHistoryEvent["eventType"])
      : event.source === "ghl"
        ? "booked_call"
        : "dm";
    const status: AttributionHistoryEvent["status"] = !keyword
      ? "missing_keyword"
      : !event.override_group_id && isFallbackAttributionGroupId(groupId)
        ? "needs_review"
        : "attributed";

    history.push({
      id: [
        event.source,
        event.event_type,
        event.appointment_id || event.subscriber_id || event.contact_id || "",
        event.event_at,
        keyword || "",
      ].join(":"),
      source: isManual ? "manual" : event.source,
      eventType,
      status,
      clientKey: event.client_key,
      keyword: historyKeyword(keyword || event.keyword_raw),
      campaignName: hint?.campaignName || event.override_campaign_name || null,
      adName: hint?.adName || event.override_ad_name || null,
      value: event.value_cents || null,
      name: event.contact_name || event.subscriber_name || "",
      setter: event.setter_name || "",
      reason:
        status === "missing_keyword"
          ? "Booked call missing keyword"
          : status === "needs_review"
            ? "No unique Meta ad match"
            : null,
      eventAt: event.event_at,
      saleKey: event.attribution_resolution_id || null,
      alertType: event.event_type === "missing_booking_keyword" ? "missing_booking_keyword" : null,
      appointmentId: event.appointment_id,
      contactId: event.contact_id,
    });
  }

  const bookingsByName = bookingsByContactName(bookings);

  for (const row of salesRows) {
    if (isTestSalesRow(row)) continue;
    const clientKey = clientFromOffer(row);
    const saleKey = salesRowKey(row, clientKey);
    const resolution = resolutionBySaleKey.get(saleKey);
    const match = matchedBookingForSalesRow(row, bookingsByName);
    const keyword = normalizeKeyword(
      resolution?.keywordNormalized ||
        resolution?.keywordRaw ||
        match?.keyword_normalized ||
        match?.keyword_raw
    );
    const fallbackId = match && keyword ? `${match.client_key}:keyword:${keyword}` : "";
    const groupId = match && keyword
      ? match.override_group_id || periodAttributionGroupId(match, keyword, fallbackId)
      : resolution?.groupId || "";
    const hint =
      historyHintFromResolution(resolution) ||
      (match && keyword
        ? historyEventHintForKeywordEvent(match, keyword, groupId, attributionRows)
        : null);
    const resolutionStatus = historyStatusForResolution(resolution);
    const status: AttributionHistoryEvent["status"] =
      resolutionStatus ||
      (!row.name
        ? "needs_review"
        : !match
          ? "needs_review"
          : !keyword
            ? "missing_keyword"
            : isFallbackAttributionGroupId(groupId)
              ? "needs_review"
              : "attributed");
    const reason =
      resolutionStatus === "organic"
        ? "Resolved organic"
        : resolutionStatus === "unattributed"
          ? "Marked unattributed"
        : resolutionStatus === "ignored"
          ? "Ignored"
          : !row.name
            ? "Missing Sales Tracker name"
            : !match
              ? "No matching GHL booking"
              : !keyword
                ? "Booked call missing keyword"
                : isFallbackAttributionGroupId(groupId)
                  ? "No unique Meta ad match"
                  : null;
    const base = {
      source: "sales_tracker" as const,
      status,
      clientKey,
      keyword: historyKeyword(keyword),
      campaignName: hint?.campaignName || resolution?.campaignName || null,
      adName: hint?.adName || resolution?.adName || null,
      name: row.name || resolution?.contactName || "",
      setter: row.setter || "",
      reason,
      eventAt: historyEventAtForSalesRow(row),
      saleKey,
      alertType: isRevenueEvent(row) ? ("sale" as const) : ("call" as const),
    };

    if (row.callTakenStatus !== "pending" || row.callTaken || isNoShow(row)) {
      history.push({
        ...base,
        id: `${saleKey}:call`,
        eventType: row.callTaken && !isNoShow(row) ? "call_taken" : "no_show",
        value: null,
      });
    }

    if (saleAmount(row) > 0 || row.revenue > 0 || isWin(row)) {
      history.push({
        ...base,
        id: `${saleKey}:sale`,
        eventType: "sale",
        value: Math.round(saleAmount(row) * 100),
      });
    }
  }

  return history
    .sort((a, b) => b.eventAt.localeCompare(a.eventAt))
    .slice(0, 200);
}

function applyOverrideMetadata(group: Group, match: KeywordEvent) {
  group.campaignId = match.override_campaign_id || group.campaignId;
  group.campaignName = match.override_campaign_name || group.campaignName;
  group.adId = match.override_ad_id || group.adId;
  group.adName = match.override_ad_name || group.adName;
  if (match.override_group_name) group.name = match.override_group_name;
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
  const attributionDateFrom = shiftDate(query.dateFrom, -120);
  const alertClientFilter = ["tyson", "keith"];
  const alertDateFrom = attributionAlertsStartDate();
  const alertDateTo = todayEt();
  const alertAttributionDateFrom = shiftDate(alertDateFrom, -120);
  const alertEventQueryFrom = `${alertAttributionDateFrom}T00:00:00.000Z`;
  const alertEventQueryTo = `${shiftDate(alertDateTo, 1)}T23:59:59.999Z`;
  const alertDashboardEventQueryFrom = `${alertDateFrom}T00:00:00.000Z`;
  const alertQuery: AdsTrackerQuery = {
    account: "all",
    status: "all",
    level: "ad",
    dateFrom: alertDateFrom,
    dateTo: alertDateTo,
  };

  const [
    metaRows,
    attributionMetaRows,
    keywordEvents,
    ghlAppointments,
    { data: metaSyncRuns, error: syncRunError },
    backfillRows,
    attributionResolutions,
    salesRows,
    alertMetaRows,
    alertKeywordEvents,
    alertGhlAppointments,
    alertBackfillRows,
    alertMissingManychatKeywordEvents,
    alertSalesRows,
  ] = await Promise.all([
      fetchMetaRows(db, query, clientFilter),
      fetchMetaRowsForDateRange(db, clientFilter, attributionDateFrom, query.dateTo),
      fetchKeywordEvents(db, clientFilter, eventQueryFrom, eventQueryTo),
      fetchGhlAppointments(db, eventQueryFrom, eventQueryTo),
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
      fetchAttributionResolutions(db),
      fetchFreshSalesRows(db, query, clientFilter),
      fetchMetaRowsForDateRange(db, alertClientFilter, alertAttributionDateFrom, alertDateTo),
      fetchKeywordEvents(db, alertClientFilter, alertEventQueryFrom, alertEventQueryTo),
      fetchGhlAppointments(db, alertEventQueryFrom, alertEventQueryTo),
      fetchKeywordBackfillRows(db, alertQuery, alertClientFilter),
      fetchManychatMissingKeywordEvents(
        db,
        alertClientFilter,
        alertDashboardEventQueryFrom,
        alertEventQueryTo
      ),
      fetchFreshSalesRows(db, alertQuery, alertClientFilter),
    ]);

  if (syncRunError) throw new Error(`Ads Tracker sync-run query failed: ${syncRunError.message}`);

  const groups = new Map<string, Group>();
  const rows = metaRows;
  const attributionRows = attributionMetaRows.length ? attributionMetaRows : rows;
  const backfill = backfillRows as KeywordBackfillRow[];
  const baseKeywordEvents = normalizeGhlKeywordEventDates(keywordEvents, ghlAppointments);
  const supplementalGhlEvents = await buildSupplementalGhlKeywordEvents(
    db,
    ghlAppointments,
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
    attributionRows,
    periodMetaGroupId,
    (row, keyword) => `${row.client_key}:${keyword}`,
    (row, keyword) => `${row.client_key}:${keyword}`
  );
  const dailyAttributionIdentity = uniqueMetaGroupResolver<KeywordEvent | KeywordBackfillRow>(
    attributionRows,
    periodMetaGroupId,
    (row, keyword) => `${row.client_key}:${keyword}`,
    (row, keyword) => `${row.client_key}:${keyword}`
  );
  const dailyAttributionGroupId = (
    row: KeywordEvent | KeywordBackfillRow,
    keyword: string,
    fallbackId: string
  ) => {
    const date = "event_at" in row ? eventDateKey(row.event_at) : row.date;
    const fallbackIdentity = fallbackId.startsWith(`${date}:`)
      ? fallbackId.slice(date.length + 1)
      : fallbackId;
    const identity = dailyAttributionIdentity(row, keyword, fallbackIdentity);
    return `${date}:${identity}`;
  };

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
    () => `${query.dateFrom} - ${query.dateTo}`,
    (event, keyword, groupId) =>
      hintForAttributionGroupId(groupId, attributionRows, keyword) ||
      exactMetaHintForKeywordEvent(event, attributionRows)
  );
  addKeywordBackfillRowsToGroups(
    groups,
    backfill,
    query,
    (row, keyword) =>
      fallbackGroupIdForBackfillRow(row, keyword, rows, "", query.level),
    () => `${query.dateFrom} - ${query.dateTo}`,
    (row) => campaignHintForBackfillRow(row, rows)
  );

  const attributionSalesRows = salesRows.filter((row) => !isTestSalesRow(row));
  const attributionGhlBookings = attributionEvents.filter((event) => event.source === "ghl");
  const alertBackfill = alertBackfillRows as KeywordBackfillRow[];
  const alertBackfilledDateKeys = new Set(
    alertBackfill.map((row) => `${row.client_key}:${row.date}`)
  );
  const alertBaseKeywordEvents = normalizeGhlKeywordEventDates(
    alertKeywordEvents,
    alertGhlAppointments
  );
  const alertSupplementalGhlEvents = await buildSupplementalGhlKeywordEvents(
    db,
    alertGhlAppointments,
    alertBaseKeywordEvents,
    alertClientFilter
  );
  const alertAttributionEvents = [
    ...alertBaseKeywordEvents,
    ...alertSupplementalGhlEvents,
  ]
    .filter((event) => !isTestKeywordEvent(event))
    .filter((event) => alertClientFilter.includes(event.client_key));
  const alertAttributionRows = alertMetaRows.length ? alertMetaRows : attributionRows;
  const alertPeriodAdAttributionGroupId = uniqueMetaGroupResolver<KeywordEvent>(
    alertAttributionRows,
    adGroupId,
    (row, keyword) => `${row.client_key}:${keyword}`,
    (row, keyword) => `${row.client_key}:${keyword}`
  );
  const alertAttributionSalesRows = alertSalesRows.filter((row) => !isTestSalesRow(row));
  const alertGhlBookings = alertAttributionEvents.filter((event) => event.source === "ghl");
  const automaticAttributionResolutions = await persistAutomaticSalesAttributions({
    db,
    salesRows: alertAttributionSalesRows,
    bookings: alertGhlBookings,
    clientFilter: alertClientFilter,
    existingResolutionBySaleKey: latestResolutionsBySaleKey(attributionResolutions),
    backfilledDateKeys: alertBackfilledDateKeys,
    attributionRows: alertAttributionRows,
    adAttributionGroupId: alertPeriodAdAttributionGroupId,
  });
  const allAttributionResolutions = [
    ...attributionResolutions,
    ...automaticAttributionResolutions,
  ];
  const resolutionBySaleKey = latestResolutionsBySaleKey(allAttributionResolutions);
  const manualStandaloneResolutionEvents = allAttributionResolutions
    .map(attributionOverrideEventForStandaloneResolution)
    .filter((event): event is KeywordEvent => Boolean(event))
    .filter(
      (event) =>
        clientFilter.includes(event.client_key) &&
        isWithinDashboardDateRange(event.event_at, query)
    );
  const alertManualStandaloneResolutionEvents = allAttributionResolutions
    .map(attributionOverrideEventForStandaloneResolution)
    .filter((event): event is KeywordEvent => Boolean(event))
    .filter(
      (event) =>
        alertClientFilter.includes(event.client_key) &&
        isWithinDashboardDateRange(event.event_at, alertQuery)
    );
  const missingManychatKeywordAlerts = buildMissingManychatKeywordAlerts(
    alertMissingManychatKeywordEvents,
    resolutionBySaleKey
  );
  const dashboardMissingGhlBookingKeywordEvents = buildMissingGhlBookingKeywordEvents(
    ghlAppointments,
    clientFilter,
    resolutionBySaleKey
  );
  const alertMissingGhlBookingKeywordEvents = buildMissingGhlBookingKeywordEvents(
    alertGhlAppointments,
    alertClientFilter,
    resolutionBySaleKey
  );
  const missingGhlBookingKeywordAlerts = buildMissingGhlBookingKeywordAlerts(
    alertMissingGhlBookingKeywordEvents,
    resolutionBySaleKey,
    alertAttributionSalesRows
  );
  const realGhlBookingsByName = bookingsByContactName([
    ...attributionGhlBookings,
    ...dashboardMissingGhlBookingKeywordEvents,
  ]);
  const manualAttributionBookings = attributionSalesRows
    .map((row) => {
      const clientKey = clientFromOffer(row);
      if (!clientKey || !clientFilter.includes(clientKey)) return null;
      if (backfilledDateKeys.has(`${clientKey}:${row.date}`)) return null;
      const matchedGhlBooking = matchedBookingForSalesRow(row, realGhlBookingsByName);
      const hasRealGhlBooking = Boolean(
        matchedGhlBooking &&
        normalizeKeyword(matchedGhlBooking.keyword_normalized || matchedGhlBooking.keyword_raw)
      );
      return attributionOverrideEventForRow(
        row,
        resolutionBySaleKey.get(salesRowKey(row, clientKey)),
        clientKey,
        hasRealGhlBooking
      );
    })
    .filter((event): event is KeywordEvent => Boolean(event))
    .concat(manualStandaloneResolutionEvents);
  const bookings = [
    ...manualAttributionBookings,
    ...attributionGhlBookings,
    ...dashboardMissingGhlBookingKeywordEvents,
  ];
  addKeywordEventsToGroups(
    groups,
    manualAttributionBookings,
    (event, keyword) =>
      resolvedAttributionGroupId(
        event,
        keyword,
        query.level,
        periodAttributionGroupId(event, keyword, `${event.client_key}:keyword:${keyword}`)
      ),
    () => `${query.dateFrom} - ${query.dateTo}`,
    (event, keyword, groupId) =>
      hintForAttributionGroupId(groupId, attributionRows, keyword) ||
      exactMetaHintForKeywordEvent(event, attributionRows)
  );
  const resolvedAlerts = attributionSalesRows
    .map((row) => {
      const clientKey = clientFromOffer(row);
      const resolution = resolutionBySaleKey.get(salesRowKey(row, clientKey));
      return resolution ? resolvedAlertForRow(row, clientKey, resolution) : null;
    })
    .filter((alert): alert is ResolvedAttributionAlert => Boolean(alert))
    .filter((alert) => !alert.clientKey || clientFilter.includes(alert.clientKey))
    .sort((a, b) => (b.resolvedAt || "").localeCompare(a.resolvedAt || ""));

  const includeSalesOutcomeMetrics = (match: KeywordEvent, row: SheetRow) =>
    !backfilledDateKeys.has(`${match.client_key}:${row.date}`);
  const includeCallTakenMetrics = () => true;
  const includeUnmatchedSales = (row: SheetRow, clientKey: string | null) =>
    Boolean(clientKey && clientFilter.includes(clientKey)) &&
    !backfilledDateKeys.has(`${clientKey}:${row.date}`) &&
    !resolutionBySaleKey.has(salesRowKey(row, clientKey));

  const unmatchedSales = applySalesToGroups(groups, attributionSalesRows, bookings, {
    groupId: (match) =>
      resolvedAttributionGroupId(
        match,
        match.keyword_normalized || "",
        query.level,
        periodAttributionGroupId(
          match,
          match.keyword_normalized || "",
          `${match.client_key}:keyword:${match.keyword_normalized || ""}`
        )
      ),
    groupHint: (match) => {
      const keyword = match.keyword_normalized || "";
      const groupId = resolvedAttributionGroupId(
        match,
        keyword,
        query.level,
        periodAttributionGroupId(match, keyword, `${match.client_key}:keyword:${keyword}`)
      );
      return (
        hintForAttributionGroupId(groupId, attributionRows, keyword) ||
        exactMetaHintForKeywordEvent(match, attributionRows)
      );
    },
    includeOutcomeMetrics: includeSalesOutcomeMetrics,
    includeCallTakenMetrics,
    includeClientSplitMetrics: includeSalesOutcomeMetrics,
    includeUnmatchedSales,
  });
  const alertBookings = [
    ...alertManualStandaloneResolutionEvents,
    ...alertGhlBookings,
    ...alertMissingGhlBookingKeywordEvents,
  ];
  const includeUnmatchedAlertSales = (row: SheetRow, clientKey: string | null) =>
    Boolean(clientKey && alertClientFilter.includes(clientKey)) &&
    !alertBackfilledDateKeys.has(`${clientKey}:${row.date}`) &&
    !resolutionBySaleKey.has(salesRowKey(row, clientKey));
  const alertUnmatchedSales = applySalesToGroups(new Map<string, Group>(), alertAttributionSalesRows, alertBookings, {
    groupId: (match) =>
      resolvedAttributionGroupId(
        match,
        match.keyword_normalized || "",
        "ad",
        alertPeriodAdAttributionGroupId(
          match,
          match.keyword_normalized || "",
          `${match.client_key}:keyword:${match.keyword_normalized || ""}`
        )
      ),
    groupHint: (match) => {
      const keyword = match.keyword_normalized || "";
      const groupId = resolvedAttributionGroupId(
        match,
        keyword,
        "ad",
        alertPeriodAdAttributionGroupId(match, keyword, `${match.client_key}:keyword:${keyword}`)
      );
      return (
        hintForAttributionGroupId(groupId, alertAttributionRows, keyword) ||
        exactMetaHintForKeywordEvent(match, alertAttributionRows)
      );
    },
    includeOutcomeMetrics: () => false,
    includeCallTakenMetrics: () => false,
    includeClientSplitMetrics: () => false,
    includeUnmatchedSales: includeUnmatchedAlertSales,
  });
  const attributionAlerts = [
    ...alertUnmatchedSales,
    ...missingManychatKeywordAlerts,
    ...missingGhlBookingKeywordAlerts,
  ].sort((a, b) =>
    (b.eventAt || `${b.date}T12:00:00.000Z`).localeCompare(
      a.eventAt || `${a.date}T12:00:00.000Z`
    )
  );

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
    (event) => eventDateKey(event.event_at),
    (event, keyword, groupId) =>
      hintForAttributionGroupId(groupId, attributionRows, keyword) ||
      exactMetaHintForKeywordEvent(event, attributionRows)
  );
  addKeywordBackfillRowsToGroups(
    dailyGroups,
    backfill,
    query,
    (row, keyword) =>
      fallbackGroupIdForBackfillRow(row, keyword, rows, `${row.date}:`, query.level),
    (row) => row.date,
    (row) => campaignHintForBackfillRow(row, rows)
  );
  addKeywordEventsToGroups(
    dailyGroups,
    manualAttributionBookings,
    (event, keyword) =>
      dailyResolvedAttributionGroupId(
        event,
        keyword,
        query.level,
        eventDateKey(event.event_at),
        dailyAttributionGroupId(
          event,
          keyword,
          `${eventDateKey(event.event_at)}:${event.client_key}:keyword:${keyword}`
        )
      ),
    (event) => eventDateKey(event.event_at),
    (event, keyword, groupId) =>
      hintForAttributionGroupId(groupId, attributionRows, keyword) ||
      exactMetaHintForKeywordEvent(event, attributionRows)
  );
  applySalesToGroups(dailyGroups, attributionSalesRows, bookings, {
    groupId: (match, row) =>
      dailyResolvedAttributionGroupId(
        match,
        match.keyword_normalized || "",
        query.level,
        row.date,
        dailySalesGroupIdFromSaleDate(
          match,
          row,
          match.keyword_normalized || "",
          periodAttributionGroupId
        )
      ),
    dateLabel: (_match, row) => row.date,
    groupHint: (match, row) => {
      const keyword = match.keyword_normalized || "";
      const groupId = dailyResolvedAttributionGroupId(
        match,
        keyword,
        query.level,
        row.date,
        dailySalesGroupIdFromSaleDate(match, row, keyword, periodAttributionGroupId)
      );
      return (
        hintForAttributionGroupId(groupId, attributionRows, keyword) ||
        exactMetaHintForKeywordEvent(match, attributionRows)
      );
    },
    includeOutcomeMetrics: includeSalesOutcomeMetrics,
    includeCallTakenMetrics,
    includeClientSplitMetrics: includeSalesOutcomeMetrics,
    includeUnmatchedSales,
  });

  const eventsHistory = buildAttributionEventsHistory({
    query,
    events: [
      ...attributionEvents,
      ...dashboardMissingGhlBookingKeywordEvents,
      ...manualAttributionBookings.filter(
        (event) => event.event_type === "manual_missing_booking_attribution_override"
      ),
    ],
    salesRows: attributionSalesRows,
    bookings,
    resolutionBySaleKey,
    attributionRows,
    periodAttributionGroupId,
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
    .filter((row) => matchesStatusFilter(row, query.status))
    .sort((a, b) => b.collectedRoi - a.collectedRoi);

  const paidFinalized = finalized.filter((row) => !row.attributionOnly);

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
    .filter((row) => matchesStatusFilter(row, query.status))
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
  const unmatchedRevenue = sumAlertRevenue(attributionAlerts);
  const salesCollectedRevenue = attributionSalesRows.reduce(
    (sum, row) => sum + (row.cashCollected || 0),
    0
  );
  const allTimeBackfillPaidRevenue = alertBackfill.reduce(
    (sum, row) => sum + dollars(row.collected_revenue_cents || 0),
    0
  );
  const allTimeResolvedAlerts = alertAttributionSalesRows
    .map((row) => {
      const clientKey = clientFromOffer(row);
      const resolution = resolutionBySaleKey.get(salesRowKey(row, clientKey));
      return resolution ? resolvedAlertForRow(row, clientKey, resolution) : null;
    })
    .filter((alert): alert is ResolvedAttributionAlert => Boolean(alert));
  const allTimeResolvedPaidRevenue = alertAttributionSalesRows.reduce((sum, row) => {
    const clientKey = clientFromOffer(row);
    if (!clientKey || alertBackfilledDateKeys.has(`${clientKey}:${row.date}`)) return sum;
    const resolution = resolutionBySaleKey.get(salesRowKey(row, clientKey));
    return resolution?.action === "attribute" ? sum + saleAmount(row) : sum;
  }, 0);
  const allTimePaidAttributedRevenue = allTimeBackfillPaidRevenue + allTimeResolvedPaidRevenue;
  const allTimeOrganicRevenue = sumResolvedRevenue(allTimeResolvedAlerts, "organic");
  const allTimeIgnoredRevenue = sumResolvedRevenue(allTimeResolvedAlerts, "ignore");
  const allTimeUnattributedRevenue =
    sumAlertRevenue(attributionAlerts) + sumResolvedRevenue(allTimeResolvedAlerts, "unattributed");
  const attributionPickerOptions = attributionPickerOptionsFromMetaRows(alertAttributionRows);
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
      organicOrUnattributedCount: attributionAlerts.length,
      attributionAlertCount: attributionAlerts.length,
      unmatchedSalesRevenue: unmatchedRevenue,
      organicOrUnattributedRevenue: Math.max(
        0,
        salesCollectedRevenue - paidFinalized.reduce((sum, row) => sum + row.collectedRevenue, 0)
      ),
    },
  };

  return buildPayload(query, finalized, events, false, finalizedDaily, {
    unmatchedSales: attributionAlerts,
    financialUnmatchedSales: unmatchedSales,
    resolvedAlerts,
    financialResolvedAlerts: resolvedAlerts,
    salesCollectedRevenue,
    allTimePaidAttributedRevenue,
    allTimeUnattributedRevenue,
    allTimeOrganicRevenue,
    allTimeIgnoredRevenue,
    attributionKeywordOptions: attributionPickerOptions.keywordOptions,
    attributionCampaignOptions: attributionPickerOptions.campaignOptions,
    sourceStatus,
    eventsHistory,
  });
}
