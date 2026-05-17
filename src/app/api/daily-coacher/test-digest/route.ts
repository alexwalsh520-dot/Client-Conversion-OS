/**
 * Admin-only diagnostic endpoint for the Daily Coacher digest.
 *
 *   GET /api/daily-coacher/test-digest?coach=Stef
 *
 * Runs every step of the digest pipeline for ONE coach and returns the
 * detailed result + the raw Slack API responses for users.lookupByEmail,
 * conversations.open, and chat.postMessage. Used to diagnose silent
 * failures that the scheduled cron's aggregated response doesn't expose.
 *
 * Does NOT update the recipient's last_sent_at (so the regular cron still
 * runs normally). Does insert a digest_sends row if the post succeeds.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  buildCandidatePool,
  weightedPick,
  pickTopicForCandidate,
  buildDigestBlocks,
  type DigestRecipient,
} from "@/lib/daily-coacher/digest";
import { generateTopicDraft } from "@/lib/daily-coacher/topic-generator";

export const runtime = "nodejs";
export const maxDuration = 120;

const SLACK_API = "https://slack.com/api";

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Two ways to auth: NextAuth admin session (normal browser use), OR
  // Bearer CRON_SECRET (so the endpoint can be curl'd from outside the
  // browser when the session cookie isn't available on this alias).
  const authHeader = req.headers.get("authorization");
  const cronBearer = process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  if (!cronBearer) {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "admin role required" }, { status: 403 });
    }
  }

  const { searchParams } = new URL(req.url);
  const coachName = searchParams.get("coach")?.trim();
  if (!coachName) {
    return NextResponse.json({ error: "?coach= required" }, { status: 400 });
  }

  const trace: Record<string, unknown> = {
    coach: coachName,
    env: {
      has_bot_token: Boolean(process.env.SLACK_BOT_TOKEN_COACHING),
      has_signing_secret: Boolean(process.env.SLACK_SIGNING_SECRET_COACHING),
      has_anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  };

  const db = getServiceSupabase();
  const token = process.env.SLACK_BOT_TOKEN_COACHING;

  // 1. Load the recipient row
  const { data: recipient } = await db
    .from("daily_coacher_recipients")
    .select("coach_name, slack_email, slack_user_id, enabled, snoozed_until")
    .eq("coach_name", coachName)
    .maybeSingle();
  trace.recipient = recipient;
  if (!recipient) {
    return NextResponse.json({ ...trace, fatal: "no recipient row" }, { status: 404 });
  }
  const r = recipient as DigestRecipient;

  // 2. Lookup user by email (raw response)
  if (token && r.slack_email) {
    const lookupRes = await fetch(
      `${SLACK_API}/users.lookupByEmail?email=${encodeURIComponent(r.slack_email)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    trace.users_lookup = await lookupRes.json();
  }

  // 3. Open DM (raw response)
  let dmChannel: string | undefined;
  if (token && r.slack_user_id) {
    const openRes = await fetch(`${SLACK_API}/conversations.open`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ users: r.slack_user_id }),
    });
    const openData = await openRes.json() as { ok: boolean; channel?: { id: string }; error?: string };
    trace.conversations_open = openData;
    dmChannel = openData.channel?.id;
  }

  // 4. Build candidate pool
  const pool = await buildCandidatePool(coachName);
  trace.pool_size = pool.length;

  if (pool.length < 5) {
    return NextResponse.json({ ...trace, note: "pool below 5; cron would skip" });
  }

  const picks = weightedPick(pool, 5);
  trace.picks = picks.map((p) => ({ id: p.client_id, name: p.client_name, phase: p.phase, weight: p.weight }));

  // 5. Generate drafts
  const draftStart = Date.now();
  const draftResults = await Promise.allSettled(
    picks.map(async (p) => {
      const topic = pickTopicForCandidate(p);
      const result = await generateTopicDraft(p.client_id, topic);
      return { candidate: p, topic, draft: result.draft };
    })
  );
  trace.draft_elapsed_ms = Date.now() - draftStart;
  trace.draft_results = draftResults.map((r, i) =>
    r.status === "fulfilled"
      ? { ok: true, topic: r.value.topic, draft_chars: r.value.draft.length }
      : { ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason), client_id: picks[i].client_id }
  );

  const items = draftResults
    .filter((r): r is PromiseFulfilledResult<{ candidate: typeof picks[number]; topic: ReturnType<typeof pickTopicForCandidate>; draft: string }> => r.status === "fulfilled")
    .map((r) => r.value);

  if (items.length === 0) {
    return NextResponse.json({ ...trace, fatal: "no drafts generated" });
  }

  if (!dmChannel) {
    return NextResponse.json({ ...trace, fatal: "no dm channel" });
  }

  // 6. Build blocks
  const blocks = buildDigestBlocks(r.slack_user_id ?? "UNKNOWN", coachName, items);
  trace.block_count = blocks.length;
  // Don't return the full blocks — they're huge. Just key counts.
  trace.blocks_size_bytes = JSON.stringify(blocks).length;

  // 7. Post message (raw response)
  if (!token) {
    return NextResponse.json({ ...trace, fatal: "no SLACK_BOT_TOKEN_COACHING" });
  }
  const postRes = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: dmChannel,
      text: `Daily Coacher: ${items.length} suggestions for today`,
      blocks,
      username: "Daily Coacher",
      icon_emoji: ":sparkles:",
      unfurl_links: false,
      unfurl_media: false,
    }),
  });
  const postData = await postRes.json();
  trace.chat_postMessage = postData;

  return NextResponse.json(trace);
}
