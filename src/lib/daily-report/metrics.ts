// Daily metrics engine — composes the numbers for the two Slack reports.
//
// All data comes from existing CCOS sources; nothing new is integrated here:
//   • Ad spend   → live Meta hourly insights, re-bucketed to ET (per-account tz)
//   • Leads      → getLeadHours() (ManyChat `new_lead` tag, ET hour buckets)
//   • Calls      → ghl_appointments table (Strategy Session calendars, by client)
//   • Sales/cash → sales tracker sheet (outcome=WIN / Cash Collected / Call Taken)
//
// Every source is wrapped so one failure degrades to "—" + a warning rather than
// killing the whole report.

import { getServiceSupabase } from "@/lib/supabase";
import { getLeadHours } from "@/lib/sales-hub/lead-hours";
import {
  CREATORS_BY_KEY,
  creatorKeyFromText,
  firstEnv,
  normalizeAdAccountId,
  type CreatorKey,
} from "@/lib/creators";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import {
  ET,
  addDays,
  etDateStr,
  etDayBoundsUtc,
  etWindowUtc,
  startOfEtMonth,
  startOfEtWeek,
  zonedMs,
} from "./time";

/** Clients shown in the report, in display order. */
export const REPORT_CLIENTS: CreatorKey[] = ["tyson", "antwan"];

// Eastern window for the midday report: 5:00am → 5:00pm.
const MIDDAY_START_HOUR = 5;
const MIDDAY_END_HOUR = 17;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdsBlock {
  spend: number | null;
  approx: boolean; // spend came from the daily-table fallback (full-day-so-far), not the live 5a–5p slice
  leads: number;
  cpl: number | null; // cost per lead
  booked: number | null; // appointments booked (created) in the window
  cpbc: number | null; // cost per booked call
}

export interface MiddayClientRow {
  client: CreatorKey;
  label: string;
  ads: AdsBlock;
  sched: number | null; // sales calls scheduled to occur 5a–5p
  taken: number; // calls taken (from sheet — lags)
  sales: number; // wins (from sheet — lags)
  cash: number; // cash collected (from sheet — lags)
  callsLeft: number | null; // sales calls still on the calendar 5p–midnight
}

export interface MiddayReport {
  kind: "midday";
  dateStr: string;
  generatedAt: string;
  clients: MiddayClientRow[];
  warnings: string[];
}

