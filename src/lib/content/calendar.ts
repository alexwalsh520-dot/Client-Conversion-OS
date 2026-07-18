// Shared types + pure date/detection helpers for the Content Calendar tab. Everything here is
// timezone-America/New_York and dependency-free so both the API route and the UI can use it.

export type StoryDay = { label: string } | null; // null = rest day (no post expected)
export type StorySchedule = Record<string, StoryDay>; // keyed mon..sun
export type Cadence = { reels_per_day: number; carousels_per_day: number; story_schedule: StorySchedule };

export const DOW: readonly string[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DEFAULT_STORY_SCHEDULE: StorySchedule = {
  mon: { label: "Direct CTA to coaching (made by us)" },
  tue: { label: "Testimonials from the weekend" },
  wed: { label: "Connection (personal story / life update / Q&A / family)" },
  thu: { label: "CTA to lead magnet (written by us)" },
  fri: { label: "Testimonials from the week" },
  sat: { label: "Connection" },
  sun: null,
};

// Today's date in America/New_York, as YYYY-MM-DD.
export function etToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

// The mon..sun key for a YYYY-MM-DD date. Uses noon-UTC to avoid any DST edge on the date itself.
export function dowKey(date: string): string {
  const jsDow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return DOW[(jsDow + 6) % 7]; // shift so Monday=0
}

function shift(date: string, delta: number): string {
  const t = new Date(`${date}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

// The seven YYYY-MM-DD dates Mon..Sun for the week containing `anyDateInWeek`.
export function weekDates(anyDateInWeek: string): string[] {
  const jsDow = new Date(`${anyDateInWeek}T12:00:00Z`).getUTCDay();
  const backToMon = (jsDow + 6) % 7;
  const monday = shift(anyDateInWeek, -backToMon);
  return Array.from({ length: 7 }, (_, i) => shift(monday, i));
}

// Monday of the week offset by `weeks` from the week containing `anyDate`.
export function shiftWeek(anyDate: string, weeks: number): string {
  return shift(weekDates(anyDate)[0], weeks * 7);
}

// creator_content.media_type buckets → our slot types. IG gives REELS / Sidecar / FEED; we treat
// reels+video as "reel" and carousel/sidecar/album as "carousel". Single-image FEED is neither.
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
