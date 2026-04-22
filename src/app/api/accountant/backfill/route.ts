import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { SOURCE_ACCOUNT } from "@/lib/accountant-data";
import {
  getMercuryAccounts,
  getMercuryTransactions,
  mercuryTokens,
} from "@/lib/mozi-mercury";
import { getServiceSupabase } from "@/lib/supabase";

const DEFAULT_MONTHS = 12;
const DEFAULT_PAGE_SIZE = 500;
const MAX_MONTHS = 24;

function subtractMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const months = Math.max(
    1,
    Math.min(
      typeof body.months === "number" ? Math.floor(body.months) : DEFAULT_MONTHS,
      MAX_MONTHS,
    ),
  );
  const pageSize = Math.max(
    100,
    Math.min(
      typeof body.pageSize === "number" ? Math.floor(body.pageSize) : DEFAULT_PAGE_SIZE,
      DEFAULT_PAGE_SIZE,
    ),
  );

  const token = mercuryTokens[SOURCE_ACCOUNT];
  if (!token) {
    return NextResponse.json({ error: "Missing Mercury token for CoreShift." }, { status: 500 });
  }

  const sb = getServiceSupabase();
  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);
  const cutoffDate = subtractMonths(today, months);
  const cutoffYmd = cutoffDate.toISOString().slice(0, 10);

  try {
    const { accounts } = await getMercuryAccounts(token);
    let totalBalanceDollars = 0;
    let synced = 0;
    let pages = 0;

    for (const account of accounts) {
      const currentBalance = (account as Record<string, unknown>).currentBalance;
      if (typeof currentBalance === "number") totalBalanceDollars += currentBalance;
    }

    await sb.from("mozi_mercury_balances").upsert(
      {
        account: SOURCE_ACCOUNT,
        balance: Math.round(totalBalanceDollars * 100),
        snapshot_date: todayYmd,
        synced_at: new Date().toISOString(),
      },
      { onConflict: "account,snapshot_date" },
    );

    for (const account of accounts) {
      let offset = 0;
      let reachedCutoff = false;

      while (!reachedCutoff) {
        const { transactions } = await getMercuryTransactions(token, account.id, {
          offset,
          limit: pageSize,
        });
        pages += 1;

        if (!transactions || transactions.length === 0) break;

        for (const tx of transactions) {
          const row = tx as Record<string, unknown>;
          const postedAt = typeof row.postedAt === "string" ? row.postedAt : null;
          const postedYmd = postedAt?.slice(0, 10) ?? null;

          if (postedYmd && postedYmd < cutoffYmd) {
            reachedCutoff = true;
            continue;
          }

          await sb.from("mozi_mercury_transactions").upsert(
            {
              mercury_id: row.id as string,
              account: SOURCE_ACCOUNT,
              amount: Math.round(((row.amount as number) ?? 0) * 100),
              counterparty: (row.counterpartyName as string) ?? null,
              description: (row.bankDescription as string) ?? null,
              posted_at: postedAt,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "mercury_id" },
          );
          synced += 1;
        }

        if (transactions.length < pageSize) break;
        if (reachedCutoff) break;
        offset += pageSize;
      }
    }

    return NextResponse.json({
      success: true,
      synced,
      pages,
      cutoff: cutoffYmd,
      months,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backfill failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
