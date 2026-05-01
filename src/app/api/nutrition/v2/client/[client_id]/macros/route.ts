/**
 * GET /api/nutrition/v2/client/:client_id/macros[?kcal=N]
 *
 * Live-preview endpoint for the coach UI's MacroTargetEditor. Returns
 * the suggested daily targets (calculator output minus 400 kcal, floored
 * at 1200) plus the re-derived P/C/F. When the coach overrides the kcal
 * value via the editor, the same endpoint is called with `?kcal=N` and
 * returns the same shape with the override applied.
 *
 * Lightweight, idempotent. Called on mount + on each debounced kcal
 * change in the editor. The full prompt assembly lives in the separate
 * /copy-prompt endpoint and is only called once, after the coach locks.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { loadIntakeAndComputeRawTargets } from "@/lib/nutrition/intake-targets";
import {
  adjustMacros,
  KCAL_FLOOR,
} from "@/lib/nutrition/macro-adjust";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ client_id: string }> },
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { client_id: rawId } = await ctx.params;
  const clientId = parseInt(rawId, 10);
  if (!Number.isFinite(clientId)) {
    return NextResponse.json({ error: "invalid client_id" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const result = await loadIntakeAndComputeRawTargets(db, clientId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Optional kcal override from query. The UI sends this on every debounced
  // change while the coach is adjusting; once locked, the eventual call
  // to /copy-prompt carries the same value forward.
  const kcalRaw = req.nextUrl.searchParams.get("kcal");
  let overrideKcal: number | undefined;
  if (kcalRaw != null) {
    const parsed = parseInt(kcalRaw, 10);
    if (!Number.isFinite(parsed) || parsed < 500 || parsed > 6000) {
      return NextResponse.json(
        { error: "kcal override must be an integer between 500 and 6000" },
        { status: 400 },
      );
    }
    overrideKcal = parsed;
  }

  const adjusted = adjustMacros(result.raw, { overrideKcal });

  return NextResponse.json({
    client_id: clientId,
    client_name: result.clientName,
    raw_calculator_kcal: adjusted.rawCalculatorKcal,
    suggested_kcal: Math.max(
      KCAL_FLOOR,
      adjusted.rawCalculatorKcal - 400,
    ), // what the editor shows on first load
    targets: {
      calories: adjusted.calories,
      proteinG: adjusted.proteinG,
      carbsG: adjusted.carbsG,
      fatG: adjusted.fatG,
      sodiumCapMg: adjusted.sodiumCapMg,
      notes: adjusted.notes,
      source: adjusted.source,
      flooredAt1200: adjusted.flooredAt1200,
    },
    parsed: result.parsed, // weight/height/age/sex for editor display
  });
}
