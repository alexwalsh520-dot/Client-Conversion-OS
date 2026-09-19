// Setter DM Review: nightly, the model grades every engaged Instagram
// conversation per setter and writes ONE combined "DM Brief — {date}" PDF to
// #a-sales-manager (owner's rule: exactly one message per day, no per-setter
// briefs, no parts). The whole thing — grade, combine, deliver — completes
// synchronously in this one invocation; the response carries timings_ms.
// ?date=YYYY-MM-DD re-runs a day (ET); ?setter=Amara grades one setter silently
// (debug — never posts); ?force=1 regrades and reposts the whole day (a day
// whose brief already went out is otherwise skipped).
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
