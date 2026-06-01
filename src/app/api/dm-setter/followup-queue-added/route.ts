import { NextRequest, NextResponse } from "next/server";
import { addLeadToDmSetterPipeline } from "@/lib/dm-setter-pipeline";
import { parseDmSetterBody, readManychatJson } from "../_shared";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const parsed = await readManychatJson(req);
  if (parsed.error) return parsed.error;

  const payload = parseDmSetterBody(parsed.body);
  if (!payload.subscriberId) {
    return NextResponse.json({ error: "subscriber_id is required" }, { status: 400 });
  }

  try {
    const result = await addLeadToDmSetterPipeline(payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add lead to pipeline";
    console.error("[dm-setter/followup-queue-added]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    description: "ManyChat webhook. Adds one lead to the DM setter follow-up pipeline.",
    required_header: "x-manychat-secret",
    required_body: ["client", "subscriber_id"],
  });
}
