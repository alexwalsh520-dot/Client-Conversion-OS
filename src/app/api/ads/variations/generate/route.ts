/**
 * Variations Factory — generate a fresh job ("Regenerate" action).
 *
 * POST /api/ads/variations/generate
 *   Body: { "adId": "<sourceAdId>" }
 *   Generates ONE job (~variationsPerJob images, default 10) from that winning
 *   ad's reference image + copy, using the current live settings. Cost-capped to
 *   a single job per call.
 *
 *   Response 200:
 *     {
 *       "jobId": "120...-1717430000000",
 *       "sourceAdId": "120...",
 *       "requested": 10,
 *       "succeeded": 10,
 *       "failed": 0,
 *       "variations": [ { id, source_ad_id, job_id, kind, prompt, image_url, provider, created_at }, ... ],
 *       "errors": []            // per-image error strings, if any failed
 *     }
 *   Response 400: { "error": "adId required in body" }
 *   Response 401: { "error": "unauthorized" }
 *   Response 422: { "error": "No stored creative image found for ad <id> ..." }
 *                  (the ad has no reference image to vary; also used when
 *                   OPENAI_API_KEY is missing — the error message says so)
 *   Response 500: { "error": "<message>" }
 *
 * Cost: each successful image is billed by the provider (gpt-image-1 ≈ $0.04 at
 * 1024x1024 medium). A default 10-image job ≈ $0.40. Estimated cost is logged to
 * the ai_usage meter under feature "ads-variations-image".
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateVariationsJob } from "@/lib/ads-variations/generate";

export const runtime = "nodejs";
// Image generation is slow; a 10-image serial job needs headroom.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { adId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const adId = typeof body.adId === "string" ? body.adId.trim() : "";
  if (!adId) {
    return NextResponse.json({ error: "adId required in body" }, { status: 400 });
  }

  try {
    const result = await generateVariationsJob(adId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "generation failed";
    // Missing reference image or missing API key are caller-actionable → 422.
    const isUnprocessable =
      message.includes("No stored creative image") ||
      message.includes("OPENAI_API_KEY not set");
    return NextResponse.json({ error: message }, { status: isUnprocessable ? 422 : 500 });
  }
}
