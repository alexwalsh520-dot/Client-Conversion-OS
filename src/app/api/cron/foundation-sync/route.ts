// Keeps the data foundation always-current on its own. Each run does a bounded,
// idempotent incremental pass (only new rows since the last watermark), so it is
// cheap to run every 15 minutes. Mirrors the content-pipeline cron pattern.

import { NextRequest, NextResponse } from "next/server";
import { cronBaseUrl } from "@/lib/cron-base-url";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Vercel runs scheduled crons against the Deployment-Protection-guarded deployment host,
  // so sibling fetches must go through the public production alias. See cron-base-url.ts.
  const origin = cronBaseUrl(req);
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };

  const steps: unknown[] = [];
  // ok must reflect the children — a green cron whose calls all 401 is how this went unnoticed.
  let failed = 0;
  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { method: "POST", headers: H });
      if (!r.ok) failed++;
      return { path, status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      failed++;
      return { path, error: e instanceof Error ? e.message : "failed" };
    }
  };
  // 1. ingest new events since the watermark, then 2. recompute person_context.
  steps.push(await hit("/api/foundation/sync?lookbackMin=90"));
  steps.push(await hit("/api/foundation/sync?rebuild=all"));

  if (failed) console.error(`[foundation-sync] ${failed} child call(s) failed via ${origin}`);
  return NextResponse.json({ ok: failed === 0, ranAt: new Date().toISOString(), failed, steps });
}
