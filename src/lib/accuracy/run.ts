// ─────────────────────────────────────────────────────────────────────────
// THE RUNNER — runs every check in ISOLATION and records the result.
//
// The law this file exists to keep: one broken check must show up as its own
// red or errored row and must never stop the other checks running or the run
// being recorded. The content pipeline died silently for 9 days in July 2026
// because one slow step in an unguarded chain blew the whole function's limit.
// Every check here has its own wall-clock budget and its own try/catch, and a
// failure to record one row never blocks the rest.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";
import { todayEt } from "@/lib/ads-v2/time";
import { startRun, finishRun } from "@/lib/ads-v2/db";
import { ACCURACY_CHECKS } from "./checks";
import type { AccuracyCheck, CheckContext, CheckStatus, Db, StoredCheckRow } from "./types";

export interface AccuracyRunResult {
  runId: string;
  etDay: string;
  rows: StoredCheckRow[];
  counts: Record<CheckStatus, number>;
  recorded: number;
}

/** Run one check under its own budget. A throw or a hang becomes an error row. */
async function runOne(
  check: AccuracyCheck,
  ctx: CheckContext,
  runId: string,
): Promise<StoredCheckRow> {
  const base = {
    run_id: runId,
    et_day: ctx.etDay,
    check_key: check.key,
    plain_english_name: check.name,
    tolerance_note: check.toleranceNote,
    ran_at: new Date().toISOString(),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      check.run(ctx),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${check.key} exceeded its ${Math.round(check.budgetMs / 1000)}s budget`)),
          check.budgetMs,
        );
      }),
    ]);
    return {
      ...base,
      status: outcome.status,
      left_label: outcome.leftLabel ?? null,
      left_value: outcome.leftValue ?? null,
      right_label: outcome.rightLabel ?? null,
      right_value: outcome.rightValue ?? null,
      diff_value: outcome.diffValue ?? null,
      what_to_do: outcome.whatToDo ?? null,
      detail: outcome.detail ?? {},
      ran_at: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: "error",
      left_label: "this check could not run",
      left_value: message.slice(0, 200),
      right_label: null,
      right_value: null,
      diff_value: null,
      what_to_do:
        "This check itself broke, so it proved nothing today. The other checks still ran. Look at the error text, then run it again.",
      detail: { error: message },
      ran_at: new Date().toISOString(),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runAccuracyChecks(
  now: Date = new Date(),
  opts: { db?: Db; checks?: readonly AccuracyCheck[]; clients?: string[]; runId?: string } = {},
): Promise<AccuracyRunResult> {
  const db = opts.db ?? getServiceSupabase();
  const checks = opts.checks ?? ACCURACY_CHECKS;
  const etDay = todayEt(now);
  const runId = opts.runId ?? globalThis.crypto.randomUUID();
  const clients = opts.clients ?? [...ADSV2_SERVED_CLIENTS];
  const ctx: CheckContext = { db, now, etDay, clients };

  const syncRunId = await startRun(db, "accuracy").catch(() => null);
  const started = Date.now();

  // Sequential on purpose: these are heavy set-based reads and the database is
  // the same one the tab serves from. Isolation comes from the per-check budget
  // and try/catch, not from running them at the same time.
  const rows: StoredCheckRow[] = [];
  for (const check of checks) {
    rows.push(await runOne(check, ctx, runId));
  }

  const counts: Record<CheckStatus, number> = { green: 0, amber: 0, red: 0, error: 0 };
  for (const r of rows) counts[r.status]++;

  // Record the measurements. A failure to write must not lose the run, so it is
  // reported rather than thrown.
  let recorded = 0;
  try {
    const { data, error } = await db.rpc("warehouse_accuracy_record", {
      p_rows: rows as unknown as object,
    });
    if (error) throw new Error(error.message);
    recorded = Number(data ?? 0);
  } catch (err) {
    await finishRun(db, syncRunId, {
      status: "error",
      durationMs: Date.now() - started,
      error: `could not record accuracy rows: ${err instanceof Error ? err.message : String(err)}`,
      detail: counts,
    }).catch(() => {});
    return { runId, etDay, rows, counts, recorded: 0 };
  }

  // Every red or errored check raises an alert on the path that already exists.
  const alerts = rows.filter((r) => r.status === "red" || r.status === "error");
  if (alerts.length) {
    try {
      await db.from("adsv2_alerts").upsert(
        alerts.map((r) => ({
          et_day: r.et_day,
          alert_type: `accuracy_${r.status}`,
          client_key: null,
          severity: "error",
          dedupe_key: `accuracy|${r.check_key}|${r.et_day}`,
          detail: {
            check: r.check_key,
            name: r.plain_english_name,
            left: `${r.left_label}: ${r.left_value}`,
            right: `${r.right_label}: ${r.right_value}`,
            whatToDo: r.what_to_do,
          } as object,
        })),
        { onConflict: "dedupe_key" },
      );
    } catch {
      // Alerting must never break the run that already recorded its truth.
    }
  }

  await finishRun(db, syncRunId, {
    status: counts.red + counts.error > 0 ? "error" : "ok",
    rows: rows.length,
    durationMs: Date.now() - started,
    detail: counts,
  }).catch(() => {});

  return { runId, etDay, rows, counts, recorded };
}