export interface MoneyRow {
  spend: number | null;
  leads: number;
  cpl: number | null;
  booked: number | null;
  cpbc: number | null;
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

function sumCounts(counts: number[] | undefined, from = 0, to = 24): number {
  if (!counts) return 0;
  return counts.slice(from, to).reduce((a, b) => a + b, 0);
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
// Ad spend (live Meta hourly, re-bucketed PT/ET via the account's own tz)
// ---------------------------------------------------------------------------

interface HourlySpendRow {
  date_start: string;
  hour: number;
  spend: number;
}

/**
 * Account-level hourly spend rows for [sinceDay-1, untilDay] in the ad
 * account's reporting timezone. Lightweight (24 × days rows), so it scales to a
 * month-to-date pull. Returns null when the client's Meta env isn't configured.
 */
async function metaHourlyRows(
  client: CreatorKey,
  sinceDay: string,
  untilDay: string,
): Promise<HourlySpendRow[] | null> {
  const creator = CREATORS_BY_KEY[client];
  const accountRaw = firstEnv(creator.adAccountEnv) ?? creator.defaultAdAccountId;
  const token = firstEnv(creator.tokenEnv);
  if (!accountRaw || !token) return null;
  const account = normalizeAdAccountId(accountRaw);

  // Pad one day earlier so an ET morning that maps to the prior account-day is covered.
  const timeRange = JSON.stringify({ since: addDays(sinceDay, -1), until: untilDay });
  let url: string | null =
    `https://graph.facebook.com/v21.0/${account}/insights?fields=spend&time_increment=1` +
    `&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&limit=500` +
    `&time_range=${encodeURIComponent(timeRange)}&access_token=${token}`;

  const rows: HourlySpendRow[] = [];
  while (url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Meta ${res.status} for ${client}`);
    const json = (await res.json()) as {
      data: Array<{
        date_start: string;
        spend?: string;
        hourly_stats_aggregated_by_advertiser_time_zone?: string;
      }>;
      paging?: { next?: string };
    };
    for (const r of json.data || []) {
      rows.push({
        date_start: r.date_start,
        hour: Number((r.hourly_stats_aggregated_by_advertiser_time_zone || "00:00:00").slice(0, 2)),
        spend: Number(r.spend || 0),
      });
    }
    url = json.paging?.next || null;
  }
  return rows;
}

/** Sum hourly spend whose hour-instant falls in [startMs, endMs). */
function spendInWindow(
  rows: HourlySpendRow[],
  advTz: string,
  startMs: number,
  endMs: number,
): number {
  let spend = 0;
  for (const r of rows) {
    const ms = zonedMs(r.date_start, r.hour, 0, advTz);
    if (ms >= startMs && ms < endMs) spend += r.spend;
  }
  return spend;
}

/**
 * Per-client spend-by-ET-day for [fromDay, toDay] from the synced
 * `ads_meta_insights_daily` table (already ET-bucketed; verified to match the
 * live hourly re-bucket to the dollar). Used for the EOD recap's complete days —
 * lighter than a month of hourly pulls and works for every client the ads sync
 * covers, with no per-client Meta token needed at report time.
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

/**
 * Count non-cancelled sales-call appointments where `field` (start_time =
 * scheduled to occur, created_at = booked) falls in [startMs, endMs).
 */
async function countAppointments(
  client: CreatorKey,
  field: "start_time" | "created_at",
  startMs: number,
  endMs: number,
): Promise<number> {
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

/** Count sales calls with `field` inside the ET days [fromDay, toDay]. */
async function countAppointmentsForDays(
  client: CreatorKey,
  field: "start_time" | "created_at",
  fromDay: string,
  toDay: string,
): Promise<number> {
  const startMs = etDayBoundsUtc(fromDay).startMs;
  const endMs = etDayBoundsUtc(toDay).endMs;
  return countAppointments(client, field, startMs, endMs);
}

// ---------------------------------------------------------------------------
// Sales + cash (sales tracker sheet, per client)
// ---------------------------------------------------------------------------

function sheetForClient(rows: SheetRow[], client: CreatorKey) {
  const crows = rows.filter((r) => creatorKeyFromText(r.offer) === client);
  return {
    taken: crows.filter((r) => r.callTaken).length,
    sales: crows.filter((r) => (r.outcome || "").toUpperCase() === "WIN").length,
    cash: crows.reduce((s, r) => s + (r.cashCollected || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Report builders
// ---------------------------------------------------------------------------

export async function buildMiddayReport(now: Date): Promise<MiddayReport> {
  const warnings: string[] = [];
  const dateStr = etDateStr(now);
  const win = etWindowUtc(dateStr, MIDDAY_START_HOUR, MIDDAY_END_HOUR);
  const dayEndMs = etDayBoundsUtc(dateStr).endMs;

  const leads = await safe("leads", warnings, () => getLeadCounts(dateStr, dateStr), {});
  const sheet = await safe("sheet", warnings, () => fetchSheetData(dateStr, dateStr), [] as SheetRow[]);

  const clients: MiddayClientRow[] = [];
  for (const client of REPORT_CLIENTS) {
    const tz = CREATORS_BY_KEY[client].timezone;
    const rows = await safe(`ads:${client}`, warnings, () => metaHourlyRows(client, dateStr, dateStr), null);
    let spend = rows ? spendInWindow(rows, tz, win.startMs, win.endMs) : null;
    let approx = false;
    if (spend == null) {
      // Live intraday slice unavailable (e.g. a Meta token issue) → fall back to
      // the synced daily table's today-so-far total, the SAME source the CCOS ads
      // tab uses. Slightly wider than 5a–5p (includes overnight) but never blank.
      const daily = await safe(
        `ads-fallback:${client}`,
        warnings,
        () => fetchDailySpend(dateStr, dateStr),
        {} as Record<string, Record<string, number>>,
      );
      if (daily[client]) {
        spend = sumDays(daily[client], dateStr, dateStr);
        approx = true;
      }
    }
    const leadCount = sumCounts(leads[client], MIDDAY_START_HOUR, MIDDAY_END_HOUR);
    const booked = await safe(`booked:${client}`, warnings, () => countAppointments(client, "created_at", win.startMs, win.endMs), null);
    const sched = await safe(`sched:${client}`, warnings, () => countAppointments(client, "start_time", win.startMs, win.endMs), null);
    const callsLeft = await safe(`left:${client}`, warnings, () => countAppointments(client, "start_time", win.endMs, dayEndMs), null);
    const s = sheetForClient(sheet, client);

    clients.push({
      client,
      label: CREATORS_BY_KEY[client].name,
      ads: {
        spend,
        approx,
        leads: leadCount,
        cpl: ratio(spend, leadCount),
        booked,
        cpbc: ratio(spend, booked),
      },
      sched,
      taken: s.taken,
      sales: s.sales,
      cash: s.cash,
      callsLeft,
    });
  }

  return { kind: "midday", dateStr, generatedAt: now.toISOString(), clients, warnings };
}

export async function buildEodReport(now: Date): Promise<EodReport> {
  const warnings: string[] = [];
  const todayStr = etDateStr(now); // e.g. fires 1am Jun 24 → "2026-06-24"
  const recapDay = addDays(todayStr, -1); // the day that just ended → "2026-06-23"
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

// Re-exported only so the cron routes can reference the ET timezone constant if needed.
export { ET };
