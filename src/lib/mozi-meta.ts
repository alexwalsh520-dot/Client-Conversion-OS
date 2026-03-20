const BASE_URL = "https://graph.facebook.com/v21.0";

export const metaConfig = {
  accessToken: process.env.META_ACCESS_TOKEN,
  tysonAdAccount: process.env.META_AD_ACCOUNT_TYSON,
};

interface MetaInsight {
  date_start: string;
  date_stop: string;
  spend: string;
  impressions: string;
  clicks: string;
}

interface MetaPaging {
  cursors: { before: string; after: string };
  next?: string;
  previous?: string;
}

interface MetaInsightsResponse {
  data: MetaInsight[];
  paging?: MetaPaging;
}

async function metaFetch<T>(url: string): Promise<T> {
  const separator = url.includes("?") ? "&" : "?";
  const authedUrl = `${url}${separator}access_token=${metaConfig.accessToken}`;

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
  until: string
): Promise<MetaInsight[]> {
  const fields = "spend,impressions,clicks";
  const timeRange = JSON.stringify({ since, until });
  const initialUrl = `${BASE_URL}/${adAccountId}/insights?fields=${fields}&time_increment=1&time_range=${encodeURIComponent(timeRange)}`;

  const allData: MetaInsight[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const response: MetaInsightsResponse = await metaFetch<MetaInsightsResponse>(nextUrl);
    allData.push(...response.data);
    nextUrl = response.paging?.next;
  }

  return allData;
}
