// Calendar reconciliation. Slot states are always derived at read time from creator_content + marks;
// what this adds is (a) a fresh ingest so detection is current before we judge a day, (b) a durable
// record that the day WAS checked, and (c) finalization once the day is safely over.
//
// Idempotent by construction: it only ever upserts one row per (client, day) and skips days already
// finalized, so running it hourly costs nothing after a day closes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { FINALIZE_GRACE_HOURS, buildDay, getCadence, getMarks, getPostsByDate } from "./calendar-build";
import { hoursSinceDayEnded, isComplete, shiftDay, todayIn } from "./calendar";

export type DayReconcileResult = {
  for_date: string;
  verified: number;
  claimed: number;
  missed: number;
  finalized: boolean;
};

// How far back to look for unfinalized days each tick. A week is plenty; anything older is either
// finalized or predates the feature.
const LOOKBACK_DAYS = 8;

export async function reconcileCreator(
  sb: SupabaseClient,
  creator: string,
  opts: { ingest?: () => Promise<void> } = {},
): Promise<{ creator: string; timezone: string; days: DayReconcileResult[]; ingested: boolean }> {
  const cadence = await getCadence(sb, creator);
  const tz = cadence.timezone;
  const today = todayIn(tz);
  const from = shiftDay(today, -LOOKBACK_DAYS);

  // Which past days still need attention? (Finalized days are done forever.)
  const existing = new Map<string, boolean>();
  try {
    const { data } = await sb
      .from("content_calendar_days")
      .select("for_date, finalized")
      .eq("client_key", creator)
      .gte("for_date", from)
      .lte("for_date", today);
    for (const r of (data || []) as { for_date: string; finalized: boolean }[]) existing.set(r.for_date, r.finalized);
  } catch { /* table missing — treat everything as unreconciled */ }

  const candidates: string[] = [];
  for (let d = from; d <= today; d = shiftDay(d, 1)) {
    if (hoursSinceDayEnded(d, tz) <= 0) continue; // still running — nothing to reconcile yet
    if (existing.get(d) === true) continue; // already finalized
    candidates.push(d);
  }
  if (!candidates.length) return { creator, timezone: tz, days: [], ingested: false };

  // Judge a day only against a current scrape.
  let ingested = false;
  if (opts.ingest) {
    try { await opts.ingest(); ingested = true; } catch { /* fall through: stale detection is still better than none */ }
  }

  const start = candidates[0];
  const end = candidates[candidates.length - 1];
  const [{ reels, carousels }, marks] = await Promise.all([
    getPostsByDate(sb, creator, start, end, tz),
    getMarks(sb, creator, start, end),
  ]);

  const now = new Date().toISOString();
  const results: DayReconcileResult[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const date of candidates) {
    const day = buildDay({
      date,
      cadence,
      reelPosts: reels.get(date) || [],
      carPosts: carousels.get(date) || [],
      marks,
    });
    const counted = day.slots.filter((s) => s.slot_type !== "story" || true);
    const verified = counted.filter((s) => s.state === "verified").length;
    const claimed = counted.filter((s) => s.state === "claimed" || s.state === "done").length;
    const missed = counted.filter((s) => s.state === "missed").length;
    // Close the day only once the scrape has had its grace period after local midnight.
    const finalized = hoursSinceDayEnded(date, tz) >= FINALIZE_GRACE_HOURS;
    results.push({ for_date: date, verified, claimed, missed, finalized });
    rows.push({ client_key: creator, for_date: date, reconciled_at: now, finalized });
  }

  if (rows.length) {
    try {
      await sb.from("content_calendar_days").upsert(rows, { onConflict: "client_key,for_date" });
    } catch { /* table missing — states still derive correctly, we just can't lock */ }
  }
  return { creator, timezone: tz, days: results, ingested };
}

// Finalized VERIFIED counts for one local day — what the daily Slack compliance line reports.
export async function complianceForDay(sb: SupabaseClient, creator: string, date: string) {
  const cadence = await getCadence(sb, creator);
  const [{ reels, carousels }, marks] = await Promise.all([
    getPostsByDate(sb, creator, date, date, cadence.timezone),
    getMarks(sb, creator, date, date),
  ]);
  const day = buildDay({
    date,
    cadence,
    reelPosts: reels.get(date) || [],
    carPosts: carousels.get(date) || [],
    marks,
  });
  const of = (t: string) => day.slots.filter((s) => s.slot_type === t);
  const okCount = (t: string) => of(t).filter((s) => isComplete(s.state)).length;
  return {
    date,
    timezone: cadence.timezone,
    reels: { done: okCount("reel"), target: of("reel").length },
    carousels: { done: okCount("carousel"), target: of("carousel").length },
    story: of("story").length ? { done: okCount("story") > 0 } : null,
    // Counted toward "done" above (a claim is believed), but surfaced separately so the recap can
    // say how much of the day rests on the creator's word rather than a detected post.
    claimed: day.slots.filter((s) => s.state === "claimed").length,
  };
}

// Consecutive fully-complete days ending at `endDate` (walking backwards, stopping at the first
// day with a missed slot). Rest applies only to stories, so every day counts.
export async function streakEndingOn(sb: SupabaseClient, creator: string, endDate: string, maxBack = 30) {
  const cadence = await getCadence(sb, creator);
  const from = shiftDay(endDate, -maxBack);
  const [{ reels, carousels }, marks] = await Promise.all([
    getPostsByDate(sb, creator, from, endDate, cadence.timezone),
    getMarks(sb, creator, from, endDate),
  ]);
  let streak = 0;
  for (let d = endDate; d > from; d = shiftDay(d, -1)) {
    const day = buildDay({
      date: d,
      cadence,
      reelPosts: reels.get(d) || [],
      carPosts: carousels.get(d) || [],
      marks,
    });
    if (!day.slots.length) continue;
    if (day.slots.every((s) => isComplete(s.state))) streak += 1;
    else break;
  }
  return streak;
}
