// CMO Pulse — a deterministic, date-stamped read of the LIVE marketing numbers for active creators.
// Reuses the canonical keyword ledger (ads_keyword_events) — does NOT reinvent attribution.
// Per ad (active creators, fresh trailing window): copy + spend + impressions + clicks + CTR
// + DM leads + cost/lead + booked calls + cost/call + tracked revenue + ROAS.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ACTIVE_CREATORS = ["tyson", "lucy"]; // Keith offboarded 2026-06-06

export async function GET(req: NextRequest) {
  const windowDays = Math.min(60, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 14));
  const now = new Date();
  const startDate = new Date(now.getTime() - windowDays * 86400000);
  const startISO = startDate.toISOString();
  const startDay = startISO.slice(0, 10);
  const sb = getServiceSupabase();

  const [insightsRes, eventsRes, copyRes] = await Promise.all([
    sb.from("ads_meta_insights_daily")
      .select("client_key,ad_id,ad_name,adset_name,campaign_name,keyword_normalized,spend_cents,impressions,link_clicks,ad_effective_status,date")
      .in("client_key", ACTIVE_CREATORS).gte("date", startDay),
    sb.from("ads_keyword_events")
      .select("client_key,keyword_normalized,subscriber_id,appointment_id,value_cents,event_at")
      .in("client_key", ACTIVE_CREATORS).gte("event_at", startISO),
    sb.from("ad_creative_copy").select("ad_id,on_image_text"),
  ]);
  if (insightsRes.error) return NextResponse.json({ error: insightsRes.error.message }, { status: 500 });

  const copyByAd = new Map<string, string>();
  for (const c of copyRes.data || []) if (c.ad_id && c.on_image_text) copyByAd.set(String(c.ad_id), c.on_image_text);

  // canonical funnel per keyword (keyword↔ad is 1:1 within a creator by the all-time-unique rule)
  type KW = { leads: Set<string>; appts: Set<string>; rev: number };
  const byKw = new Map<string, KW>();
  const kwKey = (ck: string, kw: string) => ck + "|" + (kw || "").toLowerCase();
  for (const e of eventsRes.data || []) {
    const k = kwKey(e.client_key, e.keyword_normalized);
    let v = byKw.get(k); if (!v) { v = { leads: new Set(), appts: new Set(), rev: 0 }; byKw.set(k, v); }
    if (e.subscriber_id) v.leads.add(String(e.subscriber_id));
    if (e.appointment_id) v.appts.add(String(e.appointment_id));
    if (e.value_cents && e.value_cents > 0) v.rev += e.value_cents;
  }

  // aggregate spend/impr/clicks per ad; keep latest status/names
  type Ad = { creator: string; adId: string; adName: string; adset: string; campaign: string; keyword: string; status: string; spend: number; impr: number; clicks: number; lastDate: string };
  const byAd = new Map<string, Ad>();
  for (const r of insightsRes.data || []) {
    const id = String(r.ad_id);
    let a = byAd.get(id);
    if (!a) { a = { creator: r.client_key, adId: id, adName: r.ad_name || "", adset: r.adset_name || "", campaign: r.campaign_name || "", keyword: (r.keyword_normalized || "").toLowerCase(), status: r.ad_effective_status || "", spend: 0, impr: 0, clicks: 0, lastDate: r.date }; byAd.set(id, a); }
    a.spend += r.spend_cents || 0; a.impr += r.impressions || 0; a.clicks += r.link_clicks || 0;
    if (r.date >= a.lastDate) { a.lastDate = r.date; a.status = r.ad_effective_status || a.status; a.adName = r.ad_name || a.adName; }
  }

  const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
  const ads = [...byAd.values()].map((a) => {
    const f = byKw.get(kwKey(a.creator, a.keyword)) || { leads: new Set(), appts: new Set(), rev: 0 };
    const spend = a.spend / 100, leads = f.leads.size, calls = f.appts.size;
    return {
      creator: a.creator, adId: a.adId, ad: a.adName, keyword: a.keyword, status: a.status,
      campaign: a.campaign, adset: a.adset, copy: copyByAd.get(a.adId) || null,
      spend: round(spend), impressions: a.impr, clicks: a.clicks,
      ctr: a.impr ? round((a.clicks / a.impr) * 100) : 0,
      leads, costPerLead: leads ? round(spend / leads) : null,
      bookedCalls: calls, costPerCall: calls ? round(spend / calls) : null,
    };
  }).filter((a) => a.spend > 0 || a.status === "ACTIVE")
    .sort((x, y) => y.spend - x.spend);

  return NextResponse.json({
    asOf: now.toISOString(), asOfDate: now.toISOString().slice(0, 10), windowDays,
    creators: ACTIVE_CREATORS, adCount: ads.length, ads,
    note: "Funnel metrics are live + exact (spend/clicks/CTR from Meta; leads/booked-calls from the canonical keyword ledger). Revenue/ROAS is the NEXT layer (join sales_tracker_rows by manychat_subscriber_id→keyword) — not shown here rather than show a wrong 0.",
  });
}
