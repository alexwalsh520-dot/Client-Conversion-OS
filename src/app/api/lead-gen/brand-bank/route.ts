// GET /api/lead-gen/brand-bank — List all brands with live stats
// POST /api/lead-gen/brand-bank — Add a custom brand
//
// Reads from brand_bank table, enriches with scraped_profiles stats.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

const STALE_DAYS = 30;
const MIN_FOLLOWERS_PER_BRAND = 400; // consider brand "cached" if we have this many

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getServiceSupabase();

    // Get all active brands
    const { data: brands, error: brandErr } = await db
      .from("brand_bank")
      .select("*")
      .eq("is_active", true)
      .order("handle");

    if (brandErr || !brands) {
      console.error("[brand-bank] DB error:", brandErr?.message, brandErr?.code);
      return NextResponse.json(
        { error: `Failed to load brands: ${brandErr?.message || "no data"}` },
        { status: 500 }
      );
    }

    // Get per-brand stats from scraped_profiles in one query
    const handles = brands.map((b) => b.handle);

    const { data: profileStats } = await db
      .from("scraped_profiles")
      .select("brand_source, has_email, enriched_at")
      .in("brand_source", handles);

    // Aggregate stats
    const statsMap: Record<string, { scraped: number; withEmail: number; unenriched: number }> = {};
    for (const h of handles) {
      statsMap[h] = { scraped: 0, withEmail: 0, unenriched: 0 };
    }
    for (const p of profileStats || []) {
      const s = statsMap[p.brand_source];
      if (!s) continue;
      s.scraped++;
      if (p.has_email) s.withEmail++;
      if (!p.enriched_at) s.unenriched++;
    }

    // Get delivered email count (safe — ignore errors)
    let totalDelivered = 0;
    try {
      const { count } = await db
        .from("delivered_emails")
        .select("*", { count: "exact", head: true });
      totalDelivered = count || 0;
    } catch {
      // delivered_emails might not exist yet, that's fine
    }

    const now = Date.now();
    const staleMs = STALE_DAYS * 86400000;

    const enriched = brands.map((b) => {
      const s = statsMap[b.handle] || { scraped: 0, withEmail: 0, unenriched: 0 };
      const lastScraped = b.last_scraped_at ? new Date(b.last_scraped_at).getTime() : 0;
      const isStale = !lastScraped || (now - lastScraped) > staleMs;
      const needsScrape = s.scraped < MIN_FOLLOWERS_PER_BRAND || isStale;

      return {
        id: b.id,
        handle: b.handle,
        display_name: b.display_name,
        category: b.category,
        follower_count_estimate: b.follower_count_estimate,
        is_active: b.is_active,
        last_scraped_at: b.last_scraped_at,
        followers_scraped: s.scraped,
        emails_found: s.withEmail,
        unenriched_count: s.unenriched,
        is_stale: isStale,
        needs_scrape: needsScrape,
      };
    });

    // Sort: needs_scrape first, then by followers desc
    enriched.sort((a, b) => {
      if (a.needs_scrape !== b.needs_scrape) return a.needs_scrape ? -1 : 1;
      return (b.follower_count_estimate || 0) - (a.follower_count_estimate || 0);
    });

    return NextResponse.json({
      brands: enriched,
      totalDelivered,
      totalBrands: enriched.length,
      brandsNeedingScrape: enriched.filter((b) => b.needs_scrape).length,
      brandsCached: enriched.filter((b) => !b.needs_scrape).length,
    });
  } catch (err: any) {
    console.error("[brand-bank] unhandled error:", err?.message, err?.stack);
    return NextResponse.json(
      { error: `Server error: ${err?.message || "unknown"}` },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const handle = (body.handle || "").trim().toLowerCase().replace(/^@/, "");

    if (!handle || handle.length < 2) {
      return NextResponse.json({ error: "Invalid handle" }, { status: 400 });
    }

    const db = getServiceSupabase();

    const { data: brand, error } = await db
      .from("brand_bank")
      .upsert(
        {
          handle,
          display_name: body.display_name || `@${handle}`,
          category: body.category || "fitness_apparel",
          follower_count_estimate: body.follower_count_estimate || null,
          is_active: true,
        },
        { onConflict: "handle" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: `DB error: ${error.message}` }, { status: 500 });
    }

    return NextResponse.json({ brand });
  } catch (err: any) {
    console.error("[brand-bank POST] unhandled error:", err?.message, err?.stack);
    return NextResponse.json(
      { error: `Server error: ${err?.message || "unknown"}` },
      { status: 500 }
    );
  }
}
