// ─────────────────────────────────────────────────────────────────────────
// DERIVED METRICS — every calc column is a formula over BASE sums. The TOTAL
// row derives from the summed bases the exact same way a single row does, so
// a total is never a sum of per-row ratios. One function, used everywhere.
// ─────────────────────────────────────────────────────────────────────────

import type { BaseMetrics } from "./types";

export interface DerivedMetrics {
  cpmCents: number | null; // cost per 1000 impressions, in cents
  ctr: number | null; // 0..1
  cpcCents: number | null;
  costPerMessageCents: number | null;
  costPerBookedCents: number | null;
  costPerTakenCents: number | null;
  showRate: number | null; // 0..1, can exceed 1 via cross-window carryover
  closeRate: number | null; // 0..1
  msgToCall: number | null; // 0..1
  costPerClientCents: number | null;
  collectedRoi: number | null; // dollars collected per dollar spent
  leadScore: number | null; // average AI lead score (0-100) of scored leads
}

function div(n: number, d: number): number | null {
  return d ? n / d : null;
}

export function derive(b: BaseMetrics): DerivedMetrics {
  const due = b.booked - b.upcoming;
  // Guard the numerator so a snapshot written before showed_people existed shows
  // 0% (rebuilt correct on the next sync) rather than NaN.
  const showed = b.showedPeople ?? 0;
  return {
    cpmCents: b.impressions ? Math.round((b.spendCents / b.impressions) * 1000) : null,
    ctr: div(b.clicks, b.impressions),
    cpcCents: b.clicks ? Math.round(b.spendCents / b.clicks) : null,
    costPerMessageCents: b.messages ? Math.round(b.spendCents / b.messages) : null,
    costPerBookedCents: b.booked ? Math.round(b.spendCents / b.booked) : null,
    costPerTakenCents: b.taken ? Math.round(b.spendCents / b.taken) : null,
    // Cohort-true show rate: of the people BOOKED in this window (minus
    // upcoming), the share with a hard-key-linked taken record. Numerator and
    // denominator come from the same booked-in-window cohort as the popup, so
    // the cell and its hover always agree. It cannot exceed 100%.
    showRate: due > 0 ? showed / due : null,
    closeRate: div(b.newClients, b.taken),
    msgToCall: div(b.booked, b.messages),
    costPerClientCents: b.newClients ? Math.round(b.spendCents / b.newClients) : null,
    collectedRoi: div(b.collectedCents, b.spendCents),
    // Guarded like showedPeople: snapshots written before the Lead Score pilot
    // carry no fields, and 0 scored leads means "no read", never a zero score.
    leadScore: (b.leadScoreN ?? 0) > 0 ? (b.leadScoreSum ?? 0) / (b.leadScoreN ?? 1) : null,
  };
}
