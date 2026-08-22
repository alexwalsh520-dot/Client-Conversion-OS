// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — the pinned GHL calendar map (location 01q51CXSze9vXCGt0tWD).
//
// Hardcoded on purpose: which calendar means what is a business decision,
// not something to be guessed from names at runtime. Appointments on any
// calendar NOT in this map are ignored by the engine.
//
// Two groups:
//   * Strategy Session group L2WZwZE7XIdzsM6xrXjU — DM-booked channel. The
//     lead booked through the funnel link; no rep is credited by the
//     calendar itself (rep comes from assigned_user_id when present).
//   * Personal Calendar group pOk2CnFw2bZPM0YtQPfo — outbound-booked. A rep
//     dialed and booked the call onto their own calendar, so the calendar
//     itself names the rep.
//
// (TS) = tyson, (JD) = jake.
// ─────────────────────────────────────────────────────────────────────────

import type { CreatorKey } from "@/lib/creators";

export const STRATEGY_SESSION_GROUP_ID = "L2WZwZE7XIdzsM6xrXjU";
export const PERSONAL_CALENDAR_GROUP_ID = "pOk2CnFw2bZPM0YtQPfo";

export type BookingSide = "dm" | "outbound";

export interface EngineCalendar {
  calendarId: string;
  name: string;
  client: CreatorKey; // 'tyson' | 'jake'
  side: BookingSide;
  /** Rep key (team.ts) for personal calendars; null for the shared DM calendars. */
  repKey: string | null;
}

export const ENGINE_CALENDARS: readonly EngineCalendar[] = [
  // ── Strategy Session group (DM-booked) ─────────────────────────────────
  { calendarId: "M4z9iTPUiT9rjk0QKOvD", name: "Strategy Session (TS)", client: "tyson", side: "dm", repKey: null },
  { calendarId: "IeKPrRYzD2RS9ne3fOqT", name: "Strategy Session - (TS)", client: "tyson", side: "dm", repKey: null },
  { calendarId: "t0R21g47N9eVdr9nGR98", name: "Strategy Session (JD)", client: "jake", side: "dm", repKey: null },
  { calendarId: "OYzFv9Iuqu1XYLbCy0cp", name: "Strategy Session - (JD)", client: "jake", side: "dm", repKey: null },

  // ── Personal Calendar group (outbound-booked) ──────────────────────────
  { calendarId: "3jtqHu1OS2f32cZHoHQj", name: "Will Personal Calendar (JD)", client: "jake", side: "outbound", repKey: "will" },
  { calendarId: "yGx63nYKW2MgpvIAMGEW", name: "Will Personal Calendar (TS)", client: "tyson", side: "outbound", repKey: "will" },
  { calendarId: "4KxaRhqhHTThGZ1mgE5Q", name: "Chris Personal Calendar (JD)", client: "jake", side: "outbound", repKey: "chris" },
  { calendarId: "Oh174I9DCc7vhfYajMeC", name: "Chris Personal Calendar (TS)", client: "tyson", side: "outbound", repKey: "chris" },
  { calendarId: "6dw9AY1CHPNALpaID0qJ", name: "Erin Personal Calendar (JD)", client: "jake", side: "outbound", repKey: "erin" },
  { calendarId: "Hr8mGnlTAj9w862dUHDl", name: "Erin Personal Calendar (TS)", client: "tyson", side: "outbound", repKey: "erin" },
  { calendarId: "ACPOAA2nf2bc3TIlU3BA", name: "Austin Personal Calendar (TS)", client: "tyson", side: "outbound", repKey: "austin" },
  { calendarId: "Ftd9J7KNi46ePQfkg9Hy", name: "Austin Personal Calendar (JD)", client: "jake", side: "outbound", repKey: "austin" },
  { calendarId: "JpCD5ZbajtyrabJGmuMJ", name: "Jacob Personal Calendar (TS)", client: "tyson", side: "outbound", repKey: "jacob" },
  { calendarId: "gCDFIEWUb1euCgzNJufP", name: "Jacob Personal Calendar (JD)", client: "jake", side: "outbound", repKey: "jacob" },
  { calendarId: "ZIOktvjSN0aW8qHUhhZB", name: "Andrew Personal Calendar (TS)", client: "tyson", side: "outbound", repKey: "andrew" },
  { calendarId: "wKA1JgAyDzvKl4DjZHzF", name: "Andrew Personal Calendar (JD)", client: "jake", side: "outbound", repKey: "andrew" },
];

const BY_ID: Record<string, EngineCalendar> = Object.fromEntries(
  ENGINE_CALENDARS.map((c) => [c.calendarId, c]),
);

/** The calendar entry for an id, or null when the engine ignores it. */
export function engineCalendar(calendarId: string | null | undefined): EngineCalendar | null {
  if (!calendarId) return null;
  return BY_ID[calendarId] ?? null;
}

/** Every calendar id the engine watches (for one scoped fetch). */
export const ENGINE_CALENDAR_IDS: readonly string[] = ENGINE_CALENDARS.map(
  (c) => c.calendarId,
);
