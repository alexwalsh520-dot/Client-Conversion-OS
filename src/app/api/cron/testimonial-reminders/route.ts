/**
 * GET /api/cron/testimonial-reminders
 *
 * Daily. Finds every active client past their 21-day mark whose coach
 * hasn't been pinged yet, DMs the coach with the client name + Trustpilot
 * link, and stamps `testimonial_reminder_sent_at` on the client row so it
 * never fires again for the same client.
 *
 * Design decisions worth calling out:
 *
 * - **One-time, per client** — MAS wanted a nudge, not a drip. The stamp
 *   is the idempotency boundary; we never re-check or re-DM.
 * - **Coach directory reuse** — Slack IDs come from `daily_coacher_recipients`,
 *   the same table the daily-coacher cron uses. If a coach isn't listed
 *   there (never enrolled in the tip flow, never resolved via email), we
 *   skip them and log — no admin-ping like the daily tip does, since a
 *   missing reminder is not urgent enough to bother MAS with.
 * - **Whitelabel note** — the Trustpilot link is Forge-specific. MAS
 *   explicitly chose to send this same link to every coach across every
 *   brand for now (see project_ccos_whitelabel memory). Coaches on other
 *   brands know to substitute their own review flow.
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

export const runtime = "nodejs";
export const maxDuration = 120;

const TRUSTPILOT_URL = "https://www.trustpilot.com/review/theforge.limited";
const REMINDER_THRESHOLD_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const authHeader = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`);
}

interface ClientRow {
  id: number;
  name: string;
  coach_name: string;
  start_date: string;
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const startedAt = Date.now();
  const now = new Date();
  const thresholdDate = new Date(now.getTime() - REMINDER_THRESHOLD_DAYS * DAY_MS);
  // start_date is stored as YYYY-MM-DD text — compare like-with-like.
  const thresholdIso = thresholdDate.toISOString().split("T")[0];

  const { data: clientsData, error: clientsErr } = await db
    .from("clients")
    .select("id, name, coach_name, start_date")
    .eq("status", "active")
    .not("coach_name", "is", null)
    .not("start_date", "is", null)
    .lte("start_date", thresholdIso)
    .is("testimonial_reminder_sent_at", null);
  if (clientsErr) {
    return NextResponse.json({ error: clientsErr.message }, { status: 500 });
  }

  const clients = (clientsData ?? []) as ClientRow[];
  if (clients.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      note: "no clients past 3-week mark waiting for a reminder",
      elapsed_ms: Date.now() - startedAt,
    });
  }

  // Coach → Slack directory.
  const { data: recRows } = await db
    .from("daily_coacher_recipients")
    .select("coach_name, slack_email, slack_user_id");
  const recipientByCoach = new Map<string, RecipientRow>();
  for (const r of (recRows ?? []) as RecipientRow[]) {
    recipientByCoach.set(r.coach_name, r);
  }

  const results: SendResult[] = [];

  for (const c of clients) {
    const row = recipientByCoach.get(c.coach_name);

    // Resolve Slack user id: cached first, then email lookup + cache.
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

    const daysOn = Math.floor(
      (now.getTime() - new Date(c.start_date).getTime()) / DAY_MS,
    );

    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            `:star2: *Time to ask ${c.name} for a written testimonial*\n` +
            `${c.name} has been on the program for ${daysOn} days. If they're feeling good about the progress, this is a great moment to ask for a written review on Trustpilot.`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Send them this link:\n<${TRUSTPILOT_URL}|${TRUSTPILOT_URL}>`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "_You'll only see this reminder once per client, at the 3-week mark._",
          },
        ],
      },
    ];

    const posted = await postBlocks(
      dm,
      blocks,
      `Time to ask ${c.name} for a Trustpilot review.`,
    );

    if (posted.ok) {
      await db
        .from("clients")
        .update({ testimonial_reminder_sent_at: now.toISOString() })
        .eq("id", c.id);
      results.push({
        client_id: c.id,
        client_name: c.name,
        coach: c.coach_name,
        ok: true,
      });
    } else {
      results.push({
        client_id: c.id,
        client_name: c.name,
        coach: c.coach_name,
        ok: false,
        reason: "post_failed",
      });
    }
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
