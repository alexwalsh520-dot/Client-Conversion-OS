// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC, NO-LOGIN ADS API — THE SECURITY BOUNDARY for creator share links.
//
// A creator (e.g. Antwan) opens /p/ads/<token>; that page loads the live Ads
// tracker UI which fetches its data from THIS route. The contract:
//
//   * The creator scope is derived SOLELY from the token row in
//     public_share_links (token -> client_key). We NEVER read a client/account/
//     scope param from the request. A tampered ?account=tyson is ignored.
//   * Every data query is hard-filtered to that one client_key.
//   * The full dashboard payload contains a few CROSS-CREATOR fields (attribution
//     alerts + the whole-business money model list every creator). Those are
//     operator-only and are STRIPPED here so no other creator's data can ride
//     along. The creator-facing UI hides the attribution workspace anyway.
//   * Revoked / missing tokens return a clean error with no data.
//   * Service role server-side only. GET only (read-only). Never expose the
//     service role or the anon key to the client.
//
// This file is on the api/public allow-list in src/proxy.ts, so it is NOT
// auth-gated — auth is replaced by the token check below.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import {
  getAdsTrackerDashboard,
  type AdsTrackerLevel,
  type AdsTrackerStatus,
} from "@/lib/ads-tracker/server";
import { isCreatorKey, type CreatorKey } from "@/lib/creators";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
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

function isStatus(value: string | null): value is AdsTrackerStatus {
  return value === "active" || value === "finished" || value === "all";
}

function isLevel(value: string | null): value is AdsTrackerLevel {
  return value === "campaign" || value === "ad";
}

// Strip every cross-creator field from the dashboard payload so a creator-facing
// link can only ever carry that one creator's data. `rows`/`dailyRows`/`adRoas`/
// `trend`/`summary` are already scoped to the requested account by
// getAdsTrackerDashboard; only the attribution alerts + picker options span all
// creators, so we blank those. We also never attach the whole-business money
// model (which lists every creator's financials).
function sanitizeForCreator(payload: Record<string, unknown>) {
  const attribution = (payload.attribution as Record<string, unknown> | undefined) ?? undefined;
  return {
    ...payload,
    // No whole-business money model on the public surface.
    moneyModel: null,
    // The attribution workspace is operator-only; keep the per-creator revenue
    // roll-ups but drop the per-sale alert/picker lists that span creators.
    attribution: attribution
      ? {
          ...attribution,
          unmatchedSales: [],
          resolvedAlerts: [],
          keywordOptions: [],
          campaignOptions: [],
        }
      : attribution,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // 1) Resolve the token -> creator. The token is the ONLY thing that decides
  //    whose data shows. No request param can influence the scope.
  let clientKey: CreatorKey;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("client_key, kind, revoked")
      .eq("token", token)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.revoked || data.kind !== "ads") {
      return NextResponse.json(
        { error: "This share link is not available." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    if (!isCreatorKey(data.client_key)) {
      // A malformed row should fail closed, never widen to "all".
      return NextResponse.json(
        { error: "This share link is not available." },
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }
    clientKey = data.client_key;
  } catch (error) {
    console.error("[public/ads] token resolve failed", error);
    return NextResponse.json(
      { error: "This share link is not available." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  // 2) Only date/status/level may be tuned by the viewer. The account is FORCED
  //    to the token's creator — any incoming `account` param is ignored entirely.
  const sp = req.nextUrl.searchParams;
  const today = todayIso();
  const dateTo = sp.get("dateTo") || today;
  const dateFrom = sp.get("dateFrom") || shiftDate(dateTo, -6);
  const statusParam = sp.get("status");
  const levelParam = sp.get("level");

  try {
    const payload = await getAdsTrackerDashboard({
      account: clientKey, // ← derived from the token, NOT the request
      status: isStatus(statusParam) ? statusParam : "active",
      level: isLevel(levelParam) ? levelParam : "campaign",
      dateFrom,
      dateTo,
    });

    return NextResponse.json(sanitizeForCreator(payload as Record<string, unknown>), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("[public/ads] dashboard load failed", error);
    return NextResponse.json(
      { error: "Live data is temporarily unavailable." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
