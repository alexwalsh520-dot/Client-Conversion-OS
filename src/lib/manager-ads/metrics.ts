// Manager Ads View — the sales manager's per-influencer cut of the ads data.
//
// Two return metrics, by explicit request:
//   • ROAS = whatever the Ads V2 tab says. This is v2's keyword-ATTRIBUTED
//     collected revenue ÷ ad spend (only cash tied to a paid ad keyword).
//   • ROI  = ALL cash collected from the sales tracker ÷ ad spend. This counts
//     every sales-tracker row for the creator (via the `offer` column), not
//     just ad-attributed cash.
//
// SOURCES:
//   • Spend / messages / calls / clients / attributed-collected (→ ROAS) come
//     from the exact v2 window snapshot the /ads-v2 tab reads (serveWindow +
//     derive), so those numbers equal the Ads V2 tab by construction.
//   • All-cash (→ ROI) comes from the SYNCED sales_tracker_rows table, summed
//     per creator by the `offer` column and converted to USD per sale day with
//     the same FX helper v2 uses for its collected figure.
//
// Influencers are whoever v2 serves (Tyson, Jake); the total is scoped to those
// same influencers so the total row is the sum of its parts.

import { serveWindow } from "@/lib/ads-v2/serve";
import { derive } from "@/lib/ads-v2/metrics";
import { addBase, EMPTY_BASE, type AdsV2Query, type BaseMetrics } from "@/lib/ads-v2/types";
import { getServiceSupabase } from "@/lib/supabase";
import { creatorKeyFromText } from "@/lib/creators";
import { creatorCurrency, loadUsdRateMap, convertCentsToUsd } from "@/lib/fx/rates";

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
  /** ALL cash collected from the sales tracker for this creator (USD). */
  cashCollected: number | null;
  /** Ads V2's ad-attributed collected ÷ spend. */
  roas: number | null;
  /** All sales-tracker cash ÷ spend. */
  roi: number | null;
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
const ratio = (numer: number, denom: number): number | null => (denom ? numer / denom : null);

/**
 * ALL cash collected per creator, from the SYNCED sales_tracker_rows table.
 * Every row is assigned to a creator by its `offer` text (independent of ad
 * attribution), bucketed by the sales-tracker date, and converted to USD per
 * day — the same currency handling v2 uses for its collected figure.
 * Returns USD cents keyed by creator key. Paged past PostgREST's 1000-row cap.
 */
async function allCashByCreator(from: string, to: string): Promise<Map<string, number>> {
  const db = getServiceSupabase();

  type Row = { date: string; offer: string | null; collected_revenue_cents: number | null };
  const rows: Row[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await db
      .from("sales_tracker_rows")
      .select("date, offer, collected_revenue_cents")
      .gte("date", from)
      .lte("date", to)
      .order("date", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`sales_tracker_rows read failed: ${error.message}`);
    const batch = (data || []) as Row[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  // Tracker cash is USD for every creator (one team-wide USD sheet). A
  // creator's `currency` is what Meta bills their AD ACCOUNT: spend only,
  // never sales. No conversion here.
  const byCreator = new Map<string, number>();
  for (const r of rows) {
    const key = creatorKeyFromText(r.offer || "");
    if (!key) continue; // unassignable rows (blank/foreign offer) belong to no creator
    byCreator.set(key, (byCreator.get(key) || 0) + Number(r.collected_revenue_cents || 0));
  }
  return byCreator;
}

/** Map v2 base metrics + this creator's all-cash into a manager-view row. */
function buildRow(client: string, label: string, base: BaseMetrics, allCashCents: number): ManagerAdsRow {
  const d = derive(base);
  const spendCents = base.spendCents;
  return {
    client,
    label,
    spend: spendCents / 100,
    messages: base.messages,
    costPerMessage: centsToDollars(d.costPerMessageCents),
    callsBooked: base.booked,
    costPerBooked: centsToDollars(d.costPerBookedCents),
    callsTaken: base.taken,
    costPerTaken: centsToDollars(d.costPerTakenCents),
    newClients: base.newClients,
    costPerClient: centsToDollars(d.costPerClientCents),
    cashCollected: allCashCents / 100,
    roas: d.collectedRoi, // v2 attributed collected ÷ spend (the Ads V2 number)
    roi: ratio(allCashCents, spendCents), // all sales-tracker cash ÷ spend
  };
}

/**
 * Build the report. Spend/funnel/ROAS from the Ads V2 window snapshot (one read,
 * same read path the /ads-v2 tab uses); all-cash/ROI from the synced sales
 * tracker. On a v2 snapshot miss it returns a `preparing` report (prepared=false)
 * so the caller can schedule the background build like the /ads-v2 route does.
 */
export async function buildManagerAdsReport(from: string, to: string): Promise<BuildResult> {
  const query: AdsV2Query = { account: "all", status: "all", level: "campaign", dateFrom: from, dateTo: to };

  const [{ payload, prepared }, allCash] = await Promise.all([
    serveWindow(query),
    allCashByCreator(from, to),
  ]);

  // Roll the v2 campaign tree up per client (v2 stamps clientKey/clientName on
  // every node), so per-influencer rows are sums of the exact nodes the v2 tab
  // shows and the total is v2's own total over the union.
  const byClient = new Map<string, { label: string; base: BaseMetrics }>();
  for (const camp of payload.campaigns) {
    const entry = byClient.get(camp.clientKey) || { label: camp.clientName, base: { ...EMPTY_BASE } };
    entry.base = addBase(entry.base, camp);
    entry.label = camp.clientName;
    byClient.set(camp.clientKey, entry);
  }

  const rows: ManagerAdsRow[] = [...byClient.entries()]
    .sort((a, b) => b[1].base.spendCents - a[1].base.spendCents)
    .map(([key, { label, base }]) => buildRow(key, label, base, allCash.get(key) || 0));

  // Total is scoped to the influencers shown (so total = sum of rows). All-cash
  // total sums only those creators' cash for the same reason.
  const shownAllCash = [...byClient.keys()].reduce((s, k) => s + (allCash.get(k) || 0), 0);
  const total = buildRow("total", "All Influencers", payload.total, shownAllCash);

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
