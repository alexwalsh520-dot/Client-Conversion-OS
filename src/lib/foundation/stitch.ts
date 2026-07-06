// Foundation stitch logic — turns raw rows from the scattered source tables into
// unified activity_events, and builds the deterministic per-lead "story".
//
// MONEY RULE: this file stores raw sale FACTS (collected amount, closer, date) only.
// It never computes ad-level revenue or ROAS — that stays in getAdsTrackerDashboard().

import { foundationClientKey, dayET, shortDayET } from "./identity";

export type FoundationEvent = {
  client_key: string;
  event_type:
    | "dm_in"
    | "dm_out"
    | "keyword_hit"
    | "call_booked"
    | "call_taken"
    | "sale"
    | "fathom_call";
  subscriber_id: string | null;
  contact_id: string | null;
  display_name: string | null;
  keyword_normalized: string | null;
  occurred_at: string;
  occurred_day_et: string | null;
  amount_cents: number | null;
  actor: string | null;
  summary: string;
  source: string;
  source_id: string;
  payload: Record<string, unknown> | null;
  link_confidence?: "id" | "name"; // set centrally in the worker from id vs name-only linkage
};

const s = (v: unknown): string | null => {
  const t = v == null ? "" : String(v).trim();
  return t.length ? t : null;
};

