// Weekly Meetings Report — built and DM'd to Saeed every Monday ~1 AM PKT,
// covering the week that just closed (Mon 00:00 – Sun 23:59:59 PKT).
//
// Counts meetings by WHEN THEY WERE LOGGED (created_at), not by session date.
// Coaches frequently log meetings days after they happen and well into Sunday
// evening, so a Sunday-afternoon snapshot by session-date silently undercounts.
// Running just after the week closes and counting by logged-time means every
// meeting lands in exactly one weekly report and nothing is missed.
//
// The coach is whatever was stored on the meeting (now auto-credited from the
// client's assignment when logged). Delivery mirrors the check-in weekly digest:
// a Slack DM to Saeed via the coaching bot. Resilient — never throws into cron.
//
// A dedupe marker in app_settings makes the send idempotent: if the same week
// has already been reported (e.g. a duplicate cron invocation), we skip.

import { getServiceSupabase } from "@/lib/supabase";
import { openDmChannel, postBlocks, ADMIN_SLACK_USER_ID } from "@/lib/slack/coaching-bot";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5
const DAY_MS = 24 * 60 * 60 * 1000;
const LAST_SENT_KEY = "meetings_report_last_week_start";
/** Score awarded per qualifying meeting (has a Fathom link that was added
 *  inside this report's week window). Was mentally +3, formalized to +5
 *  per MAS on 2026-09-14 alongside the Fathom-link-required rule, then
 *  bumped to +10 later the same day to make Fathom-logging more attractive. */
const SCORE_PER_QUALIFYING_MEETING = 10;

// Calendar date (YYYY-MM-DD) in Pakistan time for a UTC instant (ms).
function pktDateStr(instantMs: number): string {
  return new Date(instantMs + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

export interface MeetingsWeek {
  startMs: number; // inclusive, real UTC instant of Mon 00:00 PKT
  endMs: number; // exclusive, real UTC instant of next Mon 00:00 PKT
  startDate: string; // PKT YYYY-MM-DD (Monday)
  endDate: string; // PKT YYYY-MM-DD (Sunday)
  total: number;
  /** Number of meetings this week whose Fathom link was set within the
   *  window — these are the ones that contribute to the score. Total ≥
   *  scored, since coaches can log a meeting without a Fathom link and
   *  it still shows in the total. */
  scored: number;
  perCoach: {
    coach: string;
    count: number;
    /** Meetings by this coach with a Fathom link added inside the week. */
    scoredCount: number;
    /** scoredCount × SCORE_PER_QUALIFYING_MEETING. */
    score: number;
  }[];
}

// The most recently COMPLETED Mon–Sun week, in PKT, relative to `now`.
// Run at Monday ~1 AM PKT, this is the week that ended a few hours earlier.
export function getReportWindow(now: Date = new Date()): {
  startMs: number;
  endMs: number;
  startDate: string;
  endDate: string;
} {
  const shifted = new Date(now.getTime() + PKT_OFFSET_MS); // PKT wall-clock in UTC fields
  const dow = shifted.getUTCDay(); // 0=Sun .. 6=Sat (in PKT)
  // Real UTC instant of "today 00:00 PKT".
  const pktMidnightTodayMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - PKT_OFFSET_MS;
  const daysSinceMonday = (dow + 6) % 7; // Mon→0, Sun→6
  const thisWeekMondayMs = pktMidnightTodayMs - daysSinceMonday * DAY_MS;
  const startMs = thisWeekMondayMs - 7 * DAY_MS; // previous week's Monday
  const endMs = thisWeekMondayMs; // this week's Monday (exclusive)
  return {
    startMs,
    endMs,
    startDate: pktDateStr(startMs),
    endDate: pktDateStr(endMs - DAY_MS), // Sunday = day before the exclusive end
  };
}

export async function gatherMeetingsWeek(now: Date = new Date()): Promise<MeetingsWeek> {
  const { startMs, endMs, startDate, endDate } = getReportWindow(now);
  const db = getServiceSupabase();

  // Pull every meeting whose row was CREATED inside the window (unchanged
  // from before — this is the "total meetings logged this week" number)
  // plus every meeting whose fathom_link was ADDED inside the window
  // (these earn the +5 score, even if the meeting itself was logged in
  // a previous week). Union client-side so a meeting logged AND
  // fathom-linked in the same week is only counted once.
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(endMs).toISOString();

  const [createdRes, fathomRes] = await Promise.all([
    db
      .from("coach_meetings")
      .select("id, coach_name, created_at, fathom_link, fathom_link_added_at")
      .gte("created_at", startIso)
      .lt("created_at", endIso),
    db
      .from("coach_meetings")
      .select("id, coach_name, created_at, fathom_link, fathom_link_added_at")
      .not("fathom_link", "is", null)
      .gte("fathom_link_added_at", startIso)
      .lt("fathom_link_added_at", endIso),
  ]);

  if (createdRes.error || fathomRes.error) {
    console.error(
      "[meetings/weekly-report] query failed:",
      (createdRes.error ?? fathomRes.error)?.message,
    );
    return { startMs, endMs, startDate, endDate, total: 0, scored: 0, perCoach: [] };
  }

  type Row = {
    id: number;
    coach_name: string | null;
    created_at: string;
    fathom_link: string | null;
    fathom_link_added_at: string | null;
  };
  const byId = new Map<number, Row>();
  for (const r of (createdRes.data ?? []) as Row[]) byId.set(r.id, r);
  for (const r of (fathomRes.data ?? []) as Row[]) byId.set(r.id, r);

  const perCoachAgg = new Map<
    string,
    { count: number; scoredCount: number }
  >();
  let total = 0;
  let scored = 0;

  for (const r of byId.values()) {
    const coach = (r.coach_name ?? "").trim() || "Unassigned";
    const bucket = perCoachAgg.get(coach) ?? { count: 0, scoredCount: 0 };

    // "Logged this week" — counts toward the total headline.
    const loggedThisWeek =
      new Date(r.created_at).getTime() >= startMs &&
      new Date(r.created_at).getTime() < endMs;
    if (loggedThisWeek) {
      bucket.count += 1;
      total += 1;
    }

    // "Fathom-linked within this week" — earns the +5 score.
    const fathomStampedThisWeek =
      !!r.fathom_link &&
      !!r.fathom_link_added_at &&
      new Date(r.fathom_link_added_at).getTime() >= startMs &&
      new Date(r.fathom_link_added_at).getTime() < endMs;
    if (fathomStampedThisWeek) {
      bucket.scoredCount += 1;
      scored += 1;
    }

    perCoachAgg.set(coach, bucket);
  }

  const perCoach = [...perCoachAgg.entries()]
    .map(([coach, agg]) => ({
      coach,
      count: agg.count,
      scoredCount: agg.scoredCount,
      score: agg.scoredCount * SCORE_PER_QUALIFYING_MEETING,
    }))
    // Rank by score desc, then raw count desc, then name for stability.
    .sort(
      (a, b) => b.score - a.score || b.count - a.count || a.coach.localeCompare(b.coach),
    );

  return { startMs, endMs, startDate, endDate, total, scored, perCoach };
}

// Render a "Jun 15 – Jun 21, 2026" style range from two YYYY-MM-DD strings.
function formatRange(startDate: string, endDate: string): string {
  const fmt = (s: string) =>
    new Date(s + "T00:00:00Z").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  return `${fmt(startDate)} – ${fmt(endDate)}`;
}

export function buildMeetingsReportBlocks(week: MeetingsWeek): unknown[] {
  const range = formatRange(week.startDate, week.endDate);
  const totalPossibleScore = week.scored * SCORE_PER_QUALIFYING_MEETING;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Weekly Meetings Report", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `${range}  ·  score = ${SCORE_PER_QUALIFYING_MEETING} per Fathom-linked meeting` }],
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Meetings logged*\n${week.total}` },
        { type: "mrkdwn", text: `*Fathom-scored*\n${week.scored}  (${totalPossibleScore} pts)` },
      ],
    },
  ];

  if (week.perCoach.length > 0) {
    // Show each coach: score in bold, meetings logged + how many had Fathom
    // links added this week in the smaller context line.
    const lines = week.perCoach
      .map((c) => {
        const scoreStr = `*${c.score} pts*`;
        const detail = `${c.count} logged · ${c.scoredCount} with Fathom this week`;
        return `• *${c.coach}* — ${scoreStr}\n   _${detail}_`;
      })
      .join("\n");
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*By coach*\n${lines}` },
    });
  } else {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_No meetings were logged this week._" },
    });
  }

  return blocks;
}

