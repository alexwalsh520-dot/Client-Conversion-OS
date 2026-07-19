/**
 * Daily Coach Tip cron — per-coach DM delivery with automatic enrollment.
 *
 * Runs at 8:30 UTC = 1:30 PM PKT via vercel.json.
 *
 * Generates ONE educational tip for the day (same topic for everyone, fresh
 * copy) and DMs it to every coach who currently has MIN_ACTIVE_CLIENTS or more
 * active clients with positive days remaining. Enrollment is automatic: nobody
 * maintains a list. A coach who crosses the threshold starts receiving the tip
 * as soon as we can resolve their Slack identity; one who drops below it stops.
 *
 * Slack identity (email -> user id) lives in daily_coacher_recipients, which
 * doubles as the per-coach delivery + preference store: slack_email, a cached
 * slack_user_id, an `enabled` opt-out, and a coach-set `snoozed_until`. A
 * qualifying coach we have no email for is recorded in
 * daily_coacher_pending_coaches and the admin is pinged (at most once every
 * ADMIN_REPING_DAYS) to supply it; once it's added they enroll automatically
 * on the next run.
 *
 * DMs use SLACK_BOT_TOKEN_COACHING (a DM opens a conversation per user). This
 * path intentionally does NOT need SLACK_CHANNEL_COACHING — that variable is
 * only required by the shared-channel broadcast this cron used to do.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { generateDailyTip, tipToSlackBlocks } from "@/lib/daily-coacher/daily-tip";
import {
  postBlocks,
  openDmChannel,
  lookupUserIdByEmail,
  ADMIN_SLACK_USER_ID,
} from "@/lib/slack/coaching-bot";

export const runtime = "nodejs";
export const maxDuration = 120;

/** A coach receives the daily tip once they have this many active clients. */
const MIN_ACTIVE_CLIENTS = 5;
/** Don't re-ping the admin about a missing coach email more often than this. */
const ADMIN_REPING_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const authHeader = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`);
}

interface RecipientRow {
  coach_name: string;
  slack_email: string | null;
  slack_user_id: string | null;
  enabled: boolean;
  snoozed_until: string | null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const startedAt = Date.now();
  const now = new Date();
  const summary: Record<string, unknown> = { started_at: now.toISOString() };

  // -----------------------------------------------------------------------
  // 1. Which coaches qualify? Count active clients with positive days left.
  // -----------------------------------------------------------------------
  const { data: clients, error: clientsErr } = await db
    .from("clients")
    .select("coach_name, end_date, status")
    .eq("status", "active")
    .not("coach_name", "is", null);
  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }

  const activeCountByCoach = new Map<string, number>();
  for (const c of (clients ?? []) as Array<{ coach_name: string | null; end_date: string | null }>) {
    if (!c.coach_name || !c.end_date) continue;
    const end = new Date(c.end_date);
    if (isNaN(end.getTime()) || end < now) continue; // positive days remaining
    activeCountByCoach.set(c.coach_name, (activeCountByCoach.get(c.coach_name) ?? 0) + 1);
  }

  const qualifyingCoaches = [...activeCountByCoach.entries()]
    .filter(([, count]) => count >= MIN_ACTIVE_CLIENTS)
    .map(([coach_name, count]) => ({ coach_name, count }));
  summary.qualifying_coaches = qualifyingCoaches;

  if (qualifyingCoaches.length === 0) {
    summary.elapsed_ms = Date.now() - startedAt;
    return NextResponse.json({ ...summary, note: "no coaches at or above the threshold" });
  }

  // -----------------------------------------------------------------------
  // 2. Generate today's tip once (shared by all recipients).
  // -----------------------------------------------------------------------
  let topic: string;
  let body: string;
  try {
    ({ topic, body } = await generateDailyTip(now));
  } catch (err) {
    console.error("[cron/daily-coacher-digest] tip generation failed:", err);
    return NextResponse.json(
      { ...summary, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
  summary.topic = topic;

  // -----------------------------------------------------------------------
  // 3. Load per-coach delivery info (email, cached id, opt-out, snooze).
  // -----------------------------------------------------------------------
  const { data: recRows } = await db
    .from("daily_coacher_recipients")
    .select("coach_name, slack_email, slack_user_id, enabled, snoozed_until");
  const recipientByCoach = new Map<string, RecipientRow>();
  for (const r of (recRows ?? []) as RecipientRow[]) recipientByCoach.set(r.coach_name, r);

  // -----------------------------------------------------------------------
  // 4. Deliver to each qualifying coach.
  // -----------------------------------------------------------------------
  const sendResults: Array<{ coach: string; ok: boolean; reason?: string }> = [];

  for (const { coach_name, count } of qualifyingCoaches) {
    const row = recipientByCoach.get(coach_name);

    // Respect explicit opt-out and coach-set snooze.
    if (row && row.enabled === false) {
      sendResults.push({ coach: coach_name, ok: true, reason: "disabled" });
      continue;
    }
    if (row?.snoozed_until && new Date(row.snoozed_until) > now) {
      sendResults.push({ coach: coach_name, ok: true, reason: "snoozed" });
      continue;
    }

    // Resolve Slack user id: cached, else via email lookup (and cache it).
    let slackUserId = row?.slack_user_id ?? null;
    if (!slackUserId && row?.slack_email) {
      slackUserId = await lookupUserIdByEmail(row.slack_email);
      if (slackUserId) {
        await db
          .from("daily_coacher_recipients")
          .update({ slack_user_id: slackUserId })
          .eq("coach_name", coach_name);
      }
    }

    // No way to reach them yet: we need an email. Ping the admin to supply it.
    if (!slackUserId) {
      await pingAdminForEmail(db, coach_name, count, Boolean(row?.slack_email));
      sendResults.push({
        coach: coach_name,
        ok: false,
        reason: row?.slack_email ? "lookup_failed" : "no_email",
      });
      continue;
    }

    const dmChannel = await openDmChannel(slackUserId);
    if (!dmChannel) {
      sendResults.push({ coach: coach_name, ok: false, reason: "dm_open_failed" });
      continue;
    }

    const blocks = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `:sparkles: Morning <@${slackUserId}>! Here's today's coaching tip.` },
      },
      ...tipToSlackBlocks(topic, body),
    ];
    const res = await postBlocks(dmChannel, blocks, `Daily Coach Tip: ${topic}`);

    if (res.ok) {
      await db
        .from("daily_coacher_recipients")
        .update({ last_sent_at: now.toISOString() })
        .eq("coach_name", coach_name);
      sendResults.push({ coach: coach_name, ok: true });
    } else {
      sendResults.push({ coach: coach_name, ok: false, reason: res.error ?? "post_failed" });
    }
  }

  summary.send_results = sendResults;
  summary.sent = sendResults.filter((r) => r.ok && !r.reason).length;
  summary.elapsed_ms = Date.now() - startedAt;
  return NextResponse.json(summary);
}

/**
 * Record a qualifying coach we can't yet DM (no resolvable Slack identity) and
 * ping the admin to add their email, at most once every ADMIN_REPING_DAYS.
 */
async function pingAdminForEmail(
  db: ReturnType<typeof getServiceSupabase>,
  coachName: string,
  activeClientCount: number,
  hasEmailButLookupFailed: boolean,
): Promise<void> {
  const { data: pendingRow } = await db
    .from("daily_coacher_pending_coaches")
    .select("admin_last_pinged_at")
    .eq("coach_name", coachName)
    .maybeSingle();

  const lastPinged = pendingRow?.admin_last_pinged_at ? new Date(pendingRow.admin_last_pinged_at) : null;
  const daysSincePing = lastPinged ? Math.floor((Date.now() - lastPinged.getTime()) / DAY_MS) : null;
  const withinWindow = lastPinged && daysSincePing !== null && daysSincePing < ADMIN_REPING_DAYS;

  if (withinWindow) return;

  const dm = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (dm) {
    const problem = hasEmailButLookupFailed
      ? "their Slack email is set but no Slack user matched it (check the address)"
      : "we don't have their Slack email yet";
    await postBlocks(
      dm,
      [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:wave: <@${ADMIN_SLACK_USER_ID}>, *${coachName}* qualifies for the Daily Coach Tip (${activeClientCount} active clients) but ${problem}.\n\nAdd them to *daily_coacher_recipients* with their Slack email and they'll start receiving it automatically.`,
          },
        },
      ],
      `Daily Coach Tip: ${coachName} needs a Slack email`,
    );
  }

  await db.from("daily_coacher_pending_coaches").upsert(
    {
      coach_name: coachName,
      active_client_count: activeClientCount,
      admin_notified_at: pendingRow ? undefined : new Date().toISOString(),
      admin_last_pinged_at: new Date().toISOString(),
    },
    { onConflict: "coach_name" },
  );
}
