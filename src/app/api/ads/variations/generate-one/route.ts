/**
 * Variations Factory — generate a SINGLE variation image (interactive popup).
 *
 * POST /api/ads/variations/generate-one
 *   Body: {
 *     adId: string,                  // winning ad to vary (its stored creative is the base reference)
 *     prompt: string,                // the instruction (preset text and/or the user's chat prompt)
 *     kind?: "background"|"highlightWord"|"copyTweak",  // cosmetic tag (else stored as background)
 *     jobId?: string,                // group several images from one popup run under one job
 *     index?: number,                // ordering within the job
 *     extraReferenceUrls?: string[]  // user-added references (upload / media library), beyond the winning ad
 *   }
 *   Generates exactly one image and returns its recorded row. The popup fires
 *   several of these in parallel so images stream in one-by-one (Studio-2 style)
 *   rather than blocking on a whole batch.
 *
 *   Response 200: { variation: { id, source_ad_id, job_id, kind, prompt, image_url, provider, created_at } }
 *   Response 400: { error: "adId and prompt are required" }
 *   Response 401: { error: "unauthorized" }
 *   Response 422: { error } — caller-actionable (no reference image, provider token)
 *   Response 500: { error }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateOneVariation } from "@/lib/ads-variations/generate";

export const runtime = "nodejs";
// One image still goes through Higgsfield's async submit+poll; give it headroom.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    adId?: unknown;
    prompt?: unknown;
    kind?: unknown;
    jobId?: unknown;
    index?: unknown;
    extraReferenceUrls?: unknown;
    baseImageUrl?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const adId = typeof body.adId === "string" ? body.adId.trim() : "";
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!adId || !prompt) {
    return NextResponse.json({ error: "adId and prompt are required" }, { status: 400 });
  }

  const extraReferenceUrls = Array.isArray(body.extraReferenceUrls)
    ? body.extraReferenceUrls.filter((u): u is string => typeof u === "string" && u.trim().length > 0).slice(0, 4)
    : [];

  try {
    const variation = await generateOneVariation({
      adId,
      prompt,
      kind: typeof body.kind === "string" ? body.kind : undefined,
      jobId: typeof body.jobId === "string" && body.jobId ? body.jobId : undefined,
      index: typeof body.index === "number" ? body.index : undefined,
      extraReferenceUrls,
      baseImageUrl: typeof body.baseImageUrl === "string" && body.baseImageUrl ? body.baseImageUrl : undefined,
    });
    return NextResponse.json({ variation });
  } catch (err) {
    const message = err instanceof Error ? err.message : "generation failed";
    const isUnprocessable =
      message.includes("No stored creative image") ||
      message.includes("Higgsfield needs a fresh login token") ||
      message.includes("OPENAI_API_KEY not set");
    return NextResponse.json({ error: message }, { status: isUnprocessable ? 422 : 500 });
  }
}
