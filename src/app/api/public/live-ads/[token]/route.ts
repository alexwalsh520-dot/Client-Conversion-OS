// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC, NO-LOGIN LIVE-ADS API — THE SECURITY BOUNDARY for creator share links.
//
// A creator (e.g. Antwan) opens /p/live-ads/<token>; that page renders the Live
// Ads browser, which fetches its data from THIS route. The contract:
//
//   * The creator scope is derived SOLELY from the token row in
//     public_share_links (token -> client_key). We NEVER read a client/account/
//     scope param from the request. A tampered ?account=tyson / ?client_key=all
//     is ignored entirely.
//   * getLiveAdsDashboard() returns EVERY creator's account; we hard-filter the
//     returned `accounts` array down to the SINGLE account whose `key` matches the
//     token's client_key, dropping all others. No other creator's live ads can
//     ride along.
//   * Revoked / missing / wrong-kind tokens return a clean 404 with no data.
//   * Service role server-side only. GET only (read-only). Never expose the
//     service role or the anon key to the client.
//
// This file is on the api/public allow-list in src/proxy.ts, so it is NOT
// auth-gated — auth is replaced by the token check below.
// ─────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getLiveAdsDashboard, type LiveAdsPayload } from "@/lib/live-ads";
import { isCreatorKey, type CreatorKey } from "@/lib/creators";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // 1) Resolve the token -> creator. The token is the ONLY thing that decides
  //    whose live ads show. No request param can influence the scope.
  let clientKey: CreatorKey;
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("client_key, kind, revoked")
      .eq("token", token)
      .maybeSingle();

    if (error) throw error;
    if (!data || data.revoked || data.kind !== "live-ads") {
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
    console.error("[public/live-ads] token resolve failed", error);
    return NextResponse.json(
      { error: "This share link is not available." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  // 2) Build the dashboard, then HARD-FILTER to the token's one account. We never
  //    read an account from the request — clientKey came from the token row only.
  try {
    const payload = await getLiveAdsDashboard();
    const accounts = payload.accounts.filter((account) => account.key === clientKey);
    const scoped: LiveAdsPayload = {
      ...payload,
      accounts,
      totalActiveAds: accounts.reduce((sum, account) => sum + account.activeAdsCount, 0),
    };

    return NextResponse.json(scoped, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[public/live-ads] dashboard load failed", error);
    return NextResponse.json(
      { error: "Live data is temporarily unavailable." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
