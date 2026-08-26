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
//   Jake:  "Strategy Session (JD)" t0R21g47N9eVdr9nGR98 is the sales calendar
//          (first bookings landed 2026-07-29/30 with keywords captured; they sat
//          client-less until this id was pinned here). The near-duplicate
//          "Strategy Session - (JD)" OYzFv9Iuqu1XYLbCy0cp appeared 2026-08-03
//          and swallowed 2 bookings, same pattern as Tyson's duplicate; pinned
//          too. NOTE: its booking link carries NO keyword UTM, so bookings on
//          it can only attribute via the strict bare-link recovery.
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
    salesCalendarIds: ["t0R21g47N9eVdr9nGR98", "OYzFv9Iuqu1XYLbCy0cp"],
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

// ── Phone-set lane ─────────────────────────────────────────────────────────
// Closers' personal calendars, where outbound-dialed leads get booked. These
// are real sales bookings that never touch the strategy calendars, so without
// them the Booked column is blind to the whole phone-set lane. Ids verified
// against live ghl_appointments data on 2026-08-26; the (TS)/(JD) suffix in
// the calendar name carries the creator.
//
// EXCLUDED on purpose: the two legacy unsuffixed calendars
// "Andrew Personal Calendar" (WpdH3Nho7Y7vdaFfDqCf) and "Erin's Personal Link"
// (ly0aHndCycj2XUNBtVZF). They carry no creator suffix and their bookings mix
// creators and internal tests, so nothing can be proven about them here.
// Their sales still surface through the tracker weld.
export const PHONE_SET_CALENDAR_IDS: Partial<Record<CreatorKey, readonly string[]>> = {
  tyson: [
    "ZIOktvjSN0aW8qHUhhZB", // Andrew Personal Calendar (TS)
    "ACPOAA2nf2bc3TIlU3BA", // Austin Personal Calendar (TS)
    "Oh174I9DCc7vhfYajMeC", // Chris Personal Calendar (TS)
    "Hr8mGnlTAj9w862dUHDl", // Erin Personal Calendar (TS)
    "JpCD5ZbajtyrabJGmuMJ", // Jacob (Broz) Personal Calendar (TS)
  ],
  jake: [
    "wKA1JgAyDzvKl4DjZHzF", // Andrew Personal Calendar (JD)
    "6dw9AY1CHPNALpaID0qJ", // Erin Personal Calendar (JD)
  ],
};

/** The lane a booking came through. Stored on every booking fact. */
export type BookingLane = "dm_sales" | "phone_set";

/** Every calendar id the booking facts ingest (sales + phone-set lanes). */
export const ALL_BOOKING_CALENDAR_IDS: readonly string[] = [
  ...ALL_SALES_CALENDAR_IDS,
  ...ADSV2_SERVED_CLIENTS.flatMap((k) => PHONE_SET_CALENDAR_IDS[k] ?? []),
];

/** Which served client + lane a booking calendar belongs to, or null. */
export function bookingCalendarInfo(
  calendarId: string,
): { client: CreatorKey; lane: BookingLane } | null {
  const salesClient = clientForSalesCalendar(calendarId);
  if (salesClient) return { client: salesClient, lane: "dm_sales" };
  for (const key of ADSV2_SERVED_CLIENTS) {
    if ((PHONE_SET_CALENDAR_IDS[key] ?? []).includes(calendarId)) {
      return { client: key, lane: "phone_set" };
    }
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
