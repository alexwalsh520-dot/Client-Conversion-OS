// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — the ledger build job. Reads every source of lead truth,
// writes the person-level ledger (warehouse.metrics_leads) and the event
// log (warehouse.metrics_lead_events). Runs from the metrics-ledger-build
// cron; requests never do this work.
//
// Sources → events:
//   * warehouse.manychat_tag_events (new_lead)      → lead_created (+ lead)
//   * warehouse.ads_keyword_events  (dm_keyword)    → categorization
//   * warehouse.dm_conversation_messages (outbound) → lead_created for
//       threads WE messaged that ManyChat never tagged (inbound-only threads
//       are NOT leads)
//   * public.skool_signups                          → lm_optin
//   * warehouse.ghl_appointments (pinned calendars) → booking / reschedule
//   * warehouse.sales_tracker_rows (interim truth)  → show / no_show /
//       close / payment
//   * warehouse.metrics_manual_entries              → override events
//       (source 'manual')
//
// Idempotent by construction (the ads-v2 054 pattern): the default run
// rewrites a rolling recent window of events (delete+insert) and upserts
// leads; ?full=1 rebuilds from EARLIEST_DAY. Events outside the window are
// never touched. Manual-sourced events are regenerated in full every run
// (the entries table is small and is itself the source of truth).
//
// Every read/write tolerates missing tables (113 not pasted yet) and
// reports migrationPending instead of failing.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { etDay, todayEt, shiftDay } from "@/lib/ads-v2/time";
import { classifyKeyword } from "@/lib/ads-v2/attribution";
import { normalizeKeyword } from "@/lib/ads-v2/keyword";
import { creatorKeyFromText, ACTIVE_CREATORS } from "@/lib/creators";
import { engineCalendar, type EngineCalendar } from "./calendars";
import { repKeyFromGhlUserId, repKeyFromText } from "./team";
import { chunk, isMissingRelation, safeFetchAllRows, type Db } from "./db";
import type { CallType, Channel, StoredLeadType } from "./types";

// The tracker/DM data starts in January 2026.
export const EARLIEST_DAY = "2026-01-01";
// Default incremental window. 45 (the ads-v2 FACTS_LOOKBACK_DAYS) overran
// the route's 300s ceiling: the hourly run deleted its window, then was
// killed mid-insert, orphaning six weeks of sales events (found 8/23; a
// 7-day run measured 79s). 14 days finishes with headroom and still
// re-reads the sheet past the p90 sales lag (13d), so late-typed outcomes
// keep landing. Runs older than that need an explicit ?days= or ?full=1
// from an environment without the 300s cap.
export const DEFAULT_LOOKBACK_DAYS = 14;
// Bookings reach forward (calls scheduled ahead).
export const UPCOMING_DAYS = 60;
// How far back to read spend when classifying a keyword as paid/organic.
const SPEND_HISTORY_DAYS = 180;

const ACTIVE_CLIENT_KEYS = ACTIVE_CREATORS.map((c) => c.key) as string[];

export interface BuildResult {
  ok: boolean;
  migrationPending: boolean;
  windowFrom: string;
  windowTo: string;
  leadsUpserted: number;
  eventsWritten: number;
  manualEntriesApplied: number;
  sourceCounts: Record<string, number>;
  notes: string[];
}

interface LeadDraft {
  client_key: string;
  lead_key: string;
  manychat_subscriber_id: string | null;
  ig_scoped_id: string | null;
  ig_handle: string | null;
  ghl_contact_ids: Set<string>;
  display_name: string | null;
  acquired_at: string;
  lm_optin_at: string | null;
  evidence: Record<string, unknown>;
}

interface EventDraft {
  client_key: string;
  lead_key: string | null;
  event_type: string;
  channel: Channel | null;
  rep_key: string | null;
  occurred_at: string;
  et_day: string;
  amount_cents: number | null;
  source: string;
  source_row_key: string;
  metadata: Record<string, unknown>;
}

const leadDraftKey = (client: string, leadKey: string) => `${client}|${leadKey}`;

/** The registry_person_name_key normalization, mirrored in TS. */
export function trackerNameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return key || null;
}

function minIso(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a < b ? a : b;
}

function isCancelled(status: string | null, eventType: string | null): boolean {
  return `${status || ""} ${eventType || ""}`.toLowerCase().includes("cancel");
}

