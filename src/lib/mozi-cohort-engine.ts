// True "new-customer cohort" Mozi math.
//
// Definitions (user-confirmed 2026-04-21):
//   NEW CLIENT   = stripe customer whose FIRST-EVER charge landed in the window
//                  [now - windowDays, now]. Charges below NEW_CLIENT_MIN_CENTS are
//                  ignored for first-charge detection (e.g. $6 Neville Formula
//                  should not flag someone as a new coaching client).
//   GP30         = cohort's first-30-day revenue - direct costs, per new client.
//                  Upsells sold in the first 30 days ARE included (we sum every
//                  charge the cohort customer made in their first 30 days).
//   CAC          = (meta ad spend + mercury acquisition SaaS + sales-team
//                  commissions) in the window, divided by the number of new
//                  clients in the window.
//   LTGP         = monthly_gp_per_active_client × avg_program_months.
//   CAPACITY     = active end-clients / total max seats across all coaches.

import type { ClientKey } from "./mozi-costs-config";

// Raised to $200 so $50/wk Forge Enforcement Challenge + similar low-ticket
// subscription rebills don't count as "new coaching clients" — they dilute
// both AOV and CAC/new in a way that hides the real coaching-program economics.
// Real coaching programs always enter at $200+.
export const NEW_CLIENT_MIN_CENTS = 20000;  // $200 floor for a "new client"
export const DEFAULT_WINDOW_DAYS = 30;
export const COHORT_DAYS = 30;

export interface Charge {
  customer_id: string | null;
  customer_email?: string | null;
  influencer: ClientKey | string | null;
  amount: number;                          // cents (gross)
  refund_amount?: number | null;           // cents
  created_at: string;                      // ISO
}

export interface CohortInputs {
  windowDays?: number;
  now?: Date;

  /** Every Stripe charge we know about (180d lookback minimum for accuracy). */
  allCharges: Charge[];

  /** Active end-client count per influencer, used for capacity + per-client divisions. */
  activeClientsByInfluencer: Record<ClientKey, number>;
  /** Total active end-clients across all influencers (for allocating ops-wide fulfillment costs). */
  totalActiveClients: number;

  /** Total fulfillment payroll per month (coach+nutrition+PM from Mercury). */
  fulfillmentPayrollMonthlyCents: number;
  /** Total fulfillment SaaS per month (Everfit), ops-wide. */
  fulfillmentSoftwareMonthlyCents: number;

  /** Optional static per-client-per-month costs (additive to payroll share). */
  extraMonthlyCostPerClientCents?: number;

  /** Fee drag applied to revenue: 2.9% Stripe + 1% chargeback etc. */
  paymentFeePct: number;
  chargebackPct: number;
  refundPct: number;

  /** Last-30d Meta ad spend per client (cents). */
  metaAdSpendByClient: Record<ClientKey, number>;
  /** Last-30d Mercury acquisition SaaS per client (cents), incl. ManyChat. */
  mercuryAcquisitionByClient: Record<ClientKey, number>;
  /** Last-30d sales-team commissions per client (cents). */
  salesCommissionsByClient: Record<ClientKey, number>;

  /** Average program length in months (per client or single global) for LTGP. */
  avgProgramMonths: number;

  /** Max coach capacity seats across all coaches. 0 if not provided → capacity unknown. */
  totalMaxClientSeats: number;
}

export interface ClientCohortResult {
  client: ClientKey | "total";
  newClientCount: number;
  cohortRevenueCents: number;
  cohortGrossRevenuePerNewClientCents: number;   // before costs
  directCostsPerNewClientCents: number;
  gp30Cents: number;                              // per new client, post-costs

  // GP30 direct-cost breakdown (all per new client)
  coachingCostPerNewClientCents: number;
  feeDragPerNewClientCents: number;
  commissionsPerNewClientCents: number;

  // CAC = marketing-side only (ads + acquisition SaaS)
  cacAdSpendCents: number;
  cacMercurySoftwareCents: number;
  cacTotalCents: number;
  cacPerNewClientCents: number;

