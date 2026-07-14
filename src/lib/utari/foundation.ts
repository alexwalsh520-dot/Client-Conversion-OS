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

export const DM_CLIENT: Record<string, string> = { tyson: "tyson_sonnek", antwan: "antwan_rarcus" };
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
    closes,
    close_rate: ratio(closes, calls),
    cash_collected: round(r.collectedRevenue),
    roas: round2(r.collectedRoi),
    gross_profit: round(r.grossProfit),
    gross_profit_roas: round2(r.grossProfitRoi),
  };
}

// ---- Response envelope: data_freshness (feed_watermarks) + coverage (attribution_summary) ----
export async function dataFreshness(sb: Sb) {
  const { data } = await sb.from("feed_watermarks").select("source,last_run_at");
  const now = Date.now();
  return {
    as_of: new Date().toISOString(),
    sources: (data || []).map((w: Row) => ({
      source: w.source,
      last_sync: (w.last_run_at as string) ?? null,
      minutes_since_sync: w.last_run_at ? Math.round((now - new Date(w.last_run_at as string).getTime()) / 60000) : null,
    })),
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
  const lineage = placements.map((p) => ({
    ad_id: p.adId ?? null, ad_name: p.adName ?? null,
    campaign_id: p.campaignId ?? null, campaign_name: p.campaignName ?? null,
    adset_id: p.adsetId ?? null, adset_name: p.adsetName ?? null,
    spend: round(p.adSpend), impressions: round(p.impressions),
    is_advantage: p.isAdvantage ?? null, audience_type: p.audienceType ?? null,
    per_ad_status: NOT_TRACKED, // Meta per-ad on/off is not in the stored snapshot; see keyword_state.status
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

  // Per-day spend (ad_day) + per-day DMs (dm_ad_links first_seen_at), merged by date.
  const seriesFrom = since || snap.dateFrom;
  let dq = sb.from("ad_day").select("date,spend,impressions,cpm,status").eq("client_key", client).eq("keyword", kw);
  if (seriesFrom) dq = dq.gte("date", seriesFrom);
  const { data: days } = await dq.order("date").limit(370);
  const byDate: Record<string, { date: string; spend: number; impressions: number; cpm: number | null; status: unknown; dms: number }> = {};
  for (const d of (days as Row[]) || []) {
    const date = String(d.date);
    byDate[date] = { date, spend: round2(d.spend), impressions: round(d.impressions), cpm: d.cpm != null ? round2(d.cpm) : null, status: d.status ?? null, dms: 0 };
  }
  const { data: linkDays } = await sb.from("dm_ad_links").select("first_seen_at").eq("client_key", client).eq("keyword_normalized", kw).gte("first_seen_at", `${seriesFrom}T00:00:00Z`).limit(5000);
  for (const l of (linkDays as Row[]) || []) {
    const date = String(l.first_seen_at).slice(0, 10);
    if (!byDate[date]) byDate[date] = { date, spend: 0, impressions: 0, cpm: null, status: null, dms: 0 };
    byDate[date].dms += 1;
  }
  const per_day_series = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  // Thread digests (capped). subscriber, first DM, msg count, became_sale, 2-line excerpt.
  const DIGEST_CAP = 40;
  const { data: links } = await sb.from("dm_ad_links").select("ig_subscriber_id,first_message,first_seen_at").eq("client_key", client).eq("keyword_normalized", kw).order("first_seen_at", { ascending: false }).limit(DIGEST_CAP + 1);
  const linkRows = (links as Row[]) || [];
  const truncated_threads = linkRows.length > DIGEST_CAP;
  const digestSubs = linkRows.slice(0, DIGEST_CAP).map((l) => String(l.ig_subscriber_id));
  // one bounded query for message counts of these subscribers
  const msgCount: Record<string, number> = {};
  if (digestSubs.length) {
    const { data: msgs } = await sb.from("dm_conversation_messages").select("subscriber_id").eq("client", DM_CLIENT[client] || client).in("subscriber_id", digestSubs).limit(6000);
    for (const m of (msgs as Row[]) || []) { const s = String(m.subscriber_id); msgCount[s] = (msgCount[s] || 0) + 1; }
  }
  // became_sale via hard key (subscriber_id) in sale_attribution_facts
  const saleSubs = new Set<string>();
  if (digestSubs.length) {
    const { data: facts } = await sb.from("sale_attribution_facts").select("subscriber_id").eq("client_key", client).in("subscriber_id", digestSubs);
    for (const f of (facts as Row[]) || []) if (f.subscriber_id) saleSubs.add(String(f.subscriber_id));
  }
  const thread_digests = linkRows.slice(0, DIGEST_CAP).map((l) => {
    const sub = String(l.ig_subscriber_id);
    return {
      subscriber: sub,
      first_dm_at: l.first_seen_at ?? null,
      first_message_excerpt: excerpt(l.first_message, 160),
      message_count: msgCount[sub] ?? 0,
      became_sale: saleSubs.has(sub),
      booked: NOT_TRACKED, // no stored per-thread booking flag on a hard key
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
    thread_digests,
    truncated_threads,
    note: "One-call ad view: canonical funnel + placement lineage + copy + per-day spend/DM series + thread digests. Full verbatim threads: call get_dms_for_ad. per_ad_status and booked are not stored on a hard key (not_tracked).",
  };
}

// ---- New tool: get_call_transcripts ----
export async function getCallTranscripts(client: string, id?: string, since?: string, limit?: number) {
  const sb = getServiceSupabase();
  if (id) {
    const { data } = await sb.from("fathom_calls").select("fathom_id,title,recorded_at,duration_sec,prospect_name,client_key,summary,transcript").eq("fathom_id", id).maybeSingle();
    if (!data) return { found: false, id };
    const c = data as Row;
    return {
      found: true,
      call: {
        fathom_id: c.fathom_id, title: c.title, recorded_at: c.recorded_at, duration_sec: c.duration_sec ?? NOT_TRACKED,
        prospect_name: c.prospect_name ?? null, client_key: c.client_key ?? null,
        summary: c.summary ?? null, transcript: c.transcript ?? null,
      },
      linkage_status: "unlinked",
      linkage_note: "fathom_calls has no ManyChat subscriber or ad keyword, so there is no hard key to a specific ad or DM thread. prospect_name is exposed for the caller to correlate; it is not a machine link.",
    };
  }
  const cap = Math.min(Math.max(num(limit) || 25, 1), 100);
  let q = sb.from("fathom_calls").select("fathom_id,title,recorded_at,duration_sec,prospect_name,summary,transcript").eq("client_key", client).order("recorded_at", { ascending: false });
  if (since) q = q.gte("recorded_at", since);
  const { data } = await q.limit(cap + 1);
  const rows = (data as Row[]) || [];
  const truncated = rows.length > cap;
  return {
    calls: rows.slice(0, cap).map((c) => ({
      fathom_id: c.fathom_id, title: c.title, recorded_at: c.recorded_at,
      duration_sec: c.duration_sec ?? NOT_TRACKED, prospect_name: c.prospect_name ?? null,
      summary: c.summary ? excerpt(c.summary, 500) : null,
      summary_truncated: !!(c.summary && String(c.summary).length > 500),
      has_transcript: !!c.transcript,
      linkage_status: "unlinked",
    })),
    truncated,
    note: "List mode = summaries + fathom ids. Call again with an id for the full transcript. Calls carry no hard key to an ad/sale (linkage_status unlinked); correlate on prospect_name at your own risk.",
  };
}

// ---- New tool: get_organic_content ----
export async function getOrganicContent(client: string, opts: { id?: string; since?: string; until?: string; band?: string; limit?: number }) {
  const sb = getServiceSupabase();
  if (opts.id) {
    const { data: content } = await sb.from("creator_content").select("ig_media_id,media_type,permalink,caption,taken_at,view_count,play_count,like_count,comment_count,transcript").eq("client_key", client).eq("ig_media_id", opts.id).maybeSingle();
    if (!content) return { found: false, id: opts.id };
    const c = content as Row;
    const { data: grade } = await sb.from("content_grades").select("score,band,verdict,hits,misses,feedback,icp_version").eq("client_key", client).eq("ig_media_id", opts.id).order("graded_at", { ascending: false }).limit(1).maybeSingle();
    const g = grade as Row | null;
    return {
      found: true,
      post: {
        media_id: c.ig_media_id, media_type: c.media_type, taken_at: c.taken_at, permalink: c.permalink ?? null, caption: c.caption ?? null,
        engagement: { views: c.view_count ?? NOT_TRACKED, plays: c.play_count ?? NOT_TRACKED, likes: c.like_count ?? NOT_TRACKED, comments: c.comment_count ?? NOT_TRACKED },
        grade: g ? { score: g.score, band: g.band, verdict: g.verdict ?? null, hits: g.hits ?? [], misses: g.misses ?? [], feedback: g.feedback ?? null, icp_version: g.icp_version ?? null } : NOT_TRACKED,
        transcript: c.transcript ?? null,
      },
    };
  }
  const cap = Math.min(Math.max(num(opts.limit) || 25, 1), 100);
  let q = sb.from("creator_content").select("ig_media_id,media_type,permalink,caption,taken_at,view_count,like_count,comment_count").eq("client_key", client).order("taken_at", { ascending: false });
  if (opts.since) q = q.gte("taken_at", opts.since);
  if (opts.until) q = q.lte("taken_at", opts.until);
  const { data: content } = await q.limit(cap + 1);
  const rows = (content as Row[]) || [];
  const truncated = rows.length > cap;
  const page = rows.slice(0, cap);
  const ids = page.map((r) => String(r.ig_media_id));
  const gradeByMedia: Record<string, Row> = {};
  if (ids.length) {
    const { data: grades } = await sb.from("content_grades").select("ig_media_id,score,band,misses").eq("client_key", client).in("ig_media_id", ids);
    for (const g of (grades as Row[]) || []) gradeByMedia[String(g.ig_media_id)] = g; // one grade per media assumed; last wins
  }
  let posts = page.map((c) => {
    const g = gradeByMedia[String(c.ig_media_id)];
    const misses = (g?.misses as unknown[]) || [];
    return {
      media_id: c.ig_media_id, taken_at: c.taken_at, media_type: c.media_type, permalink: c.permalink ?? null,
      caption_excerpt: excerpt(c.caption, 160),
      engagement: { views: c.view_count ?? NOT_TRACKED, likes: c.like_count ?? NOT_TRACKED, comments: c.comment_count ?? NOT_TRACKED },
      grade: g ? { score: g.score, band: g.band, top_miss: misses.length ? misses[0] : null } : NOT_TRACKED,
    };
  });
  if (opts.band) posts = posts.filter((p) => p.grade !== NOT_TRACKED && (p.grade as Row).band === opts.band);
  return {
    posts,
    truncated,
    note: "Per-post buyer-fit grade from content_grades (only graded posts carry a grade; the rest show grade not_tracked). Full caption + transcript only in single-post mode (pass id). band filter is optional.",
  };
}

// ---- New tool: describe_schema (static, no DB) ----
export const SCHEMA_DOC = {
  version: "2.0.0",
  server: "utari-ccos-foundation",
  generated_for: "UTARI MCP v2",
  hard_rules: [
    "Read STORED layers only; attribution is never live-recomputed and wide raw scans are never run.",
    "Money comes only from the canonical Ads Dashboard snapshot payload (ads_dashboard_snapshots) or attribution_summary / sale_attribution_facts.",
    "DM counts are unique ManyChat subscribers (dm_ad_links), never Meta messaging_conversations_started.",
    "No fuzzy identity matching: links are made on hard keys (subscriber_id, ad_id, ig_media_id) or emit linkage_status 'unlinked'.",
    "Read-only on business tables. Responses are capped ~100KB with limit/cursor style caps and explicit truncation flags.",
  ],
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
    machine_attributed: "Sale linked to an ad keyword by the Dashboard's deterministic logic and stored in sale_attribution_facts. method = link_dm (ManyChat/DM hard key) or link_booking (booking record hard key) or name (deterministic prospect-name match; softer than a hard key but still machine-derived).",
    resolved_organic: "Reserved/aggregate only: organic cash is reconciled at the summary level (attribution_summary.organic); it is NOT tagged per individual sale in the current data, so it is not emitted as a per-sale status.",
    unresolved: "Ledger sale with no entry in sale_attribution_facts (no ad keyword). Emitted per sale by list_sales.",
  },
  dm_count_definition: "A DM is one unique ManyChat subscriber tied to a keyword via dm_ad_links (ig_subscriber_id + keyword_normalized). Message volume within a thread is separate (dm_conversation_messages).",
  accuracy_ceilings: [
    "Historical DM-to-sale stitch is partial: only sales whose DM thread carried a ManyChat keyword link_dm cleanly (263 link_dm vs 155 name matches across creators). Forward capture is improving as keyword capture tightens.",
    "fathom_calls carry no ManyChat subscriber or ad keyword, so call->ad/DM linkage is always linkage_status 'unlinked' (correlate on prospect_name only, non-authoritative).",
    "Per-ad Meta on/off status is not in the stored snapshot; get_ad_full reports keyword-level status from ad_state and per_ad_status not_tracked.",
    "Per-thread 'booked' is not stored on a hard key, so thread digests report booked not_tracked (became_sale IS available via subscriber_id hard key).",
    "business_snapshot prior_window is the most recent non-overlapping earlier stored snapshot (rolling ~7-day windows, not calendar weeks); both windows are echoed.",
  ],
  tools: {
    list_ads: "Per-ad canonical funnel + live targeting/copy for a creator (v2 field names).",
    get_ad: "One ad's funnel + a sample of its DM threads.",
    get_dms_for_ad: "Every DM thread for an ad, full verbatim.",
    get_ad_day: "Per-ad-per-day spend/impressions/clicks/cpm/status.",
    list_sales: "Sales ledger; each sale carries attribution_status (machine_attributed | unresolved).",
    get_sales_with_ad: "Canonical per-sale ad attribution (facts). Each row is machine_attributed with its method + dm_linked.",
    freshness: "Per-source sync recency (feed_watermarks).",
    business_snapshot: "Per creator + combined current/prior week funnel, top/bottom 3 funded ads, funded zero-DM ad count.",
    get_ad_full: "One-call full ad object: funnel + placement lineage + copy + per-day series + thread digests.",
    get_call_transcripts: "List mode = fathom summaries + ids; single-id mode = full transcript. linkage_status unlinked.",
    get_organic_content: "Per-post buyer-fit grade (content_grades) + engagement; single-post mode returns full caption + transcript.",
    describe_schema: "This document.",
    "factory_*": "Read + write on the /factory content workspace (unchanged).",
  },
  envelope: "Every business-data response ends with data_freshness (feed_watermarks) and, when a single creator is in scope, coverage (attribution_summary: % of window cash machine-attributed).",
};
