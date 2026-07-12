import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Weekly refresh of the LEARNED parts: re-derive Tyson's ICP from all qualifying buyers (it evolves
// as new $1200+ buyers close), then regenerate the buyer-grounded content angles for both creators.
// The trend brief and the ICP-wide + per-buyer idea playbooks are refreshed/graded by the hourly
// video-ideas-pipeline cron (it detects the new ICP version and re-runs trends + icp-ideas), so they
// are intentionally NOT triggered here — chaining them made this function exceed its own 300s ceiling
// and silently drop the tail steps. Antwan's ICP is fixed, so it is not re-derived here.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };
  const hit = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { method: "POST", headers: H });
      return { path, status: r.status, body: await r.json().catch(() => null) };
    } catch (e) {
      return { path, error: e instanceof Error ? e.message : "failed" };
    }
  };

  const steps: unknown[] = [];
  steps.push(await hit("/api/buyer-dna/icp/generate?creator=tyson"));
  steps.push(await hit("/api/buyer-dna/angles/run?creator=tyson"));
  steps.push(await hit("/api/buyer-dna/angles/run?creator=antwan"));

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), steps });
}
