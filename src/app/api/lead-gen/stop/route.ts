// POST /api/lead-gen/stop — Stop a running job and save partial results
//
// Marks the job as "stopped", deduplicates found emails,
// saves them as results so CSV is downloadable from history.
// Also computes and saves brand_results for the brand dashboard.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

function deduplicateLeads(emailLeads: any[], deliveredSet: Set<string>): any[] {
  const seen = new Set<string>();
  return emailLeads.filter((l: any) => {
    const e = l.igEmail.toLowerCase();
    if (deliveredSet.has(e) || seen.has(e)) return false;
    seen.add(e);
    return true;
  });
}

function computeBrandResults(foundLeads: any[]): Record<string, any> {
  const results: Record<string, any> = {};
  for (const lead of foundLeads) {
    const brand = lead.brandSource || "unknown";
    if (!results[brand]) {
      results[brand] = { scraped: 0, withEmail: 0, withoutEmail: 0 };
    }
    results[brand].scraped++;
    if (lead.igEmail) results[brand].withEmail++;
    else results[brand].withoutEmail++;
  }
  return results;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const jobId = body.jobId;

  if (!jobId) {
    return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  }

  const db = getServiceSupabase();

  const { data: job, error: fetchErr } = await db
    .from("lead_jobs")
    .select("*")
    .eq("id", jobId)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const foundLeads: any[] = job.found_leads || [];
  const brandResults = computeBrandResults(foundLeads);

  // If already complete/stopped/failed, just return what we have
  if (job.status === "complete" || job.status === "stopped") {
    return NextResponse.json({
      status: job.status,
      leads: job.results || [],
      emailsFound: (job.results || []).length,
      totalScraped: foundLeads.length,
      profilesWithoutEmail: foundLeads.filter((l: any) => !l.igEmail).length,
      brandResults,
      brandsCompleted: job.brands_completed || [],
    });
  }

  const emailLeads = foundLeads.filter((l: any) => l.igEmail);

  // Dedup against delivered_emails — same logic as poll/route.ts
  const { data: prevEmails } = await db.from("delivered_emails").select("email");
  const deliveredSet = new Set((prevEmails || []).map((e: any) => e.email.toLowerCase()));
  const dedupedLeads = deduplicateLeads(emailLeads, deliveredSet);

  // Sort by followers desc
  const finalLeads = dedupedLeads
    .sort((a: any, b: any) => (b.followers || 0) - (a.followers || 0));

  // Save to delivered_emails
  if (finalLeads.length > 0) {
    const emailRows = finalLeads.map((l: any) => ({
      email: l.igEmail.toLowerCase(),
      username: l.username,
      job_id: jobId,
    }));
    await db.from("delivered_emails").upsert(emailRows, { onConflict: "email" });
  }

  // Update activity log
  const logs: any[] = job.activity_log || [];
  logs.push({
    ts: new Date().toISOString(),
    type: "stopped",
    message: `Stopped by user. ${finalLeads.length} emails saved from ${(job.brands_completed || []).length} brands.`,
  });

  // Mark job as stopped with saved results + brand_results
  await db.from("lead_jobs").update({
    status: "stopped",
    results: finalLeads,
    found_leads: foundLeads,
    lead_count: foundLeads.length,
    email_count: finalLeads.length,
    brand_results: brandResults,
    activity_log: logs,
    updated_at: new Date().toISOString(),
  }).eq("id", jobId);

  return NextResponse.json({
    status: "stopped",
    leads: finalLeads,
    emailsFound: finalLeads.length,
    totalScraped: foundLeads.length,
    profilesWithoutEmail: foundLeads.filter((l: any) => !l.igEmail).length,
    brandsCompleted: job.brands_completed || [],
    brandResults,
  });
}
