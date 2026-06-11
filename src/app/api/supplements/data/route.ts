import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildSupplementsDashboard } from "@/lib/supplements-data";
import type { PeriodKey } from "@/lib/supplements-types";

export const dynamic = "force-dynamic";

// Single-owner tab: this endpoint is the authoritative server-side gate. The
// Supplements vertical is private to one person, overriding the usual admin bypass.
const OWNER_EMAIL = "matthew@clientconversion.io";

const VALID_PERIODS: PeriodKey[] = ["this_month", "last_30", "this_year", "all_time"];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.email?.toLowerCase() !== OWNER_EMAIL) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = req.nextUrl.searchParams.get("period");
  const period: PeriodKey =
    raw && (VALID_PERIODS as string[]).includes(raw) ? (raw as PeriodKey) : "this_month";

  const data = await buildSupplementsDashboard(period);
  return NextResponse.json(data);
}
