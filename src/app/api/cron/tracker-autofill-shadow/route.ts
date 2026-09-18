// Tracker Autofill — shadow mode. Every 30 min: compute what the system would
// write for the last 3 days of tracker rows and store it. Once a day
// (?report=1): post the side-by-side vs the closers' entries for the last 7
// days. The Google Sheet is never written from here.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides the window.
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { runShadow } from "@/lib/tracker-autofill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const p = req.nextUrl.searchParams;
  const report = await runShadow(getServiceSupabase(), {
    from: p.get("from") || undefined,
    to: p.get("to") || undefined,
    report: p.get("report") === "1",
  });
  return NextResponse.json({ ok: true, ...report });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
