// ─────────────────────────────────────────────────────────────────────────
// THE SAVED ANSWERS — reading warehouse.answers, and nothing but.
//
// LAW 4 OF THIS BUILD, in code: where a number already exists in the saved
// answers, the door returns THAT number. It never recounts a window, never
// touches the facts tables for a metric, and never builds a window that was
// not saved.
//
// One honest wrinkle, written down rather than hidden. The saved payload holds
// the BASE counts (spend, impressions, clicks, DMs, booked, taken, closes,
// cash, and the rest). The eleven calculated columns (CPM, CTR, CPC, cost per
// thing, show rate, close rate, DM to call, collected ROAS) are NOT saved: the
// tab computes them at render time from those same bases, through one shared
// function, so that a total is a formula over the union and never a sum of
// per-row ratios. This file therefore calls that SAME function, derive(), on
// the SAME saved bases. That is not a second opinion about the number; it is
// the tab's own single formula applied to the tab's own single stored input,
// which is exactly what makes the door's answer equal the screen's answer.
//
// A window that was never saved is refused, never computed. The tab itself
// behaves the same way: serve.ts returns a "preparing" payload rather than
// building a window on the request path.
// ─────────────────────────────────────────────────────────────────────────

import { derive } from "@/lib/ads-v2/metrics";
import { EMPTY_BASE, type AdsV2Node, type AdsV2Payload, type BaseMetrics } from "@/lib/ads-v2/types";
import { getDataVersion } from "@/lib/ads-v2/db";
import { BadParams, type Db } from "./types";

/** The level every snapshot is stored at. Level is a view concern, so the
 *  saved row is the whole campaign tree, once per account/window/status. */
const SNAPSHOT_LEVEL = "tree";

export interface StoredWindowRow {
  account: string;
  date_from: string;
  date_to: string;
  status: string;
  data_version: number;
  computed_at: string;
  payload: AdsV2Payload;
}

/** One saved window, identified exactly the way the tab identifies it. */
export interface WindowKey {
  account: string;
  from: string;
  to: string;
  status: string;
}

/**
 * Every window the tab could serve RIGHT NOW: the saved rows stamped with the
 * current data version. Older rows are left behind by design (a sync bumps the
 * version and the tab ignores anything stamped with an older one), so they are
 * not offered here either. This is the honest list of what "a stored window"
 * means at this moment.
 */
export async function listLiveWindows(db: Db): Promise<{ version: number; windows: WindowKey[] }> {
  const version = await getDataVersion(db);
  const { data, error } = await db
    .from("adsv2_window_snapshots")
    .select("account, date_from, date_to, status")
    .eq("level", SNAPSHOT_LEVEL)
    .eq("data_version", version)
    .order("date_from", { ascending: false });
  if (error) throw new Error(`could not list the saved windows: ${error.message}`);
  const windows = ((data || []) as Array<Record<string, string>>).map((r) => ({
    account: r.account,
    from: r.date_from,
    to: r.date_to,
    status: r.status,
  }));
  return { version, windows };
}

/**
 * Read ONE saved window. Returns null when that window is not saved at the
 * current version, so the caller can refuse honestly instead of computing.
 */
