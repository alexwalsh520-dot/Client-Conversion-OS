/**
 * Daily Coacher digest cron — runs at 8:30 UTC = 1:30 PM PKT.
 *
 * For each enabled, non-snoozed recipient with >= 5 active clients
 * (positive days remaining), generate 5 suggested drafts and DM them on
 * Slack. Then sweep for any newly-eligible coach not yet onboarded and
 * ping the admin to provide their Slack email.
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET (matches existing
 * CCOS cron pattern).
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  sendDigestForCoach,
  type DigestRecipient,
} from "@/lib/daily-coacher/digest";
import {
  postBlocks,
  openDmChannel,
  ADMIN_SLACK_USER_ID,
} from "@/lib/slack/coaching-bot";

export const runtime = "nodejs";
export const maxDuration = 300; // generate 25 drafts (5 coaches * 5 each) in parallel; ~30s typical

const NEW_COACH_THRESHOLD = 5;
const ADMIN_REPING_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const auth = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const startedAt = Date.now();
  const summary: Record<string, unknown> = { started_at: new Date().toISOString() };

  // ---------------------------------------------------------------------
  // 1. Send digest to each enabled, non-snoozed recipient
  // ---------------------------------------------------------------------
  const { data: recipients, error: recErr } = await db
    .from("daily_coacher_recipients")
    .select("coach_name, slack_email, slack_user_id, enabled, snoozed_until");
  if (recErr) {
    return NextResponse.json({ error: recErr.message }, { status: 500 });
  }

  const sendResults: Array<{ coach: string; ok: boolean; reason?: string; client_count?: number }> = [];
  for (const r of (recipients ?? []) as DigestRecipient[]) {
    try {
      const result = await sendDigestForCoach(r);
      sendResults.push({
        coach: r.coach_name,
        ok: result.ok,
        reason: result.reason,
        client_count: result.client_count,
      });
    } catch (err) {
      console.error(`[cron/digest] send failed for ${r.coach_name}:`, err);
      sendResults.push({ coach: r.coach_name, ok: false, reason: "exception" });
    }
  }
  summary.send_results = sendResults;

  // ---------------------------------------------------------------------
  // 2. Detect new coaches above threshold who don't have a recipient row
  // ---------------------------------------------------------------------
  const today = new Date();
  const { data: clients } = await db
    .from("clients")
    .select("coach_name, end_date, status")
    .eq("status", "active")
    .not("coach_name", "is", null);

  const activeCountByCoach = new Map<string, number>();
  for (const c of (clients ?? []) as Array<{ coach_name: string | null; end_date: string | null }>) {
    if (!c.coach_name || !c.end_date) continue;
    const end = new Date(c.end_date);
    if (isNaN(end.getTime()) || end < today) continue; // positive days remaining
    activeCountByCoach.set(c.coach_name, (activeCountByCoach.get(c.coach_name) ?? 0) + 1);
  }

  const recipientCoaches = new Set(((recipients ?? []) as DigestRecipient[]).map((r) => r.coach_name));
  const newCoachPings: Array<{ coach_name: string; count: number; pinged: boolean }> = [];

  for (const [coachName, count] of activeCountByCoach.entries()) {
    if (count < NEW_COACH_THRESHOLD) continue;
    if (recipientCoaches.has(coachName)) continue;

    // Check pending state
    const { data: pendingRow } = await db
      .from("daily_coacher_pending_coaches")
      .select("admin_last_pinged_at")
      .eq("coach_name", coachName)
      .maybeSingle();

    const lastPinged = pendingRow?.admin_last_pinged_at
      ? new Date(pendingRow.admin_last_pinged_at)
      : null;
    const daysSincePing = lastPinged
      ? Math.floor((Date.now() - lastPinged.getTime()) / DAY_MS)
      : null;

    // Skip if pinged within the re-ping window
    if (lastPinged && daysSincePing !== null && daysSincePing < ADMIN_REPING_DAYS) {
      newCoachPings.push({ coach_name: coachName, count, pinged: false });
      continue;
    }

    const sent = await pingAdminAboutNewCoach(coachName, count);
    const nowIso = new Date().toISOString();

    await db
      .from("daily_coacher_pending_coaches")
      .upsert({
        coach_name: coachName,
        active_client_count: count,
        admin_notified_at: pendingRow ? undefined : nowIso,
        admin_last_pinged_at: nowIso,
      }, { onConflict: "coach_name" });

    newCoachPings.push({ coach_name: coachName, count, pinged: sent });
  }
  summary.new_coach_pings = newCoachPings;

  summary.elapsed_ms = Date.now() - startedAt;
  return NextResponse.json(summary);
}

async function pingAdminAboutNewCoach(coachName: string, activeClientCount: number): Promise<boolean> {
  const dm = await openDmChannel(ADMIN_SLACK_USER_ID);
  if (!dm) return false;

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:wave: <@${ADMIN_SLACK_USER_ID}>, Daily Coacher noticed a new active coach who isn't on the digest list yet.\n\n*Coach:* ${coachName}\n*Active clients with positive days remaining:* ${activeClientCount}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Add Slack email", emoji: true },
          style: "primary",
          action_id: "add_coach_slack_email",
          value: JSON.stringify({ coach_name: coachName }),
        },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: "_Once you provide their Slack email, they'll start receiving digests in the next round._" },
      ],
    },
  ];

  const r = await postBlocks(dm, blocks, `New coach detected: ${coachName} (${activeClientCount} active clients)`);
  return r.ok;
}
