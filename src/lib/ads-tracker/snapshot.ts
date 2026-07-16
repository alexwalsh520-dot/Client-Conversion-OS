// Ads dashboard snapshot cache. The attribution pipeline is heavy, so we compute a window ONCE
// (hourly cron + Sync Now + lazily on a cache miss) and store the payload. Requests serve the
// stored payload in well under a second, so the same window returns identical numbers on every
// refresh, and the tab never silently swaps to a stale device copy. One source per render, labeled.

import { getServiceSupabase } from "@/lib/supabase";
import {
  getAdsTrackerDashboard,
  type AdsTrackerAccount,
  type AdsTrackerLevel,
  type AdsTrackerStatus,
  type SaleFact,
} from "./server";
import { computeMoneyModel } from "./money-model";
import { persistSaleFacts, persistAttributionSummary } from "./sale-facts";

export type SnapQuery = {
  account: AdsTrackerAccount;
  status: AdsTrackerStatus;
  level: AdsTrackerLevel;
  dateFrom: string;
  dateTo: string;
};

export type Freshness = {
  computedAt: string;
  salesSyncedAt: string | null;
  metaSyncedAt: string | null;
  fromSnapshot: boolean;
};

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function syncTimes(): Promise<{ sales: string | null; meta: string | null }> {
  const sb = getServiceSupabase();
  const [s, m] = await Promise.all([
    sb.from("sales_tracker_rows").select("synced_at").order("synced_at", { ascending: false }).limit(1),
    sb.from("ads_meta_insights_daily").select("synced_at").order("synced_at", { ascending: false }).limit(1),
  ]);
  return {
    sales: s.data && s.data[0] ? (s.data[0] as { synced_at: string }).synced_at : null,
    meta: m.data && m.data[0] ? (m.data[0] as { synced_at: string }).synced_at : null,
  };
}

// Read the freshest stored AD-LEVEL snapshot for an account, whatever window it covers.
// Snapshot-only (never computes), so callers like the UTARI MCP get the real, reconciled
// Ads-Dashboard per-ad funnel without ever triggering the heavy live recompute (which blows
// the Postgres statement timeout on wide windows). Returns the payload + the window it represents.
export async function readLatestAdSnapshot(
  account: AdsTrackerAccount,
): Promise<{ payload: Record<string, unknown>; dateFrom: string; dateTo: string; computedAt: string } | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("ads_dashboard_snapshots")
    .select("payload, date_from, date_to, computed_at")
    .eq("account", account).eq("level", "ad").eq("status", "all")
    .order("computed_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  const d = data as { payload: Record<string, unknown>; date_from: string; date_to: string; computed_at: string };
  return { payload: d.payload || {}, dateFrom: d.date_from, dateTo: d.date_to, computedAt: d.computed_at };
}

// Read a stored snapshot (fast path). Returns the payload with freshness, or null on a miss.
export async function readSnapshot(q: SnapQuery): Promise<Record<string, unknown> | null> {
  const sb = getServiceSupabase();
  const { data } = await sb
    .from("ads_dashboard_snapshots")
    .select("payload, computed_at")
    .eq("account", q.account).eq("date_from", q.dateFrom).eq("date_to", q.dateTo).eq("level", q.level).eq("status", q.status)
    .maybeSingle();
  if (!data) return null;
  const payload = (data as { payload: Record<string, unknown> }).payload || {};
  const fresh = (payload._freshness as Freshness) || null;
  return { ...payload, _freshness: fresh ? { ...fresh, fromSnapshot: true } : { computedAt: (data as { computed_at: string }).computed_at, salesSyncedAt: null, metaSyncedAt: null, fromSnapshot: true } };
}

