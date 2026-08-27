// UTARI MCP v2 foundation helpers. Read STORED layers only (ads_dashboard_snapshots,
// ad_state, ad_day, dm_ad_links, dm_conversation_messages, fathom_calls, creator_content,
// content_grades, ad_creative_copy, sale_attribution_facts, attribution_summary). Never
// live-recompute attribution and never run wide raw-table scans (Postgres statement timeout).
// Money comes only from the canonical snapshot payload / attribution_summary. DM counts are
// unique ManyChat subscribers (dm_ad_links), never Meta messaging metrics. No fuzzy identity
// matching: link on hard keys or emit linkage_status "unlinked". Read-only.
import { getServiceSupabase } from "@/lib/supabase";
import { readLatestAdSnapshot } from "@/lib/ads-tracker/snapshot";
import type { AdsTrackerAccount } from "@/lib/ads-tracker/server";

type Row = Record<string, unknown>;
type Sb = ReturnType<typeof getServiceSupabase>;

export const DM_CLIENT: Record<string, string> = { tyson: "tyson_sonnek", antwan: "antwan_rarcus", jake: "jake_divljak" };
const NOT_TRACKED = "not_tracked" as const;

function num(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}
function round(x: unknown): number {
  return Math.round(num(x));
}
function round2(x: unknown): number {
  return Math.round(num(x) * 100) / 100;
}
// Ratio over canonical totals (plain arithmetic, not an attribution recompute). Undefined when
// the denominator is zero, returned as null so it is never mistaken for a real zero.
function ratio(numer: unknown, denom: unknown): number | null {
  const d = num(denom);
  if (d <= 0) return null;
  return Math.round((num(numer) / d) * 1000) / 1000;
}
function excerpt(text: unknown, max = 160): string {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}
// LIVE DM-thread resolution for one ad keyword. The old dm_ad_links bridge is STATIC (built once,
// never refreshed) and its ig id is a different scoping than dm_conversation_messages, so it returned
// zero threads. We derive threads at query time on the live path:
//   ads_keyword_events (ManyChat subscriber, event_type dm_keyword)
//     -> instagram_lead_links (manychat_subscriber_id -> instagram_user_id, refreshed by the DM sync)
//     -> dm_conversation_messages (subscriber_id = instagram_user_id, client = the creator's DM handle)
// Returns resolved threads + coverage vs the keyword's unique DM subscribers (some subscribers have no
// linked Instagram thread yet, so threads_resolved <= keyword_subscribers - reported, never hidden).
export async function dmThreadsForKeyword(
  sb: Sb,
  client: string,
  keyword: string,
  opts: { limit?: number; since?: string; messagesPerThread?: number } = {},
) {
  const kw = keyword.toLowerCase();
  const dmClient = DM_CLIENT[client] || client;
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
  const msgCap = opts.messagesPerThread ?? 80;

  // 1. unique ManyChat subscribers for the keyword (newest DM first), windowed if since is given.
  let sq = sb.from("ads_keyword_events").select("subscriber_id,event_at").eq("client_key", client).eq("keyword_normalized", kw).eq("event_type", "dm_keyword");
  if (opts.since) sq = sq.gte("event_at", `${opts.since}T00:00:00Z`);
  const { data: subRows } = await sq.limit(6000);
  const seen = new Set<string>();
  const mcSubs: string[] = [];
  for (const r of ((subRows as Row[]) || []).sort((a, b) => String(b.event_at).localeCompare(String(a.event_at)))) {
    const s = String(r.subscriber_id ?? "");
    if (s && !seen.has(s)) { seen.add(s); mcSubs.push(s); }
  }
  const keyword_subscribers = mcSubs.length;
  if (!keyword_subscribers) return { threads: [] as Row[], coverage: { keyword_subscribers: 0, threads_resolved: 0 } };

  // 2. bridge ManyChat -> instagram_user_id (batched .in to bound query size).
  const igByMc: Record<string, string> = {};
  for (let i = 0; i < mcSubs.length; i += 500) {
    const chunk = mcSubs.slice(i, i + 500);
    const { data: links } = await sb.from("instagram_lead_links").select("manychat_subscriber_id,instagram_user_id").eq("client", dmClient).in("manychat_subscriber_id", chunk);
    for (const l of (links as Row[]) || []) if (l.instagram_user_id) igByMc[String(l.manychat_subscriber_id)] = String(l.instagram_user_id);
  }
  const resolvable = mcSubs.filter((s) => igByMc[s]).slice(0, limit);
  if (!resolvable.length) return { threads: [] as Row[], coverage: { keyword_subscribers, threads_resolved: 0 } };
  const igIds = resolvable.map((s) => igByMc[s]);

  // 3. verbatim messages for those Instagram ids, via the adsv2_dm_threads
  // RPC: a direct table read is silently capped at 1000 rows by PostgREST
  // (which under-filled threads on big keywords); the RPC aggregates
  // server-side into one jsonb value, so every thread arrives complete.
  const { data: thr } = await sb.rpc("adsv2_dm_threads", { p_client: dmClient, p_ig_ids: igIds, p_cap: msgCap });
  const byIg: Record<string, Array<{ who: string; text: unknown; at: unknown }>> = {};
  for (const [ig, t] of Object.entries((thr || {}) as Record<string, { total: number; msgs: Array<{ d: string; b: string; a: string }> | null }>)) {
    byIg[ig] = (t.msgs || []).map((m) => ({ who: String(m.d || "").toLowerCase().startsWith("in") ? "lead" : "creator", text: m.b, at: m.a }));
  }
  const threads = resolvable
    .map((mc) => {
      const ig = igByMc[mc];
      const messages = (byIg[ig] || []).slice(0, msgCap);
      return { subscriber_manychat: mc, ig_subscriber_id: ig, first_dm_at: messages[0]?.at ?? null, message_count: messages.length, first_message: messages[0]?.text ?? null, messages };
    })
    .filter((t) => t.message_count > 0);
  return {
    threads,
    coverage: {
      keyword_subscribers,
      subscribers_bridged_to_instagram: resolvable.length,
      threads_resolved: threads.length,
      note: "Threads resolve in two hops: (1) ManyChat subscriber -> Instagram id via instagram_lead_links (bridge), (2) stored verbatim messages in dm_conversation_messages. threads_resolved counts subscribers that clear BOTH. The bridge covers most subscribers; the binding ceiling is stored messages: the DM webhook captures recent threads, so older subscribers are bridged but have no stored thread. This is a real capture ceiling (tightens forward), never a silent drop. Pass a recent `since` for the highest coverage.",
    },
  };
}

