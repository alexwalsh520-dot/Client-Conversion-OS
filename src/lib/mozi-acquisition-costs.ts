// Fetch last 30d of Mercury debits across CoreShift + Forge, classify against
// the allowlist in mozi-costs-config, return per-client acquisition-software
// totals ready to feed into CAC math.
//
// Anything NOT matched to the allowlist is excluded from CAC by design — we
// only surface it in `excluded` so the user can spot new charges we missed.

import { getMercuryAccounts, getMercuryTransactions, mercuryTokens } from "./mozi-mercury";
import {
  ACQUISITION_SOFTWARE,
  MANYCHAT_PER_CLIENT,
  FULFILLMENT_SOFTWARE_MATCHES,
  type ClientKey,
} from "./mozi-costs-config";

interface DebitTx {
  amount: number;                     // USD (negative for debits in Mercury)
  counterpartyName?: string;
  bankDescription?: string;
  postedAt?: string;
  createdAt?: string;
}

async function fetchDebits(token: string, sinceYmd: string): Promise<DebitTx[]> {
  const { accounts } = await getMercuryAccounts(token);
  const out: DebitTx[] = [];
  for (const acc of accounts as Array<{ id: string; kind?: string }>) {
    if (acc.kind === "savings") continue;
    const { transactions } = await getMercuryTransactions(token, acc.id, {
      limit: 500,
      start: sinceYmd,
    });
    for (const raw of transactions as unknown as DebitTx[]) {
      if (typeof raw.amount === "number" && raw.amount < 0) out.push(raw);
    }
  }
  return out;
}

function textOf(tx: DebitTx): string {
  return `${tx.counterpartyName ?? ""} ${tx.bankDescription ?? ""}`.toLowerCase();
}

function matchesAny(tx: DebitTx, needles: string[]): boolean {
  const hay = textOf(tx);
  return needles.some((n) => hay.includes(n.toLowerCase()));
}

export interface AcquisitionSoftwareLine {
  label: string;
  totalCents: number;
  perClientCents: Record<ClientKey, number>;
  charges: Array<{ date: string; amountCents: number; description: string }>;
}

export interface AcquisitionCostsBreakdown {
  sinceIso: string;                                // window start
  acquisitionByLabel: AcquisitionSoftwareLine[];
  acquisitionTotalPerClient: Record<ClientKey, number>;
  manychatPerClient: Record<ClientKey, number>;    // Keith + Tyson (Zoe excluded)
  fulfillmentSoftwareCents: number;                // Everfit etc. — for GP30
  excludedBigDebits: Array<{ counterparty: string; totalCents: number }>;
}

export async function fetchAcquisitionCostsBreakdown(): Promise<AcquisitionCostsBreakdown> {
  const sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sinceYmd = sinceIso.slice(0, 10);

  const txs: DebitTx[] = [];
  if (mercuryTokens.coreshift) txs.push(...(await fetchDebits(mercuryTokens.coreshift, sinceYmd)));
  if (mercuryTokens.forge) txs.push(...(await fetchDebits(mercuryTokens.forge, sinceYmd)));

  const acquisitionByLabel: AcquisitionSoftwareLine[] = [];
  const totalPerClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  const manychatPerClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
  let fulfillmentCents = 0;
  const consumed = new WeakSet<DebitTx>();

  // Allowlisted acquisition SaaS (substring match)
  for (const spec of ACQUISITION_SOFTWARE) {
    const charges: AcquisitionSoftwareLine["charges"] = [];
    let total = 0;
    for (const tx of txs) {
      if (consumed.has(tx)) continue;
      if (!matchesAny(tx, spec.match)) continue;
      const cents = Math.round(Math.abs(tx.amount) * 100);
      total += cents;
      charges.push({
        date: (tx.postedAt ?? tx.createdAt ?? "").slice(0, 10),
        amountCents: cents,
        description: tx.counterpartyName ?? tx.bankDescription ?? "",
      });
      consumed.add(tx);
    }
    if (total === 0) continue;

    const perClient: Record<ClientKey, number> = { keith: 0, tyson: 0 };
    if (spec.split.kind === "equal") {
      const half = Math.round(total / 2);
      perClient.keith = half;
      perClient.tyson = total - half;
    } else {
      perClient[spec.split.client] = total;
    }
    totalPerClient.keith += perClient.keith;
    totalPerClient.tyson += perClient.tyson;
    acquisitionByLabel.push({ label: spec.label, totalCents: total, perClientCents: perClient, charges });
  }

  // ManyChat: same counterparty → disambiguate by dollar band.
  for (const tx of txs) {
    if (consumed.has(tx)) continue;
    if (!textOf(tx).includes("manychat")) continue;
    const cents = Math.round(Math.abs(tx.amount) * 100);
    const rule = MANYCHAT_PER_CLIENT.find(
      (r) => cents >= r.amountBandCents[0] && cents <= r.amountBandCents[1],
    );
    consumed.add(tx);
    if (!rule || rule.client === "exclude") continue;
    manychatPerClient[rule.client] += cents;
    totalPerClient[rule.client] += cents;
  }

  // Fulfillment SaaS (Everfit) — billed once for ops, divided over end-clients later.
  for (const tx of txs) {
    if (consumed.has(tx)) continue;
    if (!matchesAny(tx, FULFILLMENT_SOFTWARE_MATCHES)) continue;
    fulfillmentCents += Math.round(Math.abs(tx.amount) * 100);
    consumed.add(tx);
  }

  // Flag any uncategorized debit ≥ $500 so we notice new vendors we missed.
  const excludedMap: Record<string, number> = {};
  for (const tx of txs) {
    if (consumed.has(tx)) continue;
    const cents = Math.round(Math.abs(tx.amount) * 100);
    if (cents < 50000) continue;
    const k = tx.counterpartyName ?? "Unknown";
    excludedMap[k] = (excludedMap[k] ?? 0) + cents;
  }
  const excludedBigDebits = Object.entries(excludedMap)
    .map(([counterparty, totalCents]) => ({ counterparty, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);

  return {
    sinceIso,
    acquisitionByLabel,
    acquisitionTotalPerClient: totalPerClient,
    manychatPerClient,
    fulfillmentSoftwareCents: fulfillmentCents,
    excludedBigDebits,
  };
}
