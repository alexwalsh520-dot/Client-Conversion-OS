// Layer 1 of the Call Review Autopilot: every 30 minutes, sync fresh Fathom
// calls from every closer's key, collect finished Jeremy reviews, dispatch new
// transcripts with tracker + DM + history context.
//
// Debug: ?dry=1&fathomId=<recording_id> returns the exact prompt that call
// would get (classification + context + prompt) without sending anything.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { previewCallPrompt, runCallReviewTick } from "@/lib/call-reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sb = getServiceSupabase();
  const fathomId = req.nextUrl.searchParams.get("fathomId");
  if (req.nextUrl.searchParams.get("dry") === "1" && fathomId) {
    try {
      return NextResponse.json({ ok: true, ...(await previewCallPrompt(sb, fathomId)) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: String(e).slice(0, 300) }, { status: 404 });
    }
  }
  const report = await runCallReviewTick(sb);
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
