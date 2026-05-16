/**
 * Slack interactions webhook for the Daily Coacher digest.
 *
 * Receives Slack-signed POSTs for:
 *   - Button clicks: open_in_ccos, regenerate, snooze, add_coach_slack_email
 *   - Modal submissions: add_coach_slack_email_modal
 *
 * Slack expects responses within 3 seconds; long-running work (drafts
 * regen, message updates) runs after the initial 200 via next/server's
 * `after()`.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  verifyRequestSignature,
  openModal,
  updateMessage,
  postBlocks,
  ADMIN_SLACK_USER_ID,
} from "@/lib/slack/coaching-bot";
import { generateTopicDraft, type TopicNotReadyError } from "@/lib/daily-coacher/topic-generator";
import { buildDigestBlocks, type DigestCandidate } from "@/lib/daily-coacher/digest";
import type { TopicKey } from "@/lib/daily-coacher/topics";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ButtonAction {
  action_id: string;
  value?: string;
}

interface SlackInteractionPayload {
  type: string;
  trigger_id?: string;
  user?: { id: string; name?: string };
  channel?: { id: string };
  message?: { ts: string; blocks?: unknown[] };
  actions?: ButtonAction[];
  view?: {
    callback_id: string;
    private_metadata?: string;
    state?: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> };
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();

  // 1. Verify signature. Prefer the coaching-specific signing secret
  // (matches SLACK_BOT_TOKEN_COACHING). Falls back to the generic
  // SLACK_SIGNING_SECRET if only that one is set, so this endpoint
  // remains usable across either env layout.
  const ok = verifyRequestSignature({
    signingSecret:
      process.env.SLACK_SIGNING_SECRET_COACHING ??
      process.env.SLACK_SIGNING_SECRET ??
      "",
    signatureHeader: req.headers.get("x-slack-signature"),
    timestampHeader: req.headers.get("x-slack-request-timestamp"),
    rawBody,
  });
  if (!ok) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // 2. Slack sends URL-encoded body with payload=<JSON>
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get("payload");
  if (!payloadStr) {
    return NextResponse.json({ error: "missing payload" }, { status: 400 });
  }
  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadStr) as SlackInteractionPayload;
  } catch {
    return NextResponse.json({ error: "invalid payload JSON" }, { status: 400 });
  }

  // 3. Route by type
  if (payload.type === "block_actions") {
    return handleBlockActions(payload);
  }
  if (payload.type === "view_submission") {
    return handleViewSubmission(payload);
  }

  // Unknown type — acknowledge so Slack stops retrying.
  return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Block actions: button clicks
// ---------------------------------------------------------------------------

async function handleBlockActions(payload: SlackInteractionPayload): Promise<NextResponse> {
  const action = payload.actions?.[0];
  if (!action) return NextResponse.json({ ok: true });

  switch (action.action_id) {
    case "open_in_ccos":
      // Slack handles the URL navigation client-side; we just log the click.
      after(logOpenInCcos(action));
      return NextResponse.json({ ok: true });

    case "regenerate":
      after(handleRegenerate(payload, action));
      return NextResponse.json({ ok: true });

    case "snooze":
      after(handleSnooze(payload, action));
      return NextResponse.json({ ok: true });

    case "add_coach_slack_email":
      // Open the modal synchronously so Slack can use the trigger_id (which
      // expires in ~3 seconds).
      if (payload.trigger_id) {
        await openModalForCoachEmail(payload.trigger_id, action.value ?? "{}");
      }
      return NextResponse.json({ ok: true });

    default:
      return NextResponse.json({ ok: true });
  }
}

async function logOpenInCcos(action: ButtonAction) {
  try {
    const value = JSON.parse(action.value ?? "{}") as { digest_send_id?: number };
    if (!value.digest_send_id) return;
    const db = getServiceSupabase();
    await db
      .from("daily_coacher_digest_sends")
      .update({ opened_in_ccos_at: new Date().toISOString() })
      .eq("id", value.digest_send_id);
  } catch (err) {
    console.warn("[slack/interactions] logOpenInCcos failed:", err);
  }
}

async function handleRegenerate(payload: SlackInteractionPayload, action: ButtonAction) {
  try {
    const value = JSON.parse(action.value ?? "{}") as {
      digest_send_id?: number;
      client_id: number;
      topic: TopicKey;
      coach_name: string;
    };
    const channelId = payload.channel?.id;
    const messageTs = payload.message?.ts;
    if (!channelId || !messageTs) return;

    const db = getServiceSupabase();

    // Generate fresh draft
    const result = await generateTopicDraft(value.client_id, value.topic);

    // Load the client info for the rebuild
    const { data: clientRow } = await db
      .from("clients")
      .select("id, name, start_date, end_date")
      .eq("id", value.client_id)
      .single();
    if (!clientRow) return;
    const c = clientRow as { id: number; name: string; start_date: string | null; end_date: string | null };

    const today = new Date();
    const start = c.start_date ? new Date(c.start_date) : today;
    const end = c.end_date ? new Date(c.end_date) : today;
    const programDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    const daysElapsed = Math.max(0, Math.round((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
    const daysRemaining = Math.max(0, Math.round((end.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)));

    const candidate: DigestCandidate = {
      client_id: c.id,
      client_name: c.name,
      start_date: c.start_date,
      end_date: c.end_date,
      days_remaining: daysRemaining,
      days_elapsed: daysElapsed,
      program_days: programDays,
      phase: "mid_program",
      last_touch_at: null,
      weight: 1,
    };

    // Rebuild ONE block group (full message replacement keeps things simple)
    const slackUserId = payload.user?.id ?? "";
    const blocks = buildDigestBlocks(slackUserId, value.coach_name, [
      { candidate, topic: value.topic, draft: result.draft, digestSendId: value.digest_send_id },
    ]);
    await updateMessage(channelId, messageTs, blocks, "Updated draft");

    // Bump regenerate counter
    if (value.digest_send_id) {
      const { data: row } = await db
        .from("daily_coacher_digest_sends")
        .select("regenerate_count")
        .eq("id", value.digest_send_id)
        .single();
      const cur = (row as { regenerate_count?: number } | null)?.regenerate_count ?? 0;
      await db
        .from("daily_coacher_digest_sends")
        .update({
          regenerated_at: new Date().toISOString(),
          regenerate_count: cur + 1,
          draft_excerpt: result.draft.slice(0, 500),
        })
        .eq("id", value.digest_send_id);
    }
  } catch (err) {
    console.warn("[slack/interactions] handleRegenerate failed:", err);
  }
}

async function handleSnooze(payload: SlackInteractionPayload, action: ButtonAction) {
  try {
    const days = parseInt(action.value ?? "0", 10);
    if (![1, 2, 3].includes(days)) return;
    const slackUserId = payload.user?.id;
    if (!slackUserId) return;

    const db = getServiceSupabase();
    const { data: rec } = await db
      .from("daily_coacher_recipients")
      .select("coach_name")
      .eq("slack_user_id", slackUserId)
      .maybeSingle();
    if (!rec) return;

    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    await db
      .from("daily_coacher_recipients")
      .update({ snoozed_until: until })
      .eq("coach_name", (rec as { coach_name: string }).coach_name);

    // Confirmation message in DM
    const channelId = payload.channel?.id;
    if (channelId) {
      await postBlocks(
        channelId,
        [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:zzz: Got it. You won't get a Daily Coacher digest for the next ${days} day${days === 1 ? "" : "s"}.`,
            },
          },
        ],
        "Daily Coacher digest snoozed"
      );
    }
  } catch (err) {
    console.warn("[slack/interactions] handleSnooze failed:", err);
  }
}

async function openModalForCoachEmail(triggerId: string, valueRaw: string): Promise<void> {
  let coachName = "(unknown)";
  try {
    const value = JSON.parse(valueRaw) as { coach_name?: string };
    coachName = value.coach_name ?? coachName;
  } catch {
    /* fallback */
  }

  const view = {
    type: "modal",
    callback_id: "add_coach_slack_email_modal",
    private_metadata: JSON.stringify({ coach_name: coachName }),
    title: { type: "plain_text", text: "New coach Slack email" },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `Coach: *${coachName}*\n\nEnter the Slack email this coach uses to sign in to Slack. They'll start receiving digests in the next round.` },
      },
      {
        type: "input",
        block_id: "email_block",
        element: {
          type: "plain_text_input",
          action_id: "email_input",
          placeholder: { type: "plain_text", text: "name@example.com" },
        },
        label: { type: "plain_text", text: "Slack email" },
      },
    ],
  };
  await openModal(triggerId, view);
}

