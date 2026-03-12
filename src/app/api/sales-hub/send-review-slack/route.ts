import { NextRequest, NextResponse } from "next/server";
import { postToSlack } from "@/lib/slack";

/**
 * POST /api/sales-hub/send-review-slack
 * Sends a review (call or DM) to the user's Slack DM.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { review, type, closerName, setterName } = body as {
      review: string;
      type: "call" | "dm";
      closerName?: string;
      setterName?: string;
    };

    if (!review) {
      return NextResponse.json({ error: "review is required" }, { status: 400 });
    }

    // Send to user's DM — use SLACK_USER_DM env var, fall back to SLACK_CHANNEL_MARKETING
    const channelId =
      process.env.SLACK_USER_DM ||
      process.env.SLACK_CHANNEL_MARKETING;

    if (!channelId) {
      return NextResponse.json({ error: "No Slack channel configured" }, { status: 500 });
    }

    const name = closerName || setterName || "Unknown";
    const prefix =
      type === "call"
        ? `*Call Review — ${name}*`
        : `*DM Review — ${name}*`;

    // Truncate for Slack (max ~4000 chars per message)
    const truncated =
      review.length > 3500
        ? review.substring(0, 3500) + "\n\n_...truncated. Full review available as download._"
        : review;

    const sent = await postToSlack(channelId, `${prefix}\n\n${truncated}`);

    return NextResponse.json({ sent });
  } catch (err) {
    console.error("[send-review-slack] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to send to Slack" },
      { status: 500 }
    );
  }
}
