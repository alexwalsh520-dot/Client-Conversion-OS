import { NextRequest, NextResponse } from "next/server";
import { validateFathomWebhook } from "@/lib/fathom";

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
    const meetingId = payload.meetingId || payload.meeting_id || null;
    console.log("[fathom-webhook] Received event:", {
      eventType,
      meetingId,
      webhookId,
    });

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
