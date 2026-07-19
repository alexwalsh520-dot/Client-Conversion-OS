// Sequential pipeline runner that CANNOT be starved: every step has its own timeout, so one slow or
// hanging step can never consume the whole function budget and freeze the rest (the exact failure that
// killed the content pipeline for 9 days). Runs under a total wall-clock budget so the function returns
// before the platform kills it, and logs every run (per-step status + duration) to content_pipeline_runs.
// Best-effort: a step that fails or times out is recorded and the chain continues.
import { getServiceSupabase } from "@/lib/supabase";
import { getIngestHeartbeat } from "@/lib/content/ingest-heartbeat";
import { postToSlack, getSalesManagerChannel } from "@/lib/slack";

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
      // A child can answer 2xx and still have failed: the ingest route returns 207 (and
      // fetch().ok is true for 207) with body.ok=false, which is how a dead ingest passed as
      // green. Trust the body's own verdict when it gives one.
      const bodyOk = body && typeof (body as { ok?: unknown }).ok === "boolean" ? (body as { ok: boolean }).ok : true;
      results.push({ path: step.path, status: r.status, ms: Date.now() - s, ok: r.ok && bodyOk, body });
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

// Freshness guard: alert when a polled source is genuinely behind.
//
// This used to measure max(created_at) on creator_content, which only advances when a NEW post is
// inserted — so it screamed "26.9h stale" through a weekend where the pipeline ran fine every 2h and
// the creator simply hadn't posted. It also only ever wrote a DB row nobody reads, which is why a
// real incident was found in the UI instead of in Slack. Now: creator_content freshness is judged by
// the INGEST HEARTBEAT (did a run actually succeed), and a genuine stall also posts to Slack, with a
// cooldown so it nags once per window rather than every two hours.
export async function checkPolledFreshness(): Promise<Array<{ source: string; hours_stale: number }>> {
  const sb = getServiceSupabase();
  const now = Date.now();
  const top = (p: PromiseLike<{ data: Record<string, unknown>[] | null }>, col: string) =>
    Promise.resolve(p).then((r) => (r.data && r.data[0] ? (r.data[0] as Record<string, unknown>)[col] : null));
  const [fathom, heartbeat] = await Promise.all([
    top(sb.from("fathom_calls").select("created_at").order("created_at", { ascending: false }).limit(1), "created_at"),
    getIngestHeartbeat(sb),
  ]);
  const checks = [
    { source: "fathom_calls", last: fathom },
    // NOT max(created_at): the heartbeat is "the ingest last ran and succeeded", so a quiet creator
    // never trips this and a dead pipeline always does.
    { source: "creator_content", last: heartbeat.last_ok_at },
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
  if (alertRows.length) {
    try { await sb.from("source_freshness_alerts").insert(alertRows); } catch { /* best-effort */ }
    await notifyStaleSources(sb, stale);
  }
  return stale;
}

// Post a stale-source alert to Slack, at most once per COOLDOWN_H per source. The cooldown is read
// from the alert rows we just wrote, so no extra table is needed: if we already alerted for this
// source inside the window, stay quiet.
const COOLDOWN_H = 12;

async function notifyStaleSources(
  sb: ReturnType<typeof getServiceSupabase>,
  stale: Array<{ source: string; hours_stale: number }>,
): Promise<void> {
  const channel = getSalesManagerChannel();
  if (!channel) return;
  const since = new Date(Date.now() - COOLDOWN_H * 3600000).toISOString();
  for (const s of stale) {
    try {
      // notified_at is set only when a Slack post actually goes out, so a crash mid-loop can't
      // silence the next run.
      const { data: recent } = await sb
        .from("source_freshness_alerts")
        .select("id")
        .eq("source", s.source)
        .gt("notified_at", since)
        .limit(1);
      if (recent && recent.length) continue; // already shouted about this one recently

      const what =
        s.source === "creator_content"
          ? "Instagram ingest has not completed successfully"
          : `${s.source} has received no new data`;
      const posted = await postToSlack(
        channel,
        `:rotating_light: *Pipeline stalled* — ${what} for *${s.hours_stale}h*.\n` +
          `The Content Calendar will show unverified (not missed) slots until this recovers.`,
      );
      if (posted) {
        await sb
          .from("source_freshness_alerts")
          .update({ notified_at: new Date().toISOString() })
          .eq("source", s.source)
          .is("notified_at", null);
      }
    } catch { /* alerting must never break the pipeline */ }
  }
}
