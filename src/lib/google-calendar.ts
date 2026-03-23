// Google Calendar API integration for CCOS
// Fetches Nicole's onboarding calendar events to populate EOD reports
// Uses same service account as Google Sheets integration

import { google } from "googleapis";

export interface CalendarEvent {
  id: string;
  summary: string; // Event title (e.g. "Rudy Gonzales <The Forge>")
  start: string; // ISO datetime
  end: string; // ISO datetime
  clientName: string; // Extracted client name
  status: string; // confirmed, tentative, cancelled
}

function getCalendarAuth() {
  const email =
    process.env.COACHING_GOOGLE_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key =
    process.env.COACHING_GOOGLE_KEY || process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      "Missing COACHING_GOOGLE_EMAIL/COACHING_GOOGLE_KEY or GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_PRIVATE_KEY"
    );
  }
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: email,
      private_key: key.replace(/\\n/g, "\n"),
    },
    scopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
  });
}

/**
 * Extract client name from a calendar event title.
 * Common patterns:
 * - "Rudy Gonzales <The Forge>" → "Rudy Gonzales"
 * - "Nathan Zemke - Keith" → "Nathan Zemke"
 * - "Jakob Padgett <The Forge>" → "Jakob Padgett"
 * - "ALEXANDER POSTER - ..." → "Alexander Poster"
 */
function extractClientName(summary: string): string {
  if (!summary) return "";

  // Remove anything after " <" (e.g. "<The Forge>")
  let name = summary.split(/\s*</).at(0) || summary;

  // Remove anything after " - " (e.g. "- Keith", "- The Forge")
  name = name.split(/\s*[-–—]\s/).at(0) || name;

  // Trim and normalize case (handle ALL CAPS names)
  name = name.trim();
  if (name === name.toUpperCase() && name.length > 2) {
    // Convert "ALEXANDER POSTER" → "Alexander Poster"
    name = name
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  return name;
}

/**
 * Known internal/non-onboarding event patterns to filter out.
 */
const INTERNAL_PATTERNS = [
  /not available/i,
  /busy/i,
  /nomz food/i,
  /block/i,
  /lunch/i,
  /meeting/i,
  /huddle/i,
  /training/i,
  /pending task/i,
];

function isOnboardingEvent(summary: string): boolean {
  if (!summary) return false;
  return !INTERNAL_PATTERNS.some((p) => p.test(summary));
}

/**
 * Fetch onboarding events from Nicole's Google Calendar for a given date range.
 * Requires NICOLE_CALENDAR_ID env var (her calendar's email/ID).
 * The service account must be shared on Nicole's calendar.
 */
export async function fetchNicoleCalendarEvents(
  dateStr: string // YYYY-MM-DD
): Promise<CalendarEvent[]> {
  const calendarId = process.env.NICOLE_CALENDAR_ID;
  if (!calendarId) {
    console.warn(
      "[google-calendar] NICOLE_CALENDAR_ID not configured, skipping calendar fetch"
    );
    return [];
  }

  const auth = getCalendarAuth();
  const calendar = google.calendar({ version: "v3", auth });

  const timeMin = `${dateStr}T00:00:00-05:00`; // EST
  const timeMax = `${dateStr}T23:59:59-05:00`;

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = res.data.items || [];

    return events
      .filter((evt) => {
        // Skip cancelled events
        if (evt.status === "cancelled") return false;
        // Skip internal/non-onboarding events
        if (!isOnboardingEvent(evt.summary || "")) return false;
        return true;
      })
      .map((evt) => ({
        id: evt.id || "",
        summary: evt.summary || "",
        start: evt.start?.dateTime || evt.start?.date || "",
        end: evt.end?.dateTime || evt.end?.date || "",
        clientName: extractClientName(evt.summary || ""),
        status: evt.status || "confirmed",
      }));
  } catch (err) {
    console.error("[google-calendar] Failed to fetch events:", err);
    return [];
  }
}

/**
 * Fetch events for a date range (e.g. upcoming week) for the Onboarding tab.
 */
export async function fetchNicoleCalendarRange(
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<CalendarEvent[]> {
  const calendarId = process.env.NICOLE_CALENDAR_ID;
  if (!calendarId) {
    return [];
  }

  const auth = getCalendarAuth();
  const calendar = google.calendar({ version: "v3", auth });

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin: `${startDate}T00:00:00-05:00`,
      timeMax: `${endDate}T23:59:59-05:00`,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = res.data.items || [];

    return events
      .filter(
        (evt) =>
          evt.status !== "cancelled" &&
          isOnboardingEvent(evt.summary || "")
      )
      .map((evt) => ({
        id: evt.id || "",
        summary: evt.summary || "",
        start: evt.start?.dateTime || evt.start?.date || "",
        end: evt.end?.dateTime || evt.end?.date || "",
        clientName: extractClientName(evt.summary || ""),
        status: evt.status || "confirmed",
      }));
  } catch (err) {
    console.error("[google-calendar] Range fetch failed:", err);
    return [];
  }
}
