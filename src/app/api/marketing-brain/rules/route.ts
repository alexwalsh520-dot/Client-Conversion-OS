import { NextRequest, NextResponse } from "next/server";
import { addMarketingBrainRule, responsePayload } from "@/lib/marketing-brain/engine";
import type { DecisionRule } from "@/lib/marketing-brain/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES: DecisionRule["category"][] = ["scoring", "copy", "filtering", "strategy"];
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { text?: unknown; category?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const category = CATEGORIES.includes(body.category as DecisionRule["category"])
      ? body.category as DecisionRule["category"]
      : "strategy";

    if (text.length < 8) {
      return NextResponse.json(
        { success: false, error: "Rule text is too short." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const data = await addMarketingBrainRule({ text, category });
    return NextResponse.json(responsePayload(data), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to add rule" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
