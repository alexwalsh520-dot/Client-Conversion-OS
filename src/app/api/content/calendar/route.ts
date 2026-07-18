import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CONTENT_CREATORS } from "@/lib/instagram-content";
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
type Slot = { slot_type: "reel" | "carousel" | "story"; slot_index: number; state: SlotState; manual: boolean; label?: string };
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
    .select("taken_at, media_type")
    .eq("client_key", creator)
    .gte("taken_at", `${shiftDay(weekStart, -1)}T00:00:00Z`)
    .lt("taken_at", `${shiftDay(weekEnd, 2)}T00:00:00Z`);

  const reelsByDate = new Map<string, number>();
  const carsByDate = new Map<string, number>();
  for (const p of (posts || []) as { taken_at: string; media_type: string | null }[]) {
    const d = etDate(p.taken_at);
    if (d < weekStart || d > weekEnd) continue;
    if (reelMedia(p.media_type)) reelsByDate.set(d, (reelsByDate.get(d) || 0) + 1);
    else if (carouselMedia(p.media_type)) carsByDate.set(d, (carsByDate.get(d) || 0) + 1);
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
    const reelsPosted = reelsByDate.get(date) || 0;
    const carsPosted = carsByDate.get(date) || 0;

    const slots: Slot[] = [];
    // A rest day expects nothing — no slots, so it can never go red (spec: "Sun REST, no posts
    // expected, never red"). Non-rest days build their reel + carousel + story slots.
    if (!restDay) {
      // A slot is covered by detection when its 1-based index <= posts detected; a manual mark
      // overrides in either direction. State: done | missed (only once the day is over) | pending.
      const build = (type: "reel" | "carousel", count: number, detected: number) => {
        for (let i = 1; i <= count; i++) {
          const manual = markMap.get(`${date}|${type}|${i}`);
          const covered = manual === undefined ? detected >= i : manual;
          const state: SlotState = covered ? "done" : dayOver ? "missed" : "pending";
          slots.push({ slot_type: type, slot_index: i, state, manual: manual !== undefined });
        }
      };
      build("reel", cadence.reels_per_day, reelsPosted);
      build("carousel", cadence.carousels_per_day, carsPosted);

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

  return NextResponse.json({ creator, week_start: weekStart, today: todayET, cadence, days });
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
