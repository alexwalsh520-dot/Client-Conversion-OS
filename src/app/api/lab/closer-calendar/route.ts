import { NextRequest, NextResponse } from "next/server";

/**
 * Closer calendar gate (Lab tab).
 *
 * Two reads in one call:
 *
 *   1. CURRENT availability (the gate value): how full is the creator's
 *      bookable time RIGHT NOW — from now to +7 days.
 *        filledPct = bookedUpcoming / (bookedUpcoming + openSlots)
 *      `openSlots` comes from /calendars/{id}/free-slots; `bookedUpcoming`
 *      comes from /calendars/events over now→+7d.
 *
 *   2. Daily booked history (backward + forward context): a per-ET-day count
 *      of booked events across a window that straddles today (default = past
 *      7 days through next 7 days). `recentBooked` = booked in the past 7 days.
 *
 * ALWAYS returns 200 — never 500 — so the Lab gate can render "awaiting data"
 * instead of crashing. On any missing cred / failed fetch / unknown response
 * shape we return { status: "unknown", reason }.
 *
 * GHL v2 auth/fetch pattern copied verbatim from
 * src/app/api/sales-hub/ghl-upcoming/route.ts and daily-brief/route.ts.
 * ET day bucketing mirrors src/app/api/lab/setter-load/route.ts (DST-correct).
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GHL v2 API base
const GHL_V2_BASE = "https://services.leadconnectorhq.com";

// "Current availability" lookahead — the gate always measures the next 7 days.
const AVAIL_DAYS = 7;
// Backward context — count booked events in the trailing 7 days.
const RECENT_DAYS = 7;
// Default daily-history window straddles today: past 7d through next 7d.
const HISTORY_BACK_DAYS = 7;
const HISTORY_FWD_DAYS = 7;

const THRESHOLD_PCT = 0.8;
const ET_TIMEZONE = "America/New_York";

// Statuses that mean the slot is NOT actually taken — exclude these from "booked".
const NON_BOOKED_STATUS = ["cancel", "noshow", "no-show", "no_show", "invalid", "deleted", "declined"];

// ── ET calendar-day helpers (DST-correct), mirrored from setter-load ─────────

const ET_DATE_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in the ET calendar as YYYY-MM-DD. */
function todayEtDateString(): string {
  return ET_DATE_FMT.format(new Date());
}

/** The ET calendar date (YYYY-MM-DD) for a given absolute instant. */
function etDateStringForInstant(instant: Date): string {
  return ET_DATE_FMT.format(instant);
}

/** Validate a YYYY-MM-DD string. */
function isValidYmd(s: string | null): s is string {
  if (!s) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t);
}

/** Add `delta` ET calendar days to a YYYY-MM-DD string (whole-day UTC shift). */
function addDaysYmd(ymd: string, delta: number): string {
  const ms = Date.parse(`${ymd}T00:00:00Z`) + delta * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Inclusive list of ET calendar dates from `from` to `to`, ascending. */
function enumerateEtDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 3660) {
    out.push(cursor);
    cursor = addDaysYmd(cursor, 1);
    guard += 1;
  }
  return out;
}

/**
 * Start of an ET calendar day expressed as a UTC ISO string. Probes the real ET
 * offset for that date so DST is handled correctly.
 */
function startOfEtDayUtcIso(etDate: string): string {
  const probe = new Date(`${etDate}T12:00:00Z`);
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const offsetPart = etParts.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const match = offsetPart.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const offsetHours = match ? Number(match[1]) : -5;
  const offsetMinutes = match && match[2] ? Number(match[2]) : 0;
  const sign = offsetHours < 0 ? -1 : 1;
  const totalOffsetMin = offsetHours * 60 + sign * offsetMinutes;
  const utcMs = Date.parse(`${etDate}T00:00:00Z`) - totalOffsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

/**
 * The window's UTC bounds: [start of `from` ET day, start of the day AFTER `to`
 * ET day). Half-open so the upper bound is exclusive.
 */
function windowUtcBounds(from: string, to: string): { startIso: string; endIso: string } {
  return {
    startIso: startOfEtDayUtcIso(from),
    endIso: startOfEtDayUtcIso(addDaysYmd(to, 1)),
  };
}

// ── GHL creds / calendar resolution ─────────────────────────────────────────

function getHeaders(): Record<string, string> {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY not configured");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: "2021-04-15",
  };
}

