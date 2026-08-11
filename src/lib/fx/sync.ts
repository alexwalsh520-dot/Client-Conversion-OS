// ─────────────────────────────────────────────────────────────────────────
// FX sync — keep the fx_rates table current and complete.
//
// Primary source: Frankfurter (European Central Bank reference rates, free, no
// key). Fallback: open.er-api.com (free, no key) for today's rate if Frankfurter
// is unreachable, so "today" always has a number. We only ever store the real
// published rates; weekends/holidays and any gap are handled at READ time by
// carry-forward (see rates.ts), so the table stays honest — no invented rows.
// ─────────────────────────────────────────────────────────────────────────
import type { getServiceSupabase } from "@/lib/supabase";
import { USD, shiftIsoDate } from "@/lib/fx/rates";

const FRANKFURTER = "https://api.frankfurter.dev/v1";
const ER_API = "https://open.er-api.com/v6/latest";

type FxRow = {
  rate_date: string;
  base: string;
  quote: string;
  rate: number;
  source: string;
  carried: boolean;
  fetched_at: string;
};

async function fetchJson(url: string, ms = 15000): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Frankfurter time series for one base → USD, as {date: rate}. */
async function fetchFrankfurter(base: string, dateFrom: string, dateTo: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const path = dateFrom === dateTo ? dateFrom : `${dateFrom}..${dateTo}`;
  const data = (await fetchJson(`${FRANKFURTER}/${path}?base=${base}&symbols=${USD}`)) as
    | { rates?: Record<string, { USD?: number } | number> }
    | null;
  const rates = data?.rates;
  if (!rates) return out;
  for (const [day, val] of Object.entries(rates)) {
    // Range form: { "2026-07-06": { USD: 0.69 } }. Single-date form: { USD: 0.69 }.
    const rate = typeof val === "number" ? val : val?.USD;
    if (typeof rate === "number" && rate > 0) out.set(day, rate);
  }
  return out;
}

/** open.er-api latest base → USD, as [date, rate] or null. */
async function fetchErApiLatest(base: string): Promise<{ date: string; rate: number } | null> {
  const data = (await fetchJson(`${ER_API}/${base}`)) as
    | { result?: string; rates?: Record<string, number>; time_last_update_utc?: string }
    | null;
  const rate = data?.rates?.USD;
  if (data?.result !== "success" || typeof rate !== "number" || rate <= 0) return null;
  const stamp = data.time_last_update_utc ? new Date(data.time_last_update_utc) : new Date();
  const date = Number.isNaN(stamp.getTime()) ? undefined : stamp.toISOString().slice(0, 10);
  return { date: date || "", rate };
}

/**
 * Fetch and store USD rates for each base over [dateFrom, dateTo]. Idempotent
 * (upsert on the primary key). Returns per-base counts + which source answered.
 */
export async function syncFxRates(
  db: ReturnType<typeof getServiceSupabase>,
  bases: readonly string[],
  dateFrom: string,
  dateTo: string
): Promise<Array<{ base: string; stored: number; source: string }>> {
  const now = new Date().toISOString();
  const results: Array<{ base: string; stored: number; source: string }> = [];

  for (const raw of bases) {
    const base = raw.toUpperCase();
    if (base === USD) continue;

    let source = "frankfurter";
    const series = await fetchFrankfurter(base, dateFrom, dateTo);

    // Fallback: if the ECB feed gave us nothing, at least stamp the latest rate
    // so today is covered. Read-time carry-forward extends it across the window.
    if (series.size === 0) {
      const latest = await fetchErApiLatest(base);
      if (latest?.date) {
        series.set(latest.date, latest.rate);
        source = "open-er-api";
      }
    }

    if (series.size === 0) {
      results.push({ base, stored: 0, source: "none" });
      continue;
    }

    const rows: FxRow[] = [...series.entries()].map(([rate_date, rate]) => ({
      rate_date,
      base,
      quote: USD,
      rate,
      source,
      carried: false,
      fetched_at: now,
    }));

    let stored = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await db.schema("warehouse").from("fx_rates").upsert(chunk, { onConflict: "rate_date,base,quote" });
      if (error) {
        console.warn(`[fx] upsert failed for ${base}`, error.message);
        break;
      }
      stored += chunk.length;
    }
    results.push({ base, stored, source });
  }

  return results;
}

/**
 * Backfill a long history in bounded chunks (Frankfurter caps range size). Used
 * on first setup and for gap repair. Walks forward from `from` to today.
 */
export async function backfillFxRates(
  db: ReturnType<typeof getServiceSupabase>,
  bases: readonly string[],
  from: string,
  to: string
): Promise<{ chunks: number; stored: number }> {
  let cursor = from;
  let chunks = 0;
  let stored = 0;
  // ~200-day windows keep each Frankfurter call small and reliable.
  while (cursor <= to) {
    const end = minIso(shiftIsoDate(cursor, 200), to);
    const res = await syncFxRates(db, bases, cursor, end);
    stored += res.reduce((s, r) => s + r.stored, 0);
    chunks += 1;
    cursor = shiftIsoDate(end, 1);
  }
  return { chunks, stored };
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}
