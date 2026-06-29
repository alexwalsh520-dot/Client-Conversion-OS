// Daily recap engine — composes the numbers for the 1am ET previous-day recap.
//
// All data comes from existing CCOS sources; nothing new is integrated here:
//   • Ad spend   → ads_meta_insights_daily (synced, ET-bucketed; same as ads tab)
//   • Leads      → getLeadHours() (ManyChat `new_lead` tag, ET hour buckets)
//   • Calls      → ghl_appointments table (Strategy Session calendars, by client)
//   • Sales/cash → sales tracker sheet (outcome=WIN / Cash Collected / Call Taken)
//
// Every source is wrapped so one failure degrades to "—" + a warning rather than
// killing the whole report.

import { getServiceSupabase } from "@/lib/supabase";
import { getLeadHours } from "@/lib/sales-hub/lead-hours";
import { CREATORS_BY_KEY, creatorKeyFromText, type CreatorKey } from "@/lib/creators";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import {
  addDays,
  etDateStr,
  etDayBoundsUtc,
  startOfEtMonth,
  startOfEtWeek,
} from "./time";

/** Clients shown in the report, in display order. */
export const REPORT_CLIENTS: CreatorKey[] = ["tyson", "antwan"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MoneyRow {
  spend: number | null;
  leads: number;
  cpl: number | null; // cost per lead
  booked: number | null; // sales calls booked (created) in the period
  cpbc: number | null; // cost per booked call
}

export interface EodClient {
  client: CreatorKey;
  label: string;
  money: { day: MoneyRow; wtd: MoneyRow; mtd: MoneyRow };
  sales: { taken: number; sales: number; cash: number };
  upcoming: number | null; // sales calls scheduled for the next day
}

export interface EodReport {
  kind: "eod";
  recapDay: string;
  weekStart: string;
  monthStart: string;
  upcomingDay: string;
  generatedAt: string;
  clients: EodClient[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function safe<T>(
  label: string,
  warnings: string[],
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    warnings.push(`${label}: ${msg}`);
    console.error(`[daily-report] ${label} failed:`, e);
    return fallback;
  }
}

function sumCounts(counts: number[] | undefined): number {
  if (!counts) return 0;
  return counts.reduce((a, b) => a + b, 0);
}

function ratio(numer: number | null, denom: number | null): number | null {
  if (numer == null || !denom) return null;
  return numer / denom;
}

// ---------------------------------------------------------------------------
// Leads (ManyChat new_lead, ET hour buckets per client)
// ---------------------------------------------------------------------------

/** Per-client 24-hour ET lead counts for [dateFrom, dateTo]. */
async function getLeadCounts(
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, number[]>> {
  const res = await getLeadHours({ client: "all", dateFrom, dateTo });
  const out: Record<string, number[]> = {};
  for (const offer of res.offers) out[offer.id] = offer.counts;
  return out;
}

// ---------------------------------------------------------------------------
// Ad spend (synced daily table — ET-bucketed, same source as the ads tab)
// ---------------------------------------------------------------------------

/**
 * Per-client spend-by-ET-day for [fromDay, toDay] from `ads_meta_insights_daily`
 * (already ET-bucketed; verified to match a live hourly re-bucket to the dollar).
 * Covers every client the ads sync handles, with no per-client Meta token needed
 * at report time.
 */
async function fetchDailySpend(
  fromDay: string,
  toDay: string,
): Promise<Record<string, Record<string, number>>> {
  const db = getServiceSupabase();
  const out: Record<string, Record<string, number>> = {};
  const size = 1000;
  for (let off = 0; off < 200000; off += size) {
    const { data, error } = await db
      .from("ads_meta_insights_daily")
      .select("client_key,date,spend_cents")
      .in("client_key", REPORT_CLIENTS)
      .gte("date", fromDay)
      .lte("date", toDay)
      .range(off, off + size - 1);
    if (error) throw new Error(error.message);
    const batch = (data || []) as Array<{ client_key: string; date: string; spend_cents: number | null }>;
    for (const r of batch) {
      (out[r.client_key] ||= {});
      out[r.client_key][r.date] = (out[r.client_key][r.date] || 0) + Number(r.spend_cents || 0) / 100;
    }
    if (batch.length < size) break;
  }
  return out;
}

function sumDays(byDay: Record<string, number>, fromDay: string, toDay: string): number {
  let s = 0;
  for (const [day, amt] of Object.entries(byDay)) {
    if (day >= fromDay && day <= toDay) s += amt;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Appointments (ghl_appointments — Strategy Session calendars, per client)
// ---------------------------------------------------------------------------

// Sales calls are the client's "Strategy Session (XX)" calendar(s). Onboarding,
// coaching 1:1s and reschedule calendars are intentionally excluded — this is the
// lead→sale call the ad spend is paying for. Matched on calendar_name because the
// derived `client` column has gaps.
function callPattern(client: CreatorKey): string {
  if (client === "tyson") return "Strategy Session%(TS)%";
  if (client === "antwan") return "Strategy Session%(AR)%";
  if (client === "keith") return "Strategy Session%(KH)%";
  if (client === "lucy") return "Strategy Session%(LH)%";
  return "Strategy Session%";
}

/** Count non-cancelled sales-call appointments where `field` is in the ET days [fromDay, toDay]. */
async function countAppointmentsForDays(
  client: CreatorKey,
  field: "start_time" | "created_at",
  fromDay: string,
  toDay: string,
): Promise<number> {
  const startMs = etDayBoundsUtc(fromDay).startMs;
  const endMs = etDayBoundsUtc(toDay).endMs;
  const db = getServiceSupabase();
  const { count, error } = await db
    .from("ghl_appointments")
    .select("appointment_id", { count: "exact", head: true })
    .ilike("calendar_name", callPattern(client))
    .neq("status", "cancelled")
    .gte(field, new Date(startMs).toISOString())
    .lt(field, new Date(endMs).toISOString());
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Sales + cash (sales tracker sheet, per client)
// ---------------------------------------------------------------------------

function sheetForClient(rows: SheetRow[], client: CreatorKey) {
  const crows = rows.filter((r) => creatorKeyFromText(r.offer) === client);
  return {
    // Column F (Call Taken): filled = taken, empty = hasn't happened yet (excluded).
    taken: crows.filter((r) => r.callTaken).length,
    sales: crows.filter((r) => (r.outcome || "").toUpperCase() === "WIN").length,
    cash: crows.reduce((s, r) => s + (r.cashCollected || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Report builder — previous-day recap (fires 1am ET)
// ---------------------------------------------------------------------------

export async function buildEodReport(now: Date): Promise<EodReport> {
  const warnings: string[] = [];
  const todayStr = etDateStr(now); // e.g. fires 1am Jun 29 → "2026-06-29"
  const recapDay = addDays(todayStr, -1); // the day that just ended → "2026-06-28"
  const weekStart = startOfEtWeek(recapDay);
  const monthStart = startOfEtMonth(recapDay);
  const upcomingDay = todayStr; // calls scheduled for the new day

  const leadsDay = await safe("leads:day", warnings, () => getLeadCounts(recapDay, recapDay), {});
  const leadsWtd = await safe("leads:wtd", warnings, () => getLeadCounts(weekStart, recapDay), {});
  const leadsMtd = await safe("leads:mtd", warnings, () => getLeadCounts(monthStart, recapDay), {});
  const sheet = await safe("sheet", warnings, () => fetchSheetData(recapDay, recapDay), [] as SheetRow[]);
  // One read of the synced daily-spend table for the whole month, per client.
  const dailySpend = await safe(
    "ads:daily",
    warnings,
    () => fetchDailySpend(monthStart, recapDay),
    {} as Record<string, Record<string, number>>,
  );

  const clients: EodClient[] = [];
  for (const client of REPORT_CLIENTS) {
    const byDay = dailySpend[client];
    const spendDay = byDay ? sumDays(byDay, recapDay, recapDay) : null;
    const spendWtd = byDay ? sumDays(byDay, weekStart, recapDay) : null;
    const spendMtd = byDay ? sumDays(byDay, monthStart, recapDay) : null;

    const bookedDay = await safe(`bk:day:${client}`, warnings, () => countAppointmentsForDays(client, "created_at", recapDay, recapDay), null);
    const bookedWtd = await safe(`bk:wtd:${client}`, warnings, () => countAppointmentsForDays(client, "created_at", weekStart, recapDay), null);
    const bookedMtd = await safe(`bk:mtd:${client}`, warnings, () => countAppointmentsForDays(client, "created_at", monthStart, recapDay), null);

    const mk = (spend: number | null, leadCounts: number[] | undefined, booked: number | null): MoneyRow => {
      const leads = sumCounts(leadCounts);
      return { spend, leads, cpl: ratio(spend, leads), booked, cpbc: ratio(spend, booked) };
    };

    const upcoming = await safe(`up:${client}`, warnings, () => countAppointmentsForDays(client, "start_time", upcomingDay, upcomingDay), null);

    clients.push({
      client,
      label: CREATORS_BY_KEY[client].name,
      money: {
        day: mk(spendDay, leadsDay[client], bookedDay),
        wtd: mk(spendWtd, leadsWtd[client], bookedWtd),
        mtd: mk(spendMtd, leadsMtd[client], bookedMtd),
      },
      sales: sheetForClient(sheet, client),
      upcoming,
    });
  }

  return {
    kind: "eod",
    recapDay,
    weekStart,
    monthStart,
    upcomingDay,
    generatedAt: now.toISOString(),
    clients,
    warnings,
  };
}
