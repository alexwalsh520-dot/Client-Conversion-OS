// ─────────────────────────────────────────────────────────────────────────
// BUDGET SNAPSHOT SYNC — the ONE new external sync in v2. It reads the ACTUAL
// configured budget from Meta (daily budget, lifetime budget, and which level
// holds it) and writes one immutable snapshot row per entity per Eastern-time
// day. With ABO the budget sits on the ad set; with CBO on the campaign; ads
// never hold a budget. Raising a budget today only writes today's row, so past
// days stay exactly as they were, like spend.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import {
  ACTIVE_CREATORS,
  firstEnv,
  normalizeAdAccountId,
  type Creator,
} from "@/lib/creators";
import { creatorCurrency, loadUsdRateMap, convertCentsToUsd } from "@/lib/fx/rates";
import { todayEt } from "./time";
import { startRun, finishRun, type Db } from "./db";

const GRAPH = "https://graph.facebook.com/v21.0";

interface MetaBudgetEntity {
  id: string;
  name?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  effective_status?: string;
  campaign_id?: string;
}

async function graphAll(path: string, fields: string, token: string): Promise<MetaBudgetEntity[]> {
  const out: MetaBudgetEntity[] = [];
  let url: string | undefined = `${GRAPH}/${path}?fields=${fields}&limit=500&access_token=${token}`;
  for (let page = 0; page < 50 && url; page++) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Meta budget fetch ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const json = (await res.json()) as { data?: MetaBudgetEntity[]; paging?: { next?: string } };
    out.push(...(json.data || []));
    url = json.paging?.next;
  }
  return out;
}

function centsFrom(value: string | undefined): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

interface BudgetResult {
  clients: string[];
  rows: number;
  skipped: { client: string; reason: string }[];
  etDay: string;
}

export async function runBudgetSnapshot(now: Date = new Date()): Promise<BudgetResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "budget");
  const started = Date.now();
  try {
    const result = await snapshotBudgets(db, now);
    await finishRun(db, runId, {
      status: "ok",
      rows: result.rows,
      durationMs: Date.now() - started,
      detail: result,
    });
    return result;
  } catch (err) {
    await finishRun(db, runId, {
      status: "error",
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function snapshotBudgets(db: Db, now: Date): Promise<BudgetResult> {
  const etToday = todayEt(now);
  const clientsDone: string[] = [];
  const skipped: { client: string; reason: string }[] = [];
  let totalRows = 0;

  const rateMap = await loadUsdRateMap(
    db,
    ACTIVE_CREATORS.map((c) => creatorCurrency(c.key)),
    etToday,
    etToday,
  );

  for (const creator of ACTIVE_CREATORS) {
    const token = firstEnv(creator.tokenEnv);
    const account = firstEnv(creator.adAccountEnv) || creator.defaultAdAccountId;
    if (!token || !account) {
      // Honest: a creator whose ad account is not connected yet simply has no
      // budget data. We record why and move on; other creators are unaffected.
      skipped.push({ client: creator.key, reason: !token ? "no access token" : "no ad account" });
      continue;
    }
    try {
      const rows = await snapshotOneClient(db, creator, normalizeAdAccountId(account), token, etToday, rateMap);
      totalRows += rows;
      clientsDone.push(creator.key);
    } catch (err) {
      // Failure containment: one creator failing never blocks the others.
      skipped.push({ client: creator.key, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { clients: clientsDone, rows: totalRows, skipped, etDay: etToday };
}

async function snapshotOneClient(
  db: Db,
  creator: Creator,
  account: string,
  token: string,
  etDayStr: string,
  rateMap: ReturnType<typeof loadUsdRateMap> extends Promise<infer R> ? R : never,
): Promise<number> {
  const currency = creatorCurrency(creator.key);
  const campaigns = await graphAll(
    `${account}/campaigns`,
    "id,name,daily_budget,lifetime_budget,effective_status",
    token,
  );
  const adsets = await graphAll(
    `${account}/adsets`,
    "id,name,daily_budget,lifetime_budget,effective_status,campaign_id",
    token,
  );

  const rows: Record<string, unknown>[] = [];

  const push = (level: "campaign" | "adset", e: MetaBudgetEntity) => {
    const daily = centsFrom(e.daily_budget);
    const lifetime = centsFrom(e.lifetime_budget);
    rows.push({
      client_key: creator.key,
      entity_level: level,
      entity_id: e.id,
      entity_name: e.name ?? null,
      campaign_id: level === "adset" ? e.campaign_id ?? null : e.id,
      et_day: etDayStr,
      currency,
      daily_budget_cents: daily,
      lifetime_budget_cents: lifetime,
      daily_budget_usd_cents: daily == null ? null : convertCentsToUsd(daily, currency, etDayStr, rateMap),
      lifetime_budget_usd_cents:
        lifetime == null ? null : convertCentsToUsd(lifetime, currency, etDayStr, rateMap),
      holds_budget: daily != null || lifetime != null,
      effective_status: e.effective_status ?? null,
      raw: e as unknown as object,
      synced_at: new Date().toISOString(),
    });
  };

  for (const c of campaigns) push("campaign", c);
  for (const a of adsets) push("adset", a);

  if (rows.length) {
    // Upsert only today's rows; unique(entity_level, entity_id, et_day) makes a
    // re-run today idempotent and never touches any past day.
    const { error } = await db
      .from("adsv2_budget_snapshots")
      .upsert(rows, { onConflict: "entity_level,entity_id,et_day" });
    if (error) throw new Error(`budget upsert failed for ${creator.key}: ${error.message}`);
  }
  return rows.length;
}
