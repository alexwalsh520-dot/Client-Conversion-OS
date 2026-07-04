/**
 * Daily Coach Tip cron.
 *
 * Runs at 8:30 UTC = 1:30 PM PKT via vercel.json.
 * Generates one educational tip and broadcasts it to the shared coaching
 * Slack channel. Same message for every coach on the same day.
 *
 * (Path preserved for cron continuity. The previous 5-random-clients
 * digest was removed per MAS request: no one used it.)
 *
 * Auth: x-vercel-cron header OR Bearer CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { postToCoachingChannel } from "@/lib/slack";
import { generateDailyTip, tipToSlackBlocks } from "@/lib/daily-coacher/daily-tip";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthed(req: NextRequest): boolean {
  if (req.headers.get("x-vercel-cron") === "true") return true;
  const authHeader = req.headers.get("authorization");
  return Boolean(process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const { topic, body } = await generateDailyTip();
    const posted = await postToCoachingChannel(tipToSlackBlocks(topic, body));
    return NextResponse.json({
      ok: posted,
      topic,
      chars: body.length,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("[cron/daily-coacher-digest] failed:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
        elapsed_ms: Date.now() - startedAt,
      },
      { status: 500 },
    );
  }
}
