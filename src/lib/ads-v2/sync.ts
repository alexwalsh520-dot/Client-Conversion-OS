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
import { precomputeStandard } from "./precompute";
import { bumpDataVersion, type Db } from "./db";

const LOCK_KEY = "sync_lock";
const LOCK_TTL_MS = 10 * 60 * 1000;

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

    return result;
  } finally {
    await releaseLock(db);
  }
}
