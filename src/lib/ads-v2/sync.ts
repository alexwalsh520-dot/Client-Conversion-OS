// ─────────────────────────────────────────────────────────────────────────
// SYNC ORCHESTRATOR — the one background job the cron calls. In order:
//   1. Snapshot today's Meta budget settings (the only new external fetch).
//   2. Run the deterministic facts pass over the rolling window.
//   3. Bump the data version (invalidates cached snapshots).
//   4. Precompute the standard matrix so the page opens instantly.
//
// Each source runs isolated: budget failing never blocks facts, and facts is
// what the version bump depends on, so a facts failure leaves the last good
// snapshots served (stale, never corrupt). A lightweight lock prevents two runs
// from overlapping.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { runBudgetSnapshot } from "./budget-sync";
import { runFactsPass } from "./facts";
import { runMediaSync } from "./media-sync";
import { runActivitySync } from "./activity-sync";
import { precomputeStandard } from "./precompute";
import { todayEt } from "./time";
import { bumpDataVersion, type Db } from "./db";

const LOCK_KEY = "sync_lock";
const LOCK_TTL_MS = 10 * 60 * 1000;

/**
 * Run one optional sync step under its OWN wall-clock budget, and never let it
 * hurt anything else. A step that hangs is abandoned; a step that throws is
 * recorded. Either way the failure lands in adsv2_alerts and the sync carries
 * on to the next step.
 *
 * This exists because of a real outage: the content pipeline was a 12-step
 * chain with no per-step timeout, so one slow step blew the whole function's
 * limit and silently killed every later step for 9 days. No step added here
 * can ever do that to the spend sync.
 */
async function runIsolatedStep<T>(
  db: Db,
  name: string,
  budgetMs: number,
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} exceeded its ${Math.round(budgetMs / 1000)}s budget`)),
          budgetMs,
        );
      }),
    ]);
    return { ok: true, value };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db.from("adsv2_alerts").upsert(
        {
          et_day: todayEt(),
          alert_type: "sync_step_failed",
          client_key: null,
          severity: "error",
          dedupe_key: `sync_step|${name}|${todayEt()}`,
          detail: { step: name, error: message, ms: Date.now() - started } as object,
        },
        { onConflict: "dedupe_key" },
      );
    } catch {
      // Alerting must never itself break the sync.
    }
    return { ok: false, error: message };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function acquireLock(db: Db): Promise<boolean> {
  const nowMs = Date.now();
  const { data } = await db.from("adsv2_meta").select("value").eq("key", LOCK_KEY).maybeSingle();
  const held = data?.value as { at?: number } | undefined;
  if (held?.at && nowMs - held.at < LOCK_TTL_MS) return false; // someone is running
  await db
    .from("adsv2_meta")
    .upsert(
      { key: LOCK_KEY, value: { at: nowMs } as unknown as object, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return true;
}

async function releaseLock(db: Db): Promise<void> {
  await db
    .from("adsv2_meta")
    .upsert(
      { key: LOCK_KEY, value: { at: 0 } as unknown as object, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
}

export interface SyncResult {
  ran: boolean;
  budget?: unknown;
  budgetError?: string;
  facts?: unknown;
  factsError?: string;
  version?: number;
  precompute?: unknown;
  media?: unknown;
  mediaError?: string;
  activity?: unknown;
  activityError?: string;
}

export async function runAdsV2Sync(now: Date = new Date()): Promise<SyncResult> {
  const db = getServiceSupabase();
  if (!(await acquireLock(db))) return { ran: false };

  const result: SyncResult = { ran: true };
  try {
    // 1. Budget (isolated).
    try {
      result.budget = await runBudgetSnapshot(now);
    } catch (err) {
      result.budgetError = err instanceof Error ? err.message : String(err);
    }

    // 2. Facts (the source the version bump depends on).
    try {
      result.facts = await runFactsPass(now);
    } catch (err) {
      result.factsError = err instanceof Error ? err.message : String(err);
      // Do NOT bump the version or precompute on a facts failure — keep serving
      // the last good snapshots rather than half-built ones.
      return result;
    }

    // 3. Invalidate caches.
    result.version = await bumpDataVersion(db);

    // 4. Warm the standard matrix.
    result.precompute = await precomputeStandard(now);

    // 5. Video media (isolated + budgeted). Downloads active video ads' durable
    //    thumbnail + video file into our storage. Best-effort: a failure here
    //    never affects the numbers already served, and it resumes next run.
    try {
      result.media = await runMediaSync(now);
    } catch (err) {
      result.mediaError = err instanceof Error ? err.message : String(err);
    }

    // 6. Ad change log (isolated + budgeted). Appends anything that was turned
    //    on, turned off, created, or re-budgeted since the last run. Reads
    //    Meta's activity feed only; it writes nothing the numbers depend on, so
    //    a slow or throttled Meta can never delay or corrupt spend.
    const activity = await runIsolatedStep(db, "activity_sync", 90_000, () => runActivitySync(now));
    if (activity.ok) result.activity = activity.value;
    else result.activityError = activity.error;

    return result;
  } finally {
    await releaseLock(db);
  }
}
