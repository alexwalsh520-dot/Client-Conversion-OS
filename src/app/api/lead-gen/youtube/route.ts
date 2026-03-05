// POST /api/lead-gen/youtube — Start a YouTube Deep Dive job
//
// Takes profiles WITHOUT emails from an Instagram scan job.
// FORKED ARCHITECTURE: Can start while the parent IG job is still running.
// Re-reads parent's found_leads to get current no-email profiles.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const sourceJobId = body.sourceJobId;

  if (!sourceJobId) {
    return NextResponse.json({ error: "Missing sourceJobId" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // Load source job — allow ANY status (running, complete, stopped)
  const { data: sourceJob, error: srcErr } = await db
    .from("lead_jobs")
    .select("found_leads, results, status")
    .eq("id", sourceJobId)
    .single();

  if (srcErr || !sourceJob) {
    return NextResponse.json({ error: "Source job not found" }, { status: 404 });
  }

  // Get ALL profiles that were enriched but had no email
  const allProfiles: any[] = sourceJob.found_leads || [];
  const noEmailProfiles = allProfiles.filter(
    (p: any) => p.username && !p.igEmail
  );

  if (noEmailProfiles.length === 0) {
    return NextResponse.json({ error: "No profiles without emails found yet. Wait for enrichment to process some profiles." }, { status: 400 });
  }

  // Deduplicate by username
  const seen = new Set<string>();
  const uniqueProfiles = noEmailProfiles.filter((p: any) => {
    const u = p.username.toLowerCase();
    if (seen.has(u)) return false;
    seen.add(u);
    return true;
  });

  // Create the YouTube deep dive job
  const { data: job, error: dbErr } = await db.from("lead_jobs").insert({
    status: "pending",
    mode: "youtube",
    source_job_id: sourceJobId,
    config: { sourceJobId, profileCount: uniqueProfiles.length },
    target_emails: uniqueProfiles.length,
    profiles_without_email: uniqueProfiles,
    yt_channel_results: [],
    yt_batch_index: 0,
    yt_channels_found: 0,
    yt_emails_found: 0,
    found_leads: [],
    activity_log: [
      {
        ts: new Date().toISOString(),
        type: "system",
        message: `YouTube Deep Dive started. ${uniqueProfiles.length} profiles to search. Parent job: ${sourceJob.status}.`,
      },
    ],
  }).select("id").single();

  if (dbErr) {
    return NextResponse.json({ error: `DB error: ${dbErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    jobId: job?.id || "",
    profileCount: uniqueProfiles.length,
  });
}
