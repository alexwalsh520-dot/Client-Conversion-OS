import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { cronBaseUrl } from "@/lib/cron-base-url";
import { ACTIVE_CREATORS } from "@/lib/creators";
import { reconcileCreator } from "@/lib/content/calendar-reconcile";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Hourly calendar reconciliation. Each tick, for every active creator, any past client-local day
// that isn't finalized gets a fresh ingest and is re-judged; a day is FINALIZED only once it ended
// at least 6h ago locally, so a slow scrape can still upgrade a CLAIMED slot to VERIFIED first.
// Hourly (not midnight-only) because creators live in different zones — every local midnight is
// somebody's, and re-running a finalized day is a no-op.
//
// House patterns: sibling routes go through cronBaseUrl (the deployment host is
// Deployment-Protection guarded), and a child is only successful if its BODY says so — a 2xx alone
// is not success here. Zero LLM.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = cronBaseUrl(req);
  const sb = getServiceSupabase();
  let failed = 0;

  const ingestFor = (creator: string) => async () => {
    const r = await fetch(`${origin}/api/content/ingest?creator=${creator}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await r.json().catch(() => null)) as { ok?: boolean } | null;
    // 207-with-ok:false is how a failing ingest used to pass as green. Treat it as the failure it is.
    if (!r.ok || body?.ok === false) {
      failed++;
      throw new Error(`ingest failed (${r.status})`);
    }
  };

  const results: unknown[] = [];
  for (const c of ACTIVE_CREATORS) {
    try {
      results.push(await reconcileCreator(sb, c.key, { ingest: ingestFor(c.key) }));
    } catch (e) {
      failed++;
      results.push({ creator: c.key, error: e instanceof Error ? e.message : "failed" });
    }
  }

  if (failed) console.error(`[calendar-reconcile] ${failed} failure(s) via ${origin}`);
  return NextResponse.json({ ok: failed === 0, ranAt: new Date().toISOString(), failed, results });
}
