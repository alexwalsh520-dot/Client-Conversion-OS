// Lead Score pilot: nightly, score yesterday's new Tyson keyword leads from
// the opening of their DM conversation. Silent: writes public.lead_scores
// only; no UI reads it during the pilot. ?days= and ?limit= support backfill.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { runLeadScoreTick } from "@/lib/lead-score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const days = url.searchParams.get("days");
  const limit = url.searchParams.get("limit");
  const report = await runLeadScoreTick(getServiceSupabase(), {
    clientKey: "tyson",
    days: days ? Number(days) : undefined,
    limit: limit ? Number(limit) : undefined,
  });
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
