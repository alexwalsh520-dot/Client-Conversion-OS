/**
 * Slug-list builder for the LLM prompt.
 *
 * Pulls the full ingredients table from Supabase, filters out
 * hard-excluded slugs (per the client's allergy + medical + dietary
 * profile), and formats a compact tab-delimited table the LLM can
 * scan to pick from. Cached per-process so repeated calls don't
 * re-query Supabase.
 */

import { getIngredientNutrition } from "../solver/ingredient-data";
import { getGramBounds } from "../solver/category-bounds";
import { createClient } from "@supabase/supabase-js";

let _allSlugsCache: string[] | null = null;

async function fetchAllSlugs(): Promise<string[]> {
  if (_allSlugsCache) return _allSlugsCache;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "slug-list: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set",
    );
  }
  const client = createClient(url, key);
  const { data, error } = await client.from("ingredients").select("slug");
  if (error) throw new Error(`slug-list: fetch failed — ${error.message}`);
  _allSlugsCache = (data ?? []).map((r) => String((r as { slug: string }).slug));
  return _allSlugsCache;
}

/**
 * Build a compact tab-separated slug table for prompt injection.
 * Format per line:
 *   slug\tname\tcategory\tP\tC\tF\tNa\tgmin-gmax
 *
 * Roughly 50 chars/entry × ~250 entries = ~12,500 chars (~3,000 tokens).
 * Compact enough to fit in the input budget while giving the LLM all
 * the data it needs to size portions correctly.
 *
 * Filters out slugs in `hardExclude` so the LLM never sees them.
 */
export async function buildSlugList(args: {
  hardExclude: ReadonlySet<string>;
}): Promise<string> {
  const allSlugs = await fetchAllSlugs();
  const visibleSlugs = allSlugs.filter((s) => !args.hardExclude.has(s));
  const nutritionMap = await getIngredientNutrition(visibleSlugs);

  const lines: string[] = [];
  lines.push(
    "# Approved ingredients. Use ONLY slugs in this list. Format: slug\\tname\\tcategory\\tP/100g\\tC/100g\\tF/100g\\tNa(mg)/100g\\tmin-max(g)",
  );
  // Sort by category then name for scannability
  const entries = visibleSlugs
    .map((slug) => nutritionMap.get(slug)!)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.category !== b.category) return a.category.localeCompare(b.category);
      return (a.name ?? a.slug).localeCompare(b.name ?? b.slug);
    });
  for (const ing of entries) {
    const gb = getGramBounds(ing.slug, ing.category);
    const name = (ing.name ?? ing.slug).replace(/\t/g, " ");
    lines.push(
      [
        ing.slug,
        name,
        ing.category,
        ing.protein_g_per_100g.toFixed(1),
        ing.carbs_g_per_100g.toFixed(1),
        ing.fat_g_per_100g.toFixed(1),
        Math.round(ing.sodium_mg_per_100g).toString(),
        `${gb.min}-${gb.max}`,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

/** Test helper. */
export function _clearSlugListCache(): void {
  _allSlugsCache = null;
}
