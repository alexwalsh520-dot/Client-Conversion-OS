import { NextRequest, NextResponse } from "next/server";
import { generateMarketingBrainBrief, responsePayload } from "@/lib/marketing-brain/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { verdictId?: unknown };
    const verdictId = typeof body.verdictId === "string" ? body.verdictId : undefined;
    const data = await generateMarketingBrainBrief(verdictId);
    return NextResponse.json(responsePayload(data), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to generate brief" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
