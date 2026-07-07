/**
 * Manager Ads View data.
 *
 * GET /api/manager-ads?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   Per-influencer spend / messages / calls / clients / cash + cost-per-X and
 *   potential ROAS for the given ET date range. Any logged-in user with the
 *   /manager-ads tab can call it — tab access is granted per-user in Settings.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildManagerAdsReport } from "@/lib/manager-ads/metrics";

export const runtime = "nodejs";
export const maxDuration = 60;
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
    const report = await buildManagerAdsReport(from, to);
    return NextResponse.json(report, { headers: NO_STORE });
  } catch (err) {
    console.error("[manager-ads] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to build report" },
      { status: 500, headers: NO_STORE },
    );
  }
}
