import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { getAdsTrackerDashboard, type SaleFact } from "@/lib/ads-tracker/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Proves the stamp-once layer is faithful: run the engine, capture the per-sale stamps it emits,
// and check their total equals the engine's own attributed total to the dollar. With ?store=1 it
// also writes the stamps to ads_attribution_facts. Nothing on any dashboard reads these yet.
function todayEt(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function shift(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00.000Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
async function authed(req: NextRequest): Promise<boolean> {
  const b = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && b === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

export async function GET(req: NextRequest) {
  if (!(await authed(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const today = todayEt();
  const dateFrom = req.nextUrl.searchParams.get("dateFrom") || shift(today, -29);
  const dateTo = req.nextUrl.searchParams.get("dateTo") || today;
  const store = req.nextUrl.searchParams.get("store") === "1";

  const facts = new Map<string, SaleFact>();
  const payload = (await getAdsTrackerDashboard(
    { account: "all", status: "all", level: "ad", dateFrom, dateTo },
    { onSaleFact: (f) => facts.set(f.sale_key, f) },
  )) as { summary?: { paidAttributedRevenue?: number }; adRoas?: Array<{ label?: string; collectedRevenue?: number }> };

  const emittedCents = [...facts.values()].reduce((s, f) => s + (f.collected_cents || 0), 0);
  const engineAttributedCents = Math.round((payload.summary?.paidAttributedRevenue || 0) * 100);
  const diffCents = emittedCents - engineAttributedCents;

  // Per-keyword reconciliation: sum the stamps by keyword and compare to the engine's per-keyword
  // collected. Catches offsetting errors that a matching grand total could hide.
  const emitByKw = new Map<string, number>();
  for (const f of facts.values()) {
    const k = (f.keyword_normalized || "").toLowerCase();
    emitByKw.set(k, (emitByKw.get(k) || 0) + (f.collected_cents || 0));
  }
  const engineByKw = new Map<string, number>();
  for (const r of payload.adRoas || []) {
    const k = String(r.label || "").toLowerCase();
    engineByKw.set(k, (engineByKw.get(k) || 0) + Math.round((r.collectedRevenue || 0) * 100));
  }
  let worstKwDiffCents = 0;
  let mismatchedKeywords = 0;
  const worst: { keyword: string; diff: string }[] = [];
  for (const k of new Set([...emitByKw.keys(), ...engineByKw.keys()])) {
    const d = (emitByKw.get(k) || 0) - (engineByKw.get(k) || 0);
    if (d !== 0) {
      mismatchedKeywords++;
      if (Math.abs(d) > Math.abs(worstKwDiffCents)) worstKwDiffCents = d;
      if (worst.length < 6) worst.push({ keyword: k, diff: `$${(d / 100).toFixed(2)}` });
    }
  }

  let stored = 0;
  if (store && facts.size) {
    const sb = getServiceSupabase();
    const rows = [...facts.values()].map((f) => ({ ...f, computed_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb.from("ads_attribution_facts").upsert(chunk, { onConflict: "sale_key" });
      if (!error) stored += chunk.length;
    }
  }

  return NextResponse.json({
    window: { dateFrom, dateTo },
    factCount: facts.size,
    emitted: `$${Math.round(emittedCents / 100).toLocaleString()}`,
    engineAttributed: `$${Math.round(engineAttributedCents / 100).toLocaleString()}`,
    diff: `$${(diffCents / 100).toFixed(2)}`,
    reconciles: diffCents === 0,
    perKeyword: {
      mismatchedKeywords,
      worstDiff: `$${(worstKwDiffCents / 100).toFixed(2)}`,
      reconciles: mismatchedKeywords === 0,
      worst,
    },
    stored,
  });
}
