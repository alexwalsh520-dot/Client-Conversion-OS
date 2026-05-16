import { NextRequest, NextResponse } from "next/server";
import { getMeetingTranscript, validateFathomWebhook } from "@/lib/fathom";
import { getServiceSupabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    // Read raw body for signature validation
    const rawBody = await req.text();

    // Extract signature headers
    const signature = req.headers.get("x-fathom-signature") || "";
    const webhookId = req.headers.get("x-fathom-webhook-id") || "";
    const timestamp = req.headers.get("x-fathom-timestamp") || "";

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

    // Log the event for now
    const eventType = payload.event || payload.type || "unknown";
    const meetingId = stringField(payload.meetingId) || stringField(payload.meeting_id) || stringField(payload.id);
    console.log("[fathom-webhook] Received event:", {
      eventType,
      meetingId,
      webhookId,
    });

    if (meetingId) {
      let transcript: string | null = null;
      try {
        transcript = await getMeetingTranscript(meetingId);
      } catch (error) {
        console.warn(`[fathom-webhook] Transcript fetch skipped for ${meetingId}:`, error);
      }

      try {
        const db = getServiceSupabase();
        const { error } = await db.from("marketing_brain_fathom_calls").upsert(
          {
            meeting_id: meetingId,
            title: stringField(payload.title) || stringField(payload.meeting_title),
            share_url: stringField(payload.share_url) || stringField(payload.url),
            transcript,
            summary: stringField(payload.summary) || stringField(payload.default_summary),
            recorded_at: stringField(payload.created_at) || stringField(payload.recorded_at) || new Date().toISOString(),
            raw_payload: payload,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "meeting_id" },
        );
        if (error) console.warn("[fathom-webhook] Brain storage failed:", error.message);
      } catch (error) {
        console.warn("[fathom-webhook] Brain storage unavailable:", error);
      }
    }

    // Return 200 to acknowledge receipt
    return NextResponse.json({ received: true, eventType });
  } catch (err) {
    console.error("[fathom-webhook] Error processing webhook:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