// Fathom call duration in seconds. Prefer the structured column; when it was never populated fall
// back to the raw recording window (raw.recording_start_time / recording_end_time, selected via the
// json arrows below). Only not_tracked when neither exists.
function durationSec(durCol: unknown, recStart: unknown, recEnd: unknown): number | typeof NOT_TRACKED {
  const dc = Number(durCol);
  if (durCol != null && Number.isFinite(dc) && dc > 0) return Math.round(dc);
  if (recStart && recEnd) {
    const d = Math.round((new Date(String(recEnd)).getTime() - new Date(String(recStart)).getTime()) / 1000);
    if (Number.isFinite(d) && d > 0) return d;
  }
  return NOT_TRACKED;
}

// ---- Canonical funnel, one name per concept (schema contract) ----
// spend, dms, cost_per_dm, booked_calls, cost_per_booked_call, calls_taken, show_rate,
// closes, close_rate, cash_collected, roas. Spend uses the ad account's day (Pacific).
export function funnelFromSummary(s: Row | undefined | null) {
  s = s || {};
  const spend = round2(s.adSpend); // dollar-and-cents exact, to match the Ads tab
  const dms = round(s.messages);
  const booked = round(s.bookedCalls);
  const calls = round(s.callsTaken);
  const closes = round(s.newClients);
  return {
    spend,
    dms,
    cost_per_dm: ratio(spend, dms),
    booked_calls: booked,
    cost_per_booked_call: ratio(spend, booked),
    calls_taken: calls,
    show_rate: ratio(calls, booked),
    ...(calls > booked ? { show_rate_note: "calls taken in this window include calls booked in a prior window (period-counting carryover), so show_rate can exceed 1. Raw counts are shown, never clamped." } : {}),
    closes,
    close_rate: ratio(closes, calls),
    cash_collected: round(s.collectedRevenue), // paid ad-attributed collected in the window
    roas: round2(s.collectedRoi),
    // context beyond the ad-attributed funnel (reconciled buckets from the same snapshot)
    total_collected_all_sources: round(s.totalCollectedRevenue),
    organic_cash: round(s.organicRevenue),
    unattributed_cash: round(s.unattributedRevenue),
  };
}

export function funnelFromAdRoas(r: Row) {
  const spend = round2(r.adSpend);
  const dms = round(r.messages);
  const booked = round(r.bookedCalls);
  const calls = round(r.callsTaken);
  const closes = round(r.newClients);
  return {
    spend,
    dms,
    cost_per_dm: ratio(spend, dms),
    booked_calls: booked,
    cost_per_booked_call: ratio(spend, booked),
    calls_taken: calls,
    show_rate: ratio(calls, booked),
    ...(calls > booked ? { show_rate_note: "calls taken in this window include calls booked in a prior window (period-counting carryover), so show_rate can exceed 1. Raw counts are shown, never clamped." } : {}),
    closes,
    close_rate: ratio(closes, calls),
    cash_collected: round(r.collectedRevenue),
    roas: round2(r.collectedRoi),
    gross_profit: round(r.grossProfit),
    gross_profit_roas: round2(r.grossProfitRoi),
  };
}

// ---- Response envelope: data_freshness (LIVE max sync per source) + coverage (attribution_summary) ----
// Reads the real recency straight from each source table's max(synced_at / event_at / sent_at /
// recorded_at). It deliberately does NOT read feed_watermarks: that is a dead cursor table frozen at
// an old run, which made every source read ~9 days stale even though the data was current. Includes a
// self-test: on a healthy system sales + meta sync at least daily, so > 24h stale is flagged.
export async function dataFreshness(sb: Sb) {
  const now = Date.now();
  const top = (p: PromiseLike<{ data: Row[] | null }>) =>
    Promise.resolve(p).then((r) => (r.data && r.data[0] ? r.data[0] : null));
  const [sales, meta, kw, dm, fathom, fathomIngest, content] = await Promise.all([
    top(sb.from("sales_tracker_rows").select("synced_at").order("synced_at", { ascending: false }).limit(1)),
    top(sb.from("ads_meta_insights_daily").select("synced_at").order("synced_at", { ascending: false }).limit(1)),
    top(sb.from("ads_keyword_events").select("event_at").order("event_at", { ascending: false }).limit(1)),
    top(sb.from("dm_conversation_messages").select("sent_at").order("sent_at", { ascending: false }).limit(1)),
    top(sb.from("fathom_calls").select("recorded_at").order("recorded_at", { ascending: false }).limit(1)),
    top(sb.from("fathom_calls").select("created_at").order("created_at", { ascending: false }).limit(1)),
    top(sb.from("creator_content").select("created_at").order("created_at", { ascending: false }).limit(1)),
  ]);
  const mk = (source: string, ts: unknown, kind = "sync") => {
    const iso = ts ? String(ts) : null;
    const mins = iso ? Math.round((now - new Date(iso).getTime()) / 60000) : null;
    return { source, [`last_${kind}`]: iso, minutes_since_sync: mins, hours_since_sync: mins != null ? Math.round(mins / 6) / 10 : null };
  };
  const sources = [
    mk("sales_tracker_rows", sales?.synced_at),
    mk("ads_meta_insights_daily", meta?.synced_at),
    mk("ads_keyword_events", kw?.event_at, "event"),
    mk("dm_conversation_messages", dm?.sent_at, "message"),
    mk("fathom_calls_recorded", fathom?.recorded_at, "recorded"), // newest CALL date (real calls can lag)
    mk("fathom_calls_ingested", fathomIngest?.created_at, "ingest"), // newest INGEST write (poller health)
    mk("creator_content", content?.created_at, "ingest"), // reels/content ingest (poller health)
  ];
  const within24 = (s: { minutes_since_sync: number | null }) => s.minutes_since_sync != null && s.minutes_since_sync <= 24 * 60;
  const salesOk = within24(sources[0]);
  const metaOk = within24(sources[1]);
  const healthy = salesOk && metaOk;
  return {
    as_of: new Date(now).toISOString(),
    healthy,
    self_test: {
      sales_within_24h: salesOk,
      meta_within_24h: metaOk,
      note: healthy ? "sales + meta synced within 24h" : "sales or meta is more than 24h stale - investigate the sync",
    },
    sources,
  };
}

