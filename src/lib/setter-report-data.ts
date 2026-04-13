import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
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

export interface SetterTranscript {
  conversationId: string;
  latestMessageAt: string | null;
  messageCount: number;
  transcript: string;
}

export interface SetterResponseStats {
  averageMinutes: number | null;
  sampleCount: number;
  worstGaps: Array<{
    conversationId: string;
    minutes: number;
    prospectAt: string;
    setterAt: string;
  }>;
}

export interface SetterSalesStats {
  booked: number;
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

export interface SetterReportRow {
  setterKey: string;
  setterName: string;
  clientKey: ClientKey;
  clientLabel: string;
  daily: SetterFunnelCounts;
  mtd: SetterFunnelCounts & SetterSalesStats;
  responseTime: SetterResponseStats;
  transcripts: SetterTranscript[];
}

export interface SetterReportData {
  reportDate: string;
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

function startOfDay(date: string) {
  return `${date}T00:00:00Z`;
}

function endOfDay(date: string) {
  return `${date}T23:59:59.999Z`;
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function subtractDays(date: string, days: number) {
  return addDays(date, -days);
}

function monthStartOf(date: string) {
  return `${date.slice(0, 8)}01`;
}

function normalizeSetterName(value: string | null | undefined) {
  return value?.trim().toLowerCase() || "";
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
      const stamp = message.sent_at ? ` (${message.sent_at})` : "";
      return `${speaker}${stamp}: ${(message.body || "").trim()}`;
    })
    .join("\n");
}

function getEtHour(dateString: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false,
  });
  return Number(formatter.format(new Date(dateString)));
}

function isTrackedInboundWindow(dateString: string) {
  const hour = getEtHour(dateString);
  return hour >= 12 && hour < 24;
}

