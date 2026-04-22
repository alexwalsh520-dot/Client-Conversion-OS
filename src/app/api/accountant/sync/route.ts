import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  getMercuryAccounts,
  getMercuryTransactions,
  mercuryTokens,
} from "@/lib/mozi-mercury";
import { SOURCE_ACCOUNT } from "@/lib/accountant-data";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const startDate = ninetyDaysAgo.toISOString().slice(0, 10);

  let synced = 0;

  try {
    // CoreShift LLC only — Forge is intentionally excluded from the Accountant tab.
    const apiToken = mercuryTokens[SOURCE_ACCOUNT];
    if (apiToken) {
      const accountLabel = SOURCE_ACCOUNT;
      const { accounts } = await getMercuryAccounts(apiToken);

      // Mercury returns one entry per sub-account (checking, savings, treasury, etc).
      // Sum balances across ALL sub-accounts so the saved row is the org total,
      // not just the last sub-account's balance.
      let totalBalanceDollars = 0;
      for (const acct of accounts) {
        const cb = (acct as Record<string, unknown>).currentBalance as
          | number
          | undefined;
        if (typeof cb === "number") totalBalanceDollars += cb;
      }

      await sb.from("mozi_mercury_balances").upsert(
        {
          account: accountLabel,
          balance: Math.round(totalBalanceDollars * 100),
          snapshot_date: today,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "account,snapshot_date" }
      );

      // Pull transactions per sub-account (each has its own transaction list).
      for (const acct of accounts) {
        const { transactions } = await getMercuryTransactions(apiToken, acct.id, {
          start: startDate,
          end: today,
        });

        for (const tx of transactions) {
          const txData = tx as Record<string, unknown>;
          const amountCents = Math.round((txData.amount as number) * 100);

          await sb.from("mozi_mercury_transactions").upsert(
            {
              mercury_id: txData.id as string,
              account: accountLabel,
              amount: amountCents,
              counterparty: (txData.counterpartyName as string) ?? null,
              description: (txData.bankDescription as string) ?? null,
              posted_at: (txData.postedAt as string) ?? null,
              synced_at: new Date().toISOString(),
            },
            { onConflict: "mercury_id" }
          );
          synced++;
        }
      }
    }

    return NextResponse.json({ success: true, synced });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
