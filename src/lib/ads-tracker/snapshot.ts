// Ads dashboard snapshot cache. The attribution pipeline is heavy, so we compute a window ONCE
// (hourly cron + Sync Now + lazily on a cache miss) and store the payload. Requests serve the
// stored payload in well under a second, so the same window returns identical numbers on every
// refresh, and the tab never silently swaps to a stale device copy. One source per render, labeled.

import { getServiceSupabase } from "@/lib/supabase";
import { ACTIVE_CREATORS } from "@/lib/creators";
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

// Compute a window with the FAST engine, store it, return it. This is the canonical user-facing
// snapshot: it skips the wide, all-accounts, since-inception attribution-alert fan-out (the 8-12s+
// query set that was timing out and 500ing every non-warmed load). Every funnel/money number, the
// per-day rows, adRoas and the funnel's own attributed/unattributed figures are identical to the
// legacy engine (the daily attribution-reconcile cron guards this dollar-for-dollar). What fast omits
// is ONLY the Attribution Workspace's unmatched-sales list + its all-time trust figures, which now
// load on demand via computeWorkspaceLegacy (engine=legacy). So a cold user-facing miss is ~1s here
// instead of 19-70s, and no user-facing request ever runs the wide fan-out again.
export async function computeAndStore(q: SnapQuery): Promise<Record<string, unknown>> {
  const start = Date.now();
  const saleFacts: SaleFact[] = [];
  const [payload, moneyModel, times] = await Promise.all([
    getAdsTrackerDashboard(q, { fast: true, onSaleFact: (f) => saleFacts.push(f) }),
    computeMoneyModel().catch(() => null),
    syncTimes(),
  ]);
  // Sale facts fire in fast mode too (the onSaleFact sink is independent of the alert fan-out). The
  // per-creator attribution_summary is safe to write from fast: fast computes the window buckets AND the
  // all-time trust figures (paid/organic/unattributed) cheaply from the stored facts - it is ONLY the
  // wide alert fan-out (the unmatched-sales LIST) that fast skips, and the summary does not use that.
  // Verified fast == legacy on these buckets (the daily reconcile cron guards it dollar-for-dollar).
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

// Serve. ONE engine, always the fast one: snapshot-first, and on a miss compute fast (~1s) and store.
// No user-facing request ever runs the wide, all-accounts, since-inception attribution-alert fan-out
// that was 500ing on statement timeout - the fast engine already produces the funnel money, the
// per-day rows, the all-time trust figures AND the request-scoped unmatched-sales list the Attribution
// Workspace shows (verified identical to the legacy engine, which is retained only for the daily
// reconcile guard). `view: "paint"` returns the slim first-paint projection; the client loads the full
// view behind it. Warm hit and cold miss both project from the same fast payload, so numbers match.
// In-flight de-duplication: the client fires paint + full for the same window back-to-back (and dev
// StrictMode doubles that), so a cold window could kick off 2-4 identical heavy computes at once that
// pile onto the same DB pool and time each other out. Coalescing them onto ONE compute (per server
// instance) removes that self-inflicted contention - the first request computes+stores, the rest await
// the same promise and then read the fresh payload.
const inFlightComputes = new Map<string, Promise<Record<string, unknown>>>();
function snapKey(q: SnapQuery): string {
  return `${q.account}|${q.dateFrom}|${q.dateTo}|${q.level}|${q.status}`;
}

export async function serveDashboard(
  q: SnapQuery,
  view: "paint" | "full" = "full",
): Promise<Record<string, unknown>> {
  const hit = await readSnapshot(q);
  if (hit) return view === "paint" ? projectPaint(hit) : hit;
  const key = snapKey(q);
  let pending = inFlightComputes.get(key);
  if (!pending) {
    pending = computeAndStore(q).finally(() => inFlightComputes.delete(key));
    inFlightComputes.set(key, pending);
  }
  const full = await pending;
  return view === "paint" ? projectPaint(full) : full;
}

// The matrix the tab can request, warmed in priority order (the views a user hits first come first)
// under a wall-clock budget so a slow run stops cleanly BEFORE the platform kills it, rather than
// dying mid-way and leaving the tail permanently cold. Whatever the budget skips fills in lazily on
// first request and then caches. Active roster only ("all" + ACTIVE_CREATORS); retired creators are
// near-empty and fill lazily. Never silently caps: returns computed/failed/skipped and logs the tail.
export async function refreshStandardWindows(
  budgetMs = 90000,
  startOffset = 0,
): Promise<{ computed: number; failed: number; skipped: number; ms: number; jobs: number }> {
  const today = todayEt();
  const monthStart = today.slice(0, 7) + "-01";
  const d7 = shift(today, -6), d30 = shift(today, -29);
  const CREATORS: AdsTrackerAccount[] = ["all", ...ACTIVE_CREATORS.map((c) => c.key)];
  const jobs: SnapQuery[] = [];
  // The tab only ever requests level=ad, status=all (loadDashboard + the prefetch both hardcode it;
  // the campaign / ad-set views are derived client-side from the ad rows). So the warm matrix is
  // EXACTLY that surface and nothing else: the campaign/active windows the old matrix warmed were never
  // requested and only burned budget - dropping them removes the deferral tail (and the ~75s
  // campaign/active outlier) from the warm path. A bare campaign request (route default) or a custom
  // range is rare and computes fast on-miss (fast-engine paint) instead of being pre-warmed.
  // Presets the UI exposes: today, last 7, last 30, month-to-date - the exact ranges rangeForPreset
  // produces - per account, most-hit first so an early budget cut never drops a common view.
  const preset = (from: string, to: string = today) => ({ from, to });
  const PRESETS = [preset(d7), preset(d30), preset(monthStart), preset(today, today)];
  for (const p of PRESETS)
    for (const account of CREATORS)
      jobs.push({ account, status: "all", level: "ad", dateFrom: p.from, dateTo: p.to });
  // The PRIOR week (non-overlapping trailing-7 ending 7 days ago) so business_snapshot can populate its
  // prior_window comparison. Ad-level, status=all, same as everything else UTARI / business_snapshot read.
  const priorFrom = shift(today, -13), priorTo = shift(today, -7);
  for (const account of CREATORS)
    jobs.push({ account, status: "all", level: "ad", dateFrom: priorFrom, dateTo: priorTo });

  // These wide ad-level windows are genuinely slow to compute against Supabase (~15-27s each in prod),
  // so a single run may not finish all of them under its budget. Rotating the start point by an offset
  // the caller varies each run (e.g. the clock hour) means a window that gets deferred this run is at
  // the FRONT next run - so no preset is ever perpetually cold, instead of the first-N always warming
  // and the tail always deferring. Whatever a run does not reach still fills in fast on first hit.
  const off = jobs.length ? ((startOffset % jobs.length) + jobs.length) % jobs.length : 0;
  const ordered = off ? jobs.slice(off).concat(jobs.slice(0, off)) : jobs;

  const start = Date.now();
  let computed = 0, failed = 0, skipped = 0;
  for (let i = 0; i < ordered.length; i++) {
    if (Date.now() - start > budgetMs) { skipped = ordered.length - i; break; }
    try { await computeAndStore(ordered[i]); computed++; } catch { failed++; }
  }
  if (skipped) {
    const dropped = ordered.slice(ordered.length - skipped).map((q) => `${q.account}/${q.level}/${q.status}/${q.dateFrom}`);
    console.log(`[refreshStandardWindows] budget ${budgetMs}ms hit; ${skipped} of ${jobs.length} windows deferred (rotate offset ${off}); fill fast on first hit:`, dropped.join(", "));
  } else {
    console.log(`[refreshStandardWindows] warmed all ${jobs.length} windows in ${Date.now() - start}ms, zero deferrals`);
  }
  return { computed, failed, skipped, ms: Date.now() - start, jobs: jobs.length };
}
