// GET /api/lead-gen/brands — Brand dashboard data
//
// Aggregates per-brand stats across ALL completed/stopped jobs.
// Shows which brands have been fully scraped, email yield per brand,
// and YouTube coverage.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const BRAND_ACCOUNTS = [
  "gymshark", "1stphorm", "youngla", "darcsport", "alphaleteathletics",
  "nvgtn", "ghostlifestyle", "rawgear", "gymreapers", "gorillawear",
  "musclenation", "buffbunnyco", "rabornyofficial",
];

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();

  // Get all IG jobs (non-youtube) that are complete or stopped
  const { data: igJobs } = await db
    .from("lead_jobs")
    .select("brand_results, brands_completed, found_leads, status, created_at")
    .in("status", ["complete", "stopped"])
    .neq("mode", "youtube")
    .order("created_at", { ascending: false })
    .limit(50);

  // Get all YouTube jobs that are complete
  const { data: ytJobs } = await db
    .from("lead_jobs")
    .select("yt_channel_results, status, created_at")
    .eq("mode", "youtube")
    .in("status", ["complete", "stopped"])
    .order("created_at", { ascending: false })
    .limit(50);

  // Get delivered emails count
  const { count: totalDelivered } = await db
    .from("delivered_emails")
    .select("*", { count: "exact", head: true });

  // Aggregate per-brand stats from IG jobs
  const brandStats: Record<string, {
    scraped: number;
    igEmails: number;
    withoutEmail: number;
    ytSearched: number;
    ytChannelsFound: number;
    ytEmails: number;
    fullyScraped: boolean;
    lastScrapedAt: string | null;
  }> = {};

  // Initialize all brands
  for (const brand of BRAND_ACCOUNTS) {
    brandStats[brand] = {
      scraped: 0,
      igEmails: 0,
      withoutEmail: 0,
      ytSearched: 0,
      ytChannelsFound: 0,
      ytEmails: 0,
      fullyScraped: false,
      lastScrapedAt: null,
    };
  }

  // Accumulate from IG jobs (use brand_results if available, else compute from found_leads)
  for (const job of (igJobs || [])) {
    const brandsCompleted: string[] = job.brands_completed || [];

    if (job.brand_results && typeof job.brand_results === "object") {
      for (const [brand, stats] of Object.entries(job.brand_results as Record<string, any>)) {
        if (!brandStats[brand]) continue;
        brandStats[brand].scraped += stats.scraped || 0;
        brandStats[brand].igEmails += stats.withEmail || 0;
        brandStats[brand].withoutEmail += stats.withoutEmail || 0;
      }
    } else if (job.found_leads && Array.isArray(job.found_leads)) {
      // Fallback: compute from found_leads
      for (const lead of job.found_leads) {
        const brand = lead.brandSource || "";
        if (!brandStats[brand]) continue;
        brandStats[brand].scraped++;
        if (lead.igEmail) brandStats[brand].igEmails++;
        else brandStats[brand].withoutEmail++;
      }
    }

    // Track which brands were fully scraped (only if we actually have data)
    for (const brand of brandsCompleted) {
      if (brandStats[brand] && brandStats[brand].scraped > 0) {
        brandStats[brand].fullyScraped = true;
        if (!brandStats[brand].lastScrapedAt) {
          brandStats[brand].lastScrapedAt = job.created_at;
        }
      }
    }
  }

  // Accumulate from YouTube jobs
  for (const ytJob of (ytJobs || [])) {
    const results: any[] = ytJob.yt_channel_results || [];
    for (const r of results) {
      const brand = r.brandSource || "";
      if (!brandStats[brand]) continue;
      brandStats[brand].ytSearched++;
      if (r.found) brandStats[brand].ytChannelsFound++;
      if (r.email) brandStats[brand].ytEmails++;
    }
  }

  // Build response array sorted by scraped count desc
  const brandsArray = BRAND_ACCOUNTS.map((brand) => ({
    brand,
    ...brandStats[brand],
    totalEmails: brandStats[brand].igEmails + brandStats[brand].ytEmails,
  })).sort((a, b) => b.scraped - a.scraped);

  const totalStats = {
    totalBrands: BRAND_ACCOUNTS.length,
    brandsScraped: brandsArray.filter((b) => b.scraped > 0).length,
    brandsFullyScraped: brandsArray.filter((b) => b.fullyScraped).length,
    totalProfilesScraped: brandsArray.reduce((sum, b) => sum + b.scraped, 0),
    totalIgEmails: brandsArray.reduce((sum, b) => sum + b.igEmails, 0),
    totalYtEmails: brandsArray.reduce((sum, b) => sum + b.ytEmails, 0),
    totalDelivered: totalDelivered || 0,
  };

  return NextResponse.json({
    brands: brandsArray,
    stats: totalStats,
  });
}
