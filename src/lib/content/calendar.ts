// Shared types + pure date/detection helpers for the Content Calendar. Everything is timezone-aware
// (each client keeps their own IANA zone) and dependency-free, so the API route, the reconcile cron,
// the operator tab and the creator tab all reason about days identically.

export type StoryDay = { label: string } | null; // null = no story expected that day
export type StorySchedule = Record<string, StoryDay>; // keyed mon..sun
export type Cadence = {
  reels_per_day: number;
  carousels_per_day: number;
  story_schedule: StorySchedule;
  timezone: string; // IANA, e.g. America/New_York
};

export const DOW: readonly string[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const DEFAULT_TZ = "America/New_York";

// Zones the cadence editor offers by name; anything else can still be typed in free-text.
export const COMMON_TIMEZONES: readonly string[] = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

// Sunday is a rest day for STORIES ONLY — reels and carousels are expected at full quota every day.
export const DEFAULT_STORY_SCHEDULE: StorySchedule = {
  mon: { label: "Direct CTA to coaching (made by us)" },
  tue: { label: "Testimonials from the weekend" },
  wed: { label: "Connection (personal story / life update / Q&A / family)" },
  thu: { label: "CTA to lead magnet (written by us)" },
  fri: { label: "Testimonials from the week" },
  sat: { label: "Connection" },
  sun: null,
};

// A slot's truth. verified/claimed apply to reels+carousels (which we can detect); stories can only
// ever be `done`, because a scraper cannot see a story — a checked story is manual-final.
export type SlotState = "verified" | "claimed" | "done" | "missed" | "pending";
export const isComplete = (s: SlotState) => s === "verified" || s === "claimed" || s === "done";

export function safeTimezone(tz: string | null | undefined): string {
  const z = (tz || "").trim();
  if (!z) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: z });
    return z;
  } catch {
    return DEFAULT_TZ; // never let a bad zone break the grid
  }
}

// Today's date (YYYY-MM-DD) in the client's zone.
export function todayIn(tz: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: safeTimezone(tz) });
}

// The client-local calendar date an instant falls on.
export function dateIn(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-CA", { timeZone: safeTimezone(tz) });
}

// The mon..sun key for a YYYY-MM-DD date (noon-UTC anchor avoids any DST edge on the date itself).
export function dowKey(date: string): string {
  const jsDow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return DOW[(jsDow + 6) % 7];
}

export function shiftDay(date: string, delta: number): string {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

// The seven YYYY-MM-DD dates Mon..Sun for the week containing `anyDateInWeek`.
export function weekDates(anyDateInWeek: string): string[] {
  const jsDow = new Date(`${anyDateInWeek}T12:00:00Z`).getUTCDay();
  const monday = shiftDay(anyDateInWeek, -((jsDow + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));
}

export function shiftWeek(anyDate: string, weeks: number): string {
  return shiftDay(weekDates(anyDate)[0], weeks * 7);
}

// How many hours ago the client-local day `date` ended. Negative = the day is still running.
// Derived by measuring the zone's current UTC offset, so it follows DST without a tz library.
export function hoursSinceDayEnded(date: string, tz: string): number {
  const zone = safeTimezone(tz);
  const now = new Date();
  // offsetMinutes = how far the zone is from UTC right now.
  const asUtc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const asZone = new Date(now.toLocaleString("en-US", { timeZone: zone }));
  const offsetMs = asZone.getTime() - asUtc.getTime();
  // Local midnight that ENDS `date` = 00:00 of the next day, expressed as a real instant.
  const endLocalMidnightUtc = new Date(`${shiftDay(date, 1)}T00:00:00Z`).getTime() - offsetMs;
  return (now.getTime() - endLocalMidnightUtc) / 3_600_000;
}

// creator_content.media_type buckets → slot types. IG gives REELS / Sidecar / FEED; single-image
// FEED is neither a reel nor a carousel.
export function reelMedia(mt: string | null | undefined): boolean {
  const m = (mt || "").toLowerCase();
  return m === "reels" || m === "reel" || m === "video";
}
export function carouselMedia(mt: string | null | undefined): boolean {
  const m = (mt || "").toLowerCase();
  return m === "sidecar" || m === "carousel" || m === "carousel_album" || m === "album";
}

export const prettyDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
