// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — the sales-board computation. One call answers the whole
// /sales-dashboard page from the engine's OWN warehouse (metrics_leads /
// metrics_lead_events built from ghl_appointments + sales_tracker_rows +
// manychat_tag_events + dm_conversation_messages) — no Sales Hub sheet API.
//
// Vocabulary (sheet-compatible, activity view — events in the ET window):
//   booked    = booking events made in the window (onboarding excluded from
//               top-line stats; tracked as its own call type)
//   taken     = show events (sheet Call Taken = Yes, manual overrides win)
//   wins      = close events (sheet outcome WIN)
//   losses    = taken − wins
//   upcoming  = booked calls scheduled inside the window, still in the future
//   show_rate = taken ÷ (taken + no-shows)   close_rate = wins ÷ taken
//   aov       = cash ÷ wins
//
// Call type of an outcome = the call type of the lead's most recent sales
// booking at/before it; unknown falls back to "dm" (the dominant funnel).
// Lead type uses the immutable origin source.
//
// Setters: new leads from manychat_tag_events (tag_name='new_lead', setter
// normalized via normalizeSetterKey). The "ai" setter counts DM-thread leads
// (dm_conversation_messages) that no ManyChat new_lead tag ever claimed —
// its basis string says exactly that. Response times reuse
// src/lib/sales-hub/response-times.ts, which reads the same warehouse.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { etDay, shiftDay, type DayRange } from "@/lib/ads-v2/time";
import { ACTIVE_CREATORS, creatorKeyFromText } from "@/lib/creators";
import { normalizeSetterKey } from "@/lib/ghl-dm-sync";
import { getSetterLabelMap } from "@/lib/registry";
import { getResponseTimeMetrics } from "@/lib/sales-hub/response-times";
import { REPS } from "./team";
import { chunk, safeFetchAllRows } from "./db";
import { CALL_TYPES, LEAD_TYPES, type CallType, type LeadType } from "./types";

const ACTIVE_CLIENT_KEYS = ACTIVE_CREATORS.map((c) => c.key) as string[];
const CLIENT_LABELS: Record<string, string> = Object.fromEntries(
  ACTIVE_CREATORS.map((c) => [c.key, c.name]),
);

// ── Response shape ────────────────────────────────────────────────────────

export interface SalesStatSet {
  booked: number;
  taken: number;
  wins: number;
  losses: number;
  no_shows: number;
  upcoming: number;
  cash_cents: number;
  /** cash ÷ wins; null when no wins. */
  aov_cents: number | null;
  /** wins ÷ taken; null when nothing taken. 0..1. */
  close_rate: number | null;
  /** taken ÷ (taken + no-shows); null when neither. 0..1. */
  show_rate: number | null;
}

export interface SalesBoardClient {
  client_key: string;
  label: string;
  stats: SalesStatSet;
  by_call_type: Record<CallType, SalesStatSet>;
}

export interface SalesBoardCloser {
  rep_key: string;
  name: string;
  stats: SalesStatSet;
  by_call_type: Record<CallType, SalesStatSet>;
}

export interface SalesBoardSetter {
  setter_key: string;
  label: string;
  new_leads: number;
  booked: number;
  /** booked ÷ new_leads; null when no new leads. 0..1. */
  booking_rate: number | null;
  /** Origin-source distribution of this setter's new leads. */
  lead_sources: Record<string, number>;
  /** Call-type distribution of this setter's booked calls. */
  booking_sources: Record<string, number>;
  /** How the row is computed, when it isn't a plain ManyChat setter. */
  basis?: string;
}

export interface SalesBoardRtGroup {
  id: string;
  label: string;
  average_seconds: number | null;
  median_seconds: number | null;
  sample_count: number;
  fastest_seconds: number | null;
  slowest_seconds: number | null;
  missed_count: number;
}

