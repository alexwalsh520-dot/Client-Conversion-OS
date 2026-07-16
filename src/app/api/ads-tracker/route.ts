import { NextRequest, NextResponse } from "next/server";
import {
  type AdsTrackerAccount,
  type AdsTrackerLevel,
  type AdsTrackerStatus,
} from "@/lib/ads-tracker/server";
import { serveDashboard, refreshStandardWindows } from "@/lib/ads-tracker/snapshot";
import { isCreatorKey } from "@/lib/creators";

export const dynamic = "force-dynamic";
// Snapshot cache serves in well under a second; a cache miss computes once then stores, so give
// headroom for that first custom-window compute (which surfaced before as "live data unavailable").
export const maxDuration = 120;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isAccount(value: string | null): value is AdsTrackerAccount {
  return value === "all" || isCreatorKey(value);
}
function isStatus(value: string | null): value is AdsTrackerStatus {
  return value === "active" || value === "finished" || value === "all";
}
function isLevel(value: string | null): value is AdsTrackerLevel {
  return value === "campaign" || value === "ad";
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // Sync Now / cron: recompute the standard windows into the snapshot cache, then return.
  if (params.get("refresh") === "1") {
    const result = await refreshStandardWindows();
    return NextResponse.json({ refreshed: true, ...result }, { headers: NO_STORE_HEADERS });
  }

  const today = todayIso();
  const dateTo = params.get("dateTo") || today;
  const dateFrom = params.get("dateFrom") || shiftDate(dateTo, -6);
  const accountParam = params.get("account");
  const statusParam = params.get("status");
  const levelParam = params.get("level");
  // view=paint serves the slim first-paint projection (drops the heavy detail fields the initial
  // render never shows); the client requests the full view behind it. Default = full (back-compat).
  const view = params.get("view") === "paint" ? "paint" : "full";

  try {
    const payload = await serveDashboard({
      account: isAccount(accountParam) ? accountParam : "all",
      status: isStatus(statusParam) ? statusParam : "active",
      level: isLevel(levelParam) ? levelParam : "campaign",
      dateFrom,
      dateTo,
    }, view);
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[ads-tracker] Dashboard load failed", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Ads Tracker failed to load live data",
        query: { dateFrom, dateTo },
      },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
