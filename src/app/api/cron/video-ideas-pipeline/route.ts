import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const CREATORS = ["tyson", "antwan"] as const;
const TREND_MAX_AGE_MS = 6.5 * 24 * 60 * 60 * 1000; // ~a week

// Single hourly orchestrator that keeps the Buyers + Playbook tabs current on their own, per creator:
//   1. refresh the "what's working on social" trend brief when it ages out (~weekly),
//   2. rebuild the ICP-wide 10-idea playbook when the locked ICP has advanced past what it was built on,
//   3. do one bounded pass of per-buyer idea builds + trend re-grades (compute-once; only new work).
// Each child is bounded by a wall-clock budget so it never 504s. During a refresh burst this parent may
// itself approach its 300s ceiling — that is acceptable: every child commits its own work immediately,
// and the next hourly run finishes the tail.
export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const origin = new URL(req.url).origin;
  const sb = getServiceSupabase();
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
  for (const creator of CREATORS) {
    // 1. Trend brief — refresh if missing or older than ~a week.
    const { data: briefRows } = await sb
      .from("content_trend_briefs")
      .select("searched_at")
      .eq("client_key", creator)
      .order("version", { ascending: false })
      .limit(1);
    const brief = briefRows && briefRows[0] ? (briefRows[0] as { searched_at: string | null }) : null;
    const briefAge = brief?.searched_at ? Date.now() - new Date(brief.searched_at).getTime() : Infinity;
    if (!brief || briefAge > TREND_MAX_AGE_MS) {
      steps.push(await hit(`/api/buyer-dna/trends/run?creator=${creator}`));
    }

    // 2. ICP-wide idea set — rebuild if missing or built against an older locked ICP version.
    const { data: icpRows } = await sb
      .from("creator_icp")
      .select("version")
      .eq("client_key", creator)
      .eq("locked", true)
      .order("version", { ascending: false })
      .limit(1);
    const lockedIcpVersion = icpRows && icpRows[0] ? Number((icpRows[0] as { version: number }).version) : null;
    const { data: icpIdeaRows } = await sb
      .from("content_video_ideas")
      .select("icp_version")
      .eq("client_key", creator)
      .is("person_key", null)
      .limit(1);
    const icpIdea = icpIdeaRows && icpIdeaRows[0] ? (icpIdeaRows[0] as { icp_version: number | null }) : null;
    const icpStale = !icpIdea || (lockedIcpVersion != null && (icpIdea.icp_version ?? 0) < lockedIcpVersion);
    if (lockedIcpVersion != null && icpStale) {
      steps.push(await hit(`/api/buyer-dna/icp-ideas/run?creator=${creator}`));
    }

    // 3. One bounded pass of per-buyer builds + trend-brief re-grades. budgetMs=210000 (~2 grade ops
    //    at ~40s each) mainly drains the weekly re-grade backlog faster — 51 sets converge in ~13h
    //    instead of ~2 days — while steady-state runs stay near-instant no-ops.
    steps.push(await hit(`/api/buyer-dna/video-ideas/run?creator=${creator}&limit=3&gradeLimit=4&budgetMs=210000`));
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), steps });
}