export interface BuildAndSendResult {
  week: MeetingsWeek;
  slack: { ok: boolean; error?: string };
  skipped?: boolean;
}

export async function buildAndSendWeeklyMeetingsReport(
  now: Date = new Date()
): Promise<BuildAndSendResult> {
  const week = await gatherMeetingsWeek(now);
  const db = getServiceSupabase();

  // Idempotency: if this exact week was already reported, skip (guards against
  // duplicate cron invocations sending the DM twice).
  const { data: marker } = await db
    .from("app_settings")
    .select("value")
    .eq("key", LAST_SENT_KEY)
    .maybeSingle();
  if (marker?.value === week.startDate) {
    return { week, slack: { ok: true }, skipped: true };
  }

  const blocks = buildMeetingsReportBlocks(week);
  const channel = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!channel) {
    return {
      week,
      slack: { ok: false, error: "Could not open admin DM channel (check SLACK_BOT_TOKEN_COACHING)" },
    };
  }

  const fallback = `CCOS Weekly Meetings Report: ${week.total} meetings logged this week.`;
  const result = await postBlocks(channel, blocks, fallback);

  // Mark this week as sent only on success, so a failed send can retry.
  if (result.ok) {
    await db
      .from("app_settings")
      .upsert(
        { key: LAST_SENT_KEY, value: week.startDate, updated_at: new Date().toISOString(), updated_by: "cron/weekly-meetings-report" },
        { onConflict: "key" }
      );
  }

  return {
    week,
    slack: { ok: result.ok, error: result.ok ? undefined : result.error },
  };
}
