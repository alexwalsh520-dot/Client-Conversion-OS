import type { EngineResult } from './mozi-engine';

type DashboardData = EngineResult & {
  byInfluencer: Record<string, any>;
  revenue30: number;
  clients30: number;
  roas: number;
  capacityPct: number;
};

// Mock data matching the HTML prototype values (all money in cents)
const MOCK_DATA: DashboardData = {
  status: 'buy',
  ratio: 7.97,
  payback30: 48700,
  gp30: 110100,
  cac: 61400,
  ltgp: 489200,
  revenue30: 4247700,
  clients30: 23,
  roas: 3.01,
  capacityPct: 89,
  runwayMonths: 4.2,
  requiredRatio: 3,
  safeBudget: 1840800,
  headroom: 428600,
  currentAdSpend: 1412200,
  cashOnHand: 3460000,
  monthlyBurn: 824000,
  byInfluencer: {
    keith: {
      clients: 14, cac: 56000, payback30: 54100, ltgp: 512000,
      revenue: 2418000, adSpend: 784000, gp: 1242000, yourShare: 621000,
      status: 'buy',
    },
    tyson: {
      clients: 9, cac: 69800, payback30: 40200, ltgp: 458000,
      revenue: 1829700, adSpend: 628200, gp: 864300, yourShare: 432200,
      status: 'hold',
    },
  },
};

export async function getDashboardData(): Promise<DashboardData> {
  // If Supabase isn't configured, use mock data
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('Supabase not configured, using mock data');
    return MOCK_DATA;
  }

  try {
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase
      .from('mozi_daily_snapshots')
      .select('*')
      .order('date', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.log('No snapshot found, using mock data');
      return MOCK_DATA;
    }

    return {
      status: data.status,
      ratio: Number(data.ratio),
      payback30: data.payback30,
      gp30: data.gp30,
      cac: data.cac,
      ltgp: data.ltgp,
      revenue30: data.revenue30 ?? 0,
      clients30: data.clients30 ?? 0,
      roas: Number(data.roas ?? 0),
      capacityPct: data.capacity_pct,
      runwayMonths: Number(data.runway_months),
      requiredRatio: data.required_ratio ?? 3,
      safeBudget: data.safe_budget ?? 0,
      headroom: data.headroom ?? 0,
      currentAdSpend: data.current_ad_spend ?? 0,
      cashOnHand: data.cash_on_hand ?? 0,
      monthlyBurn: data.monthly_burn ?? 0,
      byInfluencer: data.by_influencer || {},
    } satisfies DashboardData;
  } catch {
    return MOCK_DATA;
  }
}
