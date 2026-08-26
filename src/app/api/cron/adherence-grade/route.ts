import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runAdherenceGrading } from "@/lib/metrics-engine/adherence";

// Rep-adherence grading: pulls each ungraded sales call's SendBlue thread
// and grades the pre-call confirmation SOP (deterministic timing pre-pass +
// one structured Claude call per appointment). Writes
// warehouse.metrics_adherence_scores; the sales-board API reads it.
//
//   ?days=N   how many past ET days of call starts to consider (default 3)
//
// Runs every 2 hours (vercel.json). Skips cleanly when ANTHROPIC_API_KEY or
// the SendBlue credentials are absent (local dev), and reports
// migration_pending when 113/115 have not been pasted yet.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = Boolean(process.env.CRON_SECRET) && secret === process.env.CRON_SECRET;
  // Also allow a signed-in admin to trigger a manual run from the app.
  const session = isCron ? null : await auth();
  if (!isCron && !session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const daysRaw = new URL(req.url).searchParams.get("days");
    const days = daysRaw ? Number(daysRaw) : undefined;
    const result = await runAdherenceGrading({
      days: Number.isFinite(days) ? days : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[adherence-grade] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "adherence grading failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
