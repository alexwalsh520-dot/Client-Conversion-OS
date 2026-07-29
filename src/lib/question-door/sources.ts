// ─────────────────────────────────────────────────────────────────────────
// THE TWO THINGS EVERY ANSWER CARRIES: the quoted meanings and the freshness.
//
// Law 5 of this build: an answer ships with the numbers, the stored meaning of
// every metric it names, and a real as-of time, or it does not ship. Both come
// from stored rows through a public function, because the app can only reach
// the warehouse schema that way.
// ─────────────────────────────────────────────────────────────────────────

import type { AsOf, Db, QuotedDefinition } from "./types";

interface DefinitionRow {
  key: string;
  label: string;
  meaning: string;
  source: string;
  format: string;
  is_calculated: boolean;
  sort_order: number;
  refreshed_at: string;
}

/**
 * Quote the stored meaning of the metrics an answer names. Pass null for all.
 * The text is returned exactly as stored: never shortened, never reworded.
 */
export async function quoteDefinitions(
  db: Db,
  keys: readonly string[] | null,
): Promise<QuotedDefinition[]> {
  const { data, error } = await db.rpc("question_door_definitions", {
    p_keys: keys && keys.length ? [...new Set(keys)] : null,
  });
  if (error) throw new Error(`could not quote the definitions: ${error.message}`);
  return ((data || []) as DefinitionRow[]).map((d) => ({
    key: d.key,
    label: d.label,
    meaning: d.meaning,
    source: d.source,
    format: d.format,
    is_calculated: d.is_calculated,
  }));
}

interface FreshnessRow {
  source: string;
  last_written_at: string | null;
  note: string;
}

/** Every stored source's real newest write time, keyed by source name. */
export async function readFreshness(db: Db): Promise<Map<string, AsOf>> {
  const { data, error } = await db.rpc("question_door_freshness");
  if (error) throw new Error(`could not read the freshness: ${error.message}`);
  const map = new Map<string, AsOf>();
  for (const r of (data || []) as FreshnessRow[]) {
    map.set(r.source, { source: r.source, last_written_at: r.last_written_at, note: r.note });
  }
  return map;
}

/**
 * Pick the as-of entries a template needs. A source the template names but the
 * database does not report is returned with a null time and a written note,
 * never silently dropped, so a missing timestamp can never look like a fresh one.
 */
export function asOfFor(map: Map<string, AsOf>, sources: readonly string[]): AsOf[] {
  return sources.map(
    (s) =>
      map.get(s) ?? {
        source: s,
        last_written_at: null,
        note: "this source reported no write time, so its freshness is unknown",
      },
  );
}
