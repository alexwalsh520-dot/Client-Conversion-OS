// ---- True gross-profit model (confirmed with Alex 2026-05-31) ------------
// Single source of truth for what the business actually keeps on a sale. The
// Deep Dive (ads server) and the home screen both compute profit from THIS file
// so the two screens can never quietly disagree on the math.
//
// Real money kept on a sale = collected cash minus the team's cut and the cost
// of delivering the coaching. Ad spend is subtracted at the aggregate (it's the
// CAC side), and the fixed $4k/mo manager base is overhead handled separately —
// this models only the per-sale variable cost.

export const CLOSER_COMMISSION_RATE = 0.1; // 10% to whoever closed, always.
export const MANAGER_NAME = "WILL"; // Sales manager; gets a 2.5% override on deals he didn't close.
export const MANAGER_OVERRIDE_RATE = 0.025;
export const DEFAULT_SETTER_RATE = 0.03; // Most setters are 3%; Amara is the exception.
export const SETTER_COMMISSION_RATES: Record<string, number> = {
  amara: 0.05,
  gideon: 0.03,
  debbie: 0.03,
  kelechi: 0.03,
  kelz: 0.03,
};
export const COACHING_COST_PER_MONTH = 30; // $30 per month of coaching sold.
export const MANAGER_MONTHLY_BASE = 4000; // Fixed overhead; surfaced in the monthly view, not per sale.

export function setterCommissionRate(setter: string | null | undefined): number {
  const key = (setter || "").trim().toLowerCase();
  if (!key) return DEFAULT_SETTER_RATE;
  return SETTER_COMMISSION_RATES[key] ?? DEFAULT_SETTER_RATE;
}

export function coachingMonthsFromProgramLength(programLength: string | null | undefined): number {
  // Stored as a whole number of months in text form ("1", "3", "6").
  const months = parseInt(String(programLength || "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(months) && months > 0 ? months : 0;
}

export interface SaleEconomicsInput {
  cashCollected: number;
  closer?: string | null;
  setter?: string | null;
  programLength?: string | null;
}

// Gross profit kept on a single sale, BEFORE ad spend. Only meaningful for an
// actual won sale with collected cash; returns 0 otherwise.
export function saleGrossProfit(row: SaleEconomicsInput): number {
  const collected = row.cashCollected || 0;
  if (collected <= 0) return 0;
  const closerName = (row.closer || "").trim().toUpperCase();
  const closerComm = collected * CLOSER_COMMISSION_RATE;
  const setterComm = collected * setterCommissionRate(row.setter);
  const managerOverride = closerName === MANAGER_NAME ? 0 : collected * MANAGER_OVERRIDE_RATE;
  const coachingCost = coachingMonthsFromProgramLength(row.programLength) * COACHING_COST_PER_MONTH;
  return collected - closerComm - setterComm - managerOverride - coachingCost;
}
