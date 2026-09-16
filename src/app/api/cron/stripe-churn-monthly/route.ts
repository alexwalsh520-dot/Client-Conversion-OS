import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { postToSlack } from "@/lib/slack";
import { churnSlackText, computeChurnMonth, loadDownsellSubscriptions, previousMonthStart } from "@/lib/stripe-churn";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Runs on the 1st of each month at 02:30 UTC (10:30 Bali) via Vercel cron.
// Computes churn for the MONTH THAT JUST ENDED, stores it in
// public.stripe_churn_months, and DMs Alex and Ahmad on Slack.
//
// Manual use (same CRON_SECRET bearer):
//   ?month=2026-08        compute a specific month
//   ?notify=none          store only, no Slack
//   ?notify=alex          DM Alex only (proof runs)
const ALEX_DM = "U083ENKF9Q8";
const AHMAD_DM = "U08FK5NPG9W";
const RECIPIENTS: Record<string, string[]> = {
  all: [ALEX_DM, AHMAD_DM],
  alex: [ALEX_DM],
  none: [],
};

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const monthParam = url.searchParams.get("month");
  const monthStart = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? `${monthParam}-01` : previousMonthStart();
  const recipients = RECIPIENTS[url.searchParams.get("notify") ?? "all"] ?? RECIPIENTS.all;

  try {
    const subs = await loadDownsellSubscriptions();
    const churn = computeChurnMonth(subs, monthStart);
    const text = churnSlackText(churn);

    const sent: string[] = [];
    for (const id of recipients) {
      if (await postToSlack(id, text)) sent.push(id);
    }

    const sb = getServiceSupabase();
    const { error } = await sb.from("stripe_churn_months").upsert(
      {
        month_start: churn.monthStart,
        price_id: churn.priceId,
        start_active: churn.startActive,
        new_subs: churn.newSubs,
        canceled: churn.canceled,
        unpaid: churn.unpaid,
        churned: churn.churned,
        churn_rate_pct: churn.churnRatePct,
        end_active: churn.endActive,
        computed_at: new Date().toISOString(),
        slack_sent_to: sent,
        slack_sent_at: sent.length ? new Date().toISOString() : null,
        raw: { partial: churn.partial, subscriptions_scanned: subs.length },
      },
      { onConflict: "month_start" }
    );
    if (error) throw new Error(`stripe_churn_months upsert failed: ${error.message}`);

    return NextResponse.json({ ok: true, churn, slackSentTo: sent });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe-churn-monthly]", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
