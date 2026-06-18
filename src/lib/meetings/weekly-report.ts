// Weekly Meetings Report — built and DM'd to Saeed every Sunday 1 PM PKT.
//
// Counts meetings by meeting_date over the 7-day window ending on the report
// day (Mon–Sun of the current week, in PKT), and breaks them down per coach.
// Because the coach is now derived from each client's assignment when a meeting
// is logged (see MeetingsTab), the per-coach counts are reliable and uniform.
//
// Delivery mirrors the check-in weekly digest: a Slack DM to Saeed via the
// coaching bot. Resilient — never throws into the cron handler.

import { getServiceSupabase } from "@/lib/supabase";
import { openDmChannel, postBlocks, ADMIN_SLACK_USER_ID } from "@/lib/slack/coaching-bot";

const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5

// Calendar date (YYYY-MM-DD) in Pakistan time for a given instant.
function pktDateStr(instant: number): string {
  return new Date(instant + PKT_OFFSET_MS).toISOString().slice(0, 10);
}

export interface MeetingsWeek {
  startDate: string; // inclusive, PKT, YYYY-MM-DD
  endDate: string; // inclusive, PKT, YYYY-MM-DD
  total: number;
  perCoach: { coach: string; count: number }[];
}

// 7-day window ending today (PKT), inclusive — Monday..Sunday when run on Sunday.
export function getReportWeek(now: Date = new Date()): { startDate: string; endDate: string } {
  const nowMs = now.getTime();
  return {
    startDate: pktDateStr(nowMs - 6 * 24 * 60 * 60 * 1000),
    endDate: pktDateStr(nowMs),
  };
}

export async function gatherMeetingsWeek(now: Date = new Date()): Promise<MeetingsWeek> {
  const { startDate, endDate } = getReportWeek(now);
  const db = getServiceSupabase();

  const { data, error } = await db
    .from("coach_meetings")
    .select("coach_name, meeting_date")
    .gte("meeting_date", startDate)
    .lte("meeting_date", endDate);

  if (error) {
    console.error("[meetings/weekly-report] query failed:", error.message);
    return { startDate, endDate, total: 0, perCoach: [] };
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

  return { startDate, endDate, total: rows.length, perCoach };
}

// Render a "Jun 09 – Jun 15, 2026" style range from two YYYY-MM-DD strings.
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
      elements: [{ type: "mrkdwn", text: range }],
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
}

export async function buildAndSendWeeklyMeetingsReport(
  now: Date = new Date()
): Promise<BuildAndSendResult> {
  const week = await gatherMeetingsWeek(now);
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

  return {
    week,
    slack: { ok: result.ok, error: result.ok ? undefined : result.error },
  };
}
