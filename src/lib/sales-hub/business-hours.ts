// Business-hours math for the Sales Hub.
//
// The team only works 11:00 AM – 11:00 PM Eastern Time, every day. So "1 hour
// with no reply" means 60 minutes of clock time that falls INSIDE that window.
// Time outside it (overnight) does not count. Example: a prospect replies at
// 10:30 PM ET. Only 30 minutes of business time pass before the window closes
// at 11:00 PM; the remaining 30 minutes are counted starting at 11:00 AM the
// next day, so the lead crosses the 1-hour mark at 11:30 AM ET.
//
// This mirrors the window already used by the Response Times report
// (src/lib/sales-hub/response-times.ts) so both features agree on what a
// "business hour" is. DST is handled automatically because we read the ET
// wall-clock for each calendar day through Intl rather than assuming a fixed
// UTC offset.

const ET_TIMEZONE = "America/New_York";

/** 11:00 AM ET, expressed as minutes from ET midnight. */
export const BUSINESS_START_MINUTE = 11 * 60;
/** 11:00 PM ET, expressed as minutes from ET midnight. */
export const BUSINESS_END_MINUTE = 23 * 60;
/** Minutes of working time in a single day (720 = 12 hours). */
export const BUSINESS_MINUTES_PER_DAY = BUSINESS_END_MINUTE - BUSINESS_START_MINUTE;

function getEtParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour || 0);
  const minute = Number(values.minute || 0);

  return {
    dateStr: `${values.year}-${values.month}-${values.day}`,
    minutesOfDay: hour * 60 + minute,
  };
}

function addDays(dateStr: string, days: number) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The ET offset (in minutes) for a given instant. Used to turn an ET wall-clock
// time back into a real UTC instant. Our callers only ever ask about times
// inside 11am–11pm, which are never in the 2 AM DST gap, so the simple
// "interpret-as-UTC then subtract the offset at that guess" trick is exact.
function etOffsetMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(v.year),
    Number(v.month) - 1,
    Number(v.day),
    Number(v.hour),
    Number(v.minute),
    Number(v.second),
  );
  return (asUtc - date.getTime()) / 60000;
}

function etDateMinuteToIso(dateStr: string, minuteOfDay: number) {
  const [year, month, day] = dateStr.split("-").map(Number);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  // Guess: treat the ET wall-clock numbers as if they were UTC, then correct by
  // the real ET offset at that moment.
  const guessMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = etOffsetMinutes(new Date(guessMs));
  return new Date(guessMs - offset * 60000).toISOString();
}

/**
 * Minutes of clock time between two instants that land inside the 11am–11pm ET
 * working window. Returns 0 if the range is empty or invalid.
 */
export function businessMinutesBetween(
  start: string | number | Date,
  end: string | number | Date,
) {
  const startDate = new Date(start);
  const endDate = new Date(end);

  if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return 0;
  if (endDate.getTime() <= startDate.getTime()) return 0;

  const startEt = getEtParts(startDate);
  const endEt = getEtParts(endDate);
  let cursor = startEt.dateStr;
  let total = 0;

  // Walk ET calendar days from the start day to the end day, summing the part of
  // each day's working window that the [start, end] range covers. The guard caps
  // the loop well past the feature's 90-day lookback.
  for (let guard = 0; cursor <= endEt.dateStr && guard < 800; guard += 1) {
    const startMinute = cursor === startEt.dateStr ? startEt.minutesOfDay : 0;
    const endMinute = cursor === endEt.dateStr ? endEt.minutesOfDay : 24 * 60;
    total += Math.max(
      0,
      Math.min(endMinute, BUSINESS_END_MINUTE) - Math.max(startMinute, BUSINESS_START_MINUTE),
    );
    cursor = addDays(cursor, 1);
  }

  return total;
}

/**
 * The instant at which `minutesToAdd` business-minutes have elapsed after
 * `start`. Used to record WHEN a lead actually crossed the stale threshold.
 * Returns an ISO string.
 */
export function addBusinessMinutes(start: string | number | Date, minutesToAdd: number) {
  const startDate = new Date(start);
  if (!Number.isFinite(startDate.getTime())) return new Date(start).toISOString();

  let remaining = Math.max(0, minutesToAdd);
  let cursor = getEtParts(startDate).dateStr;
  let firstDay = true;

  for (let guard = 0; guard < 800; guard += 1) {
    const dayStartMinute = firstDay ? getEtParts(startDate).minutesOfDay : 0;
    const windowStart = Math.max(dayStartMinute, BUSINESS_START_MINUTE);
    const available = Math.max(0, BUSINESS_END_MINUTE - windowStart);

    if (remaining <= available) {
      return etDateMinuteToIso(cursor, windowStart + remaining);
    }

    remaining -= available;
    cursor = addDays(cursor, 1);
    firstDay = false;
  }

  return startDate.toISOString();
}
