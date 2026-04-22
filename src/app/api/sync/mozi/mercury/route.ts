import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  getMercuryAccounts,
  getMercuryTransactions,
  mercuryTokens,
} from "@/lib/mozi-mercury";

export async function POST(request: Request) {
  const supabase = getServiceSupabase();
  // Validate CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Create sync_log entry
  const { data: logEntry, error: logError } = await supabase
    .from("mozi_sync_log")
    .insert({ source: "mercury", status: "running" })
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
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().slice(0, 10);

    let totalSynced = 0;

    for (const [accountLabel, apiToken] of Object.entries(mercuryTokens)) {
      // 1. Get all accounts for this org
      const { accounts } = await getMercuryAccounts(apiToken);

      for (const acct of accounts) {
        // 2. Upsert current balance
        const currentBalance = (acct as Record<string, unknown>)
          .currentBalance as number | undefined;

        if (currentBalance !== undefined) {
          const balanceCents = Math.round(currentBalance * 100);

          const { error: balanceError } = await supabase
            .from("mozi_mercury_balances")
            .upsert(
              {
                account: accountLabel,
                balance: balanceCents,
                snapshot_date: today,
                synced_at: new Date().toISOString(),
              },
              { onConflict: "account,snapshot_date" }
            );

          if (balanceError) {
            console.error(
              `Failed to upsert balance for ${accountLabel}:`,
              balanceError.message
            );
          } else {
            totalSynced++;
          }
        }

        // 3. Get transactions from last 30 days
        const { transactions } = await getMercuryTransactions(
          apiToken,
          acct.id,
          { start: startDate, end: today }
        );

        for (const tx of transactions) {
          const txData = tx as Record<string, unknown>;
          const amountCents = Math.round(
            (txData.amount as number) * 100
          );

          const row = {
            mercury_id: txData.id as string,
            account: accountLabel,
            amount: amountCents,
            counterparty: (txData.counterpartyName as string) ?? null,
            description: (txData.bankDescription as string) ?? null,
            posted_at: (txData.postedAt as string) ?? null,
            synced_at: new Date().toISOString(),
          };

          const { error: upsertError } = await supabase
            .from("mozi_mercury_transactions")
            .upsert(row, { onConflict: "mercury_id" });

          if (upsertError) {
            console.error(
              `Failed to upsert transaction ${txData.id}:`,
              upsertError.message
            );
            continue;
          }

          totalSynced++;
        }
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
