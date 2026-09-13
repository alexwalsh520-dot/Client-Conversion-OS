// Sets Booked — bookings counted at the moment the lead actually scheduled
// the call (owner definition, 2026-09-11: "it's not from when the link was
// sent, it's not from when the lead came in, it's from the actual time of
// them scheduling the call"). Strategy sessions only — onboarding calls are
// not sets; personal-calendar/outbound sales calls count (the tracker logs
// them as Strategy Session rows).
//
// Source: warehouse.ghl_appointments DIRECTLY — rows land the moment the GHL
// webhook fires, so the number never lags the #appointment-notifs channel.
// (v1 read the metrics_lead_events booking stream, which is rebuilt hourly
// by the metrics-ledger-build cron — up to an hour behind Slack; that gap is
// exactly the "channel says 8, hub says 7" incident of 2026-09-13.)
// created_at is the scheduling moment, verified against GHL's own
// calendar.date_created. The sales tracker's Date column is the CALL day,
// so it can never answer "how many sets were made today"; it is only used
// here to attribute each set to its setter.

import { getServiceSupabase } from "@/lib/supabase";
import { getActiveClients, getSetterLabelMap } from "@/lib/registry";
import { fetchSheetData } from "@/lib/google-sheets";
import { isExcludedSetter } from "@/lib/sales-hub/excluded-setters";
import { toEtDateStr } from "@/lib/sales-hub/response-times";
import { engineCalendar } from "@/lib/metrics-engine/calendars";

export interface SetBookedRow {
  madeAt: string; // ISO instant the lead scheduled
  madeEtDay: string;
  leadName: string;
  callType: string | null; // dm / outbound (onboarding is excluded)
  callEtDay: string | null; // the day the call is scheduled to happen
  setterKey: string;
  setterLabel: string;
  status: string | null; // GHL appointment status (booked / cancelled / …)
}

export interface SetsBookedResult {
  team: number;
  bySetter: { key: string; label: string; count: number }[];
  byDay: { etDay: string; count: number }[];
  rows: SetBookedRow[]; // newest first
  asOf: string;
}

interface ApptRow {
  appointment_id: string;
  contact_id: string | null;
  contact_name: string | null;
  calendar_id: string | null;
  status: string | null;
  start_time: string | null;
  created_at: string;
}

interface TagEventRow {
  client: string;
  subscriber_id: string;
  setter_name: string | null;
  event_at: string;
}