/** Trim a DM body to a short, single-line snippet for the summary. */
function snippet(body: unknown, max = 90): string {
  const t = s(body);
  if (!t) return "";
  const flat = t.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function dollars(cents: number | null | undefined): string {
  if (!cents) return "0";
  return Math.round(cents / 100).toLocaleString("en-US");
}

// ---- per-source mappers -------------------------------------------------

type Row = Record<string, unknown>;

export function mapDmMessage(row: Row): FoundationEvent | null {
  const client_key = foundationClientKey(s(row.client));
  const subscriber_id = s(row.subscriber_id);
  const occurred_at = s(row.sent_at);
  const source_id = s(row.message_id) ?? s(row.id);
  if (!client_key || !occurred_at || !source_id) return null;
  const inbound = String(row.direction ?? "").toLowerCase().startsWith("in");
  const event_type = inbound ? "dm_in" : "dm_out";
  return {
    client_key,
    event_type,
    subscriber_id,
    contact_id: s(row.contact_id),
    display_name: null,
    keyword_normalized: null,
    occurred_at,
    occurred_day_et: dayET(occurred_at),
    amount_cents: null,
    actor: inbound ? null : s(row.setter_name),
    summary: `${inbound ? "DM in" : "DM out"}${s(row.body) ? `: ${snippet(row.body)}` : ""}`,
    source: "dm_conversation_messages",
    source_id,
    payload: { direction: row.direction, channel: row.channel, message_type: row.message_type },
  };
}

export function mapKeywordEvent(row: Row): FoundationEvent | null {
  const client_key = foundationClientKey(s(row.client_key));
  const occurred_at = s(row.event_at);
  const source_id = s(row.source_event_id) ?? s(row.id);
  if (!client_key || !occurred_at || !source_id) return null;
  const kw = s(row.keyword_normalized);
  const subscriber_id = s(row.subscriber_id);
  const type = String(row.event_type ?? "");
  if (type === "dm_keyword") {
    return {
      client_key,
      event_type: "keyword_hit",
      subscriber_id,
      contact_id: s(row.contact_id),
      display_name: s(row.subscriber_name) ?? s(row.contact_name),
      keyword_normalized: kw,
      occurred_at,
      occurred_day_et: dayET(occurred_at),
      amount_cents: null,
      actor: s(row.setter_name),
      summary: kw ? `Came in on '${kw}'` : "Came in (no keyword)",
      source: "ads_keyword_events",
      source_id,
      payload: { subscriber_name: row.subscriber_name },
    };
  }
  if (type === "booked_call" || type === "manual_booked_calls") {
    return {
      client_key,
      event_type: "call_booked",
      subscriber_id,
      contact_id: s(row.contact_id),
      display_name: s(row.subscriber_name) ?? s(row.contact_name),
      keyword_normalized: kw,
      occurred_at,
      occurred_day_et: dayET(occurred_at),
      amount_cents: null,
      actor: s(row.setter_name),
      summary: `Booked a call${kw ? ` (via '${kw}')` : ""}`,
      source: "ads_keyword_events",
      source_id,
      payload: { appointment_id: row.appointment_id },
    };
  }
  return null;
}

/** A sales-tracker row can spawn a call_taken and/or a sale event. */
export function mapSalesRow(row: Row): FoundationEvent[] {
  const client_key = foundationClientKey(s(row.offer));
  // Order the stream by the sheet's ET business DATE (rendered as noon ET), not the DB
  // import time — `created_at` is when the row landed, which stamped whole backfills to one day.
  const rawDate = s(row.date);
  const occurred_at = rawDate ? `${rawDate}T16:00:00Z` : s(row.created_at);
  const source_id = s(row.sheet_row_key) ?? s(row.id);
  if (!client_key || !occurred_at || !source_id) return [];
  const subscriber_id = s(row.manychat_subscriber_id);
  const name = s(row.prospect_name);
  const dayEt = dayET(rawDate ?? occurred_at); // sales tracker's ET business day
  const outcome = s(row.outcome);
  const closer = s(row.closer);
  const collected = Number(row.collected_revenue_cents ?? 0) || 0;
  const out: FoundationEvent[] = [];

  if (row.call_taken === true) {
    out.push({
      client_key,
      event_type: "call_taken",
      subscriber_id,
      contact_id: null,
      display_name: name,
      keyword_normalized: null,
      occurred_at,
      occurred_day_et: dayEt,
      amount_cents: null,
      actor: closer,
      summary: `Call taken${outcome ? ` (${outcome})` : ""}`,
      source: "sales_tracker_rows",
      source_id,
      payload: { outcome, closer, setter: row.setter },
    });
  }
  if (collected > 0) {
    out.push({
      client_key,
      event_type: "sale",
      subscriber_id,
      contact_id: null,
      display_name: name,
      keyword_normalized: null,
      occurred_at,
      occurred_day_et: dayEt,
      amount_cents: collected,
      actor: closer,
      summary: `CLOSED $${dollars(collected)}${closer ? ` (${closer})` : ""}`,
      source: "sales_tracker_rows",
      source_id,
      payload: {
        outcome,
        closer,
        setter: row.setter,
        contracted_revenue_cents: row.contracted_revenue_cents,
        program_length: row.program_length,
      },
    });
  }
  return out;
}

/** GHL appointment: full booking record. subscriber_id resolved by the worker via contact_id. */
export function mapGhlAppointment(row: Row, subscriberId: string | null): FoundationEvent | null {
  if (String(row.status ?? "").toLowerCase() === "cancelled") return null;
  const client_key = foundationClientKey(s(row.client));
  const occurred_at = s(row.created_at) ?? s(row.start_time);
  const source_id = s(row.appointment_id) ?? s(row.id);
  if (!client_key || !occurred_at || !source_id) return null;
  const kw = s(row.keyword_normalized);
  return {
    client_key,
    event_type: "call_booked",
    subscriber_id: subscriberId,
    contact_id: s(row.contact_id),
    display_name: s(row.contact_name),
    keyword_normalized: kw,
    occurred_at,
    occurred_day_et: dayET(occurred_at),
    amount_cents: null,
    actor: s(row.closer_name),
    summary: `Booked a call${kw ? ` (via '${kw}')` : ""}${s(row.contact_name) ? ` — ${s(row.contact_name)}` : ""}`,
    source: "ghl_appointments",
    source_id,
    payload: { status: row.status, start_time: row.start_time, calendar_name: row.calendar_name },
  };
}

export function mapFathomCall(row: Row): FoundationEvent | null {
  const client_key = foundationClientKey(s(row.client_key));
  const occurred_at = s(row.recorded_at) ?? s(row.created_at);
  const source_id = s(row.fathom_id) ?? s(row.id);
  if (!client_key || !occurred_at || !source_id) return null;
  const who = s(row.prospect_name) ?? s(row.title) ?? "call";
  return {
    client_key,
    event_type: "fathom_call",
    subscriber_id: null,
    contact_id: null,
    display_name: s(row.prospect_name),
    keyword_normalized: null,
    occurred_at,
    occurred_day_et: dayET(occurred_at),
    amount_cents: null,
    actor: null,
    summary: `Sales call recorded: ${who}`,
    source: "fathom_calls",
    source_id,
    payload: { title: row.title, prospect_name: row.prospect_name, duration_sec: row.duration_sec },
  };
}

// ---- deterministic per-lead story --------------------------------------

export type LeadRollup = {
  first_keyword: string | null;
  first_seen_at: string | null;
  dm_in_count: number;
  dm_out_count: number;
  qualified: boolean;
  booking_readiness_score: number;
  booked: boolean;
  taken: boolean;
  closed: boolean;
  amount_cents: number | null;
  setter_name: string | null;
  closer_name: string | null;
};

export function buildStory(l: LeadRollup): string {
  const parts: string[] = [];
  const when = shortDayET(l.first_seen_at);
  const dms = (l.dm_in_count || 0) + (l.dm_out_count || 0);
  if (l.first_keyword) parts.push(`Came in on '${l.first_keyword}'${when ? ` ${when}` : ""}`);
  else if (dms > 0) parts.push(`Came in via DM${when ? ` ${when}` : ""}`);
  else parts.push(`First seen${when ? ` ${when}` : ""} (no ad DM captured)`);
  if (dms > 0) {
    const q = [`readiness ${l.booking_readiness_score || 0}`, l.qualified ? "qualified" : null]
      .filter(Boolean)
      .join(", ");
    parts.push(`${dms} DMs (${q})`);
  }
  if (l.booked) parts.push("booked");
  if (l.taken) parts.push("taken");
  if (l.closed) parts.push(`CLOSED $${dollars(l.amount_cents)}`);
  else if (!l.booked && !l.taken) parts.push("still talking");
  const who = [
    l.setter_name ? `setter ${l.setter_name}` : null,
    l.closer_name ? `closer ${l.closer_name}` : null,
  ]
    .filter(Boolean)
    .join(" / ");
  const line = parts.join(" → ");
  return who ? `${line} (${who})` : line;
}
