const BASE_URL = "https://graph.facebook.com/v21.0";

export const metaConfig = {
  accessToken: process.env.META_ACCESS_TOKEN,
};

export const metaAdAccounts = [
  { influencer: "keith" as const, adAccountId: process.env.META_AD_ACCOUNT_KEITH },
  { influencer: "tyson" as const, adAccountId: process.env.META_AD_ACCOUNT_TYSON },
  { influencer: "zoeEmily" as const, adAccountId: process.env.META_AD_ACCOUNT_ZOE_EMILY },
].filter(
  (
    account
  ): account is {
    influencer: "keith" | "tyson" | "zoeEmily";
    adAccountId: string;
  } => Boolean(account.adAccountId),
);

interface MetaInsight {
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  clicks: string;
}

export interface MetaAdInsight {
  date_start: string;
  date_stop: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  spend?: string;
  impressions?: string;
  inline_link_clicks?: string;
  clicks?: string;
  hourly_stats_aggregated_by_advertiser_time_zone?: string;
}

interface MetaPaging {
  cursors: { before: string; after: string };
  next?: string;
  previous?: string;
}

interface MetaInsightsResponse<T = MetaInsight> {
  data: T[];
  paging?: MetaPaging;
}

async function metaFetch<T>(url: string, accessToken?: string): Promise<T> {
  const token = accessToken ?? metaConfig.accessToken;
  if (!token) {
    throw new Error("Missing META access token");
  }

  const separator = url.includes("?") ? "&" : "?";
  const authedUrl = `${url}${separator}access_token=${token}`;

  const res = await fetch(authedUrl);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meta API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch daily ad account insights for a date range.
 * Handles cursor-based pagination automatically.
 */
export async function getAdAccountInsights(
  adAccountId: string,
  since: string,
  until: string,
  options?: { accessToken?: string }
): Promise<MetaInsight[]> {
  const fields = "spend,impressions,clicks";
  const timeRange = JSON.stringify({ since, until });
  const initialUrl = `${BASE_URL}/${adAccountId}/insights?fields=${fields}&time_increment=1&limit=500&time_range=${encodeURIComponent(timeRange)}`;

  const allData: MetaInsight[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const response: MetaInsightsResponse = await metaFetch<MetaInsightsResponse>(
      nextUrl,
      options?.accessToken
    );
    allData.push(...response.data);
    nextUrl = response.paging?.next;
  }

  return allData;
}

/**
 * Fetch daily ad-level insights with the smallest field set needed by Ads Tracker.
 * Link clicks prefer Meta's inline_link_clicks; callers can fall back to clicks.
 */
export async function getAdLevelInsights(
  adAccountId: string,
  since: string,
  until: string,
  options?: { accessToken?: string; breakdowns?: string[] }
): Promise<MetaAdInsight[]> {
  const fields = [
    "campaign_id",
    "campaign_name",
    "adset_id",
    "adset_name",
    "ad_id",
    "ad_name",
    "spend",
    "impressions",
    "inline_link_clicks",
    "clicks",
  ].join(",");
  const timeRange = JSON.stringify({ since, until });
  const breakdowns = options?.breakdowns?.length
    ? `&breakdowns=${encodeURIComponent(options.breakdowns.join(","))}`
    : "";
  const initialUrl = `${BASE_URL}/${adAccountId}/insights?level=ad&fields=${fields}&time_increment=1&limit=500&time_range=${encodeURIComponent(timeRange)}${breakdowns}`;

  const allData: MetaAdInsight[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const response: MetaInsightsResponse<MetaAdInsight> =
      await metaFetch<MetaInsightsResponse<MetaAdInsight>>(
        nextUrl,
        options?.accessToken
      );
    allData.push(...response.data);
    nextUrl = response.paging?.next;
  }

  return allData;
}
