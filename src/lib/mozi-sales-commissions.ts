// Compute setter + closer commissions for Mozi CAC.
// One sales-tracker row = one sale. Per-row rules:
//   - Setter (col 13) earns their personal % of cashCollected (Amara 5%, others 3%)
//   - Closer (col 7) earns 10% of cashCollected, flat
// We bucket by offer → Keith / Tyson so the commission dollars flow into the
// right CAC denominator per client.

import { fetchSheetData, type SheetRow } from "./google-sheets";
import { SETTER_COMMISSION_RULES, CLOSER_COMMISSION_PCT, type ClientKey } from "./mozi-costs-config";

function offerToClient(offer: string): ClientKey | null {
  const o = offer.toLowerCase();
  if (o.includes("keith")) return "keith";
  if (o.includes("tyson") || o.includes("sonnek")) return "tyson";
  return null;
}

function setterRateFor(setterName: string): number {
  const n = setterName.toLowerCase();
  for (const rule of SETTER_COMMISSION_RULES) {
    if (n.includes(rule.match)) return rule.ratePct;
  }
  return 0;
}

export interface CommissionBreakdown {
  perClient: Record<ClientKey, {
    setterCents: number;
    closerCents: number;
    totalCents: number;
    rowCount: number;
  }>;
  detail: Array<{
    date: string;
    client: ClientKey;
    setter: string;
    closer: string;
    cashCollectedCents: number;
    setterCommissionCents: number;
    closerCommissionCents: number;
  }>;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export async function fetchSalesCommissions(options?: {
  dateFrom?: string;
  dateTo?: string;
}): Promise<CommissionBreakdown> {
  const to = options?.dateTo ?? ymd(new Date());
  const from =
    options?.dateFrom ?? ymd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));

  const rows: SheetRow[] = await fetchSheetData(from, to);

  const perClient: CommissionBreakdown["perClient"] = {
    keith: { setterCents: 0, closerCents: 0, totalCents: 0, rowCount: 0 },
    tyson: { setterCents: 0, closerCents: 0, totalCents: 0, rowCount: 0 },
  };
  const detail: CommissionBreakdown["detail"] = [];

  for (const row of rows) {
    const client = offerToClient(row.offer);
    if (!client) continue;                              // skips Zoe & anything unattributed
    const cashCents = Math.round(row.cashCollected * 100);
    if (cashCents <= 0) continue;

    const setterPct = setterRateFor(row.setter);
    const setterComm = Math.round((cashCents * setterPct) / 100);
    const closerComm = row.closer ? Math.round((cashCents * CLOSER_COMMISSION_PCT) / 100) : 0;

    perClient[client].setterCents += setterComm;
    perClient[client].closerCents += closerComm;
    perClient[client].totalCents += setterComm + closerComm;
    perClient[client].rowCount += 1;

    detail.push({
      date: row.date,
      client,
      setter: row.setter,
      closer: row.closer,
      cashCollectedCents: cashCents,
      setterCommissionCents: setterComm,
      closerCommissionCents: closerComm,
    });
  }

  return { perClient, detail };
}
