import { NextRequest, NextResponse } from "next/server";
import {
  getAdsTrackerDashboard,
  type AdsTrackerAccount,
  type AdsTrackerRow,
  type AdsTrackerStatus,
} from "@/lib/ads-tracker/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

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
  return value === "all" || value === "tyson" || value === "keith";
}

function isStatus(value: string | null): value is AdsTrackerStatus {
  return value === "active" || value === "finished" || value === "all";
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const today = todayIso();
  const dateTo = params.get("dateTo") || today;
  const dateFrom = params.get("dateFrom") || shiftDate(dateTo, -30);
  const accountParam = params.get("account");
  const statusParam = params.get("status");
  const limit = Math.max(1, Math.min(40, Number(params.get("limit") || 12) || 12));

  try {
    const payload = await getAdsTrackerDashboard({
      account: isAccount(accountParam) ? accountParam : "all",
      status: isStatus(statusParam) ? statusParam : "all",
      level: "ad",
      dateFrom,
      dateTo,
    });

    const rows = ((payload as { rows?: AdsTrackerRow[] }).rows || [])
      .filter((row) => row.adSpend > 0 && (row.previewImageUrl || row.previewThumbnailUrl))
      .sort((a, b) => b.adSpend - a.adSpend)
      .slice(0, limit);

    return NextResponse.json({
      query: { dateFrom, dateTo, account: isAccount(accountParam) ? accountParam : "all" },
      winners: rows.map((row) => ({
        id: row.adId || row.id,
        clientKey: row.clientKey,
        adId: row.adId,
        adName: row.adName,
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        keyword: row.keyword,
        spend: row.adSpend,
        impressions: row.impressions,
        linkClicks: row.linkClicks,
        previewImageUrl: row.previewImageUrl || row.previewThumbnailUrl,
        previewThumbnailUrl: row.previewThumbnailUrl || row.previewImageUrl,
        extractedCopy: "",
        offerType: "Free Challenge",
      })),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-copy-lab-winners] load failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load winning ads" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