  // Sales commissions are now in GP30, but we keep the window total here
  // for the report view (lets user see commission $$ separately).
  salesCommissionsWindowCents: number;

  monthlyGpPerActiveClientCents: number;
  ltgpCents: number;

  capacity?: {
    currentClients: number;
    maxClients: number;
    pct: number;
  };
}

export interface CohortEngineOutput {
  windowStart: string;
  windowEnd: string;
  perClient: Record<ClientKey, ClientCohortResult>;
  total: ClientCohortResult;
}

function normalizeInfluencer(v: string | null | undefined): ClientKey | null {
  if (!v) return null;
  const x = String(v).toLowerCase();
  if (x === "keith") return "keith";
  if (x === "tyson") return "tyson";
  return null;
}

function customerKey(c: Charge): string | null {
  return c.customer_id ?? (c.customer_email ? c.customer_email.toLowerCase() : null);
}

function centsNet(c: Charge): number {
  const gross = c.amount ?? 0;
  const refund = c.refund_amount ?? 0;
  return Math.max(0, gross - refund);
}

// Collapse duplicate big-ticket charges from the same customer that are almost
// certainly a card-change / payment-plan swap / accidental double charge.
// Rule (user-confirmed 2026-04-22): if two or more charges >= $500 from the same
// customer occur within 7 days AND their amounts are within ~30% of each other,
// treat them as one purchase and keep only the first one. Unrelated charges
// (micro-sales, genuine upgrade from $500 to $2,000) pass through.
const DUP_MIN_CENTS = 50000;             // $500 threshold
const DUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DUP_PRICE_RATIO_MIN = 0.7;         // within ~30% price band

function dedupeDoubleCharges(charges: Charge[]): Charge[] {
  const sorted = [...charges].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const kept: Charge[] = [];
  for (const c of sorted) {
    const amount = centsNet(c);
    if (amount < DUP_MIN_CENTS) {
      kept.push(c);
      continue;
    }
    const cDate = new Date(c.created_at).getTime();
    const isDupe = kept.some((k) => {
      const kAmount = centsNet(k);
      if (kAmount < DUP_MIN_CENTS) return false;
      const dt = cDate - new Date(k.created_at).getTime();
      if (dt < 0 || dt > DUP_WINDOW_MS) return false;
      const ratio = Math.min(amount, kAmount) / Math.max(amount, kAmount);
      return ratio >= DUP_PRICE_RATIO_MIN;
    });
    if (!isDupe) kept.push(c);
  }
  return kept;
}

/** Build: customerKey → { firstChargeAt, firstCharge, influencer, charges[] }. */
function indexCustomers(charges: Charge[]) {
  const map = new Map<string, {
    firstAt: Date;
    firstCharge: Charge;
    influencer: ClientKey | null;
    charges: Charge[];
  }>();

  // Sort ascending so first-seen wins.
  const sorted = [...charges].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  for (const c of sorted) {
    const key = customerKey(c);
    if (!key) continue;
    const infl = normalizeInfluencer(c.influencer as string | null);
    if (!infl) continue;                           // ignore zoeEmily and unattributed

    const existing = map.get(key);
    if (existing) {
      existing.charges.push(c);
      continue;
    }
    // Only start a cohort from a "real" charge (ignore $6 ebook-type micro sales).
    if (centsNet(c) < NEW_CLIENT_MIN_CENTS) continue;

    map.set(key, {
      firstAt: new Date(c.created_at),
      firstCharge: c,
      influencer: infl,
      charges: [c],
    });
  }
  return map;
}

