import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BUDGET_USD = 50;

// Start of the current calendar month in UTC. The meter is a month-to-date view
// against a $50 budget, so we sum everything logged on/after this instant.
function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

type UsageRow = { feature: string | null; cost_usd: number | string | null };

// GET /api/ai-usage — month-to-date Anthropic spend against the $50 budget.
// Returns ACCURATE totals straight from the ai_usage table. If the table does
// not exist yet (migration not applied) or anything else fails, we degrade
// gracefully to a $0.00 / $50 state rather than a fabricated or error value.
export async function GET() {
  const since = startOfMonthUtc().toISOString();

  const empty = {
    monthSpendUsd: 0,
    budgetUsd: BUDGET_USD,
    pct: 0,
    byFeature: [] as { feature: string; usd: number; calls: number }[],
    since,
  };

  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from("ai_usage")
      .select("feature, cost_usd")
      .gte("created_at", since);

    if (error) {
      // e.g. table not created yet — trustworthy zero, not a guess.
      console.error("[ai-usage] read failed (returning $0):", error.message);
      return NextResponse.json(empty);
    }

    const rows = (data ?? []) as UsageRow[];

    let monthSpendUsd = 0;
    const byFeatureMap = new Map<string, { usd: number; calls: number }>();

    for (const row of rows) {
      const cost = Number(row.cost_usd) || 0;
      monthSpendUsd += cost;
      const feature = row.feature || "unknown";
      const existing = byFeatureMap.get(feature) || { usd: 0, calls: 0 };
      existing.usd += cost;
      existing.calls += 1;
      byFeatureMap.set(feature, existing);
    }

    // Round to cents for display; keep the underlying sum precise above.
    monthSpendUsd = Math.round(monthSpendUsd * 100) / 100;

    const byFeature = Array.from(byFeatureMap.entries())
      .map(([feature, v]) => ({
        feature,
        usd: Math.round(v.usd * 100) / 100,
        calls: v.calls,
      }))
      .sort((a, b) => b.usd - a.usd);

    const pct = BUDGET_USD > 0 ? Math.min(100, (monthSpendUsd / BUDGET_USD) * 100) : 0;

    return NextResponse.json({
      monthSpendUsd,
      budgetUsd: BUDGET_USD,
      pct: Math.round(pct * 10) / 10,
      byFeature,
      since,
    });
  } catch (err) {
    console.error("[ai-usage] route failed (returning $0):", err);
    return NextResponse.json(empty);
  }
}
