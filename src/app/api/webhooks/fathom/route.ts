import { NextRequest, NextResponse } from "next/server";
import { validateFathomWebhook } from "@/lib/fathom";
import { getServiceSupabase } from "@/lib/supabase";
import { handleTeamCall, type FathomWebhookMeeting } from "@/lib/fathom-team-calls";

// Pull the useful bits out of whatever shape Fathom sends (event shapes vary by plan).
function pick<T = unknown>(obj: Record<string, unknown>, keys: string[]): T | null {
  for (const k of keys) {
    const v = k.split(".").reduce<unknown>((o, part) => (o && typeof o === "object" ? (o as Record<string, unknown>)[part] : undefined), obj);
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return null;
}

async function storeFathomCall(payload: Record<string, unknown>) {
  const fathom_id = pick<string>(payload, ["id", "meeting_id", "meetingId", "recording_id", "data.id", "meeting.id"]);
  const transcript = pick<string>(payload, ["transcript", "transcript_text", "data.transcript", "transcript.plaintext", "transcript.text"]);
  if (!fathom_id && !transcript) return; // nothing useful
  const row = {
    fathom_id: fathom_id ? String(fathom_id) : null,
    title: pick<string>(payload, ["title", "meeting_title", "topic", "meeting.title", "data.title"]),
    recorded_at: pick<string>(payload, ["recording_start_time", "started_at", "recorded_at", "meeting.scheduled_start_time", "created_at"]),
    duration_sec: pick<number>(payload, ["duration", "duration_seconds", "recording_duration_seconds"]),
    attendees: (pick(payload, ["attendees", "participants", "meeting.invitees"]) as unknown) ?? null,
    prospect_name: pick<string>(payload, ["prospect_name", "external_participant", "guest_name"]),
    transcript: transcript ? String(transcript) : null,
    summary: pick<string>(payload, ["summary", "ai_summary", "summary_markdown", "data.summary"]),
    raw: payload,
  };
  const sb = getServiceSupabase();
  if (row.fathom_id) {
    await sb.from("fathom_calls").upsert(row, { onConflict: "fathom_id", ignoreDuplicates: false });
  } else {
    await sb.from("fathom_calls").insert(row);
  }
}

// Fathom retries delivery within seconds, so a warm-instance cache catches the
// overwhelming majority of duplicate Slack posts. It won't survive a cold
// start; that's an accepted tradeoff over adding a table, since migrations in
// this repo have to be pasted into the Supabase dashboard by hand.
const recentDeliveries = new Map<string, number>();
const DEDUPE_TTL_MS = 10 * 60 * 1000;

function alreadyNotified(key: string): boolean {
  const now = Date.now();
  for (const [k, seenAt] of recentDeliveries) {
    if (now - seenAt > DEDUPE_TTL_MS) recentDeliveries.delete(k);
  }
  if (recentDeliveries.has(key)) return true;
  recentDeliveries.set(key, now);
  return false;
}

export async function POST(req: NextRequest) {
  try {
    // Read raw body for signature validation
    const rawBody = await req.text();

    // Standard Webhooks header names. This route previously read `x-fathom-*`,
    // which never matched anything Fathom actually sends — every delivery 401'd.
    const signature = req.headers.get("webhook-signature") || "";
    const webhookId = req.headers.get("webhook-id") || "";
    const timestamp = req.headers.get("webhook-timestamp") || "";

    // Validate webhook secret is configured
    if (!process.env.FATHOM_WEBHOOK_SECRET) {
      console.error("[fathom-webhook] FATHOM_WEBHOOK_SECRET not configured");
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }

    // Validate signature
    const isValid = validateFathomWebhook(rawBody, signature, webhookId, timestamp);
    if (!isValid) {
      console.warn("[fathom-webhook] Invalid webhook signature", {
        webhookId,
        timestamp,
        hasSignature: !!signature,
      });
      return NextResponse.json(
        { error: "Invalid webhook signature" },
        { status: 401 }
      );
    }

    // Parse the validated body
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const eventType = payload.event || payload.type || "unknown";

    // Persist the call/transcript so the Content → Coach tab can mine it. Best-effort:
    // never fail the webhook (Fathom retries on non-200) — log and still 200.
    try {
      await storeFathomCall(payload);
    } catch (e) {
      console.error("[fathom-webhook] store failed", e);
    }

    // Notify #a-sales-manager when a non-sales call finishes. Also best-effort,
    // and kept independent of the store above so one failing can't take out the
    // other.
    let notify: Awaited<ReturnType<typeof handleTeamCall>> | null = null;
    try {
      const dedupeKey =
        webhookId || String(payload.recording_id ?? "") || rawBody.slice(0, 128);
      if (alreadyNotified(dedupeKey)) {
        console.log("[fathom-webhook] Duplicate delivery — no Slack post:", dedupeKey);
      } else {
        notify = await handleTeamCall(payload as FathomWebhookMeeting);
      }
    } catch (e) {
      console.error("[fathom-webhook] team-call notification failed", e);
    }

    return NextResponse.json({ received: true, eventType, notify });
  } catch (err) {
    console.error("[fathom-webhook] Error processing webhook:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
