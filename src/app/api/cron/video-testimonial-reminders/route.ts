/**
 * GET /api/cron/video-testimonial-reminders
 *
 * Daily. Finds every active client whose end_date is exactly 7 days out
 * (MAS 2026-09-16: "near the end of the program"), DMs the coach with the
 * client name + their unique recording link, and stamps
 * `video_testimonial_prompted_date` on coach_milestones so it never fires
 * again for the same client. Mirrors testimonial-reminders exactly.
 *
 * Recording link comes from generateTestimonialToken / recordingUrl —
 * the same per-client URL the Milestones tab's "Copy link" button uses,
 * so the video lands in the video-testimonials store on CCOS with the
 * client attached. A pending token is reused if one already exists.
 *
 * Coach directory reuse: daily_coacher_recipients, same as written
 * testimonial reminder. Coach not in the directory → skipped with a
 * reason in the results payload (never pings MAS).
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  postBlocks,
  openDmChannel,
  lookupUserIdByEmail,
} from "@/lib/slack/coaching-bot";
import { generateTestimonialToken, recordingUrl } from "@/lib/testimonials/video";

export const runtime = "nodejs";
export const maxDuration = 120;

const REMINDER_DAYS_BEFORE_END = 7;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const authHeader = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`);
}

interface ClientRow {
  id: number;
  name: string;
  coach_name: string;
  end_date: string;
}

interface MilestoneRow {
  id: number;
  client_id: number;
  video_testimonial_prompted_date: string | null;
  video_testimonial_completed: boolean | null;
}

interface RecipientRow {
  coach_name: string;
  slack_email: string | null;
  slack_user_id: string | null;
}

interface SendResult {
  client_id: number;
  client_name: string;
  coach: string;
  ok: boolean;
  reason?: string;
}

/** Get-or-create the pending recording token for a client. Mirrors what
 *  /api/testimonials/video/request does but doesn't need a session. */
async function getOrCreateRecordingUrl(
  db: ReturnType<typeof getServiceSupabase>,
  clientId: number,
): Promise<string | null> {
  const { data: pending } = await db
    .from("video_testimonials")
    .select("token")
    .eq("client_id", clientId)
    .eq("status", "requested")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let token = pending?.token as string | undefined;
  if (!token) {
    token = generateTestimonialToken();
    const { error: insErr } = await db.from("video_testimonials").insert({
      client_id: clientId,
      token,
      status: "requested",
    });
    if (insErr) return null;
  }
  return recordingUrl(token);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const startedAt = Date.now();

  // Compute today+7 as a date string. end_date is stored YYYY-MM-DD.
  const target = new Date();
  target.setUTCHours(0, 0, 0, 0);
  target.setUTCDate(target.getUTCDate() + REMINDER_DAYS_BEFORE_END);
  const targetIso = target.toISOString().slice(0, 10);

  const { data: clientsData, error: clientsErr } = await db
    .from("clients")
    .select("id, name, coach_name, end_date")
    .eq("status", "active")
    .not("coach_name", "is", null)
    .eq("end_date", targetIso);
  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }
  const candidates = (clientsData ?? []) as ClientRow[];
  if (candidates.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      note: `no active clients with end_date = ${targetIso}`,
      elapsed_ms: Date.now() - startedAt,
    });
  }

  // Fetch existing milestones for these clients so we can filter out
  // anyone already prompted or already completed. No milestone row = eligible.
  const clientIds = candidates.map((c) => c.id);
  const { data: msData } = await db
    .from("coach_milestones")
    .select("id, client_id, video_testimonial_prompted_date, video_testimonial_completed")
    .in("client_id", clientIds);
  const milestoneByClient = new Map<number, MilestoneRow>();
  for (const r of (msData ?? []) as MilestoneRow[]) milestoneByClient.set(r.client_id, r);

  const eligible = candidates.filter((c) => {
    const m = milestoneByClient.get(c.id);
    if (!m) return true; // no row = never prompted, never completed
    if (m.video_testimonial_completed) return false;
    if (m.video_testimonial_prompted_date) return false;
    return true;
  });

  if (eligible.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      note: `all ${candidates.length} candidates already prompted or completed`,
      elapsed_ms: Date.now() - startedAt,
    });
  }

  // Coach → Slack directory.
  const { data: recRows } = await db
    .from("daily_coacher_recipients")
    .select("coach_name, slack_email, slack_user_id");
  const recipientByCoach = new Map<string, RecipientRow>();
  for (const r of (recRows ?? []) as RecipientRow[]) recipientByCoach.set(r.coach_name, r);

  const results: SendResult[] = [];
  const nowIso = new Date().toISOString();

  for (const c of eligible) {
    const row = recipientByCoach.get(c.coach_name);
    let slackUserId = row?.slack_user_id ?? null;
    if (!slackUserId && row?.slack_email) {
      slackUserId = await lookupUserIdByEmail(row.slack_email);
      if (slackUserId) {
        await db
          .from("daily_coacher_recipients")
          .update({ slack_user_id: slackUserId })
          .eq("coach_name", c.coach_name);
      }
    }
    if (!slackUserId) {
      results.push({
        client_id: c.id,
        client_name: c.name,
        coach: c.coach_name,
        ok: false,
        reason: row?.slack_email ? "slack_lookup_failed" : "coach_not_in_directory",
      });
      continue;
    }
    const dm = await openDmChannel(slackUserId);
    if (!dm) {
      results.push({
        client_id: c.id,
        client_name: c.name,
        coach: c.coach_name,
        ok: false,
        reason: "dm_open_failed",
      });
      continue;
    }

    // Generate/reuse a client-specific recording link.
    const url = await getOrCreateRecordingUrl(db, c.id);
    if (!url) {
      results.push({
        client_id: c.id,
        client_name: c.name,
        coach: c.coach_name,
        ok: false,
        reason: "recording_token_failed",
      });
      continue;
    }

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `:movie_camera: *Time to ask ${c.name} for a video testimonial*\n` +
            `${c.name} wraps up their program in ${REMINDER_DAYS_BEFORE_END} days. Now is the moment to ask, while the transformation is fresh.`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Send them this recording link (unique to ${c.name}):\n<${url}|${url}>`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "_You'll only see this reminder once per client. The video lands in the Video Testimonials tab on CCOS when they submit._",
          },
        ],
      },
    ];

    const posted = await postBlocks(dm, blocks, `Time to ask ${c.name} for a video testimonial.`);
    if (!posted.ok) {
      results.push({
        client_id: c.id,
        client_name: c.name,
        coach: c.coach_name,
        ok: false,
        reason: "post_failed",
      });
      continue;
    }

    // Stamp video_testimonial_prompted_date so we never re-fire. Create the
    // milestone row if it doesn't exist.
    const existing = milestoneByClient.get(c.id);
    if (existing) {
      await db
        .from("coach_milestones")
        .update({ video_testimonial_prompted_date: nowIso })
        .eq("id", existing.id);
    } else {
      await db.from("coach_milestones").insert({
        client_id: c.id,
        client_name: c.name,
        coach_name: c.coach_name,
        video_testimonial_prompted_date: nowIso,
        video_testimonial_completed: false,
      });
    }

    results.push({
      client_id: c.id,
      client_name: c.name,
      coach: c.coach_name,
      ok: true,
    });
  }

  return NextResponse.json({
    ok: true,
    sent: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => !r.ok).length,
    total: results.length,
    results,
    elapsed_ms: Date.now() - startedAt,
  });
}
