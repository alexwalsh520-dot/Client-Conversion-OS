// ─────────────────────────────────────────────────────────────────────────
// CONFIG — the pinned settings Ads v2 scopes to. Kept here as data so the
// serving code never guesses. Which creators are served comes straight from
// ACTIVE_CREATORS (currently Tyson + Jake). Which GoHighLevel calendars count
// as SALES bookings is pinned per client below, chosen by listing the real
// calendars in the data (not guessed):
//
//   Tyson: "Strategy Session (TS)" M4z9iTPUiT9rjk0QKOvD is the sales calendar.
//          A near-duplicate "Strategy Session - (TS)" IeKPrRYzD2RS9ne3fOqT is
//          included too. Everything else (onboarding calls, reschedule
//          calendars, personal calendars, coach calls) is NOT a sales booking.
//   Jake:  no sales calendar is connected in GoHighLevel yet, so bookings are
//          honestly empty for him until one appears here.
// ─────────────────────────────────────────────────────────────────────────

import { ACTIVE_CREATORS, type CreatorKey } from "@/lib/creators";

export interface ClientAdsV2Config {
  key: CreatorKey;
  /** GHL calendar ids that are strategy-session (sales) bookings for this client. */
  salesCalendarIds: readonly string[];
}

export const ADSV2_CLIENT_CONFIG: Partial<Record<CreatorKey, ClientAdsV2Config>> = {
  tyson: {
    key: "tyson",
    salesCalendarIds: ["M4z9iTPUiT9rjk0QKOvD", "IeKPrRYzD2RS9ne3fOqT"],
  },
  jake: {
    key: "jake",
    salesCalendarIds: [],
  },
};

/** The creator keys v2 serves (from the single active-creator source of truth). */
export const ADSV2_SERVED_CLIENTS: readonly CreatorKey[] = ACTIVE_CREATORS.map((c) => c.key);

/** Sales calendar ids for one client (empty if none configured yet). */
export function salesCalendarIdsForClient(key: CreatorKey): readonly string[] {
  return ADSV2_CLIENT_CONFIG[key]?.salesCalendarIds ?? [];
}

/** Every sales calendar id across served clients (for one scoped fetch). */
export const ALL_SALES_CALENDAR_IDS: readonly string[] = ADSV2_SERVED_CLIENTS.flatMap((k) =>
  salesCalendarIdsForClient(k),
);

/** Which served client a sales calendar id belongs to, or null. */
export function clientForSalesCalendar(calendarId: string): CreatorKey | null {
  for (const key of ADSV2_SERVED_CLIENTS) {
    if (salesCalendarIdsForClient(key).includes(calendarId)) return key;
  }
  return null;
}

// How far back the facts pass rebuilds each sync. Comfortably covers the
// longest display window (30 days) plus buffer; older facts are never touched.
export const FACTS_LOOKBACK_DAYS = 45;
// Upcoming calls can be scheduled well ahead, so booking facts reach forward.
export const FACTS_UPCOMING_DAYS = 60;
// How far back to read spend when deciding a keyword's paid run + cool-down.
export const SPEND_HISTORY_DAYS = 180;
// A source is called stale (and shown as such) if its newest data is older.
export const STALE_HOURS = 26;