export interface SalesBoardResponse {
  range: DayRange;
  /** Applied client filter as a comma-joined list, or null = all clients. */
  client: string | null;
  clients: SalesBoardClient[];
  /** Team-level totals across the selected clients. */
  team: {
    stats: SalesStatSet;
    by_call_type: Record<CallType, SalesStatSet>;
  };
  closers: SalesBoardCloser[];
  /** The stat set per origin lead type (Ad / Organic / Follower / Misc). */
  lead_types: Record<LeadType, SalesStatSet>;
  setters: SalesBoardSetter[];
  response_times: {
    team: SalesBoardRtGroup | null;
    setters: SalesBoardRtGroup[];
    miss_threshold_seconds: number;
    error: string | null;
  };
  /** Per-client distributions for the client expansion panels. */
  sources: Record<
    string,
    {
      /** Origin-source counts of leads acquired in the window. */
      lead_origins: Record<string, number>;
      /** Call-type counts of bookings made in the window (onboarding included). */
      booking_call_types: Record<string, number>;
    }
  >;
  migration_pending: boolean;
  generated_at: string;
}

// ── Internals ─────────────────────────────────────────────────────────────

type Counts = {
  booked: number;
  taken: number;
  wins: number;
  no_shows: number;
  upcoming: number;
  cash: number;
};

const newCounts = (): Counts => ({ booked: 0, taken: 0, wins: 0, no_shows: 0, upcoming: 0, cash: 0 });

function bump(map: Map<string, Counts>, key: string, field: keyof Counts, amount = 1): void {
  let c = map.get(key);
  if (!c) map.set(key, (c = newCounts()));
  c[field] += amount;
}

function toStats(c: Counts | undefined): SalesStatSet {
  const b = c ?? newCounts();
  const losses = Math.max(0, b.taken - b.wins);
  const showDenom = b.taken + b.no_shows;
  return {
    booked: b.booked,
    taken: b.taken,
    wins: b.wins,
    losses,
    no_shows: b.no_shows,
    upcoming: b.upcoming,
    cash_cents: b.cash,
    aov_cents: b.wins > 0 ? Math.round(b.cash / b.wins) : null,
    close_rate: b.taken > 0 ? b.wins / b.taken : null,
    show_rate: showDenom > 0 ? b.taken / showDenom : null,
  };
}

function foldType(v: string | null | undefined): LeadType {
  if (v === "ad" || v === "organic" || v === "follower") return v;
  return "misc";
}

function isCallType(v: unknown): v is CallType {
  return v === "dm" || v === "onboarding" || v === "lm_outbound" || v === "outbound";
}

function callTypeFromChannel(channel: string | null): CallType {
  if (channel === "dm") return "dm";
  if (String(channel || "").startsWith("lm_outbound")) return "lm_outbound";
  return "outbound";
}

function normalizeClientList(v: string | readonly string[] | null | undefined): string[] {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const seen = new Set<string>();
  for (const p of parts as string[]) {
    const t = p.trim().toLowerCase();
    if (t && t !== "all" && ACTIVE_CLIENT_KEYS.includes(t)) seen.add(t);
  }
  return [...seen];
}

function rtGroup(g: {
  id: string;
  label: string;
  averageSeconds: number | null;
  medianSeconds: number | null;
  sampleCount: number;
  fastestSeconds: number | null;
  slowestSeconds: number | null;
  missedCount: number;
}): SalesBoardRtGroup {
  return {
    id: g.id,
    label: g.label,
    average_seconds: g.averageSeconds,
    median_seconds: g.medianSeconds,
    sample_count: g.sampleCount,
    fastest_seconds: g.fastestSeconds,
    slowest_seconds: g.slowestSeconds,
    missed_count: g.missedCount,
  };
}

interface LeadRow {
  client_key: string;
  lead_key: string;
  acquired_et_day: string;
  origin_source: string;
  manychat_subscriber_id: string | null;
}

interface EventRow {
  id: string;
  client_key: string;
  lead_key: string | null;
  event_type: string;
  channel: string | null;
  rep_key: string | null;
  occurred_at: string;
  et_day: string;
  amount_cents: number | null;
  source: string;
  metadata: {
    call_type?: string;
    side?: string;
    start_time?: string | null;
    start_et_day?: string | null;
  } | null;
}

