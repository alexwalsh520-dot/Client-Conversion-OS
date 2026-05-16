import { NextResponse } from "next/server";
import { approveMarketingBrainBrief, responsePayload } from "@/lib/marketing-brain/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const data = await approveMarketingBrainBrief(id);
    return NextResponse.json(responsePayload(data), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to approve brief" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
