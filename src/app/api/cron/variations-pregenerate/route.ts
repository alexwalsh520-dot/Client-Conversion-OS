/**
 * Variations Factory — daily pre-generation cron.
 *
 * GET /api/cron/variations-pregenerate   (Authorization: Bearer <CRON_SECRET>)
 *   Finds the current winning ads and generates a fresh batch of variations for
 *   any that don't already have a recent one, so ~10 ready-to-launch variations
 *   are waiting when the owner opens the dashboard each morning.
 *
 * Safe by construction:
 *   - Behind CRON_SECRET (same pattern as the other cron routes).
 *   - Gated by the live `variations_factory` settings `enabled` flag — flip it
 *     off (or the engine off) and this becomes a no-op.
 *   - Hard cost cap inside pregenerateForWinners: MAX_ADS_PER_RUN (3) ads ×
 *     ~10 images. Idempotent FRESH_WINDOW_HOURS (20h) skip means even if this
 *     route is hit more than once a day it won't re-bill the same winners.
 *
 * This route exists but is intentionally NOT scheduled in vercel.json until the
 * owner has approved the recurring image-generation cost. Scheduling it (a daily
 * entry, e.g. "0 6 * * *") is the only step needed to turn the morning factory on.
 */

import { NextRequest, NextResponse } from "next/server";
import { pregenerateForWinners } from "@/lib/ads-variations/auto";

export const runtime = "nodejs";
// Image generation is slow; a few serial 10-image jobs need real headroom.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await pregenerateForWinners();
    const generatedImages = result.generated.reduce((n, j) => n + j.succeeded, 0);
    return NextResponse.json({
      ok: true,
      ran: result.ran,
      reason: result.reason ?? null,
      consideredWinners: result.consideredWinners,
      jobs: result.generated.length,
      generatedImages,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error("[variations-pregenerate] failed", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "pregeneration failed" },
      { status: 500 }
    );
  }
}