// coverage = % of window cash machine-attributed, from the Dashboard's own reconciled buckets.
// machine_attributed_cash = paid_attributed (deterministic sale->ad links). Echoes the window.
export async function coverageFor(sb: Sb, client: string) {
  const { data } = await sb.from("attribution_summary").select("*").eq("client_key", client).maybeSingle();
  const s = data as Row | null;
  if (!s) return NOT_TRACKED;
  const total = round(s.total_collected);
  const machine = round(s.paid_attributed);
  return {
    window: { from: s.window_from ?? null, to: s.window_to ?? null },
    total_collected: total,
    machine_attributed_cash: machine,
    organic_cash: round(s.organic),
    unattributed_cash: round(s.unattributed),
    pct_cash_machine_attributed: ratio(machine, total),
    computed_at: s.computed_at ?? null,
    note: "machine_attributed_cash = paid_attributed (deterministic sale->ad links). Reconciled buckets INCLUDE Attribution Workspace resolutions. Window is the reconciliation window, not necessarily the funnel window.",
  };
}

// ---- New tool: business_snapshot ----
async function priorSnapshotSummary(sb: Sb, account: string, currentFrom: string) {
  // The most recent stored ad-level snapshot whose window ends before the current window starts
  // (non-overlapping earlier period). Stored-only; no recompute. May be null.
  const { data } = await sb
    .from("ads_dashboard_snapshots")
    .select("payload,date_from,date_to,computed_at")
    .eq("account", account).eq("level", "ad").eq("status", "all")
    .lt("date_to", currentFrom)
    .order("date_to", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const d = data as Row;
  const payload = (d.payload as Row) || {};
  return { window: { from: d.date_from, to: d.date_to, computed_at: d.computed_at }, summary: (payload.summary as Row) || {} };
}

function adKeyword(r: Row): string {
  return String(r.label ?? r.adName ?? "");
}

async function creatorBlock(sb: Sb, account: string) {
  const snap = await readLatestAdSnapshot(account as AdsTrackerAccount);
  if (!snap) return { creator: account, status: NOT_TRACKED, note: "no stored ad-level snapshot" };
  const payload = snap.payload || {};
  const summary = (payload.summary as Row) || {};
  const adRoas = (payload.adRoas as Row[]) || [];
  const funded = adRoas.filter((r) => num(r.adSpend) > 0);
  const byCash = [...funded].sort((a, b) => num(b.collectedRevenue) - num(a.collectedRevenue));
  const byRoas = [...funded].sort((a, b) => num(a.collectedRoi) - num(b.collectedRoi));
  const slim = (r: Row) => ({ keyword: adKeyword(r), ...funnelFromAdRoas(r) });
  const zeroDm = funded.filter((r) => num(r.messages) === 0);
  const prior = await priorSnapshotSummary(sb, account, snap.dateFrom);
  return {
    creator: account,
    current_window: { from: snap.dateFrom, to: snap.dateTo, computed_at: snap.computedAt, spend_day_timezone: "America/Los_Angeles (ad account)" },
    current_funnel: funnelFromSummary(summary),
    prior_window: prior ? prior.window : NOT_TRACKED,
    prior_funnel: prior ? funnelFromSummary(prior.summary) : NOT_TRACKED,
    top_funded_ads: byCash.slice(0, 3).map(slim),
    bottom_funded_ads_by_roas: byRoas.slice(0, 3).map(slim),
    funded_zero_dm_ads: { count: zeroDm.length, keywords: zeroDm.map(adKeyword) },
    coverage: await coverageFor(sb, account),
  };
}

export async function businessSnapshot() {
  const sb = getServiceSupabase();
  const creators = ["tyson", "antwan"];
  const blocks = await Promise.all(creators.map((c) => creatorBlock(sb, c)));
  // Combined: sum canonical primitives across creators, re-derive ratios from the sums.
  const prim = { spend: 0, dms: 0, booked_calls: 0, calls_taken: 0, closes: 0, cash_collected: 0 };
  for (const b of blocks) {
    const f = (b as Row).current_funnel as Row | undefined;
    if (!f) continue;
    prim.spend += num(f.spend); prim.dms += num(f.dms); prim.booked_calls += num(f.booked_calls);
    prim.calls_taken += num(f.calls_taken); prim.closes += num(f.closes); prim.cash_collected += num(f.cash_collected);
  }
  const combined = {
    ...prim,
    cost_per_dm: ratio(prim.spend, prim.dms),
    cost_per_booked_call: ratio(prim.spend, prim.booked_calls),
    show_rate: ratio(prim.calls_taken, prim.booked_calls),
    close_rate: ratio(prim.closes, prim.calls_taken),
    roas: ratio(prim.cash_collected, prim.spend),
  };
  return {
    note: "Per-creator + combined current-week funnel from the canonical Ads Dashboard snapshot (ads_dashboard_snapshots). Matches the Ads tab to the dollar for the SAME stored window. Prior_window is the most recent non-overlapping earlier stored snapshot (windows are rolling ~7-day, not calendar weeks) - its dates are echoed. Spend uses the ad account's day (Pacific).",
    creators: blocks,
    combined_current_funnel: combined,
  };
}

// ---- New tool: get_ad_full ----
export async function getAdFull(client: string, keyword: string, since?: string) {
  const sb = getServiceSupabase();
  const kw = keyword.toLowerCase();
  const snap = await readLatestAdSnapshot(client as AdsTrackerAccount);
  if (!snap) return { found: false, note: "no stored ad-level snapshot for this creator" };
  const adRoas = (snap.payload.adRoas as Row[]) || [];
  const placements = adRoas.filter((r) => adKeyword(r).toLowerCase() === kw);
  if (placements.length === 0) return { found: false, keyword, window: { from: snap.dateFrom, to: snap.dateTo }, note: "keyword not present in the latest snapshot" };

  // Keyword-level funnel = sum of its placements (canonical numbers, plain summation).
  const agg = { adSpend: 0, messages: 0, bookedCalls: 0, callsTaken: 0, newClients: 0, collectedRevenue: 0, grossProfit: 0 };
  for (const p of placements) {
    agg.adSpend += num(p.adSpend); agg.messages += num(p.messages); agg.bookedCalls += num(p.bookedCalls);
    agg.callsTaken += num(p.callsTaken); agg.newClients += num(p.newClients);
    agg.collectedRevenue += num(p.collectedRevenue); agg.grossProfit += num(p.grossProfit);
  }
  const funnel = funnelFromAdRoas({ ...agg, collectedRoi: agg.adSpend > 0 ? agg.collectedRevenue / agg.adSpend : 0, grossProfitRoi: agg.adSpend > 0 ? agg.grossProfit / agg.adSpend : 0 });

  // Keyword-level state (status/active counts) from ad_state; per-ad Meta status is not stored.
  const { data: stateRows } = await sb.from("ad_state").select("status,active_ads,total_ads,last_status_day,audience_type,is_advantage,age_min,age_max,has_lookalike").eq("client_key", client).eq("keyword", kw);
  const st = (stateRows && stateRows[0]) as Row | undefined;
  const keyword_state = st
    ? { status: st.status ?? null, active_ads: st.active_ads ?? null, total_ads: st.total_ads ?? null, last_status_day: st.last_status_day ?? null, audience_type: st.audience_type ?? null, is_advantage: st.is_advantage ?? null, age: st.age_min ? `${st.age_min}-${st.age_max}` : null, has_lookalike: st.has_lookalike ?? null }
    : NOT_TRACKED;

  const adIds = placements.map((p) => String(p.adId)).filter(Boolean);
  // Per-ad Meta effective status DOES exist (ads_meta_insights_daily.ad_effective_status); take the
  // latest row per ad_id. Not in the snapshot payload, but it is a real column, so map it.
  const statusByAd: Record<string, string> = {};
  if (adIds.length) {
    const { data: statusRows } = await sb.from("ads_meta_insights_daily")
      .select("ad_id,ad_effective_status,date").eq("client_key", client).in("ad_id", adIds)
      .order("date", { ascending: false }).limit(3000);
    for (const s of (statusRows as Row[]) || []) {
      const id = String(s.ad_id);
      if (!statusByAd[id] && s.ad_effective_status) statusByAd[id] = String(s.ad_effective_status); // desc order → first seen is latest
    }
  }
  const lineage = placements.map((p) => ({
    ad_id: p.adId ?? null, ad_name: p.adName ?? null,
    campaign_id: p.campaignId ?? null, campaign_name: p.campaignName ?? null,
    adset_id: p.adsetId ?? null, adset_name: p.adsetName ?? null,
    spend: round(p.adSpend), impressions: round(p.impressions),
    is_advantage: p.isAdvantage ?? null, audience_type: p.audienceType ?? null,
    per_ad_status: statusByAd[String(p.adId)] ?? NOT_TRACKED, // Meta effective status from ads_meta_insights_daily
  }));

  // Copy from ad_creative_copy (on-image + primary), deduped.
  const copy: { on_image_text: string | null; primary_text: string | null; ad_id: string; image_url: string | null }[] = [];
  if (adIds.length) {
    const { data: copyRows } = await sb.from("ad_creative_copy").select("ad_id,on_image_text,primary_text,image_url").eq("client_key", client).in("ad_id", adIds);
    const seen = new Set<string>();
    for (const c of (copyRows as Row[]) || []) {
      const key = `${c.on_image_text}||${c.primary_text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      copy.push({ ad_id: String(c.ad_id), on_image_text: (c.on_image_text as string) ?? null, primary_text: (c.primary_text as string) ?? null, image_url: (c.image_url as string) ?? null });
    }
  }

  // Per-day spend (ad_day) + per-day DMs. DMs come from ads_keyword_events (the SAME source the
  // canonical funnel counts), NOT dm_ad_links.first_seen_at - that bridge is static/stale and was
  // reporting zero DMs on recent days even though the keyword events existed. One DM = one unique
  // ManyChat subscriber that day.
  const seriesFrom = since || snap.dateFrom;
  const eventsFrom = seriesFrom < snap.dateFrom ? seriesFrom : snap.dateFrom; // reach back far enough to reconcile the window
  let dq = sb.from("ad_day").select("date,spend,impressions,cpm,status").eq("client_key", client).eq("keyword", kw);
  if (seriesFrom) dq = dq.gte("date", seriesFrom);
  const { data: days } = await dq.order("date").limit(370);
  const byDate: Record<string, { date: string; spend: number; impressions: number; cpm: number | null; status: unknown; dms: number }> = {};
  for (const d of (days as Row[]) || []) {
    const date = String(d.date);
    byDate[date] = { date, spend: round2(d.spend), impressions: round(d.impressions), cpm: d.cpm != null ? round2(d.cpm) : null, status: d.status ?? null, dms: 0 };
  }
  const { data: kwEvents } = await sb.from("ads_keyword_events")
    .select("subscriber_id,event_at")
    .eq("client_key", client).eq("keyword_normalized", kw).eq("event_type", "dm_keyword")
    .gte("event_at", `${eventsFrom}T00:00:00Z`).limit(20000);
  const subsByDate: Record<string, Set<string>> = {};
  const windowSubs = new Set<string>();
  for (const e of (kwEvents as Row[]) || []) {
    const date = String(e.event_at).slice(0, 10);
    const sub = String(e.subscriber_id ?? "");
    if (!sub) continue;
    (subsByDate[date] = subsByDate[date] || new Set()).add(sub);
    if (date >= snap.dateFrom && date <= snap.dateTo) windowSubs.add(sub);
  }
  for (const [date, set] of Object.entries(subsByDate)) {
    if (date < seriesFrom) continue; // events before the requested series start are only used for reconciliation
    if (!byDate[date]) byDate[date] = { date, spend: 0, impressions: 0, cpm: null, status: null, dms: 0 };
    byDate[date].dms = set.size;
  }
  const per_day_series = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
  // Series reconciliation, covering BOTH DMs and spend against the keyword-level funnel over the same
  // window. window_unique_dms = distinct ManyChat subscribers who hit the keyword in-window (raw
  // ads_keyword_events); funnel.dms = DMs the canonical engine ATTRIBUTES to this ad in-window. These
  // match for active ads. When window_unique_dms > funnel.dms it is a documented definition gap (raw
  // keyword events include DMs the engine did not attribute to this ad - common for a keyword whose ad
  // was paused, or whose keyword mapping moved). funnel.dms > window_unique_dms would be impossible
  // (canonical cannot exceed raw), so THAT is flagged as a real error.
  const window_unique_dms = windowSubs.size;
  const window_series_spend = Math.round(per_day_series.filter((d) => d.date >= snap.dateFrom && d.date <= snap.dateTo).reduce((s, d) => s + d.spend, 0) * 100) / 100;
  const dmGap = window_unique_dms - funnel.dms;
  const spendGap = Math.round((window_series_spend - funnel.spend) * 100) / 100;
  const dm_reconciliation: Record<string, unknown> = {
    funnel_dms: funnel.dms,
    window_unique_dms,
    per_day_dm_sum: per_day_series.reduce((s, d) => s + d.dms, 0),
    dm_status: Math.abs(dmGap) <= 1 ? "match" : dmGap > 0 ? "definition_gap_raw_exceeds_attributed" : "ERROR_attributed_exceeds_raw",
    funnel_spend: funnel.spend,
    window_series_spend,
    spend_status: Math.abs(spendGap) <= 1 ? "match" : "mismatch",
    note: "dm_status match = daily DMs reconcile to the funnel; definition_gap = raw keyword events exceed canonically-attributed DMs (paused ad / moved keyword mapping), expected; ERROR = attributed exceeds raw (impossible, investigate). spend_status compares the in-window daily spend (ad_day) to the funnel spend.",
  };
  if (dm_reconciliation.dm_status === "ERROR_attributed_exceeds_raw" || dm_reconciliation.spend_status === "mismatch") {
    dm_reconciliation.error = "series does not reconcile to the funnel (see dm_status / spend_status); treat the daily numbers as suspect until fixed";
  }

  // Thread digests via the LIVE ManyChat->Instagram bridge (dmThreadsForKeyword). The old dm_ad_links
  // path used a stale, wrong-scoped id and returned zero; its subscriber id also broke the became_sale /
  // booked hard keys (those are ManyChat-keyed). subscriber = ManyChat id now, so the hard keys work.
  const DIGEST_CAP = 40;
  const { threads: digestThreads, coverage: dm_coverage } = await dmThreadsForKeyword(sb, client, kw, { limit: DIGEST_CAP, since: seriesFrom, messagesPerThread: 4 });
  const digestManychat = digestThreads.map((t) => String(t.subscriber_manychat));
  const truncated_threads = dm_coverage.threads_resolved >= DIGEST_CAP;
  const saleSubs = new Set<string>();
  if (digestManychat.length) {
    const { data: facts } = await sb.from("sale_attribution_facts").select("subscriber_id").eq("client_key", client).in("subscriber_id", digestManychat);
    for (const f of (facts as Row[]) || []) if (f.subscriber_id) saleSubs.add(String(f.subscriber_id));
  }
  const bookedSubs = new Set<string>();
  if (digestManychat.length) {
    const { data: bk } = await sb.from("ads_keyword_events").select("subscriber_id")
      .eq("client_key", client).in("event_type", ["booked_call", "manual_booked_calls"]).in("subscriber_id", digestManychat);
    for (const b of (bk as Row[]) || []) if (b.subscriber_id) bookedSubs.add(String(b.subscriber_id));
  }
  const thread_digests = digestThreads.map((t) => {
    const sub = String(t.subscriber_manychat);
    return {
      subscriber: sub,
      ig_subscriber_id: t.ig_subscriber_id,
      first_dm_at: t.first_dm_at ?? null,
      first_message_excerpt: excerpt(t.first_message, 160),
      message_count: t.message_count,
      became_sale: saleSubs.has(sub),
      booked: bookedSubs.has(sub), // hard-keyed booked_call event for this subscriber
    };
  });

  return {
    found: true,
    keyword,
    window: { from: snap.dateFrom, to: snap.dateTo, computed_at: snap.computedAt, spend_day_timezone: "America/Los_Angeles (ad account)" },
    series_since: seriesFrom,
    funnel,
    keyword_state,
    placements: lineage,
    copy,
    per_day_series,
    dm_reconciliation,
    thread_digests,
    dm_coverage,
    truncated_threads,
    note: "One-call ad view: canonical funnel + placement lineage (with per_ad_status from ads_meta_insights_daily) + copy + per-day spend/DM series (DMs from ads_keyword_events, same source as the funnel) + thread digests (live ManyChat->Instagram bridge; booked/became_sale hard-keyed). dm_coverage shows resolved threads vs keyword subscribers. Full verbatim threads: call get_dms_for_ad.",
  };
}

// ---- New tool: get_call_transcripts ----
export async function getCallTranscripts(client: string, id?: string, since?: string, limit?: number) {
  const sb = getServiceSupabase();
  if (id) {
    const { data } = await sb.from("fathom_calls").select("fathom_id,title,recorded_at,duration_sec,prospect_name,client_key,summary,transcript,rec_start:raw->>recording_start_time,rec_end:raw->>recording_end_time").eq("fathom_id", id).maybeSingle();
    if (!data) return { found: false, id };
    const c = data as Row;
    const { data: link } = await sb.from("fathom_call_links").select("linkage_method,matched_value,sale_date,prospect_name,subscriber_id,keyword_normalized").eq("fathom_id", String(c.fathom_id)).maybeSingle();
    const lk = link as Row | null;
    return {
      found: true,
      call: {
        fathom_id: c.fathom_id, title: c.title, recorded_at: c.recorded_at, duration_sec: durationSec(c.duration_sec, c.rec_start, c.rec_end),
        prospect_name: c.prospect_name ?? null, client_key: c.client_key ?? null,
        summary: c.summary ?? null, transcript: c.transcript ?? null,
      },
      linkage_status: lk ? "linked" : "unlinked",
      link: lk ? { method: lk.linkage_method, ad_keyword: lk.keyword_normalized ?? null, subscriber_id: lk.subscriber_id ?? null, sale_date: lk.sale_date ?? null } : null,
      linkage_note: lk
        ? "HARD-key link: the closer pasted this call's Fathom link into the sale row; matched by exact share token / recording id (linkage_method). ad_keyword/subscriber come from that sale."
        : "No hard key: this call's Fathom link is not in any sale row (and fathom_calls carries no ManyChat/keyword). Not linked. No name matching is done.",
    };
  }
  const cap = Math.min(Math.max(num(limit) || 25, 1), 100);
  let q = sb.from("fathom_calls").select("fathom_id,title,recorded_at,duration_sec,prospect_name,summary,transcript,rec_start:raw->>recording_start_time,rec_end:raw->>recording_end_time").eq("client_key", client).order("recorded_at", { ascending: false });
  if (since) q = q.gte("recorded_at", since);
  const { data } = await q.limit(cap + 1);
  const rows = (data as Row[]) || [];
  const truncated = rows.length > cap;
  const page = rows.slice(0, cap);
  const ids = page.map((c) => String(c.fathom_id)).filter(Boolean);
  const linkByFathom: Record<string, Row> = {};
  if (ids.length) {
    const { data: links } = await sb.from("fathom_call_links").select("fathom_id,linkage_method,keyword_normalized,subscriber_id,sale_date").in("fathom_id", ids);
    for (const l of (links as Row[]) || []) linkByFathom[String(l.fathom_id)] = l;
  }
  const linkedCount = Object.keys(linkByFathom).length;
  return {
    calls: page.map((c) => {
      const lk = linkByFathom[String(c.fathom_id)];
      return {
        fathom_id: c.fathom_id, title: c.title, recorded_at: c.recorded_at,
        duration_sec: durationSec(c.duration_sec, c.rec_start, c.rec_end), prospect_name: c.prospect_name ?? null,
        summary: c.summary ? excerpt(c.summary, 500) : null,
        summary_truncated: !!(c.summary && String(c.summary).length > 500),
        has_transcript: !!c.transcript,
        linkage_status: lk ? "linked" : "unlinked",
        link: lk ? { method: lk.linkage_method, ad_keyword: lk.keyword_normalized ?? null, subscriber_id: lk.subscriber_id ?? null, sale_date: lk.sale_date ?? null } : null,
      };
    }),
    truncated,
    linked_on_page: linkedCount,
    note: "List mode = summaries + fathom ids. Call again with an id for the full transcript. linkage_status is 'linked' ONLY when a closer pasted this call's Fathom link into the sale row (exact share-token / recording-id match); otherwise 'unlinked'. No name matching.",
  };
}

// ---- New tool: get_organic_content (RAW-FIRST) ----
// Default response carries NO grading (verdict/band/hits/misses) - raw content + engagement + transcript
// availability only. The AI grading layer is opt-in via include_grades:true (namespaced under
// internal_grading), because the owner distrusts it for the external agent. Counts absent from IG are
// "not_tracked", never 0.
const val = (x: unknown) => (x === null || x === undefined ? NOT_TRACKED : x);
export async function getOrganicContent(client: string, opts: { id?: string; since?: string; until?: string; band?: string; limit?: number; include_grades?: boolean }) {
  const sb = getServiceSupabase();
  if (opts.id) {
    const { data: content } = await sb.from("creator_content").select("ig_media_id,media_type,permalink,caption,taken_at,view_count,play_count,like_count,comment_count,transcript,transcript_status,transcript_words").eq("client_key", client).eq("ig_media_id", opts.id).maybeSingle();
    if (!content) return { found: false, id: opts.id };
    const c = content as Row;
    const post: Row = {
      media_id: c.ig_media_id, media_type: c.media_type, taken_at: c.taken_at, permalink: val(c.permalink),
      caption: c.caption ?? null,
      transcript_available: !!(c.transcript && String(c.transcript).trim().length > 0),
      transcript_words: c.transcript_words ?? 0,
      transcript_status: c.transcript_status ?? null,
      transcript: c.transcript ?? null,
      engagement: { views: val(c.view_count), plays: val(c.play_count), likes: val(c.like_count), comments: val(c.comment_count) },
    };
    if (opts.include_grades) {
      const { data: grade } = await sb.from("content_grades").select("score,band,verdict,hits,misses,feedback,icp_version").eq("client_key", client).eq("ig_media_id", opts.id).order("graded_at", { ascending: false }).limit(1).maybeSingle();
      const g = grade as Row | null;
      post.internal_grading = g ? { score: g.score, band: g.band, verdict: g.verdict ?? null, hits: g.hits ?? [], misses: g.misses ?? [], feedback: g.feedback ?? null, icp_version: g.icp_version ?? null } : NOT_TRACKED;
    }
    return { found: true, post };
  }
  const cap = Math.min(Math.max(num(opts.limit) || 25, 1), 100);
  let q = sb.from("creator_content").select("ig_media_id,media_type,permalink,caption,taken_at,view_count,play_count,like_count,comment_count,transcript_status,transcript_words,video_url,stored_video_url").eq("client_key", client).order("taken_at", { ascending: false });
  if (opts.since) q = q.gte("taken_at", opts.since);
  if (opts.until) q = q.lte("taken_at", opts.until);
  const { data: content } = await q.limit(cap + 1);
  const rows = (content as Row[]) || [];
  const truncated = rows.length > cap;
  const page = rows.slice(0, cap);
  const ids = page.map((r) => String(r.ig_media_id));
  const gradeByMedia: Record<string, Row> = {};
  if (opts.include_grades && ids.length) {
    const { data: grades } = await sb.from("content_grades").select("ig_media_id,score,band,misses").eq("client_key", client).in("ig_media_id", ids);
    for (const g of (grades as Row[]) || []) gradeByMedia[String(g.ig_media_id)] = g;
  }
  let posts = page.map((c) => {
    const words = num(c.transcript_words);
    const post: Row = {
      media_id: c.ig_media_id, taken_at: c.taken_at, media_type: c.media_type, permalink: val(c.permalink),
      caption_excerpt: excerpt(c.caption, 200),
      transcript_available: words > 0,
      transcript_words: words,
      transcript_status: c.transcript_status ?? null,
      has_stored_media: !!(c.stored_video_url || c.video_url),
      engagement: { views: val(c.view_count), plays: val(c.play_count), likes: val(c.like_count), comments: val(c.comment_count) },
    };
    if (opts.include_grades) {
      const g = gradeByMedia[String(c.ig_media_id)];
      const misses = (g?.misses as unknown[]) || [];
      post.internal_grading = g ? { score: g.score, band: g.band, top_miss: misses.length ? misses[0] : null } : NOT_TRACKED;
    }
    return post;
  });
  if (opts.band && opts.include_grades) posts = posts.filter((p) => p.internal_grading !== NOT_TRACKED && (p.internal_grading as Row).band === opts.band);
  // Follower history (raw), if the snapshot table has rows for this creator.
  let follower_history: unknown = NOT_TRACKED;
  const { data: snaps } = await sb.from("creator_account_snapshots").select("snapshot_date,followers_count,following_count,media_count").eq("client_key", client).order("snapshot_date", { ascending: false }).limit(60);
  if (snaps && snaps.length) follower_history = (snaps as Row[]).map((s) => ({ date: s.snapshot_date, followers: val(s.followers_count), following: val(s.following_count), media_count: val(s.media_count) }));
  return {
    posts,
    truncated,
    follower_history,
    transcript_coverage: await transcriptCoverage(sb, client),
    note: "RAW organic content: taken_at, media_type, caption excerpt, transcript availability/words/status, has_stored_media, engagement counts (not_tracked when IG did not return them, never 0), permalink. NO grading by default. Pass include_grades:true to append the internal AI grade under internal_grading (opt-in; treat as advisory). Single-post mode (pass id) returns full caption + full transcript. transcript_coverage summarizes how much of the library is transcribed.",
  };
}

// Transcript coverage for a creator: how much of the video library is really transcribed, how much is
// still queued, how much was ruled no-speech (silent/music video), and how many posts have no stored
// media at all. transcribed = a real transcript of MIN 20+ words; anything less is not counted as covered.
async function transcriptCoverage(sb: ReturnType<typeof getServiceSupabase>, client: string) {
  const MIN = 20;
  const base = () => sb.from("creator_content").select("id", { count: "exact", head: true }).eq("client_key", client);
  const n = (r: { count: number | null }) => r.count || 0;
  const [total, eligible_video, transcribed, pending, no_speech, no_stored_media] = await Promise.all([
    base(),
    base().not("video_url", "is", null),
    base().eq("transcript_status", "done").gte("transcript_words", MIN),
    base().in("transcript_status", ["pending", "failed"]),
    base().eq("transcript_status", "no_speech"),
    base().is("video_url", null).is("stored_video_url", null),
  ].map((p) => p.then(n)) as Promise<number>[]);
  const pct = eligible_video > 0 ? Math.round((transcribed / eligible_video) * 1000) / 10 : null;
  return {
    total_posts: total,
    eligible_video_posts: eligible_video,
    transcribed_20plus_words: transcribed,
    transcribed_pct_of_video: pct,
    still_queued: pending,
    ruled_no_speech: no_speech,
    posts_with_no_stored_media: no_stored_media,
    note: `transcribed = a real transcript of ${MIN}+ words. still_queued resumes on the content-pipeline-heavy cron (batched, never starves the fast pipeline). ruled_no_speech = silent/music video Whisper could not transcribe after retries (terminal). posts_with_no_stored_media have neither a live nor a durable video url, so they can never be transcribed until re-ingested.`,
  };
}

// ---- New tool: describe_schema (static, no DB) ----
export const SCHEMA_DOC = {
  version: "2.2.0",
  server: "utari-ccos-foundation",
  generated_for: "UTARI MCP v2",
  hard_rules: [
    "Read STORED layers only; attribution is never live-recomputed and wide raw scans are never run.",
    "Money comes only from the canonical Ads Dashboard snapshot payload (ads_dashboard_snapshots) or attribution_summary / sale_attribution_facts.",
    "DM counts are unique ManyChat subscribers who fired the keyword (ads_keyword_events), never Meta messaging_conversations_started.",
    "No fuzzy identity matching: links are made on hard keys (subscriber_id, ad_id, ig_media_id) or emit linkage_status 'unlinked'.",
    "Read-only on business tables. Responses are capped ~100KB with limit/cursor style caps and explicit truncation flags.",
  ],
  keyword_vs_placement_model: {
    principle: "A keyword IS the ad's identity. The same keyword can run as several placements (ad_id / campaign / adset). Money and funnel counts (dms, booked, taken, closes, cash, roas) are KEYWORD-LEVEL truths; spend is the one field that splits at the PLACEMENT level.",
    get_ad: "returns funnel = the keyword-level canonical aggregate across every placement, plus placements[] (each ad_id/campaign/adset/status/spend). Never silently returns just the first placement. Pass ad_id to scope the funnel/spend to one placement.",
    duplicate_keywords: "When a keyword appears more than once (e.g. GYM/PRO ran twice on tyson), the placements[] array holds all of them; placement_scope = 'all' unless an ad_id was passed.",
  },
  vocabulary: {
    spend: "Ad spend in USD. Uses the ad account's calendar day (America/Los_Angeles / Pacific).",
    dms: "Unique ManyChat subscribers who DMed the ad's keyword (dm_ad_links). Never a Meta messaging metric.",
    cost_per_dm: "spend / dms (null when dms = 0).",
    booked_calls: "Calls booked attributed to the ad.",
    cost_per_booked_call: "spend / booked_calls (null when 0).",
    calls_taken: "Calls actually taken (shown).",
    show_rate: "calls_taken / booked_calls (null when 0).",
    closes: "New clients / closes.",
    close_rate: "closes / calls_taken (null when 0).",
    cash_collected: "Cash collected from ad-attributed (paid) closes in the window.",
    roas: "collected ROAS = cash_collected / spend, as reconciled by the Dashboard.",
    total_collected_all_sources: "All collected cash in the window incl organic + unattributed (context, not the ad funnel).",
  },
  attribution_status: {
    machine_attributed: "Sale linked to an ad by a HARD key: method link_dm (ManyChat/DM subscriber key) or link_booking (booking record key). This is machine certainty.",
    name_matched: "Sale linked by a deterministic prospect-name match only (method = name). NOT a hard key, so explicitly at risk of a wrong or coincidental match; never treat as machine certainty. Counted in itemized attributed cash but reported separately.",
    resolved_organic: "Reserved/aggregate only: organic cash is reconciled at the summary level (attribution_summary.organic); it is NOT tagged per individual sale, so it is not emitted as a per-sale status.",
    unresolved: "Ledger sale with no entry in sale_attribution_facts (no ad keyword).",
  },
  dm_count_definition: "A DM is one unique ManyChat subscriber who fired a keyword (ads_keyword_events, event_type dm_keyword). Message volume within a thread is separate (dm_conversation_messages).",
  dm_thread_derivation: {
    note: "get_dms_for_ad and get_ad_full thread_digests resolve verbatim threads LIVE, not from a prebuilt table. The old dm_ad_links bridge was built once (2026-07-09) and never refreshed, and its id-space (16-digit) did not match dm_conversation_messages (9-digit Instagram id), so threads returned zero. Replaced.",
    path: "keyword subscribers (ManyChat id, ads_keyword_events) -> instagram_lead_links (manychat_subscriber_id -> instagram_user_id, refreshed daily) -> dm_conversation_messages (subscriber_id = that Instagram id). The thread's subscriber is reported as the ManyChat id so became_sale/booked hard keys still resolve.",
    coverage: "get_dms_for_ad carries thread_coverage {keyword_subscribers, threads_resolved, note} (get_ad/get_ad_full call it dm_coverage). threads_resolved tracks the funnel's unique-DM count for the window; any gap is subscribers whose Instagram thread is not yet bridged (bridge tightens daily), never a silent drop. The envelope's separate `coverage` key is the window cash-attribution %, a different metric.",
  },
  dm_reconciliation_definition: {
    note: "get_ad_full.dm_reconciliation compares two counts for the SAME keyword and window. funnel_dms = the canonical keyword-level unique DMs; window_series_dms = the same count summed from the per-day series. dm_status is 'match' when equal, 'definition_gap_raw_exceeds_attributed' when the raw keyword-subscriber count exceeds the canonically-attributed funnel dms (an accepted definition gap, not an error), and 'ERROR_attributed_exceeds_raw' only when the attributed count exceeds the raw one (a real bug flag). Same treatment for spend (funnel_spend vs window_series_spend).",
  },
  show_rate_carryover: "show_rate = calls_taken / booked_calls can exceed 1.0 and is NEVER clamped. Calls taken in a window include calls that were BOOKED in a prior window (period-counting carryover), so taken can exceed booked for the same window. When this happens the response carries a show_rate_note saying so; the raw counts are always shown.",
  audit_2026_07_15: {
    note: "An external agent audited this MCP; several of its readings were MCP bugs, not business reality. Fixed here (read-path only, no business logic or ad actions changed):",
    fixed_mcp_bugs: [
      "freshness reported all sources ~9 days stale: it read feed_watermarks, a dead cursor table frozen at an old run. Now reads live max(synced_at/event_at/sent_at/recorded_at) per source, with a self_test that flags sales/meta > 24h.",
      "get_ad_full per-day DM series showed 0 on recent days: it rolled up dm_ad_links.first_seen_at (a static/stale bridge). Now rolls up ads_keyword_events (the same source the funnel counts) and asserts the window unique DMs reconcile to the funnel dms (dm_reconciliation).",
      "get_sales_with_ad double-counted (e.g. a person appearing twice from a superseded amount): now drives off the DEDUPED ledger (same dedupe as the Ads tab), so close counts match the dashboard.",
      "name matches were mislabeled machine_attributed: name matches are now their own name_matched status (at risk, not a hard key).",
      "call duration_sec, per-ad status in placements, and thread booked flags were reported not_tracked though the data exists: duration_sec now falls back to raw.recording_start/end_time; per_ad_status maps ads_meta_insights_daily.ad_effective_status; thread booked is hard-keyed from booked_call events.",
      "get_sales_with_ad understated the attributed total vs the canonical figure: it now reports canonical_all_time_paid_attributed (attribution_summary) and the manual_resolution_remainder so the total reconciles.",
      "SECOND PASS (2026-07-15): DM threads returned zero everywhere (get_dms_for_ad, get_ad, get_ad_full digests). Root cause was two layered defects: the dm_ad_links bridge was static (built once 2026-07-09, never refreshed) AND its 16-digit id-space did not match dm_conversation_messages' 9-digit Instagram id, so even bridged keywords joined to nothing. Replaced with a live derivation: keyword subscribers -> instagram_lead_links -> dm_conversation_messages. Threads now track the funnel's unique-DM count with a coverage block.",
      "SECOND PASS: get_ad returned only the FIRST placement when a keyword ran more than once. Now returns the keyword-level canonical aggregate plus placements[] (spend per ad_id); optional ad_id scopes it. See keyword_vs_placement_model.",
      "SECOND PASS: dm_reconciliation raised a false error when raw keyword subscribers exceeded canonically-attributed funnel dms. That is a definition gap, not a bug: classified as definition_gap_raw_exceeds_attributed; a real error only fires when attributed exceeds raw. spend reconciliation added alongside.",
      "SECOND PASS: business_snapshot show_rate could read > 1.0 (e.g. 16 taken / 14 booked). NOT clamped (clamping would hide true data). Raw counts kept; a show_rate_note explains prior-window booking carryover. See show_rate_carryover.",
      "SECOND PASS: get_organic_content led with an AI grade. Reworked raw-first: default response is factual (caption/transcript/engagement/permalink) with grading behind include_grades:true.",
    ],
    real_ceilings_not_bugs: [
      "Call->ad linkage is HARD-keyed by three exact keys (fathom_call_links), in precedence order: (1) a closer pasted the call's Fathom link into the sale row (share-token / recording-id), (2) a Fathom external attendee email EXACTLY equals a ghl_appointments.contact_email, (3) the Fathom meeting URL EXACTLY equals the booking's meeting link (calendar.address). The matched booking carries the ad keyword; linkage_method names which key. Calls matching none stay 'unlinked' - NO name matching is ever done. Coverage is bounded by what closers paste + what bookings capture (email / meeting link).",
      "Some collected cash is genuinely unresolved (no ad keyword captured) - a normal, accepted state, not an error. Coverage % below 100 is expected.",
      "Funded zero-DM ads in a test pool are deliberately starved by Meta (small budgets, cold audiences); zero DMs on spend alone is NOT a kill signal. The auditor's inflated 'zero-DM funded ad' count was partly the per-day series bug (now fixed) plus this misread.",
      "resolved_organic is reconciled only at the summary level, not tagged per individual sale.",
    ],
  },
  accuracy_ceilings: [
    "Historical DM-to-sale stitch is partial: hard-key link_dm covers most, name_matched fills more but is at risk; forward capture improves as keyword capture tightens.",
    "fathom_calls carry no ManyChat subscriber or ad keyword, so call->ad/DM linkage is always linkage_status 'unlinked' (correlate on prospect_name only, non-authoritative; no name-based machine link).",
    "Per-ad Meta on/off status now comes from ads_meta_insights_daily.ad_effective_status (get_ad_full placements.per_ad_status); keyword-level status is in keyword_state.",
    "Thread 'booked' is now hard-keyed from booked_call events per subscriber; became_sale from subscriber_id in sale_attribution_facts.",
    "business_snapshot prior_window is the most recent non-overlapping earlier stored snapshot (rolling ~7-day windows). The warm cron keeps a prior-week snapshot warm, so it populates within ~a day; until then it returns not_tracked.",
  ],
  tools: {
    list_ads: "Per-ad canonical funnel + live targeting/copy for a creator (v2 field names).",
    get_ad: "One keyword's canonical funnel aggregate + placements[] (spend per ad_id) + a sample of its DM threads. Keyword is the identity; pass ad_id to scope spend to one placement.",
    get_dms_for_ad: "Every DM thread a keyword started, full verbatim, resolved live via the ManyChat->Instagram bridge, with a coverage block.",
    get_ad_day: "Per-ad-per-day spend/impressions/clicks/cpm/status.",
    list_sales: "Deduped sales ledger; each sale carries attribution_status (machine_attributed | name_matched | unresolved).",
    get_sales_with_ad: "Deduped ledger annotated with canonical per-sale ad attribution + honest certainty (machine_attributed hard key vs name_matched at-risk), counts, and a reconciliation block against the canonical all-time attributed figure.",
    freshness: "Per-source LIVE sync recency (max synced_at/event_at per source table) + a self_test flagging sales/meta > 24h. Does not read feed_watermarks.",
    business_snapshot: "Per creator + combined current/prior week funnel, top/bottom 3 funded ads, funded zero-DM ad count.",
    get_ad_full: "One-call full ad object: funnel + placement lineage + copy + per-day series + thread digests.",
    get_call_transcripts: "List mode = fathom summaries + ids; single-id mode = full transcript + duration. linkage_status 'linked' (hard share-token/recording-id match to a sale, with ad_keyword + subscriber) or 'unlinked'.",
    get_organic_content: "RAW-FIRST by default: per post taken_at, media_type, caption excerpt (200 chars), transcript_available + transcript_words + transcript_status, engagement counts (not_tracked when Instagram omits the field, never 0), permalink. NO grading/verdict/band/hits/misses unless include_grades:true (which appends internal_grading, advisory). Single-post mode (id = ig_media_id) returns full caption + full transcript. Also returns follower_history from creator_account_snapshots when present.",
    describe_schema: "This document.",
    "factory_*": "Read + write on the /factory content workspace (unchanged).",
  },
  envelope: "Every business-data response ends with data_freshness (feed_watermarks) and, when a single creator is in scope, coverage (attribution_summary: % of window cash machine-attributed).",
};
