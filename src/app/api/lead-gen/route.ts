// POST /api/lead-gen — Create a new lead gen job
// Reads selected brands from request. Partitions into cached vs needs-scrape
// using scraped_profiles table to prevent redundant Apify calls.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const STALE_DAYS = 30;
const MIN_FOLLOWERS_PER_BRAND = 400;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apifyToken = process.env.APIFY_API_TOKEN;
  if (!apifyToken) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const targetEmails = body.targetEmails || 100;

  // Accept brand handles from the brand bank selection
  let brandHandles: string[] = [];
  if (Array.isArray(body.brandHandles) && body.brandHandles.length > 0) {
    brandHandles = body.brandHandles.map((b: string) => b.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  } else if (Array.isArray(body.customBrands)) {
    // Backward compat with old format
    brandHandles = body.customBrands.map((b: string) => b.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  }

  // Deduplicate
  const allBrands = [...new Set(brandHandles)];

  if (allBrands.length === 0) {
    return NextResponse.json({ error: "No brands selected" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // ── Partition brands into cached vs needs-scrape ──────────────────────────
  const brandsToScrape: string[] = [];
  const brandsCached: string[] = [];
  const now = Date.now();
  const staleMs = STALE_DAYS * 86400000;

  for (const handle of allBrands) {
    // Count existing scraped profiles for this brand
    const { count } = await db
      .from("scraped_profiles")
      .select("*", { count: "exact", head: true })
      .eq("brand_source", handle);

    // Check when it was last scraped
    const { data: brand } = await db
      .from("brand_bank")
      .select("last_scraped_at")
      .eq("handle", handle)
      .single();

    const lastScraped = brand?.last_scraped_at ? new Date(brand.last_scraped_at).getTime() : 0;
    const isStale = !lastScraped || (now - lastScraped) > staleMs;

    if ((count || 0) >= MIN_FOLLOWERS_PER_BRAND && !isStale) {
      brandsCached.push(handle);
    } else {
      brandsToScrape.push(handle);
    }
  }

  // Get previously delivered emails count for display
  const { count: deliveredCount } = await db
    .from("delivered_emails")
    .select("*", { count: "exact", head: true });

  const { data: job, error: dbErr } = await db.from("lead_jobs").insert({
    status: "pending",
    mode: "quick",
    config: {
      brandAccounts: allBrands, // backward compat with poll route
      allBrands,
      brandsToScrape,
      brandsCached,
      targetEmails,
    },
    target_emails: targetEmails,
    current_brand_index: 0,
    current_brand: allBrands[0],
    scrape_run_id: "",
    scrape_dataset_id: "",
    scrape_actor_index: 0,
    enrich_run_id: "",
    enrich_dataset_id: "",
    found_leads: [],
    brands_completed: [],
    batch_number: 0,
    scraped_count: 0,
    activity_log: [
      {
        ts: new Date().toISOString(),
        type: "system",
        message: `Job created. Target: ${targetEmails} emails. ${allBrands.length} brands (${brandsToScrape.length} to scrape, ${brandsCached.length} cached).`,
      },
      {
        ts: new Date().toISOString(),
        type: "system",
        message: `${deliveredCount || 0} emails previously delivered (will be skipped).`,
      },
    ],
  }).select("id").single();

  if (dbErr) {
    return NextResponse.json({ error: `DB error: ${dbErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    jobId: job?.id || "",
    brands: allBrands,
    brandsToScrape,
    brandsCached,
    targetEmails,
    previouslyDelivered: deliveredCount || 0,
  });
}
