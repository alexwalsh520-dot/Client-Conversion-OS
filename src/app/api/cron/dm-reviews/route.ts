// Setter DM Review: nightly, Jeremy grades every engaged Instagram conversation
// per setter and posts a SETTER BRIEF per setter to #a-sales-manager.
// ?date=YYYY-MM-DD re-runs a day (ET); ?setter=Amara limits to one setter;
// ?force=1 re-posts a brief that already completed.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { runDmReviews } from "@/lib/dm-reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const p = req.nextUrl.searchParams;
  const report = await runDmReviews(getServiceSupabase(), {
    date: p.get("date") || undefined,
    setter: p.get("setter") || undefined,
    force: p.get("force") === "1",
  });
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
