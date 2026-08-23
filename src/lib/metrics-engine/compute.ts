// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — computation. Reads the ledger + event log written by
// build.ts (plus ad spend from ads_meta_insights_daily) and answers every
// dashboard metric with the two mandated views:
//
//   activity — events whose ET day falls in the selected window
//   cohort   — leads ACQUIRED in the window, counting their downstream
//              events whenever they occur
//
// Denominator rules (signed):
//   show rate  = shows ÷ booked calls DUE in the window (excluding upcoming)
//   close rate = closes ÷ shows
//   aov        = cash collected ÷ closes
//   booking_rate_new_leads = cohort bookings ÷ cohort leads
//
// A cell where a dimension does not apply is null, never 0. Metrics with no
// data source yet (pickup rates, script adherence, pre-call message
// adherence) are returned defined:false with a written reason so dashboards
// render dashes.
//
// Lead-type lens: 'origin' uses the immutable first categorization;
// 'conversion' uses the most recent categorization at/before each event
// (walked over the fetched categorization events; for history older than
// the fetch, the lead's stored conversion snapshot / origin stands in).
// 'unclassified' folds into 'misc' for display.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { todayEt } from "@/lib/ads-v2/time";
import { ACTIVE_CREATORS } from "@/lib/creators";
import { creatorCurrency, loadUsdRateMap, convertCentsToUsd } from "@/lib/fx/rates";
import { REPS } from "./team";
import { safeFetchAllRows } from "./db";
import {
  CHANNELS,
  LEAD_TYPES,
  type Channel,
  type ComputeParams,
  type LeadType,
  type MetricBlock,
  type MetricCell,
  type MetricsSummary,
  type MetricUnit,
} from "./types";

const ACTIVE_CLIENT_KEYS = ACTIVE_CREATORS.map((c) => c.key) as string[];

// ── Internals ─────────────────────────────────────────────────────────────

type Counts = Record<string, number>;

interface Dims {
  client: string | null;
  leadType: LeadType | null;
  rep: string | null;
  channel: Channel | null;
}

class Agg {
  total: Counts = {};
  byClient = new Map<string, Counts>();
  byType = new Map<string, Counts>();
  byRep = new Map<string, Counts>();
  byRepType = new Map<string, Counts>();
  byChannel = new Map<string, Counts>();

  add(field: string, dims: Dims, amount = 1): void {
    bump(this.total, field, amount);
    if (dims.client) bump(mapGet(this.byClient, dims.client), field, amount);
    if (dims.leadType) bump(mapGet(this.byType, dims.leadType), field, amount);
    if (dims.rep) bump(mapGet(this.byRep, dims.rep), field, amount);
    if (dims.rep && dims.leadType) {
      bump(mapGet(this.byRepType, `${dims.rep}|${dims.leadType}`), field, amount);
    }
    if (dims.channel) bump(mapGet(this.byChannel, dims.channel), field, amount);
  }
}

function bump(counts: Counts, field: string, amount: number): void {
  counts[field] = (counts[field] ?? 0) + amount;
}

function mapGet(map: Map<string, Counts>, key: string): Counts {
  let c = map.get(key);
  if (!c) map.set(key, (c = {}));
  return c;
}

function div(n: number | undefined, d: number | undefined): number | null {
  const nn = n ?? 0;
  const dd = d ?? 0;
  return dd > 0 ? nn / dd : null;
}

function foldType(v: string | null | undefined): LeadType {
  if (v === "ad" || v === "organic" || v === "follower") return v;
  return "misc";
}

/** Normalize a filter param — one key, "a,b" comma list, or an array — into
    a de-duplicated key list. Empty / "all" entries mean "no filter". */
function normalizeFilterList(v: string | readonly string[] | null | undefined): string[] {
  const parts = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  const seen = new Set<string>();
  for (const p of parts as string[]) {
    const t = p.trim().toLowerCase();
    if (t && t !== "all") seen.add(t);
  }
  return [...seen];
}

