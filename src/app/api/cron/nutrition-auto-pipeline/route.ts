/**
 * POST /api/cron/nutrition-auto-pipeline
 *   ?run=<runId>   — per-run mode: process a single queued pipeline_run
 *   (no run param) — scan mode: find eligible clients, queue rows,
 *                    self-fire one fetch per queued run so they
 *                    process in parallel across separate lambda
 *                    invocations
 *
 * Authentication: x-vercel-cron header (auto for scheduled runs) OR
 * Bearer CRON_SECRET (manual trigger / self-fire). Same pattern as
 * other CCOS crons.
 *
 * Eligibility for the scan: clients where
 *   - nutrition_status = 'pending'
 *   - nutrition_form_id IS NOT NULL (intake form linked)
 *   - now - onboarding_date > 2 days (i.e. age >= 3 days)
 *   - no in-progress pipeline_run for this client in the last hour
 *     (idempotency — prevents double-queueing if cron fires fast)
 *
 * Cap: MAX_PLANS_PER_RUN clients queued per invocation.
 *
 * Self-fire: each queued runId becomes a fetch() to the same route
 * with ?run=<id>. Each fetch lands in a separate Vercel lambda that
 * runs processAndDispatch (worker → ship → post to nutritiontalk).
 * This parallelizes 5 plans into 5 parallel lambdas instead of one
 * serial 20-minute marathon.
 *
 * For the per-run mode, the actual work runs in `after()` so the
 * request returns immediately and the lambda has its full
 * maxDuration (300s) to finish.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { processAndDispatch } from "@/lib/nutrition/process-and-dispatch";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_PLANS_PER_RUN = 5;
const ELIGIBILITY_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000; // ≥ 3 days
const DEDUPE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(
    process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`,
  );
}

// POST and GET both work — GET is convenient for manual browser
// testing; POST is what the self-fire uses.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  return handle(req);
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const runParam = req.nextUrl.searchParams.get("run");
  if (runParam) {
    const runId = parseInt(runParam, 10);
    if (!Number.isFinite(runId) || runId <= 0) {
      return NextResponse.json({ error: "invalid run id" }, { status: 400 });
    }
    // Process this one run via after() — same pattern as the admin
    // test endpoint, but with the cron_auto dispatch path.
    after(async () => {
      try {
        await processAndDispatch(runId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[cron/nutrition-auto-pipeline ?run=${runId}] threw:`, msg);
      }
    });
    return NextResponse.json({ ok: true, mode: "per-run", runId });
  }

  // Scan mode
  return await scanAndDispatch(req);
}

async function scanAndDispatch(req: NextRequest): Promise<NextResponse> {
  const db = getServiceSupabase();

  // Eligible: pending status + linked intake + onboarded ≥3 days ago
  const threshold = new Date(Date.now() - ELIGIBILITY_MIN_AGE_MS).toISOString();
  const { data: eligibleClients, error: eligErr } = await db
    .from("clients")
    .select("id, name, onboarding_date, nutrition_form_id, nutrition_status")
    .eq("nutrition_status", "pending")
    .not("nutrition_form_id", "is", null)
    .not("onboarding_date", "is", null)
    .lte("onboarding_date", threshold)
    .order("onboarding_date", { ascending: true });

  if (eligErr) {
    return NextResponse.json(
      { error: `eligible scan failed: ${eligErr.message}` },
      { status: 500 },
    );
  }

  const candidates = (eligibleClients ?? []) as Array<{
    id: number;
    name: string;
  }>;

  // Dedupe: skip clients with an in-progress run in the last hour.
  const recentThreshold = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
  const { data: recentRuns } = await db
    .from("nutrition_pipeline_runs")
    .select("client_id, status, queued_at")
    .in("status", ["queued", "running"])
    .gte("queued_at", recentThreshold);
  const blockedClientIds = new Set(
    (recentRuns ?? []).map((r) => r.client_id as number),
  );

  const toQueue = candidates
    .filter((c) => !blockedClientIds.has(c.id))
    .slice(0, MAX_PLANS_PER_RUN);

  const triggeredBy =
    req.headers.get("x-vercel-cron") === "true" ? "vercel-cron" : "manual";
  const queuedIds: number[] = [];
  for (const c of toQueue) {
    const { data: row } = await db
      .from("nutrition_pipeline_runs")
      .insert({
        client_id: c.id,
        client_name: c.name,
        trigger_type: "cron_auto",
        triggered_by: triggeredBy,
        status: "queued",
      })
      .select("id")
      .single();
    if (row?.id) queuedIds.push(row.id as number);
  }

  // Self-fire: one parallel lambda per queued run. The fetches don't
  // get awaited; we kick them off and return so the scan lambda can
  // exit immediately.
  const selfBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    `https://${req.headers.get("host") ?? "client-conversion-os.vercel.app"}`;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    for (const runId of queuedIds) {
      const url = `${selfBaseUrl}/api/cron/nutrition-auto-pipeline?run=${runId}`;
      // Fire and forget — DO NOT await
      fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${cronSecret}` },
      }).catch((err) => {
        console.warn(`[cron/nutrition-auto-pipeline] self-fire failed for run ${runId}:`, err);
      });
    }
  } else {
    console.warn(
      "[cron/nutrition-auto-pipeline] CRON_SECRET not set; queued rows but cannot self-fire. Rows will sit in 'queued' state.",
    );
  }

  return NextResponse.json({
    ok: true,
    mode: "scan",
    eligibleCount: candidates.length,
    blockedByRecentRun: candidates.length - toQueue.length - Math.max(0, candidates.length - MAX_PLANS_PER_RUN - blockedClientIds.size),
    queuedCount: queuedIds.length,
    queuedRunIds: queuedIds,
    capPerRun: MAX_PLANS_PER_RUN,
    message:
      queuedIds.length > 0
        ? `Queued ${queuedIds.length} plan(s). They'll process in parallel; PDFs land in #nutritiontalk in 3-5 minutes.`
        : candidates.length === 0
          ? "No eligible clients (none pending + day-3+)."
          : "Eligible clients found but all blocked by recent in-progress runs. Try again in an hour.",
  });
}
