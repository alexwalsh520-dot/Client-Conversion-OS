// POST /api/sync — Sync Google Sheets data into Supabase
// Dual auth: Vercel Cron (Bearer CRON_SECRET) or NextAuth session (manual Sync Now)

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  fetchCoachingFeedback,
  fetchOnboarding,
  fetchSalesData,
  fetchAdsDaily,
  SHEET_IDS,
} from "@/lib/sheets";

export async function POST(req: NextRequest) {
  // Auth check: Vercel Cron sends Bearer CRON_SECRET, manual sync uses session
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (authHeader === `Bearer ${cronSecret}`) {
    // Cron job — authorized
  } else {
    // Check NextAuth session for manual sync
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const db = getServiceSupabase();

  // Create sync log entry
  const { data: logEntry, error: logError } = await db
    .from("sync_log")
    .insert({ status: "running" })
    .select()
    .single();

  if (logError) {
    console.error("[sync] Failed to create sync log:", logError);
    // Continue anyway — sync log is nice-to-have
  }

  try {
    // Fetch all sheets in parallel
    const [coaching, onboarding, sales, tysonAds, keithAds] =
      await Promise.all([
        fetchCoachingFeedback().catch((e) => {
          console.error("[sync] Coaching fetch failed:", e);
          return [];
        }),
        fetchOnboarding().catch((e) => {
          console.error("[sync] Onboarding fetch failed:", e);
          return [];
        }),
        fetchSalesData().catch((e) => {
          console.error("[sync] Sales fetch failed:", e);
          return { closers: [], setters: [] };
        }),
        fetchAdsDaily(SHEET_IDS.tysonAds, "tyson").catch((e) => {
          console.error("[sync] Tyson ads fetch failed:", e);
          return [];
        }),
        fetchAdsDaily(SHEET_IDS.keithAds, "keith").catch((e) => {
          console.error("[sync] Keith ads fetch failed:", e);
          return [];
        }),
      ]);

    let totalRows = 0;
    const sheetsSynced: string[] = [];
    const errors: string[] = [];

    // Upsert coaching feedback — deduplicate by (client_name, date, coach_name) keeping latest
    if (coaching.length > 0) {
      const dedupMap = new Map<string, (typeof coaching)[0]>();
      for (const row of coaching) {
        const key = `${row.client_name}|${row.date}|${row.coach_name}`;
        dedupMap.set(key, row); // Last one wins (latest timestamp)
      }
      const dedupedCoaching = Array.from(dedupMap.values());

      const { error } = await db
        .from("coaching_feedback")
        .upsert(dedupedCoaching, {
          onConflict: "client_name,date,coach_name",
        });
      if (error) {
        errors.push(`coaching_feedback: ${error.message}`);
      } else {
        totalRows += dedupedCoaching.length;
        sheetsSynced.push("coaching_feedback");
      }
    }

    // Upsert onboarding
    if (onboarding.length > 0) {
      const { error } = await db
        .from("onboarding_tracker")
        .upsert(onboarding, { onConflict: "client,email" });
      if (error) {
        errors.push(`onboarding_tracker: ${error.message}`);
      } else {
        totalRows += onboarding.length;
        sheetsSynced.push("onboarding_tracker");
      }
    }

    // Upsert closer stats
    if (sales.closers.length > 0) {
      const { error } = await db
        .from("sales_closer_stats")
        .upsert(sales.closers, { onConflict: "month,closer_name" });
      if (error) {
        errors.push(`sales_closer_stats: ${error.message}`);
      } else {
        totalRows += sales.closers.length;
        sheetsSynced.push("sales_closer_stats");
      }
    }

    // Upsert setter stats
    if (sales.setters.length > 0) {
      const { error } = await db
        .from("sales_setter_stats")
        .upsert(sales.setters, { onConflict: "month,setter_name" });
      if (error) {
        errors.push(`sales_setter_stats: ${error.message}`);
      } else {
        totalRows += sales.setters.length;
        sheetsSynced.push("sales_setter_stats");
      }
    }

    // Upsert ads daily (both sources)
    const allAds = [...tysonAds, ...keithAds];
    if (allAds.length > 0) {
      const { error } = await db
        .from("ads_daily")
        .upsert(allAds, { onConflict: "source,date" });
      if (error) {
        errors.push(`ads_daily: ${error.message}`);
      } else {
        totalRows += allAds.length;
        sheetsSynced.push("ads_daily");
      }
    }

    // Update sync log
    if (logEntry) {
      await db
        .from("sync_log")
        .update({
          completed_at: new Date().toISOString(),
          status: errors.length > 0 ? "partial" : "success",
          sheets_synced: sheetsSynced,
          rows_upserted: totalRows,
          error: errors.length > 0 ? errors.join("; ") : null,
        })
        .eq("id", logEntry.id);
    }

    return NextResponse.json({
      success: true,
      rows: totalRows,
      sheets: sheetsSynced,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[sync] Fatal error:", errMsg);

    // Update sync log with error
    if (logEntry) {
      await db
        .from("sync_log")
        .update({
          completed_at: new Date().toISOString(),
          status: "error",
          error: errMsg,
        })
        .eq("id", logEntry.id);
    }

    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}

// GET /api/sync — Return last sync status
export async function GET() {
  const db = getServiceSupabase();

  try {
    const { data } = await db
      .from("sync_log")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(5);

    return NextResponse.json({ syncs: data || [] });
  } catch {
    return NextResponse.json({ syncs: [] });
  }
}
