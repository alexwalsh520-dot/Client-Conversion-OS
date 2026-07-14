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

    // 2. Locked ICP version — used to detect when the playbook + shift brief need rebuilding.
    const { data: icpRows } = await sb
      .from("creator_icp")
      .select("version")
      .eq("client_key", creator)
      .eq("locked", true)
      .order("version", { ascending: false })
      .limit(1);
    const lockedIcpVersion = icpRows && icpRows[0] ? Number((icpRows[0] as { version: number }).version) : null;

    // 2a. Playbook filming sheet (20 hooks + topics) — rebuild if missing, older than ~a week, or built
    //     against an older locked ICP. (The old ICP-wide idea set is no longer maintained here.)
    const { data: pbRows } = await sb
      .from("content_playbooks")
      .select("icp_version, generated_at")
      .eq("client_key", creator)
      .order("version", { ascending: false })
      .limit(1);
    const pb = pbRows && pbRows[0] ? (pbRows[0] as { icp_version: number | null; generated_at: string | null }) : null;
    const pbAge = pb?.generated_at ? Date.now() - new Date(pb.generated_at).getTime() : Infinity;
    const pbStale = !pb || pbAge > TREND_MAX_AGE_MS || (lockedIcpVersion != null && (pb.icp_version ?? 0) < lockedIcpVersion);
    if (pbStale) {
      steps.push(await hit(`/api/buyer-dna/playbook/run?creator=${creator}`));
    }

    // 2b. Playbook shift brief — refresh if missing, older than ~a week, or built against an older ICP.
    const { data: shiftRows } = await sb
      .from("content_shift_briefs")
      .select("icp_version, generated_at")
      .eq("client_key", creator)
      .order("version", { ascending: false })
      .limit(1);
    const shift = shiftRows && shiftRows[0] ? (shiftRows[0] as { icp_version: number | null; generated_at: string | null }) : null;
    const shiftAge = shift?.generated_at ? Date.now() - new Date(shift.generated_at).getTime() : Infinity;
    const shiftStale = !shift || shiftAge > TREND_MAX_AGE_MS || (lockedIcpVersion != null && (shift.icp_version ?? 0) < lockedIcpVersion);
    if (shiftStale) {
      steps.push(await hit(`/api/buyer-dna/shift/run?creator=${creator}`));
    }

    // 2c. Buyer-voice overview — refresh if missing, older than ~a week, or built against an older ICP.
    //     (Self-skips inside the route when there aren't enough researched buyers yet.)
    const { data: voiceRows } = await sb
      .from("content_buyer_voice")
      .select("icp_version, generated_at")
      .eq("client_key", creator)
      .order("version", { ascending: false })
      .limit(1);
    const voice = voiceRows && voiceRows[0] ? (voiceRows[0] as { icp_version: number | null; generated_at: string | null }) : null;
    const voiceAge = voice?.generated_at ? Date.now() - new Date(voice.generated_at).getTime() : Infinity;
    const voiceStale = !voice || voiceAge > TREND_MAX_AGE_MS || (lockedIcpVersion != null && (voice.icp_version ?? 0) < lockedIcpVersion);
    if (voiceStale) {
      steps.push(await hit(`/api/buyer-dna/voice/run?creator=${creator}`));
    }

    // 3. One bounded pass of per-buyer builds + trend-brief re-grades. budgetMs=210000 (~2 grade ops
    //    at ~40s each) mainly drains the weekly re-grade backlog faster — 51 sets converge in ~13h
    //    instead of ~2 days — while steady-state runs stay near-instant no-ops.
    steps.push(await hit(`/api/buyer-dna/video-ideas/run?creator=${creator}&limit=3&gradeLimit=4&budgetMs=210000`));
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), steps });
}