export async function runMetricsLedgerBuild(opts: {
  full?: boolean;
  days?: number;
  now?: Date;
} = {}): Promise<BuildResult> {
  const db = getServiceSupabase();
  const now = opts.now ?? new Date();
  const today = todayEt(now);
  const lookback = opts.full
    ? null
    : Math.max(1, Math.min(3660, Math.floor(opts.days ?? DEFAULT_LOOKBACK_DAYS)));
  const fromDay = lookback ? shiftDay(today, -(lookback - 1)) : EARLIEST_DAY;
  const futureTo = shiftDay(today, UPCOMING_DAYS);
  // Over-fetch a day on each side and filter by ET day in JS (UTC≠ET).
  const fetchFromIso = `${shiftDay(fromDay, -1)}T00:00:00Z`;

  const notes: string[] = [];
  const sourceCounts: Record<string, number> = {};

  // ── 0) Are the 113 tables there at all? ─────────────────────────────────
  {
    const { error } = await db
      .schema("warehouse")
      .from("metrics_leads")
      .select("id")
      .limit(1);
    if (error && isMissingRelation(error)) {
      return {
        ok: true,
        migrationPending: true,
        windowFrom: fromDay,
        windowTo: futureTo,
        leadsUpserted: 0,
        eventsWritten: 0,
        manualEntriesApplied: 0,
        sourceCounts,
        notes: ["migration 113 not applied yet; nothing to build"],
      };
    }
    if (error) throw new Error(`metrics_leads probe failed: ${error.message}`);
  }

  const leads = new Map<string, LeadDraft>();
  const events: EventDraft[] = [];

  const upsertLeadDraft = (draft: {
    client_key: string;
    lead_key: string;
    manychat_subscriber_id?: string | null;
    ig_scoped_id?: string | null;
    ig_handle?: string | null;
    ghl_contact_id?: string | null;
    display_name?: string | null;
    acquired_at: string;
    lm_optin_at?: string | null;
    evidence?: Record<string, unknown>;
  }) => {
    const key = leadDraftKey(draft.client_key, draft.lead_key);
    const existing = leads.get(key);
    if (!existing) {
      leads.set(key, {
        client_key: draft.client_key,
        lead_key: draft.lead_key,
        manychat_subscriber_id: draft.manychat_subscriber_id ?? null,
        ig_scoped_id: draft.ig_scoped_id ?? null,
        ig_handle: draft.ig_handle ?? null,
        ghl_contact_ids: new Set(draft.ghl_contact_id ? [draft.ghl_contact_id] : []),
        display_name: draft.display_name ?? null,
        acquired_at: draft.acquired_at,
        lm_optin_at: draft.lm_optin_at ?? null,
        evidence: draft.evidence ?? {},
      });
      return;
    }
    existing.acquired_at = minIso(existing.acquired_at, draft.acquired_at)!;
    existing.lm_optin_at = minIso(existing.lm_optin_at, draft.lm_optin_at ?? null);
    existing.manychat_subscriber_id ||= draft.manychat_subscriber_id ?? null;
    existing.ig_scoped_id ||= draft.ig_scoped_id ?? null;
    existing.ig_handle ||= draft.ig_handle ?? null;
    existing.display_name ||= draft.display_name ?? null;
    if (draft.ghl_contact_id) existing.ghl_contact_ids.add(draft.ghl_contact_id);
    Object.assign(existing.evidence, draft.evidence ?? {});
  };

  // ── 1) Keyword classification reference (the ads-v2 is_organic logic) ───
  // Paid = the keyword had real spend covering the event day (+cool-down);
  // organic = marked on organic_keywords. Anything else is 'unclassified'.
  const spendDays = new Map<string, Map<string, string[]>>(); // client -> kw -> days
  {
    const spendFromDay = shiftDay(today, -SPEND_HISTORY_DAYS);
    const { rows } = await safeFetchAllRows<{
      client_key: string;
      keyword_normalized: string | null;
      date: string;
    }>((from, to) =>
      db
        .from("ads_meta_insights_daily")
        .select("client_key, keyword_normalized, date")
        .in("client_key", ACTIVE_CLIENT_KEYS)
        .gt("spend_cents", 0)
        .eq("raw_payload->>reporting_timezone", "America/New_York")
        .gte("date", spendFromDay)
        .order("date", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const kw = normalizeKeyword(r.keyword_normalized);
      if (!kw) continue;
      let byKw = spendDays.get(r.client_key);
      if (!byKw) spendDays.set(r.client_key, (byKw = new Map()));
      const list = byKw.get(kw);
      if (list) {
        if (list[list.length - 1] !== r.date) list.push(r.date);
      } else byKw.set(kw, [r.date]);
    }
  }
  const organicSet = new Map<string, Set<string>>();
  {
    const { rows } = await safeFetchAllRows<{
      client_key: string;
      keyword_normalized: string;
    }>((from, to) =>
      db
        .from("organic_keywords")
        .select("client_key, keyword_normalized")
        .in("client_key", ACTIVE_CLIENT_KEYS)
        .order("keyword_normalized", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const kw = normalizeKeyword(r.keyword_normalized);
      if (!kw) continue;
      if (!organicSet.has(r.client_key)) organicSet.set(r.client_key, new Set());
      organicSet.get(r.client_key)!.add(kw);
    }
  }
  const classifyDmKeyword = (
    client: string,
    keyword: string | null,
    day: string,
  ): StoredLeadType => {
    const kw = normalizeKeyword(keyword);
    if (!kw) return "unclassified";
    const cls = classifyKeyword({
      keyword: kw,
      organicMarked: organicSet.get(client)?.has(kw) ?? false,
      paidSpendDays: spendDays.get(client)?.get(kw) ?? [],
      eventDay: day,
    });
    if (cls === "paid") return "ad";
    if (cls === "organic") return "organic";
    return "unclassified";
  };

  // ── 2) ManyChat new_lead → lead_created + lead rows ────────────────────
  {
    const { rows, missing } = await safeFetchAllRows<{
      subscriber_id: string;
      subscriber_name: string | null;
      tag_name: string;
      client: string;
      event_at: string;
      keyword_normalized: string | null;
      handle: string | null;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("manychat_tag_events")
        .select(
          "subscriber_id, subscriber_name, tag_name, client, event_at, keyword_normalized, handle:raw_payload->>instagram_handle",
        )
        .gte("event_at", fetchFromIso)
        .order("event_at", { ascending: true })
        .range(from, to),
    );
    if (missing) notes.push("manychat_tag_events missing; skipped");
    let count = 0;
    for (const r of rows) {
      const day = etDay(r.event_at);
      if (!day || day < fromDay || day > today) continue;
      const client = creatorKeyFromText(r.client);
      if (!client || !r.subscriber_id) continue;
      const tag = (r.tag_name || "").toLowerCase().trim();
      const leadKey = `mc:${r.subscriber_id}`;

      if (tag === "new_lead") {
        upsertLeadDraft({
          client_key: client,
          lead_key: leadKey,
          manychat_subscriber_id: r.subscriber_id,
          ig_handle: (r.handle || "").trim().toLowerCase() || null,
          display_name: (r.subscriber_name || "").trim() || null,
          acquired_at: r.event_at,
          evidence: { new_lead: { source: "manychat_tag_events", event_at: r.event_at } },
        });
        events.push({
          client_key: client,
          lead_key: leadKey,
          event_type: "lead_created",
          channel: null,
          rep_key: null,
          occurred_at: r.event_at,
          et_day: day,
          amount_cents: null,
          source: "manychat",
          source_row_key: `new_lead:${client}:${r.subscriber_id}`,
          metadata: { subscriber_name: r.subscriber_name },
        });
        count += 1;
      } else if (tag.includes("follower")) {
        // Follower-automation contact — a categorization event. (No such tag
        // flows today; this is the hook the follower automation will use.)
        events.push({
          client_key: client,
          lead_key: leadKey,
          event_type: "categorization",
          channel: null,
          rep_key: null,
          occurred_at: r.event_at,
          et_day: day,
          amount_cents: null,
          source: "manychat",
          source_row_key: `follower:${client}:${r.subscriber_id}:${r.event_at}`,
          metadata: { source_class: "follower", tag_name: tag },
        });
      }
    }
    sourceCounts.manychat_new_leads = count;
  }

  // ── 3) Keyword DMs → categorization events (ad vs organic, ads-v2 law) ─
  {
    const { rows, missing } = await safeFetchAllRows<{
      id: string;
      client_key: string;
      subscriber_id: string | null;
      keyword_normalized: string | null;
      event_at: string;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("ads_keyword_events")
        .select("id, client_key, subscriber_id, keyword_normalized, event_at")
        .eq("source", "manychat")
        .eq("event_type", "dm_keyword")
        .in("client_key", ACTIVE_CLIENT_KEYS)
        .gte("event_at", fetchFromIso)
        .order("event_at", { ascending: true })
        .range(from, to),
    );
    if (missing) notes.push("ads_keyword_events missing; skipped");
    let count = 0;
    for (const r of rows) {
      const day = etDay(r.event_at);
      if (!day || day < fromDay || day > today) continue;
      if (!r.subscriber_id) continue;
      const kw = normalizeKeyword(r.keyword_normalized);
      const sourceClass = classifyDmKeyword(r.client_key, kw, day);
      events.push({
        client_key: r.client_key,
        lead_key: `mc:${r.subscriber_id}`,
        event_type: "categorization",
        channel: null,
        rep_key: null,
        occurred_at: r.event_at,
        et_day: day,
        amount_cents: null,
        source: "ads_keyword_events",
        source_row_key: r.id,
        metadata: { source_class: sourceClass, keyword: kw },
      });
      count += 1;
    }
    sourceCounts.keyword_dms = count;
  }

  // ── 4) Outbound DM threads ManyChat never tagged → leads ───────────────
  // A lead is someone WE messaged. dm_conversation_messages holds the real
  // threads keyed by INSTAGRAM-SCOPED ids; only threads with an outbound
  // message create leads (inbound-only threads are NOT leads). Bridged to
  // ManyChat identity via instagram_lead_links where possible so these merge
  // with ManyChat-created leads instead of duplicating them.
  {
    const { rows, missing } = await safeFetchAllRows<{
      client: string;
      subscriber_id: string;
      sent_at: string | null;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("dm_conversation_messages")
        .select("client, subscriber_id, sent_at")
        .eq("direction", "outbound")
        .gte("sent_at", fetchFromIso)
        .order("sent_at", { ascending: true })
        .range(from, to),
    );
    if (missing) notes.push("dm_conversation_messages missing; skipped");

    // First outbound message per (client, ig id) in the window.
    const firstOutbound = new Map<string, { client: string; igId: string; at: string }>();
    for (const r of rows) {
      if (!r.sent_at || !r.subscriber_id) continue;
      const day = etDay(r.sent_at);
      if (!day || day < fromDay || day > today) continue;
      const client = creatorKeyFromText(r.client);
      if (!client) continue;
      const k = `${client}|${r.subscriber_id}`;
      if (!firstOutbound.has(k)) firstOutbound.set(k, { client, igId: r.subscriber_id, at: r.sent_at });
    }

    // Bridge ig ids -> ManyChat ids/handles.
    const igIds = [...new Set([...firstOutbound.values()].map((v) => v.igId))];
    const bridge = new Map<string, { mc: string | null; handle: string | null; name: string | null }>();
    for (const ids of chunk(igIds, 200)) {
      const { rows: links } = await safeFetchAllRows<{
        instagram_user_id: string | null;
        manychat_subscriber_id: string | null;
        instagram_handle: string | null;
        lead_name: string | null;
      }>((from, to) =>
        db
          .schema("warehouse")
          .from("instagram_lead_links")
          .select("instagram_user_id, manychat_subscriber_id, instagram_handle, lead_name")
          .in("instagram_user_id", ids)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const l of links) {
        if (!l.instagram_user_id) continue;
        const cur = bridge.get(l.instagram_user_id);
        if (!cur) {
          bridge.set(l.instagram_user_id, {
            mc: l.manychat_subscriber_id ?? null,
            handle: l.instagram_handle ?? null,
            name: l.lead_name ?? null,
          });
        } else {
          cur.mc ||= l.manychat_subscriber_id ?? null;
          cur.handle ||= l.instagram_handle ?? null;
          cur.name ||= l.lead_name ?? null;
        }
      }
    }

    let count = 0;
    for (const v of firstOutbound.values()) {
      const link = bridge.get(v.igId);
      const leadKey = link?.mc ? `mc:${link.mc}` : `ig:${v.igId}`;
      // If ManyChat already created this lead in this batch, just merge the
      // earlier-first-outbound candidate; origin stays whatever the
      // categorization events say.
      upsertLeadDraft({
        client_key: v.client,
        lead_key: leadKey,
        manychat_subscriber_id: link?.mc ?? null,
        ig_scoped_id: v.igId,
        ig_handle: link?.handle ?? null,
        display_name: link?.name ?? null,
        acquired_at: v.at,
        evidence: { first_outbound_dm: { source: "dm_conversation_messages", at: v.at } },
      });
      events.push({
        client_key: v.client,
        lead_key: leadKey,
        event_type: "lead_created",
        channel: null,
        rep_key: null,
        occurred_at: v.at,
        et_day: etDay(v.at),
        amount_cents: null,
        source: "dm_conversation_messages",
        source_row_key: `dm_lead:${v.client}:${v.igId}`,
        metadata: { ig_scoped_id: v.igId },
      });
      count += 1;
    }
    sourceCounts.dm_thread_leads = count;
  }

  // ── 5) Skool signups → lm_optin ────────────────────────────────────────
  {
    const { rows, missing } = await safeFetchAllRows<{
      id: string;
      client: string;
      created_at: string;
      matched_subscriber_id: string | null;
      instagram_handle_normalized: string | null;
      ghl_contact_id: string | null;
      first_name: string | null;
      last_name: string | null;
    }>((from, to) =>
      db
        .from("skool_signups")
        .select(
          "id, client, created_at, matched_subscriber_id, instagram_handle_normalized, ghl_contact_id, first_name, last_name",
        )
        .gte("created_at", fetchFromIso)
        .order("created_at", { ascending: true })
        .range(from, to),
    );
    if (missing) notes.push("skool_signups missing; skipped");

    // Handle → ManyChat id fallback for unmatched signups.
    const unmatchedHandles = [
      ...new Set(
        rows
          .filter((r) => !r.matched_subscriber_id && r.instagram_handle_normalized)
          .map((r) => r.instagram_handle_normalized as string),
      ),
    ];
    const handleToMc = new Map<string, string>();
    for (const handles of chunk(unmatchedHandles, 200)) {
      const { rows: links } = await safeFetchAllRows<{
        instagram_handle: string | null;
        manychat_subscriber_id: string | null;
      }>((from, to) =>
        db
          .schema("warehouse")
          .from("instagram_lead_links")
          .select("instagram_handle, manychat_subscriber_id")
          .in("instagram_handle", handles)
          .not("manychat_subscriber_id", "is", null)
          .order("id", { ascending: true })
          .range(from, to),
      );
      for (const l of links) {
        if (l.instagram_handle && l.manychat_subscriber_id && !handleToMc.has(l.instagram_handle)) {
          handleToMc.set(l.instagram_handle, l.manychat_subscriber_id);
        }
      }
    }

    let count = 0;
    for (const r of rows) {
      const day = etDay(r.created_at);
      if (!day || day < fromDay || day > today) continue;
      const client = creatorKeyFromText(r.client);
      if (!client) continue;
      const mc =
        (r.matched_subscriber_id || "").trim() ||
        (r.instagram_handle_normalized ? handleToMc.get(r.instagram_handle_normalized) : null) ||
        null;
      const leadKey = mc ? `mc:${mc}` : null;
      if (leadKey) {
        upsertLeadDraft({
          client_key: client,
          lead_key: leadKey,
          manychat_subscriber_id: mc,
          ig_handle: r.instagram_handle_normalized,
          ghl_contact_id: r.ghl_contact_id,
          display_name:
            [r.first_name, r.last_name].filter(Boolean).join(" ").trim() || null,
          // The opt-in never creates the acquisition moment by itself, but a
          // Skool signup only happens to someone we DMed the link to — if the
          // ledger has no earlier acquisition, this timestamp stands in.
          acquired_at: r.created_at,
          lm_optin_at: r.created_at,
          evidence: { lm_optin: { source: "skool_signups", id: r.id } },
        });
      }
      events.push({
        client_key: client,
        lead_key: leadKey,
        event_type: "lm_optin",
        channel: null,
        rep_key: null,
        occurred_at: r.created_at,
        et_day: day,
        amount_cents: null,
        source: "skool",
        source_row_key: `optin:${r.id}`,
        metadata: {
          ghl_contact_id: r.ghl_contact_id,
          instagram_handle: r.instagram_handle_normalized,
        },
      });
      count += 1;
    }
    sourceCounts.lm_optins = count;
  }

  // ── 6) GHL appointments (pinned calendars only) → booking / reschedule ─
  // Fetched by updated_at so both fresh bookings and freshly-updated old
  // ones are seen; the event's day is the day the booking was MADE.
  const bookingsByAppointment = new Map<
    string,
    { lead_key: string | null; channel: Channel; client: string; rep_key: string | null }
  >();
  interface GhlApptRow {
    appointment_id: string;
    calendar_id: string | null;
    contact_id: string | null;
    contact_name: string | null;
    start_time: string | null;
    assigned_user_id: string | null;
    status: string | null;
    event_type: string | null;
    created_at: string | null;
    updated_at: string | null;
  }
  // Reschedule-calendar appointments: processed after every other booking is
  // in the event list, so client and call type can be inferred from the
  // lead's history (see step 9b).
  const deferredReschedules: Array<{ r: GhlApptRow; cal: EngineCalendar; leadKey: string | null }> = [];
  {
    const { rows, missing } = await safeFetchAllRows<GhlApptRow>((from, to) =>
      db
        .schema("warehouse")
        .from("ghl_appointments")
        .select(
          "appointment_id, calendar_id, contact_id, contact_name, start_time, assigned_user_id, status, event_type, created_at, updated_at",
        )
        .gte("updated_at", fetchFromIso)
        .order("updated_at", { ascending: true })
        .range(from, to),
    );
    if (missing) notes.push("ghl_appointments missing; skipped");

    const watched = rows.filter((r) => engineCalendar(r.calendar_id));

    // GHL contact -> ManyChat subscriber bridge (global on contact id, the
    // proven ads-v2 pattern — contact ids are globally unique).
    const contactIds = [
      ...new Set(watched.map((r) => r.contact_id).filter((v): v is string => Boolean(v))),
    ];
    const contactToMc = new Map<string, string>();
    for (const ids of chunk(contactIds, 200)) {
      const { rows: links } = await safeFetchAllRows<{
        ghl_contact_id: string | null;
        subscriber_id: string | null;
      }>((from, to) =>
        db
          .from("manychat_contact_links")
          .select("ghl_contact_id, subscriber_id")
          .in("ghl_contact_id", ids)
          .order("ghl_contact_id", { ascending: true })
          .range(from, to),
      );
      for (const l of links) {
        if (l.ghl_contact_id && l.subscriber_id && !contactToMc.has(l.ghl_contact_id)) {
          contactToMc.set(l.ghl_contact_id, l.subscriber_id);
        }
      }
    }

    let bookings = 0;
    let reschedules = 0;
    for (const r of watched) {
      const cal = engineCalendar(r.calendar_id)!;
      const bookedAt = r.created_at || r.start_time;
      if (!bookedAt) continue;
      const day = etDay(bookedAt);
      if (!day) continue;

      const mc = r.contact_id ? contactToMc.get(r.contact_id) ?? null : null;
      const leadKey = mc ? `mc:${mc}` : null;

      // Reschedule calendars: the calendar names the rep but not the client
      // or funnel — both are inferred from the lead's history in step 9b,
      // after every other booking is in the event list.
      if (cal.side === "reschedule") {
        deferredReschedules.push({ r, cal, leadKey });
        continue;
      }

      const cancelled = isCancelled(r.status, r.event_type);
      if (leadKey) {
        // Remember the GHL contact on the lead (merged later, if the lead
        // exists); bookings never create leads on their own.
        const draft = leads.get(leadDraftKey(cal.client, leadKey));
        if (draft && r.contact_id) draft.ghl_contact_ids.add(r.contact_id);
      }

      // Channel: DM calendars are the dm channel. Personal calendars are
      // outbound; the lm buckets are resolved after lead merge (they depend
      // on lm_optin_at), so store 'outbound' here and refine below.
      // Onboarding calendars are channel-independent (channel null) — their
      // call type ("onboarding") lives in metadata and keeps them out of
      // every sales booking/show/close metric.
      const baseChannel: Channel | null =
        cal.side === "dm" ? "dm" : cal.side === "outbound" ? "outbound" : null;
      // call_type is additive metadata; outbound bookings get theirs in
      // step 9 once the lm bucket is known.
      const callType: CallType | null =
        cal.side === "dm" ? "dm" : cal.side === "onboarding" ? "onboarding" : null;
      const repKey = cal.repKey ?? repKeyFromGhlUserId(r.assigned_user_id);

      if (!cancelled && day >= fromDay && day <= futureTo) {
        events.push({
          client_key: cal.client,
          lead_key: leadKey,
          event_type: "booking",
          channel: baseChannel,
          rep_key: repKey,
          occurred_at: bookedAt,
          et_day: day,
          amount_cents: null,
          source: "ghl_appointments",
          source_row_key: `booking:${r.appointment_id}`,
          metadata: {
            appointment_id: r.appointment_id,
            calendar_id: r.calendar_id,
            calendar_name: cal.name,
            side: cal.side,
            ...(callType ? { call_type: callType } : {}),
            contact_id: r.contact_id,
            contact_name: r.contact_name,
            start_time: r.start_time,
            start_et_day: r.start_time ? etDay(r.start_time) : null,
            status: r.status,
          },
        });
        bookings += 1;
      }

      if ((r.event_type || "").toLowerCase().trim() === "rescheduled" && r.updated_at) {
        const reschedDay = etDay(r.updated_at);
        if (reschedDay && reschedDay >= fromDay && reschedDay <= futureTo) {
          events.push({
            client_key: cal.client,
            lead_key: leadKey,
            event_type: "reschedule",
            channel: baseChannel,
            rep_key: repKey,
            occurred_at: r.updated_at,
            et_day: reschedDay,
            amount_cents: null,
            source: "ghl_appointments",
            source_row_key: `resched:${r.appointment_id}`,
            metadata: {
              appointment_id: r.appointment_id,
              calendar_id: r.calendar_id,
              side: cal.side,
              ...(callType ? { call_type: callType } : {}),
              start_time: r.start_time,
            },
          });
          reschedules += 1;
        }
      }
    }
    sourceCounts.bookings = bookings;
    sourceCounts.reschedules = reschedules;
  }

  // ── 7) Sales tracker rows (interim shows/closes/cash truth) ────────────
  // Interpretation (same as /api/public/client-metrics): blank Call Taken =
  // upcoming (no event), Yes = show, No = no_show; outcome WIN = close;
  // collected cents > 0 = payment. Subscription rows (supplements) are not
  // sales calls and are skipped. Client comes from the Offer column
  // (creatorKeyFromText), rep from the Closer column.
  {
    const { rows, missing } = await safeFetchAllRows<{
      id: string;
      sheet_row_key: string | null;
      date: string;
      prospect_name: string | null;
      call_taken_status: string | null;
      call_taken: boolean | null;
      outcome: string | null;
      closer: string | null;
      collected_revenue_cents: number | null;
      manychat_subscriber_id: string | null;
      program_length: string | null;
      offer: string | null;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("sales_tracker_rows")
        .select(
          "id, sheet_row_key, date, prospect_name, call_taken_status, call_taken, outcome, closer, collected_revenue_cents, manychat_subscriber_id, program_length, offer:raw_payload->>offer",
        )
        .gte("date", fromDay)
        .lte("date", today)
        .order("date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (missing) notes.push("sales_tracker_rows missing; skipped");

    const saleRows = rows.filter(
      (r) => (r.program_length || "").trim().toLowerCase() !== "subscription",
    );

    // Name → lead fallback through registry_persons (only when the tracker
    // has no pasted ManyChat link). A name two live people answer to is
    // never resolved — the registry_person_resolve discipline.
    const namesNeedingLookup = [
      ...new Set(
        saleRows
          .filter((r) => !(r.manychat_subscriber_id || "").trim())
          .map((r) => trackerNameKey(r.prospect_name))
          .filter((v): v is string => Boolean(v)),
      ),
    ];
    const nameToLead = new Map<string, string>();
    for (const keys of chunk(namesNeedingLookup, 50)) {
      const { rows: persons } = await safeFetchAllRows<{
        person_id: string;
        tracker_name_keys: string[] | null;
        manychat_ids: string[] | null;
        ig_scoped_ids: string[] | null;
      }>((from, to) =>
        db
          .schema("warehouse")
          .from("registry_persons")
          .select("person_id, tracker_name_keys, manychat_ids, ig_scoped_ids")
          .is("merged_into", null)
          .overlaps("tracker_name_keys", keys)
          .order("person_id", { ascending: true })
          .range(from, to),
      );
      const claimants = new Map<string, typeof persons>();
      for (const p of persons) {
        for (const k of p.tracker_name_keys || []) {
          if (!keys.includes(k)) continue;
          const list = claimants.get(k) || [];
          list.push(p);
          claimants.set(k, list);
        }
      }
      for (const [k, list] of claimants) {
        if (list.length !== 1) continue; // ambiguous name: never resolved
        const p = list[0];
        if ((p.manychat_ids || []).length === 1) nameToLead.set(k, `mc:${p.manychat_ids![0]}`);
        else if ((p.ig_scoped_ids || []).length === 1) nameToLead.set(k, `ig:${p.ig_scoped_ids![0]}`);
      }
    }

    let shows = 0;
    let noShows = 0;
    let closes = 0;
    let payments = 0;
    for (const r of saleRows) {
      const client = creatorKeyFromText(r.offer);
      if (!client) continue;
      const srk = r.sheet_row_key || r.id;
      const day = r.date;
      // Noon ET, expressed in UTC — only et_day is load-bearing.
      const occurredAt = `${day}T16:00:00Z`;
      const pasted = (r.manychat_subscriber_id || "").trim() || null;
      const nameKey = trackerNameKey(r.prospect_name);
      const leadKey = pasted
        ? `mc:${pasted}`
        : (nameKey ? nameToLead.get(nameKey) ?? null : null);
      const repKey = repKeyFromText(r.closer);
      const base = {
        client_key: client,
        lead_key: leadKey,
        channel: null,
        rep_key: repKey,
        occurred_at: occurredAt,
        et_day: day,
        source: "sheet",
        metadata: {
          sheet_row_key: srk,
          prospect_name: r.prospect_name,
          outcome: r.outcome,
          closer: r.closer,
          matched_by: pasted ? "manychat_link" : leadKey ? "registry_name" : "none",
        },
      };

      const takenStatus = (r.call_taken_status || "").trim().toLowerCase();
      const taken = takenStatus ? takenStatus === "yes" : r.call_taken === true;
      const notTaken = takenStatus === "no";

      if (taken) {
        events.push({ ...base, event_type: "show", amount_cents: null, source_row_key: `show:${srk}` });
        shows += 1;
      } else if (notTaken) {
        events.push({ ...base, event_type: "no_show", amount_cents: null, source_row_key: `noshow:${srk}` });
        noShows += 1;
      }
      // Blank Call Taken = upcoming: no event at all.

      if ((r.outcome || "").trim().toUpperCase() === "WIN") {
        events.push({ ...base, event_type: "close", amount_cents: null, source_row_key: `close:${srk}` });
        closes += 1;
      }
      const cash = Number(r.collected_revenue_cents || 0);
      if (cash > 0) {
        events.push({ ...base, event_type: "payment", amount_cents: cash, source_row_key: `payment:${srk}` });
        payments += 1;
      }
    }
    sourceCounts.sheet_shows = shows;
    sourceCounts.sheet_no_shows = noShows;
    sourceCounts.sheet_closes = closes;
    sourceCounts.sheet_payments = payments;
  }

  // ── 8) Merge with existing ledger rows ─────────────────────────────────
  const touchedLeadKeys = new Set<string>();
  for (const d of leads.values()) touchedLeadKeys.add(d.lead_key);
  for (const e of events) if (e.lead_key) touchedLeadKeys.add(e.lead_key);

  interface DbLead {
    client_key: string;
    lead_key: string;
    person_id: string | null;
    manychat_subscriber_id: string | null;
    ig_scoped_id: string | null;
    ig_handle: string | null;
    ghl_contact_ids: string[] | null;
    display_name: string | null;
    acquired_at: string;
    origin_source: string;
    origin_keyword: string | null;
    conversion_source: string | null;
    conversion_keyword: string | null;
    conversion_source_at: string | null;
    lm_optin_at: string | null;
    evidence: Record<string, unknown> | null;
  }
  const existingByKey = new Map<string, DbLead>();
  for (const keys of chunk([...touchedLeadKeys], 200)) {
    const { rows } = await safeFetchAllRows<DbLead>((from, to) =>
      db
        .schema("warehouse")
        .from("metrics_leads")
        .select(
          "client_key, lead_key, person_id, manychat_subscriber_id, ig_scoped_id, ig_handle, ghl_contact_ids, display_name, acquired_at, origin_source, origin_keyword, conversion_source, conversion_keyword, conversion_source_at, lm_optin_at, evidence",
        )
        .in("lead_key", keys)
        .order("lead_key", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) existingByKey.set(leadDraftKey(r.client_key, r.lead_key), r);
  }

  // The merged upsert payloads (origin/conversion applied in step 10).
  const upserts = new Map<string, Record<string, unknown> & {
    client_key: string;
    lead_key: string;
    lm_optin_at: string | null;
    origin_source: string;
  }>();
  for (const d of leads.values()) {
    const k = leadDraftKey(d.client_key, d.lead_key);
    const existing = existingByKey.get(k);
    const acquiredAt = minIso(existing?.acquired_at ?? null, d.acquired_at)!;
    upserts.set(k, {
      client_key: d.client_key,
      lead_key: d.lead_key,
      person_id: existing?.person_id ?? null,
      manychat_subscriber_id: existing?.manychat_subscriber_id ?? d.manychat_subscriber_id,
      ig_scoped_id: existing?.ig_scoped_id ?? d.ig_scoped_id,
      ig_handle: existing?.ig_handle ?? d.ig_handle,
      ghl_contact_ids: [
        ...new Set([...(existing?.ghl_contact_ids ?? []), ...d.ghl_contact_ids]),
      ],
      display_name: existing?.display_name ?? d.display_name,
      acquired_at: acquiredAt,
      acquired_et_day: etDay(acquiredAt),
      origin_source: existing?.origin_source ?? "unclassified",
      origin_keyword: existing?.origin_keyword ?? null,
      conversion_source: existing?.conversion_source ?? null,
      conversion_keyword: existing?.conversion_keyword ?? null,
      conversion_source_at: existing?.conversion_source_at ?? null,
      lm_optin_at: minIso(existing?.lm_optin_at ?? null, d.lm_optin_at),
      evidence: { ...(existing?.evidence ?? {}), ...d.evidence },
      updated_at: new Date().toISOString(),
    });
  }
  // Leads only touched by events (e.g. a Skool opt-in for a lead acquired
  // before the window): patch lm_optin_at on the existing row.
  for (const e of events) {
    if (e.event_type !== "lm_optin" || !e.lead_key) continue;
    const k = leadDraftKey(e.client_key, e.lead_key);
    if (upserts.has(k)) continue;
    const existing = existingByKey.get(k);
    if (!existing) continue;
    const merged = minIso(existing.lm_optin_at, e.occurred_at);
    if (merged !== existing.lm_optin_at) {
      upserts.set(k, {
        ...existing,
        ghl_contact_ids: existing.ghl_contact_ids ?? [],
        evidence: existing.evidence ?? {},
        acquired_et_day: etDay(existing.acquired_at),
        lm_optin_at: merged,
        updated_at: new Date().toISOString(),
      });
    }
  }

  // ── 9) Resolve outbound booking channels (lm buckets) ──────────────────
  // The 60-second clock starts at lm_optin; the bucket is decided by the
  // FIRST DIAL timestamp. No dial source exists yet, so an lm-opted lead's
  // outbound booking defaults to the gt60 bucket, and channel_basis records
  // why — when dial events land, this resolves for real.
  const lmOptinByLead = new Map<string, string>();
  const noteOptin = (client: string, leadKey: string, at: string | null | undefined) => {
    if (!at) return;
    const k = leadDraftKey(client, leadKey);
    const cur = lmOptinByLead.get(k);
    if (!cur || at < cur) lmOptinByLead.set(k, at);
  };
  for (const [k, u] of upserts) if (u.lm_optin_at) lmOptinByLead.set(k, u.lm_optin_at);
  for (const [k, e] of existingByKey) if (e.lm_optin_at) noteOptin(e.client_key, e.lead_key, e.lm_optin_at);
  const dialsByLead = new Map<string, string>(); // first dial per client|lead (none today)
  for (const e of events) {
    if (e.event_type !== "dial" || !e.lead_key) continue;
    const k = leadDraftKey(e.client_key, e.lead_key);
    const cur = dialsByLead.get(k);
    if (!cur || e.occurred_at < cur) dialsByLead.set(k, e.occurred_at);
  }
  for (const e of events) {
    if (e.event_type !== "booking" && e.event_type !== "reschedule") continue;
    if (e.channel !== "outbound" || !e.lead_key) continue;
    const k = leadDraftKey(e.client_key, e.lead_key);
    const optin = lmOptinByLead.get(k);
    if (!optin) continue;
    const dial = dialsByLead.get(k) ?? null;
    if (dial) {
      const deltaMs = new Date(dial).getTime() - new Date(optin).getTime();
      e.channel = deltaMs >= 0 && deltaMs < 60_000 ? "lm_outbound_lt60" : "lm_outbound_gt60";
      e.metadata.channel_basis = "first_dial_vs_lm_optin";
    } else {
      e.channel = "lm_outbound_gt60";
      e.metadata.channel_basis = "no_dial_data_default_gt60";
    }
  }
  // Personal-calendar call types, now that the lm bucket is decided: a lead
  // who opted into the lead magnet (lm channel) is an lm_outbound call,
  // everyone else is plain outbound.
  for (const e of events) {
    if (e.event_type !== "booking" && e.event_type !== "reschedule") continue;
    if ((e.metadata as { side?: string }).side !== "outbound") continue;
    e.metadata.call_type = String(e.channel || "").startsWith("lm_outbound")
      ? "lm_outbound"
      : "outbound";
  }

  // ── 9b) Reschedule-calendar bookings (client + call type inferred) ─────
  // These are real sales calls the sheet counts; the calendar names the rep
  // but not the client or funnel. Inference order:
  //   client:    lead's ledger row (when exactly one client owns the lead)
  //              → the lead's most recent prior booking → default tyson
  //   call type: the lead's most recent prior NON-onboarding booking's call
  //              type → "dm"
  // metadata.client_basis / call_type_basis record which rung was used.
  {
    // Prior bookings per lead: everything already in this run's event list…
    interface PriorBooking {
      at: string;
      client: string;
      channel: string | null;
      call_type: string | null;
    }
    const priorByLead = new Map<string, PriorBooking[]>();
    const notePrior = (leadKey: string | null, b: PriorBooking) => {
      if (!leadKey) return;
      const list = priorByLead.get(leadKey) ?? [];
      list.push(b);
      priorByLead.set(leadKey, list);
    };
    for (const e of events) {
      if (e.event_type !== "booking" || !e.lead_key) continue;
      const meta = e.metadata as { call_type?: string };
      notePrior(e.lead_key, {
        at: e.occurred_at,
        client: e.client_key,
        channel: e.channel,
        call_type: meta.call_type ?? null,
      });
    }
    // …plus stored bookings older than this window (incremental runs).
    const reschedLeadKeys = [
      ...new Set(deferredReschedules.map((d) => d.leadKey).filter((v): v is string => Boolean(v))),
    ];
    for (const keys of chunk(reschedLeadKeys, 100)) {
      const { rows: prior } = await safeFetchAllRows<{
        client_key: string;
        lead_key: string | null;
        channel: string | null;
        occurred_at: string;
        et_day: string;
        metadata: { call_type?: string } | null;
      }>((from, to) =>
        db
          .schema("warehouse")
          .from("metrics_lead_events")
          .select("client_key, lead_key, channel, occurred_at, et_day, metadata")
          .eq("event_type", "booking")
          .in("lead_key", keys)
          .lt("et_day", fromDay)
          .order("occurred_at", { ascending: true })
          .range(from, to),
      );
      for (const p of prior) {
        notePrior(p.lead_key, {
          at: p.occurred_at,
          client: p.client_key,
          channel: p.channel,
          call_type: p.metadata?.call_type ?? null,
        });
      }
    }
    for (const list of priorByLead.values()) list.sort((a, b) => a.at.localeCompare(b.at));

    // Ledger client ownership: which client(s) hold each lead.
    const ledgerClients = new Map<string, Set<string>>();
    const noteOwner = (leadKey: string, client: string) => {
      const set = ledgerClients.get(leadKey) ?? new Set<string>();
      set.add(client);
      ledgerClients.set(leadKey, set);
    };
    for (const d of leads.values()) {
      if (reschedLeadKeys.includes(d.lead_key)) noteOwner(d.lead_key, d.client_key);
    }
    for (const keys of chunk(reschedLeadKeys, 200)) {
      const { rows: owned } = await safeFetchAllRows<{ client_key: string; lead_key: string }>(
        (from, to) =>
          db
            .schema("warehouse")
            .from("metrics_leads")
            .select("client_key, lead_key")
            .in("lead_key", keys)
            .order("lead_key", { ascending: true })
            .range(from, to),
      );
      for (const o of owned) noteOwner(o.lead_key, o.client_key);
    }

    const callTypeFromChannel = (channel: string | null): CallType => {
      if (channel === "dm") return "dm";
      if (String(channel || "").startsWith("lm_outbound")) return "lm_outbound";
      return "outbound";
    };

    let reschedBookings = 0;
    for (const { r, cal, leadKey } of deferredReschedules) {
      const cancelled = isCancelled(r.status, r.event_type);
      const bookedAt = r.created_at || r.start_time;
      if (!bookedAt) continue;
      const day = etDay(bookedAt);
      if (!day) continue;

      const priors = leadKey ? (priorByLead.get(leadKey) ?? []) : [];
      const priorsBefore = priors.filter((p) => p.at <= bookedAt);
      const lastPrior = priorsBefore.at(-1) ?? priors[0] ?? null;
      const lastSalesPrior =
        [...priorsBefore].reverse().find((p) => p.call_type !== "onboarding") ??
        priors.find((p) => p.call_type !== "onboarding") ??
        null;

      // Client: ledger → prior booking → default.
      const owners = leadKey ? ledgerClients.get(leadKey) : undefined;
      let client = cal.client as string;
      let clientBasis = "default_tyson";
      if (owners && owners.size === 1) {
        client = [...owners][0];
        clientBasis = "ledger";
      } else if (lastPrior) {
        client = lastPrior.client;
        clientBasis = "prior_booking";
      }

      // Call type + channel: inherited from the prior sales booking.
      let callType: CallType = "dm";
      let callTypeBasis = "default_dm";
      let channel: Channel = "dm";
      if (lastSalesPrior) {
        callType = (lastSalesPrior.call_type as CallType) ?? callTypeFromChannel(lastSalesPrior.channel);
        if (callType === "onboarding") callType = "dm"; // never inherited
        callTypeBasis = "prior_booking";
        channel =
          lastSalesPrior.channel &&
          ["dm", "lm_outbound_lt60", "lm_outbound_gt60", "outbound"].includes(lastSalesPrior.channel)
            ? (lastSalesPrior.channel as Channel)
            : "dm";
      }

      const repKey = cal.repKey ?? repKeyFromGhlUserId(r.assigned_user_id);
      const baseMetadata = {
        appointment_id: r.appointment_id,
        calendar_id: r.calendar_id,
        calendar_name: cal.name,
        side: cal.side,
        call_type: callType,
        call_type_basis: callTypeBasis,
        client_basis: clientBasis,
        contact_id: r.contact_id,
        contact_name: r.contact_name,
        start_time: r.start_time,
        start_et_day: r.start_time ? etDay(r.start_time) : null,
        status: r.status,
      };

      if (!cancelled && day >= fromDay && day <= futureTo) {
        events.push({
          client_key: client,
          lead_key: leadKey,
          event_type: "booking",
          channel,
          rep_key: repKey,
          occurred_at: bookedAt,
          et_day: day,
          amount_cents: null,
          source: "ghl_appointments",
          source_row_key: `booking:${r.appointment_id}`,
          metadata: baseMetadata,
        });
        reschedBookings += 1;
      }

      if ((r.event_type || "").toLowerCase().trim() === "rescheduled" && r.updated_at) {
        const reschedDay = etDay(r.updated_at);
        if (reschedDay && reschedDay >= fromDay && reschedDay <= futureTo) {
          events.push({
            client_key: client,
            lead_key: leadKey,
            event_type: "reschedule",
            channel,
            rep_key: repKey,
            occurred_at: r.updated_at,
            et_day: reschedDay,
            amount_cents: null,
            source: "ghl_appointments",
            source_row_key: `resched:${r.appointment_id}`,
            metadata: baseMetadata,
          });
        }
      }
    }
    sourceCounts.reschedule_calendar_bookings = reschedBookings;
  }

  for (const e of events) {
    if (e.event_type === "booking") {
      const meta = e.metadata as { appointment_id?: string };
      if (meta.appointment_id) {
        bookingsByAppointment.set(meta.appointment_id, {
          lead_key: e.lead_key,
          channel: e.channel as Channel,
          client: e.client_key,
          rep_key: e.rep_key,
        });
      }
    }
  }

  // ── 10) Manual entries → override events (source 'manual') ─────────────
  const appliedEntryIds: string[] = [];
  {
    const { rows, missing } = await safeFetchAllRows<{
      id: string;
      client_key: string;
      appointment_key: string | null;
      lead_key: string | null;
      entry_type: string;
      value: Record<string, unknown> | null;
      rep_name: string | null;
      entered_at: string;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("metrics_manual_entries")
        .select("id, client_key, appointment_key, lead_key, entry_type, value, rep_name, entered_at")
        .order("entered_at", { ascending: true })
        .range(from, to),
    );
    if (missing) notes.push("metrics_manual_entries missing; skipped");

    // Bookings referenced by entries but built before this window: look them
    // up in the stored event log.
    const unknownAppointments = [
      ...new Set(
        rows
          .map((r) => r.appointment_key)
          .filter((v): v is string => Boolean(v && !bookingsByAppointment.has(v))),
      ),
    ];
    for (const ids of chunk(unknownAppointments, 100)) {
      const { rows: prior } = await safeFetchAllRows<{
        client_key: string;
        lead_key: string | null;
        channel: string | null;
        rep_key: string | null;
        source_row_key: string;
      }>((from, to) =>
        db
          .schema("warehouse")
          .from("metrics_lead_events")
          .select("client_key, lead_key, channel, rep_key, source_row_key")
          .eq("source", "ghl_appointments")
          .in("source_row_key", ids.map((id) => `booking:${id}`))
          .order("source_row_key", { ascending: true })
          .range(from, to),
      );
      for (const p of prior) {
        const apptId = p.source_row_key.replace(/^booking:/, "");
        if (!bookingsByAppointment.has(apptId)) {
          bookingsByAppointment.set(apptId, {
            lead_key: p.lead_key,
            channel: (p.channel as Channel) ?? "dm",
            client: p.client_key,
            rep_key: p.rep_key,
          });
        }
      }
    }

    let manualEvents = 0;
    for (const r of rows) {
      const value = r.value ?? {};
      const booking = r.appointment_key ? bookingsByAppointment.get(r.appointment_key) : undefined;
      const leadKey = r.lead_key || booking?.lead_key || null;
      const channel = booking?.channel ?? null;
      const repKey = repKeyFromText(r.rep_name) || booking?.rep_key || null;
      const occurredAtRaw = typeof value.occurred_at === "string" ? value.occurred_at : null;
      const occurredAt =
        occurredAtRaw && !Number.isNaN(new Date(occurredAtRaw).getTime())
          ? occurredAtRaw
          : r.entered_at;
      const base = {
        client_key: booking?.client ?? r.client_key,
        lead_key: leadKey,
        channel,
        rep_key: repKey,
        occurred_at: occurredAt,
        et_day: etDay(occurredAt),
        source: "manual",
        metadata: {
          entry_id: r.id,
          entry_type: r.entry_type,
          appointment_id: r.appointment_key,
          rep_name: r.rep_name,
        },
      };

      let produced = false;
      if (r.entry_type === "outcome") {
        const outcome = typeof value.outcome === "string" ? value.outcome : null;
        if (outcome === "show" || outcome === "no_show" || outcome === "close") {
          if (outcome === "close") {
            // A close implies the call happened.
            events.push({ ...base, event_type: "show", amount_cents: null, source_row_key: `entry:${r.id}:show` });
            events.push({ ...base, event_type: "close", amount_cents: null, source_row_key: `entry:${r.id}:close` });
          } else {
            events.push({ ...base, event_type: outcome, amount_cents: null, source_row_key: `entry:${r.id}:${outcome}` });
          }
          produced = true;
        }
        const cash = Number(value.cash_cents ?? 0);
        if (Number.isFinite(cash) && cash > 0) {
          events.push({
            ...base,
            event_type: "payment",
            amount_cents: Math.round(cash),
            source_row_key: `entry:${r.id}:payment`,
          });
          produced = true;
        }
      } else if (r.entry_type === "cash") {
        const cash = Number(value.amount_cents ?? 0);
        if (Number.isFinite(cash) && cash > 0) {
          events.push({
            ...base,
            event_type: "payment",
            amount_cents: Math.round(cash),
            source_row_key: `entry:${r.id}:payment`,
          });
          produced = true;
        }
      } else if (r.entry_type === "reschedule") {
        events.push({ ...base, event_type: "reschedule", amount_cents: null, source_row_key: `entry:${r.id}:resched` });
        produced = true;
      } else if (r.entry_type === "show_fix") {
        events.push({ ...base, event_type: "show", amount_cents: null, source_row_key: `entry:${r.id}:show` });
        produced = true;
      }
      // 'note' produces no event.
      if (produced) {
        manualEvents += 1;
        appliedEntryIds.push(r.id);
      }
    }
    sourceCounts.manual_events = manualEvents;
  }

  // ── 11) Rewrite the window: delete + insert (idempotent) ───────────────
  {
    const del = await db
      .schema("warehouse")
      .from("metrics_lead_events")
      .delete()
      .neq("source", "manual")
      .gte("et_day", fromDay)
      .lte("et_day", futureTo);
    if (del.error && !isMissingRelation(del.error)) {
      throw new Error(`event window delete failed: ${del.error.message}`);
    }
    const delManual = await db
      .schema("warehouse")
      .from("metrics_lead_events")
      .delete()
      .eq("source", "manual");
    if (delManual.error && !isMissingRelation(delManual.error)) {
      throw new Error(`manual event delete failed: ${delManual.error.message}`);
    }

    // Money events insert first: if a run is ever killed at the clock
    // limit, the casualty is bulk lead history (rebuilt by the next run),
    // never the sales tail. Exactly that failure orphaned bookings/shows/
    // closes/payments for six weeks before 8/23.
    const INSERT_PRIORITY: Record<string, number> = {
      payment: 0, close: 1, show: 2, no_show: 3, booking: 4, reschedule: 5,
      lm_optin: 6, dial: 7, pickup: 8, categorization: 9, lead_created: 10,
    };
    const ordered = [...events].sort(
      (a, b) => (INSERT_PRIORITY[a.event_type] ?? 99) - (INSERT_PRIORITY[b.event_type] ?? 99),
    );
    for (const slice of chunk(ordered, 500)) {
      const { error } = await db
        .schema("warehouse")
        .from("metrics_lead_events")
        .upsert(slice, { onConflict: "source,source_row_key", ignoreDuplicates: true });
      if (error) {
        if (isMissingRelation(error)) break;
        throw new Error(`event insert failed: ${error.message}`);
      }
    }
  }

  // ── 12) Recompute per-lead origin (first categorization ever, immutable
  //        once real) and conversion (latest categorization) ──────────────
  {
    const keys = [...new Set([...upserts.values()].map((u) => u.lead_key))];
    interface CatRow {
      client_key: string;
      lead_key: string | null;
      occurred_at: string;
      metadata: { source_class?: string; keyword?: string | null } | null;
    }
    const catsByLead = new Map<string, { first: CatRow; last: CatRow }>();
    for (const keySlice of chunk(keys, 200)) {
      const { rows } = await safeFetchAllRows<CatRow>((from, to) =>
        db
          .schema("warehouse")
          .from("metrics_lead_events")
          .select("client_key, lead_key, occurred_at, metadata")
          .eq("event_type", "categorization")
          .in("lead_key", keySlice)
          .order("occurred_at", { ascending: true })
          .range(from, to),
      );
      for (const r of rows) {
        if (!r.lead_key) continue;
        const k = leadDraftKey(r.client_key, r.lead_key);
        const cur = catsByLead.get(k);
        if (!cur) catsByLead.set(k, { first: r, last: r });
        else {
          if (r.occurred_at < cur.first.occurred_at) cur.first = r;
          if (r.occurred_at >= cur.last.occurred_at) cur.last = r;
        }
      }
    }
    const asStored = (v: string | undefined): StoredLeadType => {
      if (v === "ad" || v === "organic" || v === "follower" || v === "misc") return v;
      return "unclassified";
    };
    for (const [k, u] of upserts) {
      const cats = catsByLead.get(k);
      if (!cats) continue;
      const firstClass = asStored(cats.first.metadata?.source_class ?? undefined);
      const lastClass = asStored(cats.last.metadata?.source_class ?? undefined);
      // Origin is IMMUTABLE once it holds a real value; only an unset /
      // 'unclassified' origin may be filled in.
      if (u.origin_source === "unclassified" && firstClass !== "unclassified") {
        u.origin_source = firstClass;
        u.origin_keyword = cats.first.metadata?.keyword ?? null;
      }
      u.conversion_source = lastClass;
      u.conversion_keyword = cats.last.metadata?.keyword ?? null;
      u.conversion_source_at = cats.last.occurred_at;
    }
  }

  // ── 13) Upsert the ledger ──────────────────────────────────────────────
  const upsertRows = [...upserts.values()];
  for (const slice of chunk(upsertRows, 500)) {
    const { error } = await db
      .schema("warehouse")
      .from("metrics_leads")
      .upsert(slice, { onConflict: "client_key,lead_key" });
    if (error) {
      if (isMissingRelation(error)) break;
      throw new Error(`lead upsert failed: ${error.message}`);
    }
  }

  // ── 14) Stamp applied manual entries ───────────────────────────────────
  for (const ids of chunk(appliedEntryIds, 200)) {
    const { error } = await db
      .schema("warehouse")
      .from("metrics_manual_entries")
      .update({ applied: true })
      .in("id", ids);
    if (error && !isMissingRelation(error)) {
      notes.push(`manual entry stamp failed: ${error.message}`);
    }
  }

  return {
    ok: true,
    migrationPending: false,
    windowFrom: fromDay,
    windowTo: futureTo,
    leadsUpserted: upsertRows.length,
    eventsWritten: events.length,
    manualEntriesApplied: appliedEntryIds.length,
    sourceCounts,
    notes,
  };
}
