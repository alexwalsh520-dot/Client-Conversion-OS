// Sequential pipeline runner that CANNOT be starved: every step has its own timeout, so one slow or
// hanging step can never consume the whole function budget and freeze the rest (the exact failure that
// killed the content pipeline for 9 days). Runs under a total wall-clock budget so the function returns
// before the platform kills it, and logs every run (per-step status + duration) to content_pipeline_runs.
// Best-effort: a step that fails or times out is recorded and the chain continues.
import { getServiceSupabase } from "@/lib/supabase";

export type PipelineStep = { path: string; timeoutMs?: number };

export async function runPipelineSteps(
  cronName: string,
  origin: string,
  steps: PipelineStep[],
  opts: { budgetMs?: number; defaultStepTimeoutMs?: number } = {},
) {
  const budgetMs = opts.budgetMs ?? 240000;
  const defTimeout = opts.defaultStepTimeoutMs ?? 55000;
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };
  const started = Date.now();
  const results: Array<Record<string, unknown>> = [];

  for (const step of steps) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining <= 3000) {
      results.push({ path: step.path, skipped: true, reason: "run budget exhausted" });
      continue;
    }
    const timeoutMs = Math.min(step.timeoutMs ?? defTimeout, remaining - 1000);
    const s = Date.now();
    try {
      const r = await fetch(`${origin}${step.path}`, { method: "POST", headers: H, signal: AbortSignal.timeout(timeoutMs) });
      const body = await r.json().catch(() => null);
      results.push({ path: step.path, status: r.status, ms: Date.now() - s, ok: r.ok, body });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      results.push({ path: step.path, ms: Date.now() - s, ok: false, error: timedOut ? `timeout after ${timeoutMs}ms` : e instanceof Error ? e.message : "failed" });
    }
  }

  const totalMs = Date.now() - started;
  const ok = results.every((r) => r.ok === true || r.skipped === true);
  try {
    await getServiceSupabase().from("content_pipeline_runs").insert({ cron_name: cronName, total_ms: totalMs, ok, steps: results });
  } catch { /* logging is best-effort, never fatal */ }
  return { ok, cron: cronName, ranAt: new Date(started).toISOString(), total_ms: totalMs, steps: results };
}

// Freshness guard: write an alert row for any polled source (fathom_calls, creator_content) whose newest
// data is more than 24h old, so a dead poller can never again go unnoticed for days. Webhook-fed sources
// are intentionally excluded (they don't depend on the cron). Returns the stale sources it found.
export async function checkPolledFreshness(): Promise<Array<{ source: string; hours_stale: number }>> {
  const sb = getServiceSupabase();
  const now = Date.now();
  const top = (p: PromiseLike<{ data: Record<string, unknown>[] | null }>, col: string) =>
    Promise.resolve(p).then((r) => (r.data && r.data[0] ? (r.data[0] as Record<string, unknown>)[col] : null));
  const [fathom, content] = await Promise.all([
    top(sb.from("fathom_calls").select("created_at").order("created_at", { ascending: false }).limit(1), "created_at"),
    top(sb.from("creator_content").select("created_at").order("created_at", { ascending: false }).limit(1), "created_at"),
  ]);
  const checks = [
    { source: "fathom_calls", last: fathom },
    { source: "creator_content", last: content },
  ];
  const stale: Array<{ source: string; hours_stale: number }> = [];
  const alertRows: Record<string, unknown>[] = [];
  for (const c of checks) {
    if (!c.last) continue;
    const hours = Math.round(((now - new Date(String(c.last)).getTime()) / 3600000) * 10) / 10;
    if (hours > 24) {
      stale.push({ source: c.source, hours_stale: hours });
      alertRows.push({ source: c.source, last_data_at: c.last, hours_stale: hours });
    }
  }
  if (alertRows.length) { try { await sb.from("source_freshness_alerts").insert(alertRows); } catch { /* best-effort */ } }
  return stale;
}
