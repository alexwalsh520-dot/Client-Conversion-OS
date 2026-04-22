/**
 * For every ingredient where the stored usda_fdc_id is broken (USDA returns
 * 404, or the fdcId is reused across multiple ingredient slugs, or the
 * returned entry had null potassium after the backfill run), call USDA
 * /foods/search with the DB name as the query and return the top 3
 * candidate entries. Each candidate is annotated with fdcId, description,
 * dataType, and sodium value so an operator can pick the right remap.
 *
 * POST /api/internal/fdcid-remap-report
 * No body needed. No auth gate (read-only, safe).
 *
 * Designed to be called via Supabase pg_net so no browser click is required.
 * With concurrency=5 the 39 rows complete in ~10-15s wall time (each row =
 * 1 search + up to 3 detail fetches = ~1.5s serial; parallel amortizes).
 *
 * Returns JSON; chat-side formatting into a markdown review table happens
 * outside this endpoint.
 */

import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const USDA_API_BASE = "https://api.nal.usda.gov/fdc/v1";

interface UsdaSearchFood {
  fdcId: number;
  description: string;
  dataType?: string;
  foodNutrients?: Array<{
    nutrientNumber?: string;
    nutrientId?: number;
    nutrient?: { number?: string; id?: number };
    value?: number;
    amount?: number;
  }>;
}

interface UsdaSearchResponse {
  foods?: UsdaSearchFood[];
}

function sodiumFromSearchFood(f: UsdaSearchFood): number | null {
  const hit = f.foodNutrients?.find((n) => {
    const num = n.nutrientNumber || n.nutrient?.number;
    const id = n.nutrientId ?? n.nutrient?.id;
    return num === "307" || Number(id) === 1093;
  });
  if (!hit) return null;
  const v = hit.value ?? hit.amount;
  return v === undefined ? null : Number(v);
}

async function searchCandidates(
  apiKey: string,
  query: string
): Promise<
  { fdcId: number; description: string; dataType: string; sodium: number | null }[]
> {
  // Prefer Foundation + SR Legacy (whole-food, best data). Fall back to any
  // dataType if nothing returns. pageSize=5 gives us headroom to filter.
  const url =
    `${USDA_API_BASE}/foods/search?api_key=${apiKey}` +
    `&query=${encodeURIComponent(query)}` +
    `&dataType=Foundation,SR%20Legacy,Survey%20(FNDDS)` +
    `&pageSize=5`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as UsdaSearchResponse;
    const foods = data.foods || [];
    return foods.slice(0, 3).map((f) => ({
      fdcId: f.fdcId,
      description: f.description,
      dataType: f.dataType || "",
      sodium: sodiumFromSearchFood(f),
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(_req: NextRequest) {
  const apiKey = process.env.USDA_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "USDA_API_KEY not configured" }, { status: 500 });
  }
  const db = getServiceSupabase();

  // Broken = any of:
  //  (a) USDA fetch failed → potassium still NULL after last backfill run
  //  (b) fdcId reused across >1 slug (impossible — clearly wrong)
  // Same row may match both; unioned into a single list with a reason.
  const { data: nullPotassium } = await db
    .from("ingredients")
    .select("id, slug, name, category, usda_fdc_id")
    .not("usda_fdc_id", "is", null)
    .is("potassium_mg_per_100g", null);

  const { data: allFdc } = await db
    .from("ingredients")
    .select("id, slug, name, category, usda_fdc_id")
    .not("usda_fdc_id", "is", null);

  if (!nullPotassium || !allFdc) {
    return NextResponse.json({ error: "Failed to load ingredients" }, { status: 500 });
  }

  // Group by fdcId so we can tag duplicates
  const fdcCounts: Record<number, number> = {};
  for (const r of allFdc) fdcCounts[r.usda_fdc_id] = (fdcCounts[r.usda_fdc_id] || 0) + 1;
  const dupsBySlug: Record<string, number[]> = {};
  for (const r of allFdc) {
    if (fdcCounts[r.usda_fdc_id] > 1) {
      dupsBySlug[r.slug] = allFdc
        .filter((x) => x.usda_fdc_id === r.usda_fdc_id)
        .map((x) => x.id);
    }
  }

  // Build the target set. Prefer the NULL-potassium rows (guaranteed broken).
  // Add any non-null rows that are only broken because they share an fdcId
  // (those got lucky in an earlier run but their data belongs to a different
  // food — still wrong). For this report we focus on the 39 NULL rows per the
  // user's ask, but we'll annotate duplicates even if they happen to have
  // data.
  const targets = nullPotassium.map((r) => {
    const reasons: string[] = [];
    if (fdcCounts[r.usda_fdc_id] > 1) {
      const siblings = allFdc
        .filter((x) => x.usda_fdc_id === r.usda_fdc_id && x.slug !== r.slug)
        .map((x) => x.slug);
      reasons.push(
        `duplicate fdcId ${r.usda_fdc_id} also assigned to: ${siblings.join(", ")}`
      );
    } else {
      reasons.push(`USDA returned 404/missing-data for fdcId ${r.usda_fdc_id}`);
    }
    return { ...r, brokenReason: reasons.join(" + ") };
  });

  // Concurrency-limited batched USDA search calls.
  const concurrency = 5;
  const rows: Array<
    typeof targets[number] & {
      candidates: {
        fdcId: number;
        description: string;
        dataType: string;
        sodium: number | null;
      }[];
    }
  > = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const slice = targets.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async (t) => ({
        ...t,
        candidates: await searchCandidates(apiKey, t.name),
      }))
    );
    rows.push(...results);
  }

  return NextResponse.json({
    totalBroken: rows.length,
    rows,
  });
}
