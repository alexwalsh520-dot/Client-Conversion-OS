import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getTransactions, summarize, monthBounds } from "@/lib/accountant-data";

// Runs on the 1st of each month at 09:00 UTC via Vercel cron.
// Generates a report for the MONTH THAT JUST ENDED (i.e. previous calendar month).
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  // Vercel cron passes CRON_SECRET. Also allow manual trigger via same secret.
  if (token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceSupabase();
  const now = new Date();
  // Previous month: subtract 1 month from today.
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const bounds = monthBounds(prevMonth);

  const generated: string[] = [];

  try {
    // Generate per-account AND combined reports.
    const accounts: Array<"coreshift" | "forge" | "combined"> = [
      "coreshift",
      "forge",
      "combined",
    ];

    for (const acct of accounts) {
      const txs = await getTransactions({
        account: acct,
        start: bounds.start,
        end: bounds.end,
      });
      const summary = summarize(txs);

      // Opening balance: latest snapshot on or before period_start.
      // Closing balance: latest snapshot on or before period_end.
      const openingBalance = await getBalanceAsOf(sb, acct, bounds.startDate);
      const closingBalance = await getBalanceAsOf(sb, acct, bounds.endDate);

      const byCategory: Record<string, { income: number; expenses: number; count: number }> = {};
      for (const c of summary.by_category) {
        byCategory[c.category] = {
          income: c.income,
          expenses: c.expenses,
          count: c.count,
        };
      }

      await sb.from("accountant_monthly_reports").upsert(
        {
          account: acct,
          period_start: bounds.startDate,
          period_end: bounds.endDate,
          opening_balance: openingBalance,
          closing_balance: closingBalance,
          income: summary.income,
          expenses: summary.expenses,
          net: summary.net,
          tx_count: summary.tx_count,
          by_category: byCategory,
          top_counterparties: summary.top_counterparties,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "account,period_start" }
      );

      generated.push(`${acct}:${bounds.startDate}`);
    }

    return NextResponse.json({ success: true, generated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function getBalanceAsOf(
  sb: ReturnType<typeof getServiceSupabase>,
  account: string,
  date: string
): Promise<number> {
  if (account === "combined") {
    const { data } = await sb
      .from("mozi_mercury_balances")
      .select("account, balance, snapshot_date")
      .lte("snapshot_date", date)
      .order("snapshot_date", { ascending: false })
      .limit(30);

    const latest = new Map<string, number>();
    for (const row of (data ?? []) as Array<{
      account: string;
      balance: number;
      snapshot_date: string;
    }>) {
      if (!latest.has(row.account)) latest.set(row.account, row.balance);
    }
    return Array.from(latest.values()).reduce((a, b) => a + b, 0);
  }

  const { data } = await sb
    .from("mozi_mercury_balances")
    .select("balance")
    .eq("account", account)
    .lte("snapshot_date", date)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .single();

  return (data?.balance as number) ?? 0;
}
