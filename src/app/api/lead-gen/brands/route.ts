// GET /api/lead-gen/brands — Brand dashboard data
//
// Reads from brand_bank + scraped_profiles tables for accurate per-brand stats.
// Also includes YouTube coverage from lead_jobs history.

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const STALE_DAYS = 30;
const MIN_FOLLOWERS_PER_BRAND = 400;

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();

  // Get all brands from brand_bank
  const { data: brands, error: brandErr } = await db
    .from("brand_bank")
    .select("*")
    .eq("is_active", true)
    .order("handle");

  if (brandErr || !brands) {
    return NextResponse.json({ error: "Failed to load brands" }, { status: 500 });
  }

  const handles = brands.map((b) => b.handle);

  // Get per-brand stats from scraped_profiles
  const { data: profileStats } = await db
    .from("scraped_profiles")
    .select("brand_source, has_email, enriched_at")
    .in("brand_source", handles);

  // Aggregate stats
  const statsMap: Record<string, { scraped: number; withEmail: number; withoutEmail: number; unenriched: number }> = {};
  for (const h of handles) {
    statsMap[h] = { scraped: 0, withEmail: 0, withoutEmail: 0, unenriched: 0 };
  }
  for (const p of profileStats || []) {
    const s = statsMap[p.brand_source];
    if (!s) continue;
    s.scraped++;
    if (p.enriched_at) {
      if (p.has_email) s.withEmail++;
      else s.withoutEmail++;
    } else {
      s.unenriched++;
    }
  }

  // Get YouTube stats from lead_jobs
  const { data: ytJobs } = await db
    .from("lead_jobs")
    .select("yt_channel_results")
    .eq("mode", "youtube")
    .in("status", ["complete", "stopped"])
    .order("created_at", { ascending: false })
    .limit(50);

  const ytStats: Record<string, { ytSearched: number; ytChannelsFound: number; ytEmails: number }> = {};
  for (const h of handles) {
    ytStats[h] = { ytSearched: 0, ytChannelsFound: 0, ytEmails: 0 };
  }
  for (const ytJob of (ytJobs || [])) {
    const results: any[] = ytJob.yt_channel_results || [];
    for (const r of results) {
      const brand = r.brandSource || "";
      if (!ytStats[brand]) continue;
      ytStats[brand].ytSearched++;
      if (r.found) ytStats[brand].ytChannelsFound++;
      if (r.email) ytStats[brand].ytEmails++;
    }
  }

  // Get delivered emails count
  const { count: totalDelivered } = await db
    .from("delivered_emails")
    .select("*", { count: "exact", head: true });

  const now = Date.now();
  const staleMs = STALE_DAYS * 86400000;

  // Build response array
  const brandsArray = brands.map((b) => {
    const s = statsMap[b.handle] || { scraped: 0, withEmail: 0, withoutEmail: 0, unenriched: 0 };
    const yt = ytStats[b.handle] || { ytSearched: 0, ytChannelsFound: 0, ytEmails: 0 };
    const lastScraped = b.last_scraped_at ? new Date(b.last_scraped_at).getTime() : 0;
    const isStale = !lastScraped || (now - lastScraped) > staleMs;
    const fullyScraped = s.scraped >= MIN_FOLLOWERS_PER_BRAND && !isStale;

    return {
      brand: b.handle,
      display_name: b.display_name,
      category: b.category,
      scraped: s.scraped,
      igEmails: s.withEmail,
      withoutEmail: s.withoutEmail,
      unenriched: s.unenriched,
      ...yt,
      totalEmails: s.withEmail + yt.ytEmails,
      fullyScraped,
      lastScrapedAt: b.last_scraped_at,
      isStale,
      needsScrape: s.scraped < MIN_FOLLOWERS_PER_BRAND || isStale,
    };
  }).sort((a, b) => b.scraped - a.scraped);

  const totalStats = {
    totalBrands: brands.length,
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