// ── The computation ───────────────────────────────────────────────────────

export async function computeSalesBoard(params: {
  range: DayRange;
  client?: string | readonly string[] | null;
}): Promise<SalesBoardResponse> {
  const db = getServiceSupabase();
  const { range } = params;
  const clientFilters = normalizeClientList(params.client);
  const clients = clientFilters.length ? clientFilters : [...ACTIVE_CLIENT_KEYS];
  const nowIso = new Date().toISOString();

  let migrationPending = false;

  // 1) Ledger rows (identity + origin context; also the new-lead origins).
  const leadsRes = await safeFetchAllRows<LeadRow>((from, to) =>
    db
      .schema("warehouse")
      .from("metrics_leads")
      .select("client_key, lead_key, acquired_et_day, origin_source, manychat_subscriber_id")
      .in("client_key", clients)
      .lte("acquired_et_day", range.to)
      .order("lead_key", { ascending: true })
      .range(from, to),
  );
  if (leadsRes.missing) migrationPending = true;
  const leadByKey = new Map<string, LeadRow>();
  for (const l of leadsRes.rows) leadByKey.set(`${l.client_key}|${l.lead_key}`, l);

  // 2) Events from the window start (outcomes + bookings made in-window)…
  const eventsRes = await safeFetchAllRows<EventRow>((from, to) =>
    db
      .schema("warehouse")
      .from("metrics_lead_events")
      .select(
        "id, client_key, lead_key, event_type, channel, rep_key, occurred_at, et_day, amount_cents, source, metadata",
      )
      .in("client_key", clients)
      .gte("et_day", range.from)
      .order("et_day", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (eventsRes.missing) migrationPending = true;

  // …plus bookings whose CALL falls in the window but were made earlier
  // (upcoming counts) and bookings made before the window whose context an
  // in-window outcome may need.
  const dueRes = await safeFetchAllRows<EventRow>((from, to) =>
    db
      .schema("warehouse")
      .from("metrics_lead_events")
      .select(
        "id, client_key, lead_key, event_type, channel, rep_key, occurred_at, et_day, amount_cents, source, metadata",
      )
      .in("client_key", clients)
      .eq("event_type", "booking")
      .gte("metadata->>start_et_day", range.from)
      .lte("metadata->>start_et_day", range.to)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const eventById = new Map<string, EventRow>();
  for (const e of eventsRes.rows) eventById.set(e.id, e);
  for (const e of dueRes.rows) eventById.set(e.id, e);
  const events = [...eventById.values()];

  const callTypeOf = (e: EventRow): CallType => {
    const m = e.metadata?.call_type;
    if (isCallType(m)) return m;
    if (e.metadata?.side === "onboarding") return "onboarding";
    return callTypeFromChannel(e.channel);
  };

  // Sales-booking context per lead (call type + rep at time t).
  const bookingsByLead = new Map<string, Array<{ at: string; callType: CallType; rep: string | null }>>();
  for (const e of events) {
    if (e.event_type !== "booking" || !e.lead_key) continue;
    const ct = callTypeOf(e);
    if (ct === "onboarding") continue;
    const k = `${e.client_key}|${e.lead_key}`;
    const list = bookingsByLead.get(k) ?? [];
    list.push({ at: e.occurred_at, callType: ct, rep: e.rep_key });
    bookingsByLead.set(k, list);
  }
  for (const list of bookingsByLead.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  const bookingContextAt = (
    clientKey: string,
    leadKey: string | null,
    at: string,
  ): { callType: CallType | null; rep: string | null } => {
    if (!leadKey) return { callType: null, rep: null };
    const list = bookingsByLead.get(`${clientKey}|${leadKey}`);
    if (!list || list.length === 0) return { callType: null, rep: null };
    let picked = list[0];
    for (const b of list) {
      if (b.at <= at) picked = b;
      else break;
    }
    return { callType: picked.callType, rep: picked.rep };
  };

  const leadTypeOf = (clientKey: string, leadKey: string | null): LeadType | null => {
    if (!leadKey) return null;
    const lead = leadByKey.get(`${clientKey}|${leadKey}`);
    return lead ? foldType(lead.origin_source) : null;
  };

  const inWindow = (day: string) => day >= range.from && day <= range.to;

  // ── Aggregation buckets ────────────────────────────────────────────────
  // Keys: "t" (team), "c|<client>", "r|<rep>", "lt|<leadType>",
  // "ct|<callType>", "cct|<client>|<callType>", "rct|<rep>|<callType>".
  const agg = new Map<string, Counts>();
  const add = (
    field: keyof Counts,
    dims: { client: string; rep: string | null; callType: CallType; leadType: LeadType | null },
    amount = 1,
  ) => {
    const onboarding = dims.callType === "onboarding";
    // Onboarding calls only ever count inside their own call-type rows.
    if (!onboarding) {
      bump(agg, "t", field, amount);
      bump(agg, `c|${dims.client}`, field, amount);
      if (dims.rep) bump(agg, `r|${dims.rep}`, field, amount);
      if (dims.leadType) bump(agg, `lt|${dims.leadType}`, field, amount);
    }
    bump(agg, `ct|${dims.callType}`, field, amount);
    bump(agg, `cct|${dims.client}|${dims.callType}`, field, amount);
    if (dims.rep) bump(agg, `rct|${dims.rep}|${dims.callType}`, field, amount);
  };

  // Per-client booking call-type distribution (the sources panel).
  const bookingCallTypes = new Map<string, Record<string, number>>();

  for (const e of events) {
    if (e.event_type !== "booking") continue;
    const ct = callTypeOf(e);
    const dims = {
      client: e.client_key,
      rep: e.rep_key,
      callType: ct,
      leadType: leadTypeOf(e.client_key, e.lead_key),
    };
    if (inWindow(e.et_day)) {
      add("booked", dims);
      const dist = bookingCallTypes.get(e.client_key) ?? {};
      dist[ct] = (dist[ct] ?? 0) + 1;
      bookingCallTypes.set(e.client_key, dist);
    }
    const startDay = e.metadata?.start_et_day ?? null;
    const startTime = e.metadata?.start_time ?? null;
    if (startDay && startTime && startTime > nowIso && inWindow(startDay)) {
      add("upcoming", dims);
    }
  }

  // Outcome de-duplication: a manual entry about the same lead+day+type as a
  // sheet row is the SAME fact corrected (mirrors compute.ts).
  const outcomeEvents: EventRow[] = [];
  {
    const chosen = new Map<string, EventRow>();
    let anon = 0;
    for (const e of events) {
      if (!["show", "no_show", "close", "payment"].includes(e.event_type)) continue;
      if (!inWindow(e.et_day)) continue;
      const key = e.lead_key
        ? `${e.client_key}|${e.lead_key}|${e.event_type}|${e.et_day}`
        : `anon:${anon++}:${e.id}`;
      const cur = chosen.get(key);
      if (!cur) chosen.set(key, e);
      else if (e.source === "manual" && cur.source !== "manual") chosen.set(key, e);
    }
    outcomeEvents.push(...chosen.values());
  }

  for (const e of outcomeEvents) {
    const ctx = bookingContextAt(e.client_key, e.lead_key, e.occurred_at);
    const dims = {
      client: e.client_key,
      rep: e.rep_key ?? ctx.rep,
      callType: ctx.callType ?? "dm",
      leadType: leadTypeOf(e.client_key, e.lead_key),
    };
    switch (e.event_type) {
      case "show":
        add("taken", dims);
        break;
      case "no_show":
        add("no_shows", dims);
        break;
      case "close":
        add("wins", dims);
        break;
      case "payment": {
        const cents = Number(e.amount_cents ?? 0);
        if (cents > 0) add("cash", dims, cents);
        break;
      }
    }
  }

  // ── Assemble clients / closers / lead types ────────────────────────────
  const byCallType = (prefix: string): Record<CallType, SalesStatSet> =>
    Object.fromEntries(
      CALL_TYPES.map((ct) => [ct, toStats(agg.get(`${prefix}${ct}`))]),
    ) as Record<CallType, SalesStatSet>;

  const clientBlocks: SalesBoardClient[] = clients.map((key) => ({
    client_key: key,
    label: CLIENT_LABELS[key] ?? key,
    stats: toStats(agg.get(`c|${key}`)),
    by_call_type: byCallType(`cct|${key}|`),
  }));

  const closerBlocks: SalesBoardCloser[] = REPS.map((rep) => ({
    rep_key: rep.key,
    name: rep.name,
    stats: toStats(agg.get(`r|${rep.key}`)),
    by_call_type: byCallType(`rct|${rep.key}|`),
  }))
    .filter((c) => c.stats.booked > 0 || c.stats.taken > 0 || c.stats.cash_cents > 0)
    .sort((a, b) => b.stats.cash_cents - a.stats.cash_cents);

  const leadTypeBlocks = Object.fromEntries(
    LEAD_TYPES.map((t) => [t, toStats(agg.get(`lt|${t}`))]),
  ) as Record<LeadType, SalesStatSet>;

  // ── Sources per client ─────────────────────────────────────────────────
  const sources: SalesBoardResponse["sources"] = {};
  for (const key of clients) {
    sources[key] = {
      lead_origins: {},
      booking_call_types: bookingCallTypes.get(key) ?? {},
    };
  }
  for (const l of leadsRes.rows) {
    if (!inWindow(l.acquired_et_day)) continue;
    const s = sources[l.client_key];
    if (!s) continue;
    const t = foldType(l.origin_source);
    s.lead_origins[t] = (s.lead_origins[t] ?? 0) + 1;
  }

  // ── Setters ────────────────────────────────────────────────────────────
  const setters = await computeSetters(db, range, clients, leadsRes.rows, events, callTypeOf);

  // ── Response times (the owner's own warehouse, wrapped) ────────────────
  let responseTimes: SalesBoardResponse["response_times"] = {
    team: null,
    setters: [],
    miss_threshold_seconds: 300,
    error: null,
  };
  try {
    const rt = await getResponseTimeMetrics({
      client: clients.length === 1 ? clients[0] : "all",
      dateFrom: range.from,
      dateTo: range.to,
    });
    responseTimes = {
      team: rtGroup(rt.summary),
      setters: rt.setters.map(rtGroup),
      miss_threshold_seconds: rt.missThresholdSeconds,
      error: null,
    };
  } catch (err) {
    responseTimes.error = err instanceof Error ? err.message : "response times unavailable";
  }

  return {
    range,
    client: clientFilters.length ? clientFilters.join(",") : null,
    clients: clientBlocks,
    team: { stats: toStats(agg.get("t")), by_call_type: byCallType("ct|") },
    closers: closerBlocks,
    lead_types: leadTypeBlocks,
    setters,
    response_times: responseTimes,
    sources,
    migration_pending: migrationPending,
    generated_at: new Date().toISOString(),
  };
}

// ── Setter computation ────────────────────────────────────────────────────

async function computeSetters(
  db: ReturnType<typeof getServiceSupabase>,
  range: DayRange,
  clients: string[],
  leadRows: LeadRow[],
  events: EventRow[],
  callTypeOf: (e: EventRow) => CallType,
): Promise<SalesBoardSetter[]> {
  // Over-fetch a day each side and filter by ET day (UTC ≠ ET).
  const fetchFromIso = `${shiftDay(range.from, -1)}T00:00:00Z`;
  const fetchToIso = `${shiftDay(range.to, 2)}T00:00:00Z`;

  interface NewLeadRow {
    subscriber_id: string;
    setter_name: string | null;
    client: string;
    event_at: string;
  }

  // 1) New-lead tag events in the window (per-setter new-lead counts).
  const { rows: windowNewLeads } = await safeFetchAllRows<NewLeadRow>((from, to) =>
    db
      .from("manychat_tag_events")
      .select("subscriber_id, setter_name, client, event_at")
      .eq("tag_name", "new_lead")
      .gte("event_at", fetchFromIso)
      .lt("event_at", fetchToIso)
      .order("event_at", { ascending: true })
      .range(from, to),
  );

  const inWindow = (iso: string) => {
    const d = etDay(iso);
    return d >= range.from && d <= range.to;
  };

  // Lead identity: mc subscriber id -> ledger lead (for origin sources).
  const leadByMc = new Map<string, LeadRow>();
  const leadRowByKey = new Map<string, LeadRow>();
  for (const l of leadRows) {
    leadRowByKey.set(`${l.client_key}|${l.lead_key}`, l);
    const mc = l.manychat_subscriber_id || (l.lead_key.startsWith("mc:") ? l.lead_key.slice(3) : null);
    if (mc && !leadByMc.has(mc)) leadByMc.set(mc, l);
  }

  interface SetterAcc {
    key: string;
    new_leads: number;
    booked: number;
    lead_sources: Record<string, number>;
    booking_sources: Record<string, number>;
  }
  const accs = new Map<string, SetterAcc>();
  const acc = (key: string): SetterAcc => {
    let a = accs.get(key);
    if (!a) accs.set(key, (a = { key, new_leads: 0, booked: 0, lead_sources: {}, booking_sources: {} }));
    return a;
  };

  const originOf = (mc: string | null): string => {
    const lead = mc ? leadByMc.get(mc) : null;
    if (!lead) return "unknown";
    return foldType(lead.origin_source);
  };

  // Acquiring setter per subscriber = the EARLIEST new_lead tag's setter.
  const acquiringSetterByMc = new Map<string, string | null>();
  const seenNewLeadMc = new Set<string>();
  for (const r of windowNewLeads) {
    if (!r.subscriber_id) continue;
    const client = creatorKeyFromText(r.client);
    if (!client || !clients.includes(client)) continue;
    seenNewLeadMc.add(r.subscriber_id);
    const setterKey = normalizeSetterKey(r.setter_name) || "unassigned";
    if (!acquiringSetterByMc.has(r.subscriber_id)) {
      acquiringSetterByMc.set(r.subscriber_id, setterKey === "unassigned" ? null : setterKey);
    }
    if (!inWindow(r.event_at)) continue;
    const a = acc(setterKey);
    a.new_leads += 1;
    const origin = originOf(r.subscriber_id);
    a.lead_sources[origin] = (a.lead_sources[origin] ?? 0) + 1;
  }

  // 2) The "Ai" setter: DM-thread leads (we messaged first, recorded in
  //    dm_conversation_messages) that no ManyChat new_lead tag ever claimed.
  const aiCandidates = events.filter(
    (e) =>
      e.event_type === "lead_created" &&
      e.source === "dm_conversation_messages" &&
      e.et_day >= range.from &&
      e.et_day <= range.to &&
      e.lead_key,
  );
  // Check "ever" for the mc-bridged candidates that this window's tag fetch
  // did not already answer.
  const mcToCheck = [
    ...new Set(
      aiCandidates
        .map((e) => (e.lead_key!.startsWith("mc:") ? e.lead_key!.slice(3) : null))
        .filter((v): v is string => Boolean(v && !seenNewLeadMc.has(v))),
    ),
  ];
  const taggedEver = new Set<string>();
  for (const ids of chunk(mcToCheck, 200)) {
    const { rows } = await safeFetchAllRows<{ subscriber_id: string }>((from, to) =>
      db
        .from("manychat_tag_events")
        .select("subscriber_id")
        .eq("tag_name", "new_lead")
        .in("subscriber_id", ids)
        .order("subscriber_id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) if (r.subscriber_id) taggedEver.add(r.subscriber_id);
  }
  const isAiLeadKey = (leadKey: string): boolean => {
    if (leadKey.startsWith("ig:")) return true;
    const mc = leadKey.startsWith("mc:") ? leadKey.slice(3) : null;
    return Boolean(mc && !seenNewLeadMc.has(mc) && !taggedEver.has(mc));
  };
  {
    const counted = new Set<string>();
    for (const e of aiCandidates) {
      const leadKey = e.lead_key!;
      if (!isAiLeadKey(leadKey)) continue;
      const dedupe = `${e.client_key}|${leadKey}`;
      if (counted.has(dedupe)) continue;
      counted.add(dedupe);
      const a = acc("ai");
      a.new_leads += 1;
      const lead = leadRowByKey.get(`${e.client_key}|${leadKey}`) ?? null;
      const origin = lead ? foldType(lead.origin_source) : "unknown";
      a.lead_sources[origin] = (a.lead_sources[origin] ?? 0) + 1;
    }
  }

  // 3) Booked calls per setter: sales bookings in the window, attributed to
  //    the lead's acquiring setter.
  const bookingEvents = events.filter(
    (e) =>
      e.event_type === "booking" &&
      e.et_day >= range.from &&
      e.et_day <= range.to &&
      callTypeOf(e) !== "onboarding",
  );
  // Acquiring setters for booked leads whose new_lead tag predates the window.
  const bookedMcToResolve = [
    ...new Set(
      bookingEvents
        .map((e) => (e.lead_key?.startsWith("mc:") ? e.lead_key.slice(3) : null))
        .filter((v): v is string => Boolean(v && !acquiringSetterByMc.has(v!))),
    ),
  ];
  for (const ids of chunk(bookedMcToResolve, 200)) {
    const { rows } = await safeFetchAllRows<NewLeadRow>((from, to) =>
      db
        .from("manychat_tag_events")
        .select("subscriber_id, setter_name, client, event_at")
        .eq("tag_name", "new_lead")
        .in("subscriber_id", ids)
        .order("event_at", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      if (!r.subscriber_id) continue;
      seenNewLeadMc.add(r.subscriber_id);
      if (!acquiringSetterByMc.has(r.subscriber_id)) {
        const setterKey = normalizeSetterKey(r.setter_name);
        acquiringSetterByMc.set(r.subscriber_id, setterKey || null);
      }
    }
  }
  for (const e of bookingEvents) {
    if (!e.lead_key) continue; // unattributable booking — no setter credit
    const mc = e.lead_key.startsWith("mc:") ? e.lead_key.slice(3) : null;
    let setterKey: string;
    if (mc && (seenNewLeadMc.has(mc) || taggedEver.has(mc))) {
      setterKey = acquiringSetterByMc.get(mc) || "unassigned";
    } else if (isAiLeadKey(e.lead_key)) {
      setterKey = "ai";
    } else {
      setterKey = "unassigned";
    }
    const a = acc(setterKey);
    a.booked += 1;
    const ct = callTypeOf(e);
    a.booking_sources[ct] = (a.booking_sources[ct] ?? 0) + 1;
  }

  // 4) Labels + assembly.
  let labelMap: Record<string, string> = {};
  try {
    labelMap = await getSetterLabelMap();
  } catch {
    // fall through to capitalized keys
  }
  const labelFor = (key: string): string => {
    if (key === "ai") return "Ai";
    if (key === "unassigned") return "Unassigned";
    return labelMap[key] || key.charAt(0).toUpperCase() + key.slice(1);
  };

  return [...accs.values()]
    .map((a) => ({
      setter_key: a.key,
      label: labelFor(a.key),
      new_leads: a.new_leads,
      booked: a.booked,
      booking_rate: a.new_leads > 0 ? a.booked / a.new_leads : null,
      lead_sources: a.lead_sources,
      booking_sources: a.booking_sources,
      ...(a.key === "ai"
        ? {
            basis:
              "DM threads we messaged first (dm_conversation_messages) with no ManyChat setter tag — treated as the AI setter's leads.",
          }
        : a.key === "unassigned"
          ? { basis: "ManyChat new_lead events that carried no setter name." }
          : {}),
    }))
    .sort((a, b) => b.new_leads - a.new_leads || b.booked - a.booked);
}
