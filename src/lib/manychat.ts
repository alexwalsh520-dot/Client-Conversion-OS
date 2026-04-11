// DM metrics + funnel data
//
// Hard events come from manychat_tag_events.
// Middle funnel stages come from dm_conversation_stage_state (AI classification of live GHL conversations).
// NEVER falls back to dm_transcripts — those are for setter reviews only.

import { fetchSheetData } from "./google-sheets";
import { getServiceSupabase } from "./supabase";

type Client = "tyson_sonnek" | "keith_holland" | "zoe_and_emily";

// ── Types ─────────────────────────────────────────────────────────

export interface ManychatMetrics {
  dashboard: {
    newLeads: number;
    leadsEngaged: number;
    callLinksSent: number;
    subLinksSent: number;
  };
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
  tyson_sonnek: ["amara"],
  keith_holland: ["gideon"],
  zoe_and_emily: ["kelechi", "debbie"],
};

const FUNNEL_STAGE_DEFS = [
  { id: "new_lead", label: "New lead" },
  { id: "lead_engaged", label: "Engaged" },
  { id: "goal_clear", label: "Goal clear" },
  { id: "gap_clear", label: "Gap clear" },
  { id: "stakes_clear", label: "Stakes clear" },
  { id: "qualified", label: "Qualified" },
  { id: "call_link_sent", label: "Link sent" },
  { id: "booked", label: "Booked" },
] as const;

const LIVE_STAGE_TAGS = new Set(FUNNEL_STAGE_DEFS.map((stage) => stage.id));

interface CohortLead {
  subscriberId: string;
  setterName: string | null;
  newLeadAt: string;
  subscriberName: string | null;
}

interface ManychatTagEventRow {
  subscriber_id: string;
  tag_name: string;
  setter_name: string | null;
  event_at: string;
  subscriber_name?: string | null;
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
  if (client === "keith_holland") return normalized.includes("keith");
  if (client === "zoe_and_emily") return normalized.includes("zoe") || normalized.includes("emily");
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
      .select("subscriber_id, subscriber_name, setter_name, event_at")
      .eq("client", client)
      .eq("tag_name", "new_lead")
      .gte("event_at", `${dateFrom}T00:00:00Z`)
      .lte("event_at", `${dateTo}T23:59:59Z`);

    if (newLeadError) {
      console.error("manychat_tag_events cohort query error:", newLeadError);
      return { dashboard, funnel, setters: setterMetrics, tagsDetected: false };
    }

    if (!newLeadEvents || newLeadEvents.length === 0) {
      return { dashboard, funnel, setters: setterMetrics, tagsDetected: true };
    }

    const cohort = buildCohort(newLeadEvents as ManychatTagEventRow[]);
    const cohortIds = [...cohort.keys()];
    const cohortMinDate = [...cohort.values()]
      .map((lead) => lead.newLeadAt)
      .sort()[0] || toIsoStart(dateFrom);

    dashboard.newLeads = cohortIds.length;
    funnel[0].count = cohortIds.length;

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
      return { dashboard, funnel, setters: setterMetrics, tagsDetected: false };
    }

    const eventsBySubscriber = new Map<string, ManychatTagEventRow[]>();
    for (const event of (allEvents || []) as ManychatTagEventRow[]) {
      const list = eventsBySubscriber.get(event.subscriber_id) || [];
      list.push(event);
      eventsBySubscriber.set(event.subscriber_id, list);
    }

    const stageSubscribers = {
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
      return { dashboard, funnel, setters: setterMetrics, tagsDetected: false };
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
      return { dashboard, funnel, setters: setterMetrics, tagsDetected: false };
    }

    const linkMap = new Map<string, ContactLinkRow>();
    const contactIds: string[] = [];
    for (const row of (contactLinks || []) as ContactLinkRow[]) {
      linkMap.set(row.subscriber_id, row);
      if (row.ghl_contact_id) contactIds.push(row.ghl_contact_id);
    }

    const bookedSubscribers = new Set<string>();

    try {
      const salesRows = await fetchSheetData(dateFrom, addDays(dateTo, 30));
      const bookedNames = new Set(
        salesRows
          .filter((row) => matchesClientOffer(client, row.offer))
          .map((row) => normalizePersonName(row.name))
          .filter(Boolean)
      );

      for (const lead of cohort.values()) {
        if (!lead.subscriberName) continue;
        if (bookedNames.has(normalizePersonName(lead.subscriberName))) {
          bookedSubscribers.add(lead.subscriberId);
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
        return { dashboard, funnel, setters: setterMetrics, tagsDetected: false };
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
        if (hasBooked) bookedSubscribers.add(lead.subscriberId);
      }
    }

    const funnelStageCounts = {
      lead_engaged: 0,
      goal_clear: 0,
      gap_clear: 0,
      stakes_clear: 0,
      qualified: 0,
      call_link_sent: 0,
      booked: 0,
    };

    for (const lead of cohort.values()) {
      const state = stageStateMap.get(lead.subscriberId);
      const engaged = stageSubscribers.lead_engaged.has(lead.subscriberId);
      const linkSent = stageSubscribers.call_link_sent.has(lead.subscriberId);
      const booked = bookedSubscribers.has(lead.subscriberId);

      const goalClear = engaged && Boolean(state?.goal_clear || linkSent || booked);
      const gapClear = goalClear && Boolean(state?.gap_clear || linkSent || booked);
      const stakesClear = gapClear && Boolean(state?.stakes_clear || linkSent || booked);
      const qualified = stakesClear && Boolean(state?.qualified || linkSent || booked);
      const callLinkSent = qualified && (linkSent || booked);
      const bookedStage = callLinkSent && booked;

      if (engaged) funnelStageCounts.lead_engaged += 1;
      if (goalClear) funnelStageCounts.goal_clear += 1;
      if (gapClear) funnelStageCounts.gap_clear += 1;
      if (stakesClear) funnelStageCounts.stakes_clear += 1;
      if (qualified) funnelStageCounts.qualified += 1;
      if (callLinkSent) funnelStageCounts.call_link_sent += 1;
      if (bookedStage) funnelStageCounts.booked += 1;
    }

    for (const stage of funnel) {
      if (stage.id === "new_lead") stage.count = dashboard.newLeads;
      if (stage.id === "lead_engaged") stage.count = funnelStageCounts.lead_engaged;
      if (stage.id === "goal_clear") stage.count = funnelStageCounts.goal_clear;
      if (stage.id === "gap_clear") stage.count = funnelStageCounts.gap_clear;
      if (stage.id === "stakes_clear") stage.count = funnelStageCounts.stakes_clear;
      if (stage.id === "qualified") stage.count = funnelStageCounts.qualified;
      if (stage.id === "call_link_sent") stage.count = funnelStageCounts.call_link_sent;
      if (stage.id === "booked") stage.count = funnelStageCounts.booked;
    }

    return { dashboard, funnel, setters: setterMetrics, tagsDetected: true };
  } catch (err) {
    console.error("manychat_tag_events error:", err);
    return { dashboard, funnel, setters: setterMetrics, tagsDetected: false };
  }
}

// ── Legacy exports for compatibility ──────────────────────────────

export async function getTags(client: Client): Promise<{ id: number; name: string }[]> {
  const MANYCHAT_BASE = "https://api.manychat.com/fb";
  const key =
    client === "tyson_sonnek"
      ? process.env.MANYCHAT_API_KEY_TYSON
      : client === "keith_holland"
        ? process.env.MANYCHAT_API_KEY_KEITH
        : process.env.MANYCHAT_API_KEY_ZOE_EMILY;
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
