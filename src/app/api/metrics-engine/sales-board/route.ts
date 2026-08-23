// ─────────────────────────────────────────────────────────────────────────
// METRICS ENGINE — the sales-board API. One session-authed GET answers the
// entire /sales-dashboard page from the engine's own warehouse (no Sales Hub
// sheet API). Query params:
//   from=YYYY-MM-DD & to=YYYY-MM-DD   explicit ET day window, OR
//   preset=today|yesterday|last3|last7|last14|last30|mtd|lmtd  (default mtd)
//   client=tyson | client=tyson,jake   optional client scope
//
// Returns computeSalesBoard() output — see src/lib/metrics-engine/sales-board.ts.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { rangeForPreset, todayEt, type PresetId } from "@/lib/ads-v2/time";
import { computeSalesBoard } from "@/lib/metrics-engine/sales-board";

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

  let range;
  if (isIsoDay(from) && isIsoDay(to)) {
    range = from <= to ? { from, to } : { from: to, to: from };
  } else {
    const preset: PresetId =
      presetRaw && PRESET_IDS.includes(presetRaw) ? (presetRaw as PresetId) : "mtd";
    range = rangeForPreset(preset, todayEt());
  }

  try {
    const board = await computeSalesBoard({
      range,
      client: searchParams.get("client"),
    });
    return NextResponse.json(board, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    });
  } catch (err) {
    console.error("[metrics-engine/sales-board] failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "sales board computation failed" },
      { status: 500 },
    );
  }
}
