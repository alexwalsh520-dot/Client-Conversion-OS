// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — db helpers. There is no migration runner: 113 is pasted
// into the Supabase dashboard by hand, so EVERY read/write here must
// tolerate the tables not existing yet and degrade to empty results. The
// summary API surfaces that state as migration_pending: true.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/ads-v2/db";

export type Db = ReturnType<typeof getServiceSupabase>;
export { fetchAllRows };

export interface DbError {
  code?: string;
  message?: string;
}

/**
 * True when an error means "the relation/column isn't there" — i.e. the 113
 * migration (or a source table in a fresh environment) hasn't been pasted
 * yet. PostgREST reports 42P01 / PGRST205 ("Could not find the table ... in
 * the schema cache") for missing relations and 42703 / PGRST204 for missing
 * columns.
 */
export function isMissingRelation(error: DbError | null | undefined): boolean {
  if (!error) return false;
  if (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST205" ||
    error.code === "PGRST204" ||
    error.code === "PGRST202"
  ) {
    return true;
  }
  const m = (error.message || "").toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    m.includes("schema cache")
  );
}

export interface SafeRows<T> {
  rows: T[];
  /** True when the read failed because the relation is missing. */
  missing: boolean;
}

/**
 * Page through a select, but treat a missing relation as an empty result
 * (missing: true) instead of throwing. Any other error still throws.
 */
export async function safeFetchAllRows<T>(
  build: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: DbError | null }>,
  pageSize = 1000,
): Promise<SafeRows<T>> {
  try {
    const rows = await fetchAllRows<T>(
      build as (
        from: number,
        to: number,
      ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
      pageSize,
    );
    return { rows, missing: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isMissingRelation({ message })) return { rows: [], missing: true };
    throw err;
  }
}

/** Split an array into chunks (for .in() filters and bulk inserts). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size) as T[]);
  return out;
}
