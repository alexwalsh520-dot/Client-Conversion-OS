// ─────────────────────────────────────────────────────────────────────────
// ATTRIBUTION CORE — small, pure, and unit-tested. Every rule is one sentence
// you can read out loud. These functions decide, from evidence alone, which
// keyword a record belongs to and whether it is paid or organic. They touch no
// database and no clock; the facts pass feeds them rows and stores the result.
//
// Laws:
//   * Money and bookings tie to a keyword by HARD KEY only. Names never do.
//   * A paid ad running a word wins over an organic mark during the overlap
//     (and a 30 day cool-down after), so paid and organic never double count.
//   * A person decision always outranks an automatic one.
// ─────────────────────────────────────────────────────────────────────────

export type KeywordClass = "paid" | "organic" | "none";

export type LinkMethod =
  | "human" // a person resolved it in the workspace
  | "link_booking" // pasted subscriber id matched a booked call's keyword
  | "link_dm" // subscriber id matched the buyer's DM keyword
  | "origin_check" // the subscriber's ManyChat profile carried the keyword
  | "organic" // resolved to an organic keyword
  | "none"; // could not be proven

export const ORGANIC_COOLDOWN_DAYS = 30;

/**
 * Classify a record (DM, booking, or sale) on a keyword as paid, organic, or
 * neither, given when that keyword had real paid spend and whether it is on the
 * client's organic list. Paid wins whenever the event day falls inside a paid
 * ad's run plus a 30 day cool-down.
 */
export function classifyKeyword(params: {
  keyword: string | null | undefined;
  organicMarked: boolean;
  paidSpendDays: readonly string[]; // ET days this keyword had paid spend
  eventDay: string;
  cooldownDays?: number;
}): KeywordClass {
  const keyword = (params.keyword || "").trim();
  if (!keyword) return "none";

  const cooldown = params.cooldownDays ?? ORGANIC_COOLDOWN_DAYS;
  const days = params.paidSpendDays;
  if (days.length > 0) {
    const first = days[0];
    const last = days[days.length - 1];
    // Paid window: from first spend day through last spend day + cool-down.
    const windowEnd = shiftIso(last, cooldown);
    if (params.eventDay >= first && params.eventDay <= windowEnd) return "paid";
    // Outside the cool-down: an organic mark now takes over.
    if (params.organicMarked) return "organic";
    // Real paid keyword, event just sits outside the window: still paid.
    return "paid";
  }

  // No paid spend on this keyword at all.
  if (params.organicMarked) return "organic";
  return "none";
}

/**
 * Resolve which keyword a sale belongs to, using the hard-key chain in strict
 * priority order. Returns the keyword and the method that proved it. A human
 * resolution (even one that says "no keyword") wins over everything.
 */
export function resolveSaleKeyword(params: {
  humanResolution?: { keyword: string | null } | null;
  pastedSubscriberId?: string | null;
  bridgeSubscriberId?: string | null;
  bookingKeywordBySubscriber?: ReadonlyMap<string, string>;
  dmKeywordBySubscriber?: ReadonlyMap<string, string>;
  originCheckKeyword?: string | null;
  paidKeywords: ReadonlySet<string>;
}): { keyword: string | null; method: LinkMethod } {
  // 1. A person decided.
  if (params.humanResolution) {
    return { keyword: params.humanResolution.keyword, method: "human" };
  }

  // The subscriber id we can trust: pasted first, else the stored GHL bridge.
  const subscriberId = params.pastedSubscriberId || params.bridgeSubscriberId || null;

  if (subscriberId) {
    // 2. Their booked call's keyword.
    const booked = params.bookingKeywordBySubscriber?.get(subscriberId);
    if (booked) return { keyword: booked, method: "link_booking" };
    // 3. Their DM keyword.
    const dm = params.dmKeywordBySubscriber?.get(subscriberId);
    if (dm) return { keyword: dm, method: "link_dm" };
  }

  // 4. Their ManyChat profile origin keyword, only if that keyword has real
  //    paid spend (guards organic-flow words from false paid credit).
  const origin = (params.originCheckKeyword || "").trim();
  if (origin && params.paidKeywords.has(origin)) {
    return { keyword: origin, method: "origin_check" };
  }

  return { keyword: null, method: "none" };
}

export interface BookingRecord {
  contactId: string | null;
  personName: string | null;
  keyword: string | null;
  startTime: string | null; // ISO
  createdTime: string | null; // ISO
  dmEtDay: string | null;
  createdEtDay?: string | null; // ET day the booking was made
  bookedEtDay: string; // ET day the call is scheduled for
  isUpcoming: boolean;
  taken: boolean; // hard-key-linked taken record (drives "showed")
  ghlStatus?: string | null; // GoHighLevel appointment status (drives "no show")
}

export type PersonCallStatus = "showed" | "noshow" | "upcoming" | "no_outcome";

export interface GroupedPerson {
  name: string;
  dmEtDay: string | null;
  bookedEtDay: string | null;
  callEtDay: string | null;
  status: PersonCallStatus;
  records: number;
}

function isNoShowStatus(status: string | null | undefined): boolean {
  const s = (status || "").toLowerCase().replace(/[\s_-]/g, "");
  return s.includes("noshow");
}

/**
 * Group booking records by person so reschedules collapse to one person, with
 * the record count preserved for the hover. One person = one booked call.
 *
 * Status, cohort-true and hard-key only:
 *   upcoming    the call is in the future (excluded from the show-rate denominator)
 *   showed      a hard-key-linked taken record exists
 *   noshow      GoHighLevel marked it a no-show and there is no taken record
 *   no_outcome  the call day passed with no record either way (NEVER a show)
 */
export function groupBookingsByPerson(records: readonly BookingRecord[]): GroupedPerson[] {
  const byPerson = new Map<string, BookingRecord[]>();
  for (const r of records) {
    const key = r.contactId || `name:${(r.personName || "").toLowerCase()}`;
    const list = byPerson.get(key);
    if (list) list.push(r);
    else byPerson.set(key, [r]);
  }

  const out: GroupedPerson[] = [];
  for (const list of byPerson.values()) {
    // The person's canonical record is their latest-scheduled appointment.
    const sorted = [...list].sort((a, b) =>
      (a.startTime || "").localeCompare(b.startTime || ""),
    );
    const latest = sorted[sorted.length - 1];
    const anyUpcoming = list.some((r) => r.isUpcoming);
    const anyTaken = list.some((r) => r.taken);
    const anyNoShow = list.some((r) => isNoShowStatus(r.ghlStatus));
    const status: PersonCallStatus = anyTaken
      ? "showed"
      : anyUpcoming
        ? "upcoming"
        : anyNoShow
          ? "noshow"
          : "no_outcome";
    const callDay = latest.bookedEtDay; // ET day of the scheduled call
    out.push({
      name: latest.personName || "Unknown",
      dmEtDay: latest.dmEtDay,
      // "Booked" = the day the booking was made; fall back to the call day when
      // the created time is unknown so the column is never blank on a real call.
      bookedEtDay: latest.createdEtDay || callDay,
      callEtDay: callDay,
      status,
      records: list.length,
    });
  }
  // Deterministic ordering: most recent call day first, then name.
  out.sort(
    (a, b) =>
      (b.callEtDay || "").localeCompare(a.callEtDay || "") ||
      a.name.localeCompare(b.name),
  );
  return out;
}

// Local, dependency-free ISO day shift so this file stays pure.
function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
