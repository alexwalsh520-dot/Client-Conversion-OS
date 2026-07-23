// The one place slot truth is derived. The API route (operator + creator views) and the reconcile
// cron both import this, so what the grid shows and what the cron finalizes can never drift.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CREATORS_BY_KEY, type CreatorKey } from "@/lib/creators";
import {
  DEFAULT_STORY_SCHEDULE,
  DEFAULT_TZ,
  safeTimezone,
  dowKey,
  dateIn,
  hoursSinceDayEnded,
  reelMedia,
  carouselMedia,
  shiftDay,
  type Cadence,
  type SlotState,
  type StorySchedule,
} from "./calendar";

// A day is only closed once this many hours have passed since it ended locally, so a slow scrape can
// still upgrade a CLAIMED slot to VERIFIED before the day is locked.
export const FINALIZE_GRACE_HOURS = 6;

export type SlotPost = {
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

export type Slot = {
  slot_type: "reel" | "carousel" | "story";
  slot_index: number;
  state: SlotState;
  manual: boolean;
  label?: string;
  post?: SlotPost;
};

export type Day = {
  date: string;
  dow: string;
  story_rest: boolean; // no story expected (Sunday by default) — reels/carousels still are
  slots: Slot[];
  // A self-reported tally, NOT a slot: trial reels are never ingested (they don't appear on the
  // public grid, so the scraper cannot see them), so they can't be verified and must not touch
  // quota %, streaks, or VERIFIED/CLAIMED logic. Counted, shown, and labelled as self-reported.
  trial_reels: number;
  reels_posted: number;
  carousels_posted: number;
  reels_target: number;
  carousels_target: number;
  story_label: string | null;
  reconciled_at: string | null;
  finalized: boolean;
  day_ended: boolean;
};

// A creator's default calendar timezone before they've saved a cadence: their registry timezone if
// they're a known creator, else New York. New creators onboard onto their own clock automatically.
export function registryTimezone(creator: string): string {
  return CREATORS_BY_KEY[creator as CreatorKey]?.timezone ?? DEFAULT_TZ;
}

export async function getCadence(sb: SupabaseClient, creator: string): Promise<Cadence> {
  const { data } = await sb.from("content_cadences").select("*").eq("client_key", creator).maybeSingle();
  const row = data as
    | { reels_per_day?: number; carousels_per_day?: number; story_schedule?: StorySchedule; timezone?: string }
    | null;
  return {
    reels_per_day: row?.reels_per_day ?? 6,
    carousels_per_day: row?.carousels_per_day ?? 1,
    story_schedule:
      row?.story_schedule && Object.keys(row.story_schedule).length ? row.story_schedule : DEFAULT_STORY_SCHEDULE,
    // A creator with no saved timezone (never opened the editor) inherits their registry timezone —
    // so a new creator's calendar buckets on their own clock from day one, not New York's.
    timezone: safeTimezone(row?.timezone ?? registryTimezone(creator)),
  };
}

type PostRow = {
  ig_media_id: string; taken_at: string; media_type: string | null; permalink: string | null;
  thumbnail_url: string | null; stored_thumb_url: string | null; video_url: string | null;
  stored_video_url: string | null; like_count: number | null; comment_count: number | null; view_count: number | null;
};

// Posts for a date range, bucketed onto their CLIENT-LOCAL date, in taken_at order, de-duped by
// ig_media_id (the same reel can arrive via both the Graph and Apify paths).
export async function getPostsByDate(
  sb: SupabaseClient,
  creator: string,
  fromDate: string,
  toDate: string,
  tz: string,
): Promise<{ reels: Map<string, SlotPost[]>; carousels: Map<string, SlotPost[]> }> {
  const { data } = await sb
    .from("creator_content")
    .select("ig_media_id, taken_at, media_type, permalink, thumbnail_url, stored_thumb_url, video_url, stored_video_url, like_count, comment_count, view_count")
    .eq("client_key", creator)
    // pad ±1 day in UTC so no local-day edge is clipped, then re-bucket precisely below
    .gte("taken_at", `${shiftDay(fromDate, -1)}T00:00:00Z`)
    .lt("taken_at", `${shiftDay(toDate, 2)}T00:00:00Z`)
    .order("taken_at", { ascending: true });

  const rows = (data || []) as PostRow[];
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

  const reels = new Map<string, SlotPost[]>();
  const carousels = new Map<string, SlotPost[]>();
  const seen = new Set<string>();
  for (const p of rows) {
    const d = dateIn(p.taken_at, tz);
    if (d < fromDate || d > toDate) continue;
    const key = `${d}|${p.ig_media_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bucket = reelMedia(p.media_type) ? reels : carouselMedia(p.media_type) ? carousels : null;
    if (!bucket) continue;
    const arr = bucket.get(d) || [];
    arr.push({
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
    bucket.set(d, arr);
  }
  return { reels, carousels };
}

// Manual marks keyed `date|type|index`.
export async function getMarks(sb: SupabaseClient, creator: string, fromDate: string, toDate: string) {
  const { data } = await sb
    .from("content_calendar_marks")
    .select("for_date, slot_type, slot_index, done")
    .eq("client_key", creator)
    .gte("for_date", fromDate)
    .lte("for_date", toDate);
  const m = new Map<string, boolean>();
  for (const r of (data || []) as { for_date: string; slot_type: string; slot_index: number; done: boolean }[]) {
    m.set(`${r.for_date}|${r.slot_type}|${r.slot_index}`, r.done);
  }
  return m;
}

// Trial reels for one day. Stored as rows 1..N of slot_type 'trial_reel' in the SAME marks table
// (no new table): the tally is simply how many are done=true. That makes both directions plain
// upserts — increment sets index N+1 true, decrement sets index N false — so a count can never go
// negative, replaying a request is a no-op, and nothing is ever deleted.
export const TRIAL_REEL_SLOT = "trial_reel";
export function trialReelCount(marks: Map<string, boolean>, date: string): number {
  let n = 0;
  for (const [key, done] of marks) {
    if (done && key.startsWith(`${date}|${TRIAL_REEL_SLOT}|`)) n += 1;
  }
  return n;
}

// Reconciliation bookkeeping. Absent table (pre-migration) degrades to "nothing reconciled yet",
// which only costs the finalized lock — states still derive correctly from posts + marks.
export async function getDayRecords(sb: SupabaseClient, creator: string, fromDate: string, toDate: string) {
  const out = new Map<string, { reconciled_at: string | null; finalized: boolean }>();
  try {
    const { data } = await sb
      .from("content_calendar_days")
      .select("for_date, reconciled_at, finalized")
      .eq("client_key", creator)
      .gte("for_date", fromDate)
      .lte("for_date", toDate);
    for (const r of (data || []) as { for_date: string; reconciled_at: string | null; finalized: boolean }[]) {
      out.set(r.for_date, { reconciled_at: r.reconciled_at, finalized: r.finalized });
    }
  } catch { /* table not created yet */ }
  return out;
}

// Build one day. Order of truth for a reel/carousel slot:
//   forced-not-done mark  -> missed   (an operator explicitly says it didn't happen)
//   a detected post       -> verified (the strongest evidence there is)
//   marked done, no post  -> claimed  (believed, but nothing found — amber, not green)
//   day is over           -> missed
//   otherwise             -> pending
// Stories can never be verified (scrapers can't see them), so a checked story is `done`.
export function buildDay(args: {
  date: string;
  cadence: Cadence;
  reelPosts: SlotPost[];
  carPosts: SlotPost[];
  marks: Map<string, boolean>;
  record?: { reconciled_at: string | null; finalized: boolean };
}): Day {
  const { date, cadence, reelPosts, carPosts, marks, record } = args;
  const dow = dowKey(date);
  const story = cadence.story_schedule[dow];
  const storyRest = story == null;
  const dayEnded = hoursSinceDayEnded(date, cadence.timezone) > 0;

  const slots: Slot[] = [];
  const build = (type: "reel" | "carousel", count: number, posts: SlotPost[]) => {
    for (let i = 1; i <= count; i++) {
      const mark = marks.get(`${date}|${type}|${i}`);
      const post = posts[i - 1];
      let state: SlotState;
      if (mark === false) state = "missed";
      else if (post) state = "verified";
      else if (mark === true) state = "claimed";
      else if (dayEnded) state = "missed";
      else state = "pending";
      slots.push({ slot_type: type, slot_index: i, state, manual: mark !== undefined, ...(post ? { post } : null) });
    }
  };
  build("reel", cadence.reels_per_day, reelPosts);
  build("carousel", cadence.carousels_per_day, carPosts);

  if (!storyRest) {
    const mark = marks.get(`${date}|story|1`);
    const state: SlotState = mark === true ? "done" : mark === false ? "missed" : dayEnded ? "missed" : "pending";
    slots.push({ slot_type: "story", slot_index: 1, state, manual: mark !== undefined, label: story?.label });
  }

  return {
    date,
    dow,
    story_rest: storyRest,
    slots,
    trial_reels: trialReelCount(marks, date),
    reels_posted: reelPosts.length,
    carousels_posted: carPosts.length,
    reels_target: cadence.reels_per_day,
    carousels_target: cadence.carousels_per_day,
    story_label: storyRest ? null : story?.label ?? null,
    reconciled_at: record?.reconciled_at ?? null,
    finalized: record?.finalized ?? false,
    day_ended: dayEnded,
  };
}
