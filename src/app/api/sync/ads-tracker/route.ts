import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getAdEntities,
  getAdLevelInsights,
  getAdSetTargeting,
  type MetaAdEntity,
} from "@/lib/mozi-meta";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, keywordFromAdName } from "@/lib/ads-tracker/normalize";
import { parseTargeting } from "@/lib/ads-tracker/targeting";
import { storeCreativeImagesBatch } from "@/lib/ads-tracker/creative-image";
import { CREATORS, firstEnv, normalizeAdAccountId } from "@/lib/creators";

const ACCOUNTS = CREATORS;

const REPORTING_TIMEZONE = "America/New_York";
const HOURLY_ADVERTISER_BREAKDOWN = "hourly_stats_aggregated_by_advertiser_time_zone";
const DEFAULT_LOOKBACK_DAYS = 10;

type AccountConfig = (typeof ACCOUNTS)[number];

type AdsMetaInsightRow = {
  client_key: string;
  client_name: string;
  ad_account_id: string;
  account_timezone: string;
  campaign_id: string | null;
  campaign_name: string | null;
  adset_id: string | null;
  adset_name: string | null;
  ad_id: string;
  ad_name: string | null;
  ad_effective_status: string | null;
  ad_configured_status: string | null;
  campaign_effective_status: string | null;
  campaign_configured_status: string | null;
  keyword_raw: string | null;
  keyword_normalized: string | null;
  date: string;
  spend_cents: number;
  impressions: number;
  link_clicks: number;
  synced_at: string;
  raw_payload: unknown;
};

type MetaStatusMap = Map<string, MetaAdEntity>;

function creativePreviewFromEntity(entity: MetaAdEntity | null | undefined) {
  const creative = entity?.creative;
  if (!creative?.thumbnail_url && !creative?.image_url) return null;
  return {
    creative_id: creative.id || null,
    creative_name: creative.name || null,
    thumbnail_url: creative.thumbnail_url || null,
    image_url: creative.image_url || null,
  };
}

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

