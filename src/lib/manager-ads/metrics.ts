// Manager Ads View — the sales manager's per-influencer cut of the ads data.
//
// SINGLE SOURCE OF TRUTH: the Ads V2 tab. This reads the exact same precomputed
// snapshot the /ads-v2 tab reads (serveWindow), and derives every column with
// the exact same derive() the v2 tab uses. So a manager-view number and the
// corresponding Ads V2 number are the same value, never a parallel computation.
//
// Consequences of that single source, both inherited from v2 (not choices made
// here):
//   * Influencers are whoever v2 serves (Tyson, Jake) — Antwan is inactive and
//     not served by v2, so it does not appear.
//   * Revenue and ROI are KEYWORD-ATTRIBUTED (cash tied to a paid ad keyword).
//     Unattributed cash is not counted — this is "Collected revenue / Collected
//     ROI", not the old "all cash / potential ROAS".

import { serveWindow } from "@/lib/ads-v2/serve";
import { derive } from "@/lib/ads-v2/metrics";
import { addBase, EMPTY_BASE, type AdsV2Query, type BaseMetrics } from "@/lib/ads-v2/types";

export interface ManagerAdsRow {
  client: string; // creator key, or "total"
  label: string;
  spend: number | null;
  messages: number | null;
  costPerMessage: number | null;
  callsBooked: number | null;
  costPerBooked: number | null;
  callsTaken: number | null;
  costPerTaken: number | null;
  newClients: number | null;
  costPerClient: number | null;
  collectedRevenue: number | null;
  collectedRoi: number | null;
}

export interface ManagerAdsReport {
  from: string;
  to: string;
  generatedAt: string;
  rows: ManagerAdsRow[]; // one per influencer served by v2
  total: ManagerAdsRow;
  /** True while v2 is still building this window's snapshot; UI auto-refreshes. */
  preparing: boolean;
  notices: string[];
  warnings: string[];
}

export interface BuildResult {
  report: ManagerAdsReport;
  /** False when v2 had no snapshot yet — the caller should schedule prepareWindow. */
  prepared: boolean;
  query: AdsV2Query;
}

const centsToDollars = (c: number | null): number | null => (c == null ? null : c / 100);

/** Map one v2 base-metric bundle to a manager-view row, using v2's own derive(). */
function rowFromBase(client: string, label: string, base: BaseMetrics): ManagerAdsRow {
  const d = derive(base);
  return {
    client,
    label,
    spend: base.spendCents / 100,
    messages: base.messages,
    costPerMessage: centsToDollars(d.costPerMessageCents),
    callsBooked: base.booked,
    costPerBooked: centsToDollars(d.costPerBookedCents),
    callsTaken: base.taken,
    costPerTaken: centsToDollars(d.costPerTakenCents),
    newClients: base.newClients,
    costPerClient: centsToDollars(d.costPerClientCents),
    collectedRevenue: base.collectedCents / 100,
    collectedRoi: d.collectedRoi,
  };
}

/**
 * Build the report from the Ads V2 "all accounts, all statuses" window.
 * One snapshot read (the v2 read path). On a miss it returns a `preparing`
 * report with prepared=false, so the caller can schedule the background build
 * exactly the way the /ads-v2 route does.
 */
export async function buildManagerAdsReport(from: string, to: string): Promise<BuildResult> {
  // status:"all" = active + finished, so the window reflects every ad that had
  // activity in the range, not only currently-live ads. level is a view concern
  // for v2; the snapshot carries the whole tree regardless.
  const query: AdsV2Query = { account: "all", status: "all", level: "campaign", dateFrom: from, dateTo: to };

  const { payload, prepared } = await serveWindow(query);

  // Roll the campaign tree up per client (v2 stamps clientKey/clientName on
  // every node), so per-influencer rows are sums of the exact same nodes the
  // v2 tab shows, and the total is v2's own total over the union.
  const byClient = new Map<string, { label: string; base: BaseMetrics }>();
  for (const camp of payload.campaigns) {
    const entry = byClient.get(camp.clientKey) || { label: camp.clientName, base: { ...EMPTY_BASE } };
    entry.base = addBase(entry.base, camp);
    entry.label = camp.clientName;
    byClient.set(camp.clientKey, entry);
  }

  const rows: ManagerAdsRow[] = [...byClient.entries()]
    .sort((a, b) => b[1].base.spendCents - a[1].base.spendCents)
    .map(([key, { label, base }]) => rowFromBase(key, label, base));

  const total = rowFromBase("total", "All Influencers", payload.total);

  const report: ManagerAdsReport = {
    from,
    to,
    generatedAt: new Date().toISOString(),
    rows,
    total,
    preparing: !prepared || Boolean(payload.preparing),
    notices: payload.notices || [],
    warnings: [],
  };

  return { report, prepared, query };
}
