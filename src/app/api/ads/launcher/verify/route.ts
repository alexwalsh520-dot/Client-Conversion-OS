import { NextRequest, NextResponse } from "next/server";
import { displayKeyword, keywordFromAdName, normalizeKeyword } from "@/lib/ads-tracker/normalize";
import { getAdEntities } from "@/lib/mozi-meta";
import {
  CREATORS_BY_KEY,
  firstEnv,
  normalizeAdAccountId,
  type CreatorKey,
} from "@/lib/creators";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const ACCOUNTS = CREATORS_BY_KEY;

type ClientKey = CreatorKey;

function isClient(value: string | null): value is ClientKey {
  return value !== null && value in ACCOUNTS;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const client = params.get("client")?.toLowerCase() ?? null;
  const campaignName = (params.get("campaignName") || "").trim();
  const seedKeyword = normalizeKeyword(params.get("seedKeyword"));

  if (!isClient(client)) {
    return NextResponse.json(
      { available: false, error: "Choose Tyson or Keith first" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!campaignName || !seedKeyword) {
    return NextResponse.json(
      { available: false, error: "Campaign name and seed keyword are required" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const account = ACCOUNTS[client];
  const adAccountId = firstEnv(account.adAccountEnv);
  const accessToken = firstEnv(account.tokenEnv);

  if (!adAccountId || !accessToken) {
    return NextResponse.json(
      {
        available: false,
        client,
        account: account.name,
        error: "Meta read credentials are not configured for this client",
      },
      { headers: NO_STORE_HEADERS }
    );
  }

  try {
    const ads = await getAdEntities(normalizeAdAccountId(adAccountId), { accessToken });
    const campaignAds = ads.filter((ad) => (ad.campaign?.name || "").trim() === campaignName);
    const seedAds = campaignAds.filter((ad) => {
      const adKeyword = keywordFromAdName(ad.name);
      return normalizeKeyword(ad.name) === seedKeyword || adKeyword === seedKeyword;
    });
    const seedAd = seedAds[0] || null;

    return NextResponse.json(
      {
        available: true,
        client,
        account: account.name,
        checkedAt: new Date().toISOString(),
        checks: {
          campaignFound: campaignAds.length > 0,
          campaignExactName: campaignAds.length > 0,
          seedAdFound: seedAds.length > 0,
          seedKeyword: displayKeyword(seedKeyword),
        },
        counts: {
          matchingCampaignAds: campaignAds.length,
          matchingSeedAds: seedAds.length,
        },
        seedAd: seedAd
          ? {
              id: seedAd.id,
              name: seedAd.name || null,
              effectiveStatus: seedAd.effective_status || null,
              configuredStatus: seedAd.configured_status || null,
              thumbnailUrl: seedAd.creative?.thumbnail_url || seedAd.creative?.image_url || null,
            }
          : null,
        manualOnlyChecks: [
          "Ad set budget, schedule, audience stack, and placement",
          "DM greeting, question text, and automated follow-up toggle",
          "Multi-advertiser ads, Advantage+ creative, AI labels, language translation, related media, text generation, and essential enhancements",
        ],
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.error("[ads-launcher-verify] Meta read failed", error);
    return NextResponse.json(
      {
        available: false,
        client,
        account: account.name,
        error: error instanceof Error ? error.message : "Meta verification failed",
      },
      { headers: NO_STORE_HEADERS }
    );
  }
}
