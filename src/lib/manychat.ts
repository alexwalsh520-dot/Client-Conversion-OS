// Manychat / DM metrics
//
// Pulls EXCLUSIVELY from manychat_tag_events table (populated by Manychat webhooks).
// NEVER falls back to dm_transcripts — those are for setter reviews only.

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

  // Pull ONLY from manychat_tag_events — no fallback
  try {
    const { data: events, error } = await sb
      .from("manychat_tag_events")
      .select("tag_name, setter_name, subscriber_id")
      .eq("client", client)
      .gte("event_at", `${dateFrom}T00:00:00Z`)
      .lte("event_at", `${dateTo}T23:59:59Z`);

    if (error) {
      console.error("manychat_tag_events query error:", error);
      return { dashboard, setters: setterMetrics, tagsDetected: false };
    }

    // If no events, return zeros — do NOT fall back to dm_transcripts
    if (!events || events.length === 0) {
      return { dashboard, setters: setterMetrics, tagsDetected: true };
    }

    const METRIC_TAGS = ["new_lead", "lead_engaged", "call_link_sent", "sub_link_sent"] as const;
    const METRIC_KEYS = ["newLeads", "leadsEngaged", "callLinksSent", "subLinksSent"] as const;

    for (let i = 0; i < METRIC_TAGS.length; i++) {
      const tagName = METRIC_TAGS[i];
      const metricKey = METRIC_KEYS[i];
      const tagEvents = events.filter((e) => e.tag_name === tagName);
      const uniqueSubscribers = new Set(tagEvents.map((e) => e.subscriber_id));
      dashboard[metricKey] = uniqueSubscribers.size;

      for (const setter of setters) {
        const setterEvents = tagEvents.filter((e) => e.setter_name === setter);
        const uniqueSetterSubs = new Set(setterEvents.map((e) => e.subscriber_id));
        setterMetrics[setter][metricKey] = uniqueSetterSubs.size;
      }
    }

    return { dashboard, setters: setterMetrics, tagsDetected: true };
  } catch (err) {
    console.error("manychat_tag_events error:", err);
    return { dashboard, setters: setterMetrics, tagsDetected: false };
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
