import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAdsTrackerDashboard } from "@/lib/ads-tracker/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Daily guard for the fast engine: for every active account x window, run the fast engine and the
// legacy engine and confirm the per-ad funnel money and the window coverage dollars match to within
// $1. Any larger drift writes ok=false with the offending fields, so a divergence is caught the day
// it appears instead of silently mispricing decisions. Active roster only (Tyson + Antwan + all);
// Keith/Lucy are inactive. Resilient: a compute that errors/times out is recorded, never fatal.
const ACCOUNTS = ["all", "tyson", "antwan"] as const;
const WINDOWS = [7, 14, 30];
const TOL_CENTS = 100; // $1

function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shift(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00.000Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
const cents = (x: unknown) => Math.round((Number(x) || 0) * 100);

function coverage(p: Record<string, unknown>): Record<string, number> {
  const a = (p.attribution as Record<string, unknown>) || {};
  const s = (p.summary as Record<string, unknown>) || {};
  const src = ((p.sourceStatus as Record<string, unknown>)?.meta as Record<string, unknown>) || {};
  return {
    paidAttributed: cents(s.paidAttributedRevenue),
    unattributed: cents(a.unattributedRevenue),
    organic: cents(a.organicRevenue),
    potential: cents(a.potentialAttributedRevenue),
    totalCollected: cents(a.totalCollectedRevenue),
    metaSpend: cents(src.spend),
  };
}
function funnelMoneyCents(p: Record<string, unknown>): number {
  const rows = (p.adRoas as Array<Record<string, unknown>>) || [];
  return rows.reduce((sum, r) => sum + cents(r.adSpend) + cents(r.collectedRevenue) + cents(r.contractedRevenue) + cents(r.grossProfit), 0);
}

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization")?.replace("Bearer ", "") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const today = todayEt();
  const details: Array<Record<string, unknown>> = [];
  let combos = 0, mismatches = 0, errors = 0, worstDiffCents = 0;

  for (const account of ACCOUNTS) {
    for (const d of WINDOWS) {
      combos++;
      const q = { account, status: "all" as const, level: "ad" as const, dateFrom: shift(today, -(d - 1)), dateTo: today };
      try {
        const [pf, pl] = [
          await getAdsTrackerDashboard(q, { fast: true }),
          await getAdsTrackerDashboard(q, { fast: false }),
        ];
        const cf = coverage(pf), cl = coverage(pl);
        const diffs: Record<string, number> = {};
        for (const k of Object.keys(cf)) {
          const dc = Math.abs(cf[k] - cl[k]);
          if (dc > worstDiffCents) worstDiffCents = dc;
          if (dc > TOL_CENTS) diffs[k] = (cf[k] - cl[k]) / 100;
        }
        const funnelDiff = Math.abs(funnelMoneyCents(pf) - funnelMoneyCents(pl));
        if (funnelDiff > worstDiffCents) worstDiffCents = funnelDiff;
        const funnelOff = funnelDiff > TOL_CENTS ? funnelDiff / 100 : 0;
        const ok = Object.keys(diffs).length === 0 && funnelOff === 0;
        if (!ok) mismatches++;
        details.push({ account, window: `${d}d`, ok, ...(ok ? {} : { coverageDiffs: diffs, funnelDiffDollars: funnelOff }) });
      } catch (e) {
        errors++;
        details.push({ account, window: `${d}d`, error: e instanceof Error ? e.message.slice(0, 120) : "compute failed" });
      }
    }
  }

  const ok = mismatches === 0 && errors === 0;
  const sb = getServiceSupabase();
  await sb.from("attribution_reconcile_runs").insert({
    ok, combos, mismatches, errors, worst_diff: worstDiffCents / 100, details,
  });
  return NextResponse.json({ ok, combos, mismatches, errors, worstDiff: `$${(worstDiffCents / 100).toFixed(2)}`, details });
}
