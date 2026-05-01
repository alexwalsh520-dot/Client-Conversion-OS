/**
 * Pure helpers for the "months remaining to deliver" Cash Reserve card.
 *
 * No I/O. Both functions are deterministic given their inputs so they're
 * safe to call client-side from the Expenses tab.
 *
 * Spec (from Matt's transcript, reaffirmed in design):
 *   - Reference date = most recent past 14th OR 28th of the month. The
 *     metric snapshots to the invoice-cycle cadence, stays stable between
 *     invoice dates, snaps to a new value on the 14th and 28th.
 *   - For each active client:
 *       - If endDate is missing → 1 month (un-ending programs)
 *       - daysRemaining ≤ 0 (program already ended) → 0 months
 *       - Otherwise → ceil(daysRemaining / 28). So 28 days = 1 month,
 *         29 days = 2 months, 56 days = 2 months, 57 days = 3 months.
 *   - Sum across all active clients = total client-months remaining.
 *   - Cash reserve needed = months × per-client rate.
 */

/**
 * Returns the most recent past 14th or 28th relative to `today`.
 *
 * Rules:
 *   - If today is exactly the 14th or 28th, returns today (00:00 UTC).
 *   - Else returns whichever of the two anchors is most recent.
 *   - Across month boundaries: if today is the 1st-13th, the most recent
 *     anchor is the 28th of the previous month.
 */
export function referenceInvoiceDate(today: Date = new Date()): Date {
  // Work in UTC to avoid timezone drift across servers / browsers.
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const d = today.getUTCDate();

  const this28 = new Date(Date.UTC(y, m, 28));
  const this14 = new Date(Date.UTC(y, m, 14));

  if (d >= 28) return this28;
  if (d >= 14) return this14;
  // d is 1–13 → most recent invoice date is the 28th of the previous month
  return new Date(Date.UTC(y, m - 1, 28));
}

/**
 * Days between two dates, integer, positive = b is after a.
 */
function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / MS_PER_DAY);
}

export interface ClientWithDates {
  status: string;
  startDate?: string | null;
  endDate?: string | null;
}

/**
 * Compute months-remaining for a single active client at the reference
 * date. See the spec at the top of this file.
 */
export function monthsForClient(
  client: ClientWithDates,
  referenceDate: Date,
): number {
  if (client.status !== "active") return 0;
  if (!client.endDate) return 1; // un-ending program → counts as 1
  const end = new Date(client.endDate);
  if (Number.isNaN(end.getTime())) return 1; // unparseable → treat as un-ending
  const days = daysBetween(referenceDate, end);
  if (days <= 0) return 0; // program already ended → 0
  return Math.ceil(days / 28);
}

/**
 * Sum monthsForClient across the active client roster. Returns the
 * aggregate count + the per-client breakdown for diagnostic display
 * (the UI can use the breakdown count to show "X clients excluded
 * (program ended)" etc. if we want).
 */
export function sumMonthsRemaining(
  clients: ClientWithDates[],
  referenceDate: Date,
): {
  total_months: number;
  active_count: number;
  ended_count: number; // active in DB but endDate already past
  no_end_date_count: number; // counted as 1 each
} {
  let total = 0;
  let active = 0;
  let ended = 0;
  let noEnd = 0;
  for (const c of clients) {
    if (c.status !== "active") continue;
    active += 1;
    const m = monthsForClient(c, referenceDate);
    total += m;
    if (m === 0) ended += 1;
    if (!c.endDate) noEnd += 1;
  }
  return {
    total_months: total,
    active_count: active,
    ended_count: ended,
    no_end_date_count: noEnd,
  };
}
