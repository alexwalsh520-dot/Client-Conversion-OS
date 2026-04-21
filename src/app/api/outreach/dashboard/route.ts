import { NextRequest, NextResponse } from "next/server";
import { getOutreachDashboard } from "@/lib/outreach-dashboard";
import type { OutreachRangePreset } from "@/lib/outreach-dashboard-types";

export const maxDuration = 60;

function isValidDate(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const preset = (searchParams.get("preset") || "mtd") as OutreachRangePreset;
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const timeZone = searchParams.get("timeZone") || "UTC";

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return NextResponse.json(
        { error: "startDate and endDate are required in YYYY-MM-DD format" },
        { status: 400 },
      );
    }

    if (startDate! > endDate!) {
      return NextResponse.json(
        { error: "startDate must be before or equal to endDate" },
        { status: 400 },
      );
    }

    const data = await getOutreachDashboard({
      preset,
      startDate: startDate!,
      endDate: endDate!,
      timeZone,
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to load outreach dashboard",
      },
      { status: 500 },
    );
  }
}
