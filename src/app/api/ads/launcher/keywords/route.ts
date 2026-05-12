import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, normalizeKeyword } from "@/lib/ads-tracker/normalize";

export const dynamic = "force-dynamic";

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

function isClient(value: string | null): value is "tyson" | "keith" {
  return value === "tyson" || value === "keith";
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const client = params.get("client")?.toLowerCase() ?? null;

  if (!isClient(client)) {
    return NextResponse.json(
      { available: false, error: "Choose Tyson or Keith first", keywords: [] },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const dateTo = params.get("dateTo") || todayIso();
  const dateFrom = params.get("dateFrom") || shiftDate(dateTo, -30);

  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("ads_meta_insights_daily")
      .select("keyword_normalized,keyword_raw,ad_name,campaign_name,date")
      .eq("client_key", client)
      .gte("date", dateFrom)
      .lte("date", dateTo)
      .not("keyword_normalized", "is", null)
      .order("date", { ascending: false })
      .limit(1000);

    if (error) throw error;

    const byKeyword = new Map<string, { keyword: string; lastSeen: string; source: string }>();
    for (const row of data || []) {
      const normalized = normalizeKeyword(row.keyword_normalized || row.keyword_raw);
      if (!normalized) continue;
      const existing = byKeyword.get(normalized);
      const date = String(row.date || "");
      if (!existing || date > existing.lastSeen) {
        byKeyword.set(normalized, {
          keyword: displayKeyword(normalized),
          lastSeen: date,
          source: String(row.campaign_name || row.ad_name || "Meta"),
        });
      }
    }

    return NextResponse.json(
      {
        available: true,
        client,
        dateFrom,
        dateTo,
        keywords: Array.from(byKeyword.values()),
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[ads-launcher-keywords] lookup failed", error);
    return NextResponse.json(
      {
        available: false,
        client,
        dateFrom,
        dateTo,
        error: error instanceof Error ? error.message : "Keyword lookup failed",
        keywords: [],
      },
      { headers: NO_STORE_HEADERS }
    );
  }
}
