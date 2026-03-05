// Manychat API helper for DM Reviews
// Base URL: https://api.manychat.com/fb
// Auth: Bearer token per client

const MANYCHAT_BASE = "https://api.manychat.com/fb";

type Client = "tyson" | "keith";

function getApiKey(client: Client): string {
  const key =
    client === "tyson"
      ? process.env.MANYCHAT_API_KEY_TYSON
      : process.env.MANYCHAT_API_KEY_KEITH;
  if (!key) throw new Error(`MANYCHAT_API_KEY_${client.toUpperCase()} not configured`);
  return key;
}

function headers(client: Client) {
  return {
    Authorization: `Bearer ${getApiKey(client)}`,
    Accept: "application/json",
  };
}

// ── Get all tags on the page ──────────────────────────────────

interface ManychatTag {
  id: number;
  name: string;
}

export async function getTags(client: Client): Promise<ManychatTag[]> {
  const res = await fetch(`${MANYCHAT_BASE}/page/getTags`, {
    headers: headers(client),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Manychat getTags failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.data || [];
}

// ── Get subscribers by tag, with optional date filtering ──────

interface ManychatSubscriber {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  subscribed: string; // ISO date
  last_interaction: string;
  tags: { id: number; name: string }[];
  custom_fields?: { id: number; name: string; value: string }[];
}

interface GetSubscribersResult {
  subscribers: ManychatSubscriber[];
  total: number;
}

export async function getSubscribersByTag(
  client: Client,
  tagId: number,
  dateFrom?: string,
  dateTo?: string
): Promise<GetSubscribersResult> {
  // Manychat's getSubscribers endpoint supports has_tag filter
  // We paginate to count all matching subscribers
  let allSubscribers: ManychatSubscriber[] = [];
  let hasMore = true;
  let offset = 0;
  const limit = 100;

  while (hasMore) {
    const url = new URL(`${MANYCHAT_BASE}/subscriber/getSubscribers`);
    url.searchParams.set("has_tag_id", String(tagId));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const res = await fetch(url.toString(), { headers: headers(client) });

    if (!res.ok) {
      // If endpoint doesn't exist, try alternative approach
      if (res.status === 404 || res.status === 400) {
        return await getSubscribersByTagFallback(client, tagId, dateFrom, dateTo);
      }
      const text = await res.text();
      throw new Error(`Manychat getSubscribers failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    const subs: ManychatSubscriber[] = json.data?.subscribers || json.data || [];

    allSubscribers = allSubscribers.concat(subs);

    if (subs.length < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }

    // Safety: cap at 5000 to avoid infinite loops
    if (offset > 5000) break;
  }

  // Filter by date range if provided
  if (dateFrom || dateTo) {
    const from = dateFrom ? new Date(dateFrom).getTime() : 0;
    const to = dateTo ? new Date(dateTo + "T23:59:59Z").getTime() : Infinity;

    allSubscribers = allSubscribers.filter((sub) => {
      const subDate = new Date(sub.subscribed).getTime();
      return subDate >= from && subDate <= to;
    });
  }

  return { subscribers: allSubscribers, total: allSubscribers.length };
}

// Fallback: use page/getSubscribers endpoint
async function getSubscribersByTagFallback(
  client: Client,
  tagId: number,
  dateFrom?: string,
  dateTo?: string
): Promise<GetSubscribersResult> {
  const res = await fetch(`${MANYCHAT_BASE}/page/getSubscribers`, {
    headers: headers(client),
  });

  if (!res.ok) {
    throw new Error(`Manychat page/getSubscribers failed (${res.status})`);
  }

  const json = await res.json();
  let subs: ManychatSubscriber[] = json.data?.subscribers || json.data || [];

  // Filter by tag
  subs = subs.filter(
    (s) => s.tags && s.tags.some((t) => t.id === tagId)
  );

  // Filter by date
  if (dateFrom || dateTo) {
    const from = dateFrom ? new Date(dateFrom).getTime() : 0;
    const to = dateTo ? new Date(dateTo + "T23:59:59Z").getTime() : Infinity;
    subs = subs.filter((s) => {
      const d = new Date(s.subscribed).getTime();
      return d >= from && d <= to;
    });
  }

  return { subscribers: subs, total: subs.length };
}

// ── Count metrics for dashboard + setter breakdown ────────────

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

export async function getMetrics(
  client: Client,
  dateFrom: string,
  dateTo: string
): Promise<ManychatMetrics> {
  // 1. Get all tags to find IDs
  const tags = await getTags(client);
  const tagMap = new Map(tags.map((t) => [t.name.toLowerCase(), t.id]));

  // Check if required tags exist
  const requiredTags = [...METRIC_TAGS, ...CLIENT_SETTERS[client].map((s) => `setter_${s}`)];
  const missingTags = requiredTags.filter((t) => !tagMap.has(t));
  const tagsDetected = missingTags.length === 0;

  const setters = CLIENT_SETTERS[client];
  const setterTagIds = setters.map((s) => tagMap.get(`setter_${s}`));

  // 2. For each metric tag, get subscribers and count
  const dashboard = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
  const setterMetrics: Record<string, typeof dashboard> = {};
  for (const s of setters) {
    setterMetrics[s] = { newLeads: 0, leadsEngaged: 0, callLinksSent: 0, subLinksSent: 0 };
  }

  for (let i = 0; i < METRIC_TAGS.length; i++) {
    const tagName = METRIC_TAGS[i];
    const metricKey = METRIC_KEYS[i];
    const tagId = tagMap.get(tagName);

    if (!tagId) continue;

    try {
      const result = await getSubscribersByTag(client, tagId, dateFrom, dateTo);
      dashboard[metricKey] = result.total;

      // Count per setter
      for (let j = 0; j < setters.length; j++) {
        const setterTagId = setterTagIds[j];
        if (!setterTagId) continue;

        const setterCount = result.subscribers.filter(
          (sub) => sub.tags && sub.tags.some((t) => t.id === setterTagId)
        ).length;
        setterMetrics[setters[j]][metricKey] = setterCount;
      }
    } catch {
      // Individual metric failure — leave as 0
    }
  }

  return { dashboard, setters: setterMetrics, tagsDetected };
}
