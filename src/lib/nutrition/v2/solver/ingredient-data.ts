/**
 * Phase B2 — ingredient nutrition data fetcher with per-process cache.
 *
 * The solver needs (calories, protein, carbs, fat, sodium) per 100g for
 * every slug it works with. Pulled live from the Supabase ingredients
 * table once per slug per process; subsequent calls hit the in-memory cache.
 *
 * The cache is intentionally process-scoped (not module-level dictionary
 * clearing) — for a long-running Next.js server, that's fine; for one-shot
 * scripts (like the smoke test) the cache lives for the run.
 */

import { createClient } from "@supabase/supabase-js";
import type { IngredientNutrition } from "./types";

// ----- Lazy Supabase client ------------------------------------------------

let _client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "ingredient-data: SUPABASE_URL and a Supabase key must be set in env. " +
        "Looked for NEXT_PUBLIC_SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY | SUPABASE_KEY | NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    );
  }
  _client = createClient(url, key);
  return _client;
}

// ----- Cache ---------------------------------------------------------------

const cache = new Map<string, IngredientNutrition>();

/**
 * Returns nutrition data for the given slugs. Hits cache where possible;
 * fetches the remainder from Supabase in a single batched query.
 *
 * Slugs not present in the ingredients table are quietly omitted — the
 * caller should validate up front. Quantities are coerced to numbers
 * (Supabase returns numeric as string-or-number depending on driver).
 */
export async function getIngredientNutrition(
  slugs: readonly string[],
): Promise<Map<string, IngredientNutrition>> {
  const out = new Map<string, IngredientNutrition>();
  const missing: string[] = [];

  for (const slug of slugs) {
    const hit = cache.get(slug);
    if (hit) {
      out.set(slug, hit);
    } else {
      missing.push(slug);
    }
  }

  if (missing.length === 0) return out;

  const client = getClient();
  const { data, error } = await client
    .from("ingredients")
    .select(
      "slug, name, category, calories_per_100g, protein_g_per_100g, carbs_g_per_100g, fat_g_per_100g, sodium_mg_per_100g",
    )
    .in("slug", missing);

  if (error) {
    throw new Error(`ingredient-data: fetch failed — ${error.message}`);
  }

  for (const row of data ?? []) {
    // Numeric fields can come back as string or number depending on driver
    const r = row as Record<string, unknown>;
    const ingredient: IngredientNutrition = {
      slug: String(r.slug),
      category: String(r.category ?? "unknown"),
      calories_per_100g: numOr0(r.calories_per_100g),
      protein_g_per_100g: numOr0(r.protein_g_per_100g),
      carbs_g_per_100g: numOr0(r.carbs_g_per_100g),
      fat_g_per_100g: numOr0(r.fat_g_per_100g),
      sodium_mg_per_100g: numOr0(r.sodium_mg_per_100g),
      name: r.name != null ? String(r.name) : undefined,
    };
    cache.set(ingredient.slug, ingredient);
    out.set(ingredient.slug, ingredient);
  }

  return out;
}

function numOr0(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ----- Test helpers -------------------------------------------------------

/**
 * Clear the in-process cache. Useful for unit tests; not for production
 * code paths.
 */
export function _clearIngredientCache(): void {
  cache.clear();
}

/**
 * Seed the cache with pre-fetched nutrition data. Smoke tests use this to
 * skip the Supabase round-trip and run hermetically with values pulled from
 * the DB at test-author time.
 */
export function _seedIngredientCache(rows: readonly IngredientNutrition[]): void {
  for (const r of rows) cache.set(r.slug, r);
}