function getLocationId(): string {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error("GHL_LOCATION_ID not configured");
  return id;
}

type AccountKey = "tyson" | "antwan";

function resolveCalendarEnv(account: AccountKey): string | undefined {
  if (account === "tyson") return process.env.GHL_CALENDAR_ID_TYSON;
  if (account === "antwan") return process.env.GHL_CALENDAR_ID_ANTWAN;
  return undefined;
}

/**
 * Resolve the calendar id + name for an account.
 * Prefers the env var; falls back to listing calendars and matching by name.
 */
async function resolveCalendar(
  account: AccountKey,
  headers: Record<string, string>,
  locationId: string
): Promise<{ calendarId: string; calendarName: string } | null> {
  const envId = resolveCalendarEnv(account);

  // We still try to fetch a friendly name from the list, but never block on it.
  let listed: Array<{ id: string; name: string }> = [];
  try {
    const calRes = await fetch(`${GHL_V2_BASE}/calendars/?locationId=${locationId}`, { headers });
    if (calRes.ok) {
      const calData = await calRes.json();
      const calendars = calData.calendars || calData.data || calData || [];
      if (Array.isArray(calendars)) {
        listed = calendars
          .map((c: Record<string, unknown>) => ({
            id: String(c.id || c._id || ""),
            name: String(c.name || c.calendarName || ""),
          }))
          .filter((c) => c.id);
      }
    }
  } catch {
    // ignore — list is best-effort
  }

  if (envId) {
    const match = listed.find((c) => c.id === envId);
    return { calendarId: envId, calendarName: match?.name || account };
  }

  // Fallback: match a calendar whose name contains the account word.
  const word = account.toLowerCase();
  const byName = listed.find((c) => c.name.toLowerCase().includes(word));
  if (byName) return { calendarId: byName.id, calendarName: byName.name };

  return null;
}

/**
 * Fetch booked events in [startISO, endISO] and return them as instants.
 * Works for PAST and FUTURE ranges alike. Excludes cancelled/noshow/etc.
 * Robust to response shape (data.events || data.data || data), matching
 * ghl-upcoming. Each returned instant is the event's start time, for ET bucketing.
 */
async function fetchBookedInstants(
  calendarId: string,
  headers: Record<string, string>,
  locationId: string,
  startISO: string,
  endISO: string
): Promise<Date[]> {
  const url =
    `${GHL_V2_BASE}/calendars/events?locationId=${locationId}` +
    `&calendarId=${calendarId}` +
    `&startTime=${encodeURIComponent(startISO)}` +
    `&endTime=${encodeURIComponent(endISO)}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GHL events fetch failed (${res.status})`);
  }
  const data = await res.json();
  const events = data.events || data.data || data || [];
  if (!Array.isArray(events)) return [];

  const instants: Date[] = [];
  for (const evt of events as Array<Record<string, unknown>>) {
    const status = String(evt.appointmentStatus || evt.status || "").toLowerCase();
    // Keep booked/confirmed/showed (and unknown/blank → assume it takes a slot).
    const isExcluded = NON_BOOKED_STATUS.some((s) => status.includes(s));
    if (isExcluded) continue;

    const startRaw = String(evt.startTime || evt.start_time || evt.startTimeISO || "");
    const instant = startRaw ? new Date(startRaw) : null;
    // Keep events with a parseable start; that's what we bucket by ET day.
    if (instant && !Number.isNaN(instant.getTime())) {
      instants.push(instant);
    }
  }
  return instants;
}

/**
 * Count total free slot timestamps across all dates in a window.
 *
 * Endpoint: GET /calendars/{calendarId}/free-slots
 * Params:   startDate / endDate as epoch MILLISECONDS, plus timezone.
 * Response: an availability map keyed by date "YYYY-MM-DD", each value an object
 *           with a `slots` array of timestamp strings.
 * We defensively walk every date-shaped key and tally every slot string we find.
 */
