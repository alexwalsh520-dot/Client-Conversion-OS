import { NextRequest, NextResponse } from "next/server";
import { responsePayload, updateMarketingBrainRule } from "@/lib/marketing-brain/engine";
import type { DecisionRule } from "@/lib/marketing-brain/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES: DecisionRule["category"][] = ["scoring", "copy", "filtering", "strategy"];
const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = await req.json() as { active?: unknown; text?: unknown; category?: unknown };
    const patch: Partial<Pick<DecisionRule, "active" | "text" | "category">> = {};

    if (typeof body.active === "boolean") patch.active = body.active;
    if (typeof body.text === "string" && body.text.trim().length >= 8) patch.text = body.text.trim();
    if (CATEGORIES.includes(body.category as DecisionRule["category"])) {
      patch.category = body.category as DecisionRule["category"];
    }

    const data = await updateMarketingBrainRule(id, patch);
    return NextResponse.json(responsePayload(data), { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update rule" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
