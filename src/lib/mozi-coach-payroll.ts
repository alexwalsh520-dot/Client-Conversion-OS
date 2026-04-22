// Pull last 30d of fulfillment payroll from Mercury (the expenses table is
// sparse). Matches counterparty against FULFILLMENT_PAYROLL_MATCHES.
// Output is ONE total figure — the caller divides by total active end-clients
// to get per-end-client coaching cost per month, which flows into GP30.

import { getMercuryAccounts, getMercuryTransactions, mercuryTokens } from "./mozi-mercury";
import { FULFILLMENT_PAYROLL_MATCHES } from "./mozi-costs-config";

interface DebitTx {
  amount: number;
  counterpartyName?: string;
  bankDescription?: string;
  postedAt?: string;
  createdAt?: string;
}

async function pullDebits(token: string, sinceYmd: string): Promise<DebitTx[]> {
  const { accounts } = await getMercuryAccounts(token);
  const out: DebitTx[] = [];
  for (const acc of accounts as Array<{ id: string; kind?: string }>) {
    if (acc.kind === "savings") continue;
    const { transactions } = await getMercuryTransactions(token, acc.id, {
      limit: 500,
      start: sinceYmd,
    });
    for (const t of transactions as unknown as DebitTx[]) {
      if (typeof t.amount === "number" && t.amount < 0) out.push(t);
    }
  }
  return out;
}

export interface FulfillmentPayrollBreakdown {
  totalCents: number;                       // last-30d sum
  byCounterparty: Array<{ counterparty: string; cents: number; chargeCount: number }>;
  sinceIso: string;
}

export async function fetchFulfillmentPayroll(): Promise<FulfillmentPayrollBreakdown> {
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sinceYmd = sinceIso.slice(0, 10);

  const txs: DebitTx[] = [];
  if (mercuryTokens.coreshift) txs.push(...(await pullDebits(mercuryTokens.coreshift, sinceYmd)));
  if (mercuryTokens.forge) txs.push(...(await pullDebits(mercuryTokens.forge, sinceYmd)));

  const byCp: Record<string, { cents: number; chargeCount: number }> = {};
  let total = 0;

  for (const tx of txs) {
    const hay = `${tx.counterpartyName ?? ""} ${tx.bankDescription ?? ""}`.toLowerCase();
    if (!FULFILLMENT_PAYROLL_MATCHES.some((n) => hay.includes(n.toLowerCase()))) continue;
    const cents = Math.round(Math.abs(tx.amount) * 100);
    total += cents;
    const cp = tx.counterpartyName ?? "Unknown";
    const row = byCp[cp] ?? { cents: 0, chargeCount: 0 };
    row.cents += cents;
    row.chargeCount += 1;
    byCp[cp] = row;
  }

  return {
    totalCents: total,
    byCounterparty: Object.entries(byCp)
      .map(([counterparty, v]) => ({ counterparty, ...v }))
      .sort((a, b) => b.cents - a.cents),
    sinceIso,
  };
}
