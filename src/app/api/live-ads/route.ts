import { NextResponse } from "next/server";
import { getLiveAdsDashboard } from "@/lib/live-ads";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  try {
    const payload = await getLiveAdsDashboard();
    return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[live-ads] Failed to load active ads", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Live Ads failed to load." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
