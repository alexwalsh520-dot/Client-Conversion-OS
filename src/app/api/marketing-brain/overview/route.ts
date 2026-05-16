import { NextResponse } from "next/server";
import { marketingBrainOverview } from "@/lib/marketing-brain/data";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  return NextResponse.json(marketingBrainOverview, {
    headers: NO_STORE_HEADERS,
  });
}
