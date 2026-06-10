// DM metrics + funnel data
//
// 6-stage funnel (in order):
//   1. new_lead          — ManyChat `new_lead` tag (hard event)
//   2. challenge_sent    — outbound Skool link detected → `challenge_link_sent` tag
//                          (auto-created by src/lib/dm-link-tracking.ts)
//   3. replied           — ManyChat `lead_engaged` tag (hard event)
//   4. in_discovery      — AI read: lead opened up substantively after lead_engaged.
//                          Stored in dm_conversation_stage_state.goal_clear
//                          (legacy column reused, see src/lib/dm-stage-ai.ts).
//   5. call_link_sent    — ManyChat `call_link_sent` tag (hard event)
//   6. booked            — GHL appointment OR sales tracker row (hybrid)
//
// NEVER falls back to dm_transcripts — those are for setter reviews only.

import { fetchSheetData } from "./google-sheets";
import { getServiceSupabase } from "./supabase";

type Client = "tyson_sonnek" | "antwan_rarcus";

// ── Types ─────────────────────────────────────────────────────────

export interface ManychatMetrics {
  dashboard: {
    newLeads: number;
    leadsEngaged: number;
    callLinksSent: number;
    subLinksSent: number;
  };
  leadSources: LeadSourceMetric[];
  funnel: {
    id: string;
    label: string;
    count: number;
    tracked: boolean;
  }[];
  setters: Record<
    string,
    {
      newLeads: number;
      leadsEngaged: number;
      callLinksSent: number;
      subLinksSent: number;
    }
  >;
  tagsDetected: boolean;
}

const CLIENT_SETTERS: Record<Client, string[]> = {
  tyson_sonnek: ["amara", "kelechi", "debbie", "gideon", "erin"],
  antwan_rarcus: [],
};

const LEAD_SOURCE_DEFS = [
  { id: "direct_cta_ad", label: "Direct CTA ad" },
  { id: "lead_magnet_ad", label: "Lead magnet ad" },
  { id: "direct_coaching_organic_cta", label: "Direct coaching organic CTA" },
  { id: "organic_lead_magnet", label: "Organic lead magnet" },
  { id: "unmapped", label: "Unmapped" },
] as const;

type LeadSourceId = (typeof LEAD_SOURCE_DEFS)[number]["id"];

export interface LeadSourceMetric {
  id: LeadSourceId;
  label: string;
  newLeads: number;
  callsBooked: number;
  callsTaken: number;
  wins: number;
  noShows: number;
  cashCollected: number;
}

const FUNNEL_STAGE_DEFS = [
  { id: "new_lead", label: "New lead" },
  { id: "challenge_sent", label: "Challenge sent" },
  { id: "replied", label: "Replied" },
  { id: "in_discovery", label: "In discovery" },
  { id: "call_link_sent", label: "Call link sent" },
  { id: "booked", label: "Booked" },
] as const;

// Every stage in the new 6-stage funnel is tracked with real data.
const LIVE_STAGE_TAGS = new Set(FUNNEL_STAGE_DEFS.map((stage) => stage.id));

interface CohortLead {
  subscriberId: string;
  setterName: string | null;
  newLeadAt: string;
  subscriberName: string | null;
  keywordRaw: string | null;
  keywordNormalized: string | null;
  rawPayload: unknown;
  sourceId: LeadSourceId;
}

interface ManychatTagEventRow {
  subscriber_id: string;
  tag_name: string;
  setter_name: string | null;
  event_at: string;
  subscriber_name?: string | null;
  keyword_raw?: string | null;
  keyword_normalized?: string | null;
  raw_payload?: unknown;
}

interface StageStateRow {
  subscriber_id: string;
  goal_clear: boolean | null;
  gap_clear: boolean | null;
  stakes_clear: boolean | null;
  qualified: boolean | null;
}

interface ContactLinkRow {
  subscriber_id: string;
  ghl_contact_id: string;
}

interface AppointmentRow {
  contact_id: string | null;
  created_at: string | null;
  status: string | null;
}

interface MetaInsightRow {
  keyword_normalized: string | null;
  campaign_name: string | null;
  ad_name: string | null;
  spend_cents: number | null;
}

function toIsoStart(date: string) {
  return `${date}T00:00:00Z`;
}

function normalizeSetterName(value: string | null | undefined): string | null {
  return value?.trim().toLowerCase() || null;
}

