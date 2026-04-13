import { NextRequest, NextResponse } from "next/server";
import { getSetterReportData } from "@/lib/setter-report-data";

function getEtDateString(input: string | null) {
  if (input) return input;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(now);
}

export async function GET(req: NextRequest) {
  const reportDate = getEtDateString(req.nextUrl.searchParams.get("date"));

  try {
    const data = await getSetterReportData(reportDate);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[sales-hub/setter-report-data] error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load setter report data",
      },
      { status: 500 },
    );
  }
}
