// Manychat / DM metrics
//
// Uses dm_transcripts table (already populated by setters) to derive metrics.
// Also attempts manychat_tag_events if available for more granular data.

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

  // Try manychat_tag_events first (webhook-based, most accurate)
  try {
    const { data: events, error } = await sb
      .from("manychat_tag_events")
      .select("tag_name, setter_name, subscriber_id")
      .eq("client", client)
      .gte("event_at", `${dateFrom}T00:00:00Z`)
      .lte("event_at", `${dateTo}T23:59:59Z`);

    if (!error && events && events.length > 0) {
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
    }
  } catch {
    // Table doesn't exist or query failed — fall through to dm_transcripts
  }

  // Fallback: derive metrics from dm_transcripts table
  try {
    const { data: transcripts, error } = await sb
      .from("dm_transcripts")
      .select("id, setter_name, transcript, submitted_at")
      .eq("client", client)
      .gte("submitted_at", `${dateFrom}T00:00:00Z`)
      .lte("submitted_at", `${dateTo}T23:59:59Z`);

    if (error || !transcripts) {
      console.error("DM transcripts query error:", error);
      return { dashboard, setters: setterMetrics, tagsDetected: false };
    }

    // Each transcript = a lead interaction
    // Parse transcripts to estimate metrics
    for (const t of transcripts) {
      const text = (t.transcript || "").toLowerCase();
      const setter = (t.setter_name || "").toLowerCase();

      // Every transcript represents a lead that was engaged
      dashboard.newLeads++;
      dashboard.leadsEngaged++;

      // Check if call link was mentioned in the conversation
      if (
        text.includes("calendly") ||
        text.includes("book") ||
        text.includes("schedule") ||
        text.includes("call link") ||
        text.includes("zoom") ||
        text.includes("meeting")
      ) {
        dashboard.callLinksSent++;
      }

      // Check if subscription link was mentioned
      if (
        text.includes("subscription") ||
        text.includes("sub link") ||
        text.includes("sign up") ||
        text.includes("checkout") ||
        text.includes("payment")
      ) {
        dashboard.subLinksSent++;
      }

      // Attribute to setter
      if (setter && setterMetrics[setter]) {
        setterMetrics[setter].newLeads++;
        setterMetrics[setter].leadsEngaged++;

        if (
          text.includes("calendly") ||
          text.includes("book") ||
          text.includes("schedule") ||
          text.includes("call link") ||
          text.includes("zoom") ||
          text.includes("meeting")
        ) {
          setterMetrics[setter].callLinksSent++;
        }

        if (
          text.includes("subscription") ||
          text.includes("sub link") ||
          text.includes("sign up") ||
          text.includes("checkout") ||
          text.includes("payment")
        ) {
          setterMetrics[setter].subLinksSent++;
        }
      }
    }

    return { dashboard, setters: setterMetrics, tagsDetected: true };
  } catch (err) {
    console.error("DM metrics fallback error:", err);
    return { dashboard, setters: setterMetrics, tagsDetected: false };
  }
}

// ── Legacy exports for compatibility ──────────────────────────────

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
