import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdEntities, getAdLevelInsights, type MetaAdEntity } from "@/lib/mozi-meta";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, keywordFromAdName } from "@/lib/ads-tracker/normalize";

const ACCOUNTS = [
  {
    key: "tyson",
    name: "Tyson",
    timezone: "America/Los_Angeles",
    adAccountEnv: ["META_AD_ACCOUNT_TYSON", "META_ADS_ACCOUNT_TYSON"],
    tokenEnv: ["META_ACCESS_TOKEN_TYSON", "META_ADS_TOKEN", "META_ACCESS_TOKEN"],
  },
  {
    key: "keith",
    name: "Keith",
    timezone: "America/New_York",
    adAccountEnv: ["META_AD_ACCOUNT_KEITH", "META_ADS_ACCOUNT_KEITH"],
    tokenEnv: ["META_ACCESS_TOKEN_KEITH", "META_ADS_TOKEN_KEITH", "META_ACCESS_TOKEN"],
  },
] as const;

const REPORTING_TIMEZONE = "America/New_York";
const HOURLY_ADVERTISER_BREAKDOWN = "hourly_stats_aggregated_by_advertiser_time_zone";

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

function firstEnv(names: readonly string[]) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

function normalizeAdAccountId(id: string) {
  return id.startsWith("act_") ? id : `act_${id}`;
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
    raw_payload: row,
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

async function deleteStaleMetaRows(
  db: ReturnType<typeof getServiceSupabase>,
  accountKey: string,
  dateFrom: string,
  dateTo: string,
  rows: AdsMetaInsightRow[]
): Promise<{ skippedDates: string[] }> {
  const adIdsByDate = new Map<string, Set<string>>();
  for (const row of rows) {
    const ids = adIdsByDate.get(row.date) || new Set<string>();
    ids.add(row.ad_id);
    adIdsByDate.set(row.date, ids);
  }

  const skippedDates: string[] = [];
  for (const date of datesInRange(dateFrom, dateTo)) {
    const ids = Array.from(adIdsByDate.get(date) || []);
    if (ids.length === 0) {
      // Empty Meta responses can be transient. Never wipe a day unless the
      // fresh API response contains at least one row for that day.
      skippedDates.push(date);
      continue;
    }

    let query = db
      .from("ads_meta_insights_daily")
      .delete()
      .eq("client_key", accountKey)
      .eq("date", date);

    if (ids.length > 0) {
      query = query.not("ad_id", "in", `(${ids.join(",")})`);
    }

    const { error } = await query;
    if (error) throw error;
  }

  return { skippedDates };
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
    typeof body.dateFrom === "string" ? body.dateFrom : shiftDate(dateTo, -6);

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
    upserted: number;
    skippedStaleDeleteDates?: string[];
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
        upserted: 0,
        error: `Missing one of ${account.adAccountEnv.join(", ")} or ${account.tokenEnv.join(", ")}`,
      });
      continue;
    }

    try {
      const adAccountId = normalizeAdAccountId(rawAdAccountId);
      const needsEasternRebucket = account.timezone !== REPORTING_TIMEZONE;
      const metaDateFrom = needsEasternRebucket ? shiftDate(dateFrom, -1) : dateFrom;
      const metaDateTo = needsEasternRebucket ? shiftDate(dateTo, 1) : dateTo;
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
        new Date().toISOString(),
        statusByAdId
      );

      if (needsEasternRebucket && insights.length > 0 && rows.length === 0) {
        throw new Error(
          `Meta did not return parseable ${HOURLY_ADVERTISER_BREAKDOWN} rows for ${account.key}`
        );
      }

      if (rows.length > 0) await upsertMetaRows(db, rows);
      const staleDelete = await deleteStaleMetaRows(db, account.key, dateFrom, dateTo, rows);

      results.push({
        account: account.key,
        fetched: insights.length,
        upserted: rows.length,
        skippedStaleDeleteDates: staleDelete.skippedDates,
      });
    } catch (error) {
      results.push({
        account: account.key,
        fetched: 0,
        upserted: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const ok = results.every((result) => !result.error);
  if (syncRunId) {
    const update = {
      status: ok ? "success" : "error",
      rows_fetched: results.reduce((sum, result) => sum + result.fetched, 0),
      rows_upserted: results.reduce((sum, result) => sum + result.upserted, 0),
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