const PAGE = 1000;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function normName(raw: string | null | undefined): string {
  return (raw || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string): number {
  return Math.abs(
    (new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000,
  );
}

export async function getSetsBooked(opts: {
  dateFrom: string; // YYYY-MM-DD (ET)
  dateTo: string;
}): Promise<SetsBookedResult> {
  const { dateFrom, dateTo } = opts;
  const db = getServiceSupabase();

  // 1) Appointments CREATED in the ET range on a strategy-session calendar
  //    (dm funnel or a rep's personal/outbound calendar). Onboarding and
  //    reschedule calendars never count: onboarding is not a set, and a
  //    reschedule re-books an existing set.
  const appts: ApptRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .schema("warehouse")
      .from("ghl_appointments")
      .select("appointment_id, contact_id, contact_name, calendar_id, status, start_time, created_at")
      .gte("created_at", `${shiftDay(dateFrom, -1)}T00:00:00.000Z`)
      .lte("created_at", `${shiftDay(dateTo, 1)}T23:59:59.999Z`)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`ghl_appointments: ${error.message}`);
    appts.push(...((data || []) as ApptRow[]));
    if (!data || data.length < PAGE) break;
  }
  const inRange = appts.filter((a) => {
    const cal = a.calendar_id ? engineCalendar(a.calendar_id) : null;
    if (!cal || (cal.side !== "dm" && cal.side !== "outbound")) return false;
    const day = toEtDateStr(a.created_at);
    return day >= dateFrom && day <= dateTo;
  });

  // 2) One set per lead per day — a same-day rebook/reschedule is not a new set.
  const byKey = new Map<string, ApptRow>();
  for (const a of inRange) {
    const lead = normName(a.contact_name) || a.contact_id || a.appointment_id;
    const key = `${lead}:${toEtDateStr(a.created_at)}`;
    if (!byKey.has(key)) byKey.set(key, a); // earliest booking wins
  }
  const sets = [...byKey.values()];

  // 3) GHL contact -> ManyChat subscriber bridge (for the assignment fallback).
  const mcByContact = new Map<string, string>();
  const contactIds = [...new Set(sets.map((a) => a.contact_id).filter((x): x is string => Boolean(x)))];
  for (const ids of chunk(contactIds, 200)) {
    const { data } = await db
      .from("manychat_contact_links")
      .select("ghl_contact_id, subscriber_id")
      .in("ghl_contact_id", ids);
    for (const l of (data || []) as { ghl_contact_id: string | null; subscriber_id: string | null }[]) {
      if (l.ghl_contact_id && l.subscriber_id && !mcByContact.has(l.ghl_contact_id)) {
        mcByContact.set(l.ghl_contact_id, l.subscriber_id);
      }
    }
  }

  // 4) Setter attribution: tracker row (Setter column) by name+call-day,
  //    else the lead's ManyChat setter assignment, else Unassigned.
  const labelMap: Record<string, string> = await getSetterLabelMap().catch(() => ({}));
  const resolveLabel = (raw: string | null | undefined): { key: string; label: string } | null => {
    const trimmed = (raw || "").trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    // The AI DM setter logs rows as "AI" — it stays AI, never title-cased
    // to "Ai" and never folded into a person.
    if (lower === "ai" || lower === "a.i.") return { key: "ai", label: "AI" };
    if (labelMap[lower]) return { key: lower, label: labelMap[lower] };
    for (const token of lower.split(/[^a-z]+/)) {
      if (token && labelMap[token]) return { key: token, label: labelMap[token] };
    }
    return { key: lower, label: trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase() };
  };

  const trackerSetter = new Map<string, { setter: string; etDay: string }[]>();
  try {
    const sheetRows = await fetchSheetData(shiftDay(dateFrom, -1), shiftDay(dateTo, 21));
    for (const r of sheetRows) {
      if (r.programLength === "Subscription" || !r.setter) continue;
      const key = normName(r.name);
      if (!key) continue;
      (trackerSetter.get(key) ?? trackerSetter.set(key, []).get(key)!).push({ setter: r.setter, etDay: r.date });
    }
  } catch {
    // tracker unreachable — ManyChat assignment fallback still applies
  }

  let assignments = new Map<string, TagEventRow[]>();
  try {
    const actives = await getActiveClients();
    const clientKeys = actives.length > 0 ? actives.map((c) => c.manychatKey) : ["tyson_sonnek"];
    const tagRows: TagEventRow[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await db
        .from("manychat_tag_events")
        .select("client, subscriber_id, setter_name, event_at")
        .in("client", clientKeys)
        .not("setter_name", "is", null)
        .gte("event_at", `${shiftDay(dateFrom, -120)}T00:00:00.000Z`)
        .lte("event_at", `${shiftDay(dateTo, 1)}T23:59:59.999Z`)
        .order("event_at", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) break;
      tagRows.push(...((data || []) as TagEventRow[]));
      if (!data || data.length < PAGE) break;
    }
    for (const t of tagRows) {
      if (!t.subscriber_id) continue;
      (assignments.get(t.subscriber_id) ?? assignments.set(t.subscriber_id, []).get(t.subscriber_id)!).push(t);
    }
  } catch {
    assignments = new Map();
  }

  const setterFor = (a: ApptRow): { key: string; label: string } => {
    const madeDay = toEtDateStr(a.created_at);
    const callDay = a.start_time ? toEtDateStr(a.start_time) : madeDay;
    const name = normName(a.contact_name);
    if (name) {
      const candidates = trackerSetter.get(name);
      if (candidates && candidates.length > 0) {
        let best = candidates[0];
        for (const c of candidates) {
          if (dayDiff(c.etDay, callDay) < dayDiff(best.etDay, callDay)) best = c;
        }
        if (dayDiff(best.etDay, callDay) <= 7) {
          const resolved = resolveLabel(best.setter);
          if (resolved) return resolved;
        }
      }
    }
    const mcId = a.contact_id ? mcByContact.get(a.contact_id) : null;
    if (mcId) {
      const list = assignments.get(mcId) || [];
      let last: TagEventRow | null = null;
      for (const t of list) {
        if (t.event_at <= a.created_at) last = t;
        else break;
      }
      const resolved = resolveLabel(last?.setter_name);
      if (resolved) return resolved;
    }
    return { key: "unassigned", label: "Unassigned" };
  };

  const rows: SetBookedRow[] = sets.map((a) => {
    const cal = a.calendar_id ? engineCalendar(a.calendar_id) : null;
    let { key, label } = setterFor(a);
    if (isExcludedSetter(key)) ({ key, label } = { key: "unassigned", label: "Unassigned" });
    return {
      madeAt: a.created_at,
      madeEtDay: toEtDateStr(a.created_at),
      leadName: (a.contact_name || "Unknown lead").trim(),
      callType: cal?.side || null,
      callEtDay: a.start_time ? toEtDateStr(a.start_time) : null,
      setterKey: key,
      setterLabel: label,
      status: a.status,
    };
  });
  rows.sort((a, b) => b.madeAt.localeCompare(a.madeAt));

  const bySetterMap = new Map<string, { label: string; count: number }>();
  const byDayMap = new Map<string, number>();
  for (const r of rows) {
    const s = bySetterMap.get(r.setterKey) || { label: r.setterLabel, count: 0 };
    s.count += 1;
    bySetterMap.set(r.setterKey, s);
    byDayMap.set(r.madeEtDay, (byDayMap.get(r.madeEtDay) || 0) + 1);
  }

  return {
    team: rows.length,
    bySetter: [...bySetterMap.entries()]
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    byDay: [...byDayMap.entries()]
      .map(([etDay, count]) => ({ etDay, count }))
      .sort((a, b) => a.etDay.localeCompare(b.etDay)),
    rows,
    asOf: new Date().toISOString(),
  };
}
