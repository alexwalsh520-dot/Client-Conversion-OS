import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdLevelInsights } from "@/lib/mozi-meta";
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

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function missingColumn(error: { message?: string } | null, column: string) {
  return Boolean(error?.message?.toLowerCase().includes(column.toLowerCase()));
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
  const results: Array<{ account: string; fetched: number; upserted: number; error?: string }> = [];
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
      const insights = await getAdLevelInsights(adAccountId, dateFrom, dateTo, {
        accessToken: token,
      });

      const rows = insights
        .filter((row) => row.ad_id && row.date_start)
        .map((row) => {
          const keyword = keywordFromAdName(row.ad_name);
          const linkClicks = Number(row.inline_link_clicks || row.clicks || 0) || 0;
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
            keyword_raw: keyword ? displayKeyword(keyword) : row.ad_name || null,
            keyword_normalized: keyword,
            date: row.date_start,
            spend_cents: Math.round((Number(row.spend || 0) || 0) * 100),
            impressions: Number(row.impressions || 0) || 0,
            link_clicks: linkClicks,
            synced_at: new Date().toISOString(),
            raw_payload: row,
          };
        });

      if (rows.length > 0) {
        const { error } = await db
          .from("ads_meta_insights_daily")
          .upsert(rows, { onConflict: "client_key,ad_id,date" });

        if (error && (missingColumn(error, "account_timezone") || missingColumn(error, "raw_payload"))) {
          const backwardsCompatibleRows = rows.map((row) => {
            const compatibleRow: Record<string, unknown> = { ...row };
            delete compatibleRow.account_timezone;
            delete compatibleRow.raw_payload;
            return compatibleRow;
          });
          const { error: retryError } = await db
            .from("ads_meta_insights_daily")
            .upsert(backwardsCompatibleRows, { onConflict: "client_key,ad_id,date" });

          if (retryError) throw retryError;
        } else if (error) {
          throw error;
        }
      }

      results.push({ account: account.key, fetched: insights.length, upserted: rows.length });
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
