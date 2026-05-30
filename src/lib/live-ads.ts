import {
  CREATORS_BY_KEY,
  firstEnv,
  normalizeAdAccountId,
  type CreatorKey,
} from "@/lib/creators";

const BASE_URL = "https://graph.facebook.com/v21.0";

type ClientKey = CreatorKey;

type UnknownRecord = Record<string, unknown>;

interface MetaPaging {
  next?: string;
}

interface MetaResponse<T> {
  data?: T[];
  paging?: MetaPaging;
}

interface MetaCreative {
  id?: string;
  name?: string;
  thumbnail_url?: string;
  image_url?: string;
  object_story_spec?: UnknownRecord;
  asset_feed_spec?: UnknownRecord;
}

interface MetaCampaign {
  id?: string;
  name?: string;
  effective_status?: string;
  configured_status?: string;
}

interface MetaAdSet {
  id?: string;
  name?: string;
  effective_status?: string;
  configured_status?: string;
  targeting?: UnknownRecord;
  optimization_goal?: string;
  billing_event?: string;
  daily_budget?: string;
  lifetime_budget?: string;
}

interface MetaLiveAd {
  id: string;
  name?: string;
  effective_status?: string;
  configured_status?: string;
  creative?: MetaCreative;
  campaign?: MetaCampaign;
  adset?: MetaAdSet;
}

interface MetaAdSpendInsight {
  ad_id?: string;
  spend?: string;
}

export interface LiveAdsAudienceSummary {
  headline: string;
  chips: string[];
  raw: UnknownRecord | null;
}

export interface LiveAdsAd {
  id: string;
  name: string;
  status: string;
  configuredStatus: string | null;
  creativeId: string | null;
  creativeName: string | null;
  thumbnailUrl: string | null;
  body: string | null;
  title: string | null;
  metaUrl: string;
  spendLast7d: number;
}

export interface LiveAdsAdSetGroup {
  id: string;
  name: string;
  status: string | null;
  configuredStatus: string | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  dailyBudget: string | null;
  lifetimeBudget: string | null;
  audience: LiveAdsAudienceSummary;
  ads: LiveAdsAd[];
}

export interface LiveAdsCampaignGroup {
  id: string;
  name: string;
  status: string | null;
  configuredStatus: string | null;
  adSets: LiveAdsAdSetGroup[];
}

export interface LiveAdsAccountGroup {
  key: ClientKey;
  name: string;
  adAccountId: string | null;
  activeAdsCount: number;
  campaigns: LiveAdsCampaignGroup[];
  error: string | null;
}

export interface LiveAdsPayload {
  checkedAt: string;
  spendWindowLabel: string;
  totalActiveAds: number;
  accounts: LiveAdsAccountGroup[];
}

const ACCOUNTS = CREATORS_BY_KEY;

async function metaFetch<T>(url: string, accessToken: string): Promise<T> {
  const separator = url.includes("?") ? "&" : "?";
  const authedUrl = `${url}${separator}access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(authedUrl, { cache: "no-store" });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Meta API error ${response.status}: ${body}`);
  }
  return response.json() as Promise<T>;
}

async function fetchActiveMetaAds(adAccountId: string, accessToken: string) {
  const fields = [
    "id",
    "name",
    "effective_status",
    "configured_status",
    "creative{id,name,thumbnail_url,image_url,object_story_spec,asset_feed_spec}",
    "campaign{id,name,effective_status,configured_status}",
    "adset{id,name,effective_status,configured_status,targeting,optimization_goal,billing_event,daily_budget,lifetime_budget}",
  ].join(",");
  const filtering = JSON.stringify([
    { field: "effective_status", operator: "IN", value: ["ACTIVE"] },
  ]);
  const initialUrl = `${BASE_URL}/${adAccountId}/ads?fields=${fields}&filtering=${encodeURIComponent(filtering)}&limit=200`;
  const rows: MetaLiveAd[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const payload: MetaResponse<MetaLiveAd> = await metaFetch<MetaResponse<MetaLiveAd>>(nextUrl, accessToken);
    rows.push(...(payload.data || []));
    nextUrl = payload.paging?.next;
  }

  return rows.filter((ad) => ad.effective_status === "ACTIVE");
}

