import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { whopClients, getAllWhopPayments } from "@/lib/mozi-whop";

export async function POST(request: Request) {
  // Validate CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Create sync_log entry
  const { data: logEntry, error: logError } = await supabase
    .from("mozi_sync_log")
    .insert({ source: "whop", status: "running" })
    .select("id")
    .single();

  if (logError || !logEntry) {
    return NextResponse.json(
      { error: "Failed to create sync log" },
      { status: 500 }
    );
  }

  const logId = logEntry.id;

  try {
    let totalSynced = 0;

    for (const { apiKey, influencer } of whopClients) {
      const payments = await getAllWhopPayments(apiKey);

      for (const payment of payments) {
        // Whop amounts: use final_amount if available, otherwise amount
        // Convert to cents if the value appears to be in dollars (has decimals)
        let rawAmount =
          (payment.final_amount as number) ?? (payment.amount as number) ?? 0;

        // If amount looks like dollars (not cents), convert
        if (typeof rawAmount === "number" && rawAmount > 0 && rawAmount < 1000) {
          // Heuristic: Whop may return dollars — if so, convert to cents
          // Values under 1000 that have decimal precision are likely dollars
          const str = String(rawAmount);
          if (str.includes(".")) {
            rawAmount = Math.round(rawAmount * 100);
          }
        }

        const row = {
          whop_id: payment.id,
          influencer,
          amount: rawAmount,
          status: (payment.status as string) ?? null,
          customer_email: (payment.user_email as string) ?? null,
          created_at: payment.created_at
            ? new Date(payment.created_at as string).toISOString()
            : null,
          synced_at: new Date().toISOString(),
        };

        const { error: upsertError } = await supabase
          .from("mozi_whop_payments")
          .upsert(row, { onConflict: "whop_id" });

        if (upsertError) {
          console.error(
            `Failed to upsert payment ${payment.id}:`,
            upsertError.message
          );
          continue;
        }

        totalSynced++;
      }
    }

    // Update sync_log with success
    await supabase
      .from("mozi_sync_log")
      .update({
        status: "success",
        records_synced: totalSynced,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return NextResponse.json({ success: true, records_synced: totalSynced });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    // Update sync_log with error
    await supabase
      .from("mozi_sync_log")
      .update({
        status: "error",
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", logId);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
