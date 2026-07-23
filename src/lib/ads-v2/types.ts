// ─────────────────────────────────────────────────────────────────────────
// TYPES — the shapes the serving layer returns and the UI reads.
//
// Rows carry only BASE metrics (sums of individual records). Every derived
// column (CPM, CTR, cost per thing, show rate, ROI) is computed from those
// bases at render time and in the TOTAL row, so a total is always a formula
// over the union, never a sum of per-row ratios.
// ─────────────────────────────────────────────────────────────────────────

export type AdsV2Account = "all" | "tyson" | "jake";
export type AdsV2Status = "active" | "finished" | "all";
export type AdsV2Level = "campaign" | "adset" | "ad";

export interface AdsV2Query {
  account: AdsV2Account;
  status: AdsV2Status;
  level: AdsV2Level;
  dateFrom: string; // inclusive ET day
  dateTo: string; // inclusive ET day
}

/** One named person behind a booked / taken / show-rate number, for the hover. */
export interface CallDetail {
  name: string;
  dmEtDay: string | null;
  bookedEtDay: string | null;
  callEtDay: string | null;
  status: "showed" | "noshow" | "upcoming";
  /** How many appointment records this one person had (reschedules). */
  records: number;
}

/** The base metrics summed over the individual facts for a node. */
export interface BaseMetrics {
  spendCents: number;
  impressions: number;
  clicks: number;
  messages: number; // distinct DM people (per keyword)
  booked: number; // distinct booked people (per keyword)
  taken: number; // sales-tracker calls taken (rows) -> the "Calls taken" column
  takenPeople: number; // distinct people taken -> the show-rate numerator
  upcoming: number; // distinct upcoming people (subset of booked)
  newClients: number;
  collectedCents: number;
  contractedCents: number;
}

export interface BudgetInfo {
  level: "campaign" | "adset" | null;
  dailyUsdCents: number | null;
  lifetimeUsdCents: number | null;
  holds: boolean;
  currency: string;
}

export interface AdsV2Node extends BaseMetrics {
  id: string;
  level: AdsV2Level;
  name: string;
  shortName: string;
  keyword: string | null;
  clientKey: string;
  clientName: string;
  status: "active" | "finished" | "empty";
  hasSpend: boolean;
  budget: BudgetInfo | null;
  previewImageUrl: string | null;
  /** Named records behind the call metrics, for hovers. */
  callDetails: { booked: CallDetail[]; taken: CallDetail[] } | null;
  children: AdsV2Node[];
}

export interface FreshnessSource {
  lastEtDay: string | null;
  lastSyncedAt: string | null;
  ageHours: number | null;
  stale: boolean;
}

export interface AdsV2Payload {
  account: AdsV2Account;
  status: AdsV2Status;
  level: AdsV2Level;
  dateFrom: string;
  dateTo: string;
  dataVersion: number;
  /** Campaign tree (campaign -> ad set -> ad), base metrics at every node. */
  campaigns: AdsV2Node[];
  /** Base-metric totals over the union of all displayed ads. */
  total: BaseMetrics;
  freshness: Record<string, FreshnessSource>;
  /** Per-client empty-state notes (e.g. Jake has spend but no funnel yet). */
  notices: string[];
  generatedAt: string;
  computeMs: number;
  /**
   * True when this window has no snapshot yet: the request path returns this
   * instantly (never computing) and a background job prepares the real numbers.
   * The client shows a one-line "preparing" state and auto-refreshes.
   */
  preparing?: boolean;
}

export const EMPTY_BASE: BaseMetrics = {
  spendCents: 0,
  impressions: 0,
  clicks: 0,
  messages: 0,
  booked: 0,
  taken: 0,
  takenPeople: 0,
  upcoming: 0,
  newClients: 0,
  collectedCents: 0,
  contractedCents: 0,
};

export function addBase(a: BaseMetrics, b: BaseMetrics): BaseMetrics {
  return {
    spendCents: a.spendCents + b.spendCents,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    messages: a.messages + b.messages,
    booked: a.booked + b.booked,
    taken: a.taken + b.taken,
    takenPeople: a.takenPeople + b.takenPeople,
    upcoming: a.upcoming + b.upcoming,
    newClients: a.newClients + b.newClients,
    collectedCents: a.collectedCents + b.collectedCents,
    contractedCents: a.contractedCents + b.contractedCents,
  };
}
