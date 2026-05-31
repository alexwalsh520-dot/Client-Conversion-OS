import { NextRequest, NextResponse } from "next/server";
import { getOrExtractCreativeCopy, findUnreadAdIds } from "@/lib/ads-tracker/creative-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many ads to read per call — bounded so a serverless invocation never
// times out. The client calls repeatedly until `remaining` hits 0.
const BATCH = 4;

type AdInput = { adId?: unknown; imageUrl?: unknown; clientKey?: unknown };

// Reads the words on a small batch of not-yet-read ads. Idempotent: ads already
// in the store are skipped, so calling this on every dashboard load is cheap
// once the roster is fully read.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const adsRaw: AdInput[] = Array.isArray(body.ads) ? body.ads : [];

    const ads = adsRaw
      .map((a) => ({
        adId: typeof a.adId === "string" ? a.adId.trim() : "",
        imageUrl: typeof a.imageUrl === "string" ? a.imageUrl.trim() : "",
        clientKey: typeof a.clientKey === "string" ? a.clientKey.trim() : null,
      }))
      .filter((a) => a.adId && a.imageUrl);

    if (ads.length === 0) {
      return NextResponse.json({ processed: 0, remaining: 0, total: 0 });
    }

    const unread = await findUnreadAdIds(ads.map((a) => a.adId));
    const todo = ads.filter((a) => unread.has(a.adId));
    const batch = todo.slice(0, BATCH);

    let processed = 0;
    for (const ad of batch) {
      try {
        await getOrExtractCreativeCopy(ad);
        processed += 1;
      } catch (err) {
        // One bad image shouldn't stop the rest — log and move on.
        console.error("Backfill read failed for ad", ad.adId, err);
      }
    }

    return NextResponse.json({
      processed,
      remaining: Math.max(0, todo.length - processed),
      total: ads.length,
    });
  } catch (error: unknown) {
    console.error("Creative copy backfill error:", error);
    const message = error instanceof Error ? error.message : "Backfill failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