async function fetchRecentAdSpend(adAccountId: string, accessToken: string) {
  const fields = ["ad_id", "spend"].join(",");
  const initialUrl = `${BASE_URL}/${adAccountId}/insights?level=ad&fields=${fields}&date_preset=last_7d&limit=500`;
  const rows: MetaAdSpendInsight[] = [];
  let nextUrl: string | undefined = initialUrl;

  while (nextUrl) {
    const payload: MetaResponse<MetaAdSpendInsight> = await metaFetch<MetaResponse<MetaAdSpendInsight>>(
      nextUrl,
      accessToken
    );
    rows.push(...(payload.data || []));
    nextUrl = payload.paging?.next;
  }

  return new Map(
    rows
      .map((row) => [row.ad_id || "", Number(row.spend || 0)] as const)
      .filter(([adId, spend]) => adId && Number.isFinite(spend))
  );
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const record = item as UnknownRecord;
      return String(record.name || record.key || record.id || "").trim();
    })
    .filter(Boolean);
}

function nestedNames(targeting: UnknownRecord, key: string) {
  const direct = stringList(targeting[key]);
  const flexible = Array.isArray(targeting.flexible_spec)
    ? targeting.flexible_spec.flatMap((spec) =>
        spec && typeof spec === "object" ? stringList((spec as UnknownRecord)[key]) : []
      )
    : [];
  return [...direct, ...flexible];
}

function compactUnique(items: string[], limit = 8) {
  const seen = new Set<string>();
  const clean = items
    .map((item) => item.trim())
    .filter((item) => item && !seen.has(item.toLowerCase()) && seen.add(item.toLowerCase()));
  if (clean.length <= limit) return clean;
  return [...clean.slice(0, limit), `+${clean.length - limit} more`];
}

function genderLabel(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (value.includes(1) && value.includes(2)) return "Men + women";
  if (value.includes(1)) return "Men";
  if (value.includes(2)) return "Women";
  return null;
}

function geoSummary(targeting: UnknownRecord) {
  const geo = targeting.geo_locations;
  if (!geo || typeof geo !== "object") return null;
  const record = geo as UnknownRecord;
  const parts = [
    ...stringList(record.countries),
    ...stringList(record.regions),
    ...stringList(record.cities),
    ...stringList(record.zips),
  ];
  return compactUnique(parts, 5).join(", ") || null;
}