async function countFreeSlots(
  calendarId: string,
  headers: Record<string, string>,
  startEpochMs: number,
  endEpochMs: number
): Promise<number> {
  const tz = ET_TIMEZONE;
  const url =
    `${GHL_V2_BASE}/calendars/${calendarId}/free-slots` +
    `?startDate=${startEpochMs}` +
    `&endDate=${endEpochMs}` +
    `&timezone=${encodeURIComponent(tz)}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GHL free-slots fetch failed (${res.status})`);
  }
  const data = await res.json();
  return tallySlots(data);
}

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Defensively count slot timestamps in a GHL free-slots response.
 * Handles:
 *   { "2026-06-15": { slots: [...] }, ... }           (canonical)
 *   { "2026-06-15": [...] }                            (bare array per date)
 *   { _dates_: { "2026-06-15": { slots: [...] } } }    (nested under _dates_)
 *   { _dates_: ["2026-06-15", ...], "2026-06-15": ... }
 *   { slots: [...] }                                   (flat)
 * Ignores meta keys like traceId / _dates_ when they aren't slot containers.
 */
function tallySlots(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const obj = payload as Record<string, unknown>;

  // If everything is nested under _dates_ as an object map, recurse into it.
  if (obj._dates_ && typeof obj._dates_ === "object" && !Array.isArray(obj._dates_)) {
    return tallySlots(obj._dates_);
  }

  let total = 0;

  // Flat top-level slots array (rare shape).
  if (Array.isArray(obj.slots)) {
    total += obj.slots.length;
  }

  for (const [key, value] of Object.entries(obj)) {
    if (key === "slots") continue; // already counted
    if (key === "_dates_") continue; // meta / handled above
    if (key === "traceId") continue; // meta

    // Only walk date-shaped keys to avoid counting unrelated metadata.
    if (!DATE_KEY_RE.test(key)) continue;

    if (Array.isArray(value)) {
      // { "2026-06-15": ["...", "..."] }
      total += value.length;
    } else if (value && typeof value === "object") {
      const inner = value as Record<string, unknown>;
      if (Array.isArray(inner.slots)) {
        total += inner.slots.length;
      }
    }
  }

  return total;
}

type DailyBooked = { date: string; booked: number };

