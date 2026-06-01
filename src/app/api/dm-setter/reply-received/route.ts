import { NextRequest, NextResponse } from "next/server";
import { removeLeadFromDmSetterPipeline } from "@/lib/dm-setter-pipeline";
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
    const result = await removeLeadFromDmSetterPipeline({
      ...payload,
      tagName: payload.tagName || "lead_replied",
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to remove lead from pipeline";
    console.error("[dm-setter/reply-received]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    description: "ManyChat webhook. Deletes open DM setter follow-up opportunities when a lead replies.",
    required_header: "x-manychat-secret",
    required_body: ["client", "subscriber_id"],
  });
}
