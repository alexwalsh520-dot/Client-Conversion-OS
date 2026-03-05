// GET /api/lead-gen/active — Returns any active (non-terminal) jobs
//
// Used on page load to detect and resume running jobs after browser close.
// Returns the most recent active IG job and YouTube job (if any).

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();

  // Find any non-terminal jobs (not complete, failed, or stopped)
  const { data: activeJobs } = await db
    .from("lead_jobs")
    .select("id, status, mode, created_at, config, source_job_id")
    .not("status", "in", '("complete","failed","stopped")')
    .order("created_at", { ascending: false })
    .limit(10);

  const jobs = activeJobs || [];
  const igJob = jobs.find((j: any) => j.mode !== "youtube");
  const ytJob = jobs.find((j: any) => j.mode === "youtube");

  return NextResponse.json({
    igJob: igJob
      ? {
          id: igJob.id,
          status: igJob.status,
          mode: igJob.mode,
          sourceJobId: igJob.source_job_id,
        }
      : null,
    ytJob: ytJob
      ? {
          id: ytJob.id,
          status: ytJob.status,
          mode: ytJob.mode,
          submittedAt: ytJob.config?.yt_submitted_at || null,
          sourceJobId: ytJob.source_job_id,
        }
      : null,
  });
}
