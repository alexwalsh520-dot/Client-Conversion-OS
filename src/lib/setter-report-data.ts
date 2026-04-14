import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import {
  fetchSlackAppointmentBookings,
  type SlackAppointmentBooking,
} from "@/lib/slack-appointments";
import { getServiceSupabase } from "@/lib/supabase";

type ClientKey = "tyson_sonnek" | "keith_holland" | "zoe_and_emily";

interface SetterDef {
  key: string;
  name: string;
  clientKey: ClientKey;
  clientLabel: string;
  sheetKeys: string[];
}

interface TagEventRow {
  client: string;
  setter_name: string | null;
  subscriber_id: string;
  subscriber_name?: string | null;
  tag_name: string;
  event_at: string;
}

interface StageStateRow {
  client: string;
  setter_name: string | null;
  subscriber_id: string;
  conversation_id: string;
  goal_clear: boolean | null;
  gap_clear: boolean | null;
  stakes_clear: boolean | null;
  qualified: boolean | null;
  booking_readiness_score: number | null;
  stage_evidence: Record<string, string> | null;
  latest_message_at: string | null;
  updated_at: string | null;
}

interface MessageRow {
  client: string;
  setter_name: string | null;
  subscriber_id: string;
  conversation_id: string;
  direction: string | null;
  body: string | null;
  sent_at: string | null;
}

interface LeadCohortRow {
  subscriberId: string;
  leadName: string | null;
  newLeadAt: string;
  setterName: string | null;
}

interface AppointmentRow {
  appointment_id: string;
  contact_id: string | null;
  created_at: string | null;
}

interface MatchedSlackBooking {
  bookedEtDate: string;
  clientKey: ClientKey | null;
  setterKey: string | null;
}

interface ResponseGap {
  leadName: string | null;
  subscriberId: string;
  conversationId: string;
  activeMinutes: number;
  prospectAt: string;
  setterAt: string;
}

export interface SetterTranscript {
  conversationId: string;
  leadName: string | null;
  latestMessageAt: string | null;
  messageCount: number;
  transcript: string;
}

export interface SetterResponseStats {
  averageMinutes: number | null;
  sampleCount: number;
  worstGaps: ResponseGap[];
}

export interface SetterSalesStats {
  booked: number;
  showEligible: number;
  taken: number;
  wins: number;
  noShows: number;
  cashCollected: number;
  revenue: number;
  aov: number;
  bookingRate: number;
  showRate: number;
  closeRate: number;
}

export interface SetterFunnelCounts {
  newLeads: number;
  engaged: number;
  goalClear: number;
  gapClear: number;
  stakesClear: number;
  qualified: number;
  linkSent: number;
  subLinkSent: number;
}

export interface SetterPeriodMetrics extends SetterFunnelCounts, SetterSalesStats {
  averageResponseMinutes: number | null;
  responseSampleCount: number;
  worstResponseGaps: ResponseGap[];
}

export interface SetterReportRow {
  setterKey: string;
  setterName: string;
  clientKey: ClientKey;
  clientLabel: string;
  trackingStartDate: string | null;
  daily: SetterPeriodMetrics;
  wtd: SetterPeriodMetrics;
  mtd: SetterPeriodMetrics;
  transcripts: SetterTranscript[];
}

export interface SetterSummaryMetrics {
  newLeads: number;
  booked: number;
  showRate: number;
  closeRate: number;
  aov: number;
  averageResponseMinutes: number | null;
}

export interface SetterReportData {
  reportDate: string;
  weekStart: string;
  monthStart: string;
  transcriptSource: "dm_conversation_messages";
  legacyTranscriptSource: "dm_transcripts";
  setters: SetterReportRow[];
  dataQuality: {
    recentLiveMessages: number;
    recentStageStates: number;
    recentLegacyUploads: number;
    missingSetterMessages: number;
  };
}

const SETTERS: SetterDef[] = [
  {
    key: "amara",
    name: "Amara",
    clientKey: "tyson_sonnek",
    clientLabel: "Tyson Sonnek",
    sheetKeys: ["AMARA"],
  },
  {
    key: "gideon",
    name: "Gideon",
    clientKey: "keith_holland",
    clientLabel: "Keith Holland",
    sheetKeys: ["GIDEON"],
  },
  {
    key: "kelechi",
    name: "Kelechi",
    clientKey: "zoe_and_emily",
    clientLabel: "Zoe and Emily",
    sheetKeys: ["KELECHI", "KELCHI"],
  },
  {
    key: "debbie",
    name: "Debbie",
    clientKey: "zoe_and_emily",
    clientLabel: "Zoe and Emily",
    sheetKeys: ["DEBBIE"],
  },
];

