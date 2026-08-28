// Deal Analysis: period-wide list of reviewed + queued sales calls, per-closer
// rollup, latest digest, and queue status. Powers the Deal Analysis page hero.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { looksLikeSalesCall } from "@/lib/call-reviews";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OWNER_EMAILS = ["alexwalsh520@gmail.com", "matthew@clientconversion.io"];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!OWNER_EMAILS.includes(session?.user?.email?.toLowerCase() || "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 7), 120);
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const sinceDate = since.slice(0, 10);
  const sb = getServiceSupabase();

  const [reviewsRes, callsRes, digestRes, runningRes] = await Promise.all([
    sb.from("mm_call_reviews")
      .select("fathom_id,call_date,prospect_name,closer,outcome,grade,adherence_score,model,created_at")
      .gte("call_date", sinceDate)
      .order("call_date", { ascending: false }),
    sb.from("fathom_calls")
      .select("fathom_id,title,recorded_at,duration_sec,prospect_name,attendees,transcript")
      .gte("recorded_at", since)
      .not("transcript", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(400),
    sb.from("mm_daily_digests")
      .select("digest_date,digest_md,review_count")
      .order("digest_date", { ascending: false })
      .limit(1),
    sb.from("mm_review_runs")
      .select("fathom_id", { count: "exact", head: true })
      .eq("status", "running").eq("kind", "call"),
  ]);

  const callById: Record<string, { title: string | null; recorded_at: string | null; duration_sec: number | null }> = {};
  for (const c of callsRes.data || []) {
    callById[String(c.fathom_id)] = {
      title: c.title as string | null,
      recorded_at: c.recorded_at as string | null,
      duration_sec: c.duration_sec as number | null,
    };
  }

  const reviewedIds = new Set((reviewsRes.data || []).map((r) => String(r.fathom_id)));

  // Reviewed deals in the window.
  const deals = (reviewsRes.data || []).map((r) => {
    const call = callById[String(r.fathom_id)];
    return {
      fathomId: r.fathom_id,
      date: r.call_date,
      time: call?.recorded_at ?? null,
      prospect: (r.prospect_name as string) || call?.title || "Unknown prospect",
      title: call?.title ?? null,
      closer: (r.closer as string) || null,
      outcome: (r.outcome as string) || null,
      grade: (r.grade as number) ?? null,
      adherence: (r.adherence_score as number) ?? null,
      durationMin: call?.duration_sec ? Math.round((call.duration_sec as number) / 60) : null,
      reviewed: true,
    };
  });

  // Queued: recent sales calls with no review yet (the engine reaches them
  // newest-first, ~2 per half hour).
  const queued = (callsRes.data || [])
    .filter((c) => !reviewedIds.has(String(c.fathom_id)) && looksLikeSalesCall(c))
    .map((c) => ({
      fathomId: c.fathom_id,
      date: c.recorded_at ? String(c.recorded_at).slice(0, 10) : null,
      time: c.recorded_at as string | null,
      prospect: (c.prospect_name as string) || (c.title as string) || "Unknown prospect",
      title: c.title as string | null,
      closer: null as string | null,
      outcome: null as string | null,
      grade: null as number | null,
      adherence: null as number | null,
      durationMin: c.duration_sec ? Math.round((c.duration_sec as number) / 60) : null,
      reviewed: false,
    }));

  // Per-closer rollup over the window.
  const byCloser: Record<string, { grades: number[]; adherence: number[]; won: number; total: number }> = {};
  for (const r of reviewsRes.data || []) {
    const name = String(r.closer || "").trim();
    if (!name) continue;
    const b = (byCloser[name] = byCloser[name] || { grades: [], adherence: [], won: 0, total: 0 });
    b.total += 1;
    if (typeof r.grade === "number") b.grades.push(r.grade);
    if (typeof r.adherence_score === "number") b.adherence.push(r.adherence_score);
    if (String(r.outcome || "").toLowerCase() === "won") b.won += 1;
  }
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const closers = Object.entries(byCloser)
    .map(([name, b]) => ({
      name,
      calls: b.total,
      avgGrade: avg(b.grades),
      avgAdherence: avg(b.adherence),
      won: b.won,
      closeRate: b.total > 0 ? Math.round((b.won / b.total) * 100) : null,
    }))
    .sort((a, b) => b.calls - a.calls);

  const graded = deals.filter((d) => typeof d.grade === "number");
  const decided = deals.filter((d) => d.outcome && d.outcome !== "unclear");
  const won = deals.filter((d) => String(d.outcome || "").toLowerCase() === "won").length;

  return NextResponse.json({
    days,
    deals: [...queued, ...deals].sort((a, b) =>
      String(b.time || b.date || "").localeCompare(String(a.time || a.date || ""))
    ),
    stats: {
      reviewed: deals.length,
      queued: queued.length,
      inFlight: runningRes.count ?? 0,
      avgGrade: avg(graded.map((d) => d.grade as number)),
      won,
      closeRate: decided.length > 0 ? Math.round((won / decided.length) * 100) : null,
    },
    closers,
    digest: digestRes.data?.[0]
      ? { date: digestRes.data[0].digest_date, md: digestRes.data[0].digest_md, reviewCount: digestRes.data[0].review_count }
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
