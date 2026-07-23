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
}

function div(n: number, d: number): number | null {
  return d ? n / d : null;
}

export function derive(b: BaseMetrics): DerivedMetrics {
  const due = b.booked - b.upcoming;
  return {
    cpmCents: b.impressions ? Math.round((b.spendCents / b.impressions) * 1000) : null,
    ctr: div(b.clicks, b.impressions),
    cpcCents: b.clicks ? Math.round(b.spendCents / b.clicks) : null,
    costPerMessageCents: b.messages ? Math.round(b.spendCents / b.messages) : null,
    costPerBookedCents: b.booked ? Math.round(b.spendCents / b.booked) : null,
    costPerTakenCents: b.taken ? Math.round(b.spendCents / b.taken) : null,
    // Show rate uses distinct PEOPLE taken over people booked minus upcoming.
    showRate: due > 0 ? b.takenPeople / due : null,
    closeRate: div(b.newClients, b.taken),
    msgToCall: div(b.booked, b.messages),
    costPerClientCents: b.newClients ? Math.round(b.spendCents / b.newClients) : null,
    collectedRoi: div(b.collectedCents, b.spendCents),
  };
}
