import { NextRequest, NextResponse } from "next/server";

/**
 * Closer calendar fullness gate (Lab tab).
 *
 * Returns how full a creator's booking calendar is over the next 7 days:
 *   filledPct = booked / (booked + freeSlots)
 *
 * ALWAYS returns 200 — never 500 — so the Lab gate can render
 * "awaiting data" instead of crashing. On any missing cred / failed
 * fetch / unknown response shape we return { status: "unknown", reason }.
 *
 * GHL v2 auth/fetch pattern copied verbatim from
 * src/app/api/sales-hub/ghl-upcoming/route.ts and daily-brief/route.ts.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GHL v2 API base
const GHL_V2_BASE = "https://services.leadconnectorhq.com";

// Booking window
const WINDOW_DAYS = 7;
const THRESHOLD_PCT = 0.8;

// Statuses that mean the slot is NOT actually taken — exclude these from "booked".
const NON_BOOKED_STATUS = ["cancel", "noshow", "no-show", "no_show", "invalid", "deleted", "declined"];

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
 * Count booked events that are actually taking a slot in the window.
 * Robust to response shape (data.events || data.data || data), matching ghl-upcoming.
 */
async function countBooked(
  calendarId: string,
  headers: Record<string, string>,
  locationId: string,
  startISO: string,
  endISO: string
): Promise<number> {
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
  if (!Array.isArray(events)) return 0;

  let booked = 0;
  for (const evt of events as Array<Record<string, unknown>>) {
    const status = String(evt.appointmentStatus || evt.status || "").toLowerCase();
    // Keep booked/confirmed/showed (and unknown/blank → assume it takes a slot).
    const isExcluded = NON_BOOKED_STATUS.some((s) => status.includes(s));
    if (!isExcluded) booked += 1;
  }
  return booked;
}

/**
 * Count total free slot timestamps across all dates in the next-7-days window.
 *
 * Endpoint: GET /calendars/{calendarId}/free-slots
 * Params:   startDate / endDate as epoch MILLISECONDS, plus timezone.
 * Response: an availability map keyed by date "YYYY-MM-DD", each value an object
 *           with a `slots` array of timestamp strings:
 *             { "2026-06-15": { "slots": ["2026-06-15T09:00:00-05:00", ...] }, ... }
 *           Some payloads also include a "_dates_" array and/or a "traceId".
 * We defensively walk every date-shaped key and tally every slot string we find.
 */
async function countFreeSlots(
  calendarId: string,
  headers: Record<string, string>,
  startEpochMs: number,
  endEpochMs: number
): Promise<number> {
  const tz = "America/New_York";
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
      windowDays: WINDOW_DAYS,
      thresholdPct: THRESHOLD_PCT,
      updatedAt,
      reason: `Unsupported account "${raw}". Use account=tyson or account=antwan.`,
    });
  }

  // Creds.
  let headers: Record<string, string>;
  let locationId: string;
  try {
    headers = getHeaders();
    locationId = getLocationId();
  } catch (err) {
    return NextResponse.json({
      account,
      status: "unknown",
      windowDays: WINDOW_DAYS,
      thresholdPct: THRESHOLD_PCT,
      updatedAt,
      reason: err instanceof Error ? err.message : "Missing GHL credentials",
    });
  }

  // Window: next 7 days from now.
  const now = new Date();
  const end = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const startISO = now.toISOString();
  const endISO = end.toISOString();
  const startEpochMs = now.getTime();
  const endEpochMs = end.getTime();

  // Resolve calendar.
  let resolved: { calendarId: string; calendarName: string } | null;
  try {
    resolved = await resolveCalendar(account, headers, locationId);
  } catch (err) {
    return NextResponse.json({
      account,
      status: "unknown",
      windowDays: WINDOW_DAYS,
      thresholdPct: THRESHOLD_PCT,
      updatedAt,
      reason: err instanceof Error ? err.message : "Failed to resolve calendar",
    });
  }

  if (!resolved) {
    return NextResponse.json({
      account,
      status: "unknown",
      windowDays: WINDOW_DAYS,
      thresholdPct: THRESHOLD_PCT,
      updatedAt,
      reason: `No calendar id for "${account}" (env GHL_CALENDAR_ID_${account.toUpperCase()} missing and no calendar name matched).`,
    });
  }

  const { calendarId, calendarName } = resolved;

  // Booked + free, in parallel. If either hard-fails, return unknown.
  let booked: number;
  let free: number;
  try {
    [booked, free] = await Promise.all([
      countBooked(calendarId, headers, locationId, startISO, endISO),
      countFreeSlots(calendarId, headers, startEpochMs, endEpochMs),
    ]);
  } catch (err) {
    return NextResponse.json({
      account,
      calendarId,
      calendarName,
      windowDays: WINDOW_DAYS,
      thresholdPct: THRESHOLD_PCT,
      status: "unknown",
      updatedAt,
      reason: err instanceof Error ? err.message : "Failed to fetch booked/free data",
    });
  }

  const total = booked + free;
  const filledPct = total > 0 ? booked / total : null;
  const status: "green" | "red" | "unknown" =
    filledPct == null ? "unknown" : filledPct <= THRESHOLD_PCT ? "green" : "red";

  const note =
    filledPct == null
      ? "No booked events and no free slots returned in the window."
      : `${booked} booked of ${total} total slots over the next ${WINDOW_DAYS} days.`;

  return NextResponse.json({
    account,
    calendarId,
    calendarName,
    windowDays: WINDOW_DAYS,
    booked,
    freeSlots: free,
    total,
    filledPct,
    thresholdPct: THRESHOLD_PCT,
    status,
    updatedAt,
    note,
  });
}
