import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { cronBaseUrl } from "@/lib/cron-base-url";
import { ACTIVE_CREATORS } from "@/lib/creators";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Derived from the registry (creators.ts `active`), never hardcoded — dropping a client is a
// one-line change there, not an edit to every cron.
const CREATORS = ACTIVE_CREATORS.map((c) => c.key);
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
  const origin = cronBaseUrl(req);
  const sb = getServiceSupabase();
  const H = { Authorization: `Bearer ${process.env.CRON_SECRET}`, "Content-Type": "application/json" };
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

  // Load-cut: the six "newest row per creator" lookups are hoisted OUT of the per-creator loop and
  // batched with `.in("client_key", CREATORS)` — one query per table instead of one per creator per
  // table (was 6×N queries/tick, now 6). The staleness logic only ever inspects each creator's newest
  // row, so grouping the version-ordered result by client_key yields the identical values and the
  // identical child-call decisions. Pure query-count reduction, zero behavior change.
  const todayET = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const newestByCreator = <T extends { client_key: string }>(rows: T[] | null): Map<string, T> => {
    const m = new Map<string, T>();
    for (const r of rows || []) if (!m.has(r.client_key)) m.set(r.client_key, r); // rows arrive version-desc
    return m;
  };
  const [trendRes, icpRes, pbRes, shiftRes, voiceRes, carRes] = await Promise.all([
    sb.from("content_trend_briefs").select("client_key, searched_at").in("client_key", CREATORS).order("version", { ascending: false }),
    sb.from("creator_icp").select("client_key, version").in("client_key", CREATORS).eq("locked", true).order("version", { ascending: false }),
    sb.from("content_playbooks").select("client_key, icp_version, generated_at").in("client_key", CREATORS).order("version", { ascending: false }),
    sb.from("content_shift_briefs").select("client_key, icp_version, generated_at").in("client_key", CREATORS).order("version", { ascending: false }),
    sb.from("content_buyer_voice").select("client_key, icp_version, generated_at").in("client_key", CREATORS).order("version", { ascending: false }),
    sb.from("content_carousels").select("client_key").in("client_key", CREATORS).eq("for_date", todayET),
  ]);
  const trendMap = newestByCreator(trendRes.data as ({ client_key: string; searched_at: string | null })[] | null);
  const icpMap = newestByCreator(icpRes.data as ({ client_key: string; version: number })[] | null);
  const pbMap = newestByCreator(pbRes.data as ({ client_key: string; icp_version: number | null; generated_at: string | null })[] | null);
  const shiftMap = newestByCreator(shiftRes.data as ({ client_key: string; icp_version: number | null; generated_at: string | null })[] | null);
  const voiceMap = newestByCreator(voiceRes.data as ({ client_key: string; icp_version: number | null; generated_at: string | null })[] | null);
  const carCounts = new Map<string, number>();
  for (const r of (carRes.data || []) as { client_key: string }[]) carCounts.set(r.client_key, (carCounts.get(r.client_key) || 0) + 1);

  const steps: unknown[] = [];
  for (const creator of CREATORS) {
    // 1. Trend brief — refresh if missing or older than ~a week.
    const brief = trendMap.get(creator) ?? null;
    const briefAge = brief?.searched_at ? Date.now() - new Date(brief.searched_at).getTime() : Infinity;
    if (!brief || briefAge > TREND_MAX_AGE_MS) {
      steps.push(await hit(`/api/buyer-dna/trends/run?creator=${creator}`));
    }

    // 2. Locked ICP version — used to detect when the playbook + shift brief need rebuilding.
    const icpRow = icpMap.get(creator) ?? null;
    const lockedIcpVersion = icpRow ? Number(icpRow.version) : null;

    // 2a. Playbook filming sheet (20 hooks + topics) — rebuild if missing, older than ~a week, or built
    //     against an older locked ICP. (The old ICP-wide idea set is no longer maintained here.)
    const pb = pbMap.get(creator) ?? null;
    const pbAge = pb?.generated_at ? Date.now() - new Date(pb.generated_at).getTime() : Infinity;
    const pbStale = !pb || pbAge > TREND_MAX_AGE_MS || (lockedIcpVersion != null && (pb.icp_version ?? 0) < lockedIcpVersion);
    if (pbStale) {
      steps.push(await hit(`/api/buyer-dna/playbook/run?creator=${creator}`));
    }

    // 2b. Playbook shift brief — refresh if missing, older than ~a week, or built against an older ICP.
    const shift = shiftMap.get(creator) ?? null;
    const shiftAge = shift?.generated_at ? Date.now() - new Date(shift.generated_at).getTime() : Infinity;
    const shiftStale = !shift || shiftAge > TREND_MAX_AGE_MS || (lockedIcpVersion != null && (shift.icp_version ?? 0) < lockedIcpVersion);
    if (shiftStale) {
      steps.push(await hit(`/api/buyer-dna/shift/run?creator=${creator}`));
    }

    // 2c. Buyer-voice overview — refresh if missing, older than ~a week, or built against an older ICP.
    //     (Self-skips inside the route when there aren't enough researched buyers yet.)
    const voice = voiceMap.get(creator) ?? null;
    const voiceAge = voice?.generated_at ? Date.now() - new Date(voice.generated_at).getTime() : Infinity;
    const voiceStale = !voice || voiceAge > TREND_MAX_AGE_MS || (lockedIcpVersion != null && (voice.icp_version ?? 0) < lockedIcpVersion);
    if (voiceStale) {
      steps.push(await hit(`/api/buyer-dna/voice/run?creator=${creator}`));
    }

    // 2d. Daily carousels — generate today's 5 if they don't exist yet. The generate route is a no-op
    //     (no LLM call) once the day's rows exist, so this fires exactly one LLM op/day/creator.
    if ((carCounts.get(creator) ?? 0) < 5) {
      steps.push(await hit(`/api/content/carousels/generate?creator=${creator}&date=${todayET}`));
    }

    // 3. One bounded pass of per-buyer builds + trend-brief re-grades. budgetMs=210000 (~2 grade ops
    //    at ~40s each) mainly drains the weekly re-grade backlog faster — 51 sets converge in ~13h
    //    instead of ~2 days — while steady-state runs stay near-instant no-ops.
    steps.push(await hit(`/api/buyer-dna/video-ideas/run?creator=${creator}&limit=3&gradeLimit=4&budgetMs=210000`));
  }

  // ok reflects the children, not just "the loop finished" — a cron that reports green while every
  // child 401s is how this went unnoticed for days.
  if (failed) console.error(`[video-ideas-pipeline] ${failed} child call(s) failed via ${origin}`);
  return NextResponse.json({ ok: failed === 0, ranAt: new Date().toISOString(), failed, steps });
}
