// ─────────────────────────────────────────────────────────────────────────────
// SCALE-AWARE MONEY MODEL — the "spend more = more profit" engine.
//
// Confirmed with Alex 2026-06-03. The whole point: prove, visually and daily,
// that spending more makes MORE net profit — because variable margin is fixed
// (~75%) and fixed costs are flat, so every profitable dollar of ad spend drops
// straight to the bottom line AND dilutes the fixed-cost drag.
//
// All money math reuses src/lib/economics.ts (single source of truth) so this
// can never quietly disagree with the rest of the app. Trailing 30 days.
// ─────────────────────────────────────────────────────────────────────────────
import { getServiceSupabase } from "@/lib/supabase";
import { saleGrossProfit, MANAGER_MONTHLY_BASE } from "@/lib/economics";
import { creatorKeyFromText, CREATORS, type CreatorKey } from "@/lib/creators";
import { dedupeSalesRows } from "@/lib/ads-tracker/dedupe-sales";

// Fixed monthly overhead tied to CAC (does NOT scale with sales volume):
//   - sales manager base (WILL) ............ $4,000  (from economics.ts)
//   - CAC software stack (Skool, GoHighLevel, Sendblue, ManyChat, analysis) $5,500
// The $2k coaching manager is already inside the per-sale coaching cost.
export const SOFTWARE_MONTHLY_COST = 5500;
export const FIXED_MONTHLY_COSTS = MANAGER_MONTHLY_BASE + SOFTWARE_MONTHLY_COST; // $9,500

const WINDOW_DAYS = 30;

type Db = ReturnType<typeof getServiceSupabase>;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Supabase caps a select at 1000 rows; page through so totals are exact.
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let i = 0; i < 100; i++) {
    const { data, error } = await build(i * page, i * page + page - 1);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < page) break;
  }
  return out;
}

export interface MoneyModelClient {
  key: string;
  name: string;
  collected: number;
  contribution: number;
  adSpend: number;
  fixedShare: number;
  netProfit: number;
  cashRoas: number | null;
  grossGpCac: number | null;
  carryingWeight: boolean;
}

export interface MoneyModelProjectionPoint {
  label: string;
  adSpend: number;
  revenue: number;
  netProfit: number;
  netMargin: number;
  isCurrent: boolean;
}

export interface MoneyModel {
  windowDays: number;
  collected: number;
  variableCosts: number;
  contribution: number;
  variableMargin: number; // contribution / collected
  adSpend: number;
  fixedCosts: number;
  netProfit: number;
  netMargin: number; // netProfit / collected
  cashRoas: number | null;
  grossGpCac: number | null;
  // Decision lines:
  starRoas: number; // ⭐ 3:1 gross GP:CAC target (constant, scale-blind) = 3 / margin
  breakevenRoas: number; // 🛑 true break-even after fixed (scale-aware) at current spend
  // The persuasion numbers:
  netProfitPerExtraDollar: number; // each extra $1 ad spend → $X net, at today's efficiency
  roasFloorIfYouDouble: number; // you can 2x spend, let ROAS fall to THIS, and still out-earn now
  projection: MoneyModelProjectionPoint[];
  clients: MoneyModelClient[];
  unattributedCollected: number; // sales whose creator couldn't be matched
}

