// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — the pinned GHL calendar map (location 01q51CXSze9vXCGt0tWD).
//
// Hardcoded on purpose: which calendar means what is a business decision,
// not something to be guessed from names at runtime. Appointments on any
// calendar NOT in this map are ignored by the engine.
//
// Four groups:
//   * Strategy Session group L2WZwZE7XIdzsM6xrXjU — DM-booked channel. The
//     lead booked through the funnel link; no rep is credited by the
//     calendar itself (rep comes from assigned_user_id when present).
//   * Personal Calendar group pOk2CnFw2bZPM0YtQPfo — outbound-booked. A rep
//     dialed and booked the call onto their own calendar, so the calendar
//     itself names the rep.
//   * Onboarding calendars — post-sale client onboarding calls. NOT sales
//     calls: the engine tracks them as their own call type ("onboarding")
//     and keeps them out of sales booking/show/close metrics.
//   * Reschedule calendars — real sales calls the sheet counts, re-booked
//     onto a rep-named reschedule calendar. The calendar names the rep but
//     NOT the client: `clientAmbiguous` marks entries whose client must be
//     inferred at build time (lead's ledger row → prior booking → tyson
//     default, recorded in metadata.client_basis).
//
// (TS) = tyson, (JD) = jake.
// ─────────────────────────────────────────────────────────────────────────

import type { CreatorKey } from "@/lib/creators";

export const STRATEGY_SESSION_GROUP_ID = "L2WZwZE7XIdzsM6xrXjU";
export const PERSONAL_CALENDAR_GROUP_ID = "pOk2CnFw2bZPM0YtQPfo";

export type BookingSide = "dm" | "outbound" | "onboarding" | "reschedule";

export interface EngineCalendar {
  calendarId: string;
  name: string;
  /** For reschedule calendars this is only the DEFAULT (see clientAmbiguous). */
  client: CreatorKey; // 'tyson' | 'jake'
  side: BookingSide;
  /** Rep key (team.ts) for personal/reschedule calendars; null otherwise. */
  repKey: string | null;
  /**
   * True when the calendar name does not identify the client (reschedule
   * calendars). build.ts infers the real client from the lead's ledger row,
   * else their most recent prior booking, else keeps the default above.
   */
  clientAmbiguous?: boolean;
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

  // ── Onboarding calendars (post-sale; NOT sales calls) ──────────────────
  // Tyson ("The Forge"-branded):
  { calendarId: "5e8GPaAaq2VIUQRwTT7b", name: "7 Day schedule - Onboarding Call w/ The Forge", client: "tyson", side: "onboarding", repKey: null },
  { calendarId: "AeUhUrV21wWDuhEOQMbx", name: "Onboarding Call with The Forge", client: "tyson", side: "onboarding", repKey: null },
  { calendarId: "Hwe9Xm33uNE5HACNUPc6", name: "Onboarding Call w/ The Forge", client: "tyson", side: "onboarding", repKey: null },
  { calendarId: "ZEHRmHAcrIRoXFKrYuNN", name: "Copy of Onboarding Call with The Forge - 7 day time", client: "tyson", side: "onboarding", repKey: null },
  { calendarId: "g0p4jxGQ33H2WiYSiIEd", name: "Onboarding Call W/ Tyson", client: "tyson", side: "onboarding", repKey: null },
  // Inactive, kept so historical onboarding calls stay attributed.
  { calendarId: "TLKHNyYOLC7Y96FEvG9y", name: "Onboarding Call with Tyson", client: "tyson", side: "onboarding", repKey: null },
  // Jake (RecruitReady):
  { calendarId: "C2xXF6N08MHbT5KmIKqz", name: "Onboarding Call w/RecruitReadyF", client: "jake", side: "onboarding", repKey: null },
  { calendarId: "7l0rDmiRXUejpn2uIhdu", name: "7 Day - Onboarding Call w/ RecruitReadyFitness", client: "jake", side: "onboarding", repKey: null },

  // ── Reschedule calendars (real sales calls; client inferred at build) ──
  { calendarId: "f2xCGb0syYWCW4c65Qvw", name: "Broz Reschedule", client: "tyson", side: "reschedule", repKey: "jacob", clientAmbiguous: true },
  { calendarId: "KTqV12R3ns87rSy5tdRM", name: "Will Reschedule", client: "tyson", side: "reschedule", repKey: "will", clientAmbiguous: true },
  { calendarId: "VDW60oLMCpwTTWa0C7aT", name: "Austin Reschedule", client: "tyson", side: "reschedule", repKey: "austin", clientAmbiguous: true },
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