function buildCohort(events: ManychatTagEventRow[]): Map<string, CohortLead> {
  const cohort = new Map<string, CohortLead>();

  for (const event of events) {
    const existing = cohort.get(event.subscriber_id);
    if (!existing || new Date(event.event_at).getTime() < new Date(existing.newLeadAt).getTime()) {
      cohort.set(event.subscriber_id, {
        subscriberId: event.subscriber_id,
        setterName: normalizeSetterName(event.setter_name),
        newLeadAt: event.event_at,
        subscriberName: event.subscriber_name?.trim() || null,
        keywordRaw: event.keyword_raw?.trim() || null,
        keywordNormalized: event.keyword_normalized?.trim().toLowerCase() || null,
        rawPayload: event.raw_payload || null,
        sourceId: "unmapped",
      });
    } else if (!existing.subscriberName && event.subscriber_name?.trim()) {
      cohort.set(event.subscriber_id, {
        ...existing,
        subscriberName: event.subscriber_name.trim(),
      });
    }
  }

  return cohort;
}

function emptyLeadSources(): Record<LeadSourceId, LeadSourceMetric> {
  return LEAD_SOURCE_DEFS.reduce(
    (acc, source) => {
      acc[source.id] = {
        id: source.id,
        label: source.label,
        newLeads: 0,
        callsBooked: 0,
        callsTaken: 0,
        wins: 0,
        noShows: 0,
        cashCollected: 0,
      };
      return acc;
    },
    {} as Record<LeadSourceId, LeadSourceMetric>,
  );
}

function leadSourcesList(sources: Record<LeadSourceId, LeadSourceMetric>): LeadSourceMetric[] {
  return LEAD_SOURCE_DEFS
    .map((source) => sources[source.id])
    .filter((source) => source.id !== "unmapped" || source.newLeads > 0 || source.callsBooked > 0);
}

function adsClientKey(client: Client): string {
  if (client === "tyson_sonnek") return "tyson";
  return "antwan";
}

function textFromPayload(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const queue: unknown[] = [value];

  while (queue.length > 0 && parts.length < 80) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    for (const [key, nested] of Object.entries(current)) {
      if (typeof nested === "string" && nested.trim()) {
        parts.push(`${key} ${nested}`);
      } else if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }

  return parts.join(" ").toLowerCase();
}

function classifyOrganicText(text: string): LeadSourceId | null {
  if (!text) return null;
  const isOrganic = /\b(organic|story|stories|bio|comment|dm|ig|instagram)\b/i.test(text);
  if (!isOrganic) return null;
  if (/\b(lead\s*magnet|magnet|challenge|free|skool|guide|pdf|meal\s*plan|summer\s*shred)\b/i.test(text)) {
    return "organic_lead_magnet";
  }
  if (/\b(cta|coaching|apply|application|call|book|consult|audit)\b/i.test(text)) {
    return "direct_coaching_organic_cta";
  }
  return "direct_coaching_organic_cta";
}

function classifyPaidText(text: string): LeadSourceId {
  if (/\b(lead\s*magnet|magnet|challenge|free|skool|guide|pdf|meal\s*plan|summer\s*shred)\b/i.test(text)) {
    return "lead_magnet_ad";
  }
  return "direct_cta_ad";
}

function classifyLeadSource(
  lead: CohortLead,
  metaHintsByKeyword: Map<string, MetaInsightRow[]>,
): LeadSourceId {
  const keyword = lead.keywordNormalized;
  const payloadText = textFromPayload(lead.rawPayload);
  const keywordText = `${lead.keywordRaw || ""} ${lead.keywordNormalized || ""}`.toLowerCase();
  const combinedText = `${keywordText} ${payloadText}`;

  const organicSource = classifyOrganicText(combinedText);
  if (organicSource) return organicSource;

  const metaHints = keyword ? metaHintsByKeyword.get(keyword) || [] : [];
  const paidHintText = metaHints
    .map((row) => `${row.campaign_name || ""} ${row.ad_name || ""}`)
    .join(" ")
    .toLowerCase();

  if (paidHintText) return classifyPaidText(paidHintText);
  if (/\b(ad|paid|direct\s*cta|cta)\b/i.test(combinedText)) return classifyPaidText(combinedText);

  return "unmapped";
}

