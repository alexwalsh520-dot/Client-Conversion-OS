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

// Serve: snapshot first, compute-once-and-store on a miss.
export async function serveDashboard(q: SnapQuery): Promise<Record<string, unknown>> {
  const hit = await readSnapshot(q);
  if (hit) return hit;
  return computeAndStore(q);
}

// The standard windows the tab loads. Bounded so the cron finishes well inside its limit;
// everything else is filled lazily on first request. Runs sequentially (concurrent dashboards
// contend on the DB).
export async function refreshStandardWindows(): Promise<{ computed: number; failed: number; ms: number }> {
  const today = todayEt();
  const monthStart = today.slice(0, 7) + "-01";
  // Lean, reliable set that finishes well inside a single request/cron window. Everything else
  // (other windows, ad level, per-creator month) fills in lazily on first request, then caches.
  const jobs: SnapQuery[] = [
    { account: "all", status: "active", level: "campaign", dateFrom: shift(today, -6), dateTo: today },
    { account: "all", status: "active", level: "campaign", dateFrom: monthStart, dateTo: today },
    { account: "tyson", status: "active", level: "campaign", dateFrom: shift(today, -6), dateTo: today },
    { account: "antwan", status: "active", level: "campaign", dateFrom: shift(today, -6), dateTo: today },
    // Keep a trailing-7 AD-LEVEL snapshot warm per creator so the UTARI MCP always has a fresh,
    // canonical per-ad funnel to read (status "all" so paused ads are included). Bounded window
    // keeps compute well under the DB statement timeout.
    { account: "tyson", status: "all", level: "ad", dateFrom: shift(today, -6), dateTo: today },
    { account: "antwan", status: "all", level: "ad", dateFrom: shift(today, -6), dateTo: today },
  ];
  const start = Date.now();
  let computed = 0, failed = 0;
  for (const q of jobs) {
    try { await computeAndStore(q); computed++; } catch { failed++; }
  }
  return { computed, failed, ms: Date.now() - start };
}
