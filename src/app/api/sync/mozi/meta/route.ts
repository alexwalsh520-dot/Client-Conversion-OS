import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAdAccountInsights, metaAdAccounts } from "@/lib/mozi-meta";

export async function POST(req: NextRequest) {
  const supabase = getServiceSupabase();

  try {
    // Validate CRON_SECRET
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret") ?? req.headers.get("x-cron-secret");
    if (secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create sync_log entry
    const { data: logEntry, error: logError } = await supabase
      .from("mozi_sync_log")
      .insert({ source: "meta", status: "running" })
      .select("id")
      .single();

    if (logError || !logEntry) {
      throw new Error(`Failed to create sync_log: ${logError?.message}`);
    }
    const logId = logEntry.id;

    // Calculate date range: last 30 days
    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - 30);
    const sinceStr = since.toISOString().split("T")[0];
    const untilStr = now.toISOString().split("T")[0];

    if (metaAdAccounts.length === 0) {
      throw new Error("No Meta ad accounts are configured");
    }

    let recordsSynced = 0;
    for (const { influencer, adAccountId } of metaAdAccounts) {
      const insights = await getAdAccountInsights(adAccountId, sinceStr, untilStr);

      for (const day of insights) {
        const spendCents = Math.round(parseFloat(day.spend) * 100);

        const { error: upsertError } = await supabase
          .from("mozi_meta_ad_spend")
          .upsert(
            {
              influencer,
              ad_account_id: adAccountId,
              date: day.date_start,
              spend: spendCents,
              impressions: parseInt(day.impressions, 10),
              clicks: parseInt(day.clicks, 10),
              synced_at: new Date().toISOString(),
            },
            { onConflict: "influencer,date" }
          );

        if (upsertError) {
          throw new Error(`Upsert failed for ${influencer}/${day.date_start}: ${upsertError.message}`);
        }
        recordsSynced++;
      }
    }

    // Update sync_log with success
    await supabase
      .from("mozi_sync_log")
      .update({
        status: "success",
        records_synced: recordsSynced,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return NextResponse.json({
      ok: true,
      source: "meta",
      records_synced: recordsSynced,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Try to update sync_log with error (best effort)
    try {
      await supabase
        .from("mozi_sync_log")
        .update({
          status: "error",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("source", "meta")
        .eq("status", "running");
    } catch {
      // ignore logging failure
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
