import { NextResponse } from "next/server";
import { getMarketingBrainOverview } from "@/lib/marketing-brain/engine";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  const overview = await getMarketingBrainOverview();
  return NextResponse.json(overview, {
    headers: NO_STORE_HEADERS,
  });
}
