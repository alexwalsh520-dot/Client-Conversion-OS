import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getIngestHeartbeat } from "@/lib/content/ingest-heartbeat";
import { resolveCalendarAccess } from "@/lib/content/calendar-access";
import { buildDay, getCadence, getDayRecords, getMarks, getPostsByDate, type Day } from "@/lib/content/calendar-build";
import { todayIn, weekDates } from "@/lib/content/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The week grid for one creator, in that creator's own timezone.
// Access: operator session / CRON_SECRET (?creator=) OR a share token (?token=). When a token is
// used the creator is derived FROM THE TOKEN and any client-supplied creator is ignored.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const access = await resolveCalendarAccess(req, url.searchParams.get("token"), url.searchParams.get("creator"));
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const creator = access.creator;

  const sb = getServiceSupabase();
  const cadence = await getCadence(sb, creator);
  const tz = cadence.timezone;

  const dates = weekDates(url.searchParams.get("week") || todayIn(tz)); // Mon..Sun, client-local
  const weekStart = dates[0];
  const weekEnd = dates[6];
  const todayLocal = todayIn(tz);

  const [{ reels, carousels }, marks, records, heartbeat, newestPost] = await Promise.all([
    getPostsByDate(sb, creator, weekStart, weekEnd, tz),
    getMarks(sb, creator, weekStart, weekEnd),
    getDayRecords(sb, creator, weekStart, weekEnd),
    getIngestHeartbeat(sb),
    sb.from("creator_content").select("taken_at").eq("client_key", creator).order("taken_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const days: Day[] = dates.map((date) =>
    buildDay({
      date,
      cadence,
      reelPosts: reels.get(date) || [],
      carPosts: carousels.get(date) || [],
      marks,
      record: records.get(date),
    }),
  );

  return NextResponse.json({
    creator,
    viewer: access.viewer,
    week_start: weekStart,
    today: todayLocal,
    timezone: tz,
    cadence,
    days,
    // Self-reported, so it sits beside the quota numbers rather than inside them.
    trial_reels_week: days.reduce((n, d) => n + d.trial_reels, 0),
    // Two separate facts, never merged: did the pipeline run, and did the creator post.
    synced_at: heartbeat.last_ok_at,
    sync_age_hours: heartbeat.age_hours,
    sync_stale: heartbeat.stale,
    newest_post_at: (newestPost.data as { taken_at?: string } | null)?.taken_at ?? null,
  });
}
