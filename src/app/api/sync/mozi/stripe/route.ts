import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getClients, fetchCharges } from "@/lib/mozi-stripe";

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
    .insert({ source: "stripe", status: "running" })
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
    const since = new Date();
    since.setDate(since.getDate() - 30);

    let totalSynced = 0;

    for (const { client, influencer, account } of getClients()) {
      const charges = await fetchCharges(client, since);

      for (const charge of charges) {
        const row = {
          stripe_id: charge.id,
          influencer,
          stripe_account: account,
          amount: charge.amount,
          currency: charge.currency,
          status: charge.status,
          customer_id:
            typeof charge.customer === "string"
              ? charge.customer
              : charge.customer?.id ?? null,
          customer_email: charge.receipt_email ?? null,
          refunded: charge.refunded,
          refund_amount: charge.amount_refunded,
          disputed: charge.disputed,
          created_at: new Date(charge.created * 1000).toISOString(),
          synced_at: new Date().toISOString(),
        };

        const { error: upsertError } = await supabase
          .from("mozi_stripe_charges")
          .upsert(row, { onConflict: "stripe_id" });

        if (upsertError) {
          console.error(
            `Failed to upsert charge ${charge.id}:`,
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
