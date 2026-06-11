// Leaderboard metrics for launched contest ads.
//
// Given the Meta ad_ids that admins have linked to contest entries, this pulls
// REAL spend / impressions per ad from ads_meta_insights_daily and computes a
// best-effort ROAS by attributing sales (sales_tracker_rows) to each ad's
// keyword via ads_keyword_events — the same two-step (subscriber_id, then
// normalized name) attribution used by /api/ads/attribution-coverage.
//
// Everything degrades gracefully: an ad with no insight rows returns zeros; an
// ad whose revenue can't be attributed returns roas = null (shown as "—").

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdMetrics {
  adId: string;
  spend: number; // dollars, total
  spendToday: number; // dollars, most recent day on record
  impressions: number;
  linkClicks: number;
  revenue: number | null; // dollars attributed, null if not computable
  roas: number | null; // revenue / spend, null if not computable
  lastDate: string | null; // most recent insight date
  keyword: string | null;
  clientKey: string | null;
}

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export async function getAdMetrics(
  db: SupabaseClient,
  adIds: string[],
): Promise<Record<string, AdMetrics>> {
  const out: Record<string, AdMetrics> = {};
  const ids = Array.from(new Set(adIds.filter(Boolean)));
  if (ids.length === 0) return out;

  // 1) Aggregate spend / impressions per ad from the daily insights table.
  const { data: insights } = await db
    .from("ads_meta_insights_daily")
    .select("ad_id, client_key, keyword_normalized, date, spend_cents, impressions, link_clicks")
    .in("ad_id", ids);

  for (const id of ids) {
    out[id] = {
      adId: id,
      spend: 0,
      spendToday: 0,
      impressions: 0,
      linkClicks: 0,
      revenue: null,
      roas: null,
      lastDate: null,
      keyword: null,
      clientKey: null,
    };
  }

  for (const row of insights ?? []) {
    const m = out[row.ad_id as string];
    if (!m) continue;
    m.spend += (Number(row.spend_cents) || 0) / 100;
    m.impressions += Number(row.impressions) || 0;
    m.linkClicks += Number(row.link_clicks) || 0;
    if (!m.clientKey && row.client_key) m.clientKey = row.client_key as string;
    if (!m.keyword && row.keyword_normalized) m.keyword = row.keyword_normalized as string;
    const date = row.date as string;
    if (date && (!m.lastDate || date > m.lastDate)) {
      m.lastDate = date;
      m.spendToday = (Number(row.spend_cents) || 0) / 100;
    } else if (date && date === m.lastDate) {
      m.spendToday += (Number(row.spend_cents) || 0) / 100;
    }
  }

  // 2) Best-effort ROAS via keyword attribution. Only for ads that have a
  //    (clientKey, keyword) pair and some spend.
  const attributable = Object.values(out).filter((m) => m.clientKey && m.keyword && m.spend > 0);
  if (attributable.length === 0) return out;

  const clientKeys = Array.from(new Set(attributable.map((m) => m.clientKey!)));

  // Pull keyword events (which subscribers/contacts came in on which keyword)
  // and sales (collected revenue) for the involved creators. 180-day window
  // comfortably covers the sales cycle tail.
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const { data: events } = await db
    .from("ads_keyword_events")
    .select("client_key, keyword_normalized, subscriber_id, contact_name")
    .in("client_key", clientKeys)
    .gte("event_at", since)
    .not("keyword_normalized", "is", null);

  // Map: clientKey|keyword -> { subscriberIds:Set, names:Set }
  const kwIndex = new Map<string, { subs: Set<string>; names: Set<string> }>();
  for (const e of events ?? []) {
    const key = `${e.client_key}|${e.keyword_normalized}`;
    let bucket = kwIndex.get(key);
    if (!bucket) {
      bucket = { subs: new Set(), names: new Set() };
      kwIndex.set(key, bucket);
    }
    if (e.subscriber_id) bucket.subs.add(String(e.subscriber_id));
    if (e.contact_name) bucket.names.add(norm(e.contact_name as string));
  }

  // Pull sales once. We match each sale to a keyword bucket by subscriber_id
  // (preferred) or normalized prospect name.
  const { data: sales } = await db
    .from("sales_tracker_rows")
    .select("offer, prospect_name_normalized, collected_revenue_cents, manychat_subscriber_id")
    .gte("date", since.slice(0, 10))
    .gt("collected_revenue_cents", 0);

  // Revenue per clientKey|keyword.
  const revByKw = new Map<string, number>();
  for (const sale of sales ?? []) {
    const cents = Number(sale.collected_revenue_cents) || 0;
    if (cents <= 0) continue;
    const sub = sale.manychat_subscriber_id ? String(sale.manychat_subscriber_id) : null;
    const nameN = norm(sale.prospect_name_normalized as string);
    for (const [key, bucket] of kwIndex) {
      const tied =
        (sub && bucket.subs.has(sub)) || (nameN && bucket.names.has(nameN));
      if (tied) {
        revByKw.set(key, (revByKw.get(key) || 0) + cents / 100);
        break; // a sale belongs to at most one keyword bucket
      }
    }
  }

  for (const m of attributable) {
    const key = `${m.clientKey}|${m.keyword}`;
    if (revByKw.has(key)) {
      m.revenue = revByKw.get(key)!;
      m.roas = m.spend > 0 ? m.revenue / m.spend : null;
    }
  }

  return out;
}