function computeResponseStats(messages: MessageRow[]): SetterResponseStats {
  const grouped = new Map<string, MessageRow[]>();
  for (const message of messages) {
    if (!message.conversation_id || !message.sent_at) continue;
    const list = grouped.get(message.conversation_id) || [];
    list.push(message);
    grouped.set(message.conversation_id, list);
  }

  const samples: Array<{
    conversationId: string;
    minutes: number;
    prospectAt: string;
    setterAt: string;
  }> = [];

  for (const [conversationId, convoMessages] of grouped.entries()) {
    const ordered = [...convoMessages].sort((a, b) =>
      (a.sent_at || "").localeCompare(b.sent_at || ""),
    );
    let pendingInbound: MessageRow | null = null;

    for (const message of ordered) {
      if (!message.sent_at) continue;

      if (message.direction === "inbound") {
        if (!pendingInbound && isTrackedInboundWindow(message.sent_at)) {
          pendingInbound = message;
        }
        continue;
      }

      if (message.direction === "outbound" && pendingInbound?.sent_at) {
        const minutes =
          (new Date(message.sent_at).getTime() - new Date(pendingInbound.sent_at).getTime()) /
          60000;

        if (Number.isFinite(minutes) && minutes >= 0) {
          samples.push({
            conversationId,
            minutes,
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
      ? samples.reduce((sum, sample) => sum + sample.minutes, 0) / samples.length
      : null;

  return {
    averageMinutes,
    sampleCount: samples.length,
    worstGaps: [...samples].sort((a, b) => b.minutes - a.minutes).slice(0, 5),
  };
}

function filterSheetRowsForSetter(rows: SheetRow[], setter: SetterDef) {
  return rows.filter((row) => {
    const setterMatch = setter.sheetKeys.some((key) =>
      (row.setter || "").toUpperCase().includes(key),
    );
    if (!setterMatch) return false;

    const offerLower = (row.offer || "").toLowerCase();
    if (setter.clientKey === "tyson_sonnek") return offerLower.includes("tyson");
    if (setter.clientKey === "keith_holland") return offerLower.includes("keith");
    return offerLower.includes("zoe") || offerLower.includes("emily");
  });
}

function computeSalesStats(rows: SheetRow[], newLeads: number): SetterSalesStats {
  const booked = rows.length;
  const taken = rows.filter((row) => row.callTaken).length;
  const wins = rows.filter((row) => row.outcome === "WIN").length;
  const noShows = rows.filter((row) => ["NS/RS", "NS", "NO SHOW"].includes((row.outcome || "").toUpperCase())).length;
  const cashCollected = rows.reduce((sum, row) => sum + (row.cashCollected || 0), 0);
  const revenue = rows.reduce((sum, row) => sum + (row.revenue || 0), 0);

  return {
    booked,
    taken,
    wins,
    noShows,
    cashCollected,
    revenue,
    aov: wins > 0 ? cashCollected / wins : 0,
    bookingRate: newLeads > 0 ? (booked / newLeads) * 100 : 0,
    showRate: booked > 0 ? (taken / booked) * 100 : 0,
    closeRate: taken > 0 ? (wins / taken) * 100 : 0,
  };
}

function countFunnelForSetter(params: {
  setter: SetterDef;
  tagEvents: TagEventRow[];
  stageStates: StageStateRow[];
}): SetterFunnelCounts {
  const { setter, tagEvents, stageStates } = params;
  const setterKey = setter.key;
  const newLeadEvents = tagEvents.filter(
    (event) =>
      event.client === setter.clientKey &&
      normalizeSetterName(event.setter_name) === setterKey &&
      event.tag_name === "new_lead",
  );

  const leadIds = new Set(newLeadEvents.map((event) => event.subscriber_id));
  const engagedIds = new Set<string>();
  const callLinkIds = new Set<string>();
  const subLinkIds = new Set<string>();

  for (const event of tagEvents) {
    if (
      event.client !== setter.clientKey ||
      normalizeSetterName(event.setter_name) !== setterKey ||
      !leadIds.has(event.subscriber_id)
    ) {
      continue;
    }

    if (event.tag_name === "lead_engaged") engagedIds.add(event.subscriber_id);
    if (event.tag_name === "call_link_sent") callLinkIds.add(event.subscriber_id);
    if (event.tag_name === "sub_link_sent") subLinkIds.add(event.subscriber_id);
  }

  const stageBySubscriber = new Map<string, StageStateRow>();
  for (const row of stageStates) {
    if (
      row.client !== setter.clientKey ||
      normalizeSetterName(row.setter_name) !== setterKey ||
      !leadIds.has(row.subscriber_id)
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
  };
}

export async function getSetterReportData(reportDate: string): Promise<SetterReportData> {
  const sb = getServiceSupabase();
  const monthStart = monthStartOf(reportDate);
  const transcriptStart = subtractDays(reportDate, 2);

  const [dailyTagsRes, mtdTagsRes, dailyStagesRes, mtdStagesRes, mtdMessagesRes, recentMessagesRes, legacyUploadsRes, mtdSheetRows] =
    await Promise.all([
      sb
        .from("manychat_tag_events")
        .select("client, setter_name, subscriber_id, tag_name, event_at")
        .gte("event_at", startOfDay(reportDate))
        .lte("event_at", endOfDay(reportDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("manychat_tag_events")
        .select("client, setter_name, subscriber_id, tag_name, event_at")
        .gte("event_at", startOfDay(monthStart))
        .lte("event_at", endOfDay(reportDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_conversation_stage_state")
        .select("client, setter_name, subscriber_id, conversation_id, goal_clear, gap_clear, stakes_clear, qualified, booking_readiness_score, stage_evidence, latest_message_at, updated_at")
        .lte("updated_at", endOfDay(reportDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_conversation_stage_state")
        .select("client, setter_name, subscriber_id, conversation_id, goal_clear, gap_clear, stakes_clear, qualified, booking_readiness_score, stage_evidence, latest_message_at, updated_at")
        .lte("updated_at", endOfDay(reportDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_conversation_messages")
        .select("client, setter_name, subscriber_id, conversation_id, direction, body, sent_at")
        .gte("sent_at", startOfDay(monthStart))
        .lte("sent_at", endOfDay(reportDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_conversation_messages")
        .select("client, setter_name, subscriber_id, conversation_id, direction, body, sent_at")
        .gte("sent_at", startOfDay(transcriptStart))
        .lte("sent_at", endOfDay(reportDate))
        .in("client", SETTERS.map((setter) => setter.clientKey)),
      sb
        .from("dm_transcripts")
        .select("id", { count: "exact", head: true })
        .gte("submitted_at", startOfDay(transcriptStart)),
      fetchSheetData(monthStart, reportDate),
    ]);

  const results = [
    dailyTagsRes,
    mtdTagsRes,
    dailyStagesRes,
    mtdStagesRes,
    mtdMessagesRes,
    recentMessagesRes,
    legacyUploadsRes,
  ];
  for (const result of results) {
    if (result.error) {
      throw new Error(result.error.message);
    }
  }

  const dailyTags = (dailyTagsRes.data || []) as TagEventRow[];
  const mtdTags = (mtdTagsRes.data || []) as TagEventRow[];
  const dailyStages = (dailyStagesRes.data || []) as StageStateRow[];
  const mtdStages = (mtdStagesRes.data || []) as StageStateRow[];
  const mtdMessages = (mtdMessagesRes.data || []) as MessageRow[];
  const recentMessages = (recentMessagesRes.data || []) as MessageRow[];
  const legacyUploads = legacyUploadsRes.count || 0;

  const setters = SETTERS.map((setter) => {
    const daily = countFunnelForSetter({
      setter,
      tagEvents: dailyTags,
      stageStates: dailyStages,
    });

    const mtdFunnel = countFunnelForSetter({
      setter,
      tagEvents: mtdTags,
      stageStates: mtdStages,
    });

    const setterSheetRows = filterSheetRowsForSetter(mtdSheetRows, setter);
    const sales = computeSalesStats(setterSheetRows, mtdFunnel.newLeads);

    const setterMessages = mtdMessages.filter(
      (message) =>
        message.client === setter.clientKey &&
        normalizeSetterName(message.setter_name) === setter.key,
    );

    const responseTime = computeResponseStats(setterMessages);

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
        return {
          conversationId,
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
      daily,
      mtd: {
        ...mtdFunnel,
        ...sales,
      },
      responseTime,
      transcripts,
    };
  });

  return {
    reportDate,
    monthStart,
    transcriptSource: "dm_conversation_messages",
    legacyTranscriptSource: "dm_transcripts",
    setters,
    dataQuality: {
      recentLiveMessages: recentMessages.length,
      recentStageStates: mtdStages.length,
      recentLegacyUploads: legacyUploads,
      missingSetterMessages: recentMessages.filter((message) => !normalizeSetterName(message.setter_name)).length,
    },
  };
}
