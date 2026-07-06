// Keeps the data foundation always-current on its own. Each run does a bounded,
// idempotent incremental pass (only new rows since the last watermark), so it is
// cheap to run every 15 minutes. Mirrors the content-pipeline cron pattern.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };

  const steps: unknown[] = [];
  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { method: "POST", headers: H });
      return { path, status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      return { path, error: e instanceof Error ? e.message : "failed" };
    }
  };
  // 1. ingest new events since the watermark, then 2. recompute person_context.
  steps.push(await hit("/api/foundation/sync?lookbackMin=90"));
  steps.push(await hit("/api/foundation/sync?rebuild=all"));

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), steps });
}
