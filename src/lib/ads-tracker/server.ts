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
  subscriber_name: string | null;
  setter_name: string | null;
  appointment_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
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
  contractedRevenue: number;
  collectedRevenue: number;
  status: "active" | "finished";
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

  return (data as unknown as SalesTrackerDbRow[])
    .map(salesDbRowToSheetRow)
    .filter((row) => {
      const clientKey = clientFromOffer(row);
      return !clientKey || clientFilter.includes(clientKey);
    });
}

function applySalesToGroups(
  groups: Map<string, Group>,
  salesRows: SheetRow[],
  bookings: KeywordEvent[],
  options: SalesAttributionOptions = {}
) {
  const bookingsByName = new Map<string, KeywordEvent[]>();
  for (const booking of bookings) {
    const name = normalizePersonName(booking.contact_name);
    if (!name) continue;
    const list = bookingsByName.get(name) || [];
    list.push(booking);
    bookingsByName.set(name, list);
  }

  for (const row of salesRows) {
    const name = normalizePersonName(row.name);
    if (!name) continue;
    const matches = bookingsByName.get(name) || [];
    const clientKey = clientFromOffer(row);
    const match = matches.find((item) => !clientKey || item.client_key === clientKey) || matches[0];
    if (!match?.keyword_normalized) continue;

    const groupId =
      options.groupId?.(match, row) || `${match.client_key}:${match.keyword_normalized}`;
    const group =
      groups.get(groupId) ||
      emptyGroup(
        groupId,
        match.client_key,
        options.groupName?.(match, row) || match.client_key,
        displayKeyword(match.keyword_normalized)
      );
    group.dateLabel = options.dateLabel?.(match, row) || group.dateLabel;
    groups.set(groupId, group);

    const includeOutcomeMetrics = options.includeOutcomeMetrics?.(match, row) ?? true;
    if (includeOutcomeMetrics && row.callTaken && !isNoShow(row)) group.callsTaken += 1;
    if (includeOutcomeMetrics) {
      if (isWin(row)) group.newClients += 1;
      group.contractedRevenue += row.revenue || 0;
      group.collectedRevenue += row.cashCollected || 0;
    }
  }
}

function buildPayload(
  query: AdsTrackerQuery,
  rows: AdsTrackerRow[],
  events: KeywordEvent[],
  mock = false,
  dailyRows: AdsTrackerRow[] = []
) {
  const totalSpend = rows.reduce((sum, row) => sum + row.adSpend, 0);
  const totalCollected = rows.reduce((sum, row) => sum + row.collectedRevenue, 0);
  const totalContracted = rows.reduce((sum, row) => sum + row.contractedRevenue, 0);

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
      contractedRevenue: totalContracted,
      collectedRoi: safeDiv(totalCollected, totalSpend),
      contractedRoi: safeDiv(totalContracted, totalSpend),
      messages: rows.reduce((sum, row) => sum + row.messages, 0),
      bookedCalls: rows.reduce((sum, row) => sum + row.bookedCalls, 0),
      callsTaken: rows.reduce((sum, row) => sum + row.callsTaken, 0),
      newClients: rows.reduce((sum, row) => sum + row.newClients, 0),
      costPerNewClient: safeDiv(
        totalSpend,
        rows.reduce((sum, row) => sum + row.newClients, 0)
      ),
      costPerCallTaken: safeDiv(
        totalSpend,
        rows.reduce((sum, row) => sum + row.callsTaken, 0)
      ),
    },
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
    const name = query.level === "ad" ? row.ad_name || displayKeyword(keyword) : row.client_name || row.client_key;
    const group = groups.get(id) || emptyGroup(id, row.client_key, name, displayKeyword(keyword));
    group.campaignId = row.campaign_id || group.campaignId;
    group.campaignName = row.campaign_name || group.campaignName;
    group.adId = row.ad_id || group.adId;
    group.adName = row.ad_name || group.adName;
    applyGroupStatus(group, metaRowStatus(row));
    group.adSpendCents += row.spend_cents || 0;
    group.impressions += row.impressions || 0;
    group.linkClicks += row.link_clicks || 0;
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
    const group = groups.get(id) || emptyGroup(id, event.client_key, event.client_key, displayKeyword(keyword));

    if (event.source === "manychat") group.messages += 1;
    if (event.source === "ghl") group.bookedCalls += 1;

    group.dateLabel = dateLabelForEvent(event);
    groups.set(id, group);
  }
}

