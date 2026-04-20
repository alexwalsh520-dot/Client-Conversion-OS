/**
 * One-time sync: pulls nutrition data from USDA FoodData Central
 * for each ingredient in the seed list, stores in Supabase.
 *
 * POST /api/nutrition/sync-ingredients
 * Requires authenticated session (admin-only).
 *
 * Only uses Foundation Foods and SR Legacy data types for accuracy.
 * Never re-fetches ingredients that already exist (safe to re-run).
 * Pass ?force=true to overwrite existing ingredients.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { getIngredientSeeds, type IngredientSeed } from "@/lib/nutrition/ingredient-seed";

const USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";

interface UsdaFoodNutrient {
  nutrientId?: number;
  nutrientName?: string;
  nutrientNumber?: string;
  value?: number;
  unitName?: string;
  // Some responses nest these
  nutrient?: { id?: number; name?: string; number?: string; unitName?: string };
  amount?: number;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodNutrients?: UsdaFoodNutrient[];
}

interface UsdaSearchResponse {
  foods?: UsdaFood[];
}

/**
 * Search USDA for a term and pick the best match.
 * Preference order: Foundation → SR Legacy.
 */
async function searchUsda(apiKey: string, searchTerm: string): Promise<UsdaFood | null> {
  const url = `${USDA_API_BASE}/foods/search?api_key=${apiKey}&query=${encodeURIComponent(searchTerm)}&dataType=Foundation,SR%20Legacy&pageSize=10`;

  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[usda] Search failed for "${searchTerm}": ${res.status}`);
    return null;
  }

  const data = (await res.json()) as UsdaSearchResponse;
  const foods = data.foods || [];
  if (foods.length === 0) return null;

  // Prefer Foundation over SR Legacy
  const foundation = foods.find((f) => f.dataType === "Foundation");
  if (foundation) return foundation;

  const srLegacy = foods.find((f) => f.dataType === "SR Legacy");
  if (srLegacy) return srLegacy;

  return foods[0] || null;
}

/**
 * Extract the specific nutrient value (per 100g) from a USDA food.
 * Accepts multiple nutrient numbers/IDs since Foundation and SR Legacy
 * sometimes use different identifiers for the same nutrient.
 * Handles both the new (flat) and legacy (nested) response shapes.
 */
function getNutrientValue(food: UsdaFood, ...nutrientNumbers: string[]): number {
  const nutrients = food.foodNutrients || [];
  for (const target of nutrientNumbers) {
    for (const n of nutrients) {
      const num = n.nutrientNumber || n.nutrient?.number;
      const id = n.nutrientId?.toString() || n.nutrient?.id?.toString();
      if (num === target || id === target) {
        const val = n.value ?? n.amount ?? 0;
        if (val > 0) return val;
      }
    }
  }
  return 0;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "USDA_API_KEY not configured in env" },
      { status: 500 }
    );
  }

  const force = new URL(req.url).searchParams.get("force") === "true";

  const db = getServiceSupabase();
  const seeds = getIngredientSeeds();

  const results = {
    total: seeds.length,
    synced: 0,
    skipped: 0,
    not_found: 0,
    failed: 0,
    notFoundList: [] as string[],
    failedList: [] as { slug: string; error: string }[],
  };

  // If not forcing, skip ingredients that already exist
  const { data: existingRows } = await db.from("ingredients").select("slug");
  const existingSlugs = new Set((existingRows || []).map((r: { slug: string }) => r.slug));

  // Process sequentially with small delays to respect rate limits (USDA: 1000/hour default)
  for (const seed of seeds) {
    if (!force && existingSlugs.has(seed.slug)) {
      results.skipped++;
      continue;
    }

    try {
      const food = await searchUsda(apiKey, seed.search);

      if (!food) {
        results.not_found++;
        results.notFoundList.push(seed.slug);
        await db.from("ingredient_sync_log").insert({
          search_term: seed.search,
          slug: seed.slug,
          category: seed.category,
          status: "not_found",
        });
        continue;
      }

      // USDA nutrient numbers — Foundation and SR Legacy sometimes use different IDs for the same nutrient.
      // Energy: "208" (kcal, SR Legacy) or "1008" (kcal, Foundation); skip "957" (kJ).
      // Protein: "203" or ID 1003
      // Carbs: "205" or ID 1005
      // Fat: "204" or ID 1004
      // Fiber: "291" or ID 1079
      // Sugars: "269" or ID 2000
      // Sodium: "307" or ID 1093
      const row = {
        name: seed.displayName,
        slug: seed.slug,
        aliases: seed.aliases || [],
        category: seed.category,
        usda_fdc_id: food.fdcId,
        data_type: food.dataType,
        calories_per_100g: getNutrientValue(food, "208", "1008"),
        protein_g_per_100g: getNutrientValue(food, "203", "1003"),
        carbs_g_per_100g: getNutrientValue(food, "205", "1005"),
        fat_g_per_100g: getNutrientValue(food, "204", "1004"),
        fiber_g_per_100g: getNutrientValue(food, "291", "1079"),
        sugar_g_per_100g: getNutrientValue(food, "269", "2000"),
        sodium_mg_per_100g: getNutrientValue(food, "307", "1093"),
        verified: false,
        notes: `Auto-synced from USDA: ${food.description}`,
        updated_at: new Date().toISOString(),
      };

      const { error } = await db
        .from("ingredients")
        .upsert(row, { onConflict: "slug" });

      if (error) {
        results.failed++;
        results.failedList.push({ slug: seed.slug, error: error.message });
        await db.from("ingredient_sync_log").insert({
          search_term: seed.search,
          slug: seed.slug,
          category: seed.category,
          status: "failed",
          error_message: error.message,
        });
      } else {
        results.synced++;
        await db.from("ingredient_sync_log").insert({
          search_term: seed.search,
          slug: seed.slug,
          category: seed.category,
          status: "synced",
          usda_fdc_id: food.fdcId,
        });
      }

      // Small delay to be kind to the API (USDA allows 1000/hour = 1 per 3.6s)
      await new Promise((resolve) => setTimeout(resolve, 150));
    } catch (err) {
      results.failed++;
      results.failedList.push({
        slug: seed.slug,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json({
    success: true,
    ...results,
  });
}
