import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getOrExtractCreativeCopy, findUnreadAdIds } from "@/lib/ads-tracker/creative-copy";
import { CREATORS, firstEnv, type CreatorKey } from "@/lib/creators";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// COMPREHENSIVE server-side creative-copy backfill.
//
// We store TWO clearly separated things for every ad, so they can NEVER be
// confused (confusing them caused real, expensive mistakes):
//   • on_image_text  — the words OCR'd off the still image (or a video's
//                       thumbnail frame). Empty for videos/plain photos.
//   • primary_text   — the ad's PRIMARY TEXT (the `body` above the creative).
//                       This is where a video ad's actual copy usually lives.
// For a story-IMAGE ad the copy is on_image_text; for a VIDEO ad the copy is
// primary_text. Storing both means we always have the real copy and never
// mislabel primary text as on-image text.
//
// The old backfill only read ads the dashboard handed an image_url for and
// skipped videos entirely. This one pulls EVERY ad_id per creator and fetches
// the image (or video thumbnail) AND the primary text straight from Meta.
// Bounded per call (60s serverless) and idempotent; call until remaining=0, and
// the daily cron keeps it complete as new ads launch.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION?.trim() || "v24.0"}`;
const PER_CALL = 25;   // ads OCR'd per call (each = 1 Claude vision read)
const CAP_CALL = 60;   // caption-only fills per call (cheap: 2 Meta calls, no vision)
const CONCURRENCY = 5;

// ad_id -> { still-image (or video thumbnail) url, primary text }.
async function fetchCreative(adId: string, token: string): Promise<{ imageUrl: string; body: string }> {
  try {
    const cr = await fetch(`${GRAPH}/${adId}?fields=creative&access_token=${token}`).then((r) => r.json());
    const cid = cr?.creative?.id;
    if (!cid) return { imageUrl: "", body: "" };
    const c = await fetch(`${GRAPH}/${cid}?fields=image_url,thumbnail_url,body&access_token=${token}`).then((r) => r.json());
    return { imageUrl: String(c?.image_url || c?.thumbnail_url || ""), body: String(c?.body || "") };
  } catch {
    return { imageUrl: "", body: "" };
  }
}

async function distinctAdIds(clientKey: CreatorKey): Promise<string[]> {
  const db = getServiceSupabase();
  const ids = new Set<string>();
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
  const db = getServiceSupabase();
  const creators = CREATORS.filter((c) => (!onlyKey || c.key === onlyKey) && firstEnv(c.tokenEnv));
  let ocrProcessed = 0;
  let capProcessed = 0;
  let remaining = 0;
  const perCreator: Record<string, { ocr: number; captions: number; left: number }> = {};

  for (const creator of creators) {
    const token = firstEnv(creator.tokenEnv);
    if (!token) continue;
    let ocrDone = 0;
    let capDone = 0;

    // ── Phase 1: OCR ads with no row yet (also stores their caption). ──
    const adIds = await distinctAdIds(creator.key);
    const unread = await findUnreadAdIds(adIds);
    const todo = [...unread];
    const ocrBudget = Math.max(0, PER_CALL - ocrProcessed);
    const batch = todo.slice(0, ocrBudget);
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      await Promise.allSettled(
        batch.slice(i, i + CONCURRENCY).map(async (adId) => {
          const { imageUrl, body } = await fetchCreative(adId, token);
          if (!imageUrl && !body) return; // leave unread; retry next run
          await getOrExtractCreativeCopy({ adId, imageUrl, clientKey: creator.key, primaryText: body });
        })
      );
    }
    ocrDone = batch.length;
    ocrProcessed += ocrDone;
    remaining += Math.max(0, todo.length - ocrDone);

    // ── Phase 2: fill primary_text on already-read rows that are missing it. ──
    if (capProcessed < CAP_CALL) {
      const { data: needCap } = await db
        .from("ad_creative_copy")
        .select("ad_id")
        .eq("client_key", creator.key)
        .or("primary_text.is.null,primary_text.eq.")
        .limit(Math.max(0, CAP_CALL - capProcessed));
      const capRows = (needCap || []).map((r: { ad_id: string }) => r.ad_id);
      remaining += capRows.length;
      for (let i = 0; i < capRows.length; i += CONCURRENCY) {
        await Promise.allSettled(
          capRows.slice(i, i + CONCURRENCY).map(async (adId) => {
            const { body } = await fetchCreative(adId, token);
            await db.from("ad_creative_copy").update({ primary_text: body || "" }).eq("ad_id", adId);
          })
        );
      }
      capDone = capRows.length;
      capProcessed += capDone;
      remaining -= capDone;
    }

    perCreator[creator.key] = { ocr: ocrDone, captions: capDone, left: Math.max(0, todo.length - ocrDone) };
    if (ocrProcessed >= PER_CALL && capProcessed >= CAP_CALL) break;
  }

  return { ocrProcessed, capProcessed, remaining, perCreator };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const onlyKey = typeof body.creator === "string" ? body.creator : null;
    return NextResponse.json(await runBackfill(onlyKey));
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backfill failed" }, { status: 500 });
  }
}

// GET: the daily cron. Keeps both on_image_text and primary_text complete for
// every ad, every creator, automatically.
export async function GET() {
  try {
    return NextResponse.json(await runBackfill(null));
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Backfill failed" }, { status: 500 });
  }
}
