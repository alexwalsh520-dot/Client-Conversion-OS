import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
import { getIngestHeartbeat } from "@/lib/content/ingest-heartbeat";
import {
  DEFAULT_STORY_SCHEDULE,
  type Cadence,
  type StorySchedule,
  weekDates,
  etToday,
  dowKey,
  reelMedia,
  carouselMedia,
} from "@/lib/content/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

type SlotState = "done" | "missed" | "pending";
// The post that fills a slot, so the UI can play it and show its real numbers without another fetch.
type SlotPost = {
  ig_media_id: string;
  permalink: string | null;
  thumb: string | null;
  video: string | null;
  taken_at: string | null;
  likes: number;
  comments: number;
  views: number;
  score: number | null;
};
type Slot = {
  slot_type: "reel" | "carousel" | "story";
  slot_index: number;
  state: SlotState;
  manual: boolean;
  label?: string;
  post?: SlotPost;
};
type Day = {
  date: string;
  dow: string;
  is_rest: boolean;
  slots: Slot[];
  reels_posted: number;
  carousels_posted: number;
  reels_target: number;
  carousels_target: number;
  story_label: string | null;
};

// Read the creator's cadence, falling back to the seeded default so the grid renders even before the
// row exists (keeps prod safe if the migration hasn't run yet).
async function getCadence(sb: ReturnType<typeof getServiceSupabase>, creator: string): Promise<Cadence> {
  const { data } = await sb.from("content_cadences").select("*").eq("client_key", creator).maybeSingle();
  const row = data as { reels_per_day?: number; carousels_per_day?: number; story_schedule?: StorySchedule } | null;
  return {
    reels_per_day: row?.reels_per_day ?? 6,
    carousels_per_day: row?.carousels_per_day ?? 1,
    story_schedule: (row?.story_schedule && Object.keys(row.story_schedule).length ? row.story_schedule : DEFAULT_STORY_SCHEDULE),
  };
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const creator = (url.searchParams.get("creator") || "").toLowerCase();
  if (!(CONTENT_CREATORS as readonly string[]).includes(creator)) {
    return NextResponse.json({ error: "Unknown creator" }, { status: 400 });
  }
  const weekParam = url.searchParams.get("week"); // any date in the target week (ET)
  const sb = getServiceSupabase();
  const cadence = await getCadence(sb, creator);

  const dates = weekDates(weekParam || etToday()); // Mon..Sun ET
  const weekStart = dates[0];
  const weekEnd = dates[6];
  const todayET = etToday();

  // Fetch a UTC window that safely brackets the ET week (ET is UTC-4/-5, so pad ±1 day) and then
  // bucket each post onto its true ET calendar date below.
  const { data: posts } = await sb
    .from("creator_content")
    .select("ig_media_id, taken_at, media_type, permalink, thumbnail_url, stored_thumb_url, video_url, stored_video_url, like_count, comment_count, view_count")
    .eq("client_key", creator)
    .gte("taken_at", `${shiftDay(weekStart, -1)}T00:00:00Z`)
    .lt("taken_at", `${shiftDay(weekEnd, 2)}T00:00:00Z`)
    .order("taken_at", { ascending: true });

  type PostRow = {
    ig_media_id: string; taken_at: string; media_type: string | null; permalink: string | null;
    thumbnail_url: string | null; stored_thumb_url: string | null; video_url: string | null;
    stored_video_url: string | null; like_count: number | null; comment_count: number | null; view_count: number | null;
  };
  const rows = (posts || []) as PostRow[];

  // ICP grades for these posts, so a slot can show the score without a second round-trip.
  const ids = rows.map((p) => p.ig_media_id).filter(Boolean);
  const gradeMap = new Map<string, number>();
  if (ids.length) {
    const { data: grades } = await sb
      .from("content_grades")
      .select("ig_media_id, score")
      .eq("client_key", creator)
      .in("ig_media_id", ids);
    for (const g of (grades || []) as { ig_media_id: string; score: number | null }[]) {
      if (g.score != null) gradeMap.set(g.ig_media_id, g.score);
    }
  }

  const toSlotPost = (p: PostRow): SlotPost => ({
    ig_media_id: p.ig_media_id,
    permalink: p.permalink,
    thumb: p.stored_thumb_url || p.thumbnail_url || null,
    video: p.stored_video_url || p.video_url || null,
    taken_at: p.taken_at,
    likes: Number(p.like_count) || 0,
    comments: Number(p.comment_count) || 0,
    views: Number(p.view_count) || 0,
    score: gradeMap.get(p.ig_media_id) ?? null,
  });

  // Posts bucketed onto their ET date, in taken_at order, so slot N holds the Nth post of that day.
  // De-duped by ig_media_id — the same reel can be ingested by both the Graph and Apify paths.
  const reelsByDate = new Map<string, SlotPost[]>();
  const carsByDate = new Map<string, SlotPost[]>();
  const seen = new Set<string>();
  for (const p of rows) {
    const d = etDate(p.taken_at);
    if (d < weekStart || d > weekEnd) continue;
    const key = `${d}|${p.ig_media_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = reelMedia(p.media_type) ? reelsByDate : carouselMedia(p.media_type) ? carsByDate : null;
    if (!bucket) continue;
    const arr = bucket.get(d) || [];
    arr.push(toSlotPost(p));
    bucket.set(d, arr);
  }

  // Manual marks for the week.
  const { data: marks } = await sb
    .from("content_calendar_marks")
    .select("for_date, slot_type, slot_index, done")
    .eq("client_key", creator)
    .gte("for_date", weekStart)
    .lte("for_date", weekEnd);
  const markMap = new Map<string, boolean>();
  for (const m of (marks || []) as { for_date: string; slot_type: string; slot_index: number; done: boolean }[]) {
    markMap.set(`${m.for_date}|${m.slot_type}|${m.slot_index}`, m.done);
  }

  const days: Day[] = dates.map((date) => {
    const dow = dowKey(date);
    const story = cadence.story_schedule[dow];
    const restDay = story == null; // null (or missing) in the schedule = rest day, never red
    const dayOver = date < todayET; // the whole ET day has passed
    const reelPosts = reelsByDate.get(date) || [];
    const carPosts = carsByDate.get(date) || [];
    const reelsPosted = reelPosts.length;
    const carsPosted = carPosts.length;

    const slots: Slot[] = [];
    // A rest day expects nothing — no slots, so it can never go red (spec: "Sun REST, no posts
    // expected, never red"). Non-rest days build their reel + carousel + story slots.
    if (!restDay) {
      // A slot is covered by detection when its 1-based index <= posts detected; a manual mark
      // overrides in either direction. State: done | missed (only once the day is over) | pending.
      const build = (type: "reel" | "carousel", count: number, detectedPosts: SlotPost[]) => {
        // Slots fill in taken_at order: slot i holds the i-th post of that ET day, if it exists.
        for (let i = 1; i <= count; i++) {
          const manual = markMap.get(`${date}|${type}|${i}`);
          const post = detectedPosts[i - 1];
          const covered = manual === undefined ? Boolean(post) : manual;
          const state: SlotState = covered ? "done" : dayOver ? "missed" : "pending";
          slots.push({ slot_type: type, slot_index: i, state, manual: manual !== undefined, ...(post ? { post } : null) });
        }
      };
      build("reel", cadence.reels_per_day, reelPosts);
      build("carousel", cadence.carousels_per_day, carPosts);

      // Stories are manual-only — scrapers cannot see stories, so detection never marks them.
      const manual = markMap.get(`${date}|story|1`);
      const state: SlotState = manual === true ? "done" : dayOver ? "missed" : "pending";
      slots.push({ slot_type: "story", slot_index: 1, state, manual: manual !== undefined, label: story?.label });
    }

    return {
      date,
      dow,
      is_rest: restDay,
      slots,
      reels_posted: reelsPosted,
      carousels_posted: carsPosted,
      reels_target: cadence.reels_per_day,
      carousels_target: cadence.carousels_per_day,
      story_label: restDay ? null : story?.label ?? null,
    };
  });

  // Freshness has to answer two DIFFERENT questions, and the first version conflated them:
  //   1. is the pipeline alive?      -> the ingest heartbeat (a successful run, even if it found
  //                                     nothing new). Only this may raise the "unverified" banner.
  //   2. has the creator posted?     -> newest_post_at. Nothing here, with a live pipeline, means
  //                                     the red slots are HONEST misses, not a broken scrape.
  const [heartbeat, newestPost] = await Promise.all([
    getIngestHeartbeat(sb),
    sb
      .from("creator_content")
      .select("taken_at")
      .eq("client_key", creator)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const newestPostAt = (newestPost.data as { taken_at?: string } | null)?.taken_at ?? null;

  return NextResponse.json({
    creator,
    week_start: weekStart,
    today: todayET,
    cadence,
    days,
    // synced_at now means "the pipeline last pulled successfully", not "we last saw a new post".
    synced_at: heartbeat.last_ok_at,
    sync_age_hours: heartbeat.age_hours,
    sync_stale: heartbeat.stale,
    newest_post_at: newestPostAt,
  });
}

// --- small date helpers kept local to the route (pure string math, no Date-in-ET traps) ---
function etDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function shiftDay(d: string, delta: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}
