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

export interface AdsTrackerRow {
  id: string;
  clientKey: string;
  name: string;
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

interface Group {
  id: string;
  clientKey: string;
  name: string;
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
}

function emptyGroup(id: string, clientKey: string, name: string, keyword: string): Group {
  return {
    id,
    clientKey,
    name,
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
    newClients: group.newClients,
    contractedRevenue: group.contractedRevenue,
    callClosingRate: safeDiv(group.newClients, group.callsTaken || group.bookedCalls) * 100,
    messagesConversionRate: safeDiv(group.bookedCalls, group.messages) * 100,
    collectedRevenue: group.collectedRevenue,
    costPerNewClient: group.newClients > 0 ? adSpend / group.newClients : null,
    contractedRoi: safeDiv(group.contractedRevenue, adSpend),
    collectedRoi: safeDiv(group.collectedRevenue, adSpend),
    status: "active",
  };
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

function applySalesToGroups(groups: Map<string, Group>, salesRows: SheetRow[], bookings: KeywordEvent[]) {
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

    const groupId = `${match.client_key}:${match.keyword_normalized}`;
    const group = groups.get(groupId);
    if (!group) continue;

    if (row.callTaken && !isNoShow(row)) group.callsTaken += 1;
    if (isWin(row)) group.newClients += 1;
    group.contractedRevenue += row.revenue || 0;
    group.collectedRevenue += row.cashCollected || 0;
  }
}

function mockPayload(query: AdsTrackerQuery) {
  const rows: AdsTrackerRow[] = [
    finalizeGroup({
      ...emptyGroup("tyson:fit", "tyson", "Tyson", "FIT"),
      dateLabel: `${query.dateFrom} - ${query.dateTo}`,
      adSpendCents: 239100,
      impressions: 336050,
      linkClicks: 7190,
      messages: 489,
      bookedCalls: 82,
      callsTaken: 70,
      newClients: 24,
      contractedRevenue: 52400,
      collectedRevenue: 47300,
    }),
    finalizeGroup({
      ...emptyGroup("keith:goal", "keith", "Keith", "GOAL"),
      dateLabel: `${query.dateFrom} - ${query.dateTo}`,
      adSpendCents: 213400,
      impressions: 282930,
      linkClicks: 5206,
      messages: 357,
      bookedCalls: 54,
      callsTaken: 43,
      newClients: 10,
      contractedRevenue: 31200,
      collectedRevenue: 26500,
    }),
  ];

  return buildPayload(query, rows, [], true);
}

function buildPayload(
  query: AdsTrackerQuery,
  rows: AdsTrackerRow[],
  events: KeywordEvent[],
  mock = false
) {
  const totalSpend = rows.reduce((sum, row) => sum + row.adSpend, 0);
  const totalCollected = rows.reduce((sum, row) => sum + row.collectedRevenue, 0);
  const totalContracted = rows.reduce((sum, row) => sum + row.contractedRevenue, 0);

  const adRoas = rows
    .map((row) => ({
      id: row.id,
      label: row.keyword,
      clientKey: row.clientKey,
      collectedRoi: row.collectedRoi,
      contractedRoi: row.contractedRoi,
      collectedRevenue: row.collectedRevenue,
    }))
    .sort((a, b) => b.collectedRoi - a.collectedRoi);

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
      newClients: rows.reduce((sum, row) => sum + row.newClients, 0),
    },
    rows,
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

export async function getAdsTrackerDashboard(query: AdsTrackerQuery) {
  const db = getServiceSupabase();

  const clientFilter =
    query.account === "all" ? ["tyson", "keith"] : [query.account];

  const [{ data: metaRows, error: metaError }, { data: keywordEvents, error: eventError }] =
    await Promise.all([
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
        .gte("event_at", `${query.dateFrom}T00:00:00.000Z`)
        .lte("event_at", `${query.dateTo}T23:59:59.999Z`),
    ]);

  if (metaError || eventError) {
    console.warn("[ads-tracker] Falling back to mock payload", metaError || eventError);
    return mockPayload(query);
  }

  const groups = new Map<string, Group>();
  const rows = (metaRows || []) as MetaRow[];
  const events = (keywordEvents || []) as KeywordEvent[];

  for (const row of rows) {
    const keyword = normalizeKeyword(row.keyword_normalized || row.keyword_raw) || keywordFromAdName(row.ad_name);
    if (!keyword) continue;
    const id = `${row.client_key}:${keyword}`;
    const name = query.level === "ad" ? row.ad_name || displayKeyword(keyword) : row.client_name || row.client_key;
    const group = groups.get(id) || emptyGroup(id, row.client_key, name, displayKeyword(keyword));
    group.adSpendCents += row.spend_cents || 0;
    group.impressions += row.impressions || 0;
    group.linkClicks += row.link_clicks || 0;
    group.dateLabel = `${query.dateFrom} - ${query.dateTo}`;
    groups.set(id, group);
  }

  for (const event of events) {
    const keyword = normalizeKeyword(event.keyword_normalized || event.keyword_raw);
    if (!keyword) continue;
    const id = `${event.client_key}:${keyword}`;
    const group = groups.get(id) || emptyGroup(id, event.client_key, event.client_key, displayKeyword(keyword));

    if (event.source === "manychat") group.messages += 1;
    if (event.source === "ghl") group.bookedCalls += 1;

    group.dateLabel = `${query.dateFrom} - ${query.dateTo}`;
    groups.set(id, group);
  }

  const bookings = events.filter((event) => event.source === "ghl");
  const salesRows = await fetchSheetData(query.dateFrom, query.dateTo).catch((error) => {
    console.warn("[ads-tracker] Sales sheet fetch failed", error);
    return [] as SheetRow[];
  });

  applySalesToGroups(groups, salesRows, bookings);

  const finalized = Array.from(groups.values())
    .map(finalizeGroup)
    .filter((row) => row.adSpend > 0 || row.messages > 0 || row.bookedCalls > 0)
    .sort((a, b) => b.collectedRoi - a.collectedRoi);

  if (finalized.length === 0) return mockPayload(query);
  return buildPayload(query, finalized, events);
}
