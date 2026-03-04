import { NextResponse } from "next/server";
import { getCampaignStatistics } from "@/lib/smartlead";

export async function GET() {
  try {
    const stats = await getCampaignStatistics();
    return NextResponse.json(stats);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
