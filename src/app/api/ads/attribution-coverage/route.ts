/**
 * Attribution coverage — the "data trust" guardrail.
 *
 * GET /api/ads/attribution-coverage?days=30
 *   For each creator, what % of won cash (last N days) ties to an ad keyword,
 *   using the SAME canonical method as the app's attribution: link the sale to a
 *   keyword via manychat_subscriber_id (exact) FIRST, then normalized-name match
 *   against ads_keyword_events. The untied remainder is organic / no-keyword.
 *
 *   This is read-only and self-contained — it does NOT change any attribution
 *   math; it just measures how trustworthy each creator's ROAS currently is.
 *
 *   Response 200: { windowDays, creators: [{ key, name, cash, tiedCash, coveragePct, wins, winsTied }] }
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { creatorKeyFromText, CREATORS } from "@/lib/creators";

export const runtime = "nodejs";
export const maxDuration = 20;
const NO_STORE = { "Cache-Control": "no-store" };

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function norm(x: string | null | undefined): string {
  return String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

type Db = ReturnType<typeof getServiceSupabase>;
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

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const daysRaw = Number(req.nextUrl.searchParams.get("days") || "30");
  const windowDays = Number.isFinite(daysRaw) ? Math.min(Math.max(7, daysRaw), 90) : 30;
  const from = isoDaysAgo(windowDays);
  const db: Db = getServiceSupabase();

  // Keyword events (canonical) → which (creator, subscriber) and (creator, name) have a keyword.
  const events = await fetchAll<{
    client_key: string | null;
    subscriber_id: string | null;
    contact_name: string | null;
    keyword_normalized: string | null;
  }>((lo, hi) =>
    db
      .from("ads_keyword_events")
      .select("client_key,subscriber_id,contact_name,keyword_normalized")
      .gte("event_at", from)
      .not("keyword_normalized", "is", null)
      .range(lo, hi)
  );

  const subKw = new Set<string>();
  const nameKw = new Set<string>();
  for (const e of events) {
    if (!e.client_key || !e.keyword_normalized) continue;
    if (e.subscriber_id) subKw.add(`${e.client_key}|${e.subscriber_id}`);
    const n = norm(e.contact_name);
    if (n) nameKw.add(`${e.client_key}|${n}`);
  }

  // Won sales in the window.
  const sales = await fetchAll<{
    offer: string | null;
    collected_revenue_cents: number | null;
    manychat_subscriber_id: string | null;
    prospect_name: string | null;
  }>((lo, hi) =>
    db
      .from("sales_tracker_rows")
      .select("offer,collected_revenue_cents,manychat_subscriber_id,prospect_name")
      .gte("date", from)
      .gt("collected_revenue_cents", 0)
      .range(lo, hi)
  );

  type Agg = { cash: number; tiedCash: number; wins: number; winsTied: number };
  const byCreator = new Map<string, Agg>();
  for (const s of sales) {
    const key = creatorKeyFromText(s.offer);
    if (!key) continue;
    const cash = (s.collected_revenue_cents || 0) / 100;
    const tied =
      (s.manychat_subscriber_id && subKw.has(`${key}|${s.manychat_subscriber_id}`)) ||
      nameKw.has(`${key}|${norm(s.prospect_name)}`);
    const cur = byCreator.get(key) || { cash: 0, tiedCash: 0, wins: 0, winsTied: 0 };
    cur.cash += cash;
    cur.wins += 1;
    if (tied) {
      cur.tiedCash += cash;
      cur.winsTied += 1;
    }
    byCreator.set(key, cur);
  }

  const nameByKey = new Map(CREATORS.map((c) => [c.key, c.name]));
  const creators = [...byCreator.entries()]
    .map(([key, a]) => ({
      key,
      name: nameByKey.get(key as never) || key,
      cash: Math.round(a.cash),
      tiedCash: Math.round(a.tiedCash),
      coveragePct: a.cash > 0 ? Math.round((100 * a.tiedCash) / a.cash) : null,
      wins: a.wins,
      winsTied: a.winsTied,
    }))
    .sort((x, y) => y.cash - x.cash);

  return NextResponse.json({ windowDays, creators }, { headers: NO_STORE });
}
