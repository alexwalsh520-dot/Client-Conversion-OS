import { NextRequest, NextResponse } from "next/server";
import { runPipelineSteps } from "@/lib/content-pipeline/run-steps";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// HEAVY / slow half of the content pipeline: transcription, the Apify reel scrape, and buyer-DNA LLM
// research + grading. Split out from the fast half (fathom + calls) so these long-running steps get
// their own function budget and can never again starve Fathom/call ingestion. Each step is bounded by
// its own timeout under a total budget; whatever does not finish this run resumes next run (all steps
// are compute-once / idempotent). Logged to content_pipeline_runs.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const result = await runPipelineSteps("content-pipeline-heavy", origin, [
    // Tyson's IG Graph token is dead - pull his reels via Apify (public scrape). Slow, so it is here.
    { path: "/api/content/ingest-apify?creator=tyson", timeoutMs: 70000 },
    // Transcribe + permanently store reels still missing either. The single slowest step.
    { path: "/api/content/transcribe?limit=12", timeoutMs: 120000 },
    // Buyer DNA: research newly-closed buyers + grade new posts vs the locked ICP. Bounded per run.
    { path: "/api/buyer-dna/dossiers/run?creator=tyson&limit=15", timeoutMs: 60000 },
    { path: "/api/buyer-dna/dossiers/run?creator=antwan&limit=15", timeoutMs: 60000 },
    { path: "/api/buyer-dna/grade/run?creator=tyson&limit=15", timeoutMs: 60000 },
    { path: "/api/buyer-dna/grade/run?creator=antwan&limit=15", timeoutMs: 60000 },
  ], { budgetMs: 280000 });
  return NextResponse.json(result);
}