function computeClient(
  clientKey: ClientKey | "total",
  inputs: CohortInputs,
  windowStart: Date,
  windowEnd: Date,
  customerIndex: ReturnType<typeof indexCustomers>,
): ClientCohortResult {
  // 1. Find new clients (first charge in window) matching the client filter.
  const cohortCustomers: Array<{ firstAt: Date; charges: Charge[] }> = [];
  for (const [, cust] of customerIndex) {
    if (cust.firstAt < windowStart || cust.firstAt > windowEnd) continue;
    if (clientKey !== "total" && cust.influencer !== clientKey) continue;
    cohortCustomers.push({ firstAt: cust.firstAt, charges: cust.charges });
  }
  const newClientCount = cohortCustomers.length;

  // 2. Cohort first-30-day revenue per new client, with duplicate-charge dedupe
  //    (card-change / accidental-double / payment-plan swap). Refunds are
  //    already netted inside centsNet() via Stripe's refund_amount field.
  const cohortCutoffMs = COHORT_DAYS * 24 * 60 * 60 * 1000;
  let cohortGrossCents = 0;
  for (const cust of cohortCustomers) {
    const deduped = dedupeDoubleCharges(cust.charges);
    const cutoff = new Date(cust.firstAt.getTime() + cohortCutoffMs);
    for (const c of deduped) {
      const d = new Date(c.created_at);
      if (d > cutoff) continue;
      cohortGrossCents += centsNet(c);
    }
  }

  const perNewClientGross = newClientCount > 0 ? Math.round(cohortGrossCents / newClientCount) : 0;

  // 3. CAC = marketing-side only. Ad spend + acquisition SaaS. Commissions are
  //    a COST OF THE SALE, not a customer-acquisition cost, so they belong in
  //    GP30 direct costs below (user-confirmed 2026-04-22).
  let adSpend = 0, mercuryAcq = 0, salesCommissions = 0;
  if (clientKey === "total") {
    adSpend = (inputs.metaAdSpendByClient.keith ?? 0) + (inputs.metaAdSpendByClient.tyson ?? 0);
    mercuryAcq = (inputs.mercuryAcquisitionByClient.keith ?? 0) + (inputs.mercuryAcquisitionByClient.tyson ?? 0);
    salesCommissions = (inputs.salesCommissionsByClient.keith ?? 0) + (inputs.salesCommissionsByClient.tyson ?? 0);
  } else {
    adSpend = inputs.metaAdSpendByClient[clientKey] ?? 0;
    mercuryAcq = inputs.mercuryAcquisitionByClient[clientKey] ?? 0;
    salesCommissions = inputs.salesCommissionsByClient[clientKey] ?? 0;
  }
  const cacTotal = adSpend + mercuryAcq;
  const cacPerNewClient = newClientCount > 0 ? Math.round(cacTotal / newClientCount) : 0;

  // 4. Direct costs per new client — deducted from cohort revenue to get GP30.
  //    Coaching+software share (fulfillment cost over month 1),
  //    payment fees (Stripe + chargeback + refund drag),
  //    sales-team commissions (paid immediately on sale, ~10% closer + 3-5% setter).
  const perEndClientCoachingMonthly =
    inputs.totalActiveClients > 0
      ? Math.round(
          (inputs.fulfillmentPayrollMonthlyCents + inputs.fulfillmentSoftwareMonthlyCents) /
            inputs.totalActiveClients,
        )
      : 0;
  const extraMonthly = inputs.extraMonthlyCostPerClientCents ?? 0;
  const percentageDrag = (inputs.paymentFeePct + inputs.chargebackPct + inputs.refundPct) / 100;
  const feeDragPerClient = Math.round(perNewClientGross * percentageDrag);
  const commissionsPerNewClient = newClientCount > 0
    ? Math.round(salesCommissions / newClientCount)
    : 0;
  const directCostsPerNewClient =
    perEndClientCoachingMonthly + extraMonthly + feeDragPerClient + commissionsPerNewClient;

  const gp30 = perNewClientGross - directCostsPerNewClient;

  // 5. LTGP — REALIZED observed lifetime revenue per paying customer, minus
  //    direct costs incurred over that tenure.
  //
  //    Old formula (monthly_revenue × program_months) was wrong for this
  //    business: most revenue is one-time program sales, so multiplying
  //    again by program months counted the same dollars 4×. That inflated
  //    Keith's LTGP to $10k when his real AOV is $1,610.
  //
  //    New formula: for every paying customer we've seen, sum their total
  //    charges; average across customers = LTV; subtract coaching +
  //    software cost over their observed tenure, and fee drag on their
  //    revenue. That's LTGP.
  let revenueSum = 0;
  let customerCountForLtv = 0;
  let tenureMonthsSum = 0;
  const nowMs = windowEnd.getTime();
  for (const [, cust] of customerIndex) {
    if (clientKey !== "total" && cust.influencer !== clientKey) continue;
    let custRevenue = 0;
    for (const c of cust.charges) {
      custRevenue += centsNet(c);
    }
    if (custRevenue <= 0) continue;
    revenueSum += custRevenue;
    customerCountForLtv += 1;
    tenureMonthsSum += Math.max(0.5, (nowMs - cust.firstAt.getTime()) / (1000 * 60 * 60 * 24 * 30));
  }
  const avgObservedLtv = customerCountForLtv > 0 ? Math.round(revenueSum / customerCountForLtv) : 0;
  const avgObservedTenureMonths = customerCountForLtv > 0 ? tenureMonthsSum / customerCountForLtv : 0;
  const coachingCostOverTenure = Math.round(perEndClientCoachingMonthly * avgObservedTenureMonths);
  const feeDragOverLtv = Math.round(avgObservedLtv * percentageDrag);
  const ltgp = Math.max(0, avgObservedLtv - coachingCostOverTenure - feeDragOverLtv);

  // monthlyGpPerActive kept for the breakdown report (useful signal).
  const monthlyGpPerActive = avgObservedTenureMonths > 0
    ? Math.round((avgObservedLtv - feeDragOverLtv) / avgObservedTenureMonths) - perEndClientCoachingMonthly
    : 0;

  const activeCount = clientKey === "total"
    ? (inputs.activeClientsByInfluencer.keith ?? 0) + (inputs.activeClientsByInfluencer.tyson ?? 0)
    : (inputs.activeClientsByInfluencer[clientKey] ?? 0);

  // 6. Capacity (Total only in the UI, but we compute it generically).
  let capacity: ClientCohortResult["capacity"] | undefined;
  if (inputs.totalMaxClientSeats > 0) {
    const current = clientKey === "total" ? inputs.totalActiveClients : (inputs.activeClientsByInfluencer[clientKey] ?? 0);
    capacity = {
      currentClients: current,
      maxClients: inputs.totalMaxClientSeats,
      pct: Math.round((current / inputs.totalMaxClientSeats) * 100),
    };
  }

  return {
    client: clientKey,
    newClientCount,
    cohortRevenueCents: cohortGrossCents,
    cohortGrossRevenuePerNewClientCents: perNewClientGross,
    directCostsPerNewClientCents: directCostsPerNewClient,
    gp30Cents: gp30,

    coachingCostPerNewClientCents: perEndClientCoachingMonthly + extraMonthly,
    feeDragPerNewClientCents: feeDragPerClient,
    commissionsPerNewClientCents: commissionsPerNewClient,

    cacAdSpendCents: adSpend,
    cacMercurySoftwareCents: mercuryAcq,
    cacTotalCents: cacTotal,
    cacPerNewClientCents: cacPerNewClient,

    salesCommissionsWindowCents: salesCommissions,

    monthlyGpPerActiveClientCents: monthlyGpPerActive,
    ltgpCents: ltgp,

    capacity,
  };
}

export function runCohortEngine(inputs: CohortInputs): CohortEngineOutput {
  const now = inputs.now ?? new Date();
  const windowDays = inputs.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const idx = indexCustomers(inputs.allCharges);

  const perClient: Record<ClientKey, ClientCohortResult> = {
    keith: computeClient("keith", inputs, windowStart, windowEnd, idx),
    tyson: computeClient("tyson", inputs, windowStart, windowEnd, idx),
  };
  const total = computeClient("total", inputs, windowStart, windowEnd, idx);

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    perClient,
    total,
  };
}
