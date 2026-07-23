import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { runAdsV2Sync } from "@/lib/ads-v2/sync";

// Background sync: budget snapshot -> facts pass -> version bump -> precompute.
// All external fetching happens here, never in the request path.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  const isCron = secret === process.env.CRON_SECRET;
  // Also allow a signed-in admin to trigger a manual run from the app.
  const session = isCron ? null : await auth();
  if (!isCron && !session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runAdsV2Sync();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sync failed" },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
