// ─────────────────────────────────────────────────────────────────────────
// WAREHOUSE REFRESH — keeps the merged tables current.
//
// Three things, all idempotent, none of which any reader depends on yet
// (switching readers over is Build 5):
//
//   warehouse.people      one row per human, every id they have
//   warehouse.ads         one row per ad that ever existed
//   warehouse.definitions the queryable copy of the metric registry
//
// The first two are rebuilt by set-based SQL in the database, so nothing is
// dragged over the wire. The third is pushed FROM the code registry, because
// the code stays the editing home: this table is a copy, never a rival answer.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { COLUMNS } from "./definitions";
import { startRun, finishRun } from "./db";

export interface WarehouseRefreshResult {
  people: number;
  ads: number;
  definitions: number;
}

/** The metric registry, in the shape warehouse.definitions stores. */
function definitionRows() {
  return COLUMNS.map((c, i) => ({
    key: c.key,
    label: c.label,
    meaning: c.sentence,
    source: c.source,
    format: c.format,
    is_calculated: !!c.calc,
    sort_order: i,
  }));
}

export async function runWarehouseRefresh(): Promise<WarehouseRefreshResult> {
  const db = getServiceSupabase();
  const runId = await startRun(db, "warehouse");
  const started = Date.now();

  try {
    const { data: people, error: peopleErr } = await db.rpc("warehouse_refresh_people");
    if (peopleErr) throw new Error(`warehouse.people refresh failed: ${peopleErr.message}`);

    const { data: ads, error: adsErr } = await db.rpc("warehouse_refresh_ads");
    if (adsErr) throw new Error(`warehouse.ads refresh failed: ${adsErr.message}`);

    const rows = definitionRows();
    const { data: defs, error: defsErr } = await db.rpc("warehouse_upsert_definitions", {
      p_rows: rows as unknown as object,
    });
    if (defsErr) throw new Error(`warehouse.definitions refresh failed: ${defsErr.message}`);

    const result: WarehouseRefreshResult = {
      people: Number(people ?? 0),
      ads: Number(ads ?? 0),
      definitions: Number(defs ?? 0),
    };
    await finishRun(db, runId, {
      status: "ok",
      rows: result.people + result.ads + result.definitions,
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

/** How many metrics the code registry defines, for the gate that compares. */
export function registryMetricCount(): number {
  return COLUMNS.length;
}