const ET_TIMEZONE = "America/New_York";
const ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: ET_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function startOfUtcDay(date: string) {
  return `${date}T00:00:00Z`;
}

function endOfUtcDay(date: string) {
  return `${date}T23:59:59.999Z`;
}

function parseDateOnly(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function formatDateOnly(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: string, days: number) {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatDateOnly(value);
}

function monthStartOf(date: string) {
  return `${date.slice(0, 8)}01`;
}

function weekStartOf(date: string) {
  const value = parseDateOnly(date);
  const day = value.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  value.setUTCDate(value.getUTCDate() - offset);
  return formatDateOnly(value);
}

function normalizeSetterName(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
}

function normalizeName(value: string | null | undefined) {
  return (value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesLikelyMatch(a: string | null | undefined, b: string | null | undefined) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function clientKeyFromOffer(offer: string | null | undefined): ClientKey | null {
  const normalized = (offer || "").toLowerCase();
  if (normalized.includes("tyson")) return "tyson_sonnek";
  if (normalized.includes("keith")) return "keith_holland";
  if (normalized.includes("zoe") || normalized.includes("emily")) return "zoe_and_emily";
  return null;
}

function setterKeyFromSheetRow(setterName: string | null | undefined) {
  const normalized = normalizeSetterName(setterName);
  return SETTERS.find((setter) => setter.name.toLowerCase() === normalized)?.key || null;
}

function getEtParts(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const parts = ET_PARTS.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      map[part.type] = part.value;
    }
  }

  const dateStr = `${map.year}-${map.month}-${map.day}`;
  const hour = Number(map.hour || "0");
  const minute = Number(map.minute || "0");
  const second = Number(map.second || "0");

  return {
    dateStr,
    hour,
    minute,
    second,
    minutesOfDay: hour * 60 + minute + second / 60,
  };
}

function toEtDateStr(value: string | Date) {
  return getEtParts(value).dateStr;
}

function formatEtDateTime(value: string | null) {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString("en-US", {
    timeZone: ET_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMinutesAsClock(minutes: number) {
  if (minutes >= 60) {
    const hours = minutes / 60;
    return `${hours.toFixed(hours >= 10 ? 1 : 2)} hr`;
  }
  return `${minutes.toFixed(minutes >= 10 ? 1 : 2)} min`;
}

function parseSlackAppointmentDate(appointmentTime: string | null | undefined) {
  if (!appointmentTime) return null;
  const match = appointmentTime.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!match) return null;
  const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]} 12:00:00 UTC`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return formatDateOnly(parsed);
}

function computeTrackedWindowMinutes(startIso: string, endIso: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return 0;
  if (end.getTime() <= start.getTime()) return 0;

  const startEt = getEtParts(start);
  const endEt = getEtParts(end);
  let cursor = startEt.dateStr;
  let total = 0;

  while (cursor <= endEt.dateStr) {
    const startMinute = cursor === startEt.dateStr ? startEt.minutesOfDay : 0;
    const endMinute = cursor === endEt.dateStr ? endEt.minutesOfDay : 24 * 60;
    const overlap = Math.max(0, Math.min(endMinute, 24 * 60) - Math.max(startMinute, 12 * 60));
    total += overlap;
    cursor = addDays(cursor, 1);
  }

  return total;
}

function buildTranscript(messages: MessageRow[]) {
  return messages
    .filter((message) => (message.body || "").trim())
    .slice(-30)
    .map((message) => {
      const speaker =
        message.direction === "inbound"
          ? "Prospect"
          : message.direction === "outbound"
            ? "Setter"
            : "Unknown";
      const stamp = message.sent_at ? ` (${formatEtDateTime(message.sent_at)})` : "";
      return `${speaker}${stamp}: ${(message.body || "").trim()}`;
    })
    .join("\n");
}

function filterRowsByDate<T>(
  rows: T[],
  getIso: (row: T) => string | null | undefined,
  dateFrom: string,
  dateTo: string,
) {
  return rows.filter((row) => {
    const iso = getIso(row);
    if (!iso) return false;
    const etDate = toEtDateStr(iso);
    return etDate >= dateFrom && etDate <= dateTo;
  });
}

function computeResponseStats(
  messages: MessageRow[],
  leadNamesBySubscriber: Map<string, string>,
): SetterResponseStats {
  const grouped = new Map<string, MessageRow[]>();

  for (const message of messages) {
    if (!message.conversation_id || !message.sent_at) continue;
    const list = grouped.get(message.conversation_id) || [];
    list.push(message);
    grouped.set(message.conversation_id, list);
  }

  const samples: ResponseGap[] = [];

  for (const [conversationId, convoMessages] of grouped.entries()) {
    const ordered = [...convoMessages].sort((a, b) =>
      (a.sent_at || "").localeCompare(b.sent_at || ""),
    );
    let pendingInbound: MessageRow | null = null;

    for (const message of ordered) {
      if (!message.sent_at) continue;

      if (message.direction === "inbound") {
        if (!pendingInbound) {
          pendingInbound = message;
        }
        continue;
      }

      if (message.direction === "outbound" && pendingInbound?.sent_at) {
        const activeMinutes = computeTrackedWindowMinutes(
          pendingInbound.sent_at,
          message.sent_at,
        );

        if (Number.isFinite(activeMinutes) && activeMinutes > 0) {
          samples.push({
            leadName: leadNamesBySubscriber.get(pendingInbound.subscriber_id) || null,
            subscriberId: pendingInbound.subscriber_id,
            conversationId,
            activeMinutes,
            prospectAt: pendingInbound.sent_at,
            setterAt: message.sent_at,
          });
        }

        pendingInbound = null;
      }
    }
  }

  const averageMinutes =
    samples.length > 0
      ? samples.reduce((sum, sample) => sum + sample.activeMinutes, 0) / samples.length
      : null;

  return {
    averageMinutes,
    sampleCount: samples.length,
    worstGaps: [...samples]
      .sort((a, b) => b.activeMinutes - a.activeMinutes)
      .slice(0, 5),
  };
}

function filterSheetRowsForSetter(
  rows: SheetRow[],
  setter: SetterDef,
  dateFrom: string,
  dateTo: string,
  trackingStartDate: string | null,
) {
  const effectiveStart = trackingStartDate && trackingStartDate > dateFrom ? trackingStartDate : dateFrom;

  return rows.filter((row) => {
    const setterMatch = setter.sheetKeys.some((key) =>
      (row.setter || "").toUpperCase().includes(key),
    );
    if (!setterMatch) return false;

    const offerLower = (row.offer || "").toLowerCase();
    const clientMatch =
      setter.clientKey === "tyson_sonnek"
        ? offerLower.includes("tyson")
        : setter.clientKey === "keith_holland"
          ? offerLower.includes("keith")
          : offerLower.includes("zoe") || offerLower.includes("emily");

    if (!clientMatch) return false;
    return row.date >= effectiveStart && row.date <= dateTo;
  });
}

function computeSalesStats(rows: SheetRow[], newLeads: number): SetterSalesStats {
  const booked = rows.length;
  const showEligible = rows.filter((row) => row.callTakenStatus !== "pending").length;
  const taken = rows.filter((row) => row.callTakenStatus === "yes").length;
  const wins = rows.filter((row) => row.outcome === "WIN").length;
  const noShows = rows.filter((row) => row.callTakenStatus === "no").length;
  const cashCollected = rows.reduce((sum, row) => sum + (row.cashCollected || 0), 0);
  const revenue = rows.reduce((sum, row) => sum + (row.revenue || 0), 0);

  return {
    booked,
    showEligible,
    taken,
    wins,
    noShows,
    cashCollected,
    revenue,
    aov: wins > 0 ? cashCollected / wins : 0,
    bookingRate: newLeads > 0 ? (booked / newLeads) * 100 : 0,
    showRate: showEligible > 0 ? (taken / showEligible) * 100 : 0,
    closeRate: taken > 0 ? (wins / taken) * 100 : 0,
  };
}

function countFunnelForSetter(params: {
  setter: SetterDef;
  tagEvents: TagEventRow[];
  stageStates: StageStateRow[];
  dateFrom: string;
  dateTo: string;
}): SetterFunnelCounts & {
  trackingStartDate: string | null;
  leadNamesBySubscriber: Map<string, string>;
  leadIds: Set<string>;
} {
  const { setter, tagEvents, stageStates, dateFrom, dateTo } = params;
  const setterKey = setter.key;

  const newLeadEvents = tagEvents.filter(
    (event) =>
      event.client === setter.clientKey &&
      normalizeSetterName(event.setter_name) === setterKey &&
      event.tag_name === "new_lead" &&
      toEtDateStr(event.event_at) >= dateFrom &&
      toEtDateStr(event.event_at) <= dateTo,
  );

  const orderedNewLeadEvents = [...newLeadEvents].sort((a, b) => a.event_at.localeCompare(b.event_at));
  const trackingStartDate = orderedNewLeadEvents[0]?.event_at.slice(0, 10) || null;
  const leadIds = new Set(orderedNewLeadEvents.map((event) => event.subscriber_id));
  const leadNamesBySubscriber = new Map<string, string>();
  const engagedIds = new Set<string>();
  const callLinkIds = new Set<string>();
  const subLinkIds = new Set<string>();

  for (const event of orderedNewLeadEvents) {
    const leadName = event.subscriber_name?.trim();
    if (leadName) {
      leadNamesBySubscriber.set(event.subscriber_id, leadName);
    }
  }

  for (const event of tagEvents) {
    if (
      event.client !== setter.clientKey ||
      normalizeSetterName(event.setter_name) !== setterKey ||
      !leadIds.has(event.subscriber_id) ||
      toEtDateStr(event.event_at) > dateTo
    ) {
      continue;
    }

    const leadName = event.subscriber_name?.trim();
    if (leadName && !leadNamesBySubscriber.has(event.subscriber_id)) {
      leadNamesBySubscriber.set(event.subscriber_id, leadName);
    }

    if (event.tag_name === "lead_engaged") engagedIds.add(event.subscriber_id);
    if (event.tag_name === "call_link_sent") callLinkIds.add(event.subscriber_id);
    if (event.tag_name === "sub_link_sent") subLinkIds.add(event.subscriber_id);
  }

  const stageBySubscriber = new Map<string, StageStateRow>();
  for (const row of stageStates) {
    const stageAt = row.updated_at || row.latest_message_at;
    if (
      !stageAt ||
      row.client !== setter.clientKey ||
      normalizeSetterName(row.setter_name) !== setterKey ||
      !leadIds.has(row.subscriber_id) ||
      toEtDateStr(stageAt) > dateTo
    ) {
      continue;
    }

    const existing = stageBySubscriber.get(row.subscriber_id);
    stageBySubscriber.set(row.subscriber_id, {
      ...row,
      goal_clear: Boolean(existing?.goal_clear || row.goal_clear),
      gap_clear: Boolean(existing?.gap_clear || row.gap_clear),
      stakes_clear: Boolean(existing?.stakes_clear || row.stakes_clear),
      qualified: Boolean(existing?.qualified || row.qualified),
    });
  }

  let goalClear = 0;
  let gapClear = 0;
  let stakesClear = 0;
  let qualified = 0;

  for (const subscriberId of leadIds) {
    const engaged = engagedIds.has(subscriberId) || callLinkIds.has(subscriberId) || subLinkIds.has(subscriberId);
    const state = stageBySubscriber.get(subscriberId);
    const goal = engaged && Boolean(state?.goal_clear || callLinkIds.has(subscriberId));
    const gap = goal && Boolean(state?.gap_clear || callLinkIds.has(subscriberId));
    const stakes = gap && Boolean(state?.stakes_clear || callLinkIds.has(subscriberId));
    const qual = stakes && Boolean(state?.qualified || callLinkIds.has(subscriberId));

    if (goal) goalClear += 1;
    if (gap) gapClear += 1;
    if (stakes) stakesClear += 1;
    if (qual) qualified += 1;
  }

  return {
    newLeads: leadIds.size,
    engaged: engagedIds.size,
    goalClear,
    gapClear,
    stakesClear,
    qualified,
    linkSent: callLinkIds.size,
    subLinkSent: subLinkIds.size,
    trackingStartDate,
    leadNamesBySubscriber,
    leadIds,
  };
}

function countBookedAppointmentsForSetter(params: {
  setter: SetterDef;
  slackBookings: MatchedSlackBooking[];
  appointmentRows: AppointmentRow[];
  linksByContactId: Map<string, { client: string; subscriber_id: string }>;
  leadIds: Set<string>;
  dateFrom: string;
  dateTo: string;
  trackingStartDate: string | null;
}) {
  const {
    setter,
    slackBookings,
    appointmentRows,
    linksByContactId,
    leadIds,
    dateFrom,
    dateTo,
    trackingStartDate,
  } = params;
  const effectiveStart =
    trackingStartDate && trackingStartDate > dateFrom ? trackingStartDate : dateFrom;

  if (slackBookings.length > 0) {
    return slackBookings.filter((booking) => {
      if (booking.setterKey !== setter.key) return false;
      return booking.bookedEtDate >= effectiveStart && booking.bookedEtDate <= dateTo;
    }).length;
  }

  return appointmentRows.filter((row) => {
    if (!row.contact_id || !row.created_at) return false;
    const link = linksByContactId.get(row.contact_id);
    if (!link) return false;
    if (!leadIds.has(link.subscriber_id)) return false;

    const bookedDate = toEtDateStr(row.created_at);
    return bookedDate >= effectiveStart && bookedDate <= dateTo;
  }).length;
}

function matchSlackBookingsToSetters(
  bookings: SlackAppointmentBooking[],
  sheetRows: SheetRow[],
): MatchedSlackBooking[] {
  return bookings.map((booking) => {
    const clientKey = clientKeyFromOffer(booking.offer);
    const appointmentDate = parseSlackAppointmentDate(booking.appointmentTime);
    const bookedEtDate = toEtDateStr(booking.postedAt);

    const candidates = sheetRows.filter((row) => {
      if (!clientKeyFromOffer(row.offer) || clientKeyFromOffer(row.offer) !== clientKey) return false;
      if (appointmentDate && row.date !== appointmentDate) return false;
      return true;
    });

    const exactNameMatches = candidates.filter((row) => namesLikelyMatch(row.name, booking.prospectName));
    const bestMatch =
      exactNameMatches.length === 1
        ? exactNameMatches[0]
        : exactNameMatches[0] || (candidates.length === 1 ? candidates[0] : null);

    const matchedSetterKey = setterKeyFromSheetRow(bestMatch?.setter);

    if (matchedSetterKey) {
      return {
        bookedEtDate,
        clientKey,
        setterKey: matchedSetterKey,
      };
    }

    if (clientKey === "tyson_sonnek") {
      return { bookedEtDate, clientKey, setterKey: "amara" };
    }

    if (clientKey === "keith_holland") {
      return { bookedEtDate, clientKey, setterKey: "gideon" };
    }

    return {
      bookedEtDate,
      clientKey,
      setterKey: null,
    };
  });
}

function buildPeriodMetrics(params: {
  setter: SetterDef;
  dateFrom: string;
  dateTo: string;
  tagEvents: TagEventRow[];
  stageStates: StageStateRow[];
  messages: MessageRow[];
  sheetRows: SheetRow[];
  slackBookings: MatchedSlackBooking[];
  appointmentRows: AppointmentRow[];
  linksByContactId: Map<string, { client: string; subscriber_id: string }>;
}) {
  const {
    setter,
    dateFrom,
    dateTo,
    tagEvents,
    stageStates,
    messages,
    sheetRows,
    slackBookings,
    appointmentRows,
    linksByContactId,
  } = params;

  const funnel = countFunnelForSetter({
    setter,
    tagEvents,
    stageStates,
    dateFrom,
    dateTo,
  });

  const setterSheetRows = filterSheetRowsForSetter(
    sheetRows,
    setter,
    dateFrom,
    dateTo,
    funnel.trackingStartDate,
  );
  const sales = computeSalesStats(setterSheetRows, funnel.newLeads);
  const bookedAppointments = countBookedAppointmentsForSetter({
    setter,
    slackBookings,
    appointmentRows,
    linksByContactId,
    leadIds: funnel.leadIds,
    dateFrom,
    dateTo,
    trackingStartDate: funnel.trackingStartDate,
  });

  const effectiveMessageStart =
    funnel.trackingStartDate && funnel.trackingStartDate > dateFrom ? funnel.trackingStartDate : dateFrom;

  const setterMessages = filterRowsByDate(
    messages.filter(
      (message) =>
        message.client === setter.clientKey &&
        normalizeSetterName(message.setter_name) === setter.key,
    ),
    (message) => message.sent_at,
    effectiveMessageStart,
    dateTo,
  );

  const responseTime = computeResponseStats(setterMessages, funnel.leadNamesBySubscriber);

  return {
    metrics: {
      newLeads: funnel.newLeads,
      engaged: funnel.engaged,
      goalClear: funnel.goalClear,
      gapClear: funnel.gapClear,
      stakesClear: funnel.stakesClear,
      qualified: funnel.qualified,
      linkSent: funnel.linkSent,
      subLinkSent: funnel.subLinkSent,
      ...sales,
      booked: bookedAppointments,
      bookingRate: funnel.newLeads > 0 ? (bookedAppointments / funnel.newLeads) * 100 : 0,
      averageResponseMinutes: responseTime.averageMinutes,
      responseSampleCount: responseTime.sampleCount,
      worstResponseGaps: responseTime.worstGaps,
    } satisfies SetterPeriodMetrics,
    trackingStartDate: funnel.trackingStartDate,
    leadNamesBySubscriber: funnel.leadNamesBySubscriber,
  };
}

export async function getSetterReportData(reportDate: string): Promise<SetterReportData> {
  const sb = getServiceSupabase();
  const weekStart = weekStartOf(reportDate);
  const monthStart = monthStartOf(reportDate);
  const transcriptStart = addDays(reportDate, -6);
  const queryEndDate = addDays(reportDate, 1);
  const sheetMatchEndDate = addDays(reportDate, 45);

  const [
    tagEventsRes,
    stageStatesRes,
    mtdMessagesRes,
    recentMessagesRes,
    legacyUploadsRes,
    appointmentRowsRes,
    contactLinksRes,
    slackBookings,
    mtdSheetRows,
  ] =
    await Promise.all([
      sb
        .from("manychat_tag_events")
        .select("client, setter_name, subscriber_id, subscriber_name, tag_name, event_at")
        .gte("event_at", startOfUtcDay(monthStart))
        .lte("event_at", endOfUtcDay(queryEndDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_conversation_stage_state")
        .select("client, setter_name, subscriber_id, conversation_id, goal_clear, gap_clear, stakes_clear, qualified, booking_readiness_score, stage_evidence, latest_message_at, updated_at")
        .gte("updated_at", startOfUtcDay(monthStart))
        .lte("updated_at", endOfUtcDay(queryEndDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_conversation_messages")
        .select("client, setter_name, subscriber_id, conversation_id, direction, body, sent_at")
        .gte("sent_at", startOfUtcDay(monthStart))
        .lte("sent_at", endOfUtcDay(queryEndDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_conversation_messages")
        .select("client, setter_name, subscriber_id, conversation_id, direction, body, sent_at")
        .gte("sent_at", startOfUtcDay(transcriptStart))
        .lte("sent_at", endOfUtcDay(queryEndDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_transcripts")
        .select("id", { count: "exact", head: true })
        .gte("submitted_at", startOfUtcDay(transcriptStart)),
      sb
        .from("ghl_appointments")
        .select("appointment_id, contact_id, created_at")
        .gte("created_at", startOfUtcDay(monthStart))
        .lte("created_at", endOfUtcDay(queryEndDate)),
      sb
        .from("manychat_contact_links")
        .select("client, subscriber_id, ghl_contact_id"),
      fetchSlackAppointmentBookings(monthStart, reportDate),
      fetchSheetData(monthStart, sheetMatchEndDate),
    ]);

  const results = [
    tagEventsRes,
    stageStatesRes,
    mtdMessagesRes,
    recentMessagesRes,
    legacyUploadsRes,
    appointmentRowsRes,
    contactLinksRes,
  ];
  for (const result of results) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const allTagEvents = filterRowsByDate(
    (tagEventsRes.data || []) as TagEventRow[],
    (row) => row.event_at,
    monthStart,
    reportDate,
  );
  const allStageStates = filterRowsByDate(
    (stageStatesRes.data || []) as StageStateRow[],
    (row) => row.updated_at,
    monthStart,
    reportDate,
  );
  const allMessages = filterRowsByDate(
    (mtdMessagesRes.data || []) as MessageRow[],
    (row) => row.sent_at,
    monthStart,
    reportDate,
  );
  const recentMessages = filterRowsByDate(
    (recentMessagesRes.data || []) as MessageRow[],
    (row) => row.sent_at,
    transcriptStart,
    reportDate,
  );
  const legacyUploads = legacyUploadsRes.count || 0;
  const appointmentRows = (appointmentRowsRes.data || []) as AppointmentRow[];
  const matchedSlackBookings = matchSlackBookingsToSetters(slackBookings, mtdSheetRows);
  const linksByContactId = new Map<string, { client: string; subscriber_id: string }>();
  for (const row of (contactLinksRes.data || []) as Array<{
    client: string;
    subscriber_id: string;
    ghl_contact_id: string;
  }>) {
    if (!row.ghl_contact_id) continue;
    linksByContactId.set(row.ghl_contact_id, {
      client: row.client,
      subscriber_id: row.subscriber_id,
    });
  }

  const setters = SETTERS.map((setter) => {
    const dailyPeriod = buildPeriodMetrics({
      setter,
      dateFrom: reportDate,
      dateTo: reportDate,
      tagEvents: allTagEvents,
      stageStates: allStageStates,
      messages: allMessages,
      sheetRows: mtdSheetRows,
      slackBookings: matchedSlackBookings,
      appointmentRows,
      linksByContactId,
    });

    const wtdPeriod = buildPeriodMetrics({
      setter,
      dateFrom: weekStart,
      dateTo: reportDate,
      tagEvents: allTagEvents,
      stageStates: allStageStates,
      messages: allMessages,
      sheetRows: mtdSheetRows,
      slackBookings: matchedSlackBookings,
      appointmentRows,
      linksByContactId,
    });

    const mtdPeriod = buildPeriodMetrics({
      setter,
      dateFrom: monthStart,
      dateTo: reportDate,
      tagEvents: allTagEvents,
      stageStates: allStageStates,
      messages: allMessages,
      sheetRows: mtdSheetRows,
      slackBookings: matchedSlackBookings,
      appointmentRows,
      linksByContactId,
    });

    const leadNamesBySubscriber = mtdPeriod.leadNamesBySubscriber;
    const recentSetterMessages = recentMessages.filter(
      (message) =>
        message.client === setter.clientKey &&
        normalizeSetterName(message.setter_name) === setter.key,
    );

    const recentConversations = new Map<string, MessageRow[]>();
    for (const message of recentSetterMessages) {
      const list = recentConversations.get(message.conversation_id) || [];
      list.push(message);
      recentConversations.set(message.conversation_id, list);
    }

    const transcripts = [...recentConversations.entries()]
      .map(([conversationId, messages]) => {
        const ordered = [...messages].sort((a, b) => (a.sent_at || "").localeCompare(b.sent_at || ""));
        const subscriberId = ordered.find((message) => message.subscriber_id)?.subscriber_id || "";
        return {
          conversationId,
          leadName: leadNamesBySubscriber.get(subscriberId) || null,
          latestMessageAt: ordered.at(-1)?.sent_at || null,
          messageCount: ordered.length,
          transcript: buildTranscript(ordered),
        };
      })
      .sort((a, b) => (b.latestMessageAt || "").localeCompare(a.latestMessageAt || ""))
      .slice(0, 5);

    return {
      setterKey: setter.key,
      setterName: setter.name,
      clientKey: setter.clientKey,
      clientLabel: setter.clientLabel,
      trackingStartDate: mtdPeriod.trackingStartDate,
      daily: dailyPeriod.metrics,
      wtd: wtdPeriod.metrics,
      mtd: mtdPeriod.metrics,
      transcripts,
    };
  });

  return {
    reportDate,
    weekStart,
    monthStart,
    transcriptSource: "dm_conversation_messages",
    legacyTranscriptSource: "dm_transcripts",
    setters,
    dataQuality: {
      recentLiveMessages: recentMessages.length,
      recentStageStates: allStageStates.length,
      recentLegacyUploads: legacyUploads,
      missingSetterMessages: recentMessages.filter((message) => !normalizeSetterName(message.setter_name)).length,
    },
  };
}

export function formatResponseDuration(minutes: number | null) {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  return formatMinutesAsClock(minutes);
}

export function formatResponseGap(gap: ResponseGap) {
  const name = gap.leadName || "Unknown lead";
  return `${name} | Lead: ${formatEtDateTime(gap.prospectAt)} | Reply: ${formatEtDateTime(gap.setterAt)} | Gap: ${formatMinutesAsClock(gap.activeMinutes)}`;
}