function extractMessage(creative: MetaCreative | undefined) {
  const spec = creative?.object_story_spec;
  if (!spec || typeof spec !== "object") return null;
  const linkData = spec.link_data as UnknownRecord | undefined;
  const videoData = spec.video_data as UnknownRecord | undefined;
  const templateData = spec.template_data as UnknownRecord | undefined;
  const message =
    linkData?.message ||
    videoData?.message ||
    templateData?.message ||
    linkData?.description ||
    videoData?.description ||
    templateData?.description;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function extractTitle(creative: MetaCreative | undefined) {
  const spec = creative?.object_story_spec;
  if (!spec || typeof spec !== "object") return creative?.name || null;
  const linkData = spec.link_data as UnknownRecord | undefined;
  const videoData = spec.video_data as UnknownRecord | undefined;
  const title = linkData?.name || videoData?.title || creative?.name;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function budgetLabel(value: string | null | undefined) {
  const cents = Number(value || 0);
  if (!Number.isFinite(cents) || cents <= 0) return null;
  return `$${Math.round(cents / 100).toLocaleString()}`;
}

function summarizeAudience(targeting: UnknownRecord | undefined | null): LiveAdsAudienceSummary {
  if (!targeting) return { headline: "Audience details unavailable", chips: [], raw: null };

  const ageMin = Number(targeting.age_min || 0);
  const ageMax = Number(targeting.age_max || 0);
  const age = ageMin || ageMax ? `Age ${ageMin || 18}-${ageMax || "65+"}` : null;
  const gender = genderLabel(targeting.genders);
  const geo = geoSummary(targeting);
  const interests = compactUnique(
    [
      ...nestedNames(targeting, "interests"),
      ...nestedNames(targeting, "behaviors"),
      ...nestedNames(targeting, "life_events"),
      ...nestedNames(targeting, "industries"),
      ...nestedNames(targeting, "income"),
      ...nestedNames(targeting, "family_statuses"),
      ...nestedNames(targeting, "education_statuses"),
      ...nestedNames(targeting, "relationship_statuses"),
    ],
    10
  );
  const customAudiences = compactUnique(
    [...stringList(targeting.custom_audiences), ...stringList(targeting.excluded_custom_audiences)],
    6
  );
  const placements = compactUnique(
    [
      ...stringList(targeting.publisher_platforms),
      ...stringList(targeting.instagram_positions),
      ...stringList(targeting.facebook_positions),
      ...stringList(targeting.device_platforms),
    ],
    8
  );
  const chips = compactUnique(
    [
      age,
      gender,
      geo ? `Geo: ${geo}` : null,
      ...interests,
      ...customAudiences.map((item) => `Audience: ${item}`),
      ...placements.map((item) => `Placement: ${item}`),
    ].filter((item): item is string => Boolean(item)),
    16
  );

  return {
    headline: chips.slice(0, 3).join(" · ") || "Broad / Meta-optimized audience",
    chips,
    raw: targeting,
  };
}

function metaAdsManagerUrl(adAccountId: string, adId: string) {
  const account = adAccountId.replace(/^act_/, "");
  return `https://business.facebook.com/adsmanager/manage/ads?act=${encodeURIComponent(
    account
  )}&selected_ad_ids=${encodeURIComponent(adId)}`;
}

function groupAds(accountName: string, adAccountId: string, ads: MetaLiveAd[], spendByAdId: Map<string, number>) {
  const campaignMap = new Map<string, LiveAdsCampaignGroup>();

  for (const ad of ads) {
    const campaignId = ad.campaign?.id || "unknown-campaign";
    const campaign = campaignMap.get(campaignId) || {
      id: campaignId,
      name: ad.campaign?.name || "Unknown campaign",
      status: ad.campaign?.effective_status || null,
      configuredStatus: ad.campaign?.configured_status || null,
      adSets: [],
    };
    const adSetId = ad.adset?.id || "unknown-adset";
    let adSet = campaign.adSets.find((item) => item.id === adSetId);
    if (!adSet) {
      adSet = {
        id: adSetId,
        name: ad.adset?.name || "Unknown ad set",
        status: ad.adset?.effective_status || null,
        configuredStatus: ad.adset?.configured_status || null,
        optimizationGoal: ad.adset?.optimization_goal || null,
        billingEvent: ad.adset?.billing_event || null,
        dailyBudget: budgetLabel(ad.adset?.daily_budget),
        lifetimeBudget: budgetLabel(ad.adset?.lifetime_budget),
        audience: summarizeAudience(ad.adset?.targeting),
        ads: [],
      };
      campaign.adSets.push(adSet);
    }

    adSet.ads.push({
      id: ad.id,
      name: ad.name || "Untitled ad",
      status: ad.effective_status || "ACTIVE",
      configuredStatus: ad.configured_status || null,
      creativeId: ad.creative?.id || null,
      creativeName: ad.creative?.name || null,
      thumbnailUrl: ad.creative?.image_url || ad.creative?.thumbnail_url || null,
      body: extractMessage(ad.creative),
      title: extractTitle(ad.creative),
      metaUrl: metaAdsManagerUrl(adAccountId, ad.id),
      spendLast7d: spendByAdId.get(ad.id) || 0,
    });

    campaignMap.set(campaignId, campaign);
  }

  return Array.from(campaignMap.values())
    .map((campaign) => ({
      ...campaign,
      name: `${accountName} · ${campaign.name}`,
      adSets: campaign.adSets
        .map((adSet) => ({
          ...adSet,
          ads: adSet.ads.sort((a, b) => a.name.localeCompare(b.name)),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getLiveAdsDashboard(): Promise<LiveAdsPayload> {
  const accounts = await Promise.all(
    (Object.keys(ACCOUNTS) as ClientKey[]).map(async (key): Promise<LiveAdsAccountGroup> => {
      const config = ACCOUNTS[key];
      const adAccountId = firstEnv(config.adAccountEnv) || config.defaultAdAccountId;
      const accessToken = firstEnv(config.tokenEnv);

      if (!adAccountId || !accessToken) {
        return {
          key,
          name: config.name,
          adAccountId: adAccountId ? normalizeAdAccountId(adAccountId) : null,
          activeAdsCount: 0,
          campaigns: [],
          error: "Meta credentials are not configured for this account.",
        };
      }

      const normalizedAccountId = normalizeAdAccountId(adAccountId);
      try {
        const [ads, spendByAdId] = await Promise.all([
          fetchActiveMetaAds(normalizedAccountId, accessToken),
          fetchRecentAdSpend(normalizedAccountId, accessToken),
        ]);
        return {
          key,
          name: config.name,
          adAccountId: normalizedAccountId,
          activeAdsCount: ads.length,
          campaigns: groupAds(config.name, normalizedAccountId, ads, spendByAdId),
          error: null,
        };
      } catch (error) {
        return {
          key,
          name: config.name,
          adAccountId: normalizedAccountId,
          activeAdsCount: 0,
          campaigns: [],
          error: error instanceof Error ? error.message : "Meta active ads failed to load.",
        };
      }
    })
  );

  return {
    checkedAt: new Date().toISOString(),
    spendWindowLabel: "Last 7 days",
    totalActiveAds: accounts.reduce((sum, account) => sum + account.activeAdsCount, 0),
    accounts,
  };
}
