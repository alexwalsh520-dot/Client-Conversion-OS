// Daily call-outcomes recap — what happened to every call that was ON THE
// CALENDAR for a given ET day, split by offer.
//
// Source of truth per field, deliberately NOT interchangeable:
//   • scheduled  → ghl_appointments (the calendar IS the schedule)
//   • taken      → sales tracker, "Call Taken" column
//   • closed     → sales tracker, Outcome = WIN
//   • cash       → sales tracker, "Cash Collected"
//   • rescheduled→ #call-updates in Slack (see reschedules.ts)
//
// The sheet's own Date column is NOT used to decide which calls belong to the
// day — it drifts (a call GHL has at 6:00 AM Aug 19 was logged as Aug 20). GHL
// picks the day; the sheet is joined in by prospect name over a ± window.

import { getServiceSupabase } from "@/lib/supabase";
import { fetchSheetData, type SheetRow } from "@/lib/google-sheets";
import { CREATORS_BY_KEY, creatorKeyFromText, type CreatorKey } from "@/lib/creators";
import { addDays, etDayBoundsUtc, ET } from "@/lib/daily-report/time";
import { bestNameMatch, nameMatchScore } from "./names";
import { fetchReschedules, type RescheduleHit } from "./reschedules";

/** How many days either side of the report day to scan the sheet for a match. */
const SHEET_WINDOW_DAYS = 4;

/**
 * Calendar-name → offer hints that are deliberately LOCAL to this report.
 *
 * "The Forge" is Tyson's brand, but it is also what the shared GHL sub-account
 * hosting every client is called, so it is not safe as a global creator match
 * token. Scoped to calendar names it is unambiguous: Tyson's onboarding
 * calendars say "The Forge", Jake's say "RecruitReadyFitness".
 */
const CALENDAR_HINTS: Array<[RegExp, CreatorKey]> = [[/the forge/i, "tyson"]];

export type OfferKey = CreatorKey | "unassigned";

/**
 * Onboarding splits in two and the halves mean opposite things:
 *   Rep Onboarding    — run by a closer.
 *   Client Onboarding — run by the onboarding specialist, for high-ticket
 *                       customers who have ALREADY paid. Pure fulfilment; it
 *                       must never touch a sales rate.
 */
export type CallType =
  | "Strategy Session"
  | "Rep Onboarding"
  | "Client Onboarding"
  | "Other";

export interface CallOutcome {
  appointmentId: string;
  prospect: string;
  startsAt: string; // ISO
  etTime: string; // "2:30 PM"
  calendarName: string;
  callType: CallType;
  offer: OfferKey;
  closer: string | null;
  /** false when no sales-tracker row could be matched at all. */
  logged: boolean;
  taken: boolean;
  outcome: string | null; // WIN / LOST / PCFU / NS-RS / NOT A FIT …
  closed: boolean;
  cash: number;
  rescheduled: boolean;
  rescheduleNote: string | null;
}

export interface Stats {
  scheduled: number;
  taken: number;
  closed: number;
  rescheduled: number;
  unlogged: number;
  cash: number;
}

export interface OfferBlock extends Stats {
  offer: OfferKey;
  label: string;
  calls: CallOutcome[];
}

