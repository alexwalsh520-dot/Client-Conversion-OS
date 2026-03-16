// Manychat metrics — powered by webhook events stored in Supabase
//
// The Manychat API does NOT have a "get subscribers by tag" endpoint.
// Instead, Manychat flows send tag events to our webhook at
// /api/sales-hub/manychat-webhook, which stores them in
// the manychat_tag_events Supabase table.
//
// This module queries that table to produce dashboard metrics.

import { getServiceSupabase } from "./supabase";

type Client = "tyson" | "keith";

// ── Types ─────────────────────────────────────────────────────────

export interface ManychatMetrics {
  dashboard: {
    newLeads: number;
    leadsEngaged: number;
    callLinksSent: number;
    subLinksSent: number;
  };
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

const METRIC_TAGS = ["new_lead", "lead_engaged", "call_link_sent", "sub_link_sent"] as const;
const METRIC_KEYS = ["newLeads", "leadsEngaged", "callLinksSent", "subLinksSent"] as const;

const CLIENT_SETTERS: Record<Client, string[]> = {
  tyson: ["amara", "kelechi"],
  keith: ["gideon", "debbie"],
};

// ── Main metrics function ─────────────────────────────────────────

export async function getMetrics(
  client: Client,
  dateFrom: string,
  dateTo: string
): Promise<ManychatMetrics> {
  const sb = getServiceSupabase();
  const setters = CLIENT_SETTERS[client];

  const dashboard = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
  const setterMetrics: Record<string, typeof dashboard> = {};
  for (const s of setters) {
    setterMetrics[s] = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
  }

  // Query all tag events for this client in the date range
  const { data: events, error } = await sb
    .from("manychat_tag_events")
    .select("tag_name, setter_name, subscriber_id")
    .eq("client", client)
    .gte("event_at", `${dateFrom}T00:00:00Z`)
    .lte("event_at", `${dateTo}T23:59:59Z`);

  if (error) {
    console.error("Manychat metrics query error:", error);
    return { dashboard, setters: setterMetrics, tagsDetected: false };
  }

  if (!events || events.length === 0) {
    return { dashboard, setters: setterMetrics, tagsDetected: true };
  }

  // Count by tag, deduplicating by subscriber_id per tag
  for (let i = 0; i < METRIC_TAGS.length; i++) {
    const tagName = METRIC_TAGS[i];
    const metricKey = METRIC_KEYS[i];

    const tagEvents = events.filter((e) => e.tag_name === tagName);
    // Deduplicate by subscriber_id to avoid double-counting
    const uniqueSubscribers = new Set(tagEvents.map((e) => e.subscriber_id));
    dashboard[metricKey] = uniqueSubscribers.size;

    // Count per setter
    for (const setter of setters) {
      const setterEvents = tagEvents.filter((e) => e.setter_name === setter);
      const uniqueSetterSubs = new Set(setterEvents.map((e) => e.subscriber_id));
      setterMetrics[setter][metricKey] = uniqueSetterSubs.size;
    }
  }

  return { dashboard, setters: setterMetrics, tagsDetected: true };
}

// ── Legacy exports for compatibility ──────────────────────────────

// Keep getTags for any other code that uses it
export async function getTags(client: Client): Promise<{ id: number; name: string }[]> {
  const MANYCHAT_BASE = "https://api.manychat.com/fb";
  const key =
    client === "tyson"
      ? process.env.MANYCHAT_API_KEY_TYSON
      : process.env.MANYCHAT_API_KEY_KEITH;
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
