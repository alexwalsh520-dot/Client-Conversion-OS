/**
 * Manager Ads View data.
 *
 * GET /api/manager-ads?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   Per-influencer spend / messages / calls / clients / collected revenue +
 *   cost-per-X and Collected ROI for the given ET date range.
 *
 *   SOURCE OF TRUTH: the Ads V2 tab. This serves the same precomputed v2 window
 *   snapshot; on a miss it returns a "preparing" payload and schedules the v2
 *   background build (same pattern as /api/ads-v2), never blocking the request.
 */

import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@/auth";
import { buildManagerAdsReport } from "@/lib/manager-ads/metrics";
import { prepareWindow } from "@/lib/ads-v2/serve";

export const runtime = "nodejs";
export const maxDuration = 30;
const NO_STORE = { "Cache-Control": "no-store" };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";
  if (!DAY_RE.test(from) || !DAY_RE.test(to) || from > to) {
    return NextResponse.json(
      { error: "from/to must be YYYY-MM-DD with from <= to" },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const { report, prepared, query } = await buildManagerAdsReport(from, to);
    // On a v2 snapshot miss, build the window AFTER the response is sent, so the
    // request stays a pure read. The client sees preparing:true and refetches.
    if (!prepared) {
      after(async () => {
        try {
          await prepareWindow(query);
        } catch {
          // A failed background build is retried on the next request or cron.
        }
      });
    }
    return NextResponse.json(report, { headers: NO_STORE });
  } catch (err) {
    console.error("[manager-ads] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to build report" },
      { status: 500, headers: NO_STORE },
    );
  }
}
