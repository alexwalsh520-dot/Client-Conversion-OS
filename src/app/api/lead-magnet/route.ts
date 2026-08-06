/**
 * Lead Magnet funnel data.
 *
 * GET /api/lead-magnet?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   Speed to lead / pickup / booking / show / close / AOV / revenue-per-lead
 *   for the #fresh-leads lead-magnet funnel, per ET date range. Live reads:
 *   Slack (#fresh-leads pings) + GHL (calls) + sales tracker (bookings).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadMagnetReport } from "@/lib/lead-magnet/data";

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
    const report = await buildLeadMagnetReport(from, to);
    return NextResponse.json(report, { headers: NO_STORE });
  } catch (err) {
    console.error("[lead-magnet] failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Failed to build report" },
      { status: 500, headers: NO_STORE },
    );
  }
}
