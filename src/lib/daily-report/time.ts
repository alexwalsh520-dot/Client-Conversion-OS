// ET (America/New_York) date/time helpers for the daily metrics reports.
//
// Vercel cron fires in UTC, and all of the report's windows ("5a–5p ET",
// "week-to-date", "yesterday") are defined in Eastern Time, so every boundary
// has to be converted ET<->UTC with DST handled correctly. These helpers are
// hand-rolled on Intl.DateTimeFormat to match the rest of the codebase (no
// date-fns-tz dependency) and are DST-safe by construction.

export const ET = "America/New_York";

interface EtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dateStr: string; // YYYY-MM-DD
}

/** Break a UTC instant into its Eastern-Time wall-clock parts. */
export function etParts(date: Date): EtParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(date)) {
    if (part.type !== "literal") p[part.type] = part.value;
  }
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    dateStr: `${p.year}-${p.month}-${p.day}`,
  };
}

/** Eastern calendar date (YYYY-MM-DD) of a Date. */
export function etDateStr(date: Date): string {
  return etParts(date).dateStr;
}

/** Eastern hour-of-day (0–23) of a Date — used to gate the crons. */
export function etHour(date: Date): number {
  return etParts(date).hour;
}

/** Minutes the given IANA zone is ahead of UTC at `date`. */
function zoneOffsetMinutes(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return (asUTC - date.getTime()) / 60000;
}

/** UTC milliseconds for the wall-clock `YYYY-MM-DD HH:MM` in `timeZone`. */
export function zonedMs(
  dateStr: string,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const naiveUTC = Date.UTC(y, m - 1, d, hour, minute, 0);
  const offset = zoneOffsetMinutes(timeZone, new Date(naiveUTC));
  return naiveUTC - offset * 60000;
}

/** ET calendar date (YYYY-MM-DD) of a UTC-ms instant. */
export function etDateOf(utcMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(utcMs));
}

/** Add `days` to a YYYY-MM-DD string (calendar math, tz-agnostic). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

/** Monday-of-week for the ET date `dateStr` (week starts Monday). */
export function startOfEtWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (dow + 6) % 7;
  return addDays(dateStr, -sinceMonday);
}

/** First-of-month for the ET date `dateStr`. */
export function startOfEtMonth(dateStr: string): string {
  const [y, m] = dateStr.split("-");
  return `${y}-${m}-01`;
}

/** UTC ms bounds [start, end) for an ET intraday window on `dateStr`. */
export function etWindowUtc(
  dateStr: string,
  startHour: number,
  endHour: number,
): { startMs: number; endMs: number } {
  return {
    startMs: zonedMs(dateStr, startHour, 0, ET),
    endMs: zonedMs(dateStr, endHour, 0, ET),
  };
}

/** UTC ms bounds [start, end) for a full ET calendar day. */
export function etDayBoundsUtc(dateStr: string): { startMs: number; endMs: number } {
  return {
    startMs: zonedMs(dateStr, 0, 0, ET),
    endMs: zonedMs(addDays(dateStr, 1), 0, 0, ET),
  };
}

/** Format a YYYY-MM-DD ET date as e.g. "Mon Jun 23". */
export function etFormatLong(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${dateStr}T12:00:00Z`));
}
