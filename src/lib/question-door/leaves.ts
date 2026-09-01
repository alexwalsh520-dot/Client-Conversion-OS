// ─────────────────────────────────────────────────────────────────────────
// THE CERTIFIED LEAF READ. One windowed aggregation, shared by every question
// that needs a funnel.
//
// THE LAW THIS FILE EXISTS TO KEEP (Brick 3, restated by Brick 6): every funnel
// and spend number comes through `adsv2_window_leaves`, which is the SAME
// pre-aggregation the Ads v2 tab paints from. Windowing it differently is
// allowed. Reimplementing it is not. A question that recomputed the funnel its
// own way would eventually disagree with the tab, and then the owner would have
// two numbers and no way to choose.
//
// This was private to kill-scale.ts until Brick 6 gave three more questions
// (creator_funnel, portfolio_pace, scale_headroom) the same need. It was lifted
// here rather than copied, because two copies of "how we read a window" is two
// chances to drift, and the drift would be silent.
// ─────────────────────────────────────────────────────────────────────────

import { creatorCurrency } from "@/lib/fx/rates";
import type { Db } from "./types";

/**
 * One pre-aggregated leaf, exactly as adsv2_window_leaves returns it. The grain
 * is (client, keyword): a keyword IS an ad here, and `ad_id` is the most recent
 * ad that carried it.
 */
export interface Leaf {
  client_key: string;
  keyword: string;
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_status: string | null;
  campaign_status: string | null;
  spend_cents: number;
  impressions: number;
  clicks: number;
  messages: number;
  booked: number;
  upcoming: number;
  showed_people: number;
  taken_rows: number;
  taken_people: number;
  new_clients: number;
  collected_usd_cents: number;
  contracted_usd_cents: number;
}

const num = (v: unknown): number => Number(v) || 0;

/** Each creator's Meta billing currency, so the aggregation converts spend the
 *  one way the rest of the system converts it. Sale money is never converted:
 *  tracker sales are USD by law. */
export function currencyMap(clients: readonly string[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of clients) m[c] = creatorCurrency(c);
  return m;
}

/** One windowed read of the certified leaf aggregation. */
export async function leavesFor(
  db: Db,
  clients: readonly string[],
  from: string,
  to: string,
): Promise<Leaf[]> {
  const { data, error } = await db.rpc("adsv2_window_leaves", {
    p_clients: [...clients],
    p_from: from,
    p_to: to,
    p_currency: currencyMap(clients),
  });
  if (error) throw new Error(`adsv2_window_leaves failed for ${from}..${to}: ${error.message}`);
  return ((data || []) as Array<Record<string, unknown>>).map((r) => ({
    client_key: String(r.client_key),
    keyword: String(r.keyword),
    ad_id: String(r.ad_id ?? ""),
    ad_name: (r.ad_name as string) ?? null,
    campaign_id: (r.campaign_id as string) ?? null,
    campaign_name: (r.campaign_name as string) ?? null,
    adset_id: (r.adset_id as string) ?? null,
    adset_name: (r.adset_name as string) ?? null,
    ad_status: (r.ad_status as string) ?? null,
    campaign_status: (r.campaign_status as string) ?? null,
    spend_cents: num(r.spend_cents),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    messages: num(r.messages),
    booked: num(r.booked),
    upcoming: num(r.upcoming),
    showed_people: num(r.showed_people),
    taken_rows: num(r.taken_rows),
    taken_people: num(r.taken_people),
    new_clients: num(r.new_clients),
    collected_usd_cents: num(r.collected_usd_cents),
    contracted_usd_cents: num(r.contracted_usd_cents),
  }));
}

// ─────────────────────────────────────────────────────────────────────────
// THE FUNNEL ROLLUP. Base counts only; every RATE is derived from these sums
// by the tab's own derive(), never averaged from per-row ratios.
// ─────────────────────────────────────────────────────────────────────────

/** The base counts a funnel is built from, summed over a set of leaves. */
export interface FunnelBase {
  spend_usd_cents: number;
  impressions: number;
  clicks: number;
  dms: number;
  booked: number;
  upcoming: number;
  taken: number;
  shown: number;
  closes: number;
  collected_usd_cents: number;
  contracted_usd_cents: number;
}

export const EMPTY_FUNNEL_BASE: FunnelBase = {
  spend_usd_cents: 0,
  impressions: 0,
  clicks: 0,
  dms: 0,
  booked: 0,
  upcoming: 0,
  taken: 0,
  shown: 0,
  closes: 0,
  collected_usd_cents: 0,
  contracted_usd_cents: 0,
};

/**
 * Sum a set of leaves into one funnel base.
 *
 * `taken` counts DISTINCT PEOPLE (taken_people), not tracker rows, because a
 * person who took two calls is one person who showed up. `shown` is
 * showed_people for the same reason.
 */
export function sumLeaves(leaves: readonly Leaf[]): FunnelBase {
  const b: FunnelBase = { ...EMPTY_FUNNEL_BASE };
  for (const l of leaves) {
    b.spend_usd_cents += l.spend_cents;
    b.impressions += l.impressions;
    b.clicks += l.clicks;
    b.dms += l.messages;
    b.booked += l.booked;
    b.upcoming += l.upcoming;
    b.taken += l.taken_people;
    b.shown += l.showed_people;
    b.closes += l.new_clients;
    b.collected_usd_cents += l.collected_usd_cents;
    b.contracted_usd_cents += l.contracted_usd_cents;
  }
  return b;
}

/** The shape the tab's derive() expects, from a funnel base. Keeping the
 *  translation here means the questions never hand-build a BaseMetrics and
 *  never get a field order wrong. */
export function toBaseMetrics(b: FunnelBase) {
  return {
    spendCents: b.spend_usd_cents,
    impressions: b.impressions,
    clicks: b.clicks,
    messages: b.dms,
    booked: b.booked,
    taken: b.taken,
    takenPeople: b.taken,
    showedPeople: b.shown,
    upcoming: b.upcoming,
    newClients: b.closes,
    collectedCents: b.collected_usd_cents,
    contractedCents: b.contracted_usd_cents,
    leadScoreSum: 0,
    leadScoreN: 0,
  };
}
