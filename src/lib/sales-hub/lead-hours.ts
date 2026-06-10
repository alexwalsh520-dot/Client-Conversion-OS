import { getServiceSupabase } from "@/lib/supabase";
import type { SalesHubClient } from "@/lib/sales-hub/response-times";

/**
 * New-lead volume by ET hour of day (midnight→midnight), from ManyChat
 * `new_lead` tag events — the same lead definition the rest of the Sales Hub
 * uses. Grouped team-wide, per offer, and per setter.
 */

export interface LeadHourGroup {
  id: string;
  label: string;
  counts: number[]; // 24 entries, ET hour 0..23
}

export interface LeadHoursResult {
  hours: number[];
  team: LeadHourGroup;
  offers: LeadHourGroup[];
  setters: LeadHourGroup[];
}

interface TagEventRow {
  client: string;
  setter_name: string | null;
  event_at: string;
}

const CLIENTS = [
  { id: "tyson", key: "tyson_sonnek", label: "Tyson" },
  { id: "antwan", key: "antwan_rarcus", label: "Antwan Rarcus" },
];

const SETTER_LABELS: Record<string, string> = {
  amara: "Amara",
  kelechi: "Kelechi",
  kelchi: "Kelechi",
  gideon: "Gideon",
  debbie: "Debbie",
  debby: "Debbie",
  chidiebere: "Debbie",
  erin: "Erin",
};

const ET_TIMEZONE = "America/New_York";

function etParts(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    dateStr: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour || 0),
  };
}

function addDays(dateStr: string, days: number) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function emptyCounts() {
  return Array.from({ length: 24 }, () => 0);
}

export async function getLeadHours(params: {
  client: SalesHubClient;
  dateFrom: string;
  dateTo: string;
}): Promise<LeadHoursResult> {
  const { client, dateFrom, dateTo } = params;
  const sb = getServiceSupabase();
  const visibleClients = client === "all" ? CLIENTS : CLIENTS.filter((c) => c.id === client);
  const clientKeys = visibleClients.map((c) => c.key);

  // Pad the UTC query window a day each side, then filter precisely by ET date —
  // and page past PostgREST's 1000-row cap so recent leads are never dropped.
  const rows: TagEventRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await sb
      .from("manychat_tag_events")
      .select("client, setter_name, event_at")
      .in("client", clientKeys)
      .eq("tag_name", "new_lead")
      .gte("event_at", `${addDays(dateFrom, -1)}T00:00:00.000Z`)
      .lte("event_at", `${addDays(dateTo, 1)}T23:59:59.999Z`)
      .order("event_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Failed to load lead events: ${error.message}`);
    const batch = (data || []) as TagEventRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  const team: LeadHourGroup = { id: "team", label: "Team", counts: emptyCounts() };
  const offerByKey = new Map(
    visibleClients.map((c) => [c.key, { id: c.id, label: c.label, counts: emptyCounts() }]),
  );
  const setterByKey = new Map<string, LeadHourGroup>();

  for (const row of rows) {
    const { dateStr, hour } = etParts(row.event_at);
    if (dateStr < dateFrom || dateStr > dateTo) continue;

    team.counts[hour] += 1;
    const offer = offerByKey.get(row.client);
    if (offer) offer.counts[hour] += 1;

    const setterKey = row.setter_name?.trim().toLowerCase() || "unassigned";
    let setter = setterByKey.get(setterKey);
    if (!setter) {
      setter = {
        id: setterKey,
        label:
          setterKey === "unassigned"
            ? "Unassigned"
            : SETTER_LABELS[setterKey] || setterKey.charAt(0).toUpperCase() + setterKey.slice(1),
        counts: emptyCounts(),
      };
      setterByKey.set(setterKey, setter);
    }
    setter.counts[hour] += 1;
  }

  return {
    hours: Array.from({ length: 24 }, (_, i) => i),
    team,
    offers: [...offerByKey.values()],
    setters: [...setterByKey.values()].sort((a, b) => a.label.localeCompare(b.label)),
  };
}
