/**
 * Phase B6b — GET /api/nutrition/v2/jobs/:job_id
 * Phase B6b — DELETE /api/nutrition/v2/jobs/:job_id  (cancel)
 *
 * Polling endpoint for the Coach UI's job-progress display. Returns the
 * current pipeline stage + terminal status + plan_id (when complete) +
 * fresh signed PDF URL (when complete). Mirrors the existing legacy v2
 * endpoint at /api/nutrition/generate-plan-v2/[jobId] but at the path
 * the new UI expects.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

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
  _req: NextRequest,
  ctx: { params: Promise<{ job_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job_id: jobIdRaw } = await ctx.params;
  const jobId = parseInt(jobIdRaw, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "invalid job_id" }, { status: 400 });
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

  let freshSignedUrl: string | null = null;
  if (job.status === "complete" && job.pdf_path) {
    const { data: signed } = await db.storage
      .from("nutrition-plans")
      .createSignedUrl(job.pdf_path, 60 * 60 * 2);
    freshSignedUrl = (signed as { signedUrl?: string } | null)?.signedUrl ?? null;
  }

  return NextResponse.json({
    job_id: job.id,
    client_id: job.client_id,
    status: job.status,
    current_step: job.current_step,
    plan_id: job.plan_id,
    pdf_signed_url: freshSignedUrl ?? job.pdf_signed_url,
    error_kind: job.error_kind,
    error_details: job.error_details,
    attempts: job.attempts,
    worker_started_at: job.worker_started_at,
    worker_finished_at: job.worker_finished_at,
    generation_diagnostics: job.generation_diagnostics,
    created_at: job.created_at,
    updated_at: job.updated_at,
  });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ job_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { job_id: jobIdRaw } = await ctx.params;
  const jobId = parseInt(jobIdRaw, 10);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: "invalid job_id" }, { status: 400 });
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
  return NextResponse.json({ ok: true, job_id: jobId, status: "cancelled" });
}
