import { NextResponse } from "next/server";
import { getHomeBusinessMetrics } from "@/lib/home-business-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getHomeBusinessMetrics();
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load business metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
