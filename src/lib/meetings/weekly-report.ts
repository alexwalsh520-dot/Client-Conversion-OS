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
  perCoach: { coach: string; count: number }[];
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

  const { data, error } = await db
    .from("coach_meetings")
    .select("coach_name, created_at")
    .gte("created_at", new Date(startMs).toISOString())
    .lt("created_at", new Date(endMs).toISOString());

  if (error) {
    console.error("[meetings/weekly-report] query failed:", error.message);
    return { startMs, endMs, startDate, endDate, total: 0, perCoach: [] };
  }

  const rows = data ?? [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    const coach = (r.coach_name as string | null)?.trim() || "Unassigned";
    counts.set(coach, (counts.get(coach) ?? 0) + 1);
  }

  const perCoach = [...counts.entries()]
    .map(([coach, count]) => ({ coach, count }))
    .sort((a, b) => b.count - a.count || a.coach.localeCompare(b.coach));

  return { startMs, endMs, startDate, endDate, total: rows.length, perCoach };
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

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "Weekly Meetings Report", emoji: true },
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `${range}  ·  counted by date logged` }],
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Total meetings logged this week:* ${week.total}` },
    },
  ];

  if (week.perCoach.length > 0) {
    const lines = week.perCoach.map((c) => `• *${c.coach}* — ${c.count}`).join("\n");
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
