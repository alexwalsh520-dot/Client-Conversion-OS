/**
 * One-time backfill: pulls the FULL nutrient panel from USDA FoodData Central
 * for every ingredient with a usda_fdc_id, writes the 10 new nutrient columns
 * and overwrites the 3 existing ones (sodium, fiber, sugar).
 *
 * POST /api/nutrition/sync-extended-nutrients
 *   Requires admin auth (skipped outside production).
 *   Optional ?limit=N to process only N ingredients (useful for dry runs).
 *
 * One USDA API call per ingredient (/v1/food/{fdcId}). ~50ms delay between
 * calls to stay well under the 1,000/hour free-tier cap. 279 rows × ~0.5s
 * ≈ 2-3 minutes total.
 *
 * Returns a JSON summary with per-nutrient population counts and a list of
 * ingredients that couldn't be enriched (USDA fetch failed, or nutrient
 * wasn't present in the response).
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const maxDuration = 300; // up to 5 min for the full sweep

const USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";
const REQUEST_DELAY_MS = 50;

interface UsdaFoodNutrient {
  nutrientId?: number;
  nutrientName?: string;
  nutrientNumber?: string;
  value?: number;
  unitName?: string;
  nutrient?: { id?: number; name?: string; number?: string; unitName?: string };
  amount?: number;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: UsdaFoodNutrient[];
}

/**
 * Look up a nutrient value + unit from a USDA food response.
 * Matches by either nutrientNumber (e.g. "307") or nutrient.id (e.g. 1093).
 * Returns null when the nutrient isn't in the response — callers should NOT
 * write a 0 in that case because nutrient-absent is semantically different
 * from "USDA explicitly reports 0 of this".
 */
function getNutrientValueWithUnit(
  food: UsdaFood,
  numbers: string[],
  ids: number[]
): { value: number; unit: string } | null {
  const nutrients = food.foodNutrients || [];
  for (const n of nutrients) {
    const num = n.nutrientNumber || n.nutrient?.number;
    const id = n.nutrientId ?? n.nutrient?.id;
    const matches =
      (num && numbers.includes(num)) ||
      (id !== undefined && ids.includes(Number(id)));
    if (matches) {
      const v = n.value ?? n.amount;
      if (v === undefined) return null;
      return {
        value: Number(v),
        unit: (n.unitName || n.nutrient?.unitName || "").toLowerCase(),
      };
    }
  }
  return null;
}

function getValue(food: UsdaFood, numbers: string[], ids: number[]): number | null {
  const r = getNutrientValueWithUnit(food, numbers, ids);
  return r ? r.value : null;
}

/**
 * Vitamin D is reported in two forms by USDA:
 *   nutrientNumber 324 / id 1110 → Vitamin D (D2+D3), may be IU OR µg
 *   nutrientNumber 328 / id 1114 → Vitamin D3 specifically, usually µg
 * Target schema field is vitamin_d_iu_per_100g → convert µg to IU by ×40.
 */
function getVitaminDIU(food: UsdaFood): number | null {
  const d2d3 = getNutrientValueWithUnit(food, ["324"], [1110]);
  if (d2d3) {
    if (d2d3.unit.includes("iu")) return d2d3.value;
    if (d2d3.unit.includes("µg") || d2d3.unit.includes("ug") || d2d3.unit.includes("mcg"))
      return d2d3.value * 40;
  }
  const d3 = getNutrientValueWithUnit(food, ["328"], [1114]);
  if (d3) {
    if (d3.unit.includes("iu")) return d3.value;
    if (d3.unit.includes("µg") || d3.unit.includes("ug") || d3.unit.includes("mcg"))
      return d3.value * 40;
  }
  return null;
}

