import { NextRequest, NextResponse } from "next/server";
import {
  getInstagramWebhookStatus,
  processInstagramWebhookPayload,
  validateInstagramWebhookChallenge,
  verifyInstagramWebhookSignature,
} from "@/lib/instagram-dm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const challenge = validateInstagramWebhookChallenge(req.nextUrl.searchParams);

  if (challenge.matched) {
    return new NextResponse(challenge.body, {
      status: challenge.status,
      headers: { "Content-Type": "text/plain" },
    });
  }

  return NextResponse.json({
    status: "ok",
    description:
      "Instagram DM webhook for Outreach. Meta should call this endpoint for verification and live message events.",
    config: getInstagramWebhookStatus(),
  });
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-hub-signature-256");

    if (!verifyInstagramWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const result = await processInstagramWebhookPayload(payload);

    return NextResponse.json({
      status: "ok",
      ...result,
    });
  } catch (error) {
    console.error("[instagram-webhook] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to process Instagram webhook",
      },
      { status: 500 },
    );
  }
}
