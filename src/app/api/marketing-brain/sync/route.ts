import { NextResponse } from "next/server";
import { responsePayload, runMarketingBrainSync } from "@/lib/marketing-brain/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST() {
  try {
    const data = await runMarketingBrainSync();
    return NextResponse.json(responsePayload(data, { synced: true }), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Marketing Brain sync failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
