/**
 * Phase B6a — cron worker that drains pending nutrition_plan_jobs.
 *
 * Runs every minute via vercel.json. Authenticated by CRON_SECRET. Picks
 * up to N pending jobs and processes them sequentially. Each pipeline
 * run takes ~30s; with maxDuration=300 we have headroom for ~8 jobs per
 * tick. Conservative cap: 3.
 *
 * Job-claim race condition handled by an atomic UPDATE...RETURNING that
 * transitions pending→running with a CHECK on the prior status. Concurrent
 * cron invocations (Vercel can occasionally double-fire) won't double-claim.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { runPipeline } from "@/lib/nutrition/v2/pipeline/run-pipeline";
import type { JobRequestInputs, PipelineResult } from "@/lib/nutrition/v2/pipeline/types";
import { PipelineCancelledError } from "@/lib/nutrition/v2/pipeline/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_JOBS_PER_TICK = 3;

export async function GET(req: NextRequest) {
  // ---- Auth: CRON_SECRET ----
  const header = req.headers.get("authorization") || req.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (expected && header !== `Bearer ${expected}` && header !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY not configured on this environment" },
      { status: 500 },
    );
  }

  const db = getServiceSupabase();
  const tickStart = Date.now();
  const processed: Array<{
    jobId: number;
    result: "success" | "failure" | "cancelled" | "claim_lost";
    error_kind?: string;
    elapsed_ms: number;
  }> = [];

  for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
    // ---- Atomic claim: pending → running ----
    const claim = await claimNextJob(db);
    if (!claim) break; // queue empty
    const { jobId, inputs } = claim;
    const jobStart = Date.now();

    try {
      const result: PipelineResult = await runPipeline({
        db,
        job_id: jobId,
        inputs,
        anthropic_api_key: apiKey,
        on_step: async (step) => {
          // Update current_step + check for cancellation
          const { data } = await db
            .from("nutrition_plan_jobs")
            .update({ current_step: step })
            .eq("id", jobId)
            .select("status")
            .single();
          const status = (data as { status?: string } | null)?.status;
          if (status === "cancelled") {
            throw new PipelineCancelledError();
          }
        },
      });

      if (result.kind === "success") {
        await db
          .from("nutrition_plan_jobs")
          .update({
            status: "complete",
            current_step: null,
            plan_id: result.plan_id,
            pdf_path: result.pdf_path,
            pdf_signed_url: result.pdf_signed_url,
            audit_summary: result.audit,
            generation_diagnostics: result.diagnostics ?? null,
            worker_finished_at: new Date().toISOString(),
            error_kind: null,
            error_details: null,
          })
          .eq("id", jobId);
        processed.push({ jobId, result: "success", elapsed_ms: Date.now() - jobStart });
      } else {
        // Failure (including audit_blocked which DID persist a plan row)
        await db
          .from("nutrition_plan_jobs")
          .update({
            status: result.error_kind === "cancelled" ? "cancelled" : "failed",
            current_step: null,
            plan_id: result.plan_id ?? null,
            audit_summary: result.audit ?? null,
            generation_diagnostics: result.diagnostics ?? null,
            error_kind: result.error_kind,
            error_details: result.error_details,
            worker_finished_at: new Date().toISOString(),
          })
          .eq("id", jobId);
        processed.push({
          jobId,
          result: result.error_kind === "cancelled" ? "cancelled" : "failure",
          error_kind: result.error_kind,
          elapsed_ms: Date.now() - jobStart,
        });
      }
    } catch (e) {
      // Pipeline shouldn't throw — runPipeline catches everything — but
      // if some unhandled path escapes, mark the job failed cleanly.
      const msg = e instanceof Error ? e.message : String(e);
      await db
        .from("nutrition_plan_jobs")
        .update({
          status: "failed",
          current_step: null,
          error_kind: "unexpected",
          error_details: { message: msg },
          worker_finished_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      processed.push({
        jobId,
        result: "failure",
        error_kind: "unexpected",
        elapsed_ms: Date.now() - jobStart,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    tick_elapsed_ms: Date.now() - tickStart,
    processed,
    drained: processed.length,
  });
}

export const POST = GET;

// ============================================================================
// Atomic job claim
// ============================================================================

interface ClaimedJob {
  jobId: number;
  inputs: JobRequestInputs;
}

/**
 * Atomically transition the oldest pending job to running. Returns null
 * if the queue is empty or another worker beat us to the claim.
 *
 * Two-step protocol:
 *   1. SELECT the oldest pending row's id
 *   2. UPDATE WHERE id = X AND status = 'pending' → running, RETURNING ...
 *
 * The WHERE clause guards against a concurrent claim (another worker
 * already transitioned that row out of 'pending' between our SELECT and
 * UPDATE). If 0 rows update, we loop back and try the next row.
 */
async function claimNextJob(
  db: ReturnType<typeof getServiceSupabase>,
): Promise<ClaimedJob | null> {
  // Try up to 5 candidate rows in case of contention
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: candidates, error: selErr } = await db
      .from("nutrition_plan_jobs")
      .select("id, inputs")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(1);
    if (selErr) {
      console.error("[nutrition-plan-drain] candidate select failed", selErr);
      return null;
    }
    const arr = (candidates as Array<{ id: number; inputs: unknown }> | null) ?? [];
    if (arr.length === 0) return null;

    const candidateId = arr[0].id;
    const { data: claimed, error: claimErr } = await db
      .from("nutrition_plan_jobs")
      .update({
        status: "running",
        worker_started_at: new Date().toISOString(),
        attempts: 1, // first run; retries handled by re-enqueueing manually for now
      })
      .eq("id", candidateId)
      .eq("status", "pending")
      .select("id, inputs")
      .single();

    if (claimErr) {
      // Another worker won the race — try the next candidate
      continue;
    }
    if (!claimed) continue;
    return {
      jobId: (claimed as { id: number }).id,
      inputs: (claimed as { inputs: JobRequestInputs }).inputs,
    };
  }
  return null;
}