// Compute a window fresh, store it, return it. Never touches the live Google Sheet (server.ts
// serves the synced copy given the raised freshness tolerance).
export async function computeAndStore(q: SnapQuery): Promise<Record<string, unknown>> {
  const start = Date.now();
  const saleFacts: SaleFact[] = [];
  const [payload, moneyModel, times] = await Promise.all([
    getAdsTrackerDashboard(q, { onSaleFact: (f) => saleFacts.push(f) }),
    computeMoneyModel().catch(() => null),
    syncTimes(),
  ]);
  // Stamp the canonical per-sale attribution into sale_attribution_facts (upsert by sale_key), and
  // the reconciled per-creator revenue buckets into attribution_summary. Non-fatal: a facts-write
  // hiccup must never fail the snapshot.
  await persistSaleFacts(saleFacts).catch(() => {});
  if (q.account === "tyson" || q.account === "antwan") {
    const attribution = (payload as { attribution?: Record<string, unknown> }).attribution;
    await persistAttributionSummary(q.account, attribution, q.dateFrom, q.dateTo).catch(() => {});
  }
  const computeMs = Date.now() - start;
  const _freshness: Freshness = { computedAt: new Date().toISOString(), salesSyncedAt: times.sales, metaSyncedAt: times.meta, fromSnapshot: false };
  const full = { ...payload, moneyModel, _freshness };

  const sb = getServiceSupabase();
  await sb.from("ads_dashboard_snapshots").upsert(
    { account: q.account, date_from: q.dateFrom, date_to: q.dateTo, level: q.level, status: q.status, payload: full, computed_at: _freshness.computedAt, compute_ms: computeMs },
    { onConflict: "account,date_from,date_to,level,status" },
  );
  return full;
}

// The heavy detail fields that the initial Dashboard paint never renders: dailyRows (per-day
// drilldown), attribution (the Workspace), eventsHistory (the full history feed), calendarEvents
// (the calendar). Together they are 90%+ of the ad-level payload. The paint view drops them and the
// client lazy-loads the full payload behind the paint (see loadDashboard). Kept OUT here so this
// list is the single source of truth for what "paint" means.
const PAINT_DROP_FIELDS = ["dailyRows", "attribution", "eventsHistory", "calendarEvents"] as const;

// The raw additive fields the client sums per row (metricRowFromApi/addMetric); every ratio the table
// shows (CPM, ROI, cost-per-*) is recomputed client-side from these, so the derived fields in a row are
// redundant weight. The identity/label fields the table groups by are carried through verbatim.
const ROLLUP_SUM_FIELDS = ["adSpend", "impressions", "linkClicks", "messages", "bookedCalls", "callsTaken", "newClients", "mainOfferClients", "subscriptionClients", "collectedRevenue", "contractedRevenue", "grossProfit"] as const;
const ROLLUP_KEEP_FIELDS = ["clientKey", "campaignId", "campaignName", "adId", "adName", "adsetId", "adsetName", "keyword", "previewImageUrl", "previewThumbnailUrl", "attributionOnly", "id"] as const;

// Collapse dailyRows (one row per ad per day) into one row per ad for the whole window, summing the raw
// additive fields. The point: the paint table renders from THIS, and the full table renders from the
// same dailyRows, so their collapsed totals are identical by construction (no number flickers to a
// different value when the full payload swaps in). Grouping key is the ad identity the client groups by.
function rollupRowsFromDaily(dailyRows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const r of dailyRows) {
    const key = `${r.clientKey ?? ""}::${r.campaignId ?? ""}::${r.adId ?? ""}::${r.keyword ?? ""}`;
    let out = map.get(key);
    if (!out) {
      out = { dateLabel: null };
      for (const f of ROLLUP_KEEP_FIELDS) out[f] = r[f] ?? null;
      for (const f of ROLLUP_SUM_FIELDS) out[f] = 0;
      out.status = "finished";
      map.set(key, out);
    }
    for (const f of ROLLUP_SUM_FIELDS) out[f] = (Number(out[f]) || 0) + (Number(r[f]) || 0);
    // Active wins: if the ad ran on any day in the window, the collapsed row is active.
    if (r.status !== "finished") out.status = "active";
    // Keep a preview/name if the first row lacked one.
    for (const f of ["previewImageUrl", "previewThumbnailUrl", "adName", "campaignName", "adsetName"] as const)
      if (!out[f] && r[f]) out[f] = r[f];
  }
  return Array.from(map.values());
}

// Slim the stored payload down to what the first paint needs. Recomputes `rows` from `dailyRows` so the
// collapsed table matches the full load to the number, then drops the heavy detail fields. If a payload
// has no dailyRows (an older or already-slim snapshot) the existing rows are kept as-is.
export function projectPaint(full: Record<string, unknown>): Record<string, unknown> {
  const daily = full.dailyRows;
  const slim: Record<string, unknown> = { ...full };
  if (Array.isArray(daily) && daily.length) slim.rows = rollupRowsFromDaily(daily as Array<Record<string, unknown>>);
  for (const f of PAINT_DROP_FIELDS) delete slim[f];
  slim._paint = true;
  return slim;
}