export interface CallOutcomesReport {
  day: string; // YYYY-MM-DD (ET)
  generatedAt: string;
  blocks: OfferBlock[];
  totals: Stats;
  /** Specialist-run onboarding calls dropped before any counting. */
  excludedClientOnboarding: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Attribution helpers
// ---------------------------------------------------------------------------

interface ApptRow {
  appointment_id: string;
  calendar_name: string | null;
  contact_name: string | null;
  start_time: string;
  status: string | null;
  client: string | null;
  raw_payload: unknown;
}

/**
 * Which offer a booking belongs to.
 *
 * Calendar name first — it carries the explicit client code, "(TS)" / "(JD)",
 * that the team maintains by hand. The derived `client` column is second
 * because it has NULL gaps (~15% of August) AND at least one wrong value
 * ("Onboarding Call w/ The Forge" tagged jake). The GHL contact tags in
 * raw_payload ("tyson sonnek lead,booked call") are the last resort.
 */
function offerForAppointment(a: ApptRow): OfferKey {
  const fromCalendar = creatorKeyFromText(a.calendar_name);
  if (fromCalendar) return fromCalendar;

  const hinted = CALENDAR_HINTS.find(([re]) => re.test(a.calendar_name || ""));
  if (hinted) return hinted[1];

  const tags =
    a.raw_payload && typeof a.raw_payload === "object"
      ? ((a.raw_payload as { tags?: unknown }).tags ?? null)
      : null;
  const fromTags = typeof tags === "string" ? creatorKeyFromText(tags) : null;
  if (fromTags) return fromTags;

  const fromColumn = creatorKeyFromText(a.client);
  if (fromColumn) return fromColumn;

  return "unassigned";
}

/** The closer GHL recorded on the booking, when it has one. */
function closerFromPayload(a: ApptRow): string | null {
  if (!a.raw_payload || typeof a.raw_payload !== "object") return null;
  const user = (a.raw_payload as { user?: { firstName?: string; lastName?: string } }).user;
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || null;
}

/**
 * Who runs client onboarding. Overridable so the report survives the role
 * changing hands without a deploy.
 */
function onboardingSpecialists(): string[] {
  const raw = process.env.ONBOARDING_SPECIALISTS?.trim();
  return (raw ? raw.split(",") : ["Nicole Okpala"])
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The ASSIGNEE decides which kind of onboarding call this is, not the calendar
 * name: the two kinds are named "Onboarding Call with The Forge" and
 * "Onboarding Call w/ The Forge", and keying on "with" vs "w/" would break the
 * moment someone renames a calendar. By assignee the split is exact — since
 * July every specialist-run onboarding is hers and every other one is a rep's.
 */
function callTypeOf(a: ApptRow): CallType {
  const cal = (a.calendar_name || "").toLowerCase();

  if (cal.includes("onboarding")) {
    const who = (closerFromPayload(a) || "").toLowerCase();
    if (who) return onboardingSpecialists().includes(who) ? "Client Onboarding" : "Rep Onboarding";
    // Unassigned: every "7 Day schedule" onboarding on record is the
    // specialist's, so an empty assignee still lands on the right side.
    return cal.includes("7 day") ? "Client Onboarding" : "Rep Onboarding";
  }

  if (cal.includes("strategy session")) return "Strategy Session";
  return "Other";
}

function etClock(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function offerLabel(offer: OfferKey): string {
  if (offer === "unassigned") return "Unattributed";
  return CREATORS_BY_KEY[offer]?.name ?? offer;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Every appointment starting inside the ET day, cancellations excluded. */
async function fetchScheduled(day: string): Promise<ApptRow[]> {
  const { startMs, endMs } = etDayBoundsUtc(day);
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("ghl_appointments")
    .select("appointment_id,calendar_name,contact_name,start_time,status,client,raw_payload")
    .neq("status", "cancelled")
    .gte("start_time", new Date(startMs).toISOString())
    .lt("start_time", new Date(endMs).toISOString())
    .order("start_time", { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []) as ApptRow[];
}

/** Sheet rows around the report day, so a mis-dated row still gets found. */
async function fetchSheetWindow(day: string): Promise<SheetRow[]> {
  return fetchSheetData(addDays(day, -SHEET_WINDOW_DAYS), addDays(day, SHEET_WINDOW_DAYS));
}

async function safe<T>(
  label: string,
  warnings: string[],
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    warnings.push(`${label}: ${msg}`);
    console.error(`[call-outcomes] ${label} failed:`, e);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Days between two YYYY-MM-DD strings, absolute. */
function dayGap(a: string, b: string): number {
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round(ms / 86400000));
}

/**
 * Does a sheet row's "Type of call" describe the same kind of call the calendar
 * booked? Blank types match anything (older rows predate the column).
 */
function typeAgrees(apptType: CallType, sheetType: string | null | undefined): boolean {
  const t = (sheetType || "").trim().toLowerCase();
  if (!t) return true;
  const sheetIsOnboarding = t.includes("onboarding");
  // The tracker has one "Onboarding Call" type covering both kinds.
  if (apptType === "Rep Onboarding" || apptType === "Client Onboarding") {
    return sheetIsOnboarding;
  }
  // Strategy Sessions and the personal/reschedule calendars both land in the
  // tracker as strategy sessions, misc chats or follow-ups — anything but
  // onboarding.
  return !sheetIsOnboarding;
}

/**
 * The sales-tracker row for a booking, or null.
 *
 * Name is the join key (the sheet's Date drifts), but name ALONE over a
 * multi-day window mis-fires: a prospect with an Aug 17 "Miscellaneous Chat"
 * WIN and an Aug 19 onboarding call had the $1,000 credited to the onboarding
 * call. So a row on a different day only qualifies when the call type also
 * agrees, and same-day rows always win.
 */
export function matchSheetRow(
  prospect: string,
  apptType: CallType,
  day: string,
  candidates: SheetRow[],
): SheetRow | null {
  const scored: Array<{ row: SheetRow; gap: number; name: number }> = [];

  for (const row of candidates) {
    const name = nameMatchScore(prospect, row.name);
    if (name === null) continue;
    const gap = dayGap(row.date, day);
    if (gap > SHEET_WINDOW_DAYS) continue;
    if (gap > 0 && !typeAgrees(apptType, row.callType)) continue;
    scored.push({ row, gap, name });
  }

  scored.sort((a, b) => a.gap - b.gap || a.name - b.name);
  return scored[0]?.row ?? null;
}

function statsFor(calls: CallOutcome[]): Stats {
  return {
    scheduled: calls.length,
    taken: calls.filter((c) => c.taken).length,
    closed: calls.filter((c) => c.closed).length,
    rescheduled: calls.filter((c) => c.rescheduled).length,
    unlogged: calls.filter((c) => !c.logged).length,
    cash: calls.reduce((s, c) => s + c.cash, 0),
  };
}

export async function buildCallOutcomesReport(day: string): Promise<CallOutcomesReport> {
  const warnings: string[] = [];

  const appts = await safe("ghl", warnings, () => fetchScheduled(day), [] as ApptRow[]);
  const sheet = await safe("sheet", warnings, () => fetchSheetWindow(day), [] as SheetRow[]);

  const prospects = appts.map((a) => a.contact_name || "").filter(Boolean);
  const reschedules = await safe(
    "reschedules",
    warnings,
    () => fetchReschedules(day, prospects),
    [] as RescheduleHit[],
  );

  // A sheet row may only be claimed once, so two prospects with similar names
  // can't both collapse onto the same logged call.
  const claimed = new Set<SheetRow>();

  const calls: CallOutcome[] = appts.map((a) => {
    const prospect = (a.contact_name || "").trim() || "(no name)";
    const available = sheet.filter((r) => !claimed.has(r));
    const callType = callTypeOf(a);
    const row = matchSheetRow(prospect, callType, day, available);
    if (row) claimed.add(row);

    const hit = bestNameMatch(prospect, reschedules, (r) => r.prospect);

    const outcome = row?.outcome?.trim() ? row.outcome.trim().toUpperCase() : null;
    return {
      appointmentId: a.appointment_id,
      prospect,
      startsAt: a.start_time,
      etTime: etClock(a.start_time),
      calendarName: a.calendar_name || "",
      callType,
      offer: offerForAppointment(a),
      // The sheet's Closer column is hand-maintained and wins; GHL's assigned
      // user is only a fallback for calls nobody has logged yet.
      closer: row?.closer?.trim() || closerFromPayload(a),
      logged: Boolean(row),
      taken: Boolean(row?.callTaken),
      outcome,
      closed: outcome === "WIN",
      cash: row?.cashCollected || 0,
      rescheduled: Boolean(hit),
      rescheduleNote: hit?.evidence || null,
    };
  });

  // The onboarding specialist's calls are fulfilment for customers who already
  // paid, so they are dropped OUTRIGHT — not listed, not counted anywhere.
  const excludedClientOnboarding = calls.filter((c) => c.callType === "Client Onboarding").length;
  const counted = calls.filter((c) => c.callType !== "Client Onboarding");

  // Group into offer blocks, active creators first, "Unattributed" last.
  const byOffer = new Map<OfferKey, CallOutcome[]>();
  for (const c of counted) {
    const list = byOffer.get(c.offer) || [];
    list.push(c);
    byOffer.set(c.offer, list);
  }

  const order = (o: OfferKey) => (o === "unassigned" ? 1 : 0);
  const blocks: OfferBlock[] = Array.from(byOffer.entries())
    .map(([offer, list]) => ({
      offer,
      label: offerLabel(offer),
      calls: list,
      ...statsFor(list),
    }))
    .sort((a, b) => order(a.offer) - order(b.offer) || b.scheduled - a.scheduled);

  const totals = statsFor(counted);

  return {
    day,
    generatedAt: new Date().toISOString(),
    blocks,
    totals,
    excludedClientOnboarding,
    warnings,
  };
}
