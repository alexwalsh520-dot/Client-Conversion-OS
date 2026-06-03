/**
 * Variations Factory — list a source ad's variations (newest job).
 *
 * GET /api/ads/variations?adId=<sourceAdId>
 *   Returns the most recent job's variation images for that ad.
 *   Response 200:
 *     {
 *       "adId": "120xxxxxxxxxxxxxxx",
 *       "jobId": "120xxxxxxxxxxxxxxx-1717430000000" | null,
 *       "createdAt": "2026-06-03T06:00:00.000Z" | null,
 *       "variations": [
 *         {
 *           "id": "uuid",
 *           "source_ad_id": "120...",
 *           "job_id": "120...-1717430000000",
 *           "kind": "background" | "highlightWord" | "copyTweak",
 *           "prompt": "Recreate this winning ad ...",
 *           "image_url": "https://<supabase>/storage/v1/object/public/ad-variations/...",
 *           "provider": "openai",
 *           "created_at": "2026-06-03T06:00:00.000Z"
 *         },
 *         ...
 *       ]
 *     }
 *   Response 400: { "error": "adId query param required" }
 *   Response 401: { "error": "unauthorized" }
 *
 * "Newest job" = all rows whose job_id equals the job_id of the most recently
 * created variation for that ad. An ad with no variations yet returns an empty
 * array with jobId/createdAt null (not an error).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const adId = (req.nextUrl.searchParams.get("adId") || "").trim();
  if (!adId) {
    return NextResponse.json({ error: "adId query param required" }, { status: 400 });
  }

  const db = getServiceSupabase();

  // Find the newest job_id for this ad.
  const { data: latest, error: latestErr } = await db
    .from("ad_variations")
    .select("job_id, created_at")
    .eq("source_ad_id", adId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestErr) {
    return NextResponse.json({ error: latestErr.message }, { status: 500 });
  }
  if (!latest?.job_id) {
    return NextResponse.json({ adId, jobId: null, createdAt: null, variations: [] });
  }

  const { data: rows, error } = await db
    .from("ad_variations")
    .select("id, source_ad_id, job_id, kind, prompt, image_url, provider, created_at")
    .eq("job_id", latest.job_id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    adId,
    jobId: latest.job_id,
    createdAt: latest.created_at ?? null,
    variations: rows || [],
  });
}
