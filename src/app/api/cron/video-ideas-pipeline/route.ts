import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Keeps the Buyers tab full on its own: every researched $1,200+ buyer gets a 10-video idea set
// (compute-once, a few buyers per run), and any idea set behind the current trend brief gets
// re-graded. Runs on the odd hours so it never overlaps the content-pipeline cron (even hours).
// Also seeds the trend brief + ICP playbook on first run if the weekly cron has not fired yet.
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
  for (const creator of ["tyson", "antwan"]) {
    // Seed the trend brief + ICP playbook if they do not exist yet (no-ops once seeded weekly).
    const ideas = await hit(`/api/buyer-dna/video-ideas/run?creator=${creator}&limit=3&gradeLimit=4`);
    steps.push(ideas);
    const body = (ideas as { body?: { trend_version?: number | null } }).body;
    if (body && body.trend_version === null) {
      steps.push(await hit(`/api/buyer-dna/trends/run?creator=${creator}`));
      steps.push(await hit(`/api/buyer-dna/icp-ideas/run?creator=${creator}`));
    }
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), steps });
}