// Computes the trailing-30-day scale-aware money model from live data.
export async function computeMoneyModel(db?: Db): Promise<MoneyModel | null> {
  const sb = db ?? getServiceSupabase();
  const from = isoDaysAgo(WINDOW_DAYS);

  const salesRaw = await fetchAll<{
    collected_revenue_cents: number | null;
    contracted_revenue_cents: number | null;
    closer: string | null;
    setter: string | null;
    program_length: string | null;
    offer: string | null;
    date: string | null;
    prospect_name_normalized: string | null;
    call_number: string | null;
    synced_at: string | null;
  }>((lo, hi) =>
    sb
      .from("sales_tracker_rows")
      .select(
        "collected_revenue_cents,contracted_revenue_cents,closer,setter,program_length,offer,date,prospect_name_normalized,call_number,synced_at"
      )
      .gte("date", from)
      .gt("collected_revenue_cents", 0)
      .range(lo, hi)
  );
  // Collapse sync-created duplicate rows before summing. The money model reads
  // the cache DIRECTLY (unlike the main tab, which reads the live sheet), so
  // without this every duplicated sale would inflate revenue/ROAS/net profit —
  // ~2× for the current, actively-tagged month. See dedupe-sales.
  const sales = dedupeSalesRows(salesRaw);

  const spendRows = await fetchAll<{ client_key: string | null; spend_cents: number | null }>(
    (lo, hi) =>
      sb
        .from("ads_meta_insights_daily")
        .select("client_key,spend_cents")
        .gte("date", from)
        .gt("spend_cents", 0)
        .range(lo, hi)
  );

  // ---- business totals ----
  let collected = 0;
  let contribution = 0;
  let unattributedCollected = 0;
  const byClient = new Map<string, { collected: number; contribution: number }>();
  const nameByKey = new Map<string, string>(CREATORS.map((c) => [c.key, c.name]));

  for (const s of sales) {
    const cash = (s.collected_revenue_cents || 0) / 100;
    if (cash <= 0) continue;
    const gp = saleGrossProfit({
      cashCollected: cash,
      closer: s.closer,
      setter: s.setter,
      programLength: s.program_length,
    });
    collected += cash;
    contribution += gp;
    const key: CreatorKey | null = creatorKeyFromText(s.offer);
    if (!key) {
      unattributedCollected += cash;
      continue;
    }
    const cur = byClient.get(key) || { collected: 0, contribution: 0 };
    cur.collected += cash;
    cur.contribution += gp;
    byClient.set(key, cur);
  }

  let adSpend = 0;
  const spendByClient = new Map<string, number>();
  for (const r of spendRows) {
    const spend = (r.spend_cents || 0) / 100;
    adSpend += spend;
    const key = String(r.client_key || "").trim();
    if (key) spendByClient.set(key, (spendByClient.get(key) || 0) + spend);
  }

  if (collected <= 0 || adSpend <= 0) return null;

  const variableCosts = collected - contribution;
  const variableMargin = contribution / collected;
  const fixedCosts = FIXED_MONTHLY_COSTS;
  const netProfit = contribution - adSpend - fixedCosts;
  const netMargin = netProfit / collected;
  const cashRoas = collected / adSpend;
  const grossGpCac = contribution / adSpend;

  const starRoas = 3 / variableMargin; // 3:1 gross GP:CAC
  const breakevenRoas = (adSpend + fixedCosts) / (adSpend * variableMargin);
  // Net profit added by each extra $1 of ad spend, holding efficiency:
  const netProfitPerExtraDollar = cashRoas * variableMargin - 1;
  // Double the spend; how far can ROAS fall and still beat today's net?
  const roasFloorIfYouDouble = (cashRoas * variableMargin + 1) / (2 * variableMargin);

  const multiples: Array<{ label: string; m: number }> = [
    { label: "½×", m: 0.5 },
    { label: "now", m: 1 },
    { label: "2×", m: 2 },
    { label: "3×", m: 3 },
    { label: "5×", m: 5 },
  ];
  const projection: MoneyModelProjectionPoint[] = multiples.map(({ label, m }) => {
    const sp = adSpend * m;
    const rev = sp * cashRoas;
    const net = sp * (cashRoas * variableMargin - 1) - fixedCosts;
    return {
      label,
      adSpend: sp,
      revenue: rev,
      netProfit: net,
      netMargin: rev > 0 ? net / rev : 0,
      isCurrent: m === 1,
    };
  });

  // ---- per-client (fixed split by share of ad spend) ----
  const clientKeys = new Set<string>([...byClient.keys(), ...spendByClient.keys()]);
  const clients: MoneyModelClient[] = [...clientKeys]
    .map((key) => {
      const rev = byClient.get(key)?.collected || 0;
      const contrib = byClient.get(key)?.contribution || 0;
      const sp = spendByClient.get(key) || 0;
      const fixedShare = adSpend > 0 ? fixedCosts * (sp / adSpend) : 0;
      const net = contrib - sp - fixedShare;
      return {
        key,
        name: nameByKey.get(key) || key,
        collected: rev,
        contribution: contrib,
        adSpend: sp,
        fixedShare,
        netProfit: net,
        cashRoas: sp > 0 ? rev / sp : null,
        grossGpCac: sp > 0 ? contrib / sp : null,
        carryingWeight: net > 0,
      };
    })
    .sort((a, b) => b.netProfit - a.netProfit);

  return {
    windowDays: WINDOW_DAYS,
    collected,
    variableCosts,
    contribution,
    variableMargin,
    adSpend,
    fixedCosts,
    netProfit,
    netMargin,
    cashRoas,
    grossGpCac,
    starRoas,
    breakevenRoas,
    netProfitPerExtraDollar,
    roasFloorIfYouDouble,
    projection,
    clients,
    unattributedCollected,
  };
}