async function fetchFood(apiKey: string, fdcId: number): Promise<UsdaFood | null> {
  const url = `${USDA_API_BASE}/food/${fdcId}?api_key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[usda] fetch failed for ${fdcId}: ${res.status}`);
      return null;
    }
    return (await res.json()) as UsdaFood;
  } catch (err) {
    console.error(`[usda] fetch threw for ${fdcId}:`, err);
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// GET is aliased to POST so the endpoint can be triggered with a single
// browser-tab click while logged into the CCOS app. The handler is
// idempotent (it fetches fresh USDA data and overwrites per approved
// policy), so accidental refreshes are safe.
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "USDA_API_KEY not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") || "0", 10);

  const db = getServiceSupabase();
  const { data: ingredients, error: loadErr } = await db
    .from("ingredients")
    .select("id, slug, name, category, usda_fdc_id")
    .not("usda_fdc_id", "is", null)
    .order("id");

  if (loadErr || !ingredients) {
    return NextResponse.json({ error: `Failed to load ingredients: ${loadErr?.message}` }, { status: 500 });
  }

  const rows = limit > 0 ? ingredients.slice(0, limit) : ingredients;

  // Per-nutrient population counter for the summary report
  const populated: Record<string, number> = {
    sodium_mg_per_100g: 0,
    potassium_mg_per_100g: 0,
    vitamin_k_mcg_per_100g: 0,
    saturated_fat_g_per_100g: 0,
    fiber_g_per_100g: 0,
    sugar_g_per_100g: 0,
    cholesterol_mg_per_100g: 0,
    calcium_mg_per_100g: 0,
    iron_mg_per_100g: 0,
    magnesium_mg_per_100g: 0,
    vitamin_c_mg_per_100g: 0,
    vitamin_d_iu_per_100g: 0,
    omega_3_g_per_100g: 0,
  };

  const missingByIngredient: { slug: string; name: string; missing: string[] }[] = [];
  const failedFetches: { slug: string; name: string; fdcId: number }[] = [];
  let updated = 0;

  for (const ing of rows) {
    const food = await fetchFood(apiKey, ing.usda_fdc_id);
    if (!food) {
      failedFetches.push({ slug: ing.slug, name: ing.name, fdcId: ing.usda_fdc_id });
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    // USDA nutrient lookups — try both nutrientNumber strings AND nutrient.id
    // integers so we're robust across Foundation vs SR Legacy response shapes.
    const panel = {
      sodium_mg_per_100g:       getValue(food, ["307"], [1093]),
      potassium_mg_per_100g:    getValue(food, ["306"], [1092]),
      vitamin_k_mcg_per_100g:   getValue(food, ["430"], [1185]),
      saturated_fat_g_per_100g: getValue(food, ["606"], [1258]),
      fiber_g_per_100g:         getValue(food, ["291"], [1079]),
      sugar_g_per_100g:         getValue(food, ["269"], [2000, 1063]),
      cholesterol_mg_per_100g:  getValue(food, ["601"], [1253]),
      calcium_mg_per_100g:      getValue(food, ["301"], [1087]),
      iron_mg_per_100g:         getValue(food, ["303"], [1089]),
      magnesium_mg_per_100g:    getValue(food, ["304"], [1090]),
      vitamin_c_mg_per_100g:    getValue(food, ["401"], [1162]),
      vitamin_d_iu_per_100g:    getVitaminDIU(food),
      omega_3_g_per_100g:       getValue(food, ["851"], [1404]),
    };

    // Record which fields we got vs missed for this ingredient
    const missing: string[] = [];
    for (const [k, v] of Object.entries(panel)) {
      if (v === null || v === undefined) {
        missing.push(k);
      } else {
        populated[k]++;
      }
    }
    if (missing.length > 0) {
      missingByIngredient.push({ slug: ing.slug, name: ing.name, missing });
    }

    // Build update object: only fields that came back non-null. We don't
    // overwrite with null — leaves prior values (including the original
    // sodium/fiber/sugar) intact on fields USDA doesn't have for this entry.
    // Per approved policy (Task 3 option a), non-null values DO overwrite
    // existing ones for sodium/fiber/sugar — fixes known data-quality bugs.
    const update: Record<string, number | string> = {
      updated_at: new Date().toISOString(),
    };
    for (const [k, v] of Object.entries(panel)) {
      if (v !== null && v !== undefined && isFinite(v)) update[k] = v;
    }

    const { error: updateErr } = await db
      .from("ingredients")
      .update(update)
      .eq("id", ing.id);

    if (updateErr) {
      console.error(`[sync-ext] update failed for ${ing.slug}:`, updateErr.message);
      failedFetches.push({ slug: ing.slug, name: ing.name, fdcId: ing.usda_fdc_id });
    } else {
      updated++;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  const totalRows = rows.length;
  const fullyPopulatedCount = Object.values(populated).filter((n) => n === totalRows).length;

  return NextResponse.json({
    success: true,
    totalProcessed: totalRows,
    updated,
    failedFetches,
    perNutrientPopulated: populated,
    fullyPopulatedNutrients: fullyPopulatedCount,
    ingredientsWithAnyMissing: missingByIngredient.length,
    missingByIngredient: missingByIngredient.slice(0, 100), // trim for response size
    note: "Nulls are honest: fields USDA doesn't have for a given entry are left NULL (no interpolation).",
  });
}