function addKeywordBackfillRowsToGroups(
  groups: Map<string, Group>,
  rows: KeywordBackfillRow[],
  query: AdsTrackerQuery,
  groupIdForRow: (row: KeywordBackfillRow, keyword: string) => string,
  dateLabelForRow: (row: KeywordBackfillRow) => string
) {
  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw);
    if (!keyword) continue;

    const id = groupIdForRow(row, keyword);
    const name = query.level === "ad" ? displayKeyword(keyword) : row.client_name || row.client_key;
    const group = groups.get(id) || emptyGroup(id, row.client_key, name, displayKeyword(keyword));

    group.messages += row.messages || 0;
    group.bookedCalls += row.booked_calls || 0;
    group.callsTaken += row.calls_taken || 0;
    group.newClients += row.new_clients || 0;
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

export async function getAdsTrackerDashboard(query: AdsTrackerQuery) {
  const db = getServiceSupabase();

  const clientFilter =
    query.account === "all" ? ["tyson", "keith"] : [query.account];
  const eventQueryFrom = `${shiftDate(query.dateFrom, -120)}T00:00:00.000Z`;
  const eventQueryTo = `${shiftDate(query.dateTo, 1)}T23:59:59.999Z`;

  const [
    { data: metaRows, error: metaError },
    { data: keywordEvents, error: eventError },
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
          "source,event_type,client_key,keyword_raw,keyword_normalized,subscriber_name,setter_name,appointment_id,contact_id,contact_name,event_at"
        )
        .in("client_key", clientFilter)
        .gte("event_at", eventQueryFrom)
        .lte("event_at", eventQueryTo),
      fetchKeywordBackfillRows(db, query, clientFilter),
    ]);

  if (metaError || eventError) {
    throw new Error(
      `Ads Tracker data query failed: ${(metaError || eventError)?.message || "unknown error"}`
    );
  }

  const groups = new Map<string, Group>();
  const rows = (metaRows || []) as MetaRow[];
  const backfill = backfillRows as KeywordBackfillRow[];
  const backfilledDateKeys = new Set(
    backfill.map((row) => `${row.client_key}:${row.date}`)
  );
  const attributionEvents = ((keywordEvents || []) as KeywordEvent[])
    .filter((event) => !isTestKeywordEvent(event))
    .filter((event) => clientFilter.includes(event.client_key));
  const allEvents = attributionEvents
    .filter((event) => isWithinDashboardDateRange(event.event_at, query));
  const events = allEvents.filter(
    (event) => !backfilledDateKeys.has(`${event.client_key}:${eventDateKey(event.event_at)}`)
  );
  const periodMetaGroupId = (row: MetaRow, keyword: string) =>
    `${row.client_key}:${row.campaign_id || row.campaign_name || "campaign"}:${row.ad_id || keyword}`;
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
      periodAttributionGroupId(row, keyword, `${row.client_key}:keyword:${keyword}`),
    () => `${query.dateFrom} - ${query.dateTo}`
  );

  const bookings = attributionEvents.filter((event) => event.source === "ghl");
  const salesRows =
    (await fetchSalesRowsFromSupabase(db, query, clientFilter)) ??
    (await fetchSheetData(query.dateFrom, query.dateTo).catch((error) => {
      console.warn("[ads-tracker] Sales sheet fetch failed", error);
      return [] as SheetRow[];
    }));
  const attributionSalesRows = salesRows.filter((row) => !isTestSalesRow(row));

  const includeSalesOutcomeMetrics = (match: KeywordEvent, row: SheetRow) =>
    !backfilledDateKeys.has(`${match.client_key}:${row.date}`);

  applySalesToGroups(groups, attributionSalesRows, bookings, {
    groupId: (match) =>
      periodAttributionGroupId(
        match,
        match.keyword_normalized || "",
        `${match.client_key}:keyword:${match.keyword_normalized}`
      ),
    includeOutcomeMetrics: includeSalesOutcomeMetrics,
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
      dailyAttributionGroupId(row, keyword, `${row.date}:${row.client_key}:keyword:${keyword}`),
    (row) => row.date
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
  });

  const finalized = Array.from(groups.values())
    .map(finalizeGroup)
    .filter(
      (row) =>
        row.adSpend > 0 ||
        row.messages > 0 ||
        row.bookedCalls > 0 ||
        row.callsTaken > 0 ||
        row.newClients > 0 ||
        row.collectedRevenue > 0
    )
    .sort((a, b) => b.collectedRoi - a.collectedRoi);

  const finalizedDaily = Array.from(dailyGroups.values())
    .map(finalizeGroup)
    .filter(
      (row) =>
        row.adSpend > 0 ||
        row.messages > 0 ||
        row.bookedCalls > 0 ||
        row.callsTaken > 0 ||
        row.newClients > 0 ||
        row.collectedRevenue > 0
    )
    .sort((a, b) => a.dateLabel.localeCompare(b.dateLabel));

  return buildPayload(query, finalized, events, false, finalizedDaily);
}
