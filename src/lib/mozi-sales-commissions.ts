// The sales tracker is the SOURCE OF TRUTH for new clients, AOV, and
// commission dollars. Stripe is used only for refunds + LTGP observation.
//
// User-confirmed 2026-04-22: "Use the sales tracker as a database instead of
// Stripe, or maybe use both." → sales tracker primary, Stripe supplementary.
//
// Each row in a month tab where cash_collected > 0 is ONE SALE = ONE NEW CLIENT.
// Per-row commission: (setter % + closer %) × cash_collected, where setter is
// 5% for Amara, 3% for Kelechi/Gideon/Debbie, and closer is always 10%.

import { fetchSheetData, type SheetRow } from "./google-sheets";
import { SETTER_COMMISSION_RULES, CLOSER_COMMISSION_PCT, type ClientKey } from "./mozi-costs-config";

function offerToClient(offer: string): ClientKey | null {
  const o = offer.toLowerCase();
  if (o.includes("keith")) return "keith";
  if (o.includes("tyson") || o.includes("sonnek")) return "tyson";
  return null;
}

function setterRateFor(setterName: string): number {
  const n = (setterName || "").toLowerCase();
  for (const rule of SETTER_COMMISSION_RULES) {
    if (n.includes(rule.match)) return rule.ratePct;
  }
  return 0;
}

export interface SalesCohortRow {
  date: string;                 // YYYY-MM-DD
  name: string;
  setter: string;
  closer: string;
  client: ClientKey;
  cashCollectedCents: number;
  setterCommissionCents: number;
  closerCommissionCents: number;
}

export interface SalesCohort {
  perClient: Record<ClientKey, {
    rows: SalesCohortRow[];
    count: number;
    cashCollectedCents: number;        // = AOV numerator
    setterCommissionsCents: number;
    closerCommissionsCents: number;
    totalCommissionsCents: number;
  }>;
  total: {
    count: number;
    cashCollectedCents: number;
    totalCommissionsCents: number;
  };
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function fetchSalesCohort(options?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<SalesCohort> {
  const to = options?.dateTo ?? ymd(new Date());
  const from = options?.dateFrom ?? ymd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const rows: SheetRow[] = await fetchSheetData(from, to);

  const empty = () => ({
    rows: [] as SalesCohortRow[],
    count: 0,
    cashCollectedCents: 0,
    setterCommissionsCents: 0,
    closerCommissionsCents: 0,
    totalCommissionsCents: 0,
  });
  const perClient: SalesCohort["perClient"] = { keith: empty(), tyson: empty() };

  for (const row of rows) {
    const cashCents = Math.round(row.cashCollected * 100);
    if (cashCents <= 0) continue;
    const client = offerToClient(row.offer);
    if (!client) continue;

    const setterPct = setterRateFor(row.setter);
    const setterCents = Math.round((cashCents * setterPct) / 100);
    const closerCents = row.closer ? Math.round((cashCents * CLOSER_COMMISSION_PCT) / 100) : 0;

    const entry: SalesCohortRow = {
      date: row.date,
      name: row.name,
      setter: row.setter,
      closer: row.closer,
      client,
      cashCollectedCents: cashCents,
      setterCommissionCents: setterCents,
      closerCommissionCents: closerCents,
    };

    const bucket = perClient[client];
    bucket.rows.push(entry);
    bucket.count += 1;
    bucket.cashCollectedCents += cashCents;
    bucket.setterCommissionsCents += setterCents;
    bucket.closerCommissionsCents += closerCents;
    bucket.totalCommissionsCents += setterCents + closerCents;
  }

  return {
    perClient,
    total: {
      count: perClient.keith.count + perClient.tyson.count,
      cashCollectedCents: perClient.keith.cashCollectedCents + perClient.tyson.cashCollectedCents,
      totalCommissionsCents: perClient.keith.totalCommissionsCents + perClient.tyson.totalCommissionsCents,
    },
  };
}

// Backwards-compat alias (home-business-metrics still imports the old name).
export async function fetchSalesCommissions(options?: {
  dateFrom?: string;
  dateTo?: string;
}) {
  const cohort = await fetchSalesCohort(options);
  return {
    perClient: {
      keith: {
        setterCents: cohort.perClient.keith.setterCommissionsCents,
        closerCents: cohort.perClient.keith.closerCommissionsCents,
        totalCents: cohort.perClient.keith.totalCommissionsCents,
        rowCount: cohort.perClient.keith.count,
      },
      tyson: {
        setterCents: cohort.perClient.tyson.setterCommissionsCents,
        closerCents: cohort.perClient.tyson.closerCommissionsCents,
        totalCents: cohort.perClient.tyson.totalCommissionsCents,
        rowCount: cohort.perClient.tyson.count,
      },
    },
    detail: [
      ...cohort.perClient.keith.rows.map((r) => ({
        date: r.date,
        client: r.client,
        setter: r.setter,
        closer: r.closer,
        cashCollectedCents: r.cashCollectedCents,
        setterCommissionCents: r.setterCommissionCents,
        closerCommissionCents: r.closerCommissionCents,
      })),
      ...cohort.perClient.tyson.rows.map((r) => ({
        date: r.date,
        client: r.client,
        setter: r.setter,
        closer: r.closer,
        cashCollectedCents: r.cashCollectedCents,
        setterCommissionCents: r.setterCommissionCents,
        closerCommissionCents: r.closerCommissionCents,
      })),
    ],
  };
}

// Re-export the CommissionBreakdown type for backwards compat.
export type CommissionBreakdown = Awaited<ReturnType<typeof fetchSalesCommissions>>;
