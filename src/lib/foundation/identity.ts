// Foundation identity helpers — the ONE place the messy client keys get normalized.
// Every source names creators differently (dm uses `tyson_sonnek`, ads uses `tyson`,
// the sales tracker uses an offer string like "Tyson Sonnek"). creatorKeyFromText
// already collapses all of those to the short canonical key, so the foundation wraps
// it once and uses it everywhere.

import { creatorKeyFromText, type CreatorKey } from "@/lib/creators";

/** Canonical short client key (`tyson`/`antwan`/…) from any source's creator string(s). */
export function foundationClientKey(
  ...values: Array<string | null | undefined>
): CreatorKey | null {
  return creatorKeyFromText(...values);
}

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Bucket an instant to its America/New_York calendar day (YYYY-MM-DD). Handles EST/EDT. */
export function dayET(when: string | Date | null | undefined): string | null {
  if (!when) return null;
  // A bare date string (e.g. the sales tracker's `date`) is ALREADY an ET calendar day.
  // Do not run it through Date(), which would treat it as UTC midnight and shift it back a day.
  if (typeof when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(when.trim())) return when.trim();
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  // en-CA formats as YYYY-MM-DD already.
  return ET_DAY.format(d);
}

/** Short MM-DD for compact human summaries/stories. */
export function shortDayET(when: string | Date | null | undefined): string {
  const full = dayET(when);
  return full ? full.slice(5) : "";
}
