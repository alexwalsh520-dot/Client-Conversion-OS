import { NextResponse } from "next/server";
import { getAgencyAcquisitionMetrics } from "@/lib/agency-acquisition-metrics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getAgencyAcquisitionMetrics();
    return NextResponse.json(data);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load agency metrics";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
