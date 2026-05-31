import { NextRequest, NextResponse } from "next/server";
import { getOrExtractCreativeCopy, findUnreadAdIds } from "@/lib/ads-tracker/creative-copy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many ads to read per call. The reads run concurrently (one Claude vision
// call each), so the whole batch finishes in roughly the time of a single read
// — that's what keeps it fast. Bounded so a serverless invocation (60s) never
// times out even if a few images are slow. The client calls repeatedly until
// `remaining` hits 0, so a typical ~30 relevant ads clear in 3-4 quick calls.
const BATCH = 8;

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

    // Read the whole batch at once. One slow/bad image can't hold up the others,
    // and the call finishes in about the time of the single slowest read.
    const results = await Promise.allSettled(
      batch.map((ad) => getOrExtractCreativeCopy(ad))
    );
    let processed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        processed += 1;
      } else {
        console.error("Backfill read failed for ad", batch[i].adId, r.reason);
      }
    });

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
