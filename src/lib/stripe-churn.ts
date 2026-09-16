// Monthly churn of the $50 Forge subscription, computed live from Stripe.
//
// Stripe's REST API has no "churn rate" endpoint (that number only exists in
// the Billing dashboard and in Sigma), so we derive it from the subscription
// list the same way the dashboard does:
//   alive        = status active or past_due (still paying or still retrying)
//   canceled     = subscription ended in the month (voluntary churn)
//   unpaid       = first never-paid invoice created in the month; Stripe left
//                  the subscription at status "unpaid" (involuntary churn)
//   churn rate   = (canceled + unpaid) / alive at the start of the month
// Our own stripe_subscriptions table cannot answer this: the webhook only
// learns about cancellations, never about past_due -> unpaid.

import Stripe from "stripe";
import { DOWNSELL_PRICE_ID } from "./stripe-downsell";

export type ChurnMonth = {
  monthStart: string; // YYYY-MM-01
  monthLabel: string; // "August 2026"
  priceId: string;
  startActive: number;
  newSubs: number;
  canceled: number;
  unpaid: number;
  churned: number;
  churnRatePct: number; // one decimal, e.g. 28.5
  endActive: number;
  /** True when the month is still running (end_active = alive right now). */
  partial: boolean;
};

type SubLite = {
  id: string;
  status: string;
  created: number;
  endedAt: number | null; // unix seconds when the subscriber stopped being alive
};

function stripeClient(): Stripe {
  const key = process.env.STRIPE_KEY_TYSON_SUBS || process.env.STRIPE_SECRET_KEY_TYSON_SUBS;
  if (!key) throw new Error("STRIPE_KEY_TYSON_SUBS is not configured");
  return new Stripe(key);
}

/** Pull every subscription ever created on the $50 price, with the moment each
 *  one stopped being alive. Unpaid subscriptions need one extra invoice read
 *  each (about a hundred calls today). */
export async function loadDownsellSubscriptions(stripe = stripeClient()): Promise<SubLite[]> {
  const out: SubLite[] = [];
  const unpaidIds: string[] = [];
  for await (const s of stripe.subscriptions.list({ status: "all", price: DOWNSELL_PRICE_ID, limit: 100 })) {
    let endedAt: number | null = null;
    if (s.status === "canceled") endedAt = s.ended_at ?? s.canceled_at ?? null;
    if (s.status === "unpaid") unpaidIds.push(s.id);
    out.push({ id: s.id, status: s.status, created: s.created, endedAt });
  }
  // Involuntary churn: the first invoice that was never paid marks the death.
  // One invoice read per unpaid subscription (about a hundred today), run
  // eight at a time so the cron stays far inside its 300 s budget.
  const bySub = new Map(out.map((s) => [s.id, s]));
  const firstUnpaidInvoice = async (id: string): Promise<number | null> => {
    let first: number | null = null;
    for await (const inv of stripe.invoices.list({ subscription: id, limit: 100 })) {
      if (inv.status === "paid") continue;
      if (first === null || inv.created < first) first = inv.created;
    }
    return first;
  };
  const BATCH = 8;
  for (let i = 0; i < unpaidIds.length; i += BATCH) {
    const slice = unpaidIds.slice(i, i + BATCH);
    const firsts = await Promise.all(slice.map(firstUnpaidInvoice));
    slice.forEach((id, j) => {
      const sub = bySub.get(id)!;
      sub.endedAt = firsts[j] ?? sub.created;
    });
  }
  return out;
}

export function monthBoundsUtc(monthStart: string): { start: number; end: number; label: string } {
  const [y, m] = monthStart.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1) / 1000;
  const end = Date.UTC(y, m, 1) / 1000;
  const label = new Date(start * 1000).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

/** The calendar month before the given instant, as YYYY-MM-01 (UTC). */
export function previousMonthStart(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 10);
}

export function computeChurnMonth(subs: SubLite[], monthStart: string, now = new Date()): ChurnMonth {
  const { start, end, label } = monthBoundsUtc(monthStart);
  const nowSec = Math.floor(now.getTime() / 1000);
  const alive = (s: SubLite, t: number) => s.created < t && (s.endedAt === null || s.endedAt >= t);
  const startActive = subs.filter((s) => alive(s, start)).length;
  const newSubs = subs.filter((s) => s.created >= start && s.created < end).length;
  const canceled = subs.filter((s) => s.status === "canceled" && s.endedAt !== null && s.endedAt >= start && s.endedAt < end).length;
  const unpaid = subs.filter((s) => s.status === "unpaid" && s.endedAt !== null && s.endedAt >= start && s.endedAt < end).length;
  const churned = canceled + unpaid;
  const partial = end > nowSec;
  const endActive = subs.filter((s) => alive(s, Math.min(end, nowSec))).length;
  const churnRatePct = startActive > 0 ? Math.round((churned / startActive) * 1000) / 10 : 0;
  return { monthStart, monthLabel: label, priceId: DOWNSELL_PRICE_ID, startActive, newSubs, canceled, unpaid, churned, churnRatePct, endActive, partial };
}

/** Plain-English Slack text for one month. */
export function churnSlackText(c: ChurnMonth): string {
  const lines = [
    `*$50 Forge subscription churn for ${c.monthLabel}${c.partial ? " (month still running)" : ""}*`,
    `Churn rate: *${c.churnRatePct.toFixed(1)}%*`,
    ``,
    `We started ${c.monthLabel} with ${c.startActive} paying subscribers.`,
    `${c.churned} of them stopped paying during the month.`,
    `${c.canceled} canceled on purpose.`,
    `${c.unpaid} stopped paying because their card failed and never recovered.`,
    `${c.newSubs} new subscribers joined.`,
    `We ended the month with ${c.endActive} paying subscribers.`,
    ``,
    `_Churn rate = subscribers who stopped paying in the month, divided by paying subscribers on the 1st. Source: Stripe account "The Forge - Subscriptions", $50 every 4 weeks price._`,
  ];
  return lines.join("\n");
}