export async function readStoredWindow(db: Db, key: WindowKey): Promise<StoredWindowRow | null> {
  const version = await getDataVersion(db);
  const { data, error } = await db
    .from("adsv2_window_snapshots")
    .select("account, date_from, date_to, status, data_version, computed_at, payload")
    .eq("account", key.account)
    .eq("date_from", key.from)
    .eq("date_to", key.to)
    .eq("level", SNAPSHOT_LEVEL)
    .eq("status", key.status)
    .maybeSingle();
  if (error) throw new Error(`could not read the saved answer: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as StoredWindowRow;
  // The tab ignores a snapshot stamped with an older data version, so the door
  // must ignore it too. Serving a stale row would be the door and the screen
  // disagreeing, which is the exact thing this build exists to make impossible.
  if (Number(row.data_version) !== version) return null;
  return row;
}

/**
 * The refusal text for a window that is not saved, listing what IS saved for
 * that account and status. Plain language, one clear next step.
 */
export function describeMissingWindow(key: WindowKey, live: WindowKey[]): string {
  const forAccount = live
    .filter((w) => w.account === key.account && w.status === key.status)
    .map((w) => (w.from === w.to ? w.from : `${w.from} to ${w.to}`));
  const list = forAccount.length ? forAccount.join(", ") : "none right now";
  return (
    `No saved answer exists for ${key.account}, ${key.from} to ${key.to}, ads "${key.status}". ` +
    `This door only ever returns numbers that were computed and saved before it was asked, so it will not build this window. ` +
    `Saved windows for ${key.account} (${key.status}): ${list}.`
  );
}

/** Every ad leaf in a saved payload, with its campaign and ad set named. */
export interface AdLeaf {
  ad_id: string;
  ad_name: string;
  keyword: string | null;
  client_key: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  status: string;
  base: BaseMetrics;
}

export function adLeaves(payload: AdsV2Payload): AdLeaf[] {
  const out: AdLeaf[] = [];
  for (const camp of payload.campaigns || []) {
    for (const adset of camp.children || []) {
      for (const ad of adset.children || []) {
        out.push({
          ad_id: ad.id,
          ad_name: ad.name,
          keyword: ad.keyword,
          client_key: ad.clientKey,
          campaign_id: camp.id,
          campaign_name: camp.name,
          adset_id: adset.id,
          adset_name: adset.name,
          status: ad.status,
          base: baseOf(ad),
        });
      }
    }
  }
  return out;
}

function baseOf(n: AdsV2Node): BaseMetrics {
  return {
    spendCents: n.spendCents,
    impressions: n.impressions,
    clicks: n.clicks,
    messages: n.messages,
    booked: n.booked,
    taken: n.taken,
    takenPeople: n.takenPeople,
    showedPeople: n.showedPeople,
    upcoming: n.upcoming,
    newClients: n.newClients,
    collectedCents: n.collectedCents,
    contractedCents: n.contractedCents,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The metric map: definition key -> the value, taken from the saved bases or
// computed by the tab's own derive(). Every key here exists in
// warehouse.definitions, and the build-time test pins that both ways.
// ─────────────────────────────────────────────────────────────────────────

/** The nine saved base metrics, by their definition key. */
const BASE_BY_KEY: Record<string, (b: BaseMetrics) => number> = {
  spend: (b) => b.spendCents,
  impressions: (b) => b.impressions,
  clicks: (b) => b.clicks,
  messages: (b) => b.messages,
  booked: (b) => b.booked,
  taken: (b) => b.taken,
  newClients: (b) => b.newClients,
  collected: (b) => b.collectedCents,
};

/** The eleven calculated metrics, by their definition key, all from derive(). */
const CALC_BY_KEY: Record<string, (b: BaseMetrics) => number | null> = {
  cpm: (b) => derive(b).cpmCents,
  ctr: (b) => derive(b).ctr,
  cpc: (b) => derive(b).cpcCents,
  costPerMessage: (b) => derive(b).costPerMessageCents,
  costPerBooked: (b) => derive(b).costPerBookedCents,
  costPerTaken: (b) => derive(b).costPerTakenCents,
  showRate: (b) => derive(b).showRate,
  closeRate: (b) => derive(b).closeRate,
  msgToCall: (b) => derive(b).msgToCall,
  costPerClient: (b) => derive(b).costPerClientCents,
  collectedRoi: (b) => derive(b).collectedRoi,
};

/**
 * The metric keys this question can answer for a window or an ad.
 *
 * Two of the twenty-one definitions are deliberately NOT here, and the reason
 * is written on the refusal the caller gets:
 *   - "name" is the row's label, not a number.
 *   - "budget" is the daily dial, which lives on a campaign or an ad set and
 *     never on an ad or on a window total. It is answered by ad_setup and by
 *     change_history, where it belongs.
 */
export const ANSWERABLE_METRIC_KEYS: readonly string[] = [
  ...Object.keys(BASE_BY_KEY),
  ...Object.keys(CALC_BY_KEY),
];

/** Metric keys that exist in the definitions registry but are not a number a
 *  window or an ad carries. Refused by name, with the reason. */
export const NON_METRIC_KEYS: Record<string, string> = {
  name: 'is the row\'s label, not a number. Ask ad_setup for what an ad is called.',
  budget:
    "is the daily dial, which lives on a campaign or an ad set and never on an ad or on a whole window. Ask ad_setup for one ad's budget dial, or change_history for when a dial moved.",
};

/** Values are returned in the units the system stores: money in CENTS, rates
 *  as a share between 0 and 1, ROAS as a multiple. The quoted definition's
 *  format tells the caller how to show it. */
export function metricValue(key: string, base: BaseMetrics): number | null {
  const b = BASE_BY_KEY[key];
  if (b) return b(base);
  const c = CALC_BY_KEY[key];
  if (c) return c(base);
  throw new BadParams(`"${key}" is not a metric this door answers.`);
}

/** Check a requested metric list, refusing anything off the registry by name. */
export function checkMetricKeys(requested: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of requested) {
    const k = String(raw).trim();
    if (ANSWERABLE_METRIC_KEYS.includes(k)) {
      out.push(k);
      continue;
    }
    if (NON_METRIC_KEYS[k]) throw new BadParams(`"${k}" ${NON_METRIC_KEYS[k]}`);
    throw new BadParams(
      `"${k}" is not one of the defined metrics. The ones this door answers are: ${ANSWERABLE_METRIC_KEYS.join(", ")}.`,
    );
  }
  return out;
}

export { EMPTY_BASE };
