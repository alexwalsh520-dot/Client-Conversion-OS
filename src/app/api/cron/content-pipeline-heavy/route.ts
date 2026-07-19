import { NextRequest, NextResponse } from "next/server";
import { cronBaseUrl } from "@/lib/cron-base-url";
import { runPipelineSteps } from "@/lib/content-pipeline/run-steps";
import { ACTIVE_CREATORS } from "@/lib/creators";

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
  // Vercel runs scheduled crons against the Deployment-Protection-guarded deployment host,
  // so sibling fetches must go through the public production alias. See cron-base-url.ts.
  const origin = cronBaseUrl(req);
  // Every per-creator step is derived from the registry (creators.ts `active`), so onboarding or
  // dropping a client never means editing this cron again.
  const result = await runPipelineSteps("content-pipeline-heavy", origin, [
    // Mine new calls + DMs into the content store (compute-once) + refresh audience read. LLM work,
    // > 60s, so it lives here (it starved the fast cron). First, so VOC stays current.
    ...ACTIVE_CREATORS.map((c) => ({ path: `/api/content/mine?creator=${c.key}&limit=8`, timeoutMs: 110000 })),
    // Creators whose IG Graph token is unusable get their reels from the Apify public scrape
    // instead. Metered, so it is opt-in per creator (registry flag), not run for everyone.
    ...ACTIVE_CREATORS.filter((c) => c.usesApifyScrape).map((c) => ({
      path: `/api/content/ingest-apify?creator=${c.key}`,
      timeoutMs: 70000,
    })),
    // Transcribe + permanently store reels still missing either. The single slowest step.
    { path: "/api/content/transcribe?limit=12", timeoutMs: 120000 },
    // Buyer DNA: research newly-closed buyers + grade new posts vs the locked ICP. Bounded per run.
    ...ACTIVE_CREATORS.map((c) => ({ path: `/api/buyer-dna/dossiers/run?creator=${c.key}&limit=15`, timeoutMs: 60000 })),
    ...ACTIVE_CREATORS.map((c) => ({ path: `/api/buyer-dna/grade/run?creator=${c.key}&limit=15`, timeoutMs: 60000 })),
  ], { budgetMs: 280000 });
  return NextResponse.json(result);
}
