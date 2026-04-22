import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';
import { computeKPIs } from '@/lib/mozi-engine';

export async function POST(req: NextRequest) {
  const supabase = getServiceSupabase();
  // ── Auth ────────────────────────────────────────────────────────
  const secret = req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // ── Fetch all data in parallel ────────────────────────────────
    const [
      { data: stripeCharges },
      { data: whopPayments },
      { data: adSpend },
      { data: balances },
      { data: transactions },
      { data: settingsRows },
      { data: coaches },
    ] = await Promise.all([
      supabase
        .from('mozi_stripe_charges')
        .select('amount, created_at, customer_id, customer_email, refunded, refund_amount, influencer')
        .gte('created_at', thirtyDaysAgo),
      supabase
        .from('mozi_whop_payments')
        .select('amount, created_at, customer_email, influencer')
        .gte('created_at', thirtyDaysAgo),
      supabase
        .from('mozi_meta_ad_spend')
        .select('date, spend, influencer')
        .gte('date', thirtyDaysAgo),
      supabase
        .from('mozi_mercury_balances')
        .select('account, balance')
        .order('snapshot_date', { ascending: false })
        .limit(10), // latest per account
      supabase
        .from('mozi_mercury_transactions')
        .select('amount, posted_at')
        .gte('posted_at', thirtyDaysAgo),
      supabase.from('mozi_settings').select('key, value'),
      supabase.from('mozi_settings').select('value').eq('key', 'coaches').single(),
    ]);

    // ── Build settings map ────────────────────────────────────────
    const settingsMap: Record<string, unknown> = {};
    for (const row of settingsRows ?? []) {
      settingsMap[row.key] = row.value;
    }

    const settings = {
      business_type: (settingsMap.business_type as string) ?? 'coaching',
      costs: (settingsMap.costs as Record<string, number>) ?? {},
      targets: (settingsMap.targets as Record<string, number>) ?? {},
      coaches: (coaches?.value as Array<{
        name: string;
        current_clients: number;
        max_clients: number;
      }>) ?? [],
    };

    // ── Merge revenue sources ─────────────────────────────────────
    const revenueData = [
      ...(stripeCharges ?? []).map((c) => ({
        amount: c.amount,
        created_at: c.created_at,
        customer_id: c.customer_id,
        customer_email: c.customer_email,
        refunded: c.refunded,
        refund_amount: c.refund_amount,
      })),
      ...(whopPayments ?? []).map((w) => ({
        amount: w.amount,
        created_at: w.created_at,
        customer_email: w.customer_email,
      })),
    ];

    // ── Dedupe mercury balances (latest per account) ──────────────
    const latestBalances = new Map<string, number>();
    for (const b of balances ?? []) {
      if (!latestBalances.has(b.account)) {
        latestBalances.set(b.account, b.balance);
      }
    }
    const mercuryBalances = Array.from(latestBalances.entries()).map(
      ([account, balance]) => ({ account, balance }),
    );

    // ── Compute overall KPIs ──────────────────────────────────────
    const result = computeKPIs(
      settings,
      revenueData,
      adSpend ?? [],
      mercuryBalances,
      transactions ?? [],
      settings.coaches,
    );

    // ── Compute per-influencer KPIs ───────────────────────────────
    const influencers = ['keith', 'tyson', 'zoeEmily'];
    const byInfluencer: Record<string, ReturnType<typeof computeKPIs>> = {};

    for (const inf of influencers) {
      const infRevenue = [
        ...(stripeCharges ?? [])
          .filter((c) => c.influencer === inf)
          .map((c) => ({
            amount: c.amount,
            created_at: c.created_at,
            customer_id: c.customer_id,
            customer_email: c.customer_email,
            refunded: c.refunded,
            refund_amount: c.refund_amount,
          })),
        ...(whopPayments ?? [])
          .filter((w) => w.influencer === inf)
          .map((w) => ({
            amount: w.amount,
            created_at: w.created_at,
            customer_email: w.customer_email,
          })),
      ];

      const infAdSpend = (adSpend ?? []).filter((a) => a.influencer === inf);

      // Per-influencer uses the same balances/transactions/coaches (shared)
      byInfluencer[inf] = computeKPIs(
        settings,
        infRevenue,
        infAdSpend,
        mercuryBalances,
        transactions ?? [],
        settings.coaches,
      );
    }

    // ── Upsert into daily_snapshots ───────────────────────────────
    const { error: upsertError } = await supabase
      .from('mozi_daily_snapshots')
      .upsert(
        {
          date: today,
          gp30: result.gp30,
          cac: result.cac,
          ltgp: result.ltgp,
          ratio: result.ratio,
          payback30: result.payback30,
          capacity_pct: result.capacityPct,
          runway_months: result.runwayMonths,
          cash_on_hand: result.cashOnHand,
          monthly_burn: result.monthlyBurn,
          safe_budget: result.safeBudget,
          headroom: result.headroom,
          current_ad_spend: result.currentAdSpend,
          required_ratio: result.requiredRatio,
          status: result.status,
          by_influencer: byInfluencer,
        },
        { onConflict: 'date' },
      );

    if (upsertError) {
      console.error('Snapshot upsert error:', upsertError);
      return NextResponse.json(
        { error: 'upsert failed', details: upsertError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      date: today,
      status: result.status,
      ratio: result.ratio,
      gp30: result.gp30,
      cac: result.cac,
      ltgp: result.ltgp,
      capacityPct: result.capacityPct,
      runwayMonths: result.runwayMonths,
    });
  } catch (err) {
    console.error('Snapshot error:', err);
    return NextResponse.json(
      { error: 'internal error', details: String(err) },
      { status: 500 },
    );
  }
}
