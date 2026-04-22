import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getCurrentBalances,
  getTransactions,
  getMonthlyTrend,
  getStoredMonthlyReports,
  summarize,
  monthBounds,
} from "@/lib/accountant-data";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const mb = monthBounds(now);

  const [balances, transactions, trend, storedReports] = await Promise.all([
    getCurrentBalances(),
    getTransactions({ start: mb.start, end: mb.end, limit: 500 }),
    getMonthlyTrend(12),
    getStoredMonthlyReports(12),
  ]);

  const summary = summarize(transactions);
  const label = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  return NextResponse.json({
    balances,
    currentMonth: {
      start: mb.startDate,
      end: mb.endDate,
      label,
      transactions,
      summary,
    },
    trend,
    storedReports,
  });
}
