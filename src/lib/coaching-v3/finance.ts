/**
 * Coaching V3 retention + refund datasource.
 *
 * Rewired 2026-09-15 per MAS: V3 must match legacy V1's numbers. V1 reads
 * from two Google Sheets via /api/coaching/financials:
 *   - Sales Tracker → "Flagship Retention Payments" table per month
 *   - Cancellations & Refunds sheet
 *
 * We reuse V2's existing fetchFinancials helper (which forwards the caller's
 * cookie to the internal V1 endpoint), then aggregate per coach + per month
 * so V3's Today KPI, Coaches rollup and Money page all render off one shape.
 */

import { fetchFinancials, isRealRefund, type RefundRow, type RetentionRow } from "@/lib/coaching-v2/financials";

const norm = (s: string | null | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export interface CoachFinance {
  coach: string;
  retentionCount: number;
  retentionRevenue: number;
  refundCount: number;
  refundAmount: number;
}

export interface FinanceMonthView {
  monthIndex: number;
  monthName: string;
  retentions: RetentionRow[];
  refunds: RefundRow[];
  retentionCount: number;
  retentionRevenue: number;
  refundCount: number;
  refundAmount: number;
  byCoach: CoachFinance[];
  error?: string;
}

/** Load finance data for a given calendar-month index (0-11). Aggregates by coach.
 *  Coach-name normalization is intentionally light: we trust the sales tracker's
 *  "Coach" column and only .trim(). If tracker spells a coach differently from
 *  CCOS ("Steph" vs "Stef"), aggregation lives under the tracker's spelling —
 *  MAS can reconcile in the sheet. */
export async function loadFinanceMonth(monthIndex: number): Promise<FinanceMonthView> {
  const f = await fetchFinancials(monthIndex);
  const retentions = f.retentions ?? [];
  const realRefunds = (f.refunds ?? []).filter(isRealRefund);

  const byCoachMap = new Map<string, CoachFinance>();
  const bump = (coach: string, updater: (row: CoachFinance) => void) => {
    const k = coach.trim() || "Unassigned";
    const row =
      byCoachMap.get(k) ??
      { coach: k, retentionCount: 0, retentionRevenue: 0, refundCount: 0, refundAmount: 0 };
    updater(row);
    byCoachMap.set(k, row);
  };
  for (const r of retentions) {
    bump(r.coach, (row) => {
      row.retentionCount += 1;
      row.retentionRevenue += Number(r.paymentTotal) || 0;
    });
  }
  for (const r of realRefunds) {
    bump(r.salesPerson, (row) => {
      row.refundCount += 1;
      row.refundAmount += Number(r.amount) || 0;
    });
  }

  const byCoach = [...byCoachMap.values()].sort(
    (a, b) => b.retentionRevenue - a.retentionRevenue || a.coach.localeCompare(b.coach),
  );

  return {
    monthIndex,
    monthName: f.month || "",
    retentions,
    refunds: realRefunds,
    retentionCount: retentions.length,
    retentionRevenue: retentions.reduce((s, r) => s + (Number(r.paymentTotal) || 0), 0),
    refundCount: realRefunds.length,
    refundAmount: realRefunds.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    byCoach,
    error: f.error,
  };
}

/** Case- and space-insensitive coach-name lookup on a byCoach list. Falls back
 *  to zero. Used to attach sheet retention data to Coaching V3's per-coach row. */
export function financeForCoach(view: FinanceMonthView, coachName: string): CoachFinance {
  const k = norm(coachName);
  const hit = view.byCoach.find((c) => norm(c.coach) === k);
  return (
    hit ?? { coach: coachName, retentionCount: 0, retentionRevenue: 0, refundCount: 0, refundAmount: 0 }
  );
}
