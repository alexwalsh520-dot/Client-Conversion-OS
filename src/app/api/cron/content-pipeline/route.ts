import { NextRequest, NextResponse } from "next/server";
import { runPipelineSteps, checkPolledFreshness } from "@/lib/content-pipeline/run-steps";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// FAST / critical half of the content pipeline. Fathom ingestion + call/DM mining run FIRST and each
// under its own timeout, so the slow media steps (transcription, Apify scrape, buyer-DNA LLM work, now
// in /api/cron/content-pipeline-heavy) can never starve them again. This chain being sequential and
// unbounded is what froze Fathom + everything after it for 9 days (the function hit its 300s limit and
// was killed mid-run, so later steps never executed). Every run is logged to content_pipeline_runs, and
// a freshness guard writes an alert if a polled source goes > 24h stale.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const result = await runPipelineSteps("content-pipeline", origin, [
    // 1. Fathom calls FIRST (webhook handles real time; this catches gaps). Was step 4, behind the slow
    //    transcription that starved it.
    { path: "/api/content/fathom-backfill?pages=6", timeoutMs: 90000 },
    // 2. Mine new calls + DMs into the content store (compute-once) + refresh audience read.
    { path: "/api/content/mine?creator=tyson&limit=8", timeoutMs: 60000 },
    { path: "/api/content/mine?creator=antwan&limit=8", timeoutMs: 60000 },
    // 3. Pull newest reels metadata (cheap; refreshes urls so the heavy transcription step has work).
    { path: "/api/content/ingest", timeoutMs: 45000 },
    // 4. Account snapshot: record today's follower count so the trend curve grows.
    { path: "/api/content/snapshot-account", timeoutMs: 20000 },
  ], { budgetMs: 250000 });

  const stale = await checkPolledFreshness().catch(() => []);
  return NextResponse.json({ ...result, stale_sources: stale });
}