// Serve: snapshot first, compute-once-and-store on a miss. `view: "paint"` returns the slim projection
// (fast first paint); the client then requests the full view behind it. Default is the full payload.
export async function serveDashboard(q: SnapQuery, view: "paint" | "full" = "full"): Promise<Record<string, unknown>> {
  const hit = await readSnapshot(q);
  const full = hit ?? (await computeAndStore(q));
  return view === "paint" ? projectPaint(full) : full;
}

// The matrix the tab can request, warmed in priority order (the views a user hits first come first)
// under a wall-clock budget so a slow run stops cleanly BEFORE the platform kills it, rather than
// dying mid-way and leaving the tail permanently cold. Whatever the budget skips fills in lazily on
// first request and then caches. Active roster only (all, tyson, antwan); keith/lucy are near-empty
// and fill lazily. Never silently caps: returns computed/failed/skipped and logs the skipped tail.
export async function refreshStandardWindows(
  budgetMs = 90000,
): Promise<{ computed: number; failed: number; skipped: number; ms: number }> {
  const today = todayEt();
  const monthStart = today.slice(0, 7) + "-01";
  const d7 = shift(today, -6), d14 = shift(today, -13), d30 = shift(today, -29);
  const CREATORS: AdsTrackerAccount[] = ["all", "tyson", "antwan"];
  const jobs: SnapQuery[] = [];
  // Tier 1: the ad-level, status=all default the UI opens with, per account, at the common presets.
  for (const account of CREATORS)
    for (const [from] of [[d7], [d30]] as const)
      jobs.push({ account, status: "all", level: "ad", dateFrom: from, dateTo: today });
  // Tier 2: the campaign/active defaults + month-to-date.
  jobs.push(
    { account: "all", status: "active", level: "campaign", dateFrom: d7, dateTo: today },
    { account: "all", status: "active", level: "campaign", dateFrom: d30, dateTo: today },
    { account: "all", status: "active", level: "campaign", dateFrom: monthStart, dateTo: today },
    { account: "tyson", status: "active", level: "campaign", dateFrom: d7, dateTo: today },
    { account: "antwan", status: "active", level: "campaign", dateFrom: d7, dateTo: today },
    { account: "all", status: "all", level: "ad", dateFrom: d14, dateTo: today },
    { account: "all", status: "all", level: "ad", dateFrom: monthStart, dateTo: today },
  );
  // Tier 3: today + per-creator month-to-date + campaign/all + the PRIOR week (a non-overlapping
  // trailing-7 ending 7 days ago) so business_snapshot can populate prior_window comparisons.
  const priorFrom = shift(today, -13), priorTo = shift(today, -7);
  for (const account of CREATORS)
    jobs.push({ account, status: "all", level: "ad", dateFrom: priorFrom, dateTo: priorTo });
  for (const account of CREATORS)
    jobs.push({ account, status: "all", level: "ad", dateFrom: monthStart, dateTo: today });
  jobs.push(
    { account: "all", status: "all", level: "ad", dateFrom: today, dateTo: today },
    { account: "all", status: "all", level: "campaign", dateFrom: d7, dateTo: today },
    { account: "all", status: "all", level: "campaign", dateFrom: d30, dateTo: today },
  );

  const start = Date.now();
  let computed = 0, failed = 0, skipped = 0;
  for (let i = 0; i < jobs.length; i++) {
    if (Date.now() - start > budgetMs) { skipped = jobs.length - i; break; }
    try { await computeAndStore(jobs[i]); computed++; } catch { failed++; }
  }
  if (skipped) {
    const dropped = jobs.slice(jobs.length - skipped).map((q) => `${q.account}/${q.level}/${q.status}/${q.dateFrom}`);
    console.log(`[refreshStandardWindows] budget ${budgetMs}ms hit; ${skipped} windows deferred to lazy load:`, dropped.join(", "));
  }
  return { computed, failed, skipped, ms: Date.now() - start };
}
