/**
 * Category-aware audit: flags ingredients whose sodium value falls outside
 * the expected range for their category, and — for each flagged ingredient —
 * searches USDA for the top 3 alternative entries that might be a better
 * match. Returns CSV so the operator can review and approve remappings
 * before any DB writes.
 *
 * POST /api/nutrition/find-suspicious-sodium
 *   Admin auth required outside dev.
 *   Optional ?format=json to get JSON instead of CSV.
 *
 * No DB writes. Read-only audit.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";

export const maxDuration = 300;

const USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";
const REQUEST_DELAY_MS = 60; // slightly higher since we hit search endpoint (heavier)

interface UsdaFoodNutrient {
  nutrientNumber?: string;
  nutrientId?: number;
  nutrient?: { number?: string; id?: number };
  value?: number;
  amount?: number;
}
interface UsdaFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: UsdaFoodNutrient[];
}
interface UsdaSearchResponse {
  foods?: UsdaFood[];
}

/**
 * Per-category sodium reference ranges, in mg/100g.
 * A "bucket" is a named sub-category inside a DB category + optional slug hint.
 * First matching bucket wins.
 */
interface SodiumBucket {
  name: string;
  // Matches the DB category field (fat, protein, carb, vegetable, fruit, dairy, condiment, ...)
  dbCategory?: string;
  // Extra slug/name contains filter to narrow within a category
  slugHint?: RegExp;
  // Inverse — exclude if slug/name matches this
  slugExclude?: RegExp;
  min: number;
  max: number;
}

const SODIUM_BUCKETS: SodiumBucket[] = [
  // Cheeses — split fresh vs aged
  { name: "Cheese (fresh — mozzarella/ricotta/cottage/cream)", slugHint: /mozzarella|ricotta|cottage_?cheese|cream_?cheese|fresh_cheese/i, min: 50, max: 400 },
  { name: "Cheese (hard/aged)", dbCategory: "dairy", slugHint: /cheese/i, min: 300, max: 800 },
  // Breads
  { name: "Tortilla (flour)", slugHint: /tortilla_flour|flour_tortilla/i, min: 300, max: 800 },
  { name: "Tortilla (corn)", slugHint: /tortilla_corn|corn_tortilla/i, min: 10, max: 50 },
  { name: "Bread (non-flatbread)", slugHint: /bread|bagel|muffin|toast|roll|sourdough|pita/i, min: 400, max: 700 },
  // Meats
  { name: "Cured/processed meats", slugHint: /bacon|salami|pepperoni|deli|jerky|sausage|prosciutto|ham_cured|hot_dog/i, min: 800, max: 1500 },
  { name: "Fresh meats (raw/cooked unseasoned)", dbCategory: "protein", min: 40, max: 120 },
  { name: "Fresh seafood", dbCategory: "seafood", min: 40, max: 350 }, // shrimp naturally ~700
  // Legumes
  { name: "Canned beans", slugHint: /beans?_canned|canned_(black|pinto|kidney|garbanzo|chickpea)|baked_beans/i, min: 300, max: 500 },
  { name: "Dry/home-cooked beans", dbCategory: "legume", min: 1, max: 10 },
  // Sauces / condiments
  { name: "Soy sauce", slugHint: /soy_sauce/i, min: 5000, max: 6000 },
  { name: "Hot sauce", slugHint: /hot_sauce|sriracha/i, min: 1000, max: 2500 },
  { name: "Salsa", slugHint: /\bsalsa\b/i, min: 300, max: 500 },
  { name: "Marinara", slugHint: /marinara/i, min: 300, max: 500 },
  // Oils
  { name: "Oils", slugHint: /_oil$|^oil_|olive_oil|coconut_oil|avocado_oil|sesame_oil|canola_oil|vegetable_oil/i, min: 0, max: 5 },
  // Fresh produce
  { name: "Fresh vegetables", dbCategory: "vegetable", slugExclude: /celery|beet|spinach/i, min: 0, max: 50 },
  { name: "Fresh vegetables (naturally higher — celery/beet/spinach)", dbCategory: "vegetable", slugHint: /celery|beet|spinach/i, min: 50, max: 90 },
  { name: "Fresh fruits", dbCategory: "fruit", min: 0, max: 10 },
];

function classifySodium(slug: string, name: string, dbCategory: string): SodiumBucket | null {
  const haystack = `${slug} ${name}`.toLowerCase();
  for (const b of SODIUM_BUCKETS) {
    if (b.dbCategory && b.dbCategory !== dbCategory) continue;
    if (b.slugHint && !b.slugHint.test(haystack)) continue;
    if (b.slugExclude && b.slugExclude.test(haystack)) continue;
    return b;
  }
  return null;
}

