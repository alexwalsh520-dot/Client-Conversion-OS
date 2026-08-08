import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getOrExtractCreativeCopy, findUnreadAdIds } from "@/lib/ads-tracker/creative-copy";
import { runTranscriptPass, type TranscriptRunResult } from "@/lib/ads-tracker/creative-transcript";
import { CREATORS, firstEnv, type CreatorKey } from "@/lib/creators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// COMPREHENSIVE server-side creative-copy backfill.
//
// We store TWO clearly separated things for every ad, so they can NEVER be
// confused (confusing them caused real, expensive mistakes):
//   • on_image_text  — the words OCR'd off the still image (or a video's
//                       thumbnail frame). Empty for videos/plain photos.
//   • primary_text   — the ad's PRIMARY TEXT (the `body` above the creative),
//                       i.e. the CAPTION. Storing it separately means we never
//                       mislabel it as on-image text.
// This file used to say that for a VIDEO ad the copy IS primary_text. Brick 7
// proved that wrong: a video ad's copy is the VIDEO — what is spoken in it and
// what is printed on its frames — and the caption is a different thing that
// often says something else entirely. See phase 3 below.
//
// The old backfill only read ads the dashboard handed an image_url for and
// skipped videos entirely. This one pulls EVERY ad_id per creator and fetches
// the image (or video thumbnail) AND the primary text straight from Meta.
// Bounded per call and idempotent; call until remaining=0, and the two-hourly
// cron keeps it complete as new ads launch.
//
// BRICK 7 adds a THIRD thing, on this same cron rather than a new one:
//   • transcript     — the SPOKEN WORDS of a video ad, from the ad's own video,
//                       stored in ad_creative_transcripts. For a video ad this
//                       is the copy; the thumbnail OCR above is empty by design
//                       and primary_text is the caption, not the ad.
// Each pass is bounded and isolated (see creative-transcript.ts): one video that
// will not resolve or download gets a failed row with a written reason and the
// run carries on.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION?.trim() || "v24.0"}`;
const PER_CALL = 25;   // ads OCR'd per call (each = 1 Claude vision read)
const CAP_CALL = 60;   // caption-only fills per call (cheap: 2 Meta calls, no vision)
const CONCURRENCY = 5;
// Videos transcribed per call, and the wall-clock they may take. Deliberately
// modest: a video is a download plus a speech-to-text round trip, so it is the
// expensive phase, and it is the one that must never eat the function's ceiling.
const TRANSCRIPTS_PER_CALL = 10;
// 100s, chosen against the function's 300s ceiling: the budget is checked
// BETWEEN ads, so the worst case is this budget plus one slowest ad (a 90s
// download and a 90s model call), which lands inside 300 with room for the two
// OCR phases above.
const TRANSCRIPT_BUDGET_MS = 100_000;

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
      const { data: allRows } = await db
        .from("ad_creative_copy")
        .select("ad_id,primary_text")
        .eq("client_key", creator.key);
      const capRows = (allRows || [])
        .filter((r: { primary_text: string | null }) => !r.primary_text || !String(r.primary_text).trim())
        .map((r: { ad_id: string }) => r.ad_id)
        .slice(0, Math.max(0, CAP_CALL - capProcessed));
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

  // ── Phase 3 (Brick 7): the words a VIDEO ad says. ──────────────────────
  // Isolated from the two phases above on purpose: a transcription problem
  // must never cost the OCR backfill its run, and the OCR phases must never
  // eat the whole budget and starve the videos. Whatever this returns, the
  // response carries it verbatim, including every failure.
  let transcripts: TranscriptRunResult | { error: string };
  try {
    transcripts = await runTranscriptPass({
      creators: creators.map((c) => ({ key: c.key, token: firstEnv(c.tokenEnv)! })),
      perRun: TRANSCRIPTS_PER_CALL,
      budgetMs: TRANSCRIPT_BUDGET_MS,
    });
  } catch (err) {
    transcripts = { error: err instanceof Error ? err.message : String(err) };
  }

  return { ocrProcessed, capProcessed, remaining, perCreator, transcripts };
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
