import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getOrExtractCreativeCopy, findUnreadAdIds } from "@/lib/ads-tracker/creative-copy";
import { CREATORS, firstEnv, type CreatorKey } from "@/lib/creators";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// COMPREHENSIVE server-side OCR backfill.
//
// The old backfill only read ads the DASHBOARD happened to hand an image_url for
// (i.e. ads in the current view) and skipped videos entirely — so starved,
// paused, and video ads never got their on-image copy read. As the CMO we must
// know what EVERY ad says, so this route does it properly:
//   1. pulls every ad_id we've ever recorded for each creator,
//   2. finds the ones with no OCR yet,
//   3. fetches each ad's creative image (or the VIDEO THUMBNAIL) straight from
//      Meta using the creator's own token,
//   4. reads the words on it and stores them.
// It processes a bounded batch per call (so a 60s serverless invocation never
// times out) and reports `remaining`; call it repeatedly (or on a daily cron)
// until remaining hits 0. Idempotent: already-read ads are skipped.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION?.trim() || "v24.0"}`;
const PER_CALL = 25; // ads OCR'd per invocation (each = 1 Claude vision read)
const CONCURRENCY = 5;

// ad_id -> its creative's still-image URL (or the video thumbnail, which carries
// the same text overlay). Returns "" on any failure so we simply retry next run
// rather than poisoning the store with an empty read.
async function creativeImageUrl(adId: string, token: string): Promise<string> {
  try {
    const cr = await fetch(`${GRAPH}/${adId}?fields=creative&access_token=${token}`).then((r) => r.json());
    const cid = cr?.creative?.id;
    if (!cid) return "";
    const c = await fetch(`${GRAPH}/${cid}?fields=image_url,thumbnail_url&access_token=${token}`).then((r) => r.json());
    return String(c?.image_url || c?.thumbnail_url || "");
  } catch {
    return "";
  }
}

async function distinctAdIds(clientKey: CreatorKey): Promise<string[]> {
  const db = getServiceSupabase();
  const ids = new Set<string>();
  // Page through so we never hit the default row cap and miss ads.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("ads_meta_insights_daily")
      .select("ad_id")
      .eq("client_key", clientKey)
      .not("ad_id", "is", null)
      .range(from, from + 999);
    if (error || !data || data.length === 0) break;
    data.forEach((r: { ad_id: string | null }) => r.ad_id && ids.add(r.ad_id));
    if (data.length < 1000) break;
  }
  return [...ids];
}

async function runBackfill(onlyKey: string | null) {
  const creators = CREATORS.filter((c) => (!onlyKey || c.key === onlyKey) && firstEnv(c.tokenEnv));
  let processed = 0;
  let remaining = 0;
  const perCreator: Record<string, { done: number; left: number }> = {};

  for (const creator of creators) {
    const token = firstEnv(creator.tokenEnv);
    if (!token) continue;
    const adIds = await distinctAdIds(creator.key);
    const unread = await findUnreadAdIds(adIds);
    const todo = [...unread];
    const budget = Math.max(0, PER_CALL - processed);
    const batch = todo.slice(0, budget);

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const slice = batch.slice(i, i + CONCURRENCY);
      await Promise.allSettled(
        slice.map(async (adId) => {
          const imageUrl = await creativeImageUrl(adId, token);
          if (!imageUrl) return; // leave unread; retry next run
          await getOrExtractCreativeCopy({ adId, imageUrl, clientKey: creator.key });
        })
      );
    }

    processed += batch.length;
    remaining += Math.max(0, todo.length - batch.length);
    perCreator[creator.key] = { done: batch.length, left: Math.max(0, todo.length - batch.length) };
    if (processed >= PER_CALL) break;
  }

  return { processed, remaining, perCreator };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const onlyKey = typeof body.creator === "string" ? body.creator : null;
    return NextResponse.json(await runBackfill(onlyKey));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backfill failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET: same job across all creators. This is what the daily cron calls, so the
// on-image copy store stays 100% complete as new ads launch — automatically.
export async function GET() {
  try {
    return NextResponse.json(await runBackfill(null));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Backfill failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
