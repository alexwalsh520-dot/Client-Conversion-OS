import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { serveWindow } from "@/lib/ads-v2/serve";
import { rangeForPreset, todayEt, type PresetId } from "@/lib/ads-v2/time";
import type { AdsV2Account, AdsV2Level, AdsV2Query, AdsV2Status } from "@/lib/ads-v2/types";

// Read path only: an indexed SELECT of one precomputed snapshot (or a fast
// build of a cold custom window from already-computed facts). No external API
// call, no historical recomputation. A serving timeout would be an architecture
// bug, so the ceiling is generous but the real path is milliseconds to seconds.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACCOUNTS = new Set(["all", "tyson", "jake"]);
const STATUSES = new Set(["active", "finished", "all"]);
const LEVELS = new Set(["campaign", "adset", "ad"]);
const PRESET_IDS = new Set([
  "today",
  "yesterday",
  "last3",
  "last7",
  "last14",
  "last30",
  "mtd",
  "lmtd",
  "custom",
]);

function isIsoDay(v: string | null): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const account = (ACCOUNTS.has(sp.get("account") || "") ? sp.get("account") : "all") as AdsV2Account;
  const status = (STATUSES.has(sp.get("status") || "") ? sp.get("status") : "active") as AdsV2Status;
  const level = (LEVELS.has(sp.get("level") || "") ? sp.get("level") : "campaign") as AdsV2Level;

  // Range: explicit dateFrom/dateTo win; otherwise resolve a preset server-side
  // (so the ET math is identical to the client's), defaulting to last 7 days.
  let dateFrom = sp.get("dateFrom");
  let dateTo = sp.get("dateTo");
  if (!isIsoDay(dateFrom) || !isIsoDay(dateTo)) {
    const presetRaw = sp.get("preset");
    const preset = (PRESET_IDS.has(presetRaw || "") ? presetRaw : "last7") as PresetId;
    const range = rangeForPreset(preset, todayEt());
    dateFrom = range.from;
    dateTo = range.to;
  }
  if (dateTo < dateFrom) [dateFrom, dateTo] = [dateTo, dateFrom];

  const query: AdsV2Query = { account, status, level, dateFrom, dateTo };

  try {
    const payload = await serveWindow(query);
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to build window" },
      { status: 500 },
    );
  }
}