function datesInRange(dateFrom: string, dateTo: string) {
  const dates: string[] = [];
  for (let date = dateFrom; date <= dateTo; date = shiftDate(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function dateInTimezone(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function datePartsInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function zonedDateTimeToUtc(date: string, hour: number, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, 0, 0);
  let guess = new Date(targetUtcMs);

  for (let i = 0; i < 4; i += 1) {
    const parts = datePartsInTimezone(guess, timeZone);
    const guessAsLocalUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    const diff = guessAsLocalUtcMs - targetUtcMs;
    if (diff === 0) break;
    guess = new Date(guess.getTime() - diff);
  }

  return guess;
}

function hourFromAdvertiserBreakdown(value: string | undefined) {
  const match = value?.match(/^(\d{1,2}):/);
  if (!match) return null;
  const hour = Number(match[1]);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

function insightKeyword(row: Awaited<ReturnType<typeof getAdLevelInsights>>[number]) {
  const keyword = keywordFromAdName(row.ad_name);
  return {
    keyword,
    keywordRaw: keyword ? displayKeyword(keyword) : row.ad_name || null,
  };
}

function dailyInsightRow(
  account: AccountConfig,
  adAccountId: string,
  row: Awaited<ReturnType<typeof getAdLevelInsights>>[number],
  date: string,
  syncedAt: string,
  statusByAdId: MetaStatusMap
): AdsMetaInsightRow {
  const { keyword, keywordRaw } = insightKeyword(row);
  const status = row.ad_id ? statusByAdId.get(row.ad_id) : null;
  const creativePreview = creativePreviewFromEntity(status);
  return {
    client_key: account.key,
    client_name: account.name,
    ad_account_id: adAccountId,
    account_timezone: account.timezone,
    campaign_id: row.campaign_id || null,
    campaign_name: row.campaign_name || null,
    adset_id: row.adset_id || null,
    adset_name: row.adset_name || null,
    ad_id: row.ad_id as string,
    ad_name: row.ad_name || null,
    ad_effective_status: status?.effective_status || null,
    ad_configured_status: status?.configured_status || null,
    campaign_effective_status: status?.campaign?.effective_status || null,
    campaign_configured_status: status?.campaign?.configured_status || null,
    keyword_raw: keywordRaw,
    keyword_normalized: keyword,
    date,
    spend_cents: Math.round((Number(row.spend || 0) || 0) * 100),
    impressions: Number(row.impressions || 0) || 0,
    link_clicks: Number(row.inline_link_clicks || row.clicks || 0) || 0,
    synced_at: syncedAt,
    raw_payload: {
      ...row,
      creative_preview: creativePreview,
    },
  };
}

function buildDailyRows(
  account: AccountConfig,
  adAccountId: string,
  insights: Awaited<ReturnType<typeof getAdLevelInsights>>,
  dateFrom: string,
  dateTo: string,
  syncedAt: string,
  statusByAdId: MetaStatusMap
): AdsMetaInsightRow[] {
  if (account.timezone === REPORTING_TIMEZONE) {
    return insights
      .filter((row) => row.ad_id && row.date_start)
      .map((row) => dailyInsightRow(account, adAccountId, row, row.date_start, syncedAt, statusByAdId));
  }

  const grouped = new Map<
    string,
    Omit<AdsMetaInsightRow, "spend_cents" | "raw_payload"> & {
      spend: number;
      raw_payload: {
        reporting_timezone: string;
        account_timezone: string;
        source_breakdown: string;
        creative_preview: ReturnType<typeof creativePreviewFromEntity>;
        hourly_rows: typeof insights;
      };
    }
  >();

  for (const row of insights) {
    if (!row.ad_id || !row.date_start) continue;
    const hour = hourFromAdvertiserBreakdown(row.hourly_stats_aggregated_by_advertiser_time_zone);
    if (hour === null) continue;

    const reportingDate = dateInTimezone(
      zonedDateTimeToUtc(row.date_start, hour, account.timezone),
      REPORTING_TIMEZONE
    );
    if (reportingDate < dateFrom || reportingDate > dateTo) continue;

    const { keyword, keywordRaw } = insightKeyword(row);
    const key = `${account.key}:${row.ad_id}:${reportingDate}`;
    const existing = grouped.get(key);
    const creativePreview = creativePreviewFromEntity(statusByAdId.get(row.ad_id));

    if (!existing) {
      grouped.set(key, {
        client_key: account.key,
        client_name: account.name,
        ad_account_id: adAccountId,
        account_timezone: account.timezone,
        campaign_id: row.campaign_id || null,
        campaign_name: row.campaign_name || null,
        adset_id: row.adset_id || null,
        adset_name: row.adset_name || null,
        ad_id: row.ad_id,
        ad_name: row.ad_name || null,
        ad_effective_status: statusByAdId.get(row.ad_id)?.effective_status || null,
        ad_configured_status: statusByAdId.get(row.ad_id)?.configured_status || null,
        campaign_effective_status: statusByAdId.get(row.ad_id)?.campaign?.effective_status || null,
        campaign_configured_status: statusByAdId.get(row.ad_id)?.campaign?.configured_status || null,
        keyword_raw: keywordRaw,
        keyword_normalized: keyword,
        date: reportingDate,
        spend: Number(row.spend || 0) || 0,
        impressions: Number(row.impressions || 0) || 0,
        link_clicks: Number(row.inline_link_clicks || row.clicks || 0) || 0,
        synced_at: syncedAt,
        raw_payload: {
          reporting_timezone: REPORTING_TIMEZONE,
          account_timezone: account.timezone,
          source_breakdown: HOURLY_ADVERTISER_BREAKDOWN,
          creative_preview: creativePreview,
          hourly_rows: [row],
        },
      });
      continue;
    }

    existing.spend += Number(row.spend || 0) || 0;
    existing.impressions += Number(row.impressions || 0) || 0;
    existing.link_clicks += Number(row.inline_link_clicks || row.clicks || 0) || 0;
    existing.raw_payload.hourly_rows.push(row);
  }

  return Array.from(grouped.values()).map(({ spend, ...row }) => ({
    ...row,
    spend_cents: Math.round(spend * 100),
  }));
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function missingColumn(error: { message?: string } | null, column: string) {
  return Boolean(error?.message?.toLowerCase().includes(column.toLowerCase()));
}

const OPTIONAL_META_COLUMNS = [
  "account_timezone",
  "raw_payload",
  "ad_effective_status",
  "ad_configured_status",
  "campaign_effective_status",
  "campaign_configured_status",
];

async function upsertMetaRows(
  db: ReturnType<typeof getServiceSupabase>,
  rows: AdsMetaInsightRow[]
) {
  if (rows.length === 0) return;

  const { error } = await db
    .from("ads_meta_insights_daily")
    .upsert(rows, { onConflict: "client_key,ad_id,date" });

  const missingOptionalColumns = OPTIONAL_META_COLUMNS.filter((column) => missingColumn(error, column));
  if (error && missingOptionalColumns.length > 0) {
    const backwardsCompatibleRows = rows.map((row) => {
      const compatibleRow: Record<string, unknown> = { ...row };
      for (const column of missingOptionalColumns) delete compatibleRow[column];
      return compatibleRow;
    });
    const { error: retryError } = await db
      .from("ads_meta_insights_daily")
      .upsert(backwardsCompatibleRows, { onConflict: "client_key,ad_id,date" });

    if (retryError) throw retryError;
    return;
  }

  if (error) throw error;
}

function rowsByDate(rows: AdsMetaInsightRow[]) {
  const byDate = new Map<string, AdsMetaInsightRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) || [];
    list.push(row);
    byDate.set(row.date, list);
  }
  return byDate;
}

function summarizeRows(rows: Array<Pick<AdsMetaInsightRow, "spend_cents" | "impressions" | "link_clicks">>) {
  return {
    rowCount: rows.length,
    spendCents: rows.reduce((sum, row) => sum + (row.spend_cents || 0), 0),
    impressions: rows.reduce((sum, row) => sum + (row.impressions || 0), 0),
    linkClicks: rows.reduce((sum, row) => sum + (row.link_clicks || 0), 0),
  };
}

function summarizeDates(dateFrom: string, dateTo: string, rows: AdsMetaInsightRow[]) {
  const byDate = rowsByDate(rows);
  return datesInRange(dateFrom, dateTo).map((date) => ({
    date,
    ...summarizeRows(byDate.get(date) || []),
  }));
}

async function replaceStoredMetaSlice(
  db: ReturnType<typeof getServiceSupabase>,
  accountKey: string,
  dateFrom: string,
  dateTo: string,
  rows: AdsMetaInsightRow[]
) {
  const freshRowsByDate = rowsByDate(rows);

  for (const date of datesInRange(dateFrom, dateTo)) {
    const freshRows = freshRowsByDate.get(date) || [];
    await upsertMetaRows(db, freshRows);

    let query = db
      .from("ads_meta_insights_daily")
      .delete()
      .eq("client_key", accountKey)
      .eq("date", date);

    const ids = freshRows.map((row) => row.ad_id);
    if (ids.length > 0) {
      query = query.not("ad_id", "in", `(${ids.join(",")})`);
    }

    const { error } = await query;
    if (error) throw error;
  }

  const { data: storedRows, error: storedError } = await db
    .from("ads_meta_insights_daily")
    .select("date,ad_id,spend_cents,impressions,link_clicks")
    .eq("client_key", accountKey)
    .gte("date", dateFrom)
    .lte("date", dateTo);

  if (storedError) throw storedError;

  const expected = summarizeRows(rows);
  const stored = summarizeRows((storedRows || []) as AdsMetaInsightRow[]);

  if (
    expected.rowCount !== stored.rowCount ||
    expected.spendCents !== stored.spendCents ||
    expected.impressions !== stored.impressions ||
    expected.linkClicks !== stored.linkClicks
  ) {
    throw new Error(
      [
        "Stored Meta slice did not match latest Meta pull",
        `expected rows=${expected.rowCount} spend=${expected.spendCents} impressions=${expected.impressions} clicks=${expected.linkClicks}`,
        `stored rows=${stored.rowCount} spend=${stored.spendCents} impressions=${stored.impressions} clicks=${stored.linkClicks}`,
      ].join("; ")
    );
  }

  return {
    expected,
    stored,
    dates: summarizeDates(dateFrom, dateTo, rows),
  };
}

async function refreshStoredMetaStatuses(
  db: ReturnType<typeof getServiceSupabase>,
  accountKey: string,
  statusRows: MetaAdEntity[],
  syncedAt: string
) {
  const updateForStatus = (status: MetaAdEntity, includeOptionalColumns = true) => {
    const payload: Record<string, unknown> = { synced_at: syncedAt };
    if (includeOptionalColumns) {
      payload.ad_effective_status = status.effective_status || null;
      payload.ad_configured_status = status.configured_status || null;
      payload.campaign_effective_status = status.campaign?.effective_status || null;
      payload.campaign_configured_status = status.campaign?.configured_status || null;
    }
    return payload;
  };
  const chunks: MetaAdEntity[][] = [];
  for (let index = 0; index < statusRows.length; index += 20) {
    chunks.push(statusRows.slice(index, index + 20));
  }

  let updated = 0;
  for (const chunk of chunks) {
    await Promise.all(
      chunk.map(async (status) => {
        if (!status.id) return;
        const { error, count } = await db
          .from("ads_meta_insights_daily")
          .update(updateForStatus(status), { count: "exact" })
          .eq("client_key", accountKey)
          .eq("ad_id", status.id);

        const missingOptionalColumns = OPTIONAL_META_COLUMNS.filter((column) => missingColumn(error, column));
        if (error && missingOptionalColumns.length > 0) {
          const { error: fallbackError, count: fallbackCount } = await db
            .from("ads_meta_insights_daily")
            .update(updateForStatus(status, false), { count: "exact" })
            .eq("client_key", accountKey)
            .eq("ad_id", status.id);

          if (fallbackError) throw fallbackError;
          updated += fallbackCount || 0;
          return;
        }

        if (error) throw error;
        updated += count || 0;
      })
    );
  }

  if (statusRows.length > 0) {
    const statusIds = statusRows.map((status) => status.id).filter(Boolean);
    let query = db
      .from("ads_meta_insights_daily")
      .update(updateForStatus({ id: "" }), { count: "exact" })
      .eq("client_key", accountKey);

    if (statusIds.length > 0) {
      query = query.not("ad_id", "in", `(${statusIds.join(",")})`);
    }

    const { error, count } = await query;
    const missingOptionalColumns = OPTIONAL_META_COLUMNS.filter((column) => missingColumn(error, column));
    if (error && missingOptionalColumns.length > 0) {
      let fallbackQuery = db
        .from("ads_meta_insights_daily")
        .update(updateForStatus({ id: "" }, false), { count: "exact" })
        .eq("client_key", accountKey);

      if (statusIds.length > 0) {
        fallbackQuery = fallbackQuery.not("ad_id", "in", `(${statusIds.join(",")})`);
      }

      const { error: fallbackError, count: fallbackCount } = await fallbackQuery;
      if (fallbackError) throw fallbackError;
      updated += fallbackCount || 0;
      return updated;
    }

    if (error) throw error;
    updated += count || 0;
  }

  return updated;
}

// Pull the audience settings for every ad set in the account and store the
// parsed, numeric-friendly version keyed by adset_id, so the Deep Dive can
// later correlate "who saw it" against ROAS. This is pure enrichment — it is
// called inside its own try/catch by the caller and must NEVER affect the
// money-accurate spend sync above. Returns how many ad sets were stored.
async function syncAdSetTargeting(
  db: ReturnType<typeof getServiceSupabase>,
  clientKey: string,
  adAccountId: string,
  accessToken: string
): Promise<number> {
  const adsets = await getAdSetTargeting(adAccountId, { accessToken });
  const syncedAt = new Date().toISOString();
  const rows = adsets
    .map((adset) => {
      const p = parseTargeting(adset.targeting);
      return {
        adset_id: adset.id,
        client_key: clientKey,
        adset_name: adset.name || null,
        age_min: p?.ageMin ?? null,
        age_max: p?.ageMax ?? null,
        genders: p?.genders ?? null,
        geo_count: p?.geoCount ?? null,
        interest_count: p?.interestCount ?? null,
        custom_audience_count: p?.customAudienceCount ?? null,
        has_lookalike: p?.hasLookalike ?? false,
        placement_count: p?.placementCount ?? null,
        audience_type: p?.audienceType ?? null,
        is_advantage: p?.isAdvantage ?? false,
        raw: adset.targeting ?? null,
        synced_at: syncedAt,
      };
    })
    .filter((row) => row.adset_id);

  if (rows.length === 0) return 0;

  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await db
      .from("ad_set_targeting")
      .upsert(chunk, { onConflict: "adset_id" });
    if (error) throw error;
  }
  return rows.length;
}

async function isAuthorized(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  const session = await auth();
  return !!session?.user;
}

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dateTo = typeof body.dateTo === "string" ? body.dateTo : todayIso();
  const dateFrom =
    typeof body.dateFrom === "string" ? body.dateFrom : shiftDate(dateTo, -DEFAULT_LOOKBACK_DAYS);

  if (!isIsoDate(dateFrom) || !isIsoDate(dateTo) || dateFrom > dateTo) {
    return NextResponse.json(
      { error: "Invalid dateFrom/dateTo. Use YYYY-MM-DD and dateFrom <= dateTo." },
      { status: 400 }
    );
  }

  const db = getServiceSupabase();
  const results: Array<{
    account: string;
    fetched: number;
    storedRows: number;
    spendCents: number;
    impressions: number;
    linkClicks: number;
    statusRows?: number;
    statusRowsUpdated?: number;
    targetingStored?: number;
    imagesStored?: number;
    dates?: Array<{
      date: string;
      rowCount: number;
      spendCents: number;
      impressions: number;
      linkClicks: number;
    }>;
    error?: string;
  }> = [];
  let syncRunId: string | null = null;

  const { data: syncRun, error: syncRunError } = await db
    .from("ads_sync_runs")
    .insert({
      source: "meta_ads",
      status: "running",
      date_from: dateFrom,
      date_to: dateTo,
      accounts: ACCOUNTS.map((account) => ({
        key: account.key,
        timezone: account.timezone,
      })),
    })
    .select("id")
    .single();

  if (syncRunError) {
    console.warn("[ads-tracker-sync] Could not create sync run", syncRunError);
  } else {
    syncRunId = syncRun?.id || null;
  }

  for (const account of ACCOUNTS) {
    const rawAdAccountId = firstEnv(account.adAccountEnv);
    const token = firstEnv(account.tokenEnv);

    if (!rawAdAccountId || !token) {
      results.push({
        account: account.key,
        fetched: 0,
        storedRows: 0,
        spendCents: 0,
        impressions: 0,
        linkClicks: 0,
        error: `Missing one of ${account.adAccountEnv.join(", ")} or ${account.tokenEnv.join(", ")}`,
      });
      continue;
    }

    try {
      const adAccountId = normalizeAdAccountId(rawAdAccountId);
      const needsEasternRebucket = account.timezone !== REPORTING_TIMEZONE;
      const metaDateFrom = needsEasternRebucket ? shiftDate(dateFrom, -1) : dateFrom;
      const metaDateTo = needsEasternRebucket ? shiftDate(dateTo, 1) : dateTo;
      const syncedAt = new Date().toISOString();
      const insights = await getAdLevelInsights(adAccountId, metaDateFrom, metaDateTo, {
        accessToken: token,
        breakdowns: needsEasternRebucket ? [HOURLY_ADVERTISER_BREAKDOWN] : undefined,
      });
      const statusRows = await getAdEntities(adAccountId, { accessToken: token }).catch((error) => {
        console.warn(`[ads-tracker-sync] Could not fetch Meta ad statuses for ${account.key}`, error);
        return [] as MetaAdEntity[];
      });
      const statusByAdId = new Map(statusRows.map((row) => [row.id, row]));
      const rows = buildDailyRows(
        account,
        adAccountId,
        insights,
        dateFrom,
        dateTo,
        syncedAt,
        statusByAdId
      );

      if (needsEasternRebucket && insights.length > 0 && rows.length === 0) {
        throw new Error(
          `Meta did not return parseable ${HOURLY_ADVERTISER_BREAKDOWN} rows for ${account.key}`
        );
      }

      const replacement = await replaceStoredMetaSlice(db, account.key, dateFrom, dateTo, rows);
      const statusRowsUpdated = await refreshStoredMetaStatuses(
        db,
        account.key,
        statusRows,
        syncedAt
      );

      // Audience enrichment — strictly best-effort. A targeting failure (e.g.
      // a missing table before the migration runs, or a permissions gap) must
      // never fail the spend sync, which is the source of truth for the money.
      let targetingStored = 0;
      try {
        targetingStored = await syncAdSetTargeting(db, account.key, adAccountId, token);
      } catch (error) {
        console.warn(`[ads-tracker-sync] Targeting sync skipped for ${account.key}`, error);
      }

      // Durable creative images — best-effort, never affects the money sync.
      // Meta's preview URLs are fresh right now, so this is the one moment we can
      // reliably grab the bytes before they expire. Only ads we haven't stored
      // yet get fetched, so re-syncs stay cheap.
      let imagesStored = 0;
      try {
        const imageInputs = statusRows.map((status) => {
          const preview = creativePreviewFromEntity(status);
          return {
            adId: status.id || "",
            imageUrl: preview?.image_url || preview?.thumbnail_url || null,
            clientKey: account.key,
          };
        });
        imagesStored = await storeCreativeImagesBatch(imageInputs);
      } catch (error) {
        console.warn(`[ads-tracker-sync] Creative image store skipped for ${account.key}`, error);
      }

      results.push({
        account: account.key,
        fetched: insights.length,
        storedRows: replacement.stored.rowCount,
        spendCents: replacement.stored.spendCents,
        impressions: replacement.stored.impressions,
        linkClicks: replacement.stored.linkClicks,
        statusRows: statusRows.length,
        statusRowsUpdated,
        targetingStored,
        imagesStored,
        dates: replacement.dates,
      });
    } catch (error) {
      results.push({
        account: account.key,
        fetched: 0,
        storedRows: 0,
        spendCents: 0,
        impressions: 0,
        linkClicks: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ok = results.every((result) => !result.error);
  if (syncRunId) {
    const update = {
      status: ok ? "success" : "error",
      rows_fetched: results.reduce((sum, result) => sum + result.fetched, 0),
      rows_upserted: results.reduce((sum, result) => sum + result.storedRows, 0),
      accounts: results,
      error_message: ok
        ? null
        : results
            .filter((result) => result.error)
            .map((result) => `${result.account}: ${result.error}`)
            .join("\n"),
      completed_at: new Date().toISOString(),
    };

    const { error: updateError } = await db
      .from("ads_sync_runs")
      .update(update)
      .eq("id", syncRunId);

    if (updateError) {
      console.warn("[ads-tracker-sync] Could not update sync run", updateError);
    }
  }

  return NextResponse.json({
    ok,
    dateFrom,
    dateTo,
    results,
  });
}
