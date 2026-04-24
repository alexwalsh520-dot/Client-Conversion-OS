import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdLevelInsights } from "@/lib/mozi-meta";
import { getServiceSupabase } from "@/lib/supabase";
import { displayKeyword, keywordFromAdName } from "@/lib/ads-tracker/normalize";

const ACCOUNTS = [
  {
    key: "tyson",
    name: "Tyson",
    adAccountEnv: "META_AD_ACCOUNT_TYSON",
    tokenEnv: "META_ACCESS_TOKEN_TYSON",
  },
  {
    key: "keith",
    name: "Keith",
    adAccountEnv: "META_AD_ACCOUNT_KEITH",
    tokenEnv: "META_ACCESS_TOKEN_KEITH",
  },
] as const;

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

  const db = getServiceSupabase();
  const results: Array<{ account: string; rows: number; error?: string }> = [];

  for (const account of ACCOUNTS) {
    const rawAdAccountId = process.env[account.adAccountEnv];
    const token = process.env[account.tokenEnv] || process.env.META_ACCESS_TOKEN;

    if (!rawAdAccountId || !token) {
      results.push({
        account: account.key,
        rows: 0,
        error: `Missing ${account.adAccountEnv} or ${account.tokenEnv}/META_ACCESS_TOKEN`,
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
          };
        });

      if (rows.length > 0) {
        const { error } = await db
          .from("ads_meta_insights_daily")
          .upsert(rows, { onConflict: "client_key,ad_id,date" });

        if (error) throw error;
      }

      results.push({ account: account.key, rows: rows.length });
    } catch (error) {
      results.push({
        account: account.key,
        rows: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    ok: results.every((result) => !result.error),
    dateFrom,
    dateTo,
    results,
  });
}
