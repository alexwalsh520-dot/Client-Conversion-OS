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

export const NEW_CLIENT_MIN_CENTS = 2000;   // $20 — ignore ebook/test micro-sales
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

  cacAdSpendCents: number;
  cacMercurySoftwareCents: number;
  cacSalesCommissionsCents: number;
  cacTotalCents: number;
  cacPerNewClientCents: number;

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

  // 2. Cohort first-30-day revenue (per cohort customer: sum their charges within first 30d).
  const cohortCutoffMs = COHORT_DAYS * 24 * 60 * 60 * 1000;
  let cohortGrossCents = 0;
  for (const cust of cohortCustomers) {
    const cutoff = new Date(cust.firstAt.getTime() + cohortCutoffMs);
    for (const c of cust.charges) {
      const d = new Date(c.created_at);
      if (d > cutoff) continue;
      cohortGrossCents += centsNet(c);
    }
  }

  const perNewClientGross = newClientCount > 0 ? Math.round(cohortGrossCents / newClientCount) : 0;

  // 3. Direct costs per new client per month.
  //    Coaching cost per end-client per month = (payroll + software) / total active end-clients
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
  const directCostsPerNewClient = perEndClientCoachingMonthly + extraMonthly + feeDragPerClient;

  const gp30 = perNewClientGross - directCostsPerNewClient;

  // 4. CAC inputs (window-level totals; divided by new client count).
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
  const cacTotal = adSpend + mercuryAcq + salesCommissions;
  const cacPerNewClient = newClientCount > 0 ? Math.round(cacTotal / newClientCount) : 0;

  // 5. LTGP — monthly GP per active client × avg program months.
  //    monthly GP per active = (ongoing monthly revenue per client) − per-client monthly costs.
  //    We approximate "ongoing monthly revenue per active client" as total last-30d revenue
  //    for this client / active clients for this client.
  let monthlyRevenuePerActive = 0;
  let activeCount = 0;
  if (clientKey === "total") {
    activeCount = (inputs.activeClientsByInfluencer.keith ?? 0) + (inputs.activeClientsByInfluencer.tyson ?? 0);
  } else {
    activeCount = inputs.activeClientsByInfluencer[clientKey] ?? 0;
  }
  // Compute last-30d total revenue for this client scope.
  let revenue30 = 0;
  for (const [, cust] of customerIndex) {
    if (clientKey !== "total" && cust.influencer !== clientKey) continue;
    for (const c of cust.charges) {
      const d = new Date(c.created_at);
      if (d < windowStart || d > windowEnd) continue;
      revenue30 += centsNet(c);
    }
  }
  monthlyRevenuePerActive = activeCount > 0 ? Math.round(revenue30 / activeCount) : 0;
  const monthlyGpPerActive =
    monthlyRevenuePerActive -
    perEndClientCoachingMonthly -
    extraMonthly -
    Math.round(monthlyRevenuePerActive * percentageDrag);
  const ltgp = Math.round(monthlyGpPerActive * inputs.avgProgramMonths);

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

    cacAdSpendCents: adSpend,
    cacMercurySoftwareCents: mercuryAcq,
    cacSalesCommissionsCents: salesCommissions,
    cacTotalCents: cacTotal,
    cacPerNewClientCents: cacPerNewClient,

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
