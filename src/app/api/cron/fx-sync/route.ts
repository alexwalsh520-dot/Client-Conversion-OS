import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS } from "@/lib/creators";
import { nonUsdCurrenciesForClients, shiftIsoDate } from "@/lib/fx/rates";
import { syncFxRates, backfillFxRates } from "@/lib/fx/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Keep fx_rates current so the ads tab can show every creator in USD. Runs daily.
// Pass ?backfillFrom=YYYY-MM-DD once to fill history for a newly-added non-USD
// creator. No non-USD creators = nothing to do (returns fast).
async function authorized(req: NextRequest) {
  const bearer = req.headers.get("authorization") || "";
  if (process.env.CRON_SECRET && bearer === `Bearer ${process.env.CRON_SECRET}`) return true;
  const s = await auth().catch(() => null);
  return !!s?.user;
}

async function run(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bases = nonUsdCurrenciesForClients(CREATORS.map((c) => c.key));
  if (bases.length === 0) return NextResponse.json({ ok: true, note: "no non-USD creators", bases: [] });

  const db = getServiceSupabase();
  const today = new Date().toISOString().slice(0, 10);
  const url = new URL(req.url);
  const backfillFrom = url.searchParams.get("backfillFrom");

  if (backfillFrom && /^\d{4}-\d{2}-\d{2}$/.test(backfillFrom)) {
    const res = await backfillFxRates(db, bases, backfillFrom, today);
    return NextResponse.json({ ok: true, mode: "backfill", from: backfillFrom, to: today, bases, ...res });
  }

  // Daily: re-pull a short trailing window (rates can revise) through today.
  const from = shiftIsoDate(today, -10);
  const results = await syncFxRates(db, bases, from, today);
  return NextResponse.json({ ok: true, mode: "daily", from, to: today, results });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
