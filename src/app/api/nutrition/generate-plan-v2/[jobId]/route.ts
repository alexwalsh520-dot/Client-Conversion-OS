/**
 * Phase B6a — GET /api/nutrition/generate-plan-v2/:jobId
 *
 * Returns the current state of a job for the polling UI. Re-signs the
 * PDF storage URL on success (the stored signed URL has a 2hr TTL — we
 * re-issue on every poll so the URL the UI sees is always fresh).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { auth } from "@/auth";

export const runtime = "nodejs";
export const maxDuration = 10;

interface JobRow {
  id: number;
  client_id: number;
  status: "pending" | "running" | "complete" | "failed" | "cancelled";
  current_step: string | null;
  inputs: unknown;
  plan_id: number | null;
  pdf_path: string | null;
  pdf_signed_url: string | null;
  audit_summary: unknown;
  error_kind: string | null;
  error_details: unknown;
  attempts: number;
  worker_started_at: string | null;
  worker_finished_at: string | null;
  generation_diagnostics: unknown;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { jobId: jobIdRaw } = await ctx.params;
  const jobId = parseInt(jobIdRaw, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("nutrition_plan_jobs")
    .select("*")
    .eq("id", jobId)
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }
  const job = data as JobRow;

  // Re-sign the PDF URL if the job is complete and has a path.
  let freshSignedUrl: string | null = null;
  if (job.status === "complete" && job.pdf_path) {
    const { data: signed } = await db.storage
      .from("nutrition-plans")
      .createSignedUrl(job.pdf_path, 60 * 60 * 2);
    freshSignedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;
  }

  return NextResponse.json({
    job: {
      id: job.id,
      client_id: job.client_id,
      status: job.status,
      current_step: job.current_step,
      inputs: job.inputs,
      plan_id: job.plan_id,
      pdf_path: job.pdf_path,
      pdf_signed_url: freshSignedUrl ?? job.pdf_signed_url,
      audit_summary: job.audit_summary,
      error_kind: job.error_kind,
      error_details: job.error_details,
      attempts: job.attempts,
      worker_started_at: job.worker_started_at,
      worker_finished_at: job.worker_finished_at,
      generation_diagnostics: job.generation_diagnostics,
      cancelled_at: job.cancelled_at,
      created_at: job.created_at,
      updated_at: job.updated_at,
    },
  });
}

/**
 * DELETE — cancel a pending or running job. Worker checks status between
 * stages and aborts cleanly when it sees 'cancelled'.
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { jobId: jobIdRaw } = await ctx.params;
  const jobId = parseInt(jobIdRaw, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "invalid jobId" }, { status: 400 });
  }
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("nutrition_plan_jobs")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", jobId)
    .in("status", ["pending", "running"])
    .select("id, status")
    .single();
  if (error) {
    return NextResponse.json(
      { error: `cancel failed: ${error.message}` },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "job not in pending/running state — cannot cancel" },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true, jobId, status: "cancelled" });
}
