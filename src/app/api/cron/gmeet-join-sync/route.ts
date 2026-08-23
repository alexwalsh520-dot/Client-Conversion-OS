import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runGmeetJoinSync } from "@/lib/metrics-engine/gmeet";

// Google Meet join-event sync: lands Meet audit sessions (who entered which
// room, for how long) in warehouse.gmeet_join_events. The metrics-engine
// build turns them into automatic show / no_show events. Runs silently
// disabled until the GMEET_* service-account env vars exist — see
// src/lib/metrics-engine/gmeet.ts for the exact setup.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = Boolean(process.env.CRON_SECRET) && secret === process.env.CRON_SECRET;
  const session = isCron ? null : await auth();
  if (!isCron && !session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runGmeetJoinSync();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[gmeet-join-sync] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