export async function GET(req: NextRequest) {
  const updatedAt = new Date().toISOString();

  // Parse account (default tyson; accept antwan).
  const raw = (req.nextUrl.searchParams.get("account") || "tyson").toLowerCase().trim();
  const account: AccountKey = raw === "antwan" ? "antwan" : "tyson";
  if (raw !== "tyson" && raw !== "antwan") {
    // Unrecognized account word — be explicit rather than silently defaulting.
    return NextResponse.json({
      account: raw,
      status: "unknown",
      thresholdPct: THRESHOLD_PCT,
      updatedAt,
      reason: `Unsupported account "${raw}". Use account=tyson or account=antwan.`,
    });
  }

  // ── Resolve the daily-history window (straddles today, ET) ────────────────
  // Default = past 7 days THROUGH next 7 days. Honor from/to if valid (inclusive).
  const fromParam = req.nextUrl.searchParams.get("from");
  const toParam = req.nextUrl.searchParams.get("to");
  const todayEt = todayEtDateString();

  let from: string;
  let to: string;
  if (isValidYmd(fromParam) || isValidYmd(toParam)) {
    from = isValidYmd(fromParam) ? fromParam : addDaysYmd(todayEt, -HISTORY_BACK_DAYS);
    to = isValidYmd(toParam) ? toParam : addDaysYmd(todayEt, HISTORY_FWD_DAYS);
    if (from > to) [from, to] = [to, from];
  } else {
    from = addDaysYmd(todayEt, -HISTORY_BACK_DAYS);
    to = addDaysYmd(todayEt, HISTORY_FWD_DAYS);
  }

  const days = enumerateEtDays(from, to);
  const window = { from, to, days: days.length };

  // Creds.
  let headers: Record<string, string>;
  let locationId: string;
  try {
    headers = getHeaders();
    locationId = getLocationId();
  } catch (err) {
    return NextResponse.json({
      account,
      window,
      thresholdPct: THRESHOLD_PCT,
      status: "unknown",
      updatedAt,
      reason: err instanceof Error ? err.message : "Missing GHL credentials",
    });
  }

  // Resolve calendar.
  let resolved: { calendarId: string; calendarName: string } | null;
  try {
    resolved = await resolveCalendar(account, headers, locationId);
  } catch (err) {
    return NextResponse.json({
      account,
      window,
      thresholdPct: THRESHOLD_PCT,
      status: "unknown",
      updatedAt,
      reason: err instanceof Error ? err.message : "Failed to resolve calendar",
    });
  }

  if (!resolved) {
    return NextResponse.json({
      account,
      window,
      thresholdPct: THRESHOLD_PCT,
      status: "unknown",
      updatedAt,
      reason: `No calendar id for "${account}" (env GHL_CALENDAR_ID_${account.toUpperCase()} missing and no calendar name matched).`,
    });
  }

  const { calendarId, calendarName } = resolved;

  // ── Time anchors ──────────────────────────────────────────────────────────
  const now = new Date();
  // Current availability lookahead: now → +7d.
  const availStartIso = now.toISOString();
  const availEndIso = new Date(now.getTime() + AVAIL_DAYS * 86_400_000).toISOString();
  const availStartEpochMs = now.getTime();
  const availEndEpochMs = now.getTime() + AVAIL_DAYS * 86_400_000;
  // Recent backward context: now-7d → now.
  const recentStartIso = new Date(now.getTime() - RECENT_DAYS * 86_400_000).toISOString();
  const recentEndIso = availStartIso;
  // Full daily-history window, in UTC, from the ET day bounds.
  const { startIso: histStartIso, endIso: histEndIso } = windowUtcBounds(from, to);

  // ── Fetch everything in parallel; any hard failure → unknown ──────────────
  let openSlots: number;
  let upcomingInstants: Date[];
  let recentInstants: Date[];
  let historyInstants: Date[];
  try {
    [openSlots, upcomingInstants, recentInstants, historyInstants] = await Promise.all([
      // Current availability open slots (now → +7d).
      countFreeSlots(calendarId, headers, availStartEpochMs, availEndEpochMs),
      // Booked upcoming (now → +7d) for the gate denominator.
      fetchBookedInstants(calendarId, headers, locationId, availStartIso, availEndIso),
      // Booked in the trailing 7 days (backward context).
      fetchBookedInstants(calendarId, headers, locationId, recentStartIso, recentEndIso),
      // Booked across the whole daily-history window (past + future).
      fetchBookedInstants(calendarId, headers, locationId, histStartIso, histEndIso),
    ]);
  } catch (err) {
    return NextResponse.json({
      account,
      calendarId,
      calendarName,
      window,
      thresholdPct: THRESHOLD_PCT,
      status: "unknown",
      updatedAt,
      reason: err instanceof Error ? err.message : "Failed to fetch calendar data",
    });
  }

  const bookedUpcoming = upcomingInstants.length;
  const recentBooked = recentInstants.length;

  // ── Daily booked history, bucketed per ET day across the full window ──────
  // Seed every day in the window with a zero bucket so the series is dense.
  const dailyByDate = new Map<string, DailyBooked>(
    days.map((date) => [date, { date, booked: 0 }]),
  );
  for (const instant of historyInstants) {
    const etDay = etDateStringForInstant(instant);
    const bucket = dailyByDate.get(etDay);
    // Skip events whose ET day falls just outside [from, to] (range-edge slack).
    if (!bucket) continue;
    bucket.booked += 1;
  }
  const daily = days.map((date) => dailyByDate.get(date)!);

  // ── The gate value: how full is bookable time RIGHT NOW (next 7d) ─────────
  const denom = bookedUpcoming + openSlots;
  const filledPct = denom > 0 ? bookedUpcoming / denom : null;
  const status: "green" | "red" | "unknown" =
    filledPct == null ? "unknown" : filledPct <= THRESHOLD_PCT ? "green" : "red";

  const note = `current upcoming availability (next ${AVAIL_DAYS}d); daily history spans ${from}→${to}`;

  return NextResponse.json(
    {
      account,
      calendarId,
      calendarName,
      window,
      filledPct,
      bookedUpcoming,
      openSlots,
      recentBooked,
      daily,
      thresholdPct: THRESHOLD_PCT,
      status,
      updatedAt,
      note,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
