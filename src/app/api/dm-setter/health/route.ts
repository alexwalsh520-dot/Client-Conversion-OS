import { NextRequest, NextResponse } from "next/server";
import { checkDmSetterPipelineConfig } from "@/lib/dm-setter-pipeline";
import { hasValidManychatSecret } from "../_shared";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!hasValidManychatSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const pipeline = await checkDmSetterPipelineConfig();
    return NextResponse.json({ ok: true, ...pipeline });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check DM setter pipeline";
    console.error("[dm-setter/health]", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
