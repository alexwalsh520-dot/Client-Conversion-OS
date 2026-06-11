// /api/ads-leaderboard/public  (PUBLIC, no auth)
// Powers the front-facing leaderboard. Returns ranked competing ads with ONLY
// safe display fields — first name, video, rank, live flag. No spend / ROAS /
// budget is ever exposed here; performance is used purely to order the list.

import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAdMetrics } from "@/lib/ads-leaderboard/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firstName(full: string | null): string {
  const n = (full || "").trim();
  if (!n) return "Anonymous";
  return n.split(/\s+/)[0];
}

export async function GET() {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("ad_contest_entries")
    .select("id, contestant_name, creator_key, video_url, status, ad_id, submitted_at")
    .in("status", ["submitted", "live"])
    .order("submitted_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const adIds = rows.map((r) => r.ad_id).filter(Boolean) as string[];
  const metrics = adIds.length > 0 ? await getAdMetrics(db, adIds).catch(() => ({})) : {};

  const scored = rows.map((r) => {
    const m = r.ad_id ? (metrics as Record<string, { roas: number | null; spend: number }>)[r.ad_id] : null;
    // Rank score: live ads with real performance first (by ROAS, then spend),
    // then everything else by recency. ROAS itself is never returned.
    const roas = m?.roas ?? null;
    return {
      id: r.id as string,
      name: firstName(r.contestant_name),
      creator: (r.creator_key as string | null) || null,
      videoUrl: (r.video_url as string | null) || null,
      live: r.status === "live" && !!r.ad_id,
      _roas: roas,
      _spend: m?.spend ?? 0,
      _at: r.submitted_at ? Date.parse(r.submitted_at as string) : 0,
    };
  });

  scored.sort((a, b) => {
    const ar = a._roas, br = b._roas;
    if (ar != null && br != null && ar !== br) return br - ar;
    if ((ar != null) !== (br != null)) return ar != null ? -1 : 1;
    if (a._spend !== b._spend) return b._spend - a._spend;
    return b._at - a._at;
  });

  const entries = scored.map((s, i) => ({
    id: s.id,
    name: s.name,
    creator: s.creator,
    videoUrl: s.videoUrl,
    live: s.live,
    rank: i + 1,
  }));
  return NextResponse.json({ entries, count: entries.length });
}
