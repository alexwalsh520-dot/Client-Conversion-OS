import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runMetricsLedgerBuild } from "@/lib/metrics-engine/build";

// Metrics-engine ledger build: reads ManyChat/DM/Skool/GHL/sheet sources and
// rewrites the rolling event window + upserts the lead ledger. All heavy
// work happens here, never in the request path.
//
//   ?full=1   complete backfill from EARLIEST_DAY
//   ?days=N   override the rolling lookback (default 45 ET days)
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
    const url = new URL(req.url);
    const full = url.searchParams.get("full") === "1";
    const daysRaw = url.searchParams.get("days");
    const days = daysRaw ? Number(daysRaw) : undefined;
    const result = await runMetricsLedgerBuild({
      full,
      days: Number.isFinite(days) ? days : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[metrics-ledger-build] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "build failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
