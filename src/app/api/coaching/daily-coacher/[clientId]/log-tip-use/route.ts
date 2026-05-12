/**
 * Daily Coacher: log a Copy-button press.
 *
 * POST → record one row in daily_coacher_tip_uses for this client + topic.
 *        Body: { topic: TopicKey }
 *        Fire-and-forget from the DraftPanel after successful copy-to-clipboard.
 *
 * The score formula attributes credit to the client's assigned coach
 * (clients.coach_name), not to copied_by_coach. We still record
 * copied_by_coach as an audit field for future "who used Daily Coacher
 * the most" reporting.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 10;

interface PostBody {
  topic?: string;
}

function parseClientId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ clientId: string }> }
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { clientId: clientIdRaw } = await ctx.params;
  const clientId = parseClientId(clientIdRaw);
  if (!clientId) {
    return NextResponse.json({ error: "invalid clientId" }, { status: 400 });
  }

  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const topic = body.topic?.trim();
  if (!topic) {
    return NextResponse.json({ error: "topic is required" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { error } = await db.from("daily_coacher_tip_uses").insert({
    client_id: clientId,
    topic,
    copied_by_coach: session.user.name || session.user.email || null,
  });

  if (error) {
    // Log but don't fail loudly: this endpoint is fire-and-forget from
    // the UI and a failure here only loses one event from the score —
    // not worth blocking the coach's workflow over.
    console.error(
      `[api/coaching/daily-coacher/${clientId}/log-tip-use] insert failed:`,
      error.message
    );
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
