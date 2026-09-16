/**
 * #check-in-tracker channel notifier.
 *
 * Confirmed with MAS 2026-09-16: every time a client submits a weekly
 * check-in, post a message into the check-in-tracker Slack channel with
 *   1. Who just submitted + basic details (score, subscores, open response)
 *   2. That client's coach's OTHER active clients (positive days remaining)
 *      who still haven't submitted their check-in for this week
 *
 * The "week" boundary matches the check-in-weekly-digest cron:
 *   every Sunday at 11:00 UTC (16:00 Pakistan time). A submission timestamped
 *   even 1 second after Sunday 11:00 UTC counts for the NEW week — the digest
 *   went out just before it.
 *
 * Best-effort: never throws. The check-in submit route awaits this in a
 * try/catch so a Slack outage can't fail the client's submission.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { postBlocks } from "@/lib/slack/coaching-bot";

// Channel id MAS provided (2026-09-16). Overridable via env in case Slack
// moves it later.
const CHANNEL_ID = process.env.SLACK_CHANNEL_CHECKIN_TRACKER ?? "C0C2B757EJY";

/** The Sunday-11:00-UTC boundary. Returns the most recent boundary that is
 *  <= now. A submission at exactly that boundary counts for the new week. */
export function currentWeekStart(now: Date = new Date()): Date {
  const cur = new Date(now.getTime());
  const dayOfWeek = cur.getUTCDay(); // 0 = Sunday
  cur.setUTCDate(cur.getUTCDate() - dayOfWeek);
  cur.setUTCHours(11, 0, 0, 0);
  if (cur.getTime() > now.getTime()) {
    // Early Sunday morning before the digest went out — belong to last week.
    cur.setUTCDate(cur.getUTCDate() - 7);
  }
  return cur;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export interface TrackerInput {
  db: SupabaseClient;
  checkInId: number;
  clientId: number;
  clientName: string;
  coachName: string;
  score: number;
  q1: number;
  q2: number;
  q3: number;
  q4: number;
  openResponse: string | null;
}

export async function notifyCheckInTracker(input: TrackerInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const { db, clientId, clientName, coachName, score, q1, q2, q3, q4, openResponse } = input;
    if (!coachName || !coachName.trim()) {
      return { ok: false, error: "no coach on submission" };
    }

    const weekStart = currentWeekStart();
    const weekStartIso = weekStart.toISOString();
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayIso = today.toISOString().slice(0, 10);

    // Coach's roster of active clients with days remaining > 0.
    const { data: rosterRows, error: rosterErr } = await db
      .from("clients")
      .select("id, name, end_date")
      .eq("status", "active")
      .eq("coach_name", coachName)
      .gt("end_date", todayIso);
    if (rosterErr) {
      return { ok: false, error: `roster query failed: ${rosterErr.message}` };
    }

    // Clients whose coach is this one AND who have submitted a check-in since
    // the week boundary. The just-submitted row is in there too.
    const { data: submittedRows, error: submittedErr } = await db
      .from("client_check_ins")
      .select("client_id, client_name")
      .eq("coach_name", coachName)
      .gte("submitted_at", weekStartIso);
    if (submittedErr) {
      return { ok: false, error: `submitted query failed: ${submittedErr.message}` };
    }

    const submittedIds = new Set<number>();
    const submittedNamesNorm = new Set<string>();
    for (const r of submittedRows ?? []) {
      if (r.client_id != null) submittedIds.add(r.client_id as number);
      submittedNamesNorm.add(norm(r.client_name as string));
    }

    // Pending list: roster minus already-submitted (match on id first, then
    // fall back to normalized name for legacy rows where check_ins had no
    // client_id).
    const pending = (rosterRows ?? [])
      .filter((r) => {
        const id = r.id as number;
        if (submittedIds.has(id)) return false;
        if (submittedNamesNorm.has(norm(r.name as string))) return false;
        return true;
      })
      .map((r) => r.name as string)
      .sort((a, b) => a.localeCompare(b));

    const totalActive = (rosterRows ?? []).length;
    const submittedThisWeek = totalActive - pending.length;

    // Score emoji + label.
    const scoreEmoji = score < 40 ? "🔴" : score < 55 ? "🟠" : score < 75 ? "🟡" : "🟢";
    const openTrimmed = truncate((openResponse ?? "").trim(), 700);

    const detailLines: string[] = [
      `*Score:* ${scoreEmoji} ${score}/100`,
      `*Subscores:* Coaching ${q1}/10 · Strength ${q2}/10 · Nutrition + sleep ${q3}/10 · Progress ${q4}/10`,
    ];
    if (openTrimmed) detailLines.push(`*Open response:* ${openTrimmed}`);

    const pendingLine =
      pending.length === 0
        ? `*All of ${coachName}'s clients have submitted this week.* 🎉`
        : `*Still pending this week for ${coachName} (${pending.length} of ${totalActive}):* ${pending.join(", ")}`;

    const blocks: unknown[] = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:memo: *${clientName}* submitted a check-in (coach: ${coachName})`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: detailLines.join("\n") },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: pendingLine },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `_Week: submissions counted since ${weekStart.toISOString().slice(0, 10)} 11:00 UTC_ · _${submittedThisWeek}/${totalActive} in this week_`,
          },
        ],
      },
    ];

    const fallback = `${clientName} submitted a check-in (${score}/100). ${pending.length} of ${totalActive} still pending for ${coachName}.`;
    const res = await postBlocks(CHANNEL_ID, blocks, fallback);
    if (!res.ok) return { ok: false, error: res.error ?? "post failed" };
    // Silence lint for the unused clientId; kept in the interface so callers
    // can pass it and future logic can join on the check-ins row.
    void clientId;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