interface LeadRow {
  client_key: string;
  lead_key: string;
  acquired_et_day: string;
  acquired_at: string;
  origin_source: string;
  conversion_source: string | null;
  conversion_source_at: string | null;
  lm_optin_at: string | null;
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
    source_class?: string;
    keyword?: string | null;
    appointment_id?: string;
    start_time?: string | null;
    start_et_day?: string | null;
    call_type?: string;
  } | null;
}

// ── The compute pass ─────────────────────────────────────────────────────

export async function computeMetrics(params: ComputeParams): Promise<MetricsSummary> {
  const db = getServiceSupabase();
  const { range, lens } = params;
  // Multi-select filters: each param accepts one key, a comma-separated
  // list, or an array. Unknown keys are dropped; an empty result = no filter.
  const clientFilters = normalizeFilterList(params.client).filter((k) =>
    ACTIVE_CLIENT_KEYS.includes(k),
  );
  const repFilters = normalizeFilterList(params.rep).filter((k) => REPS.some((r) => r.key === k));
  const repSet = new Set(repFilters);
  const repFiltered = repSet.size > 0 && repSet.size < REPS.length;
  const clients = clientFilters.length ? clientFilters : [...ACTIVE_CLIENT_KEYS];
  const today = todayEt();
  const nowIso = new Date().toISOString();

  let migrationPending = false;

  // 1) Ledger rows (acquired at/before the window end — the cohort plus the
  //    identity context for older leads' downstream events).
  const leadsRes = await safeFetchAllRows<LeadRow>((from, to) =>
    db
      .schema("warehouse")
      .from("metrics_leads")
      .select(
        "client_key, lead_key, acquired_et_day, acquired_at, origin_source, conversion_source, conversion_source_at, lm_optin_at",
      )
      .in("client_key", clients)
      .lte("acquired_et_day", range.to)
      .order("lead_key", { ascending: true })
      .range(from, to),
  );
  if (leadsRes.missing) migrationPending = true;
  const leadByKey = new Map<string, LeadRow>();
  for (const l of leadsRes.rows) leadByKey.set(`${l.client_key}|${l.lead_key}`, l);

  // 2) Events from the window start onward. A cohort lead's downstream
  //    events all fall at/after its acquisition (>= range.from), so this one
  //    fetch serves both views.
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

  // 2b) Bookings whose CALL is due in the window but which were made before
  //     the window started (needed for the activity show-rate denominator).
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

  // 3) Ad spend (activity-only; USD cents — AUD accounts converted per-day).
  let spendMissing = false;
  const spend = new Map<string, { spend: number; impressions: number; clicks: number }>();
  {
    const currencies = clients.map((c) => creatorCurrency(c));
    let rateMap: Awaited<ReturnType<typeof loadUsdRateMap>> | null = null;
    try {
      rateMap = await loadUsdRateMap(db, currencies, range.from, range.to);
    } catch {
      rateMap = null;
    }
    const res = await safeFetchAllRows<{
      client_key: string;
      date: string;
      spend_cents: number | null;
      impressions: number | null;
      link_clicks: number | null;
    }>((from, to) =>
      db
        .from("ads_meta_insights_daily")
        .select("client_key, date, spend_cents, impressions, link_clicks")
        .in("client_key", clients)
        .eq("raw_payload->>reporting_timezone", "America/New_York")
        .gte("date", range.from)
        .lte("date", range.to)
        .order("date", { ascending: true })
        .range(from, to),
    );
    spendMissing = res.missing;
    for (const r of res.rows) {
      const cur = spend.get(r.client_key) ?? { spend: 0, impressions: 0, clicks: 0 };
      const currency = creatorCurrency(r.client_key);
      const cents = Number(r.spend_cents ?? 0);
      cur.spend += rateMap ? convertCentsToUsd(cents, currency, r.date, rateMap) : cents;
      cur.impressions += Number(r.impressions ?? 0);
      cur.clicks += Number(r.link_clicks ?? 0);
      spend.set(r.client_key, cur);
    }
  }

  // ── Per-lead derived context ───────────────────────────────────────────

  // Categorization history per lead (for the conversion lens).
  const catsByLead = new Map<string, Array<{ at: string; type: LeadType }>>();
  for (const e of events) {
    if (e.event_type !== "categorization" || !e.lead_key) continue;
    const k = `${e.client_key}|${e.lead_key}`;
    const list = catsByLead.get(k) ?? [];
    list.push({ at: e.occurred_at, type: foldType(e.metadata?.source_class) });
    catsByLead.set(k, list);
  }
  for (const list of catsByLead.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  const leadTypeAt = (clientKey: string, leadKey: string | null, at: string): LeadType | null => {
    if (!leadKey) return null;
    const lead = leadByKey.get(`${clientKey}|${leadKey}`);
    if (!lead) return null;
    if (lens === "origin") return foldType(lead.origin_source);
    const list = catsByLead.get(`${clientKey}|${leadKey}`);
    let picked: LeadType | null = null;
    if (list) {
      for (const c of list) {
        if (c.at <= at) picked = c.type;
        else break;
      }
    }
    if (picked) return picked;
    // History older than the fetch: the stored snapshot stands in.
    if (lead.conversion_source && lead.conversion_source_at && lead.conversion_source_at <= at) {
      return foldType(lead.conversion_source);
    }
    return foldType(lead.origin_source);
  };

  // The channel a lead's outcomes belong to = the channel of their most
  // recent booking at/before the outcome.
  const bookingsByLead = new Map<string, Array<{ at: string; channel: Channel | null; rep: string | null }>>();
  for (const e of events) {
    if (e.event_type !== "booking" || !e.lead_key) continue;
    // Onboarding calls never provide the sales context for an outcome.
    if (e.metadata?.call_type === "onboarding") continue;
    const k = `${e.client_key}|${e.lead_key}`;
    const list = bookingsByLead.get(k) ?? [];
    list.push({ at: e.occurred_at, channel: (e.channel as Channel) ?? null, rep: e.rep_key });
    bookingsByLead.set(k, list);
  }
  for (const list of bookingsByLead.values()) list.sort((a, b) => a.at.localeCompare(b.at));

  const bookingContextAt = (
    clientKey: string,
    leadKey: string | null,
    at: string,
  ): { channel: Channel | null; rep: string | null } => {
    if (!leadKey) return { channel: null, rep: null };
    const list = bookingsByLead.get(`${clientKey}|${leadKey}`);
    if (!list || list.length === 0) return { channel: null, rep: null };
    let picked = list[0];
    for (const b of list) {
      if (b.at <= at) picked = b;
      else break;
    }
    return { channel: picked.channel, rep: picked.rep };
  };

  const inWindow = (day: string) => day >= range.from && day <= range.to;
  const isCohortLead = (clientKey: string, leadKey: string | null): boolean => {
    if (!leadKey) return false;
    const lead = leadByKey.get(`${clientKey}|${leadKey}`);
    return Boolean(lead && inWindow(lead.acquired_et_day));
  };

  // ── Outcome de-duplication (manual overrides sheet) ────────────────────
  // A manual entry about the same lead+day+type as a sheet row is the SAME
  // fact corrected, not a second one. Where no lead is known the events
  // cannot be joined and each stands alone.
  const outcomeEvents: EventRow[] = [];
  {
    const chosen = new Map<string, EventRow>();
    let anon = 0;
    for (const e of events) {
      if (!["show", "no_show", "close", "payment", "reschedule"].includes(e.event_type)) continue;
      const key = e.lead_key
        ? `${e.client_key}|${e.lead_key}|${e.event_type}|${e.et_day}`
        : `anon:${anon++}:${e.id}`;
      const cur = chosen.get(key);
      if (!cur) chosen.set(key, e);
      else if (e.source === "manual" && cur.source !== "manual") chosen.set(key, e);
    }
    outcomeEvents.push(...chosen.values());
  }

  // ── Accumulate ─────────────────────────────────────────────────────────
  const act = new Agg(); // activity view
  const coh = new Agg(); // cohort view

  // Leads + lead-magnet opt-ins (cohort == activity for acquisition itself).
  for (const lead of leadsRes.rows) {
    if (!inWindow(lead.acquired_et_day)) continue;
    const type =
      lens === "origin" ? foldType(lead.origin_source) : foldType(lead.conversion_source ?? lead.origin_source);
    const dims: Dims = { client: lead.client_key, leadType: type, rep: null, channel: null };
    act.add("leads", dims);
    coh.add("leads", dims);
    if (lead.lm_optin_at) {
      coh.add("lm_optins", dims);
    }
  }

  const repMatches = (rep: string | null) => !repFiltered || (rep !== null && repSet.has(rep));

  for (const e of events) {
    const cohortMember = isCohortLead(e.client_key, e.lead_key);

    if (e.event_type === "booking") {
      // Onboarding calls are post-sale, not sales calls: they carry their own
      // call type and never count toward booking/show/close metrics.
      if (e.metadata?.call_type === "onboarding") continue;
      const type = leadTypeAt(e.client_key, e.lead_key, e.occurred_at);
      const channel = (e.channel as Channel) ?? null;
      if (!repMatches(e.rep_key)) continue;
      const dims: Dims = { client: e.client_key, leadType: type, rep: e.rep_key, channel };
      if (inWindow(e.et_day)) act.add("bookings", dims);
      if (cohortMember) coh.add("bookings", dims);

      // Due bookings (show-rate denominator): scheduled call day decides.
      const startDay = e.metadata?.start_et_day ?? null;
      const startTime = e.metadata?.start_time ?? null;
      const upcoming = Boolean(startTime && startTime > nowIso);
      if (startDay && !upcoming) {
        if (inWindow(startDay)) act.add("due", dims);
        if (cohortMember && startDay <= today) coh.add("due", dims);
      }
      // Upcoming calls: still in the future, scheduled inside the window.
      if (startDay && upcoming) {
        if (inWindow(startDay)) act.add("upcoming", dims);
        if (cohortMember) coh.add("upcoming", dims);
      }
      continue;
    }

    if (e.event_type === "lm_optin") {
      // Activity lm opt-ins (cohort side comes from the ledger above).
      const type = leadTypeAt(e.client_key, e.lead_key, e.occurred_at);
      if (inWindow(e.et_day)) {
        act.add("lm_optins", { client: e.client_key, leadType: type, rep: null, channel: null });
      }
      continue;
    }
  }

  for (const e of outcomeEvents) {
    const cohortMember = isCohortLead(e.client_key, e.lead_key);
    const type = leadTypeAt(e.client_key, e.lead_key, e.occurred_at);
    const ctx = bookingContextAt(e.client_key, e.lead_key, e.occurred_at);
    const rep = e.rep_key ?? ctx.rep;
    if (!repMatches(rep)) continue;
    const channel = (e.channel as Channel) ?? ctx.channel;
    const dims: Dims = { client: e.client_key, leadType: type, rep, channel };
    const active = inWindow(e.et_day);

    switch (e.event_type) {
      case "show":
        if (active) act.add("shows", dims);
        if (cohortMember) coh.add("shows", dims);
        break;
      case "no_show":
        if (active) act.add("no_shows", dims);
        if (cohortMember) coh.add("no_shows", dims);
        break;
      case "close":
        if (active) act.add("closes", dims);
        if (cohortMember) coh.add("closes", dims);
        break;
      case "reschedule":
        if (active) act.add("reschedules", dims);
        if (cohortMember) coh.add("reschedules", dims);
        break;
      case "payment": {
        const cents = Number(e.amount_cents ?? 0);
        if (cents > 0) {
          if (active) act.add("cash", dims, cents);
          if (cohortMember) {
            coh.add("cash", dims, cents);
            // Ad-attributed cash for ROAS is ORIGIN-defined by spec.
            const lead = e.lead_key ? leadByKey.get(`${e.client_key}|${e.lead_key}`) : null;
            if (lead && foldType(lead.origin_source) === "ad") coh.add("ad_cash", dims, cents);
          }
        }
        break;
      }
    }
  }

  // Spend into the activity aggregate (client + the 'ad' lead-type column).
  for (const [clientKey, s] of spend) {
    const dims: Dims = { client: clientKey, leadType: "ad", rep: null, channel: null };
    act.add("spend", dims, s.spend);
    act.add("impressions", dims, s.impressions);
    act.add("clicks", dims, s.clicks);
  }

  // ── Metric assembly ────────────────────────────────────────────────────
  const repKeys = repFiltered ? repFilters : REPS.map((r) => r.key);

  type CellFn = (a: Counts, c: Counts) => MetricCell;
  const counts = (agg: Agg, dim: "total" | "client" | "type" | "rep" | "reptype" | "channel", key?: string): Counts => {
    if (dim === "total") return agg.total;
    const map =
      dim === "client" ? agg.byClient
      : dim === "type" ? agg.byType
      : dim === "rep" ? agg.byRep
      : dim === "reptype" ? agg.byRepType
      : agg.byChannel;
    return map.get(key!) ?? {};
  };

  interface MetricSpec {
    key: string;
    label: string;
    unit: MetricUnit;
    dims: { client: boolean; leadType: boolean; rep: boolean; channel: boolean };
    cell: CellFn;
    /** Channel cells need their own denominators for booking rate. */
    channelCell?: (channel: Channel, a: Counts, c: Counts, aTotal: Counts, cTotal: Counts) => MetricCell;
    defined?: boolean;
    reason?: string | null;
  }

  const sum = (c: Counts, f: string) => c[f] ?? 0;

  const bookingRateChannelCell = (
    channel: Channel,
    _a: Counts,
    c: Counts,
    _aT: Counts,
    cT: Counts,
  ): MetricCell => {
    // dm + outbound rate against all cohort leads; lm buckets against
    // cohort lead-magnet opt-ins (the population the clock applies to).
    const denom =
      channel === "lm_outbound_lt60" || channel === "lm_outbound_gt60"
        ? sum(cT, "lm_optins")
        : sum(cT, "leads");
    return { activity: null, cohort: div(sum(c, "bookings"), denom) };
  };

  const noSource = (key: string, label: string, reason: string): MetricSpec => ({
    key,
    label,
    unit: "ratio",
    dims: { client: false, leadType: false, rep: false, channel: false },
    cell: () => ({ activity: null, cohort: null }),
    defined: false,
    reason,
  });

  const specs: MetricSpec[] = [
    // ── Marketing ────────────────────────────────────────────────────────
    {
      key: "leads",
      label: "Leads (DMs)",
      unit: "count",
      dims: { client: true, leadType: true, rep: false, channel: false },
      cell: (a, c) => ({ activity: sum(a, "leads"), cohort: sum(c, "leads") }),
      reason: repFiltered ? "Leads are not attributable to individual reps." : null,
    },
    {
      key: "cash_collected",
      label: "Cash Collected",
      unit: "usd_cents",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({ activity: sum(a, "cash"), cohort: sum(c, "cash") }),
    },
    {
      key: "ad_spend",
      label: "Ad Spend",
      unit: "usd_cents",
      dims: { client: true, leadType: true, rep: false, channel: false },
      cell: (a) => ({ activity: sum(a, "spend"), cohort: null }),
      reason: spendMissing ? "ads_meta_insights_daily unavailable" : null,
    },
    {
      key: "cpm",
      label: "CPM",
      unit: "usd_cents",
      dims: { client: true, leadType: false, rep: false, channel: false },
      cell: (a) => ({
        activity:
          sum(a, "impressions") > 0
            ? Math.round((sum(a, "spend") / sum(a, "impressions")) * 1000)
            : null,
        cohort: null,
      }),
    },
    {
      key: "lctr",
      label: "Link CTR",
      unit: "ratio",
      dims: { client: true, leadType: false, rep: false, channel: false },
      cell: (a) => ({ activity: div(sum(a, "clicks"), sum(a, "impressions")), cohort: null }),
    },
    {
      key: "roas",
      label: "ROAS (ad-attributed)",
      unit: "multiple",
      dims: { client: true, leadType: false, rep: false, channel: false },
      cell: (a, c) => ({ activity: null, cohort: div(sum(c, "ad_cash"), sum(a, "spend")) }),
      reason: "Cash from ad-origin leads acquired in this window ÷ spend in the window.",
    },
    {
      key: "roas_blended",
      label: "ROAS (blended)",
      unit: "multiple",
      dims: { client: true, leadType: false, rep: false, channel: false },
      cell: (a, c) => ({ activity: null, cohort: div(sum(c, "cash"), sum(a, "spend")) }),
      reason: "All cash from leads acquired in this window ÷ spend in the window.",
    },
    {
      key: "roi",
      label: "ROI (activity cash)",
      unit: "multiple",
      dims: { client: true, leadType: false, rep: false, channel: false },
      cell: (a) => ({ activity: div(sum(a, "cash"), sum(a, "spend")), cohort: null }),
      reason: "Cash collected in the window ÷ spend in the window.",
    },
    // ── Sales ────────────────────────────────────────────────────────────
    {
      key: "calls_booked",
      label: "Calls Booked",
      unit: "count",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({ activity: sum(a, "bookings"), cohort: sum(c, "bookings") }),
    },
    {
      key: "booking_rate_new_leads",
      label: "Booking Rate (new leads)",
      unit: "ratio",
      dims: { client: true, leadType: true, rep: false, channel: true },
      cell: (a, c) => ({ activity: null, cohort: div(sum(c, "bookings"), sum(c, "leads")) }),
      channelCell: bookingRateChannelCell,
      reason: repFiltered
        ? "The denominator (new leads) is not rep-attributable."
        : "Bookings from this window's new leads ÷ new leads acquired in this window.",
    },
    {
      key: "show_rate",
      label: "Show Rate",
      unit: "ratio",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({
        activity: div(sum(a, "shows"), sum(a, "due")),
        cohort: div(sum(c, "shows"), sum(c, "due")),
      }),
      reason: "Shows ÷ booked calls due in window (upcoming excluded).",
    },
    {
      key: "close_rate",
      label: "Close Rate",
      unit: "ratio",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({
        activity: div(sum(a, "closes"), sum(a, "shows")),
        cohort: div(sum(c, "closes"), sum(c, "shows")),
      }),
    },
    {
      key: "aov",
      label: "AOV",
      unit: "usd_cents",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({
        activity: sum(a, "closes") > 0 ? Math.round(sum(a, "cash") / sum(a, "closes")) : null,
        cohort: sum(c, "closes") > 0 ? Math.round(sum(c, "cash") / sum(c, "closes")) : null,
      }),
    },
    {
      key: "reschedules",
      label: "Reschedules",
      unit: "count",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({ activity: sum(a, "reschedules"), cohort: sum(c, "reschedules") }),
    },
    // Sheet-vocabulary counts, so the lead-type breakdown can mirror the
    // Sales Hub client table (taken = Call Taken yes = show events).
    {
      key: "calls_taken",
      label: "Calls Taken",
      unit: "count",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({ activity: sum(a, "shows"), cohort: sum(c, "shows") }),
    },
    {
      key: "wins",
      label: "Wins",
      unit: "count",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({ activity: sum(a, "closes"), cohort: sum(c, "closes") }),
    },
    {
      key: "losses",
      label: "Losses",
      unit: "count",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({
        activity: Math.max(0, sum(a, "shows") - sum(a, "closes")),
        cohort: Math.max(0, sum(c, "shows") - sum(c, "closes")),
      }),
      reason: "Calls taken that did not close.",
    },
    {
      key: "upcoming_calls",
      label: "Upcoming Calls",
      unit: "count",
      dims: { client: true, leadType: true, rep: true, channel: true },
      cell: (a, c) => ({ activity: sum(a, "upcoming"), cohort: sum(c, "upcoming") }),
      reason: "Booked calls scheduled in the window that have not happened yet.",
    },
    // ── Defined, but no data source yet (render dashes) ──────────────────
    noSource("pickup_rate_lm_lt60", "Pickup Rate (LM <60s)", "No dial/pickup data source yet."),
    noSource("pickup_rate_lm_gt60", "Pickup Rate (LM >60s)", "No dial/pickup data source yet."),
    noSource("pickup_rate_outbound", "Pickup Rate (outbound)", "No dial/pickup data source yet."),
    noSource("script_adherence_set", "Script Adherence (set)", "No script-adherence data source yet."),
    noSource("script_adherence_close", "Script Adherence (close)", "No script-adherence data source yet."),
    noSource(
      "pre_call_message_adherence",
      "Pre-Call Message Adherence",
      "No pre-call message data source yet.",
    ),
  ];

  const nullCell: MetricCell = { activity: null, cohort: null };

  // Marketing metrics cannot be scoped to one rep — blank them under a rep
  // filter rather than showing unscoped numbers as if they were the rep's.
  const repBlankKeys = new Set([
    "leads",
    "ad_spend",
    "cpm",
    "lctr",
    "roas",
    "roas_blended",
    "roi",
    "booking_rate_new_leads",
  ]);

  const metrics: MetricBlock[] = specs.map((spec) => {
    const defined = spec.defined ?? true;
    const blankForRep = repFiltered && repBlankKeys.has(spec.key);
    if (!defined || blankForRep) {
      return {
        key: spec.key,
        label: spec.label,
        unit: spec.unit,
        defined,
        reason: blankForRep
          ? spec.reason ?? "Not attributable to a single rep."
          : spec.reason ?? null,
        total: defined ? nullCell : null,
        by_client: null,
        by_lead_type: null,
        by_rep: null,
        by_rep_x_lead_type: null,
        by_channel: null,
      };
    }

    const cellFor = (a: Counts, c: Counts) => spec.cell(a, c);

    const byClient = spec.dims.client
      ? Object.fromEntries(
          clients.map((k) => [k, cellFor(counts(act, "client", k), counts(coh, "client", k))]),
        )
      : null;
    const byType = spec.dims.leadType
      ? (Object.fromEntries(
          LEAD_TYPES.map((t) => [t, cellFor(counts(act, "type", t), counts(coh, "type", t))]),
        ) as Record<LeadType, MetricCell | null>)
      : null;
    const byRep = spec.dims.rep
      ? Object.fromEntries(
          repKeys.map((r) => [r, cellFor(counts(act, "rep", r), counts(coh, "rep", r))]),
        )
      : null;
    const byRepType = spec.dims.rep && spec.dims.leadType
      ? Object.fromEntries(
          repKeys.map((r) => [
            r,
            Object.fromEntries(
              LEAD_TYPES.map((t) => [
                t,
                cellFor(counts(act, "reptype", `${r}|${t}`), counts(coh, "reptype", `${r}|${t}`)),
              ]),
            ) as Record<LeadType, MetricCell>,
          ]),
        )
      : null;
    const byChannel = spec.dims.channel
      ? (Object.fromEntries(
          CHANNELS.map((ch) => [
            ch,
            spec.channelCell
              ? spec.channelCell(ch, counts(act, "channel", ch), counts(coh, "channel", ch), act.total, coh.total)
              : cellFor(counts(act, "channel", ch), counts(coh, "channel", ch)),
          ]),
        ) as Record<Channel, MetricCell | null>)
      : null;

    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      defined: true,
      reason: spec.reason ?? null,
      total: cellFor(act.total, coh.total),
      by_client: byClient,
      by_lead_type: byType,
      by_rep: byRep,
      by_rep_x_lead_type: byRepType,
      by_channel: byChannel,
    };
  });

  // ── Freshness ──────────────────────────────────────────────────────────
  const freshness = {
    ledger_built_at: null as string | null,
    sheet_synced_at: null as string | null,
    spend_synced_at: null as string | null,
  };
  {
    const { data } = await db
      .schema("warehouse")
      .from("metrics_lead_events")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    freshness.ledger_built_at = data?.created_at ?? null;
  }
  {
    const { data } = await db
      .schema("warehouse")
      .from("sales_tracker_rows")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    freshness.sheet_synced_at = data?.synced_at ?? null;
  }
  {
    const { data } = await db
      .from("ads_meta_insights_daily")
      .select("synced_at")
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    freshness.spend_synced_at = data?.synced_at ?? null;
  }

  return {
    range,
    lens,
    client: clientFilters.length ? clientFilters.join(",") : null,
    rep: repFiltered ? repFilters.join(",") : null,
    clients,
    reps: REPS.map((r) => ({ key: r.key, name: r.name })),
    lead_types: LEAD_TYPES,
    channels: CHANNELS,
    metrics,
    migration_pending: migrationPending,
    freshness,
    generated_at: new Date().toISOString(),
  };
}
