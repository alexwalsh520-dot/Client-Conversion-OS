import { NextRequest, NextResponse } from "next/server";
import {
  getAdsTrackerDashboard,
  type AdsTrackerAccount,
  type AdsTrackerLevel,
  type AdsTrackerStatus,
} from "@/lib/ads-tracker/server";
import { computeMoneyModel } from "@/lib/ads-tracker/money-model";
import { isCreatorKey } from "@/lib/creators";

export const dynamic = "force-dynamic";
// The dashboard query + money model can be heavy; give the function real headroom
// so it never gets killed mid-compute (which surfaced as "live data unavailable").
export const maxDuration = 60;

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
  const today = todayIso();
  const dateTo = params.get("dateTo") || today;
  const dateFrom = params.get("dateFrom") || shiftDate(dateTo, -6);
  const accountParam = params.get("account");
  const statusParam = params.get("status");
  const levelParam = params.get("level");

  try {
    // Run the dashboard query and the (independent) money model IN PARALLEL so
    // their times don't stack. The money model is best-effort — a failure there
    // must never break the dashboard's money numbers, so it resolves to null.
    const [payload, moneyModel] = await Promise.all([
      getAdsTrackerDashboard({
        account: isAccount(accountParam) ? accountParam : "all",
        status: isStatus(statusParam) ? statusParam : "active",
        level: isLevel(levelParam) ? levelParam : "campaign",
        dateFrom,
        dateTo,
      }),
      computeMoneyModel().catch((error) => {
        console.warn("[ads-tracker] money model skipped", error);
        return null;
      }),
    ]);

    return NextResponse.json({ ...payload, moneyModel }, { headers: NO_STORE_HEADERS });
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
