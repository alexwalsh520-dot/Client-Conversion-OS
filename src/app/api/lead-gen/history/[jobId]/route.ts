// GET /api/lead-gen/history/[jobId] — Fetch full results for a single run (for CSV re-download)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await params;

  const db = getServiceSupabase();
  const { data: job, error } = await db
    .from("lead_jobs")
    .select("id, status, mode, created_at, scraped_count, lead_count, email_count, config, results")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
