import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runActivityBackfill } from "@/lib/ads-v2/activity-sync";

// ONE-TIME history pull for the ad change log, made resumable on purpose.
//
// It runs from the deployed app rather than a laptop because that is where the
// creators' Meta tokens live, and tokens never move. Each call walks a bounded
// number of windows backward through Meta's activity history, saves its place,
// and returns. Call it again to continue; it reports done:true when history
// genuinely runs out. Re-running after that adds nothing.
//
// Not on a schedule: this is a finite job, triggered by hand, and it deliberately
// paces itself so it never competes with the hourly spend sync for Meta's rate
// limit.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = secret === process.env.CRON_SECRET;
  const session = isCron ? null : await auth();
  if (!isCron && !session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const maxWindows = Number(url.searchParams.get("windows") || "12");

  try {
    const result = await runActivityBackfill(new Date(), {
      // Leave healthy headroom under the 300s function limit.
      budgetMs: 240_000,
      maxWindows: Number.isFinite(maxWindows) ? Math.min(Math.max(maxWindows, 1), 40) : 12,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backfill failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
