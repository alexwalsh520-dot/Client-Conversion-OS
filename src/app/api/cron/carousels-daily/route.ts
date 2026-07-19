import { NextRequest, NextResponse } from "next/server";
import { cronBaseUrl } from "@/lib/cron-base-url";
import { ACTIVE_CREATORS } from "@/lib/creators";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Derived from the registry (creators.ts `active`), never hardcoded — dropping a client is a
// one-line change there, not an edit to every cron.
const CREATORS = ACTIVE_CREATORS.map((c) => c.key);

// Just after midnight America/New_York, put today's 5 carousels in front of each creator so the tab is
// full when the team opens it — rather than waiting on the hourly pipeline, which only reaches its
// carousels step after the video-ideas pass has spent its budget.
//
// Scheduled twice (04:35 + 05:35 UTC) so one of them lands just after midnight in both EDT and EST.
// Costs nothing extra: the generate route returns the day's existing rows untouched and never makes an
// LLM call once they exist, so the second run — and the hourly pipeline's own carousels block, which
// stays as a self-heal — are no-ops.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const base = cronBaseUrl(req);
  const forDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };

  const steps: unknown[] = [];
  let failed = 0;
  for (const creator of CREATORS) {
    try {
      const r = await fetch(`${base}/api/content/carousels/generate?creator=${creator}&date=${forDate}`, {
        method: "POST",
        headers: H,
      });
      if (!r.ok) failed++;
      steps.push({ creator, status: r.status, body: await r.json().catch(() => null) });
    } catch (e) {
      failed++;
      steps.push({ creator, error: e instanceof Error ? e.message : "failed" });
    }
  }

  if (failed) console.error(`[carousels-daily] ${failed} generate call(s) failed via ${base}`);
  return NextResponse.json({ ok: failed === 0, forDate, failed, steps });
}