function normalizePersonName(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesClientOffer(client: Client, offer: string | null | undefined): boolean {
  const normalized = (offer || "").toLowerCase();
  if (client === "tyson_sonnek") return normalized.includes("tyson");
  if (client === "antwan_rarcus") return normalized.includes("antwan") || normalized.includes("rarcus");
  return false;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ── Main metrics function ─────────────────────────────────────────

export async function getMetrics(
  client: Client,
  dateFrom: string,
  dateTo: string
): Promise<ManychatMetrics> {
  const sb = getServiceSupabase();
  const setters = CLIENT_SETTERS[client];

  const dashboard = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
  const leadSources = emptyLeadSources();
  const funnel = FUNNEL_STAGE_DEFS.map((stage) => ({
    id: stage.id,
    label: stage.label,
    count: 0,
    tracked: LIVE_STAGE_TAGS.has(stage.id),
  }));
  const setterMetrics: Record<string, typeof dashboard> = {};
  for (const s of setters) {
    setterMetrics[s] = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
  }

  try {
    const { data: newLeadEvents, error: newLeadError } = await sb
      .from("manychat_tag_events")
      .select("subscriber_id, subscriber_name, setter_name, event_at, keyword_raw, keyword_normalized, raw_payload")
      .eq("client", client)
      .eq("tag_name", "new_lead")
      .gte("event_at", `${dateFrom}T00:00:00Z`)
      .lte("event_at", `${dateTo}T23:59:59Z`);

    if (newLeadError) {
      console.error("manychat_tag_events cohort query error:", newLeadError);
      return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: false };
    }

    if (!newLeadEvents || newLeadEvents.length === 0) {
      return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: true };
    }

    const cohort = buildCohort(newLeadEvents as ManychatTagEventRow[]);
    const cohortIds = [...cohort.keys()];
    const cohortMinDate = [...cohort.values()]
      .map((lead) => lead.newLeadAt)
      .sort()[0] || toIsoStart(dateFrom);

    dashboard.newLeads = cohortIds.length;
    funnel[0].count = cohortIds.length;

    const keywords = [...new Set(
      [...cohort.values()]
        .map((lead) => lead.keywordNormalized)
        .filter((keyword): keyword is string => Boolean(keyword))
    )];
    const metaHintsByKeyword = new Map<string, MetaInsightRow[]>();

    if (keywords.length > 0) {
      const { data: metaRows, error: metaError } = await sb
        .from("ads_meta_insights_daily")
        .select("keyword_normalized, campaign_name, ad_name, spend_cents")
        .eq("client_key", adsClientKey(client))
        .in("keyword_normalized", keywords)
        .gte("date", addDays(dateFrom, -14))
        .lte("date", dateTo);

      if (metaError) {
        console.error("ads_meta_insights_daily source query error:", metaError);
      } else {
        for (const row of (metaRows || []) as MetaInsightRow[]) {
          const keyword = row.keyword_normalized?.trim().toLowerCase();
          if (!keyword || (row.spend_cents || 0) <= 0) continue;
          const list = metaHintsByKeyword.get(keyword) || [];
          list.push(row);
          metaHintsByKeyword.set(keyword, list);
        }
      }
    }

    for (const lead of cohort.values()) {
      lead.sourceId = classifyLeadSource(lead, metaHintsByKeyword);
      leadSources[lead.sourceId].newLeads += 1;
    }

    for (const lead of cohort.values()) {
      const setter = lead.setterName;
      if (setter && setterMetrics[setter]) {
        setterMetrics[setter].newLeads += 1;
      }
    }

    const { data: allEvents, error: eventError } = await sb
      .from("manychat_tag_events")
      .select("subscriber_id, tag_name, setter_name, event_at")
      .eq("client", client)
      .in("subscriber_id", cohortIds);

    if (eventError) {
      console.error("manychat_tag_events progression query error:", eventError);
      return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: false };
    }

    const eventsBySubscriber = new Map<string, ManychatTagEventRow[]>();
    for (const event of (allEvents || []) as ManychatTagEventRow[]) {
      const list = eventsBySubscriber.get(event.subscriber_id) || [];
      list.push(event);
      eventsBySubscriber.set(event.subscriber_id, list);
    }

    const stageSubscribers = {
      challenge_link_sent: new Set<string>(),
      lead_engaged: new Set<string>(),
      call_link_sent: new Set<string>(),
      sub_link_sent: new Set<string>(),
    };

    for (const lead of cohort.values()) {
      const events = eventsBySubscriber.get(lead.subscriberId) || [];
      const newLeadTime = new Date(lead.newLeadAt).getTime();

      for (const event of events) {
        const eventTime = new Date(event.event_at).getTime();
        if (eventTime < newLeadTime) continue;
        if (event.tag_name === "challenge_link_sent") stageSubscribers.challenge_link_sent.add(lead.subscriberId);
        if (event.tag_name === "lead_engaged") stageSubscribers.lead_engaged.add(lead.subscriberId);
        if (event.tag_name === "call_link_sent") stageSubscribers.call_link_sent.add(lead.subscriberId);
        if (event.tag_name === "sub_link_sent") stageSubscribers.sub_link_sent.add(lead.subscriberId);
      }

      const setter = lead.setterName;
      if (setter && setterMetrics[setter]) {
        if (stageSubscribers.lead_engaged.has(lead.subscriberId)) setterMetrics[setter].leadsEngaged += 1;
        if (stageSubscribers.call_link_sent.has(lead.subscriberId)) setterMetrics[setter].callLinksSent += 1;
        if (stageSubscribers.sub_link_sent.has(lead.subscriberId)) setterMetrics[setter].subLinksSent += 1;
      }
    }

    dashboard.leadsEngaged = stageSubscribers.lead_engaged.size;
    dashboard.callLinksSent = stageSubscribers.call_link_sent.size;
    dashboard.subLinksSent = stageSubscribers.sub_link_sent.size;

    const { data: stageStates, error: stageError } = await sb
      .from("dm_conversation_stage_state")
      .select("subscriber_id, goal_clear, gap_clear, stakes_clear, qualified")
      .eq("client", client)
      .in("subscriber_id", cohortIds);

    if (stageError) {
      console.error("dm_conversation_stage_state query error:", stageError);
      return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: false };
    }

    const stageStateMap = new Map<string, StageStateRow>();
    for (const row of (stageStates || []) as StageStateRow[]) {
      const existing = stageStateMap.get(row.subscriber_id);
      stageStateMap.set(row.subscriber_id, {
        subscriber_id: row.subscriber_id,
        goal_clear: Boolean(existing?.goal_clear || row.goal_clear),
        gap_clear: Boolean(existing?.gap_clear || row.gap_clear),
        stakes_clear: Boolean(existing?.stakes_clear || row.stakes_clear),
        qualified: Boolean(existing?.qualified || row.qualified),
      });
    }

    const { data: contactLinks, error: linkError } = await sb
      .from("manychat_contact_links")
      .select("subscriber_id, ghl_contact_id")
      .eq("client", client)
      .in("subscriber_id", cohortIds);

    if (linkError) {
      console.error("manychat_contact_links query error:", linkError);
      return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: false };
    }

    const linkMap = new Map<string, ContactLinkRow>();
    const contactIds: string[] = [];
    for (const row of (contactLinks || []) as ContactLinkRow[]) {
      linkMap.set(row.subscriber_id, row);
      if (row.ghl_contact_id) contactIds.push(row.ghl_contact_id);
    }

    const bookedSubscribers = new Set<string>();
    const bookedSubscribersBySource = new Map<LeadSourceId, Set<string>>();
    for (const source of LEAD_SOURCE_DEFS) {
      bookedSubscribersBySource.set(source.id, new Set<string>());
    }
    let salesTrackerBookedCount = 0;

    try {
      const salesRows = (await fetchSheetData(dateFrom, addDays(dateTo, 30)))
        .filter((row) => row.programLength !== "Subscription");
      const clientSalesRows = salesRows.filter((row) => matchesClientOffer(client, row.offer));
      salesTrackerBookedCount = clientSalesRows.length;
      const leadsByName = new Map<string, CohortLead[]>();
      for (const lead of cohort.values()) {
        if (!lead.subscriberName) continue;
        const key = normalizePersonName(lead.subscriberName);
        if (!key) continue;
        const list = leadsByName.get(key) || [];
        list.push(lead);
        leadsByName.set(key, list);
      }

      for (const row of clientSalesRows) {
        const lead = row.manychatSubscriberId
          ? cohort.get(row.manychatSubscriberId)
          : (leadsByName.get(normalizePersonName(row.name)) || [])[0];

        if (!lead) continue;

        bookedSubscribers.add(lead.subscriberId);
        bookedSubscribersBySource.get(lead.sourceId)?.add(lead.subscriberId);

        const source = leadSources[lead.sourceId];
        if (row.callTakenStatus === "yes") source.callsTaken += 1;
        if (row.callTakenStatus === "no") source.noShows += 1;
        if (row.callTakenStatus === "yes" && row.outcome === "WIN") {
          source.wins += 1;
          source.cashCollected += row.cashCollected || 0;
        }
      }
    } catch (sheetError) {
      console.error("sales tracker booked query error:", sheetError);
    }

    if (contactIds.length > 0) {
      const { data: appointments, error: appointmentError } = await sb
        .from("ghl_appointments")
        .select("contact_id, created_at, status")
        .in("contact_id", contactIds)
        .gte("created_at", cohortMinDate);

      if (appointmentError) {
        console.error("ghl_appointments query error:", appointmentError);
        return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: false };
      }

      const appointmentsByContact = new Map<string, AppointmentRow[]>();

      for (const row of (appointments || []) as AppointmentRow[]) {
        if (!row.contact_id) continue;
        const list = appointmentsByContact.get(row.contact_id) || [];
        list.push(row);
        appointmentsByContact.set(row.contact_id, list);
      }

      for (const lead of cohort.values()) {
        const link = linkMap.get(lead.subscriberId);
        if (!link?.ghl_contact_id) continue;
        const rows = appointmentsByContact.get(link.ghl_contact_id) || [];
        const newLeadTime = new Date(lead.newLeadAt).getTime();
        const hasBooked = rows.some((row) => {
          const createdAt = row.created_at ? new Date(row.created_at).getTime() : 0;
          const status = row.status?.toLowerCase() || "";
          return createdAt >= newLeadTime && status !== "cancelled";
        });
        if (hasBooked) {
          bookedSubscribers.add(lead.subscriberId);
          bookedSubscribersBySource.get(lead.sourceId)?.add(lead.subscriberId);
        }
      }
    }

    for (const source of LEAD_SOURCE_DEFS) {
      leadSources[source.id].callsBooked = bookedSubscribersBySource.get(source.id)?.size || 0;
    }

    const funnelStageCounts = {
      challenge_sent: 0,
      replied: 0,
      in_discovery: 0,
      call_link_sent: 0,
      booked: 0,
    };

    // Monotone funnel: each stage subsumes the next. Later stages imply earlier
    // ones — e.g. if a lead booked, they reached every step before booked even
    // if an earlier tag got missed upstream.
    for (const lead of cohort.values()) {
      const state = stageStateMap.get(lead.subscriberId);
      const hasChallengeTag = stageSubscribers.challenge_link_sent.has(lead.subscriberId);
      const engaged = stageSubscribers.lead_engaged.has(lead.subscriberId);
      const linkSent = stageSubscribers.call_link_sent.has(lead.subscriberId);
      const booked = bookedSubscribers.has(lead.subscriberId);
      // `state.goal_clear` is the legacy column; the AI now stores in_discovery there.
      const inDiscoveryAi = Boolean(state?.goal_clear);

      const replied = engaged || inDiscoveryAi || linkSent || booked;
      const challengeSent = hasChallengeTag || replied;
      const inDiscovery = replied && (inDiscoveryAi || linkSent || booked);
      const callLinkSent = inDiscovery && (linkSent || booked);
      const bookedStage = callLinkSent && booked;

      if (challengeSent) funnelStageCounts.challenge_sent += 1;
      if (replied) funnelStageCounts.replied += 1;
      if (inDiscovery) funnelStageCounts.in_discovery += 1;
      if (callLinkSent) funnelStageCounts.call_link_sent += 1;
      if (bookedStage) funnelStageCounts.booked += 1;
    }

    if (salesTrackerBookedCount > 0) {
      funnelStageCounts.booked = Math.max(
        funnelStageCounts.booked,
        Math.min(funnelStageCounts.call_link_sent, salesTrackerBookedCount)
      );
    }

    for (const stage of funnel) {
      if (stage.id === "new_lead") stage.count = dashboard.newLeads;
      if (stage.id === "challenge_sent") stage.count = funnelStageCounts.challenge_sent;
      if (stage.id === "replied") stage.count = funnelStageCounts.replied;
      if (stage.id === "in_discovery") stage.count = funnelStageCounts.in_discovery;
      if (stage.id === "call_link_sent") stage.count = funnelStageCounts.call_link_sent;
      if (stage.id === "booked") stage.count = funnelStageCounts.booked;
    }

    return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: true };
  } catch (err) {
    console.error("manychat_tag_events error:", err);
    return { dashboard, leadSources: leadSourcesList(leadSources), funnel, setters: setterMetrics, tagsDetected: false };
  }
}

// ── Legacy exports for compatibility ──────────────────────────────

export async function getTags(client: Client): Promise<{ id: number; name: string }[]> {
  const MANYCHAT_BASE = "https://api.manychat.com/fb";
  const key =
    client === "tyson_sonnek"
      ? process.env.MANYCHAT_API_KEY_TYSON
      : process.env.MANYCHAT_API_KEY_ANTWAN;
  if (!key) return [];

  try {
    const res = await fetch(`${MANYCHAT_BASE}/page/getTags`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = await res.json();
    return json.data || [];
  } catch {
    return [];
  }
}