// ---------------------------------------------------------------------------
// View submission: modal "Save" clicked
// ---------------------------------------------------------------------------

async function handleViewSubmission(payload: SlackInteractionPayload): Promise<NextResponse> {
  const view = payload.view;
  if (!view) return NextResponse.json({ ok: true });

  if (view.callback_id !== "add_coach_slack_email_modal") {
    return NextResponse.json({ ok: true });
  }

  let coachName = "(unknown)";
  try {
    const meta = JSON.parse(view.private_metadata ?? "{}") as { coach_name?: string };
    coachName = meta.coach_name ?? coachName;
  } catch {
    /* fallback */
  }

  const email = view.state?.values?.email_block?.email_input?.value?.trim();
  if (!email || !/^.+@.+\..+$/.test(email)) {
    // Slack expects errors on validation failures
    return NextResponse.json({
      response_action: "errors",
      errors: { email_block: "Please enter a valid email." },
    });
  }

  const db = getServiceSupabase();
  await db
    .from("daily_coacher_recipients")
    .upsert(
      { coach_name: coachName, slack_email: email, enabled: true, slack_user_id: null },
      { onConflict: "coach_name" }
    );
  await db
    .from("daily_coacher_pending_coaches")
    .update({ resolved_at: new Date().toISOString() })
    .eq("coach_name", coachName);

  // Confirmation DM to admin
  after((async () => {
    const dm = await import("@/lib/slack/coaching-bot").then((m) => m.openDmChannel(ADMIN_SLACK_USER_ID));
    if (!dm) return;
    await postBlocks(
      dm,
      [
        {
          type: "section",
          text: { type: "mrkdwn", text: `:white_check_mark: Saved \`${email}\` for *${coachName}*. They'll get the digest in the next round.` },
        },
      ],
      `Saved Slack email for ${coachName}`
    );
  })());

  // Returning {} closes the modal. response_action: 'clear' would close
  // all modals if there were nested ones.
  return NextResponse.json({});
}
