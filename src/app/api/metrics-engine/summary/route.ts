// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — the summary API the dashboard tabs read.
//
// Session-authed GET. Query params:
//   from=YYYY-MM-DD & to=YYYY-MM-DD   explicit ET day window, OR
//   preset=today|yesterday|last3|last7|last14|last30|mtd|lmtd  (default mtd)
//   client=tyson | client=tyson,jake   optional client scope — one key or a
//                                      comma-separated list (aggregated)
//   rep=<rep key> | rep=will,erin      optional rep scope — one key or a
//                                      comma-separated list (team.ts keys)
//   lens=origin|conversion  lead-type lens (default origin)
//
// Returns computeMetrics() output (see src/lib/metrics-engine/types.ts) plus
// migration_pending + freshness stamps. Degrades to empty metrics with
// migration_pending: true when migration 113 has not been pasted yet.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rangeForPreset, todayEt, type PresetId } from "@/lib/ads-v2/time";
import { computeMetrics } from "@/lib/metrics-engine/compute";
import type { Lens } from "@/lib/metrics-engine/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PRESET_IDS: readonly string[] = [
  "today",
  "yesterday",
  "last3",
  "last7",
  "last14",
  "last30",
  "mtd",
  "lmtd",
  "custom",
];

const isIsoDay = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const presetRaw = searchParams.get("preset");
  const lensRaw = searchParams.get("lens");
  const lens: Lens = lensRaw === "conversion" ? "conversion" : "origin";

  let range;
  if (isIsoDay(from) && isIsoDay(to)) {
    range = from <= to ? { from, to } : { from: to, to: from };
  } else {
    const preset: PresetId =
      presetRaw && PRESET_IDS.includes(presetRaw) ? (presetRaw as PresetId) : "mtd";
    range = rangeForPreset(preset, todayEt());
  }

  try {
    const summary = await computeMetrics({
      range,
      client: searchParams.get("client"),
      rep: searchParams.get("rep"),
      lens,
    });
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    console.error("[metrics-engine/summary] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "metrics computation failed" },
      { status: 500 },
    );
  }
}
