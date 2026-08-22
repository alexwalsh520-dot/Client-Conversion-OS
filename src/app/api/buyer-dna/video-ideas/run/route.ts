import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getCurrentIcp } from "@/lib/buyer-dna/icp";
import { getCurrentTrendBrief } from "@/lib/buyer-dna/trends";
import { generateBuyerIdeas, gradeIdeaSet } from "@/lib/buyer-dna/video-ideas";
import type { Research } from "@/lib/buyer-dna/dossier";
import { IDEA_TREND_GRADING_ENABLED } from "@/lib/content/ai-spend-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

// Per-buyer video ideas, compute-once: builds 10 ideas for each qualifying buyer that has a
// researched dossier but no idea set yet, then grades any idea sets that have not been graded against
// the CURRENT trend brief. limit/gradeLimit cap the work; a wall-clock budget (budgetMs) stops the run
// cleanly before Vercel's 300s ceiling since each LLM op runs ~85s. Self-heals via the hourly cron.
export async function POST(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const slug = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(slug)) return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  const limit = Math.min(Number(url.searchParams.get("limit") || 3), 10);
  const gradeLimit = Math.min(Number(url.searchParams.get("gradeLimit") || 4), 12);
  // Wall-clock budget so the route stops cleanly before Vercel's 300s ceiling (LLM calls ~85s each).
  const budgetMs = Math.min(Math.max(Number(url.searchParams.get("budgetMs") || 240000), 30000), 270000);
  const start = Date.now();
  // ~90s headroom: only begin another LLM op if there is comfortably room for one more.
  const canProceed = () => Date.now() - start + 90_000 < budgetMs;
  let budgetExhausted = false;

  const sb = getServiceSupabase();
  const current = await getCurrentIcp(sb, slug);
  const icpVersion = current ? Number((current as { version: number }).version) : null;

  // 1. Buyers with real research but no idea set yet.
  const { data: dossiers } = await sb
    .from("buyer_dossiers")
    .select("person_key, subscriber_id, display_name, close_date, first_keyword, research")
    .eq("client_key", slug)
    .eq("qualifies_icp", true)
    .order("close_date", { ascending: false })
    .limit(300);
  const researched = ((dossiers || []) as { person_key: string; subscriber_id: string | null; display_name: string; close_date: string | null; first_keyword: string | null; research: Research }[])
    .filter((d) => d.research && Object.keys(d.research).length > 0);

  const { data: existing, error: tableErr } = await sb
    .from("content_video_ideas")
    .select("person_key")
    .eq("client_key", slug)
    .not("person_key", "is", null);
  if (tableErr) {
    return NextResponse.json({ ok: false, reason: `content_video_ideas not readable (${tableErr.message}). Run the migration first.` });
  }
  const done = new Set((existing || []).map((r) => (r as { person_key: string }).person_key));
  const todo = researched.filter((d) => !done.has(d.person_key));
  const batch = todo.slice(0, limit);

  const anthropic = new Anthropic();
  let built = 0, errored = 0, attempted = 0;
  for (const d of batch) {
    if (!canProceed()) { budgetExhausted = true; break; }
    attempted++;
    const res = await generateBuyerIdeas(sb, slug, d, icpVersion, anthropic, { canProceed });
    if (res === "built") built++;
    else errored++;
  }

  // 2. Grade idea sets that are behind the current trend brief (includes the ICP-wide set).
  //    Off on cost grounds — see IDEA_TREND_GRADING_ENABLED. Ideas are still generated above;
  //    they just arrive unranked, and `stale` stays 0 so nothing accumulates a backlog.
  let graded = 0, staleCount = 0;
  const brief = IDEA_TREND_GRADING_ENABLED ? await getCurrentTrendBrief(sb, slug) : null;
  if (brief) {
    const { data: stale } = await sb
      .from("content_video_ideas")
      .select("person_key, trend_version")
      .eq("client_key", slug);
    const staleKeys = new Set<string>();
    for (const r of (stale || []) as { person_key: string | null; trend_version: number | null }[]) {
      if ((r.trend_version || 0) < brief.version) staleKeys.add(r.person_key === null ? " icp" : r.person_key);
    }
    staleCount = staleKeys.size;
    for (const key of [...staleKeys].slice(0, gradeLimit)) {
      if (!canProceed()) { budgetExhausted = true; break; }
      const res = await gradeIdeaSet(sb, slug, key === " icp" ? null : key, brief.brief, brief.version, anthropic, { canProceed });
      if (res === "graded") graded++;
    }
  }

  const remaining = todo.length - attempted;
  return NextResponse.json({
    ok: true,
    creator: slug,
    researched_buyers: researched.length,
    built,
    errored,
    graded,
    trend_version: brief?.version ?? null,
    remaining,
    budget_exhausted: budgetExhausted,
    // Sets still behind the current trend brief after this run (0 = fully converged; no brief → 0).
    stale_grades_remaining: Math.max(0, staleCount - graded),
    note: remaining ? `Run again, ${remaining} buyers still need idea sets.` : "All researched buyers have idea sets.",
  });
}
