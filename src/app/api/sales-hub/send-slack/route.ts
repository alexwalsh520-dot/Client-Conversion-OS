import { NextRequest, NextResponse } from "next/server";
import { postToSlack } from "@/lib/slack";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { channelId, message } = body;

    if (!channelId || !message) {
      return NextResponse.json(
        { error: "channelId and message are required" },
        { status: 400 }
      );
    }

    const success = await postToSlack(channelId, message);

    if (!success) {
      return NextResponse.json(
        { success: false, error: "Failed to send Slack message — check SLACK_BOT_TOKEN and channel ID" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Send Slack error:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Failed to send Slack message" },
      { status: 500 }
    );
  }
}
