import { NextResponse } from "next/server";
import { getPipelineStageCounts } from "@/lib/ghl";

export async function GET() {
  try {
    const data = await getPipelineStageCounts();
    return NextResponse.json(data);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
