// engine.ts — Hormozi decision engine
// All monetary values in cents (integer)

export type Status = 'buy' | 'hold-payback' | 'hold-cash' | 'hold-capacity' | 'stop';

export interface EngineInput {
  gp30: number;           // cents, 30-day gross profit per client
  cac: number;            // cents, cost to acquire a client
  ltgp: number;           // cents, lifetime gross profit per client
  requiredRatio: number;  // from business type setting
  capacityPct: number;    // 0-100
  runwayMonths: number;   // decimal
}

export interface EngineResult {
  status: Status;
  ratio: number;
  payback30: number;      // cents
  gp30: number;
  cac: number;
  ltgp: number;
  capacityPct: number;
  runwayMonths: number;
  requiredRatio: number;
  safeBudget: number;     // cents
  headroom: number;       // cents
  currentAdSpend: number; // cents
  cashOnHand: number;     // cents
  monthlyBurn: number;    // cents
}

export function getStatus(d: EngineInput): Status {
  const ratio = d.cac > 0 ? d.ltgp / d.cac : 0;
  const payback30 = d.gp30 - d.cac;
  if (ratio < d.requiredRatio) return 'stop';
  if (payback30 < 0) return 'hold-payback';
  if (d.runwayMonths < 2) return 'hold-cash';
  if (d.capacityPct >= 90) return 'hold-capacity';
  return 'buy';
}

// ── Settings shape (from Supabase settings table) ───────────────────

interface CostSettings {
  coaching_per_client?: number;     // cents/month
  software_per_client?: number;     // cents/month
  nutrition_per_client?: number;    // cents/month
  onboarding_per_client?: number;   // cents (one-time, amortized over 12 months)
  payment_fee_pct?: number;         // e.g. 3.5
  refund_rate_pct?: number;         // e.g. 5
  chargeback_rate_pct?: number;     // e.g. 1
}

interface TargetSettings {
  new_clients_monthly?: number;
}

interface CoachRow {
  name: string;
  current_clients: number;
  max_clients: number;
}

interface SettingsMap {
  business_type: string;            // 'coaching' | 'ecommerce' | 'saas'
  costs: CostSettings;
  targets: TargetSettings;
  coaches: CoachRow[];
}

// Required LTGP:CAC ratio per business type
const REQUIRED_RATIOS: Record<string, number> = {
  coaching: 3,
  ecommerce: 3,
  saas: 5,
};

// ── Data shapes from Supabase tables ────────────────────────────────

interface RevenueRow {
  amount: number;           // cents
  created_at: string;
  customer_email?: string;
  refunded?: boolean;
  refund_amount?: number;
}

interface AdSpendRow {
  date: string;
  spend: number;            // cents
  influencer?: string;
}

interface MercuryBalance {
  account: string;
  balance: number;          // cents
}

interface MercuryTransaction {
  amount: number;           // cents (negative = debit)
  posted_at: string;
}

// ── computeKPIs ─────────────────────────────────────────────────────

export function computeKPIs(
  settings: SettingsMap,
  revenueData: RevenueRow[],
  adSpendData: AdSpendRow[],
  mercuryBalances: MercuryBalance[],
  mercuryTransactions: MercuryTransaction[],
  coachData: CoachRow[],
): EngineResult {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // ── Revenue (last 30 days) ──────────────────────────────────────
  const recentRevenue = revenueData.filter(
    (r) => new Date(r.created_at) >= thirtyDaysAgo,
  );
  const totalRevenue30 = recentRevenue.reduce((sum, r) => sum + r.amount, 0);

  // Count unique new clients (distinct customer emails) in last 30 days
  const uniqueEmails = new Set(
    recentRevenue
      .map((r) => r.customer_email?.toLowerCase())
      .filter(Boolean),
  );
  const newClients30 = Math.max(uniqueEmails.size, 1); // avoid /0

  const revenuePerClient = Math.round(totalRevenue30 / newClients30);

  // ── Direct costs per client ─────────────────────────────────────
  const costs = settings.costs || {};
  const coaching = costs.coaching_per_client ?? 0;
  const software = costs.software_per_client ?? 0;
  const nutrition = costs.nutrition_per_client ?? 0;
  const onboardingAmortized = Math.round(
    (costs.onboarding_per_client ?? 0) / 12,
  );
  const paymentFeePct = costs.payment_fee_pct ?? 0;
  const refundRatePct = costs.refund_rate_pct ?? 0;
  const chargebackRatePct = costs.chargeback_rate_pct ?? 0;

  const directCosts =
    coaching +
    software +
    nutrition +
    onboardingAmortized;

  const percentageDrag = paymentFeePct + refundRatePct + chargebackRatePct;
  const percentageDeduction = Math.round(
    revenuePerClient * (percentageDrag / 100),
  );

  const gp30 = revenuePerClient - directCosts - percentageDeduction;

  // ── CAC ─────────────────────────────────────────────────────────
  const recentAdSpend = adSpendData.filter(
    (a) => new Date(a.date) >= thirtyDaysAgo,
  );
  const totalAdSpend30 = recentAdSpend.reduce((sum, a) => sum + a.spend, 0);
  const cac = Math.round(totalAdSpend30 / newClients30);

  // ── LTGP ────────────────────────────────────────────────────────
  // Churn approximation: if no churn data, default 10%
  const churnPct = refundRatePct > 0 ? refundRatePct : 10;
  const ltgp = churnPct > 0 ? Math.round(gp30 / (churnPct / 100)) : gp30 * 12;

  // ── Capacity ────────────────────────────────────────────────────
  const coaches = coachData.length > 0 ? coachData : settings.coaches || [];
  const totalCurrent = coaches.reduce((s, c) => s + (c.current_clients || 0), 0);
  const totalMax = coaches.reduce((s, c) => s + (c.max_clients || 0), 0);
  const capacityPct = totalMax > 0 ? Math.round((totalCurrent / totalMax) * 100) : 0;

  // ── Cash / Runway ───────────────────────────────────────────────
  const cashOnHand = mercuryBalances.reduce((s, b) => s + b.balance, 0);

  const recentDebits = mercuryTransactions.filter(
    (t) => new Date(t.posted_at) >= thirtyDaysAgo && t.amount < 0,
  );
  const monthlyBurn = Math.abs(
    recentDebits.reduce((s, t) => s + t.amount, 0),
  );
  const runwayMonths = monthlyBurn > 0
    ? parseFloat((cashOnHand / monthlyBurn).toFixed(2))
    : 99;

  // ── Required ratio ─────────────────────────────────────────────
  const bizType =
    typeof settings.business_type === 'string'
      ? settings.business_type.replace(/"/g, '')
      : 'coaching';
  const requiredRatio = REQUIRED_RATIOS[bizType] ?? 3;

  // ── Status ──────────────────────────────────────────────────────
  const status = getStatus({
    gp30,
    cac,
    ltgp,
    requiredRatio,
    capacityPct,
    runwayMonths,
  });

  const ratio = cac > 0 ? parseFloat((ltgp / cac).toFixed(2)) : 0;
  const payback30 = gp30 - cac;

  // ── Safe budget & headroom ──────────────────────────────────────
  const targetNewClients = settings.targets?.new_clients_monthly ?? 10;
  const safeBudget = Math.round(targetNewClients * cac * 1.2);
  const headroom = safeBudget - totalAdSpend30;

  return {
    status,
    ratio,
    payback30,
    gp30,
    cac,
    ltgp,
    capacityPct,
    runwayMonths,
    requiredRatio,
    safeBudget,
    headroom,
    currentAdSpend: totalAdSpend30,
    cashOnHand,
    monthlyBurn,
  };
}