async function searchAlternatives(
  apiKey: string,
  term: string
): Promise<{ fdcId: number; description: string; dataType?: string; sodium: number | null }[]> {
  const url = `${USDA_API_BASE}/foods/search?api_key=${apiKey}&query=${encodeURIComponent(term)}&dataType=Foundation,SR%20Legacy&pageSize=6`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as UsdaSearchResponse;
    const foods = data.foods || [];
    return foods.slice(0, 6).map((f) => {
      const sodium = f.foodNutrients?.find((n) => {
        const num = n.nutrientNumber || n.nutrient?.number;
        const id = n.nutrientId ?? n.nutrient?.id;
        return num === "307" || id === 1093;
      });
      return {
        fdcId: f.fdcId,
        description: f.description,
        dataType: f.dataType,
        sodium: sodium?.value ?? sodium?.amount ?? null,
      };
    });
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const csvEscape = (v: unknown): string => {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "USDA_API_KEY not configured" }, { status: 500 });
  }
  const format = new URL(req.url).searchParams.get("format") || "csv";

  const db = getServiceSupabase();
  const { data: ingredients, error } = await db
    .from("ingredients")
    .select("id, slug, name, category, usda_fdc_id, sodium_mg_per_100g")
    .order("slug");
  if (error || !ingredients) {
    return NextResponse.json({ error: `load failed: ${error?.message}` }, { status: 500 });
  }

  interface FlagRow {
    slug: string;
    name: string;
    category: string;
    currentFdcId: number | null;
    currentSodium: number | null;
    bucketName: string;
    expectedMin: number;
    expectedMax: number;
    alternatives: { fdcId: number; description: string; dataType?: string; sodium: number | null }[];
    note: string;
  }

  const flagged: FlagRow[] = [];

  for (const ing of ingredients) {
    const sodium = ing.sodium_mg_per_100g === null ? null : Number(ing.sodium_mg_per_100g);
    const bucket = classifySodium(ing.slug, ing.name, ing.category);
    if (!bucket) continue; // no applicable range — skip silently
    if (sodium === null) {
      flagged.push({
        slug: ing.slug,
        name: ing.name,
        category: ing.category,
        currentFdcId: ing.usda_fdc_id,
        currentSodium: null,
        bucketName: bucket.name,
        expectedMin: bucket.min,
        expectedMax: bucket.max,
        alternatives: [],
        note: "Sodium is NULL — USDA entry may be missing this nutrient.",
      });
      continue;
    }
    if (sodium < bucket.min || sodium > bucket.max) {
      flagged.push({
        slug: ing.slug,
        name: ing.name,
        category: ing.category,
        currentFdcId: ing.usda_fdc_id,
        currentSodium: sodium,
        bucketName: bucket.name,
        expectedMin: bucket.min,
        expectedMax: bucket.max,
        alternatives: [],
        note: sodium < bucket.min ? "Below expected range" : "Above expected range",
      });
    }
  }

  // Explicitly flag mozzarella_cheese_whole if it's still matched to fresh
  // (sodium ~100 mg). Even if it passed the fresh-cheese bucket, the intent
  // is for this slug to represent low-moisture block mozzarella.
  const whole = ingredients.find((i) => i.slug === "mozzarella_cheese_whole");
  if (whole) {
    const s = whole.sodium_mg_per_100g === null ? null : Number(whole.sodium_mg_per_100g);
    if (s !== null && s < 400 && !flagged.some((f) => f.slug === "mozzarella_cheese_whole")) {
      flagged.push({
        slug: "mozzarella_cheese_whole",
        name: whole.name,
        category: whole.category,
        currentFdcId: whole.usda_fdc_id,
        currentSodium: s,
        bucketName: "Cheese — slug intent is LOW-MOISTURE block mozzarella",
        expectedMin: 500,
        expectedMax: 700,
        alternatives: [],
        note: "Currently mapped to FRESH mozzarella (low sodium). The slug name implies low-moisture (block) — needs remap.",
      });
    }
  }

  // For each flagged row, search USDA for better alternatives.
  for (const row of flagged) {
    const searchTerm = row.name; // DB display name is usually the best search phrase
    const alts = await searchAlternatives(apiKey, searchTerm);
    row.alternatives = alts.filter((a) => a.fdcId !== row.currentFdcId).slice(0, 3);
    await sleep(REQUEST_DELAY_MS);
  }

  if (format === "json") {
    return NextResponse.json({
      totalIngredients: ingredients.length,
      flaggedCount: flagged.length,
      flagged,
    });
  }

  // CSV output
  const headers = [
    "slug",
    "name",
    "category",
    "bucket",
    "expected_min_mg",
    "expected_max_mg",
    "current_fdc_id",
    "current_sodium_mg",
    "note",
    "alt1_fdc_id",
    "alt1_description",
    "alt1_dataType",
    "alt1_sodium_mg",
    "alt2_fdc_id",
    "alt2_description",
    "alt2_dataType",
    "alt2_sodium_mg",
    "alt3_fdc_id",
    "alt3_description",
    "alt3_dataType",
    "alt3_sodium_mg",
  ];
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of flagged) {
    const a = row.alternatives;
    const cells = [
      row.slug,
      row.name,
      row.category,
      row.bucketName,
      row.expectedMin,
      row.expectedMax,
      row.currentFdcId,
      row.currentSodium,
      row.note,
      a[0]?.fdcId ?? "",
      a[0]?.description ?? "",
      a[0]?.dataType ?? "",
      a[0]?.sodium ?? "",
      a[1]?.fdcId ?? "",
      a[1]?.description ?? "",
      a[1]?.dataType ?? "",
      a[1]?.sodium ?? "",
      a[2]?.fdcId ?? "",
      a[2]?.description ?? "",
      a[2]?.dataType ?? "",
      a[2]?.sodium ?? "",
    ];
    lines.push(cells.map(csvEscape).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="suspicious-sodium-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
